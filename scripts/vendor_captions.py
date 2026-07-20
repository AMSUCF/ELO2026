"""Unpack STARS caption files into captions/*.vtt.

bepress will not serve caption files to automation: curl-style requests get
202-empty or 410, and cross-origin browser requests get 503. Only a real
browser session on a stars.library.ucf.edu page can fetch them, so the
captions are collected in the browser and handed over as a single JSON
bundle -- {article_id: subrip_text} -- which this script converts to WebVTT
and writes into the repo.

To refresh captions after new recordings are published:

 1. python scripts/fetch_schedule.py        # pick up newly published captions
 2. python scripts/vendor_captions.py --snippet > snippet.js
 3. Open any https://stars.library.ucf.edu/elo2026/... page, paste the snippet
    into the console, and wait for it to download elo2026-captions.json.
 4. python scripts/vendor_captions.py ~/Downloads/elo2026-captions.json
 5. python scripts/fetch_schedule.py        # record the new captions_file paths

The snippet paces itself and retries: bepress starts answering 403 at roughly
ten requests per second, and those same ids succeed when asked more slowly.
Push it further and bepress stops answering altogether, holding connections
open rather than refusing them, so each request carries its own timeout and
the run gives up after three stalls. Every step is resumable -- a partial
bundle is fine, and re-running --snippet asks only for what is still missing.

Usage:
    python scripts/vendor_captions.py ~/Downloads/elo2026-captions.json
    python scripts/vendor_captions.py --ids
    python scripts/vendor_captions.py --snippet
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


BROWSER_SNIPPET = """// Paste into the console of any https://stars.library.ucf.edu/elo2026/... page.
// Fetches the caption files listed below and downloads them as one JSON bundle.
(async () => {
  const IDS = %(ids)s;
  const CAPTION = (id) => "https://stars.library.ucf.edu/cgi/viewcontent.cgi?" +
    new URLSearchParams({ filename: "0", article: id, context: "elo2026", type: "additional" });
  const HAS_CUES = /\\d{1,2}:\\d{2}:\\d{2}[,.]\\d/;
  const TIMEOUT_MS = 20000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Once bepress decides it is being scraped it stops answering and simply
  // holds the connection open, so every request needs its own deadline --
  // without one the whole run stalls silently on the first hung fetch.
  const fetchWithTimeout = async (url) => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      return await fetch(url, { signal: abort.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  const data = {}, failed = [];
  // bepress answers 403 when pushed past roughly ten requests a second, so
  // each pass slows down and only retries what is still missing.
  for (const [pass, gap] of [[1, 150], [2, 1500], [3, 4000]]) {
    const todo = IDS.filter((id) => !data[id]);
    if (!todo.length) break;
    console.log(`[captions] pass ${pass}: ${todo.length} to fetch, ${gap}ms apart`);
    let stalled = 0;
    for (const id of todo) {
      try {
        const r = await fetchWithTimeout(CAPTION(id));
        if (!r.ok) throw new Error("HTTP " + r.status);
        const text = await r.text();
        if (!HAS_CUES.test(text)) throw new Error("not a caption file");
        data[id] = text;
        stalled = 0;
      } catch (err) {
        const why = err.name === "AbortError" ? "timed out" : err.message;
        if (pass === 3) failed.push(id + ": " + why);
        // A run of timeouts means bepress has stopped answering entirely;
        // pushing on just burns time. Save what we have and come back later.
        if (err.name === "AbortError" && ++stalled >= 3) {
          console.warn("[captions] STARS stopped responding — stopping early with " +
                       Object.keys(data).length + " files. Re-run later for the rest.");
          break;
        }
      }
      console.log(`[captions] ${Object.keys(data).length}/${IDS.length}`);
      await sleep(gap);
    }
    if (stalled >= 3) break;
  }

  const got = Object.keys(data).length;
  console.log(`[captions] fetched ${got}/${IDS.length}`);
  if (failed.length) console.warn("[captions] still failing:", failed);
  if (!got) return "nothing to download";

  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
  a.download = "elo2026-captions.json";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
  return `downloading ${got} caption files`;
})();
"""


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
    if argv and argv[0] == "--snippet":
        missing = missing_ids()
        if not missing:
            print("// Every captioned session is already vendored — nothing to fetch.")
            return 0
        print(BROWSER_SNIPPET % {"ids": json.dumps(missing)})
        return 0
    if not argv or argv[0] == "--ids":
        missing = missing_ids()
        print(f"{len(wanted_ids())} captioned sessions, {len(missing)} not yet vendored")
        if missing:
            print(",".join(missing))
        return 0
    return unpack(argv[0])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
