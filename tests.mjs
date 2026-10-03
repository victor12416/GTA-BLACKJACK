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
  {p:['10','10'], d:'10', expected:'STAND'},
];

for(const c of cases){
  const r = analyzeHand({playerCards:c.p,dealerUp:c.d,peekConfirmed:true});
  assert.equal(r.best,c.expected,`${c.p.join('+')} vs ${c.d}`);
  for(const metric of Object.values(r.actions)){
    assert.ok(Math.abs(metric.win + metric.push + metric.loss - 1) < 1e-9);
  }
}

const t2v4 = analyzeHand({playerCards:['10','2'],dealerUp:'4',peekConfirmed:true});
assert.equal(t2v4.best,'HIT');

console.log('All blackjack engine tests passed.');
