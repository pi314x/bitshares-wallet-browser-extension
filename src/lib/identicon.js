/**
 * BitShares Identicon Generator
 * Generates unique visual identicons based on account names using SHA-256 hash
 * Similar to jdenticon used in bitshares-ui
 */

// Simple SHA-256 implementation for browser
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Convert hex to HSL color
function hexToHsl(hex, offset = 0) {
  const value = parseInt(hex.substring(offset, offset + 2), 16);
  const hue = (value / 255) * 360;
  return `hsl(${hue}, 65%, 55%)`;
}

// Get background color from hash
function getBackgroundColor(hash) {
  const value = parseInt(hash.substring(0, 2), 16);
  const hue = (value / 255) * 360;
  return `hsl(${hue}, 45%, 25%)`;
}

// Get foreground color from hash
function getForegroundColor(hash) {
  const value = parseInt(hash.substring(2, 4), 16);
  const hue = (value / 255) * 360;
  return `hsl(${hue}, 70%, 60%)`;
}

// Get secondary color from hash
function getSecondaryColor(hash) {
  const value = parseInt(hash.substring(4, 6), 16);
  const hue = (value / 255) * 360;
  return `hsl(${hue}, 60%, 45%)`;
}

/**
 * Render an identicon to a canvas element
 * @param {HTMLCanvasElement} canvas - The canvas element to render to
 * @param {string} hash - The SHA-256 hash string
 * @param {number} size - The size of the identicon
 */
function renderIdenticon(canvas, hash, size) {
  const ctx = canvas.getContext('2d');
  const cellSize = size / 5;

  // Clear canvas
  ctx.clearRect(0, 0, size, size);

  // Background
  const bgColor = getBackgroundColor(hash);
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, size, size);

  // Get colors from hash
  const fgColor = getForegroundColor(hash);
  const secColor = getSecondaryColor(hash);

  // Create a 5x5 grid pattern (symmetric)
  // Only need to calculate left half + center column
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      // Use different parts of hash for each cell
      const hashIndex = (row * 3 + col) * 2;
      const value = parseInt(hash.substring(hashIndex + 6, hashIndex + 8), 16);

      if (value > 127) {
        // Alternate between two colors based on another hash value
        const colorIndex = (row + col) % 2;
        ctx.fillStyle = colorIndex === 0 ? fgColor : secColor;

        // Draw cell
        ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);

        // Mirror for right side (except center column)
        if (col < 2) {
          ctx.fillRect((4 - col) * cellSize, row * cellSize, cellSize, cellSize);
        }
      }
    }
  }

  // Add some geometric shapes based on hash for more variety
  const shapeType = parseInt(hash.substring(30, 32), 16) % 4;
  const shapeColor = `hsla(${parseInt(hash.substring(32, 34), 16)}, 80%, 70%, 0.3)`;

  ctx.fillStyle = shapeColor;

  switch (shapeType) {
    case 0: // Diamond in center
      ctx.beginPath();
      ctx.moveTo(size / 2, cellSize);
      ctx.lineTo(size - cellSize, size / 2);
      ctx.lineTo(size / 2, size - cellSize);
      ctx.lineTo(cellSize, size / 2);
      ctx.closePath();
      ctx.fill();
      break;
    case 1: // Circle in center
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, cellSize * 1.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 2: // Square in center
      ctx.fillRect(cellSize * 1.5, cellSize * 1.5, cellSize * 2, cellSize * 2);
      break;
    case 3: // Cross pattern
      ctx.fillRect(cellSize * 2, cellSize * 0.5, cellSize, cellSize * 4);
      ctx.fillRect(cellSize * 0.5, cellSize * 2, cellSize * 4, cellSize);
      break;
  }
}

/**
 * Generate an identicon for a BitShares account
 * @param {string} accountName - The account name to generate identicon for
 * @param {number} size - The size of the identicon (default 64)
 * @returns {Promise<HTMLCanvasElement>} - A canvas element with the rendered identicon
 */
export async function generateIdenticon(accountName, size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = size * 2; // Retina support
  canvas.height = size * 2;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;

  if (!accountName) {
    // Render placeholder
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2a3441';
    ctx.fillRect(0, 0, size * 2, size * 2);
    ctx.fillStyle = '#64748b';
    ctx.font = `bold ${size}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', size, size);
    return canvas;
  }

  const hash = await sha256(accountName);
  renderIdenticon(canvas, hash, size * 2);

  return canvas;
}

/**
 * Render identicon directly into an existing canvas element
 * @param {HTMLCanvasElement} canvas - The canvas element to render to
 * @param {string} accountName - The account name
 */
export async function renderIdenticonToCanvas(canvas, accountName) {
  if (!accountName) {
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    ctx.fillStyle = '#2a3441';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#64748b';
    ctx.font = `bold ${size / 2}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', size / 2, size / 2);
    return;
  }

  const hash = await sha256(accountName);
  renderIdenticon(canvas, hash, canvas.width);
}

/**
 * Get identicon as data URL
 * @param {string} accountName - The account name
 * @param {number} size - The size of the identicon
 * @returns {Promise<string>} - Data URL of the identicon
 */
export async function getIdenticonDataUrl(accountName, size = 64) {
  const canvas = await generateIdenticon(accountName, size);
  return canvas.toDataURL('image/png');
}

// Default export
export default {
  generateIdenticon,
  renderIdenticonToCanvas,
  getIdenticonDataUrl
};
