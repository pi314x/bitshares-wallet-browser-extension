/**
 * Serialization + signing coverage for EVERY BitShares operation (ops 0-77).
 *
 * For each op type we build a representative operation, run it through the real
 * serializer (BitSharesAPI.serializeTransaction) and the real ECDSA signer
 * (CryptoUtils via signTransaction), then confirm the signature is canonical
 * and recovers to the signer. This is a client-side pipeline test — it does NOT
 * broadcast — and guards against a serializer regression on any op shape.
 */

import { BitSharesAPI } from '../src/lib/bitshares-api.js';
import { CryptoUtils, sha256, hexToBytes } from '../src/lib/crypto-utils.js';
import { makeFixtures, fee, ts } from './fixtures/operations.js';

const CHAIN_ID = '39f5e2ede1f8bc1a3a54a7914414e3779e33193f1f5693510e73cb7a87617447';

let api, WIF, PUB;
beforeAll(async () => {
  api = new BitSharesAPI();
  api.chainId = CHAIN_ID;
  const keys = await CryptoUtils.generateKeysFromPassword('op-serialize-test', 'pw');
  WIF = keys.active.privateKey;
  PUB = keys.active.publicKey;
});

// Die Beispieloperationen liegen in tests/fixtures/operations.js, damit dieselben Daten
// auch das Werkzeug benutzt, das die bitsharesjs-Vergleichswerte erzeugt.
const buildOps = () => makeFixtures(PUB);

const OP_NAMES = {
  0:'transfer',1:'limit_order_create',2:'limit_order_cancel',3:'call_order_update',4:'fill_order',5:'account_create',
  6:'account_update',7:'account_whitelist',8:'account_upgrade',9:'account_transfer',10:'asset_create',11:'asset_update',
  12:'asset_update_bitasset',13:'asset_update_feed_producers',14:'asset_issue',15:'asset_reserve',16:'asset_fund_fee_pool',
  17:'asset_settle',18:'asset_global_settle',19:'asset_publish_feed',20:'witness_create',21:'witness_update',
  22:'proposal_create',23:'proposal_update',24:'proposal_delete',25:'withdraw_permission_create',26:'withdraw_permission_update',
  27:'withdraw_permission_claim',28:'withdraw_permission_delete',29:'committee_member_create',30:'committee_member_update',
  31:'committee_member_update_global_parameters',32:'vesting_balance_create',33:'vesting_balance_withdraw',34:'worker_create',
  35:'custom',36:'assert',37:'balance_claim',38:'override_transfer',39:'transfer_to_blind',40:'blind_transfer',
  41:'transfer_from_blind',42:'asset_settle_cancel',43:'asset_claim_fees',44:'fba_distribute',45:'bid_collateral',
  46:'execute_bid',47:'asset_claim_pool',48:'asset_update_issuer',49:'htlc_create',50:'htlc_redeem',51:'htlc_redeemed',
  52:'htlc_extend',53:'htlc_refund',54:'custom_authority_create',55:'custom_authority_update',56:'custom_authority_delete',
  57:'ticket_create',58:'ticket_update',59:'liquidity_pool_create',60:'liquidity_pool_delete',61:'liquidity_pool_deposit',
  62:'liquidity_pool_withdraw',63:'liquidity_pool_exchange',64:'samet_fund_create',65:'samet_fund_delete',66:'samet_fund_update',
  67:'samet_fund_borrow',68:'samet_fund_repay',69:'credit_offer_create',70:'credit_offer_delete',71:'credit_offer_update',
  72:'credit_offer_accept',73:'credit_deal_repay',74:'credit_deal_expired',75:'liquidity_pool_update',76:'credit_deal_update',
  77:'limit_order_update',
};

const N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

describe('all operations serialize + sign + recover (ops 0-77)', () => {
  const cases = Array.from({ length: 78 }, (_, t) => [t, OP_NAMES[t]]);

  test.each(cases)('op %i (%s)', async (t) => {
    const OPS = buildOps();
    const tx = { ref_block_num: 1234, ref_block_prefix: 5678, expiration: ts, operations: [[t, OPS[t]]], extensions: [] };

    // Serializes without throwing and yields bytes.
    const serialized = api.serializeTransaction(tx);
    expect(serialized.length).toBeGreaterThan(0);

    // Signs and produces a 65-byte, graphene-canonical, low-S signature.
    const signed = await api.signTransaction(tx, WIF);
    const sig = hexToBytes(signed.signatures[0]);
    expect(sig).toHaveLength(65);
    expect(sig[1]).toBeLessThan(0x80);
    expect(sig[33]).toBeLessThan(0x80);
    const s = BigInt('0x' + CryptoUtils.bytesToHex(sig.slice(33, 65)));
    expect(s <= N / 2n).toBe(true);

    // Signature recovers to the signer (what the chain verifies).
    const digest = await sha256(new Uint8Array([...hexToBytes(CHAIN_ID), ...serialized]));
    expect(await CryptoUtils.verifySignature(digest, sig, WIF)).toBe(true);
  }, 20000);
});

