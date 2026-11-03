/**
 * Tests for src/lib/swap-math.js — constant-product AMM quote math in exact
 * integer base units, plus the swap form's amount handling end to end.
 */

import {
  ammOutBase,
  ammInBase,
  minReceivedBase,
  poolReserves,
  SWAP_SLIPPAGE_BPS,
} from '../src/lib/swap-math.js';
import { parseAmountToBaseUnits, formatBaseUnits } from '../src/lib/amount-utils.js';

const pool = (over = {}) => ({
  isAssetAFrom: true,
  balance_a: '1000000',
  balance_b: '2000000',
  taker_fee_percent: 0,
  ...over,
});

describe('poolReserves()', () => {
  test('picks reserves by direction', () => {
    expect(poolReserves(pool())).toEqual({ inBase: 1000000n, outBase: 2000000n, feeBps: 0n });
    expect(poolReserves(pool({ isAssetAFrom: false }))).toEqual({
      inBase: 2000000n,
      outBase: 1000000n,
      feeBps: 0n,
    });
  });
  test('fee defaults to 0 when missing/garbage', () => {
    expect(poolReserves(pool({ taker_fee_percent: undefined })).feeBps).toBe(0n);
    expect(poolReserves(pool({ taker_fee_percent: 'x' })).feeBps).toBe(0n);
  });
});

describe('ammOutBase()', () => {
  test('constant product, no fee: floor(out * in / (reserveIn + in))', () => {
    // 2_000_000 * 1000 / 1_001_000 = 1998.001... -> 1998
    expect(ammOutBase(pool(), 1000n)).toBe(1998n);
  });

  test('applies the taker fee (30 bps)', () => {
    // inAfterFee = 1000 * 9970 / 10000 = 997; 2_000_000 * 997 / 1_000_997 = 1992.0..
    expect(ammOutBase(pool({ taker_fee_percent: 30 }), 1000n)).toBe(1992n);
  });

  test('BigInt and Number inputs agree', () => {
    expect(ammOutBase(pool(), 1000)).toBe(ammOutBase(pool(), 1000n));
  });

  test('non-positive input yields 0', () => {
    expect(ammOutBase(pool(), 0n)).toBe(0n);
    expect(ammOutBase(pool(), -5n)).toBe(0n);
  });

  test('exact on reserves beyond 2^53 (BigInt)', () => {
    const big = pool({ balance_a: '90071992547409930000', balance_b: '90071992547409930000' });
    expect(ammOutBase(big, 1000000000000n)).toBe(
      (90071992547409930000n * 1000000000000n) / (90071992547409930000n + 1000000000000n)
    );
  });
});

describe('ammInBase()', () => {
  test('is the inverse of ammOutBase: the quoted input yields at least the wanted output', () => {
    for (const fee of [0, 30, 100]) {
      const p = pool({ taker_fee_percent: fee });
      for (const want of [1n, 10n, 999n, 123456n, 1999999n]) {
        const need = ammInBase(p, want);
        expect(need).toBeGreaterThan(0n);
        expect(ammOutBase(p, need)).toBeGreaterThanOrEqual(want);
      }
    }
  });

  test('cannot extract the whole reserve or more', () => {
    expect(ammInBase(pool(), 2000000n)).toBe(0n);
    expect(ammInBase(pool(), 3000000n)).toBe(0n);
    expect(ammInBase(pool(), 0n)).toBe(0n);
  });
});

describe('minReceivedBase()', () => {
  test('1% slippage, floored, exact', () => {
    expect(SWAP_SLIPPAGE_BPS).toBe(100);
    expect(minReceivedBase(1000000n)).toBe(990000n);
    expect(minReceivedBase(101n)).toBe(99n); // 99.99 -> 99
    expect(minReceivedBase(0n)).toBe(0n);
  });

  test('custom slippage', () => {
    expect(minReceivedBase(10000n, 50)).toBe(9950n);
  });

  test('is what the UI shows: displayed value === signed value', () => {
    // The old UI rounded with toFixed(), the signed value was floored, so the
    // screen promised a minimum one unit higher than what was signed
    // (outBase 101 @ precision 5: displayed 0.00100, signed 99 units).
    const shown = formatBaseUnits(minReceivedBase(101n), 5, { trim: false });
    expect(shown).toBe('0.00099');
    expect(parseAmountToBaseUnits(shown, 5)).toBe(minReceivedBase(101n));
  });
});

describe('swap amount pipeline (typed string -> exact quote)', () => {
  test('regression: 0.29 @ precision 2 sells 29 units, not 28', () => {
    // Math.floor(0.29 * 100) === 28 — the old swap sold one unit short.
    expect(Math.floor(0.29 * 100)).toBe(28);
    const units = parseAmountToBaseUnits('0.29', 2);
    expect(units).toBe(29n);
    expect(ammOutBase(pool(), units)).toBeGreaterThan(ammOutBase(pool(), 28n));
  });

  test('more decimals than the from-asset supports is refused, not floored away', () => {
    expect(() => parseAmountToBaseUnits('0.299', 2)).toThrow(/at most 2 decimal places/);
  });

  test('whole-number asset (precision 0) is not treated as 5 decimals', () => {
    // the old `precision || 5` turned 0 into 5
    expect(parseAmountToBaseUnits('42', 0)).toBe(42n);
    expect(() => parseAmountToBaseUnits('42.5', 0)).toThrow(/does not support decimal/);
  });

  test('quote displays at full output precision without float conversion', () => {
    const out = ammOutBase(pool(), parseAmountToBaseUnits('0.001', 5)); // 100 units in
    expect(out).toBe(199n); // 2_000_000 * 100 / 1_000_100 = 199.98 -> 199
    expect(formatBaseUnits(out, 5, { trim: false })).toBe('0.00199');
  });
});
