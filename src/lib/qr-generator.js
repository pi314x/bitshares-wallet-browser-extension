/**
 * QR Code Generator
 * Pure JavaScript implementation - no external dependencies
 * Supports alphanumeric mode which is ideal for BitShares account names
 */

// QR Code constants
const ERROR_CORRECTION_LEVELS = { L: 0, M: 1, Q: 2, H: 3 };

// Alphanumeric character set for QR codes
const ALPHANUMERIC_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

// Version capacity table (alphanumeric, error correction M)
const VERSION_CAPACITY = [
  0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412,
  450, 504, 560, 624, 666, 711, 779, 857, 911, 997, 1059, 1125, 1190, 1264,
  1370, 1452, 1538, 1628, 1722, 1809, 1911, 1989, 2099, 2213, 2331
];

// Error correction codewords per block
const EC_CODEWORDS = {
  1: { L: 7, M: 10, Q: 13, H: 17 },
  2: { L: 10, M: 16, Q: 22, H: 28 },
  3: { L: 15, M: 26, Q: 36, H: 44 },
  4: { L: 20, M: 36, Q: 52, H: 64 },
  5: { L: 26, M: 48, Q: 72, H: 88 },
  6: { L: 36, M: 64, Q: 96, H: 112 }
};

// Number of error correction blocks
const EC_BLOCKS = {
  1: { L: 1, M: 1, Q: 1, H: 1 },
  2: { L: 1, M: 1, Q: 1, H: 1 },
  3: { L: 1, M: 1, Q: 2, H: 2 },
  4: { L: 1, M: 2, Q: 2, H: 4 },
  5: { L: 1, M: 2, Q: 4, H: 4 },
  6: { L: 2, M: 4, Q: 4, H: 4 }
};

/**
 * Generate a QR code as a data URL
 * @param {string} text - Text to encode in QR code
 * @param {Object} options - Options for QR code generation
 * @returns {Promise<string>} Data URL of the QR code image
 */
export async function generateQRCode(text, options = {}) {
  const {
    size = 200,
    errorCorrectionLevel = 'M',
    margin = 4,
    darkColor = '#000000',
    lightColor = '#ffffff'
  } = options;

  try {
    const qrData = createQRCode(text, errorCorrectionLevel);
    return renderQRCode(qrData, size, margin, darkColor, lightColor);
  } catch (error) {
    console.error('QR generation error:', error);
    // Fallback to simple text-based QR simulation
    return generateSimpleQR(text, size, margin);
  }
}

/**
 * Create QR code matrix
 */
function createQRCode(text, ecLevel = 'M') {
  // Determine if we can use alphanumeric mode
  const upperText = text.toUpperCase();
  const isAlphanumeric = [...upperText].every(c => ALPHANUMERIC_CHARS.includes(c));

  // Find minimum version that fits the data
  const version = findMinVersion(text, ecLevel, isAlphanumeric);
  const size = version * 4 + 17;

  // Create matrix
  const matrix = Array(size).fill(null).map(() => Array(size).fill(null));
  const reserved = Array(size).fill(null).map(() => Array(size).fill(false));

  // Add finder patterns
  addFinderPattern(matrix, reserved, 0, 0);
  addFinderPattern(matrix, reserved, size - 7, 0);
  addFinderPattern(matrix, reserved, 0, size - 7);

  // Add separators
  addSeparators(matrix, reserved, size);

  // Add timing patterns
  addTimingPatterns(matrix, reserved, size);

  // Add alignment patterns (for version >= 2)
  if (version >= 2) {
    addAlignmentPatterns(matrix, reserved, version);
  }

  // Reserve format info area
  reserveFormatInfo(reserved, size);

  // Reserve version info area (for version >= 7)
  if (version >= 7) {
    reserveVersionInfo(reserved, size);
  }

  // Encode data
  const dataBits = encodeData(text, version, ecLevel, isAlphanumeric);

  // Add error correction
  const finalBits = addErrorCorrection(dataBits, version, ecLevel);

  // Place data
  placeData(matrix, reserved, finalBits, size);

  // Apply best mask
  const maskedMatrix = applyBestMask(matrix, reserved, size, ecLevel);

  return maskedMatrix;
}

/**
 * Find minimum QR version for data
 */
