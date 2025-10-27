// Static electricity particles
let particles = [];
let numParticles = 100;

// Color palette - vibrant colors from ELO logo
let colors = [];

function setup() {
    let canvas = createCanvas(windowWidth, windowHeight);
    canvas.parent('canvas-container');

    // Initialize color palette matching logo
    colors = [
        color(255, 105, 180, 150),  // Pink/Magenta
        color(91, 111, 168, 150),   // Purple/Blue
        color(255, 140, 66, 150),   // Orange
        color(77, 213, 232, 150),   // Cyan/Light Blue
        color(76, 175, 80, 150),    // Green
    ];

    // Create particles
    for (let i = 0; i < numParticles; i++) {
        particles.push(new Particle());
    }
}

function draw() {
    // Fade background for trail effect
    background(0, 0, 0, 25);

    // Update and display particles
    for (let particle of particles) {
        particle.update();
        particle.display();
    }

    // Draw connections between nearby particles
    drawConnections();

    // Draw connections to mouse
    drawMouseConnections();
}

function drawConnections() {
    for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
            let d = dist(
                particles[i].pos.x, particles[i].pos.y,
                particles[j].pos.x, particles[j].pos.y
            );

            // If particles are close enough, draw connection
            if (d < 120) {
                let alpha = map(d, 0, 120, 150, 0);
                // Draw cartoony lightning-like line
                drawLightning(
                    particles[i].pos.x, particles[i].pos.y,
                    particles[j].pos.x, particles[j].pos.y,
                    alpha
                );
            }
        }
    }
}

function drawMouseConnections() {
    let mouse = createVector(mouseX, mouseY);

    for (let particle of particles) {
        let d = dist(particle.pos.x, particle.pos.y, mouseX, mouseY);

        // If mouse is close to particle, draw stronger connection
        if (d < 200) {
            let alpha = map(d, 0, 200, 220, 0);
            // Draw cartoony lightning-like line to mouse
            drawLightning(
                particle.pos.x, particle.pos.y,
                mouseX, mouseY,
                alpha
            );

            // Push particles slightly away from mouse
            let force = p5.Vector.sub(particle.pos, mouse);
            force.normalize();
            force.mult(0.3);
            particle.applyForce(force);
        }
    }
}

function drawLightning(x1, y1, x2, y2, alpha) {
    let segments = 6;
    let points = [{x: x1, y: y1}];

    // Generate jagged lightning path
    for (let i = 1; i < segments; i++) {
        let t = i / segments;
        let x = lerp(x1, x2, t);
        let y = lerp(y1, y2, t);

        // Add more dramatic randomness for cartoony effect
        let offset = random(-15, 15);
        let angle = atan2(y2 - y1, x2 - x1) + HALF_PI;
        x += cos(angle) * offset;
        y += sin(angle) * offset;

        points.push({x: x, y: y});
    }
    points.push({x: x2, y: y2});

    // Randomly select color from palette
    let col = random(colors);
    col.setAlpha(alpha);

    // Draw cartoon outline (black)
    stroke(0, 0, 0, alpha * 0.8);
    strokeWeight(5);
    for (let i = 0; i < points.length - 1; i++) {
        line(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
    }

    // Draw main lightning bolt
    stroke(col);
    strokeWeight(3);
    for (let i = 0; i < points.length - 1; i++) {
        line(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
    }

    // Add small branches for extra cartoony effect (randomly)
    if (random() > 0.7 && points.length > 2) {
        let branchIdx = floor(random(1, points.length - 1));
        let branchPoint = points[branchIdx];
        let branchAngle = random(TWO_PI);
        let branchLength = random(10, 20);
        let branchX = branchPoint.x + cos(branchAngle) * branchLength;
        let branchY = branchPoint.y + sin(branchAngle) * branchLength;

        // Draw branch outline
        stroke(0, 0, 0, alpha * 0.6);
        strokeWeight(4);
        line(branchPoint.x, branchPoint.y, branchX, branchY);

        // Draw branch
        stroke(col);
        strokeWeight(2);
        line(branchPoint.x, branchPoint.y, branchX, branchY);
    }
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
}

// Particle class
class Particle {
    constructor() {
        this.pos = createVector(random(width), random(height));
        this.vel = createVector(random(-0.5, 0.5), random(-0.5, 0.5));
        this.acc = createVector(0, 0);
        this.maxSpeed = 2;
        this.size = random(8, 16);
        this.color = random(colors);

        // Pulsing effect
        this.pulseOffset = random(TWO_PI);
        this.pulseSpeed = random(0.02, 0.05);

        // Random rotation for triangles
        this.rotation = random(TWO_PI);
        this.rotationSpeed = random(-0.02, 0.02);
    }

    update() {
        // Update velocity and position
        this.vel.add(this.acc);
        this.vel.limit(this.maxSpeed);
        this.pos.add(this.vel);
        this.acc.mult(0);

        // Update rotation
        this.rotation += this.rotationSpeed;

        // Wrap around edges
        if (this.pos.x < 0) this.pos.x = width;
        if (this.pos.x > width) this.pos.x = 0;
        if (this.pos.y < 0) this.pos.y = height;
        if (this.pos.y > height) this.pos.y = 0;

        // Add slight drift toward center
        let center = createVector(width / 2, height / 2);
        let toCenter = p5.Vector.sub(center, this.pos);
        toCenter.normalize();
        toCenter.mult(0.01);
        this.applyForce(toCenter);

        // Add some random movement
        let randomForce = createVector(random(-0.05, 0.05), random(-0.05, 0.05));
        this.applyForce(randomForce);
    }

    applyForce(force) {
        this.acc.add(force);
    }

    display() {
        // Pulsing glow effect
        let pulse = sin(frameCount * this.pulseSpeed + this.pulseOffset);
        let glowSize = map(pulse, -1, 1, this.size, this.size * 1.5);

        push();
        translate(this.pos.x, this.pos.y);
        rotate(this.rotation);

        // Draw glow triangles
        noStroke();
        for (let i = 3; i > 0; i--) {
            let alpha = map(i, 3, 0, 30, 120);
            this.color.setAlpha(alpha);
            fill(this.color);
            let s = glowSize * (1 + i * 0.3);
            this.drawTriangle(0, 0, s);
        }

        // Draw core triangle with outline for cartoony effect
        strokeWeight(2);
        stroke(0, 0, 0, 200);
        this.color.setAlpha(255);
        fill(this.color);
        this.drawTriangle(0, 0, this.size);

        pop();
    }

    drawTriangle(x, y, size) {
        // Draw equilateral triangle
        let h = size * 0.866; // height of equilateral triangle
        triangle(
            x, y - h * 0.6,           // top point
            x - size * 0.5, y + h * 0.4,  // bottom left
            x + size * 0.5, y + h * 0.4   // bottom right
        );
    }
}
