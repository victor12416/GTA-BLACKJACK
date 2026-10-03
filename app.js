import { RANKS, analyzeHand, handValue, formatEV, formatPct } from './blackjack.js';

const state = { playerCards: [], otherCards: [] };
const $ = (id) => document.getElementById(id);

const dealerUp = $('dealerUp');
const playerCardsEl = $('playerCards');
const otherCardsEl = $('otherCards');
const handSummary = $('handSummary');
const emptyState = $('emptyState');
const results = $('results');
const bestMove = $('bestMove');
const bestEv = $('bestEv');
const actionCards = $('actionCards');
const splitWarning = $('splitWarning');
const remainingCount = $('remainingCount');
const detectorStatus = $('detectorStatus');

function rankButton(rank, onClick){
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = rank;
  b.setAttribute('aria-label', `Add ${rank}`);
  b.addEventListener('click', onClick);
  return b;
}

function buildRankGrid(container, target){
  RANKS.forEach(rank => container.appendChild(rankButton(rank, () => {
    state[target].push(rank);
    render();
  })));
}

function renderChips(container, cards, target){
  container.replaceChildren();
  cards.forEach((rank, i) => {
    const chip = document.createElement('span');
    chip.className = 'card-chip';
    const text = document.createElement('span');
    text.textContent = rank;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${rank}`);
    remove.addEventListener('click', () => {
      state[target].splice(i,1);
      render();
    });
    chip.append(text, remove);
    container.appendChild(chip);
  });
}

function updateHandSummary(){
  if(state.playerCards.length < 2){
    handSummary.textContent = 'Add at least 2 cards';
    return;
  }
  const h = handValue(state.playerCards);
  if(h.bust) handSummary.textContent = `Bust • ${h.total}`;
  else if(h.blackjack) handSummary.textContent = 'Blackjack';
  else if(h.charlie) handSummary.textContent = `7-card Charlie • ${h.total}`;
  else handSummary.textContent = `${h.soft ? 'Soft' : 'Hard'} ${h.total} • ${state.playerCards.length} cards`;
}

function makeProb(label, value){
  const el = document.createElement('div');
  el.className = 'prob';
  el.innerHTML = `<span>${label}</span><strong>${formatPct(value)}</strong>`;
  return el;
}

function renderResults(){
  remainingCount.textContent = '';
  if(!dealerUp.value || state.playerCards.length < 2){
    emptyState.classList.remove('hidden');
    results.classList.add('hidden');
    return;
  }

  try {
    const analysis = analyzeHand({
      playerCards: state.playerCards,
      dealerUp: dealerUp.value,
      otherVisible: state.otherCards,
      peekConfirmed: true,
    });

    remainingCount.textContent = `${analysis.remaining} unseen`;
    emptyState.classList.add('hidden');
    results.classList.remove('hidden');

    if(analysis.terminal){
      bestMove.textContent = analysis.terminal;
      bestEv.textContent = 'The game resolves automatically.';
      actionCards.replaceChildren();
      splitWarning.classList.add('hidden');
      return;
    }

    bestMove.textContent = analysis.best;
    bestEv.textContent = `Expected value: ${formatEV(analysis.actions[analysis.best].ev)} bets`;
    actionCards.replaceChildren();

    for(const [name, metric] of Object.entries(analysis.actions)){
      const card = document.createElement('article');
      card.className = `action-card${name === analysis.best ? ' best' : ''}`;
      const top = document.createElement('div');
      top.className = 'action-top';
      top.innerHTML = `<span class="action-name">${name}</span><span class="action-ev">EV ${formatEV(metric.ev)}</span>`;
      const probs = document.createElement('div');
      probs.className = 'probs';
      probs.append(makeProb('Win', metric.win), makeProb('Push', metric.push), makeProb('Lose', metric.loss));
      card.append(top, probs);
      actionCards.appendChild(card);
    }

    if(analysis.splitAvailable){
      splitWarning.textContent = analysis.splitNote;
      splitWarning.classList.remove('hidden');
    } else {
      splitWarning.classList.add('hidden');
    }
  } catch(err){
    emptyState.textContent = err?.message || 'Could not calculate this hand.';
    emptyState.classList.add('error');
    emptyState.classList.remove('hidden');
    results.classList.add('hidden');
  }
}

function render(){
  emptyState.classList.remove('error');
  emptyState.textContent = 'Enter the dealer upcard and at least two player cards.';
  renderChips(playerCardsEl, state.playerCards, 'playerCards');
  renderChips(otherCardsEl, state.otherCards, 'otherCards');
  updateHandSummary();
  renderResults();
}

buildRankGrid($('rankGrid'), 'playerCards');
buildRankGrid($('otherRankGrid'), 'otherCards');
dealerUp.addEventListener('change', render);

$('resetButton').addEventListener('click', () => {
  state.playerCards.length = 0;
  state.otherCards.length = 0;
  dealerUp.value = '';
  $('screenshotInput').value = '';
  $('previewWrap').classList.add('hidden');
  $('screenshotPreview').removeAttribute('src');
  detectorStatus.textContent = 'Image upload is ready. Automatic card recognition is the next layer; for now confirm the ranks below.';
  render();
});

$('screenshotInput').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if(!file) return;
  if(!file.type.startsWith('image/')){
    detectorStatus.textContent = 'That file is not an image.';
    return;
  }
  const url = URL.createObjectURL(file);
  const img = $('screenshotPreview');
  const old = img.dataset.objectUrl;
  if(old) URL.revokeObjectURL(old);
  img.dataset.objectUrl = url;
  img.src = url;
  $('previewWrap').classList.remove('hidden');
  detectorStatus.textContent = 'Screenshot loaded locally on your device. Automatic rank detection will plug into this step next.';
});

render();
