export const RANKS = ['A','2','3','4','5','6','7','8','9','10'];
export const FRESH_SHOE = [16,16,16,16,16,16,16,16,16,64];

function cloneCounts(counts){ return counts.slice(); }
function sum(arr){ return arr.reduce((a,b)=>a+b,0); }
function rankValue(rank){
  if(rank === 'A') return 11;
  if(rank === '10' || rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return Number(rank);
}
function normalizeRank(rank){
  const r = String(rank).toUpperCase();
  return ['10','J','Q','K'].includes(r) ? '10' : r;
}
function idx(rank){ return RANKS.indexOf(normalizeRank(rank)); }

export function handValue(cards){
  let total = 0;
  let aces = 0;
  for(const raw of cards){
    const r = normalizeRank(raw);
    if(r === 'A') aces += 1;
    total += rankValue(r);
  }
  let soft = false;
  while(total > 21 && aces > 0){ total -= 10; aces -= 1; }
  if(aces > 0 && total <= 21) soft = true;
  return {
    total,
    soft,
    bust: total > 21,
    blackjack: cards.length === 2 && total === 21,
    charlie: cards.length >= 7 && total <= 21,
  };
}

export function makePublicShoe(playerCards, dealerUp, otherVisible=[]){
  const counts = cloneCounts(FRESH_SHOE);
  for(const card of [...playerCards, dealerUp, ...otherVisible]){
    const i = idx(card);
    if(i < 0) throw new Error(`Unknown card rank: ${card}`);
    counts[i] -= 1;
    if(counts[i] < 0) throw new Error(`Too many ${normalizeRank(card)} cards entered.`);
  }
  return counts;
}

function addMetric(a,b,w=1){
  a.ev += b.ev*w;
  a.win += b.win*w;
  a.push += b.push*w;
  a.loss += b.loss*w;
  return a;
}
function emptyMetric(){ return {ev:0,win:0,push:0,loss:0}; }
function terminalMetric(result, units=1){
  if(result === 'win') return {ev:units,win:1,push:0,loss:0};
  if(result === 'push') return {ev:0,win:0,push:1,loss:0};
  return {ev:-units,win:0,push:0,loss:1};
}

function pointDist(payoff){ return new Map([[payoff,1]]); }
function mixDist(target, source, weight=1){
  for(const [payoff,p] of source) target.set(payoff,(target.get(payoff)||0)+p*weight);
  return target;
}
function shiftDist(source, amount){
  const out = new Map();
  for(const [payoff,p] of source) out.set(payoff+amount,(out.get(payoff+amount)||0)+p);
  return out;
}
function expectedDist(dist){
  let ev = 0;
  for(const [payoff,p] of dist) ev += payoff*p;
  return ev;
}
function metricFromDist(dist){
  const out = emptyMetric();
  for(const [payoff,p] of dist){
    out.ev += payoff*p;
    if(payoff > 1e-12) out.win += p;
    else if(payoff < -1e-12) out.loss += p;
    else out.push += p;
  }
  return out;
}

function allowedHoleIndexes(dealerUp, peekConfirmed){
  const all = RANKS.map((_,i)=>i);
  if(!peekConfirmed) return all;
  const d = normalizeRank(dealerUp);
  if(d === 'A') return all.filter(i=>RANKS[i] !== '10');
  if(d === '10') return all.filter(i=>RANKS[i] !== 'A');
  return all;
}

function allowedKey(allowed){ return allowed.join('.'); }
function allowedCount(counts, allowed){ return allowed.reduce((s,i)=>s+counts[i],0); }

// The dealer hole card is hidden but constrained by GTA's early-blackjack check.
// `counts` always includes that hidden hole card. Because all other observed cards
// are exchangeable draws from the remaining shoe, the posterior probability that
// the hole is rank i is proportional to the current remaining count of rank i
// within the allowed hole-card ranks.
function drawOptions(counts, allowed){
  const unseen = sum(counts);
  const drawable = unseen - 1; // one unseen card is the dealer hole card
  if(drawable <= 0) return [];
  const aCount = allowedCount(counts, allowed);
  if(aCount <= 0) throw new Error('No valid dealer hole cards remain.');

  const options = [];
  let totalP = 0;
  for(let i=0;i<RANKS.length;i++){
    if(counts[i] <= 0) continue;
    const pHole = allowed.includes(i) ? counts[i]/aCount : 0;
    const expectedDrawableOfRank = counts[i] - pHole;
    if(expectedDrawableOfRank <= 0) continue;
    const p = expectedDrawableOfRank/drawable;
    options.push({i,p});
    totalP += p;
  }
  // Floating-point normalization only; mathematically totalP is exactly 1.
  if(Math.abs(totalP-1) > 1e-12){
    for(const option of options) option.p /= totalP;
  }
  return options;
}

function dealerMemoKey(cards, counts){
  const hv = handValue(cards);
  return `${hv.total}|${hv.soft?1:0}|${counts.join(',')}`;
}

function dealerDistribution(cards, counts, memo){
  const key = dealerMemoKey(cards, counts);
  if(memo.has(key)) return memo.get(key);
  const hv = handValue(cards);
  if(hv.bust){
    const out = {bust:1,17:0,18:0,19:0,20:0,21:0};
    memo.set(key,out); return out;
  }
  // GTA dealer stands on all 17s, including soft 17.
  if(hv.total >= 17){
    const out = {bust:0,17:0,18:0,19:0,20:0,21:0};
    out[hv.total] = 1;
    memo.set(key,out); return out;
  }
  const n = sum(counts);
  const out = {bust:0,17:0,18:0,19:0,20:0,21:0};
  for(let i=0;i<RANKS.length;i++){
    if(counts[i] <= 0) continue;
    const p = counts[i]/n;
    counts[i]--;
    const sub = dealerDistribution([...cards,RANKS[i]], counts, memo);
    counts[i]++;
    for(const k of ['bust','17','18','19','20','21']) out[k] += p*sub[k];
  }
  memo.set(key,out);
  return out;
}

function dealerVisibleDistribution(counts, dealerUp, allowed, memo){
  const key = `${dealerUp}|${allowedKey(allowed)}|${counts.join(',')}`;
  if(memo.dealerVisible.has(key)) return memo.dealerVisible.get(key);

  const aCount = allowedCount(counts, allowed);
  if(aCount <= 0) throw new Error('No valid dealer hole cards remain.');
  const out = {bust:0,17:0,18:0,19:0,20:0,21:0};

  for(const h of allowed){
    if(counts[h] <= 0) continue;
    const pHole = counts[h]/aCount;
    const drawCounts = cloneCounts(counts);
    drawCounts[h]--;
    const sub = dealerDistribution([dealerUp,RANKS[h]],drawCounts,memo.dealer);
    for(const k of ['bust','17','18','19','20','21']) out[k] += pHole*sub[k];
  }
  memo.dealerVisible.set(key,out);
  return out;
}

function standMetric(playerCards, counts, dealerUp, allowed, memo, units=1){
  const ph = handValue(playerCards);
  if(ph.bust) return terminalMetric('loss',units);
  if(ph.charlie) return terminalMetric('win',units);

  const dealerDist = dealerVisibleDistribution(counts,dealerUp,allowed,memo);
  const out = emptyMetric();
  for(const [key,p] of Object.entries(dealerDist)){
    if(!p) continue;
    let result;
    if(key === 'bust') result = 'win';
    else {
      const dt = Number(key);
      result = ph.total > dt ? 'win' : ph.total === dt ? 'push' : 'loss';
    }
    addMetric(out, terminalMetric(result,units), p);
  }
  return out;
}

function playerStateKey(cards, counts){
  const hv = handValue(cards);
  return `${hv.total}|${hv.soft?1:0}|${cards.length}|${counts.join(',')}`;
}

function chooseBestMetric(a,b){ return b.ev > a.ev + 1e-12 ? b : a; }

function optimalAfterHit(playerCards, counts, dealerUp, allowed, memo){
  const hv = handValue(playerCards);
  if(hv.bust) return terminalMetric('loss');
  if(hv.charlie) return terminalMetric('win');
  if(hv.total === 21) return standMetric(playerCards,counts,dealerUp,allowed,memo);

  const key = playerStateKey(playerCards,counts);
  if(memo.player.has(key)) return memo.player.get(key);

  const stand = standMetric(playerCards,counts,dealerUp,allowed,memo);
  const hit = hitMetric(playerCards,counts,dealerUp,allowed,memo);
  const best = chooseBestMetric(stand,hit);
  memo.player.set(key,best);
  return best;
}

function hitMetric(playerCards, counts, dealerUp, allowed, memo){
  const out = emptyMetric();
  for(const {i,p} of drawOptions(counts,allowed)){
    counts[i]--;
    const next = [...playerCards,RANKS[i]];
    const hv = handValue(next);
    let sub;
    if(hv.bust) sub = terminalMetric('loss');
    else if(hv.charlie) sub = terminalMetric('win');
    else sub = optimalAfterHit(next,counts,dealerUp,allowed,memo);
    counts[i]++;
    addMetric(out,sub,p);
  }
  return out;
}

function doubleMetric(playerCards, counts, dealerUp, allowed, memo){
  const out = emptyMetric();
  for(const {i,p} of drawOptions(counts,allowed)){
    counts[i]--;
    const next = [...playerCards,RANKS[i]];
    const hv = handValue(next);
    let sub;
    if(hv.bust) sub = terminalMetric('loss',2);
    else sub = standMetric(next,counts,dealerUp,allowed,memo,2);
    counts[i]++;
    addMetric(out,sub,p);
  }
  return out;
}

function splitStandDist(cards, counts, dealerUp, allowed, memo, units=1){
  const hv = handValue(cards);
  const dealerDist = dealerVisibleDistribution(counts,dealerUp,allowed,memo);
  const out = new Map();
  for(const [key,p] of Object.entries(dealerDist)){
    if(!p) continue;
    let payoff;
    if(key === 'bust') payoff = units;
    else {
      const dt = Number(key);
      payoff = hv.total > dt ? units : hv.total < dt ? -units : 0;
    }
    out.set(payoff,(out.get(payoff)||0)+p);
  }
  return out;
}

function splitOneKey(cards, counts){
  const hv = handValue(cards);
  return `${hv.total}|${hv.soft?1:0}|${cards.length}|${counts.join(',')}`;
}

function splitOneHit(cards, counts, dealerUp, allowed, memo){
  const out = new Map();
  for(const {i,p} of drawOptions(counts,allowed)){
    counts[i]--;
    const next = [...cards,RANKS[i]];
    const hv = handValue(next);
    let sub;
    if(hv.bust) sub = pointDist(-1);
    else if(hv.charlie) sub = pointDist(1);
    else if(hv.total === 21) sub = splitStandDist(next,counts,dealerUp,allowed,memo,1);
    else sub = splitOneDecision(next,counts,dealerUp,allowed,memo);
    counts[i]++;
    mixDist(out,sub,p);
  }
  return out;
}

function splitOneDouble(cards, counts, dealerUp, allowed, memo){
  const out = new Map();
  for(const {i,p} of drawOptions(counts,allowed)){
    counts[i]--;
    const next = [...cards,RANKS[i]];
    const hv = handValue(next);
    const sub = hv.bust ? pointDist(-2) : splitStandDist(next,counts,dealerUp,allowed,memo,2);
    counts[i]++;
    mixDist(out,sub,p);
  }
  return out;
}

function splitOneDecision(cards, counts, dealerUp, allowed, memo){
  const hv = handValue(cards);
  if(hv.bust) return pointDist(-1);
  if(hv.charlie) return pointDist(1);
  if(hv.blackjack) return pointDist(1.5);
  if(hv.total === 21) return splitStandDist(cards,counts,dealerUp,allowed,memo,1);

  const key = splitOneKey(cards,counts);
  if(memo.splitOne.has(key)) return memo.splitOne.get(key);

  const candidates = [splitStandDist(cards,counts,dealerUp,allowed,memo,1)];
  candidates.push(splitOneHit(cards,counts,dealerUp,allowed,memo));
  if(cards.length === 2) candidates.push(splitOneDouble(cards,counts,dealerUp,allowed,memo));

  let best = candidates[0];
  let bestEv = expectedDist(best);
  for(let i=1;i<candidates.length;i++){
    const ev = expectedDist(candidates[i]);
    if(ev > bestEv + 1e-12){ best = candidates[i]; bestEv = ev; }
  }
  memo.splitOne.set(key,best);
  return best;
}

function splitOneStart(baseRank, counts, dealerUp, allowed, memo){
  const key = `start|${baseRank}|${counts.join(',')}`;
  if(memo.splitOne.has(key)) return memo.splitOne.get(key);
  const out = new Map();
  for(const {i,p} of drawOptions(counts,allowed)){
    counts[i]--;
    const cards = [baseRank,RANKS[i]];
    const hv = handValue(cards);
    const sub = hv.blackjack ? pointDist(1.5) : splitOneDecision(cards,counts,dealerUp,allowed,memo);
    counts[i]++;
    mixDist(out,sub,p);
  }
  memo.splitOne.set(key,out);
  return out;
}

function convolveDist(a,b){
  const out = new Map();
  for(const [pa,p1] of a){
    for(const [pb,p2] of b){
      const payoff = pa+pb;
      out.set(payoff,(out.get(payoff)||0)+p1*p2);
    }
  }
  return out;
}

function splitMetric(playerCards, counts, dealerUp, allowed, memo){
  // Fast four-deck approximation used by many combinatorial analyzers: evaluate
  // one post-split hand with the exact visible composition, then combine two
  // identical hand distributions. It preserves GTA-specific DAS, split-blackjack
  // 3:2 payout, hit-after-split (including aces), Seven-Card Charlie, and the
  // dealer peek. It ignores the small dependency created by cards consumed by
  // the first split hand before the second is played.
  const base = normalizeRank(playerCards[0]);
  const one = splitOneStart(base,counts,dealerUp,allowed,memo);
  return metricFromDist(convolveDist(one,one));
}

export function analyzeHand({playerCards,dealerUp,otherVisible=[],peekConfirmed=true,afterSplit=false}){
  if(!Array.isArray(playerCards) || playerCards.length < 2) throw new Error('Enter at least two player cards.');
  if(!dealerUp) throw new Error('Choose the dealer upcard.');

  const normalizedPlayer = playerCards.map(normalizeRank);
  const d = normalizeRank(dealerUp);
  const publicCounts = makePublicShoe(normalizedPlayer,d,otherVisible.map(normalizeRank));
  const ph = handValue(normalizedPlayer);
  const allowed = allowedHoleIndexes(d,peekConfirmed);
  if(allowedCount(publicCounts,allowed) <= 0) throw new Error('No valid dealer hole cards remain.');

  if(ph.bust){
    return {hand:ph,remaining:sum(publicCounts),terminal:'BUST',actions:{},best:null,splitAvailable:false};
  }
  if(ph.blackjack){
    return {hand:ph,remaining:sum(publicCounts),terminal:'BLACKJACK',actions:{},best:null,splitAvailable:false};
  }
  if(ph.charlie){
    return {hand:ph,remaining:sum(publicCounts),terminal:'SEVEN-CARD CHARLIE',actions:{},best:null,splitAvailable:false};
  }

  const memo = {dealer:new Map(),dealerVisible:new Map(),player:new Map(),splitOne:new Map()};
  const stand = standMetric(normalizedPlayer,cloneCounts(publicCounts),d,allowed,memo);
  const hit = hitMetric(normalizedPlayer,cloneCounts(publicCounts),d,allowed,memo);
  const actions = {STAND:stand,HIT:hit};

  if(normalizedPlayer.length === 2){
    actions.DOUBLE = doubleMetric(normalizedPlayer,cloneCounts(publicCounts),d,allowed,memo);
  }

  const splitAvailable = !afterSplit && normalizedPlayer.length === 2 && rankValue(normalizedPlayer[0]) === rankValue(normalizedPlayer[1]);
  if(splitAvailable){
    actions.SPLIT = splitMetric(normalizedPlayer,cloneCounts(publicCounts),d,allowed,memo);
  }

  let best = Object.entries(actions)[0];
  for(const entry of Object.entries(actions)) if(entry[1].ev > best[1].ev + 1e-12) best = entry;

  return {
    hand:ph,
    remaining:sum(publicCounts),
    actions,
    best:best[0],
    splitAvailable,
    splitNote: splitAvailable ? 'Split uses a fast four-deck composition approximation; Hit/Stand/Double are exact.' : null,
    rules:{
      decks:4,
      shuffleEveryHand:true,
      dealerStandsSoft17:true,
      dealerPeeksForBlackjack:peekConfirmed,
      blackjackPayout:1.5,
      splitBlackjackPayout:1.5,
      hitSplitAces:true,
      doubleAfterSplit:true,
      resplit:false,
      afterSplit,
      splitMethod:'independent-hand composition approximation',
      sevenCardCharlie:true
    }
  };
}

export function formatPct(x){ return `${(x*100).toFixed(1)}%`; }
export function formatEV(x){ return `${x>=0?'+':''}${x.toFixed(3)}`; }
