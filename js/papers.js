// Individual-papers browser on the proceedings page.
// Loads the STARS-scraped schedule (data/events.json), keeps the events that
// have a paper PDF attached, and lists them alphabetically. The PDFs live on
// STARS and open in a new window, the same way STARS itself serves them.

import { papersFrom } from "./papers-core.js";

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);

const list = document.getElementById("paper-list");
const count = document.getElementById("paper-count");

function render(papers) {
  if (!papers.length) {
    showFallback();
    return;
  }
  count.textContent =
    `${papers.length} paper${papers.length === 1 ? "" : "s"}, A–Z by title. ` +
    "Each PDF opens in a new window.";
  list.innerHTML = papers
    .map(
      (ev) => `
      <li class="paper-item">
        <p class="paper-title">
          <a href="${esc(ev.paper)}" target="_blank" rel="noopener">${esc(ev.title)}<span class="visually-hidden"> (PDF, opens in a new window)</span></a>
        </p>
        ${ev.presenters ? `<p class="paper-meta">${esc(ev.presenters)}</p>` : ""}
        <p class="paper-links">
          <a href="${esc(ev.url)}" target="_blank" rel="noopener">Abstract &amp; session details on STARS<span class="visually-hidden"> for ${esc(ev.title)} (opens in a new window)</span></a>
        </p>
      </li>`
    )
    .join("");
}

function showFallback() {
  count.textContent = "";
  list.innerHTML = `
    <li class="status-message">The paper list couldn't be loaded right now.
    Browse the individual papers in the
    <a href="https://stars.library.ucf.edu/elo2026/" target="_blank" rel="noopener">conference repository on STARS</a>.</li>`;
}

fetch("data/events.json")
  .then((resp) => {
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  })
  .then((payload) => render(papersFrom(payload.events)))
  .catch(showFallback);
