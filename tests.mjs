import assert from 'node:assert/strict';
import { analyzeHand, handValue } from './blackjack.js';

assert.deepEqual(handValue(['A','6']), {total:17,soft:true,bust:false,blackjack:false,charlie:false});
assert.equal(handValue(['A','10']).blackjack, true);
assert.equal(handValue(['2','2','2','2','3','3','3']).charlie, true);

const cases = [
  {p:['10','6'], d:'10', expected:'HIT'},
  {p:['6','5'], d:'6', expected:'DOUBLE'},
  {p:['A','7'], d:'9', expected:'HIT'},
  {p:['A','7'], d:'6', expected:'DOUBLE'},
];

for(const c of cases){
  const r = analyzeHand({playerCards:c.p,dealerUp:c.d,peekConfirmed:true});
  assert.equal(r.best,c.expected,`${c.p.join('+')} vs ${c.d}`);
  for(const metric of Object.values(r.actions)){
    assert.ok(Math.abs(metric.win + metric.push + metric.loss - 1) < 1e-8, `${c.p.join('+')} vs ${c.d}`);
  }
}

const splitCases = [
  {p:['A','A'], d:'6', expected:'SPLIT'},
  {p:['8','8'], d:'10', expected:'SPLIT'},
  {p:['10','10'], d:'10', expected:'STAND'},
];
for(const c of splitCases){
  const started = performance.now();
  const r = analyzeHand({playerCards:c.p,dealerUp:c.d,peekConfirmed:true});
  const elapsed = performance.now()-started;
  assert.equal(r.best,c.expected,`${c.p.join('+')} vs ${c.d}`);
  assert.ok(r.actions.SPLIT, 'split metric missing');
  assert.ok(Math.abs(r.actions.SPLIT.win + r.actions.SPLIT.push + r.actions.SPLIT.loss - 1) < 1e-8);
  assert.ok(elapsed < 5000, `split calculation too slow: ${elapsed}ms`);
  console.log(`${c.p.join('+')} vs ${c.d}: ${r.best}, split EV ${r.actions.SPLIT.ev.toFixed(6)}, ${elapsed.toFixed(0)} ms`);
}

const t2v4 = analyzeHand({playerCards:['10','2'],dealerUp:'4',peekConfirmed:true});
assert.equal(t2v4.best,'HIT');

// A hand created by an already-performed split may still double on its first
// two cards, but GTA does not allow re-splitting. Visible cards in the sibling
// split hand must also be removed from the finite shoe.
const afterSplit = analyzeHand({
  playerCards:['8','8'],
  dealerUp:'6',
  otherVisible:['8','5'],
  peekConfirmed:true,
  afterSplit:true,
});
assert.ok(afterSplit.actions.DOUBLE, 'double after split should remain available');
assert.equal(afterSplit.actions.SPLIT, undefined, 're-split must not be offered');
assert.equal(afterSplit.splitAvailable, false);
assert.equal(afterSplit.remaining, 203, 'sibling split-hand cards must be removed from the shoe');

console.log('All blackjack engine tests passed.');
