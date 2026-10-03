import { RANKS, analyzeHand, handValue, formatEV, formatPct } from './blackjack.js?v=20261003-6';

const $ = (id) => document.getElementById(id);

const state = {
  dealerUp: '',
  playerCards: [],
  target: 'dealer',
};

const dealerPanel = $('dealerPanel');
const playerPanel = $('playerPanel');
const dealerCard = $('dealerCard');
const dealerHint = $('dealerHint');
const playerCardsEl = $('playerCards');
const handSummary = $('handSummary');
const resultPanel = $('resultPanel');
const resultLabel = $('resultLabel');
const remainingCount = $('remainingCount');
const bestMove = $('bestMove');
const bestProbabilities = $('bestProbabilities');
const actionEvs = $('actionEvs');
const resultNote = $('resultNote');
const entryTarget = $('entryTarget');
const switchTargetButton = $('switchTargetButton');

let requestId = 0;
let calcWorker = null;

try {
  if ('Worker' in window) {
    calcWorker = new Worker(new URL('./calculator-worker.js?v=20261003-6', import.meta.url), { type: 'module' });
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

function vibrate(ms = 12) {
  try { navigator.vibrate?.(ms); } catch {}
}

function setTarget(target) {
  if (target === 'player' && !state.dealerUp) target = 'dealer';
  state.target = target;
  renderStatic();
}

function addRank(rank) {
  vibrate();

  if (state.target === 'dealer') {
    state.dealerUp = rank;
    state.target = 'player';
  } else if (state.playerCards.length < 7) {
    state.playerCards.push(rank);
  }

  render();
}

function removePlayerCard(index) {
  if (index < 0 || index >= state.playerCards.length) return;
  state.playerCards.splice(index, 1);
  state.target = state.dealerUp ? 'player' : 'dealer';
  vibrate(8);
  render();
}

function undo() {
  vibrate(8);
  if (state.playerCards.length) {
    state.playerCards.pop();
    state.target = 'player';
  } else if (state.dealerUp) {
    state.dealerUp = '';
    state.target = 'dealer';
  }
  render();
}

function newHand() {
  requestId++;
  state.dealerUp = '';
  state.playerCards.length = 0;
  state.target = 'dealer';
  vibrate(18);
  render();
}

function handSummaryText() {
  if (!state.dealerUp) return 'Waiting for dealer';
  if (!state.playerCards.length) return 'Tap your first card';
  if (state.playerCards.length < 2) return 'Tap your second card';

  const h = handValue(state.playerCards);
  if (h.bust) return `Bust • ${h.total}`;
  if (h.blackjack) return 'Blackjack';
  if (h.charlie) return `7-card Charlie • ${h.total}`;
  return `${h.soft ? 'Soft' : 'Hard'} ${h.total} • ${state.playerCards.length} cards`;
}

function renderPlayerCards() {
  playerCardsEl.replaceChildren();

  if (!state.playerCards.length) {
    playerCardsEl.textContent = '—';
    return;
  }

  state.playerCards.forEach((rank, index) => {
    const card = document.createElement('span');
    card.className = 'mini-card';
    card.textContent = rank;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Remove player card ${rank}`);
    card.addEventListener('click', (event) => {
      event.stopPropagation();
      removePlayerCard(index);
    });
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        removePlayerCard(index);
      }
    });
    playerCardsEl.appendChild(card);
  });
}

function renderStatic() {
  dealerCard.textContent = state.dealerUp || '?';
  dealerHint.textContent = state.dealerUp ? 'Tap to edit dealer' : 'Tap a rank below';
  handSummary.textContent = handSummaryText();
  renderPlayerCards();

  dealerPanel.classList.toggle('active', state.target === 'dealer');
  playerPanel.classList.toggle('active', state.target === 'player');
  entryTarget.textContent = state.target === 'dealer' ? 'DEALER CARD' : 'YOUR NEXT CARD';
  switchTargetButton.textContent = state.target === 'dealer' ? 'ENTER YOUR CARDS' : 'EDIT DEALER';
  switchTargetButton.disabled = !state.dealerUp && state.target === 'dealer';
}

function clearResult(message, label = 'READY') {
  resultLabel.textContent = label;
  remainingCount.textContent = '';
  bestMove.textContent = '—';
  bestProbabilities.textContent = message;
  actionEvs.replaceChildren();
  resultNote.textContent = '';
  resultPanel.classList.remove('has-result', 'terminal', 'error');
}

function renderResults() {
  const id = ++requestId;

  if (!state.dealerUp) {
    clearResult('Dealer first, then your cards.', 'ENTER DEALER CARD');
    return;
  }

  if (state.playerCards.length < 2) {
    clearResult(
      state.playerCards.length ? 'Tap your second card.' : 'Tap your first card.',
      'ENTER YOUR HAND'
    );
    return;
  }

  resultLabel.textContent = 'CALCULATING';
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

function showCalculationError(message) {
  resultPanel.classList.add('error');
  resultPanel.classList.remove('has-result', 'terminal');
  resultLabel.textContent = 'CHECK HAND';
  remainingCount.textContent = '';
  bestMove.textContent = 'ERROR';
  bestProbabilities.textContent = message || 'Could not calculate this hand.';
  actionEvs.replaceChildren();
  resultNote.textContent = '';
}

function actionShortName(name) {
  return ({ HIT: 'H', STAND: 'S', DOUBLE: 'D', SPLIT: 'P' })[name] || name[0] || '?';
}

function showAnalysis(analysis) {
  if (!analysis) return showCalculationError('No result returned.');

  remainingCount.textContent = `${analysis.remaining} unseen`;
  resultPanel.classList.remove('error');

  if (analysis.terminal) {
    resultPanel.classList.add('terminal');
    resultPanel.classList.remove('has-result');
    resultLabel.textContent = 'HAND RESULT';
    bestMove.textContent = analysis.terminal;
    bestProbabilities.textContent = 'No decision needed.';
    actionEvs.replaceChildren();
    resultNote.textContent = '';
    return;
  }

  resultPanel.classList.add('has-result');
  resultPanel.classList.remove('terminal');
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
    pill.title = `${name} expected value ${formatEV(metric.ev)}`;
    actionEvs.appendChild(pill);
  }

  resultNote.textContent =
    analysis.splitAvailable && analysis.splitNote
      ? 'P = Split • split EV is the fast GTA four-deck estimate'
      : 'EV shown in original-bet units';
}

function calculate(input, id) {
  if (calcWorker) {
    calcWorker.postMessage({ id, input });
    return;
  }

  setTimeout(() => {
    if (id !== requestId) return;
    try { showAnalysis(analyzeHand(input)); }
    catch (err) { showCalculationError(err?.message); }
  }, 0);
}

function render() {
  renderStatic();
  renderResults();
}

function buildRankGrid() {
  const grid = $('rankGrid');
  for (const rank of RANKS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rank-button';
    button.textContent = rank;
    button.setAttribute('aria-label', `Enter ${rank}`);
    button.addEventListener('click', () => addRank(rank));
    grid.appendChild(button);
  }
}

dealerPanel.addEventListener('click', () => setTarget('dealer'));
playerPanel.addEventListener('click', () => setTarget('player'));

switchTargetButton.addEventListener('click', () => {
  if (state.target === 'dealer') setTarget('player');
  else setTarget('dealer');
});

$('undoButton').addEventListener('click', undo);
$('newHandButton').addEventListener('click', newHand);

buildRankGrid();
render();
