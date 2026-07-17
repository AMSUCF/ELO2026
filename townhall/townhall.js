/* ============================================================
   ELO 2026 Town Hall — side-scroller controller
   Vanilla JS, no dependencies. Same-origin data only.
   ============================================================ */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var world   = document.getElementById("world");
  var stages  = Array.prototype.slice.call(world.querySelectorAll(".stage"));
  var total   = stages.length;
  var game    = document.getElementById("game");

  // Three "worlds" — a dramatic Land -> Fire -> Water arc that echoes the
  // three-conference ELOrlando trilogy. Each world recolors the whole scene.
  var WORLDS = [
    // Land = the ELO / org intro; Fire = Projects & Partners;
    // Water = the 2026 conference; Beach = the ELO 2027 (Barranquilla) reveal + finale.
    { key: "land",  name: "GRASSLAND",    first: 0,  last: 4 },
    { key: "fire",  name: "VOLCANO",      first: 5,  last: 10 },
    { key: "water", name: "OCEAN",        first: 11, last: 16 },
    { key: "beach", name: "BARRANQUILLA", first: 17, last: total - 1 }
  ];
  var FLASH_TINT = { land: "#bfe6a8", fire: "#ff6a1a", water: "#7fd6ff", beach: "#ff9ec2" };
  function worldOf(stage) {
    for (var i = 0; i < WORLDS.length; i++) if (stage <= WORLDS[i].last) return i;
    return WORLDS.length - 1;
  }
  var clouds  = document.getElementById("clouds");
  var hills   = document.getElementById("hills");
  var worldNum   = document.getElementById("world-num");
  var worldTotal = document.getElementById("world-total");
  var coinCountEl = document.getElementById("coin-count");
  var srStatus   = document.getElementById("sr-status");
  var btnPrev = document.getElementById("btn-prev");
  var btnNext = document.getElementById("btn-next");
  var dotsWrap = document.getElementById("dots");
  var worldFlash  = document.getElementById("world-flash");
  var worldBanner = document.getElementById("world-banner");
  var wbNum  = worldBanner.querySelector(".wb-num");
  var wbName = worldBanner.querySelector(".wb-name");

  var current = 0;
  var coins = 0;
  var visited = {};
  var prevWorld = 0;   // world 1's intro is the title screen itself; banner fires when crossing INTO a new world

  /* ---- build the dot navigation ---- */
  var dotButtons = [];
  stages.forEach(function (stage, i) {
    var li = document.createElement("li");
    var b = document.createElement("button");
    b.type = "button";
    var label = (stage.getAttribute("aria-label") || ("Slide " + (i + 1)));
    b.setAttribute("aria-label", "Go to " + label);
    b.addEventListener("click", function () { goTo(i); });
    li.appendChild(b);
    dotsWrap.appendChild(li);
    dotButtons.push(b);
  });

  /* ---- inert helper (non-current stages are hidden from AT + tab order) ---- */
  function setInert(stage, on) {
    if (on) {
      stage.setAttribute("inert", "");
      stage.setAttribute("aria-hidden", "true");
    } else {
      stage.removeAttribute("inert");
      stage.removeAttribute("aria-hidden");
    }
    // Fallback for browsers without inert: block tabbing to inner controls.
    var focusables = stage.querySelectorAll("a[href], button, [tabindex]");
    Array.prototype.forEach.call(focusables, function (el) {
      if (on) {
        if (!el.hasAttribute("data-ti")) el.setAttribute("data-ti", el.getAttribute("tabindex") || "");
        el.setAttribute("tabindex", "-1");
      } else {
        var prev = el.getAttribute("data-ti");
        if (prev === "" || prev === null) el.removeAttribute("tabindex");
        else el.setAttribute("tabindex", prev);
        el.removeAttribute("data-ti");
      }
    });
  }

  /* ---- parallax + world position ---- */
  function applyPositions() {
    var offset = current * window.innerWidth;
    world.style.transform = "translateX(" + (-current * 100) + "vw)";
    if (clouds) clouds.style.backgroundPositionX = (-offset * 0.18) + "px";
    if (hills)  hills.style.backgroundPositionX  = (-offset * 0.42) + "px";
  }

  /* ---- navigation ---- */
  function goTo(i, opts) {
    i = Math.max(0, Math.min(total - 1, i));
    var moved = (i !== current);
    var forward = (i > current);
    current = i;

    applyPositions();

    // toggle inert/visibility per stage
    stages.forEach(function (stage, idx) { setInert(stage, idx !== current); });

    // World theming + Mario-style HUD ("2-3")
    var w = worldOf(current);
    var worldChanged = (w !== prevWorld);
    game.setAttribute("data-world", WORLDS[w].key);
    worldNum.textContent = String(w + 1);
    worldTotal.textContent = String(current - WORLDS[w].first + 1);
    if (worldChanged) { showWorld(w); prevWorld = w; }

    // HUD + dots
    btnPrev.disabled = (current === 0);
    btnNext.disabled = (current === total - 1);
    dotButtons.forEach(function (b, idx) {
      if (idx === current) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    });

    // coins: one per newly-visited stage
    if (!visited[current]) {
      visited[current] = true;
      coins += 1;
      coinCountEl.textContent = String(coins);
    }

    // hero walks across the "room"; a portal marks each world transition
    var wl = WORLDS[w];
    var gap = wl.last - wl.first;
    var frac = gap > 0 ? (current - wl.first) / gap : 0;
    var heroLeftVw = HERO_START + frac * (HERO_END - HERO_START);
    var atRoomEnd = (current === wl.last) && (w < WORLDS.length - 1);
    updateHeroAndPortal(worldChanged, forward, moved, heroLeftVw, atRoomEnd);

    // announce to screen readers + move focus to the heading
    var label = stages[current].getAttribute("aria-label") || ("Slide " + (current + 1));
    srStatus.textContent = label + ". Slide " + (current + 1) + " of " + total + ".";
    if (opts && opts.focus !== false) {
      var h = stages[current].querySelector("h1, h2");
      if (h) {
        if (!h.hasAttribute("tabindex")) h.setAttribute("tabindex", "-1");
        h.focus({ preventScroll: true });
      }
    }
  }

  function next() { if (current < total - 1) goTo(current + 1); }
  function prev() { if (current > 0) goTo(current - 1); }

  btnNext.addEventListener("click", next);
  btnPrev.addEventListener("click", prev);

  /* ---- keyboard ---- */
  document.addEventListener("keydown", function (e) {
    // don't hijack keys while focus is in a scrollable link list etc.
    var k = e.key;
    if (k === "ArrowRight" || k === "PageDown") { e.preventDefault(); next(); }
    else if (k === "ArrowLeft" || k === "PageUp") { e.preventDefault(); prev(); }
    else if (k === " " || k === "Spacebar") { e.preventDefault(); next(); }
    else if (k === "Home") { e.preventDefault(); goTo(0); }
    else if (k === "End") { e.preventDefault(); goTo(total - 1); }
  });

  /* ---- touch swipe ---- */
  var tx = null, ty = null;
  document.getElementById("game").addEventListener("touchstart", function (e) {
    if (e.touches.length === 1) { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }
  }, { passive: true });
  document.getElementById("game").addEventListener("touchend", function (e) {
    if (tx === null) return;
    var dx = e.changedTouches[0].clientX - tx;
    var dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) { if (dx < 0) next(); else prev(); }
    tx = ty = null;
  }, { passive: true });

  window.addEventListener("resize", applyPositions);

  /* ============================================================
     HERO SPRITE — a pixel "book explorer" with a 2-frame walk
     ============================================================ */
  var canvas = document.getElementById("hero");
  var ctx = canvas.getContext("2d");
  var PX = 6;                        // pixel scale
  var COLS = 14, ROWS = 14;          // sprite grid (12 body rows + 2 feet rows)
  canvas.width = COLS * PX;          // 84
  canvas.height = ROWS * PX;         // 84
  ctx.imageSmoothingEnabled = false;

  // Black-and-white with a red accent, echoing the ELO logo: a black square,
  // two white "elo"-bracket eyes, a small white cursor, and the red underscore.
  var C = {
    ".": null,
    "o": "#0c0c14",   // black outline
    "p": "#15151f",   // black body (ELO-logo black)
    "d": "#e8412a",   // ELO red underscore
    "w": "#ffffff",   // white "elo" glyph / eyes
    "k": "#0c0c14",   // (unused)
    "f": "#3a3a4a"    // dark feet
  };

  // Each row is exactly 14 chars. Rows 0-11 = body (constant);
  // the last two feet rows swap per walk frame.
  var BODY = [
    "...oooooooo...",
    "..oppppppppo..",
    ".oppppppppppo.",
    "oppppppppppppo",
    "oppwwwppwwwppo",
    "oppwkwppwkwppo",
    "oppwwwppwwwppo",
    "oppppppppppppo",
    "oppppddddppppo",
    "oppppppppppppo",
    ".oppppppppppo.",
    "..oooooooooo.."
  ];
  var FEET_A = ["..ffff..ffff..", "..ffff..ffff.."];
  var FEET_B = [".ffff....ffff.", ".ffff....ffff."];

  function drawSprite(feet) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var rows = BODY.concat(feet);
    for (var y = 0; y < rows.length; y++) {
      var row = rows[y];
      for (var x = 0; x < row.length; x++) {
        var col = C[row[x]];
        if (col) {
          ctx.fillStyle = col;
          ctx.fillRect(x * PX, y * PX, PX, PX);
        }
      }
    }
  }

  var walkTimer = null, frame = 0;
  function heroStep(forward, moved) {
    // face direction by flipping the canvas horizontally
    canvas.style.transform = forward ? "scaleX(1)" : "scaleX(-1)";
    if (reduceMotion || !moved) { drawSprite(FEET_A); return; }
    // run the leg animation for the duration of the world scroll
    if (walkTimer) clearInterval(walkTimer);
    var ticks = 0;
    walkTimer = setInterval(function () {
      frame ^= 1;
      // little hop while walking
      canvas.style.marginBottom = (frame ? 6 : 0) + "px";
      drawSprite(frame ? FEET_B : FEET_A);
      if (++ticks > 6) { clearInterval(walkTimer); walkTimer = null; canvas.style.marginBottom = "0"; drawSprite(FEET_A); }
    }, 90);
  }

  // idle bob when not reduced-motion
  if (!reduceMotion) {
    var bobT = 0;
    setInterval(function () {
      if (walkTimer || warping) return;
      bobT = (bobT + 1) % 2;
      canvas.style.marginBottom = (bobT ? 3 : 0) + "px";
    }, 620);
  }
  drawSprite(FEET_A);

  /* ---- hero traversal across each room + portal / door transitions ---- */
  var HERO_START = 12, HERO_END = 72;   // vw: left edge of a room -> the door
  var portal = document.getElementById("portal");
  var warping = false, warpT1 = null, warpT2 = null;

  function updateHeroAndPortal(worldChanged, forward, moved, leftVw, atRoomEnd) {
    if (reduceMotion) {
      canvas.style.transition = "none";
      canvas.style.left = leftVw + "vw";
      portal.className = atRoomEnd ? "door" : "";
      drawSprite(FEET_A);
      return;
    }
    if (worldChanged && moved) {
      // walk into the portal on the right, warp, re-emerge at the new room's start
      warping = true;
      if (warpT1) clearTimeout(warpT1);
      if (warpT2) clearTimeout(warpT2);
      if (walkTimer) { clearInterval(walkTimer); walkTimer = null; }
      portal.className = "active";
      canvas.style.marginBottom = "0";
      canvas.classList.remove("warp-in");
      canvas.classList.add("warp-out");
      warpT1 = setTimeout(function () {
        canvas.classList.remove("warp-out");
        canvas.style.transition = "none";
        canvas.style.left = leftVw + "vw";
        void canvas.offsetWidth;                 // commit the jump before warp-in
        canvas.classList.add("warp-in");
        warpT2 = setTimeout(function () {
          canvas.classList.remove("warp-in");
          canvas.style.transition = "";
          canvas.style.transform = "scaleX(1)";
          portal.className = atRoomEnd ? "door" : "";
          warping = false;
          drawSprite(FEET_A);
        }, 440);
      }, 400);
    } else {
      canvas.style.transition = "left 620ms cubic-bezier(.22,.61,.36,1)";
      canvas.style.left = leftVw + "vw";
      portal.className = atRoomEnd ? "door" : "";
      heroStep(forward, moved);
    }
  }

  /* ---- world-intro banner + flash ---- */
  function showWorld(w) {
    var info = WORLDS[w];
    wbNum.textContent = "WORLD " + (w + 1);
    wbName.textContent = info.name;
    worldBanner.classList.remove("show");
    void worldBanner.offsetWidth;           // force reflow to restart animation
    if (reduceMotion) {
      worldBanner.style.opacity = "1";
      clearTimeout(showWorld._t);
      showWorld._t = setTimeout(function () { worldBanner.style.opacity = "0"; }, 1100);
    } else {
      worldFlash.style.background = FLASH_TINT[info.key] || "#fff";
      worldFlash.classList.remove("show");
      void worldFlash.offsetWidth;
      worldBanner.classList.add("show");
      worldFlash.classList.add("show");
    }
  }

  /* ---- particle FX: embers (fire) + bubbles (water) ---- */
  if (!reduceMotion) {
    var embers = document.getElementById("fx-embers");
    var bubbles = document.getElementById("fx-bubbles");
    var i, s;
    for (i = 0; i < 16; i++) {
      s = document.createElement("span");
      s.className = "ember";
      s.style.left = (Math.random() * 100) + "%";
      var esz = 4 + Math.random() * 6;
      s.style.width = s.style.height = esz.toFixed(1) + "px";
      s.style.animationDuration = (4 + Math.random() * 5).toFixed(2) + "s";
      s.style.animationDelay = (-Math.random() * 8).toFixed(2) + "s";
      s.style.setProperty("--drift", (Math.random() * 60 - 30).toFixed(0) + "px");
      embers.appendChild(s);
    }
    for (i = 0; i < 16; i++) {
      s = document.createElement("span");
      s.className = "bubble";
      s.style.left = (Math.random() * 100) + "%";
      var bsz = 8 + Math.random() * 16;
      s.style.width = s.style.height = bsz.toFixed(1) + "px";
      s.style.animationDuration = (6 + Math.random() * 6).toFixed(2) + "s";
      s.style.animationDelay = (-Math.random() * 10).toFixed(2) + "s";
      s.style.setProperty("--drift", (Math.random() * 50 - 25).toFixed(0) + "px");
      bubbles.appendChild(s);
    }
  }

  /* ---- boot ---- */
  goTo(0, { focus: false });

})();
