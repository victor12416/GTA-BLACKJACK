import { RANKS, analyzeHand, handValue, formatPct } from './blackjack.js?v=20261003-10';

const $ = (id) => document.getElementById(id);

const state = {
  dealerUp: '',
  playerCards: [],
  reloadMode: false,
  splitMode: false,
  splitHands: [[], []],
  activeHand: 0,
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
const splitButtonWrap = $('splitButtonWrap');
const splitButton = $('splitButton');
const splitTabs = $('splitTabs');
const hand1Tab = $('hand1Tab');
const hand2Tab = $('hand2Tab');
const hand1Preview = $('hand1Preview');
const hand2Preview = $('hand2Preview');

let requestId = 0;
let calcWorker = null;

try {
  if ('Worker' in window) {
    calcWorker = new Worker(new URL('./calculator-worker.js?v=20261003-10', import.meta.url), { type: 'module' });
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

function currentCards() {
  return state.splitMode ? state.splitHands[state.activeHand] : state.playerCards;
}

function siblingCards() {
  return state.splitMode ? state.splitHands[state.activeHand === 0 ? 1 : 0] : [];
}

function activeHandName() {
  return state.splitMode ? `HAND ${state.activeHand + 1}` : '';
}

function pairCanSplit() {
  return !state.splitMode &&
    state.playerCards.length === 2 &&
    state.playerCards[0] === state.playerCards[1];
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
      const cards = currentCards();
      if (cards.length >= 7) return;
      cards.push(rank);
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

function splitPreview(cards) {
  if (!cards.length) return '—';
  if (cards.length === 1) return `${cards[0]} + ?`;
  const hand = handValue(cards);
  return `${cards.join('+')} = ${hand.total}`;
}

function updateSplitControls() {
  const showSplitButton = pairCanSplit();
  splitButtonWrap.classList.toggle('hidden', !showSplitButton);
  splitTabs.classList.toggle('hidden', !state.splitMode);

  if (!state.splitMode) return;

  hand1Tab.classList.toggle('active', state.activeHand === 0);
  hand2Tab.classList.toggle('active', state.activeHand === 1);
  hand1Tab.setAttribute('aria-selected', state.activeHand === 0 ? 'true' : 'false');
  hand2Tab.setAttribute('aria-selected', state.activeHand === 1 ? 'true' : 'false');

  hand1Preview.textContent = splitPreview(state.splitHands[0]);
  hand2Preview.textContent = splitPreview(state.splitHands[1]);
}

function removePlayerCard(index) {
  const cards = currentCards();

  // The first card of each split hand is one of the original pair and cannot
  // disappear from that hand after the physical split has happened.
  if (state.splitMode && index === 0) return;

  cards.splice(index, 1);
  vibrate(8);
  render();
}

function renderPlayerCards() {
  playerCardsEl.replaceChildren();
  const cards = currentCards();

  if (!cards.length) {
    const empty = document.createElement('span');
    empty.className = 'empty-hand';
    empty.textContent = 'Tap your cards below';
    playerCardsEl.appendChild(empty);
    return;
  }

  cards.forEach((rank, index) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card-chip';
    card.textContent = rank;

    if (state.splitMode && index === 0) {
      card.classList.add('locked');
      card.disabled = true;
      card.title = 'Original split card';
      card.setAttribute('aria-label', `${rank}, original split card`);
    } else {
      card.title = 'Tap to remove';
      card.setAttribute('aria-label', `Remove ${rank} from your hand`);
      card.addEventListener('click', () => removePlayerCard(index));
    }

    playerCardsEl.appendChild(card);
  });
}

function updateHandSummary() {
  const cards = currentCards();
  const prefix = state.splitMode ? `${activeHandName()} • ` : '';

  if (cards.length < 2) {
    handSummary.textContent = prefix + (cards.length ? 'Add next card' : 'Add 2 cards');
    return;
  }

  const hand = handValue(cards);
  if (hand.bust) handSummary.textContent = `${prefix}BUST • ${hand.total}`;
  else if (hand.blackjack) handSummary.textContent = `${prefix}BLACKJACK`;
  else if (hand.charlie) handSummary.textContent = `${prefix}CHARLIE • ${hand.total}`;
  else handSummary.textContent = `${prefix}${hand.soft ? 'SOFT' : 'HARD'} ${hand.total}`;
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
  const cards = currentCards();
  const handPrefix = state.splitMode ? `${activeHandName()} • ` : '';

  if (!state.dealerUp) {
    clearResult('WAITING FOR DEALER', 'Choose the dealer showing card.');
    return;
  }

  if (cards.length < 2) {
    clearResult(
      state.splitMode ? `${activeHandName()} • ADD CARD` : 'WAITING FOR YOUR HAND',
      state.splitMode
        ? 'Add the next card dealt to this split hand.'
        : (cards.length ? 'Add your second card.' : 'Add your first two cards.')
    );
    return;
  }

  resetResultStyle();
  resultLabel.textContent = state.reloadMode
    ? `${handPrefix}RELOAD MODE • CALCULATING`
    : `${handPrefix}CALCULATING`;
  bestMove.textContent = '…';
  bestProbabilities.textContent = 'Checking the best play';

  calculate({
    playerCards: [...cards],
    dealerUp: state.dealerUp,
    otherVisible: [...siblingCards()],
    peekConfirmed: true,
    afterSplit: state.splitMode,
  }, id);
}

function showAnalysis(analysis) {
  if (!analysis) return showCalculationError('No result returned.');

  resetResultStyle();
  const handPrefix = state.splitMode ? `${activeHandName()} • ` : '';

  if (analysis.terminal) {
    resultPanel.classList.add('terminal');
    resultLabel.textContent = `${handPrefix}HAND COMPLETE`;
    bestMove.textContent = analysis.terminal;
    bestProbabilities.textContent = state.splitMode
      ? 'Switch to the other split hand when GTA moves to it.'
      : 'No decision needed.';
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
      resultLabel.textContent = `${handPrefix}RELOAD MODE • DOUBLE AVAILABLE`;
      bestProbabilities.textContent =
        `Win ${formatPct(displayed.win)}   •   Push ${formatPct(displayed.push)}   •   Lose ${formatPct(displayed.loss)} → reload`;
    } else {
      resultLabel.textContent = `${handPrefix}RELOAD MODE • DOUBLE UNAVAILABLE`;
      bestProbabilities.textContent =
        `Fallback: Win ${formatPct(displayed.win)}   •   Push ${formatPct(displayed.push)}   •   Lose ${formatPct(displayed.loss)}`;
    }
    return;
  }

  resultLabel.textContent = state.splitMode ? `${activeHandName()} • READY` : 'READY';
  bestProbabilities.textContent =
    `Win ${formatPct(displayed.win)}   •   Push ${formatPct(displayed.push)}   •   Lose ${formatPct(displayed.loss)}`;
}

function showCalculationError(message) {
  resetResultStyle();
  resultPanel.classList.add('error');
  resultLabel.textContent = state.splitMode ? `${activeHandName()} • CHECK HAND` : 'CHECK HAND';
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

function enterSplitMode() {
  if (!pairCanSplit()) return;

  const [left, right] = state.playerCards;
  state.splitHands = [[left], [right]];
  state.playerCards = [];
  state.splitMode = true;
  state.activeHand = 0;
  vibrate(18);
  render();
}

function selectSplitHand(index) {
  if (!state.splitMode || (index !== 0 && index !== 1)) return;
  state.activeHand = index;
  vibrate(8);
  render();
}

function render() {
  updateDealerButtons();
  updateSplitControls();
  renderPlayerCards();
  updateHandSummary();
  renderResult();
}

function undoLastCard() {
  const cards = currentCards();

  if (state.splitMode) {
    if (cards.length <= 1) return;
    cards.pop();
  } else {
    if (!cards.length) return;
    cards.pop();
  }

  vibrate(8);
  render();
}

function clearPlayerHand() {
  requestId++;
  state.playerCards = [];
  state.splitMode = false;
  state.splitHands = [[], []];
  state.activeHand = 0;
  vibrate(12);
  render();
}

function newHand() {
  requestId++;
  state.dealerUp = '';
  state.playerCards = [];
  state.splitMode = false;
  state.splitHands = [[], []];
  state.activeHand = 0;
  vibrate(16);
  render();
}

reloadMode.addEventListener('change', () => {
  state.reloadMode = reloadMode.checked;
  document.body.classList.toggle('reload-mode', state.reloadMode);
  vibrate(12);
  renderResult();
});

splitButton.addEventListener('click', enterSplitMode);
hand1Tab.addEventListener('click', () => selectSplitHand(0));
hand2Tab.addEventListener('click', () => selectSplitHand(1));

$('undoButton').addEventListener('click', undoLastCard);
$('clearPlayerButton').addEventListener('click', clearPlayerHand);
$('newHandButton').addEventListener('click', newHand);

buildDealerGrid();
buildPlayerGrid();
render();
