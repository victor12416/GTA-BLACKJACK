import { RANKS, analyzeHand, handValue, formatPct } from './blackjack.js?v=20261003-9';

const $ = (id) => document.getElementById(id);

const state = {
  dealerUp: '',
  playerCards: [],
  reloadMode: false,
};

const dealerValue = $('dealerValue');
const dealerGrid = $('dealerGrid');
const playerGrid = $('playerGrid');
const playerCardsEl = $('playerCards');
const handSummary = $('handSummary');
const resultPanel = $('resultPanel');
const resultLabel = $('resultLabel');
const bestMove = $('bestMove');
const bestProbabilities = $('bestProbabilities');
const reloadMode = $('reloadMode');

let requestId = 0;
let calcWorker = null;

try {
  if ('Worker' in window) {
    calcWorker = new Worker(new URL('./calculator-worker.js?v=20261003-9', import.meta.url), { type: 'module' });
    calcWorker.addEventListener('message', (event) => {
      const { id, analysis, error } = event.data || {};
      if (id !== requestId) return;
      if (error) showCalculationError(error);
      else showAnalysis(analysis);
    });
    calcWorker.addEventListener('error', () => {
      calcWorker?.terminate();
      calcWorker = null;
    });
  }
} catch {
  calcWorker = null;
}

function vibrate(ms = 10) {
  try { navigator.vibrate?.(ms); } catch {}
}

function createRankButton(rank, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rank-button';
  button.textContent = rank;
  button.dataset.rank = rank;
  button.addEventListener('click', onClick);
  return button;
}

function buildDealerGrid() {
  for (const rank of RANKS) {
    dealerGrid.appendChild(createRankButton(rank, () => {
      state.dealerUp = rank;
      vibrate(10);
      render();
    }));
  }
}

function buildPlayerGrid() {
  for (const rank of RANKS) {
    playerGrid.appendChild(createRankButton(rank, () => {
      if (state.playerCards.length >= 7) return;
      state.playerCards.push(rank);
      vibrate(10);
      render();
    }));
  }
}

function updateDealerButtons() {
  for (const button of dealerGrid.querySelectorAll('.rank-button')) {
    button.classList.toggle('selected', button.dataset.rank === state.dealerUp);
  }
  dealerValue.textContent = state.dealerUp || '—';
}

function removePlayerCard(index) {
  state.playerCards.splice(index, 1);
  vibrate(8);
  render();
}

function renderPlayerCards() {
  playerCardsEl.replaceChildren();

  if (!state.playerCards.length) {
    const empty = document.createElement('span');
    empty.className = 'empty-hand';
    empty.textContent = 'Tap your cards below';
    playerCardsEl.appendChild(empty);
    return;
  }

  state.playerCards.forEach((rank, index) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card-chip';
    card.textContent = rank;
    card.title = 'Tap to remove';
    card.setAttribute('aria-label', `Remove ${rank} from your hand`);
    card.addEventListener('click', () => removePlayerCard(index));
    playerCardsEl.appendChild(card);
  });
}

function updateHandSummary() {
  if (state.playerCards.length < 2) {
    handSummary.textContent = state.playerCards.length ? 'Add 1 more' : 'Add 2 cards';
    return;
  }

  const hand = handValue(state.playerCards);
  if (hand.bust) handSummary.textContent = `BUST • ${hand.total}`;
  else if (hand.blackjack) handSummary.textContent = 'BLACKJACK';
  else if (hand.charlie) handSummary.textContent = `CHARLIE • ${hand.total}`;
  else handSummary.textContent = `${hand.soft ? 'SOFT' : 'HARD'} ${hand.total}`;
}

function resetResultStyle() {
  delete resultPanel.dataset.move;
  resultPanel.classList.remove('terminal', 'error', 'has-result', 'reload-choice');
}

function clearResult(status, text) {
  resetResultStyle();
  resultLabel.textContent = status;
  bestMove.textContent = '—';
  bestProbabilities.textContent = text;
}