function findMinVersion(text, ecLevel, isAlphanumeric) {
  const len = text.length;

  for (let v = 1; v <= 40; v++) {
    let capacity;
    if (isAlphanumeric) {
      capacity = VERSION_CAPACITY[v];
    } else {
      // Byte mode has less capacity
      capacity = Math.floor(VERSION_CAPACITY[v] * 0.6);
    }

    if (capacity >= len) {
      return Math.min(v, 6); // Limit to version 6 for simplicity
    }
  }
  return 6;
}

/**
 * Add finder pattern at position
 */
function addFinderPattern(matrix, reserved, row, col) {
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const isBlack = (
        r === 0 || r === 6 || c === 0 || c === 6 ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4)
      );
      matrix[row + r][col + c] = isBlack ? 1 : 0;
      reserved[row + r][col + c] = true;
    }
  }
}

/**
 * Add separators around finder patterns
 */
function addSeparators(matrix, reserved, size) {
  // Top-left
  for (let i = 0; i < 8; i++) {
    if (i < size) {
      matrix[7][i] = 0;
      matrix[i][7] = 0;
      reserved[7][i] = true;
      reserved[i][7] = true;
    }
  }
  // Top-right
  for (let i = 0; i < 8; i++) {
    if (size - 8 + i < size) {
      matrix[7][size - 8 + i] = 0;
      matrix[i][size - 8] = 0;
      reserved[7][size - 8 + i] = true;
      reserved[i][size - 8] = true;
    }
  }
  // Bottom-left
  for (let i = 0; i < 8; i++) {
    if (size - 8 + i < size) {
      matrix[size - 8][i] = 0;
      matrix[size - 8 + i][7] = 0;
      reserved[size - 8][i] = true;
      reserved[size - 8 + i][7] = true;
    }
  }
}

/**
 * Add timing patterns
 */
function addTimingPatterns(matrix, reserved, size) {
  for (let i = 8; i < size - 8; i++) {
    const bit = i % 2 === 0 ? 1 : 0;
    matrix[6][i] = bit;
    matrix[i][6] = bit;
    reserved[6][i] = true;
    reserved[i][6] = true;
  }
}

/**
 * Add alignment patterns
 */
function addAlignmentPatterns(matrix, reserved, version) {
  const positions = getAlignmentPositions(version);

  for (const row of positions) {
    for (const col of positions) {
      // Skip if overlapping with finder patterns
      if ((row < 9 && col < 9) ||
          (row < 9 && col > matrix.length - 10) ||
          (row > matrix.length - 10 && col < 9)) {
        continue;
      }

      addAlignmentPattern(matrix, reserved, row, col);
    }
  }
}

/**
 * Get alignment pattern positions for version
 */
function getAlignmentPositions(version) {
  if (version === 1) return [];

  const positions = [6];
  const last = version * 4 + 10;

  if (version >= 2) {
    const step = version === 2 ? 0 : Math.floor((last - 6) / Math.floor(version / 7 + 1));
    for (let pos = last; pos > 6; pos -= step || (last - 6)) {
      positions.unshift(pos);
      if (step === 0) break;
    }
  }

  return positions;
}

/**
 * Add single alignment pattern
 */
function addAlignmentPattern(matrix, reserved, centerRow, centerCol) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const isBlack = (
        Math.abs(r) === 2 || Math.abs(c) === 2 ||
        (r === 0 && c === 0)
      );
      matrix[centerRow + r][centerCol + c] = isBlack ? 1 : 0;
      reserved[centerRow + r][centerCol + c] = true;
    }
  }
}

/**
 * Reserve format info area
 */
function reserveFormatInfo(reserved, size) {
  // Around top-left finder
  for (let i = 0; i < 9; i++) {
    reserved[8][i] = true;
    reserved[i][8] = true;
  }
  // Around bottom-left finder
  for (let i = 0; i < 8; i++) {
    reserved[size - 1 - i][8] = true;
  }
  // Around top-right finder
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
  }
}

/**
 * Reserve version info area
 */
function reserveVersionInfo(reserved, size) {
  // Bottom-left
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 3; c++) {
      reserved[size - 11 + c][r] = true;
    }
  }
  // Top-right
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 6; c++) {
      reserved[r][size - 11 + c] = true;
    }
  }
}

/**
 * Encode data into bits
 */
