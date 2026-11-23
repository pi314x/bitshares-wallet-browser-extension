/**
 * Constant-product AMM math for liquidity_pool_exchange, in integer base units.
 *
 * Constant-product output including price impact and the pool's taker fee,
 * matching how the chain actually fills an exchange. Using the spot rate (as
 * the old quote did) overstates the output for any non-trivial trade, so
 * min_to_receive landed above the real fill and the node rejected it ("Unable
 * to exchange at expected price"). BigInt avoids precision loss on large
 * reserves.
 *
 * Amounts may be passed as BigInt (preferred — exact) or Number.
 */

// Default swap slippage tolerance, in basis points (100 = 1%). The quote
// already accounts for price impact via the constant-product formula, so this
// is a genuine buffer for reserve movement between quote and broadcast — not a
// fudge for impact. Integer bps so min-received is exact, not float * 0.99.
export const SWAP_SLIPPAGE_BPS = 100;

export function poolReserves(pool) {
  const inBase = pool.isAssetAFrom ? BigInt(pool.balance_a) : BigInt(pool.balance_b);
  const outBase = pool.isAssetAFrom ? BigInt(pool.balance_b) : BigInt(pool.balance_a);
  const feeBps = BigInt(parseInt(pool.taker_fee_percent) || 0); // out of 10000 (=100%)
  return { inBase, outBase, feeBps };
}

function toBigInt(v) {
  return typeof v === 'bigint' ? v : BigInt(Math.floor(v));
}

// amountInBase -> amountOutBase
export function ammOutBase(pool, amountInBase) {
  const { inBase, outBase, feeBps } = poolReserves(pool);
  const amtIn = toBigInt(amountInBase);
  if (amtIn <= 0n) return 0n;
  const inAfterFee = amtIn * (10000n - feeBps) / 10000n;
  return outBase * inAfterFee / (inBase + inAfterFee);
}

// desired amountOutBase -> required amountInBase (inverse of ammOutBase)
export function ammInBase(pool, amountOutBase) {
  const { inBase, outBase, feeBps } = poolReserves(pool);
  const amtOut = toBigInt(amountOutBase);
  if (amtOut <= 0n || amtOut >= outBase) return 0n; // can't extract >= the whole reserve
  const inAfterFee = inBase * amtOut / (outBase - amtOut) + 1n; // +1 to cover flooring
  return inAfterFee * 10000n / (10000n - feeBps) + 1n;
}

/**
 * Minimum acceptable output after slippage, floored, exact. The displayed
 * "min received" and the min_to_receive that is signed both come from here, so
 * they can never disagree (the old display rounded with toFixed while the
 * signed value was floored).
 */
export function minReceivedBase(expectedOutBase, slippageBps = SWAP_SLIPPAGE_BPS) {
  return toBigInt(expectedOutBase) * BigInt(10000 - slippageBps) / 10000n;
}