function renderResult() {
  const id = ++requestId;

  if (!state.dealerUp) {
    clearResult('WAITING FOR DEALER', 'Choose the dealer showing card.');
    return;
  }

  if (state.playerCards.length < 2) {
    clearResult(
      'WAITING FOR YOUR HAND',
      state.playerCards.length ? 'Add your second card.' : 'Add your first two cards.'
    );
    return;
  }

  resetResultStyle();
  resultLabel.textContent = state.reloadMode ? 'RELOAD MODE • CALCULATING' : 'CALCULATING';
  bestMove.textContent = '…';
  bestProbabilities.textContent = 'Checking the best play';

  calculate({
    playerCards: [...state.playerCards],
    dealerUp: state.dealerUp,
    otherVisible: [],
    peekConfirmed: true,
  }, id);
}

function showAnalysis(analysis) {
  if (!analysis) return showCalculationError('No result returned.');

  resetResultStyle();

  if (analysis.terminal) {
    resultPanel.classList.add('terminal');
    resultLabel.textContent = 'HAND COMPLETE';
    bestMove.textContent = analysis.terminal;
    bestProbabilities.textContent = 'No decision needed.';
    return;
  }

  const doubleAvailable = Boolean(analysis.actions?.DOUBLE);
  const displayedMove = state.reloadMode && doubleAvailable ? 'DOUBLE' : analysis.best;
  const displayed = analysis.actions[displayedMove];

  resultPanel.classList.add('has-result');
  resultPanel.dataset.move = displayedMove;
  bestMove.textContent = displayedMove;

  if (state.reloadMode) {
    resultPanel.classList.add('reload-choice');
    if (doubleAvailable) {
      resultLabel.textContent = 'RELOAD MODE • DOUBLE AVAILABLE';
      bestProbabilities.textContent =
        `Win ${formatPct(displayed.win)}   •   Push ${formatPct(displayed.push)}   •   Lose ${formatPct(displayed.loss)} → reload`;
    } else {
      resultLabel.textContent = 'RELOAD MODE • DOUBLE UNAVAILABLE';
      bestProbabilities.textContent =
        `Fallback: Win ${formatPct(displayed.win)}   •   Push ${formatPct(displayed.push)}   •   Lose ${formatPct(displayed.loss)}`;
    }
    return;
  }

  resultLabel.textContent = 'READY';
  bestProbabilities.textContent =
    `Win ${formatPct(displayed.win)}   •   Push ${formatPct(displayed.push)}   •   Lose ${formatPct(displayed.loss)}`;
}

function showCalculationError(message) {
  resetResultStyle();
  resultPanel.classList.add('error');
  resultLabel.textContent = 'CHECK HAND';
  bestMove.textContent = 'ERROR';
  bestProbabilities.textContent = message || 'Could not calculate this hand.';
}

function calculate(input, id) {
  if (calcWorker) {
    calcWorker.postMessage({ id, input });
    return;
  }

  setTimeout(() => {
    if (id !== requestId) return;
    try {
      showAnalysis(analyzeHand(input));
    } catch (err) {
      showCalculationError(err?.message);
    }
  }, 0);
}

function render() {
  updateDealerButtons();
  renderPlayerCards();
  updateHandSummary();
  renderResult();
}

function undoLastCard() {
  if (!state.playerCards.length) return;
  state.playerCards.pop();
  vibrate(8);
  render();
}

function clearPlayerHand() {
  requestId++;
  state.playerCards.length = 0;
  vibrate(12);
  render();
}

function newHand() {
  requestId++;
  state.dealerUp = '';
  state.playerCards.length = 0;
  vibrate(16);
  render();
}

reloadMode.addEventListener('change', () => {
  state.reloadMode = reloadMode.checked;
  document.body.classList.toggle('reload-mode', state.reloadMode);
  vibrate(12);
  renderResult();
});

$('undoButton').addEventListener('click', undoLastCard);
$('clearPlayerButton').addEventListener('click', clearPlayerHand);
$('newHandButton').addEventListener('click', newHand);

buildDealerGrid();
buildPlayerGrid();
render();
