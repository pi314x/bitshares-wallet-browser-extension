/**
 * Icon Generator Script
 * Generates PNG icons from SVG
 * 
 * Usage: node scripts/generate-icons.js
 * 
 * Requires: npm install sharp
 */

const fs = require('fs');
const path = require('path');

// Check if sharp is available
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.log('Sharp module not found. Creating placeholder icons...');
  createPlaceholderIcons();
  process.exit(0);
}

const sizes = [16, 32, 48, 128];
const svgPath = path.join(__dirname, '../src/assets/icons/icon.svg');
const outputDir = path.join(__dirname, '../src/assets/icons');

async function generateIcons() {
  const svgBuffer = fs.readFileSync(svgPath);

  for (const size of sizes) {
    const outputPath = path.join(outputDir, `icon${size}.png`);
    
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outputPath);
    
    console.log(`Generated: icon${size}.png`);
  }

  console.log('All icons generated successfully!');
}

function createPlaceholderIcons() {
  // Create simple placeholder PNGs (1x1 transparent pixel for each size)
  // In production, use proper icon files
  
  const sizes = [16, 32, 48, 128];
  const outputDir = path.join(__dirname, '../src/assets/icons');
  
  // Ensure directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Minimal valid PNG (1x1 transparent pixel)
  const minimalPng = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 dimensions
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
    0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
    0x42, 0x60, 0x82
  ]);
  
  for (const size of sizes) {
    const outputPath = path.join(outputDir, `icon${size}.png`);
    fs.writeFileSync(outputPath, minimalPng);
    console.log(`Created placeholder: icon${size}.png`);
  }
  
  console.log('');
  console.log('Note: Placeholder icons created. For production:');
  console.log('1. Install sharp: npm install sharp');
  console.log('2. Run this script again to generate proper icons from SVG');
  console.log('Or manually create/convert icons using image editing software.');
}

generateIcons().catch(err => {
  console.error('Error generating icons:', err);
  createPlaceholderIcons();
});
