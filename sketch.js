// Static-electricity backdrop for the landing page.
//
// This runs on every visitor's machine behind the page content, so the work
// per frame is deliberately bounded rather than proportional to the window:
//   * particle count scales with viewport area but is hard-capped
//   * neighbour search uses a spatial grid, not an all-pairs sweep
//   * the number of lightning bolts drawn per frame is capped
//   * pixel density is pinned to 1 (this is decoration, not detail work)
// A 4K window with an uncapped all-pairs sweep was drawing tens of thousands
// of line() calls per frame, which is enough to lock up a browser tab.

const CONNECT_RADIUS = 120;
const CONNECT_RADIUS_SQ = CONNECT_RADIUS * CONNECT_RADIUS;
const MOUSE_RADIUS = 180;
const MOUSE_RADIUS_SQ = MOUSE_RADIUS * MOUSE_RADIUS;
const MAX_BOLTS_PER_FRAME = 42;
const MAX_MOUSE_BOLTS = 8;
const AREA_PER_PARTICLE = 34000;
const MIN_PARTICLES = 18;
const MAX_PARTICLES = 55;
const TARGET_FPS = 30;

// Palette from the ELO logo, kept as plain RGB so that per-draw alpha changes
// never mutate a shared p5.Color the way random(colors) + setAlpha() did.
const PALETTE = [
  [255, 105, 180], // pink
  [91, 111, 168],  // purple-blue
  [255, 140, 66],  // orange
  [77, 213, 232],  // cyan
  [76, 175, 80],   // green
];

let particles = [];
let grid = null;
let reducedMotion = false;
let resizeTimer = null;

function particleTarget() {
  const wanted = Math.round((width * height) / AREA_PER_PARTICLE);
  return Math.max(MIN_PARTICLES, Math.min(MAX_PARTICLES, wanted));
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("canvas-container");
  pixelDensity(1);
  frameRate(TARGET_FPS);

  grid = new SpatialGrid(CONNECT_RADIUS);
  syncParticleCount();

  reducedMotion = prefersReducedMotion();
  if (reducedMotion) {
    redraw();
    noLoop();
  }

  // A background tab still burns CPU on some browsers; stop entirely instead.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || reducedMotion) noLoop();
    else loop();
  });

  window.matchMedia?.("(prefers-reduced-motion: reduce)").addEventListener?.(
    "change",
    (evt) => {
      reducedMotion = evt.matches;
      if (reducedMotion) { redraw(); noLoop(); } else loop();
    }
  );
}

function syncParticleCount() {
  const target = particleTarget();
  while (particles.length > target) particles.pop();
  while (particles.length < target) particles.push(new Particle());
}

function draw() {
  background(0, 0, 0, 25);

  for (const particle of particles) {
    particle.update();
    particle.display();
  }

  grid.rebuild(particles);
  drawConnections();
  drawMouseConnections();
}

// Only particles sharing or adjoining a grid cell can be within
// CONNECT_RADIUS, so this visits a bounded neighbourhood per particle
// instead of every other particle.
function drawConnections() {
  let bolts = 0;
  for (let i = 0; i < particles.length && bolts < MAX_BOLTS_PER_FRAME; i++) {
    const a = particles[i];
    for (const b of grid.neighbours(a)) {
      // Each pair is visited twice; draw it once.
      if (b.id <= a.id) continue;
      const dx = a.pos.x - b.pos.x;
      const dy = a.pos.y - b.pos.y;
      const dSq = dx * dx + dy * dy;
      if (dSq >= CONNECT_RADIUS_SQ) continue;

      const alpha = map(Math.sqrt(dSq), 0, CONNECT_RADIUS, 150, 0);
      drawLightning(a.pos.x, a.pos.y, b.pos.x, b.pos.y, alpha);
      if (++bolts >= MAX_BOLTS_PER_FRAME) break;
    }
  }
}

function drawMouseConnections() {
  // mouseX/mouseY sit at (0, 0) until the pointer enters the page; skip the
  // effect entirely rather than firing bolts at the corner.
  if (!mouseHasMoved()) return;

  let bolts = 0;
  for (const particle of particles) {
    const dx = particle.pos.x - mouseX;
    const dy = particle.pos.y - mouseY;
    const dSq = dx * dx + dy * dy;
    if (dSq >= MOUSE_RADIUS_SQ) continue;

    if (bolts < MAX_MOUSE_BOLTS) {
      const alpha = map(Math.sqrt(dSq), 0, MOUSE_RADIUS, 220, 0);
      drawLightning(particle.pos.x, particle.pos.y, mouseX, mouseY, alpha);
      bolts++;
    }

    const dist = Math.sqrt(dSq) || 1;
    particle.applyForce(createVector((dx / dist) * 0.3, (dy / dist) * 0.3));
  }
}

