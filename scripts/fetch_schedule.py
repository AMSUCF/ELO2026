"""Scrape the ELO 2026 combined schedule from STARS into data/events.json.

STARS (Digital Commons) publishes wall-clock times that are US Eastern
(America/New_York); its RSS feed mislabels them PDT. We parse the hCalendar
microformat rows on the combined-schedule page and store UTC instants.
"""

import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from zoneinfo import ZoneInfo

SCHEDULE_URL = "https://stars.library.ucf.edu/elo2026/combined_schedule/"
RSS_URL = "https://stars.library.ucf.edu/elo2026/combined_schedule/all/recent-events.rss"
# STARS (bepress) streaming lookup: 200 + JSON [m3u8 url] once a session
# recording has finished transcoding, 404 otherwise.
STREAMING_API = "https://stars.library.ucf.edu/do/api/streaming/path?article_uri="
# Query keys that address a STARS attachment; everything else on the caption
# track url is redirect bookkeeping that breaks the request.
CAPTION_QUERY_KEYS = {"filename", "article", "context", "type"}
OUTPUT = Path(__file__).resolve().parent.parent / "data" / "events.json"
EASTERN = ZoneInfo("America/New_York")
# Day-of program changes not reflected in STARS, applied on top of every
# sync: event url -> replacement fields.
OVERRIDES = {
    # 2026-07-16: Saum-Pascual & Ortega-Guzman moved into the concurrent
    # two-paper Hypertexts & Fictions session to balance the panels.
    "https://stars.library.ucf.edu/elo2026/narrativesandworlds/schedule/7": {
        "track": "Hypertexts & Fictions",
    },
}
USER_AGENT = "ELO2026-schedule-sync (github.com/AMSUCF/ELO2026)"
MIN_EVENTS = 50


def _to_utc_iso(stamp):
    dt = datetime.strptime(stamp, "%Y-%m-%dT%H%M%S").replace(tzinfo=EASTERN)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _clean(fragment):
    text = re.sub(r"<[^>]+>", " ", fragment)
    text = unescape(text)
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s+,", ",", text)
    return text.strip().rstrip(",")


def _abbr_stamp(block, cls):
    for tag in re.findall(r"<abbr[^>]+>", block):
        if f'class="{cls}"' in tag:
            m = re.search(r'title="([^"]+)"', tag)
            if m:
                return m.group(1)
    return None


def _field(block, cls):
    m = re.search(rf'<p class="{cls}">(.*?)</p>', block, re.S)
    return _clean(m.group(1)) if m else ""


def parse_schedule(html):
    events = []
    seen = set()
    for chunk in re.split(r'<tr[^>]*class="vevent[^"]*"[^>]*>', html)[1:]:
        block = chunk.split("</tr>")[0]
        summary = re.search(r'<p class="summary"><a href="([^"]+)"\s*>(.*?)</a>', block, re.S)
        start = _abbr_stamp(block, "dtstart")
        if not summary or not start:
            continue
        url = summary.group(1).strip()
        if url in seen:
            continue
        seen.add(url)
        end = _abbr_stamp(block, "dtend") or start
        events.append({
            "title": _clean(summary.group(2)),
            "url": url,
            "presenters": _field(block, "presenters"),
            "track": _field(block, "location"),
            "type": _field(block, "document_type"),
            "start": _to_utc_iso(start),
            "end": _to_utc_iso(end),
        })
    return events


def parse_rss_links(xml):
    return set(re.findall(r"<item>.*?<link>\s*(\S+?)\s*</link>", xml, re.S))


def load_previous_field(path, field):
    """Map event url -> field value from the last sync, so a transient API
    failure never drops something that was already published."""
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {
        ev["url"]: ev[field]
        for ev in payload.get("events", [])
        if ev.get("url") and ev.get(field)
    }


def load_previous_videos(path):
    return load_previous_field(path, "video")


def _normalize_caption_url(url):
    """STARS renders the track url with sc_redirect/nold appended, and those
    parameters make viewcontent.cgi return a 500. Keep only the selectors
    that actually address the file."""
    parts = urllib.parse.urlsplit(url)
    kept = [
        (k, v)
        for k, v in urllib.parse.parse_qsl(parts.query)
        if k in CAPTION_QUERY_KEYS
    ]
    if not kept:
        return None
    return urllib.parse.urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urllib.parse.urlencode(kept), "")
    )


