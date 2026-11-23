/**
 * Exact decimal <-> on-chain integer conversion for asset amounts.
 *
 * BitShares stores amounts as int64 "base units" (amount * 10^precision).
 * Doing that conversion with floating point (parseFloat(x) * 10^p, toFixed)
 * silently changes the value: it rounds extra decimals, rounds up past the
 * user's balance, and loses a unit once the number nears 2^53. Everything here
 * works on the decimal string / BigInt instead, so what the user typed is
 * exactly what is signed — or the conversion fails loudly.
 */

const MAX_EXPONENT = 40; // guards against '1e999999999' allocating huge strings

function pow10(n) {
  return BigInt('1' + '0'.repeat(n));
}

/**
 * Split a non-negative decimal into integer digits and a decimal scale.
 * Accepts '12', '12.5', '.5', '5.' and exponent form ('1e-7', '1.5E+3').
 * @returns {{ digits: string, scale: number }} value = digits / 10^scale
 */
function parseDecimal(input) {
  const str = String(input).trim();
  const m = /^(\d*)\.?(\d*)(?:e([+-]?\d+))?$/i.exec(str);
  if (!m || (m[1] === '' && m[2] === '')) {
    throw new Error('Invalid amount');
  }
  const exp = m[3] ? parseInt(m[3], 10) : 0;
  if (Math.abs(exp) > MAX_EXPONENT) {
    throw new Error('Invalid amount');
  }
  let digits = m[1] + m[2];
  let scale = m[2].length - exp;
  if (scale < 0) {
    digits += '0'.repeat(-scale);
    scale = 0;
  }
  return { digits, scale };
}

/**
 * Convert a human amount to integer base units, exactly.
 *
 * - string  : must be exact. More decimals than `precision` is an ERROR (the
 *             old code silently rounded, so the confirm dialog showed one
 *             amount and a different one was signed). Trailing zeros beyond
 *             the precision ('1.500000' for a 5-decimal asset) are fine.
 * - number  : floats are inherently inexact (0.1 + 0.2), so a number is
 *             rounded to `precision` — callers that care pass a string.
 *
 * @param {string|number} amount
 * @param {number} precision  asset precision (0..18)
 * @returns {bigint} base units (>= 0)
 */
export function parseAmountToBaseUnits(amount, precision) {
  if (!Number.isInteger(precision) || precision < 0 || precision > 18) {
    throw new Error('Invalid asset precision');
  }
  if (typeof amount === 'number') {
    if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid amount');
    return roundDecimal(parseDecimal(String(amount)), precision);
  }
  if (typeof amount !== 'string') throw new Error('Invalid amount');

  const { digits, scale } = parseDecimal(amount);
  if (scale <= precision) {
    return BigInt(digits) * pow10(precision - scale);
  }
  const excess = scale - precision;
  // pad so `excess` can exceed the digit count (e.g. 0.00000123 at precision 3)
  const padded = digits.padStart(excess + 1, '0');
  const kept = padded.slice(0, padded.length - excess);
  const dropped = padded.slice(padded.length - excess);
  if (/[1-9]/.test(dropped)) {
    throw new Error(
      precision === 0
        ? 'This asset does not support decimal places'
        : `This asset supports at most ${precision} decimal places`
    );
  }
  return BigInt(kept);
}

function roundDecimal({ digits, scale }, precision) {
  if (scale <= precision) {
    return BigInt(digits) * pow10(precision - scale);
  }
  const excess = scale - precision;
  const padded = digits.padStart(excess + 1, '0');
  const kept = padded.slice(0, padded.length - excess);
  const roundUp = padded.charCodeAt(padded.length - excess) >= 53; // '5' => half-up
  return BigInt(kept) + (roundUp ? BigInt(1) : BigInt(0));
}

/**
 * Format integer base units as an exact decimal string.
 * @param {bigint|number|string} units  base units (non-negative integer)
 * @param {number} precision
 * @param {{ trim?: boolean }} [opts]  trim trailing zeros (default true)
 */
export function formatBaseUnits(units, precision, { trim = true } = {}) {
  let s = BigInt(units).toString();
  if (precision <= 0) return s;
  s = s.padStart(precision + 1, '0');
  const int = s.slice(0, s.length - precision);
  let frac = s.slice(s.length - precision);
  if (trim) frac = frac.replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}

/**
 * Convert base units between two precisions without floating point.
 * Used to express a fee quoted at the fee asset's precision in the units of
 * the asset being sent.
 */
export function rescaleBaseUnits(units, fromPrecision, toPrecision) {
  const u = BigInt(units);
  if (fromPrecision === toPrecision) return u;
  return toPrecision > fromPrecision
    ? u * pow10(toPrecision - fromPrecision)
    : u / pow10(fromPrecision - toPrecision);
}