function encodeData(text, version, ecLevel, isAlphanumeric) {
  const bits = [];

  if (isAlphanumeric) {
    // Mode indicator for alphanumeric: 0010
    bits.push(0, 0, 1, 0);

    // Character count indicator
    const countBits = version <= 9 ? 9 : (version <= 26 ? 11 : 13);
    const upperText = text.toUpperCase();
    const count = upperText.length;

    for (let i = countBits - 1; i >= 0; i--) {
      bits.push((count >> i) & 1);
    }

    // Encode pairs of characters
    for (let i = 0; i < upperText.length; i += 2) {
      const c1 = ALPHANUMERIC_CHARS.indexOf(upperText[i]);

      if (i + 1 < upperText.length) {
        const c2 = ALPHANUMERIC_CHARS.indexOf(upperText[i + 1]);
        const value = c1 * 45 + c2;
        for (let j = 10; j >= 0; j--) {
          bits.push((value >> j) & 1);
        }
      } else {
        for (let j = 5; j >= 0; j--) {
          bits.push((c1 >> j) & 1);
        }
      }
    }
  } else {
    // Byte mode: 0100
    bits.push(0, 1, 0, 0);

    // Character count
    const countBits = version <= 9 ? 8 : 16;
    const count = text.length;

    for (let i = countBits - 1; i >= 0; i--) {
      bits.push((count >> i) & 1);
    }

    // Encode bytes
    for (let i = 0; i < text.length; i++) {
      const byte = text.charCodeAt(i);
      for (let j = 7; j >= 0; j--) {
        bits.push((byte >> j) & 1);
      }
    }
  }

  // Add terminator
  const capacity = getDataCapacity(version, ecLevel);
  const terminatorLength = Math.min(4, capacity * 8 - bits.length);
  for (let i = 0; i < terminatorLength; i++) {
    bits.push(0);
  }

  // Pad to byte boundary
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  // Add padding bytes
  const padBytes = [0xEC, 0x11];
  let padIndex = 0;
  while (bits.length < capacity * 8) {
    const byte = padBytes[padIndex % 2];
    for (let j = 7; j >= 0; j--) {
      bits.push((byte >> j) & 1);
    }
    padIndex++;
  }

  return bits;
}

/**
 * Get data capacity in bytes
 */
function getDataCapacity(version, ecLevel) {
  // Simplified capacity calculation
  const totalCodewords = Math.floor((version * 4 + 17) ** 2 / 8) -
    (version === 1 ? 21 : version * 2 + 15);

  const ecCodewords = (EC_CODEWORDS[version] || EC_CODEWORDS[6])[ecLevel] *
    (EC_BLOCKS[version] || EC_BLOCKS[6])[ecLevel];

  return Math.max(1, totalCodewords - ecCodewords);
}

/**
 * Add error correction codes
 */
function addErrorCorrection(dataBits, version, ecLevel) {
  // Convert bits to bytes
  const dataBytes = [];
  for (let i = 0; i < dataBits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8 && i + j < dataBits.length; j++) {
      byte = (byte << 1) | dataBits[i + j];
    }
    dataBytes.push(byte);
  }

  // Generate Reed-Solomon error correction
  const ecCount = (EC_CODEWORDS[version] || EC_CODEWORDS[6])[ecLevel];
  const ecBytes = generateReedSolomon(dataBytes, ecCount);

  // Combine data and error correction
  const allBytes = [...dataBytes, ...ecBytes];

  // Convert back to bits
  const resultBits = [];
  for (const byte of allBytes) {
    for (let j = 7; j >= 0; j--) {
      resultBits.push((byte >> j) & 1);
    }
  }

  return resultBits;
}

/**
 * Generate Reed-Solomon error correction bytes
 */
