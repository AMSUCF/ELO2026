// ELO 2026 "Recordings On Demand" portal.
// Loads the STARS-scraped schedule (data/events.json), keeps the events that
// have a recording, and lets visitors browse them as playlists by track,
// session type, or auto-tagged topic. Playback reuses the HLS pattern from the
// schedule page (native HLS on Safari, hls.js elsewhere).

const HLS_JS_SRC = "https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js";

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);

// Topic tags are derived from session titles (the schedule feed carries no
// abstracts). Each entry: [label, matcher]. A recording can carry several tags.
const TAG_MAP = [
  ["AI & Machine Learning", /\b(a\.?i\.?|artificial intelligence|machine learning|neural|llm|gpt|chatbot|deep learning|generat(e|ive|ing)|prompt)\b/i],
  ["Poetry & Poetics", /\b(poem|poems|poetry|poetic|poetics|poet|e-?poetry|verse|lyric)\b/i],
  ["Games & Play", /\b(game|games|gaming|gameplay|playable|arcade|rpg|playful)\b/i],
  ["Hypertext & IF", /\b(hypertext|interactive fiction|twine|branching|choose your|link(ed|ing)?)\b/i],
  ["Code & Computation", /\b(cod(e|es|ing)|program(ming|s)?|software|algorithm(ic|s)?|computation(al)?|script(ing)?)\b/i],
  ["Archives & Memory", /\b(archiv(e|es|al|ing)|preservation|preserv|memory|database|repositor|collection)\b/i],
  ["Sound & Voice", /\b(sound|audio|music|sonic|voice|listen|song|noise)\b/i],
  ["Bots & Generators", /\b(bot|bots|generator|generative|procedural)\b/i],
  ["AR / VR & Immersive", /\b(vr|ar|xr|virtual reality|augmented|immersive|360|mixed reality)\b/i],
  ["Networks & Platforms", /\b(instagram|tiktok|twitter|social media|platform|network|internet|online|web)\b/i],
  ["Teaching & Learning", /\b(teach(ing)?|pedagog|classroom|student|learning|educat|curricul|workshop)\b/i],
  ["Feminist & Critical", /\b(feminist|queer|decolonial|critical|gender|race|justice|activis|ethic)\b/i],
  ["Language & Translation", /\b(translat|multilingual|language|linguistic|word|text(ual)?)\b/i],
  ["Image & Cinema", /\b(image|images|visual|glitch|cinema|film|video art|photo)\b/i],
  ["Body & Ecology", /\b(bod(y|ies)|embodi|ecolog|environment|climate|nature|plant|more-than-human)\b/i],
];

function tagsFor(ev) {
  const t = ev.title || "";
  const out = [];
  for (const [label, re] of TAG_MAP) if (re.test(t)) out.push(label);
  return out;
}

const state = {
  all: [],          // recordings (events with video), chronological
  dim: "track",     // "track" | "type" | "tag"
  filter: null,     // selected playlist value, or null = all
  query: "",        // search string
  list: [],         // current filtered/ordered list
  playing: null,    // event object currently loaded
};

const el = {};

/* ---------- HLS loader (once) ---------- */
let hlsLoader = null;
function loadHlsJs() {
  if (!hlsLoader) {
    hlsLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = HLS_JS_SRC;
      script.onload = () => resolve(window.Hls);
      script.onerror = () => reject(new Error("hls.js failed to load"));
      document.head.appendChild(script);
    });
  }
  return hlsLoader;
}

/* ---------- values + counts for the active dimension ---------- */
function valuesFor(dim) {
  const counts = new Map();
  for (const ev of state.all) {
    const vals = dim === "tag" ? ev._tags : [ev[dim]].filter(Boolean);
    for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
  }
  const arr = [...counts.entries()].map(([value, n]) => ({ value, n }));
  // tags: most-used first; track/type: alphabetical
  if (dim === "tag") arr.sort((a, b) => b.n - a.n || a.value.localeCompare(b.value));
  else arr.sort((a, b) => a.value.localeCompare(b.value));
  return arr;
}

function matchesFilter(ev) {
  if (!state.filter) return true;
  if (state.dim === "tag") return ev._tags.includes(state.filter);
  return ev[state.dim] === state.filter;
}
function matchesQuery(ev) {
  if (!state.query) return true;
  const q = state.query.toLowerCase();
  return (ev.title || "").toLowerCase().includes(q) ||
         (ev.presenters || "").toLowerCase().includes(q);
}

/* ---------- rendering ---------- */
function renderChips() {
  const values = valuesFor(state.dim);
  const total = state.all.length;
  const chip = (label, value, n, pressed) =>
    `<button type="button" class="rec-chip" data-value="${value === null ? "" : esc(value)}"
             aria-pressed="${pressed}">${esc(label)}<span class="chip-n">${n}</span></button>`;
  el.chips.innerHTML =
    chip("All", null, total, state.filter === null) +
    values.map((v) => chip(v.value, v.value, v.n, state.filter === v.value)).join("");
}

function badgesHtml(ev) {
  const tagBadges = ev._tags.slice(0, 3).map((t) => `<span class="badge-tag">${esc(t)}</span>`).join("");
  return `<div class="rec-badges">
      <span class="badge-track">${esc(ev.track || "")}</span>
      <span class="badge-type">${esc(ev.type || "")}</span>
      ${tagBadges}
    </div>`;
}

