// Pure helpers for the proceedings paper list.

// Sort key for a paper title: leading punctuation is ignored so
// "(Un)easily Writing the Future" files under U and
// "\"The First Web Novel at 30\"" files under T.
export function titleSortKey(title) {
  return String(title)
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .toLowerCase();
}

// The events that have an individually published paper attached on STARS,
// alphabetized by title for browsing.
export function papersFrom(events) {
  return (events || [])
    .filter((ev) => ev && ev.paper)
    .sort((a, b) => titleSortKey(a.title).localeCompare(titleSortKey(b.title)));
}