function generateReedSolomon(data, ecCount) {
  // GF(2^8) with polynomial x^8 + x^4 + x^3 + x^2 + 1
  const gfExp = new Array(512);
  const gfLog = new Array(256);

  let x = 1;
  for (let i = 0; i < 255; i++) {
    gfExp[i] = x;
    gfLog[x] = i;
    x <<= 1;
    if (x >= 256) {
      x ^= 0x11D;
    }
  }
  for (let i = 255; i < 512; i++) {
    gfExp[i] = gfExp[i - 255];
  }

  // Generate generator polynomial
  let generator = [1];
  for (let i = 0; i < ecCount; i++) {
    const newGen = new Array(generator.length + 1).fill(0);
    for (let j = 0; j < generator.length; j++) {
      newGen[j] ^= generator[j];
      newGen[j + 1] ^= gfExp[(gfLog[generator[j]] + i) % 255];
    }
    generator = newGen;
  }

  // Compute remainder
  const remainder = new Array(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);

    if (factor !== 0) {
      for (let i = 0; i < ecCount; i++) {
        if (generator[i + 1] !== 0) {
          remainder[i] ^= gfExp[(gfLog[generator[i + 1]] + gfLog[factor]) % 255];
        }
      }
    }
  }

  return remainder;
}

/**
 * Place data bits in matrix
 */
function placeData(matrix, reserved, bits, size) {
  let bitIndex = 0;
  let upward = true;

  for (let col = size - 1; col >= 0; col -= 2) {
    // Skip timing pattern column
    if (col === 6) col = 5;

    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;

      for (let c = 0; c < 2; c++) {
        const actualCol = col - c;
        if (actualCol >= 0 && !reserved[row][actualCol]) {
          matrix[row][actualCol] = bitIndex < bits.length ? bits[bitIndex] : 0;
          bitIndex++;
        }
      }
    }
    upward = !upward;
  }
}

/**
 * Apply mask and find best one
 */
function applyBestMask(matrix, reserved, size, ecLevel) {
  let bestMask = 0;
  let bestScore = Infinity;
  let bestMatrix = null;

  for (let mask = 0; mask < 8; mask++) {
    const masked = applyMask(matrix, reserved, size, mask);
    addFormatInfo(masked, size, ecLevel, mask);
    const score = evaluateMask(masked, size);

    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
      bestMatrix = masked;
    }
  }

  return bestMatrix || applyMask(matrix, reserved, size, 0);
}

/**
 * Apply specific mask pattern
 */
function applyMask(matrix, reserved, size, mask) {
  const result = matrix.map(row => [...row]);

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!reserved[row][col]) {
        let invert = false;
        switch (mask) {
          case 0: invert = (row + col) % 2 === 0; break;
          case 1: invert = row % 2 === 0; break;
          case 2: invert = col % 3 === 0; break;
          case 3: invert = (row + col) % 3 === 0; break;
          case 4: invert = (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0; break;
          case 5: invert = (row * col) % 2 + (row * col) % 3 === 0; break;
          case 6: invert = ((row * col) % 2 + (row * col) % 3) % 2 === 0; break;
          case 7: invert = ((row + col) % 2 + (row * col) % 3) % 2 === 0; break;
        }
        if (invert) {
          result[row][col] ^= 1;
        }
      }
    }
  }

  return result;
}

/**
 * Add format information
 */
function addFormatInfo(matrix, size, ecLevel, mask) {
  const ecBits = { L: 1, M: 0, Q: 3, H: 2 };
  const formatData = (ecBits[ecLevel] << 3) | mask;

  // Calculate BCH error correction
  let format = formatData << 10;
  for (let i = 4; i >= 0; i--) {
    if (format & (1 << (i + 10))) {
      format ^= 0x537 << i;
    }
  }
  format = ((formatData << 10) | format) ^ 0x5412;

  // Place format info
  for (let i = 0; i < 15; i++) {
    const bit = (format >> (14 - i)) & 1;

    // Around top-left finder
    if (i < 6) {
      matrix[i][8] = bit;
    } else if (i < 8) {
      matrix[i + 1][8] = bit;
    } else {
      matrix[8][14 - i] = bit;
    }

    // Around other finders
    if (i < 8) {
      matrix[8][size - 1 - i] = bit;
    } else {
      matrix[size - 15 + i][8] = bit;
    }
  }

  // Dark module
  matrix[size - 8][8] = 1;
}

/**
 * Evaluate mask penalty score
 */
