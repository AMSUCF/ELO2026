"""Unpack STARS caption files into captions/*.vtt.

bepress will not serve caption files to automation: curl-style requests get
202-empty or 410, and cross-origin browser requests get 503. Only a real
browser session on a stars.library.ucf.edu page can fetch them, so the
captions are collected in the browser and handed over as a single JSON
bundle -- {article_id: subrip_text} -- which this script converts to WebVTT
and writes into the repo.

To refresh captions after new recordings are published:

 1. Run `python scripts/fetch_schedule.py` so data/events.json lists the new
    caption urls, then `python scripts/vendor_captions.py --ids` to print the
    article ids still missing from captions/.
 2. Open any https://stars.library.ucf.edu/elo2026/... page and, in the
    console, fetch each id from
    https://stars.library.ucf.edu/cgi/viewcontent.cgi?filename=0&article=<ID>&context=elo2026&type=additional
    into an object keyed by id, then download it as JSON. Space the requests
    out -- bepress starts answering 403 at roughly ten per second.
 3. `python scripts/vendor_captions.py <bundle.json>`

Usage:
    python scripts/vendor_captions.py ~/Downloads/elo2026-captions.json
    python scripts/vendor_captions.py --ids
"""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.captions import looks_like_captions, srt_to_vtt  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
EVENTS = ROOT / "data" / "events.json"
CAPTION_DIR = ROOT / "captions"


def article_id(caption_url):
    match = re.search(r"[?&]article=(\d+)", caption_url or "")
    return match.group(1) if match else None


def wanted_ids():
    """Article ids that data/events.json says have captions."""
    payload = json.loads(EVENTS.read_text(encoding="utf-8"))
    ids = {article_id(ev.get("captions")) for ev in payload.get("events", [])}
    return sorted((i for i in ids if i), key=int)


def missing_ids():
    return [i for i in wanted_ids() if not (CAPTION_DIR / f"{i}.vtt").exists()]


def unpack(bundle_path):
    bundle = json.loads(Path(bundle_path).read_text(encoding="utf-8"))
    expected = set(wanted_ids())

    CAPTION_DIR.mkdir(parents=True, exist_ok=True)
    written, skipped, unexpected = 0, [], []
    for key, raw in bundle.items():
        article = article_id(f"article={key}") or str(key)
        if article not in expected:
            unexpected.append(article)
            continue
        if not looks_like_captions(raw):
            skipped.append(article)
            continue
        # newline="" keeps the LF endings srt_to_vtt produced; the platform
        # default would rewrite them to CRLF on Windows.
        (CAPTION_DIR / f"{article}.vtt").write_text(
            srt_to_vtt(raw), encoding="utf-8", newline=""
        )
        written += 1

    print(f"wrote {written} caption files to {CAPTION_DIR.relative_to(ROOT)}/")
    if skipped:
        print(f"skipped {len(skipped)} entries that were not caption files: {skipped}")
    if unexpected:
        print(f"ignored {len(unexpected)} ids not referenced by events.json: {unexpected}")
    still = missing_ids()
    if still:
        print(f"still missing {len(still)}: {still}")
    return 0 if written and not still else 1


def main(argv):
    if not argv or argv[0] == "--ids":
        missing = missing_ids()
        print(f"{len(wanted_ids())} captioned sessions, {len(missing)} not yet vendored")
        if missing:
            print(",".join(missing))
        return 0
    return unpack(argv[0])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