def extract_caption_url(html):
    """Pull the caption file out of the JW Player setup on a STARS article
    page, which bepress renders inline as tracks: [{file, kind: "captions"}]."""
    block = re.search(r"tracks:\s*\[(.*?)\]", html, re.S)
    if not block or '"captions"' not in block.group(1):
        return None
    file_match = re.search(r'file:\s*"([^"]+)"', block.group(1))
    if not file_match:
        return None
    return _normalize_caption_url(unescape(file_match.group(1)))


def check_captions(events, videos, previous, fetcher):
    """Map event url -> caption file url for recorded sessions whose STARS
    page advertises a captions track. Only recorded sessions are checked,
    since a caption track without a recording has nothing to caption."""
    captions = {}
    for ev in events:
        url = ev["url"]
        if url not in videos:
            continue
        try:
            found = extract_caption_url(fetcher(url.rstrip("/") + "/"))
        except (OSError, ValueError):
            found = None
        if found:
            captions[url] = found
        elif url in previous:
            captions[url] = previous[url]
    return captions


def check_videos(events, previous, fetcher):
    """Return url -> m3u8 video url for every event whose recording is live
    on STARS. `fetcher` gets the streaming-API url and returns the response
    body, raising urllib.error.HTTPError (404 = no recording yet) on failure."""
    videos = {}
    for ev in events:
        url = ev["url"]
        try:
            body = fetcher(STREAMING_API + urllib.parse.quote(url, safe=""))
            playlist = json.loads(body)
            if playlist and isinstance(playlist, list) and playlist[0].startswith("https://"):
                videos[url] = playlist[0]
        except urllib.error.HTTPError as err:
            if err.code != 404 and url in previous:
                videos[url] = previous[url]
        except (OSError, ValueError):
            if url in previous:
                videos[url] = previous[url]
    return videos


def build_payload(events, rss_links, generated, videos=None, captions=None):
    videos = videos or {}
    captions = captions or {}
    events = [{**ev, **OVERRIDES.get(ev["url"], {})} for ev in events]
    out = []
    for ev in sorted(events, key=lambda e: (e["start"], e["title"])):
        entry = {**ev, "featured": ev["url"] in rss_links}
        if ev["url"] in videos:
            entry["video"] = videos[ev["url"]]
        if ev["url"] in captions:
            entry["captions"] = captions[ev["url"]]
        out.append(entry)
    return {"generated": generated, "source": SCHEDULE_URL, "events": out}


def validate(payload):
    errors = []
    events = payload.get("events", [])
    if len(events) < MIN_EVENTS:
        errors.append(f"only {len(events)} events parsed; expected at least {MIN_EVENTS}")
    for ev in events:
        if not ev.get("title") or not ev.get("url"):
            errors.append(f"event missing title/url: {ev.get('url') or ev.get('title') or '?'}")
        if not re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$", ev.get("start", "")):
            errors.append(f"bad start time: {ev.get('title')}")
        if not re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$", ev.get("end", "")):
            errors.append(f"bad end time: {ev.get('title')}")
        if ev.get("start", "") > ev.get("end", ""):
            errors.append(f"start after end: {ev.get('title')}")
        if "video" in ev and not str(ev["video"]).startswith("https://"):
            errors.append(f"bad video url: {ev.get('title')}")
        if "captions" in ev:
            if not str(ev["captions"]).startswith("https://"):
                errors.append(f"bad captions url: {ev.get('title')}")
            if "video" not in ev:
                errors.append(f"captions without a recording: {ev.get('title')}")
    if not any(ev.get("featured") for ev in events):
        errors.append("no featured events matched the RSS feed")
    return errors


def _fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8")


def main():
    events = parse_schedule(_fetch(SCHEDULE_URL))
    rss_links = parse_rss_links(_fetch(RSS_URL))
    videos = check_videos(events, load_previous_field(OUTPUT, "video"), _fetch)
    captions = check_captions(
        events, videos, load_previous_field(OUTPUT, "captions"), _fetch
    )
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = build_payload(events, rss_links, generated, videos, captions)
    errors = validate(payload)
    if errors:
        for err in errors:
            print(f"ERROR: {err}", file=sys.stderr)
        return 1
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {len(payload['events'])} events "
        f"({len(videos)} with recordings, {len(captions)} with captions) to {OUTPUT}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
