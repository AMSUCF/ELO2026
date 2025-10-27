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
                let alpha = map(d, 0, 120, 100, 0);
                // Use a random color from palette for variety
                let connectionColor = random(colors);
                connectionColor.setAlpha(alpha);
                stroke(connectionColor);
                strokeWeight(map(d, 0, 120, 2, 0.5));

                // Draw jagged lightning-like line
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
            let alpha = map(d, 0, 200, 200, 0);
            // Use cyan/pink for mouse connections (most prominent logo colors)
            let mouseColor = random([colors[0], colors[3]]); // Pink or Cyan
            mouseColor.setAlpha(alpha);
            stroke(mouseColor);
            strokeWeight(map(d, 0, 200, 3, 0.5));

            // Draw jagged lightning-like line to mouse
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
    let segments = 8;
    let prevX = x1;
    let prevY = y1;

    for (let i = 1; i <= segments; i++) {
        let t = i / segments;
        let x = lerp(x1, x2, t);
        let y = lerp(y1, y2, t);

        // Add randomness to create jagged effect
        if (i < segments) {
            x += random(-5, 5);
            y += random(-5, 5);
        }

        // Randomly select color from palette
        let col = random(colors);
        col.setAlpha(alpha);
        stroke(col);

        line(prevX, prevY, x, y);

        prevX = x;
        prevY = y;
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
        this.size = random(3, 8);
        this.color = random(colors);

        // Pulsing effect
        this.pulseOffset = random(TWO_PI);
        this.pulseSpeed = random(0.02, 0.05);
    }

    update() {
        // Update velocity and position
        this.vel.add(this.acc);
        this.vel.limit(this.maxSpeed);
        this.pos.add(this.vel);
        this.acc.mult(0);

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

        // Draw glow
        noStroke();
        for (let i = 3; i > 0; i--) {
            let alpha = map(i, 3, 0, 20, 100);
            this.color.setAlpha(alpha);
            fill(this.color);
            circle(this.pos.x, this.pos.y, glowSize * (1 + i * 0.5));
        }

        // Draw core
        this.color.setAlpha(255);
        fill(this.color);
        circle(this.pos.x, this.pos.y, this.size);
    }
}
