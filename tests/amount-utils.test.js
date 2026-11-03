/**
 * Tests for src/lib/amount-utils.js — exact amount <-> base-unit conversion.
 * Regression coverage for the send-amount rounding bugs: MAX rounding to a
 * fixed 5 decimals (even up past the balance), sendTransfer silently rounding
 * extra decimals, and float multiplication losing a unit on large amounts.
 */

import {
  parseAmountToBaseUnits,
  formatBaseUnits,
  rescaleBaseUnits,
} from '../src/lib/amount-utils.js';

describe('parseAmountToBaseUnits() — strings are exact', () => {
  test.each([
    ['1', 5, 100000n],
    ['1.5', 5, 150000n],
    ['0.00001', 5, 1n],
    ['.5', 5, 50000n],
    ['5.', 5, 500000n],
    ['0', 5, 0n],
    ['1.2345678', 8, 123456780n],
    ['12', 0, 12n],
  ])('%s @ precision %i -> %s', (input, precision, expected) => {
    expect(parseAmountToBaseUnits(input, precision)).toBe(expected);
  });

  test('does not lose a unit on large precise amounts (float multiply did)', () => {
    // Math.round(parseFloat('89670486.48729477') * 1e8) === 8967048648729476
    expect(parseAmountToBaseUnits('89670486.48729477', 8)).toBe(8967048648729477n);
    // beyond 2^53 the BigInt result is still exact (Number could not hold it)
    expect(parseAmountToBaseUnits('90071992.54740993', 8)).toBe(9007199254740993n);
  });

  test('exact where float multiplication is famously inexact', () => {
    expect(parseAmountToBaseUnits('1.005', 3)).toBe(1005n);
    expect(parseAmountToBaseUnits('4.35', 2)).toBe(435n);
    expect(parseAmountToBaseUnits('0.29', 2)).toBe(29n);
  });

  test('rejects extra decimals instead of silently rounding', () => {
    expect(() => parseAmountToBaseUnits('1.234567', 5)).toThrow(/at most 5 decimal places/);
    expect(() => parseAmountToBaseUnits('0.000004', 5)).toThrow(/at most 5 decimal places/);
    expect(() => parseAmountToBaseUnits('0.000005', 5)).toThrow(/at most 5 decimal places/);
    expect(() => parseAmountToBaseUnits('1.5', 0)).toThrow(/does not support decimal/);
  });

  test('excess decimals that are all zeros are fine', () => {
    expect(parseAmountToBaseUnits('1.500000', 5)).toBe(150000n);
    expect(parseAmountToBaseUnits('2.0', 0)).toBe(2n);
  });

  test('handles more excess decimals than digits (0.00000123 @ 3)', () => {
    expect(() => parseAmountToBaseUnits('0.00000123', 3)).toThrow(/at most 3/);
    expect(parseAmountToBaseUnits('0.00000000', 3)).toBe(0n);
  });

  test('exponent notation (type=number inputs can produce it)', () => {
    expect(parseAmountToBaseUnits('1e-5', 5)).toBe(1n);
    expect(parseAmountToBaseUnits('1.5E+3', 2)).toBe(150000n);
    expect(() => parseAmountToBaseUnits('1e-7', 5)).toThrow(/at most 5/);
  });

  test.each(['', ' ', '.', 'abc', '1.2.3', '-1', '+1', '1,5', '1e999', '0x10', 'NaN', 'Infinity'])(
    'rejects invalid input %p',
    (bad) => {
      expect(() => parseAmountToBaseUnits(bad, 5)).toThrow(/Invalid amount/);
    }
  );

  test('rejects non-string/number input and bad precision', () => {
    expect(() => parseAmountToBaseUnits(null, 5)).toThrow(/Invalid amount/);
    expect(() => parseAmountToBaseUnits(undefined, 5)).toThrow(/Invalid amount/);
    expect(() => parseAmountToBaseUnits('1', -1)).toThrow(/precision/);
    expect(() => parseAmountToBaseUnits('1', 1.5)).toThrow(/precision/);
    expect(() => parseAmountToBaseUnits('1', 19)).toThrow(/precision/);
  });
});

describe('parseAmountToBaseUnits() — numbers are rounded to precision', () => {
  test('float noise from dApp arithmetic does not fail', () => {
    expect(parseAmountToBaseUnits(0.1 + 0.2, 5)).toBe(30000n); // 0.30000000000000004
    expect(parseAmountToBaseUnits(1.5, 5)).toBe(150000n);
  });

  test('rounds half up at the precision boundary', () => {
    expect(parseAmountToBaseUnits(0.000005, 5)).toBe(1n);
    expect(parseAmountToBaseUnits(0.000004, 5)).toBe(0n);
    expect(parseAmountToBaseUnits(1.234567, 5)).toBe(123457n);
  });

  test('small numbers that stringify in exponent form', () => {
    expect(parseAmountToBaseUnits(1e-7, 8)).toBe(10n);
  });

  test('rejects NaN, Infinity and negatives', () => {
    expect(() => parseAmountToBaseUnits(NaN, 5)).toThrow(/Invalid amount/);
    expect(() => parseAmountToBaseUnits(Infinity, 5)).toThrow(/Invalid amount/);
    expect(() => parseAmountToBaseUnits(-1, 5)).toThrow(/Invalid amount/);
  });
});

describe('formatBaseUnits()', () => {
  test('exact, trims trailing zeros by default', () => {
    expect(formatBaseUnits(123456780n, 8)).toBe('1.2345678');
    expect(formatBaseUnits(150000n, 5)).toBe('1.5');
    expect(formatBaseUnits(100000n, 5)).toBe('1');
    expect(formatBaseUnits(1n, 5)).toBe('0.00001');
    expect(formatBaseUnits(0n, 5)).toBe('0');
    expect(formatBaseUnits(12n, 0)).toBe('12');
  });

  test('keeps trailing zeros with trim:false', () => {
    expect(formatBaseUnits(150000n, 5, { trim: false })).toBe('1.50000');
  });

  test('keeps full precision where toFixed(5) used to cut digits (the MAX bug)', () => {
    // 0.12345678 @ 8: old MAX showed 0.12346
    expect(formatBaseUnits(12345678n, 8)).toBe('0.12345678');
    // 1.234567 @ 6: old MAX showed 1.23457 — MORE than the balance
    expect(formatBaseUnits(1234567n, 6)).toBe('1.234567');
  });

  test('accepts number/string units and large values', () => {
    expect(formatBaseUnits(250, 2)).toBe('2.5');
    expect(formatBaseUnits('9007199254740993', 8)).toBe('90071992.54740993');
  });
});

describe('round trip', () => {
  test.each([
    ['0.00001', 5],
    ['123456.78901', 5],
    ['90071992.54740993', 8],
    ['1', 0],
    ['0.1', 1],
  ])('format(parse(%s, %i)) === input', (s, p) => {
    expect(formatBaseUnits(parseAmountToBaseUnits(s, p), p)).toBe(s);
  });
});

describe('rescaleBaseUnits()', () => {
  test('same precision is identity', () => {
    expect(rescaleBaseUnits(1000, 5, 5)).toBe(1000n);
  });
  test('scales up and down exactly', () => {
    expect(rescaleBaseUnits(1000, 5, 8)).toBe(1000000n);
    expect(rescaleBaseUnits(1000000, 8, 5)).toBe(1000n);
  });
});
