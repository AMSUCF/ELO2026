# ELO 2026 - Interactive Landing Page

An interactive P5.js animation for the ELO 2026 conference at the University of Central Florida.

## Features

- **Static Electricity Effect**: Dynamic background animation with particles that create lightning-like connections
- **Mouse Interaction**: The animation responds to mouse movement, creating stronger connections near the cursor
- **Responsive Design**: Automatically adapts to different screen sizes
- **GitHub Pages Ready**: Configured for easy deployment

## Event Details

- **Date**: July 16th-18th, 2026
- **Format**: Online
- **Location**: University of Central Florida
- **Call for Proposals**: Coming November 2025

## Setup

### Adding Your Logo

1. Place your logo image in the repository (recommended: `assets/logo.png`)
2. Open `index.html`
3. Replace this line:
   ```html
   <div class="logo-placeholder">ELO 2026</div>
   ```
   with:
   ```html
   <img src="assets/logo.png" alt="ELO 2026 Logo">
   ```

### Local Development

Simply open `index.html` in a web browser to view the animation locally.

### Deploying to GitHub Pages

1. Push your changes to the repository
2. Go to your repository settings on GitHub
3. Navigate to "Pages" in the left sidebar
4. Under "Source", select the branch you want to deploy (e.g., `main`)
5. Click "Save"
6. Your site will be available at `https://[username].github.io/ELO2026/`

## Customization

### Colors

The animation uses a warm color palette (golds, oranges) that complements typical ELO branding. To modify colors, edit the `colors` array in `sketch.js`:

```javascript
colors = [
    color(255, 215, 0, 150),    // Gold
    color(255, 165, 0, 150),    // Orange
    // Add or modify colors here
];
```

### Particle Count

To adjust the density of the static electricity effect, modify the `numParticles` variable in `sketch.js`:

```javascript
let numParticles = 100; // Increase for more particles, decrease for fewer
```

### Text Content

To modify the event details text, edit the text in the `#content-overlay` div in `index.html`.

## Technologies Used

- **P5.js**: Creative coding library for the interactive animation
- **HTML5/CSS3**: Modern web standards
- **GitHub Pages**: Free static site hosting

## Browser Compatibility

This site works best on modern browsers that support:
- HTML5 Canvas
- ES6 JavaScript
- CSS3 Transforms and Filters

Tested on:
- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)

## License

All rights reserved for ELO 2026 conference materials.
