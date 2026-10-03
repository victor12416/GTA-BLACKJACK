import { RANKS, analyzeHand, handValue, formatEV, formatPct } from './blackjack.js?v=20261003-7';

const $ = (id) => document.getElementById(id);

const state = {
  dealerUp: '',
  playerCards: [],
};

const dealerValue = $('dealerValue');
const dealerGrid = $('dealerGrid');
const playerGrid = $('playerGrid');
const playerCardsEl = $('playerCards');
const handSummary = $('handSummary');
const resultPanel = $('resultPanel');
const resultLabel = $('resultLabel');
const remainingCount = $('remainingCount');
const bestMove = $('bestMove');
const bestProbabilities = $('bestProbabilities');
const actionEvs = $('actionEvs');
const resultNote = $('resultNote');

let requestId = 0;
let calcWorker = null;

try {
  if ('Worker' in window) {
    calcWorker = new Worker(new URL('./calculator-worker.js?v=20261003-7', import.meta.url), { type: 'module' });
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
    empty.textContent = 'No cards yet';
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
    handSummary.textContent = state.playerCards.length ? 'Add 1 more card' : 'Add 2 cards';
    return;
  }

  const hand = handValue(state.playerCards);
  if (hand.bust) handSummary.textContent = `BUST • ${hand.total}`;
  else if (hand.blackjack) handSummary.textContent = 'BLACKJACK';
  else if (hand.charlie) handSummary.textContent = `7-CARD CHARLIE • ${hand.total}`;
  else handSummary.textContent = `${hand.soft ? 'SOFT' : 'HARD'} ${hand.total}`;
}

function clearResult(label, text) {
  resultPanel.classList.remove('has-result', 'terminal', 'error');
  resultLabel.textContent = label;
  remainingCount.textContent = '';
  bestMove.textContent = '—';
  bestProbabilities.textContent = text;
  actionEvs.replaceChildren();
  resultNote.textContent = '';
}

function renderResult() {
  const id = ++requestId;

  if (!state.dealerUp) {
    clearResult('ENTER DEALER', 'Choose the dealer showing card.');
    return;
  }

  if (state.playerCards.length < 2) {
    clearResult('ENTER YOUR HAND', state.playerCards.length ? 'Add your second card.' : 'Add your first two cards.');
    return;
  }

  resultPanel.classList.remove('terminal', 'error');
  resultLabel.textContent = 'CALCULATING';
  remainingCount.textContent = '';
  bestMove.textContent = '…';
  bestProbabilities.textContent = 'Running GTA probability tree';
  actionEvs.replaceChildren();
  resultNote.textContent = '';

  calculate({
    playerCards: [...state.playerCards],
    dealerUp: state.dealerUp,
    otherVisible: [],
    peekConfirmed: true,
  }, id);
}

function actionShortName(name) {
  return ({ HIT: 'H', STAND: 'S', DOUBLE: 'D', SPLIT: 'P' })[name] || name[0] || '?';
}

function showAnalysis(analysis) {
  if (!analysis) return showCalculationError('No result returned.');

  remainingCount.textContent = `${analysis.remaining} unseen`;
  resultPanel.classList.remove('error');

  if (analysis.terminal) {
    resultPanel.classList.remove('has-result');
    resultPanel.classList.add('terminal');
    resultLabel.textContent = 'HAND RESULT';
    bestMove.textContent = analysis.terminal;
    bestProbabilities.textContent = 'No decision needed.';
    actionEvs.replaceChildren();
    resultNote.textContent = '';
    return;
  }

  resultPanel.classList.remove('terminal');
  resultPanel.classList.add('has-result');
  resultLabel.textContent = 'BEST MOVE';
  bestMove.textContent = analysis.best;

  const best = analysis.actions[analysis.best];
  bestProbabilities.textContent =
    `Win ${formatPct(best.win)} • Push ${formatPct(best.push)} • Lose ${formatPct(best.loss)}`;

  actionEvs.replaceChildren();
  for (const [name, metric] of Object.entries(analysis.actions)) {
    const pill = document.createElement('span');
    pill.className = `ev-pill${name === analysis.best ? ' best' : ''}`;
    pill.innerHTML = `<b>${actionShortName(name)}</b> ${formatEV(metric.ev)}`;
    pill.title = `${name}: EV ${formatEV(metric.ev)}`;
    actionEvs.appendChild(pill);
  }

  resultNote.textContent =
    analysis.splitAvailable && analysis.splitNote
      ? 'P = Split • split EV uses the fast GTA four-deck estimate'
      : 'Tap another card below immediately after every HIT';
}

function showCalculationError(message) {
  resultPanel.classList.remove('has-result', 'terminal');
  resultPanel.classList.add('error');
  resultLabel.textContent = 'CHECK HAND';
  remainingCount.textContent = '';
  bestMove.textContent = 'ERROR';
  bestProbabilities.textContent = message || 'Could not calculate this hand.';
  actionEvs.replaceChildren();
  resultNote.textContent = '';
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

$('undoButton').addEventListener('click', undoLastCard);
$('clearPlayerButton').addEventListener('click', clearPlayerHand);
$('newHandButton').addEventListener('click', newHand);

buildDealerGrid();
buildPlayerGrid();
render();