function mouseHasMoved() {
  return mouseX !== 0 || mouseY !== 0 || pmouseX !== 0 || pmouseY !== 0;
}

function drawLightning(x1, y1, x2, y2, alpha) {
  const segments = 4;
  const angle = Math.atan2(y2 - y1, x2 - x1) + HALF_PI;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  const points = [{ x: x1, y: y1 }];
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const offset = random(-12, 12);
    points.push({
      x: lerp(x1, x2, t) + cosA * offset,
      y: lerp(y1, y2, t) + sinA * offset,
    });
  }
  points.push({ x: x2, y: y2 });

  const rgb = PALETTE[(Math.random() * PALETTE.length) | 0];

  stroke(0, 0, 0, alpha * 0.8);
  strokeWeight(5);
  strokePath(points);

  stroke(rgb[0], rgb[1], rgb[2], alpha);
  strokeWeight(3);
  strokePath(points);
}

function strokePath(points) {
  noFill();
  beginShape();
  for (const p of points) vertex(p.x, p.y);
  endShape();
}

// Mobile browsers fire resize on every address-bar nudge; rebuilding the
// canvas that often is expensive, so coalesce the bursts.
function windowResized() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeCanvas(windowWidth, windowHeight);
    grid = new SpatialGrid(CONNECT_RADIUS);
    syncParticleCount();
    if (reducedMotion) redraw();
  }, 200);
}

// Uniform grid keyed by cell coordinate, rebuilt each frame.
class SpatialGrid {
  constructor(cellSize) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }

  rebuild(items) {
    this.cells.clear();
    for (const item of items) {
      const key = this.key(item.pos.x, item.pos.y);
      let bucket = this.cells.get(key);
      if (!bucket) this.cells.set(key, (bucket = []));
      bucket.push(item);
    }
  }

  key(x, y) {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    return `${cx},${cy}`;
  }

  *neighbours(item) {
    const cx = Math.floor(item.pos.x / this.cellSize);
    const cy = Math.floor(item.pos.y / this.cellSize);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const bucket = this.cells.get(`${cx + ox},${cy + oy}`);
        if (bucket) yield* bucket;
      }
    }
  }
}

let nextParticleId = 0;

class Particle {
  constructor() {
    this.id = nextParticleId++;
    this.pos = createVector(random(width), random(height));
    this.vel = createVector(random(-0.5, 0.5), random(-0.5, 0.5));
    this.acc = createVector(0, 0);
    this.maxSpeed = 2;
    this.size = random(8, 16);
    this.rgb = PALETTE[(Math.random() * PALETTE.length) | 0];
    this.pulseOffset = random(TWO_PI);
    this.pulseSpeed = random(0.02, 0.05);
    this.rotation = random(TWO_PI);
    this.rotationSpeed = random(-0.02, 0.02);
  }

  update() {
    this.vel.add(this.acc);
    this.vel.limit(this.maxSpeed);
    this.pos.add(this.vel);
    this.acc.mult(0);
    this.rotation += this.rotationSpeed;

    if (this.pos.x < 0) this.pos.x = width;
    if (this.pos.x > width) this.pos.x = 0;
    if (this.pos.y < 0) this.pos.y = height;
    if (this.pos.y > height) this.pos.y = 0;

    // Gentle pull toward centre plus a little jitter, without allocating
    // fresh p5.Vectors for each force every frame.
    const toCenterX = width / 2 - this.pos.x;
    const toCenterY = height / 2 - this.pos.y;
    const len = Math.hypot(toCenterX, toCenterY) || 1;
    this.acc.x += (toCenterX / len) * 0.01 + random(-0.05, 0.05);
    this.acc.y += (toCenterY / len) * 0.01 + random(-0.05, 0.05);
  }

  applyForce(force) {
    this.acc.add(force);
  }

  display() {
    const pulse = Math.sin(frameCount * this.pulseSpeed + this.pulseOffset);
    const glowSize = map(pulse, -1, 1, this.size, this.size * 1.5);
    const [r, g, b] = this.rgb;

    push();
    translate(this.pos.x, this.pos.y);
    rotate(this.rotation);

    noStroke();
    for (let i = 3; i > 0; i--) {
      fill(r, g, b, map(i, 3, 0, 30, 120));
      this.drawTriangle(glowSize * (1 + i * 0.3));
    }

    strokeWeight(2);
    stroke(0, 0, 0, 200);
    fill(r, g, b, 255);
    this.drawTriangle(this.size);

    pop();
  }

  drawTriangle(size) {
    const h = size * 0.866;
    triangle(0, -h * 0.6, -size * 0.5, h * 0.4, size * 0.5, h * 0.4);
  }
}
