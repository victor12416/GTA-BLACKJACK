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

function dealerMemoKey(cards, counts){
  const hv = handValue(cards);
  return `${hv.total}|${hv.soft?1:0}|${cards.length}|${counts.join(',')}`;
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

function standMetric(playerCards, counts, dealerUp, hole, memo){
  const ph = handValue(playerCards);
  if(ph.bust) return terminalMetric('loss');
  if(ph.charlie) return terminalMetric('win');

  const dealerDist = dealerDistribution([dealerUp,hole], counts, memo.dealer);
  const out = emptyMetric();
  for(const [key,p] of Object.entries(dealerDist)){
    if(!p) continue;
    let result;
    if(key === 'bust') result = 'win';
    else {
      const dt = Number(key);
      result = ph.total > dt ? 'win' : ph.total === dt ? 'push' : 'loss';
    }
    addMetric(out, terminalMetric(result), p);
  }
  return out;
}

function playerStateKey(cards, counts, dealerUp, hole){
  const sorted = cards.map(normalizeRank).sort((a,b)=>idx(a)-idx(b)).join('-');
  return `${sorted}|${counts.join(',')}|${dealerUp}|${hole}`;
}

function chooseBest(a,b){
  if(b.ev > a.ev + 1e-12) return b;
  return a;
}

function optimalAfterHit(playerCards, counts, dealerUp, hole, memo){
  const hv = handValue(playerCards);
  if(hv.bust) return terminalMetric('loss');
  if(hv.charlie) return terminalMetric('win');
  if(hv.total === 21) return standMetric(playerCards, counts, dealerUp, hole, memo);

  const key = playerStateKey(playerCards, counts, dealerUp, hole);
  if(memo.player.has(key)) return memo.player.get(key);

  const stand = standMetric(playerCards, counts, dealerUp, hole, memo);
  const hit = hitMetric(playerCards, counts, dealerUp, hole, memo);
  const best = chooseBest(stand, hit);
  memo.player.set(key,best);
  return best;
}

function hitMetric(playerCards, counts, dealerUp, hole, memo){
  const n = sum(counts);
  const out = emptyMetric();
  for(let i=0;i<RANKS.length;i++){
    if(counts[i] <= 0) continue;
    const p = counts[i]/n;
    counts[i]--;
    const next = [...playerCards,RANKS[i]];
    const hv = handValue(next);
    let sub;
    if(hv.bust) sub = terminalMetric('loss');
    else if(hv.charlie) sub = terminalMetric('win');
    else sub = optimalAfterHit(next, counts, dealerUp, hole, memo);
    counts[i]++;
    addMetric(out,sub,p);
  }
  return out;
}

function doubleMetric(playerCards, counts, dealerUp, hole, memo){
  const n = sum(counts);
  const out = emptyMetric();
  for(let i=0;i<RANKS.length;i++){
    if(counts[i] <= 0) continue;
    const p = counts[i]/n;
    counts[i]--;
    const next = [...playerCards,RANKS[i]];
    const hv = handValue(next);
    let sub;
    if(hv.bust) sub = terminalMetric('loss',2);
    else {
      const base = standMetric(next, counts, dealerUp, hole, memo);
      sub = {...base, ev: base.ev*2};
    }
    counts[i]++;
    addMetric(out,sub,p);
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

function averageOverHole(publicCounts, dealerUp, peekConfirmed, actionFn){
  const allowed = allowedHoleIndexes(dealerUp, peekConfirmed).filter(i=>publicCounts[i] > 0);
  const denom = allowed.reduce((s,i)=>s+publicCounts[i],0);
  if(denom <= 0) throw new Error('No valid dealer hole cards remain.');
  const total = emptyMetric();
  for(const i of allowed){
    const pHole = publicCounts[i]/denom;
    const counts = cloneCounts(publicCounts);
    counts[i]--;
    const memo = {dealer:new Map(),player:new Map()};
    const sub = actionFn(counts,RANKS[i],memo);
    addMetric(total,sub,pHole);
  }
  return total;
}

export function analyzeHand({playerCards,dealerUp,otherVisible=[],peekConfirmed=true}){
  if(!Array.isArray(playerCards) || playerCards.length < 2) throw new Error('Enter at least two player cards.');
  if(!dealerUp) throw new Error('Choose the dealer upcard.');
  const normalizedPlayer = playerCards.map(normalizeRank);
  const d = normalizeRank(dealerUp);
  const publicCounts = makePublicShoe(normalizedPlayer,d,otherVisible.map(normalizeRank));
  const ph = handValue(normalizedPlayer);

  if(ph.bust){
    return {hand:ph,remaining:sum(publicCounts),terminal:'BUST',actions:{},best:null,splitAvailable:false};
  }
  if(ph.blackjack){
    return {hand:ph,remaining:sum(publicCounts),terminal:'BLACKJACK',actions:{},best:null,splitAvailable:false};
  }
  if(ph.charlie){
    return {hand:ph,remaining:sum(publicCounts),terminal:'SEVEN-CARD CHARLIE',actions:{},best:null,splitAvailable:false};
  }

  const stand = averageOverHole(publicCounts,d,peekConfirmed,(counts,hole,memo)=>standMetric(normalizedPlayer,counts,d,hole,memo));
  const hit = averageOverHole(publicCounts,d,peekConfirmed,(counts,hole,memo)=>hitMetric(normalizedPlayer,counts,d,hole,memo));
  const actions = {STAND:stand,HIT:hit};
  if(normalizedPlayer.length === 2){
    actions.DOUBLE = averageOverHole(publicCounts,d,peekConfirmed,(counts,hole,memo)=>doubleMetric(normalizedPlayer,counts,d,hole,memo));
  }

  let best = Object.entries(actions)[0];
  for(const entry of Object.entries(actions)) if(entry[1].ev > best[1].ev) best = entry;

  const splitAvailable = normalizedPlayer.length === 2 && rankValue(normalizedPlayer[0]) === rankValue(normalizedPlayer[1]);
  return {
    hand:ph,
    remaining:sum(publicCounts),
    actions,
    best:best[0],
    splitAvailable,
    splitNote: splitAvailable ? 'Pair detected. Exact split EV is not included in this first engine build yet.' : null,
    rules:{decks:4,shuffleEveryHand:true,dealerStandsSoft17:true,blackjackPayout:1.5,sevenCardCharlie:true}
  };
}

export function formatPct(x){ return `${(x*100).toFixed(1)}%`; }
export function formatEV(x){ return `${x>=0?'+':''}${x.toFixed(3)}`; }
