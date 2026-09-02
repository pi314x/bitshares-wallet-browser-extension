/**
 * Beispieloperationen fuer alle 78 Operationstypen.
 *
 * Ausgelagert, damit sie von zwei Seiten benutzt werden koennen: von der Testsuite und von
 * dem Werkzeug, das die Vergleichswerte aus bitsharesjs erzeugt. Eine Kopie waere hier das
 * Schlimmste -- die beiden liefen auseinander, und der Vergleich pruefte dann zwei
 * verschiedene Operationen gegeneinander, ohne dass es auffiele.
 */
// Auch einzeln exportiert: die Testdatei baut damit die umschliessende Transaktion.
export const fee = { amount: 100000, asset_id: '1.3.0' };
export const ts = '2035-01-01T00:00:00';

const A = '1.2.26807', B = '1.2.26803';
const amt = (n, a = '1.3.0') => ({ amount: n, asset_id: a });
const H = 'a'.repeat(64), BF = 'b'.repeat(64);

export function makeFixtures(PUB) {


  const price = { base: amt(1, '1.3.1'), quote: amt(1) };
  const authority = { weight_threshold: 1, account_auths: [], key_auths: [[PUB, 1]], address_auths: [] };
  const acctOpts = { memo_key: PUB, voting_account: '1.2.5', num_witness: 0, num_committee: 0, votes: [], extensions: [] };
  const assetOpts = { max_supply: 1e12, market_fee_percent: 0, max_market_fee: 0, issuer_permissions: 0, flags: 0,
    core_exchange_rate: price, whitelist_authorities: [], blacklist_authorities: [], whitelist_markets: [], blacklist_markets: [], description: '', extensions: [] };
  const bitOpts = { feed_lifetime_sec: 86400, minimum_feeds: 1, force_settlement_delay_sec: 0, force_settlement_offset_percent: 0, maximum_force_settlement_volume: 0, short_backing_asset: '1.3.0', extensions: [] };
  const feed = { settlement_price: price, maintenance_collateral_ratio: 1750, maximum_short_squeeze_ratio: 1500, core_exchange_rate: price };
  return {
    0:{fee,from:A,to:B,amount:amt(100000)},
    1:{fee,seller:A,amount_to_sell:amt(100000),min_to_receive:amt(5000,'1.3.1'),expiration:ts,fill_or_kill:false},
    2:{fee,fee_paying_account:A,order:'1.7.1'},
    3:{fee,funding_account:A,delta_collateral:amt(100000),delta_debt:amt(100,'1.3.1')},
    4:{fee,order_id:'1.7.1',account_id:A,pays:amt(100),receives:amt(5,'1.3.1')},
    5:{fee,registrar:A,referrer:A,referrer_percent:0,name:'test-acct-1',owner:authority,active:authority,options:acctOpts},
    6:{fee,account:A,new_options:acctOpts},
    7:{fee,authorizing_account:A,account_to_list:B,new_listing:1},
    8:{fee,account_to_upgrade:A,upgrade_to_lifetime_member:true},
    9:{fee,account_id:A,new_owner:B},
    10:{fee,issuer:A,symbol:'TESTAST',precision:5,common_options:assetOpts,bitasset_opts:null,is_prediction_market:false},
    11:{fee,issuer:A,asset_to_update:'1.3.1',new_issuer:null,new_options:assetOpts},
    12:{fee,issuer:A,asset_to_update:'1.3.1',new_options:bitOpts},
    13:{fee,issuer:A,asset_to_update:'1.3.1',new_feed_producers:[A]},
    14:{fee,issuer:A,asset_to_issue:amt(100,'1.3.1'),issue_to_account:B},
    15:{fee,payer:A,amount_to_reserve:amt(100,'1.3.1')},
    16:{fee,from_account:A,asset_id:'1.3.1',amount:1000},
    17:{fee,account:A,amount:amt(100,'1.3.1')},
    18:{fee,issuer:A,asset_to_settle:'1.3.1',settle_price:price},
    19:{fee,publisher:A,asset_id:'1.3.1',feed},
    20:{fee,witness_account:A,url:'http://w',block_signing_key:PUB},
    21:{fee,witness:'1.6.1',witness_account:A,new_url:'http://w2',new_signing_key:PUB},
    22:{fee,fee_paying_account:A,expiration_time:ts,proposed_ops:[[0,{fee,from:A,to:B,amount:amt(1)}]],review_period_seconds:null},
    23:{fee,fee_paying_account:A,proposal:'1.10.1',active_approvals_to_add:[A]},
    24:{fee,fee_paying_account:A,using_owner_authority:false,proposal:'1.10.1'},
    25:{fee,withdraw_from_account:A,authorized_account:B,withdrawal_limit:amt(1000),withdrawal_period_sec:86400,periods_until_expiration:4,period_start_time:ts},
    26:{fee,withdraw_from_account:A,authorized_account:B,permission_to_update:'1.12.1',withdrawal_limit:amt(1000),withdrawal_period_sec:86400,period_start_time:ts,periods_until_expiration:4},
    27:{fee,withdraw_permission:'1.12.1',withdraw_from_account:A,withdraw_to_account:B,amount_to_withdraw:amt(100)},
    28:{fee,withdraw_from_account:A,authorized_account:B,withdrawal_permission:'1.12.1'},
    29:{fee,committee_member_account:A,url:'http://c'},
    30:{fee,committee_member:'1.5.1',committee_member_account:A,new_url:'http://c2'},
    31:{fee,new_parameters:{}},
    32:{fee,creator:A,owner:B,amount:amt(1000),policy:[0,{begin_timestamp:ts,vesting_cliff_seconds:0,vesting_duration_seconds:31536000}]},
    33:{fee,vesting_balance:'1.13.1',owner:A,amount:amt(1000)},
    34:{fee,owner:A,work_begin_date:ts,work_end_date:ts,daily_pay:100000,name:'worker1',url:'http://wk',initializer:[0,{}]},
    35:{fee,payer:A,required_auths:[A],id:0,data:'0011'},
    36:{fee,fee_paying_account:A,predicates:[[0,{account_id:A,name:'x'}]],required_auths:[A]},
    37:{fee,deposit_to_account:A,balance_to_claim:'1.15.1',balance_owner_key:PUB,total_claimed:amt(1000)},
    38:{fee,issuer:A,from:B,to:A,amount:amt(100,'1.3.1')},
    39:{fee,amount:amt(1000),from:A,blinding_factor:BF,outputs:[]},
    40:{fee,inputs:[],outputs:[]},
    41:{fee,amount:amt(1000),to:A,blinding_factor:BF,inputs:[]},
    42:{fee,settlement:'1.4.1',account:A,amount:amt(100,'1.3.1')},
    43:{fee,issuer:A,amount_to_claim:amt(100,'1.3.1'),extensions:{}},
    44:{fee,account_id:A,fba_id:'2.16.1',amount:1000},
    45:{fee,bidder:A,additional_collateral:amt(1000),debt_covered:amt(100,'1.3.1')},
    46:{fee,bidder:A,debt:amt(100,'1.3.1'),collateral:amt(1000)},
    47:{fee,issuer:A,asset_id:'1.3.1',amount_to_claim:amt(100)},
    48:{fee,issuer:A,asset_to_update:'1.3.1',new_issuer:B},
    49:{fee,from:A,to:B,amount:amt(100000),preimage_hash:[2,H],preimage_size:32,claim_period_seconds:3600},
    50:{fee,htlc_id:'1.16.1',redeemer:A,preimage:'00112233'},
    51:{fee,htlc_id:'1.16.1',from:A,to:B,amount:amt(100000)},
    52:{fee,htlc_id:'1.16.1',update_issuer:A,seconds_to_add:3600},
    53:{fee,htlc_id:'1.16.1',to:A},
    54:{fee,account:A,enabled:true,valid_from:ts,valid_to:ts,operation_type:0,auth:authority,restrictions:[]},
    55:{fee,account:A,authority_to_update:'1.17.1',new_enabled:true,restrictions_to_remove:[],restrictions_to_add:[]},
    56:{fee,account:A,authority_to_delete:'1.17.1'},
    57:{fee,account:A,target_type:0,amount:amt(1000)},
    58:{fee,ticket:'1.18.1',account:A,target_type:1,amount_for_new_target:null},
    59:{fee,account:A,asset_a:'1.3.0',asset_b:'1.3.1',share_asset:'1.3.2',taker_fee_percent:10,withdrawal_fee_percent:5},
    60:{fee,account:A,pool:'1.19.0'},
    61:{fee,account:A,pool:'1.19.0',amount_a:amt(1000),amount_b:amt(1000,'1.3.1')},
    62:{fee,account:A,pool:'1.19.0',share_amount:amt(1000,'1.3.2')},
    63:{fee,account:A,pool:'1.19.0',amount_to_sell:amt(100000),min_to_receive:amt(5000,'1.3.1')},
    64:{fee,owner_account:A,asset_type:'1.3.0',balance:100000,fee_rate:10000},
    65:{fee,owner_account:A,fund_id:'1.20.1'},
    66:{fee,owner_account:A,fund_id:'1.20.1',delta_amount:amt(100),new_fee_rate:20000},
    67:{fee,borrower:A,fund_id:'1.20.1',borrow_amount:amt(1000)},
    68:{fee,account:A,fund_id:'1.20.1',repay_amount:amt(1000),fund_fee:amt(10)},
    69:{fee,owner_account:A,asset_type:'1.3.0',balance:100000,fee_rate:10000,max_duration_seconds:86400,min_deal_amount:1000,enabled:true,auto_disable_time:ts,acceptable_collateral:[['1.3.1',price]],acceptable_borrowers:[]},
    70:{fee,owner_account:A,offer_id:'1.21.0'},
    71:{fee,owner_account:A,offer_id:'1.21.0',delta_amount:amt(100),enabled:true},
    72:{fee,borrower:A,offer_id:'1.21.0',borrow_amount:amt(1000),collateral:amt(2000,'1.3.1'),max_fee_rate:20000,min_duration_seconds:3600},
    73:{fee,account:A,deal_id:'1.22.0',repay_amount:amt(1000),credit_fee:amt(10)},
    74:{fee,deal_id:'1.22.1',offer_id:'1.21.1',offer_owner:A,borrower:B,unpaid_amount:amt(100),collateral:amt(200,'1.3.1'),fee_rate:10000},
    75:{fee,account:A,pool:'1.19.0',taker_fee_percent:12,withdrawal_fee_percent:6},
    76:{fee,account:A,deal_id:'1.22.0',auto_repay:1},
    77:{fee,seller:A,order:'1.7.1',new_price:price,delta_amount_to_sell:amt(10),new_expiration:ts},
  };
}
