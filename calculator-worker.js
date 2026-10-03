import { analyzeHand } from './blackjack.js?v=20261003-6';

self.addEventListener('message', (event) => {
  const { id, input } = event.data || {};
  try {
    const analysis = analyzeHand(input);
    self.postMessage({ id, analysis });
  } catch (err) {
    self.postMessage({ id, error: err?.message || 'Could not calculate this hand.' });
  }
});
