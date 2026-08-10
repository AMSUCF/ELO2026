// Pure helpers for addressing individual recordings.

// A recording's permalink has to survive re-syncs, so it is derived from the
// STARS collection + item number rather than from the title or list position:
// https://stars.library.ucf.edu/elo2026/narrativesandworlds/schedule/7
//   -> rec-narrativesandworlds-7
export function recordingId(url) {
  const parts = String(url)
    .split("?")[0]
    .split("#")[0]
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean);
  const idx = parts.indexOf("elo2026");
  const tail = (idx === -1 ? parts.slice(-3) : parts.slice(idx + 1))
    .filter((part) => part !== "schedule" && part !== "all")
    .map((part) => part.toLowerCase().replace(/[^a-z0-9]+/g, "-"))
    .filter(Boolean);
  return tail.length ? `rec-${tail.join("-")}` : "rec-unknown";
}

// Absolute, shareable URL for one recording. Any existing query string is
// dropped so a copied link stays clean when pasted into social media.
export function shareUrl(id, location) {
  return `${location.origin}${location.pathname}#${id}`;
}

// Where a recording's captions stand, which the player renders three ways:
//   "local" — vendored into captions/, played as a same-origin <track>
//   "stars" — STARS has them but they are not vendored yet, so link out
//             (bepress refuses cross-origin requests for the file itself)
//   "soon"  — STARS has not published captions for this session yet
export function captionState(ev) {
  if (ev.captions_file) return "local";
  if (ev.captions) return "stars";
  return "soon";
}