function renderList() {
  state.list = state.all.filter((ev) => matchesFilter(ev) && matchesQuery(ev));
  el.count.textContent = `${state.list.length} recording${state.list.length === 1 ? "" : "s"}` +
    (state.filter ? ` in “${state.filter}”` : "") + (state.query ? ` matching “${state.query}”` : "");

  if (!state.list.length) {
    el.list.innerHTML = `<li class="rec-empty">No recordings match. Try another playlist or search.</li>`;
  } else {
    el.list.innerHTML = state.list.map((ev, i) => {
      const active = ev === state.playing;
      return `<li>
        <button type="button" class="rec-item" data-idx="${i}" aria-current="${active ? "true" : "false"}">
          <span class="rec-idx">${String(i + 1).padStart(2, "0")}</span>
          <span>
            <span class="rec-t">${esc(ev.title)}</span>
            ${ev.presenters ? `<span class="rec-p">${esc(ev.presenters)}</span>` : ""}
            ${badgesHtml(ev)}
          </span>
        </button></li>`;
    }).join("");
  }
  updateTransport();
}

function renderNowMeta(ev) {
  el.nowMeta.innerHTML = `
    <h2 class="now-title">${esc(ev.title)}</h2>
    ${ev.presenters ? `<p class="now-presenters">${esc(ev.presenters)}</p>` : ""}
    ${badgesHtml(ev)}`;
}

function currentIndex() {
  return state.playing ? state.list.indexOf(state.playing) : -1;
}
function updateTransport() {
  const i = currentIndex();
  el.prev.disabled = !(i > 0);
  el.next.disabled = !(i >= 0 && i < state.list.length - 1);
  el.position.textContent = i >= 0 ? `${i + 1} / ${state.list.length}` : "";
  el.list.querySelectorAll(".rec-item").forEach((b) => {
    b.setAttribute("aria-current", state.list[+b.dataset.idx] === state.playing ? "true" : "false");
  });
}

/* ---------- playback ---------- */
function fallback(holder, src) {
  holder.innerHTML = `<p class="crt-idle">This recording can&rsquo;t play here —
    <a href="${esc(src)}" target="_blank" rel="noopener" style="color:var(--cyan)">open the stream</a>.</p>`;
}

async function play(ev) {
  if (!ev || !ev.video) return;
  state.playing = ev;
  renderNowMeta(ev);

  const holder = el.videoHolder;
  holder.innerHTML = "";
  const video = document.createElement("video");
  video.controls = true;
  video.autoplay = true;
  video.playsInline = true;
  video.className = "recording-player";
  video.setAttribute("aria-label", `Recording: ${ev.title}`);
  holder.appendChild(video);

  const src = ev.video;
  try {
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
    } else {
      const Hls = await loadHlsJs();
      if (Hls && Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(src);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal) fallback(holder, src); });
      } else {
        video.src = src; // last-ditch
      }
    }
  } catch {
    fallback(holder, src);
  }

  video.addEventListener("ended", () => {
    if (!el.autoplay.checked) return;
    const i = currentIndex();
    if (i >= 0 && i + 1 < state.list.length) play(state.list[i + 1]);
  });

  updateTransport();
  const activeBtn = el.list.querySelector(`.rec-item[aria-current="true"]`);
  if (activeBtn) activeBtn.scrollIntoView({ block: "nearest" });
}

function step(delta) {
  const i = currentIndex();
  if (i < 0) { if (state.list.length) play(state.list[0]); return; }
  const j = i + delta;
  if (j >= 0 && j < state.list.length) play(state.list[j]);
}

/* ---------- wiring ---------- */
function setDim(dim) {
  state.dim = dim;
  state.filter = null;
  el.tabs.querySelectorAll(".rec-tab").forEach((t) =>
    t.setAttribute("aria-selected", t.dataset.dim === dim ? "true" : "false"));
  renderChips();
  renderList();
}

function init(payload) {
  const recs = (payload.events || [])
    .filter((e) => e.video)
    .map((e) => ({ ...e, _tags: tagsFor(e) }))
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  state.all = recs;

  el.tabs = document.getElementById("rec-tabs");
  el.chips = document.getElementById("rec-chips");
  el.count = document.getElementById("rec-count");
  el.list = document.getElementById("rec-list");
  el.nowMeta = document.getElementById("now-meta");
  el.videoHolder = document.getElementById("video-holder");
  el.position = document.getElementById("rec-position");
  el.prev = document.getElementById("rec-prev");
  el.next = document.getElementById("rec-next");
  el.autoplay = document.getElementById("rec-autoplay");
  const search = document.getElementById("rec-search");

  el.tabs.addEventListener("click", (e) => {
    const tab = e.target.closest(".rec-tab");
    if (tab) setDim(tab.dataset.dim);
  });
  el.chips.addEventListener("click", (e) => {
    const chip = e.target.closest(".rec-chip");
    if (!chip) return;
    const value = chip.dataset.value || null;
    state.filter = state.filter === value ? null : value;
    renderChips();
    renderList();
  });
  el.list.addEventListener("click", (e) => {
    const item = e.target.closest(".rec-item");
    if (item) play(state.list[+item.dataset.idx]);
  });
  el.prev.addEventListener("click", () => step(-1));
  el.next.addEventListener("click", () => step(1));
  let t;
  search.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => { state.query = search.value.trim(); renderList(); }, 150);
  });

  setDim("track");
}

fetch("data/events.json")
  .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then(init)
  .catch(() => {
    const list = document.getElementById("rec-list");
    if (list) {
      list.innerHTML = `<li class="rec-empty">Recordings couldn&rsquo;t load right now —
        <a href="https://stars.library.ucf.edu/elo2026/" target="_blank" rel="noopener" style="color:var(--cyan)">browse them on STARS</a>.</li>`;
    }
  });