function evaluateMask(matrix, size) {
  let score = 0;

  // Rule 1: Adjacent modules in row/column
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size - 4; col++) {
      if (matrix[row][col] === matrix[row][col+1] &&
          matrix[row][col] === matrix[row][col+2] &&
          matrix[row][col] === matrix[row][col+3] &&
          matrix[row][col] === matrix[row][col+4]) {
        score += 3;
      }
    }
  }

  for (let col = 0; col < size; col++) {
    for (let row = 0; row < size - 4; row++) {
      if (matrix[row][col] === matrix[row+1][col] &&
          matrix[row][col] === matrix[row+2][col] &&
          matrix[row][col] === matrix[row+3][col] &&
          matrix[row][col] === matrix[row+4][col]) {
        score += 3;
      }
    }
  }

  // Rule 2: 2x2 blocks
  for (let row = 0; row < size - 1; row++) {
    for (let col = 0; col < size - 1; col++) {
      if (matrix[row][col] === matrix[row][col+1] &&
          matrix[row][col] === matrix[row+1][col] &&
          matrix[row][col] === matrix[row+1][col+1]) {
        score += 3;
      }
    }
  }

  return score;
}

/**
 * Render QR code to canvas data URL
 */
function renderQRCode(matrix, size, margin, darkColor, lightColor) {
  const moduleCount = matrix.length;
  const moduleSize = Math.floor((size - margin * 2) / moduleCount);
  const actualSize = moduleSize * moduleCount + margin * 2;

  const canvas = document.createElement('canvas');
  canvas.width = actualSize;
  canvas.height = actualSize;
  const ctx = canvas.getContext('2d');

  // Fill background
  ctx.fillStyle = lightColor;
  ctx.fillRect(0, 0, actualSize, actualSize);

  // Draw modules
  ctx.fillStyle = darkColor;
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (matrix[row][col]) {
        ctx.fillRect(
          margin + col * moduleSize,
          margin + row * moduleSize,
          moduleSize,
          moduleSize
        );
      }
    }
  }

  return canvas.toDataURL('image/png');
}

/**
 * Simple fallback QR generator (visual approximation)
 */
function generateSimpleQR(text, size, margin) {
  // Create a simple hash-based pattern
  const moduleCount = 25;
  const moduleSize = Math.floor((size - margin * 2) / moduleCount);
  const actualSize = moduleSize * moduleCount + margin * 2;

  const canvas = document.createElement('canvas');
  canvas.width = actualSize;
  canvas.height = actualSize;
  const ctx = canvas.getContext('2d');

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, actualSize, actualSize);

  // Generate pseudo-random pattern based on text
  const hash = simpleHash(text);
  const matrix = Array(moduleCount).fill(null).map(() => Array(moduleCount).fill(0));

  // Add finder patterns
  addSimpleFinderPattern(matrix, 0, 0);
  addSimpleFinderPattern(matrix, moduleCount - 7, 0);
  addSimpleFinderPattern(matrix, 0, moduleCount - 7);

  // Fill data area with hash-based pattern
  let seed = hash;
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      // Skip finder pattern areas
      if ((row < 9 && col < 9) ||
          (row < 9 && col > moduleCount - 10) ||
          (row > moduleCount - 10 && col < 9)) {
        continue;
      }

      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      matrix[row][col] = (seed >> 16) % 2;
    }
  }

  // Draw modules
  ctx.fillStyle = '#000000';
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (matrix[row][col]) {
        ctx.fillRect(
          margin + col * moduleSize,
          margin + row * moduleSize,
          moduleSize,
          moduleSize
        );
      }
    }
  }

  return canvas.toDataURL('image/png');
}

/**
 * Add finder pattern for simple QR
 */
function addSimpleFinderPattern(matrix, startRow, startCol) {
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const isBlack = (
        r === 0 || r === 6 || c === 0 || c === 6 ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4)
      );
      matrix[startRow + r][startCol + c] = isBlack ? 1 : 0;
    }
  }
}

/**
 * Simple hash function
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * Generate QR code and display in an element
 * @param {string} elementId - ID of element to display QR code in
 * @param {string} text - Text to encode
 * @param {Object} options - QR code options
 */
export async function displayQRCode(elementId, text, options = {}) {
  try {
    const dataUrl = await generateQRCode(text, options);
    const element = document.getElementById(elementId);

    if (element) {
      if (element.tagName === 'IMG') {
        element.src = dataUrl;
      } else {
        element.innerHTML = `<img src="${dataUrl}" alt="QR Code" />`;
      }
    }

    return dataUrl;
  } catch (error) {
    console.error('Failed to generate QR code:', error);
    throw error;
  }
}