// ---------------------------------------------------------------------------
// Every pq_gated field, not just the ones we remembered.
//
// Three separate bugs of this exact shape have now been found: memo_data.pq_ciphertext,
// witness_create.block_pq_signing_key and witness_update.new_pq_signing_key. Each was a
// field the chain writes an absent-marker for once post-quantum serialization is active,
// which this wallet simply did not write. The effect is not limited to post-quantum
// transactions: EVERY memo, every witness update, would be one byte short, the signature
// would cover different bytes than the node computes, and the operation would be rejected.
//
// So this test enumerates the gated fields from the protocol rather than from memory. If
// the chain gains another one, the list here is what has to grow -- and a serializer that
// ignores it fails on the length check below.
// ---------------------------------------------------------------------------
describe('post-quantum gated fields are all serialized', () => {
  const PK = 'BTS6B1taKXkDojuC1qECjvC7g186d8AdeGtz8wnqWAsoRGC6RY8Rp';

  // name → [serializer method, operation without the PQ field]
  const GATED = {
    'memo_data.pq_ciphertext': ['serializeMemo',
      {from: PK, to: PK, nonce: '1', message: 'deadbeef'}],
    'witness_create.block_pq_signing_key': ['serializeWitnessCreateOp',
      {fee: {amount: 0, asset_id: '1.3.0'}, witness_account: '1.2.100',
       url: 'https://w', block_signing_key: PK}],
    'witness_update.new_pq_signing_key': ['serializeWitnessUpdateOp',
      {fee: {amount: 0, asset_id: '1.3.0'}, witness: '1.6.5', witness_account: '1.2.100'}],
    'account_options.pq_memo_key': ['serializeAccountOptions',
      {memo_key: PK, voting_account: '1.2.5', num_witness: 0, num_committee: 0, votes: []}],
  };

  for (const [feld, [methode, op]] of Object.entries(GATED)) {
    test(`${feld} adds exactly one byte when active and none when not`, () => {
      const api = new BitSharesAPI();

      api.pqSerializationActive = false;
      const legacy = api[methode](op);

      api.pqSerializationActive = true;
      const aktiv = api[methode](op);

      // Genau ein Byte: der Abwesenheitsmarker des optionalen Feldes.
      expect(aktiv.length - legacy.length).toBe(1);
      expect(aktiv[aktiv.length - 1]).toBe(0);
      // Und alles davor unveraendert.
      expect(Buffer.from(aktiv.slice(0, legacy.length)))
        .toEqual(Buffer.from(legacy));
    });
  }
});

// ---------------------------------------------------------------------------
// Agreement with bitsharesjs, not just with ourselves.
//
// The suite above checks that each operation serializes to *something* and that our own
// signature over those bytes recovers to the signer. Wrong bytes pass that effortlessly:
// the signature is computed over the same wrong bytes. That is precisely how the memo
// derivation, the missing pq_ciphertext field and both witness fields survived.
//
// So these vectors come from outside. They were produced by bitsharesjs, which is what the
// reference wallet uses and which is verified against the chain's own serialization, from
// the SAME fixture module this file uses -- a copy of the fixtures would let the two drift
// and silently compare different operations.
//
// Both formats matter. The witness bugs were invisible in legacy, where a gated field
// writes nothing at all; they only appear once post-quantum serialization is active.
// ---------------------------------------------------------------------------
describe('operations match bitsharesjs byte for byte', () => {
  const VEKTOREN = require('./fixtures/bitsharesjs-vectors.json');

  for (const [id, v] of Object.entries(VEKTOREN)) {
    for (const format of ['legacy', 'current']) {
      test(`op ${id} (${v.name}) — ${format}`, () => {
        const api = new BitSharesAPI();
        api.pqSerializationActive = format === 'current';
        const bytes = api.serializeOperationData(Number(id), buildOps()[id]);
        expect(CryptoUtils.bytesToHex(bytes)).toBe(v[format]);
      });
    }
  }
});
