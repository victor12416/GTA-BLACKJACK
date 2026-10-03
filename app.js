import { RANKS, analyzeHand, handValue, formatEV, formatPct } from './blackjack.js';
import { detectVisibleCards } from './card-detector.js';

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
const detectorBadge = $('detectorBadge');
const detectorOverlay = $('detectorOverlay');

let requestId = 0;
let scanId = 0;
let lastDetectionBoxes = [];
let calcWorker = null;

try {
  if('Worker' in window){
    calcWorker = new Worker(new URL('./calculator-worker.js', import.meta.url), {type:'module'});
    calcWorker.addEventListener('message', (event) => {
      const {id, analysis, error} = event.data || {};
      if(id !== requestId) return;
      if(error) showCalculationError(error);
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

function drawDetectorOverlay(boxes=lastDetectionBoxes){
  lastDetectionBoxes = boxes || [];
  const img = $('screenshotPreview');
  if(!detectorOverlay || !img?.src) return;
  const w = Math.max(1, Math.round(img.clientWidth));
  const h = Math.max(1, Math.round(img.clientHeight));
  detectorOverlay.width = w;
  detectorOverlay.height = h;
  const ctx = detectorOverlay.getContext('2d');
  ctx.clearRect(0,0,w,h);
  ctx.lineWidth = Math.max(2, w/320);
  ctx.font = `700 ${Math.max(12,Math.round(w/34))}px system-ui`;
  ctx.textBaseline = 'top';

  for(const box of lastDetectionBoxes){
    const x=box.x*w, y=box.y*h, bw=box.w*w, bh=box.h*h;
    const dealer=box.role==='dealer';
    ctx.strokeStyle = dealer ? '#ffd27a' : '#7de3aa';
    ctx.fillStyle = dealer ? '#ffd27a' : '#7de3aa';
    ctx.strokeRect(x,y,bw,bh);
    const label = `${dealer?'D':'YOU'} ${box.rank||'?'}`;
    const tw=ctx.measureText(label).width+8;
    const th=Math.max(18,Math.round(w/30));
    ctx.fillRect(x,Math.max(0,y-th),tw,th);
    ctx.fillStyle='#07110c';
    ctx.fillText(label,x+4,Math.max(0,y-th)+2);
  }
}

async function runScreenshotDetection(img,id){
  detectorBadge.textContent = 'SCANNING';
  detectorStatus.textContent = 'Finding GTA card shapes…';
  try {
    const detected = await detectVisibleCards(img,{
      onProgress(info){
        if(id!==scanId) return;
        detectorStatus.textContent = info?.message || 'Scanning screenshot…';
      }
    });
    if(id!==scanId) return;
    drawDetectorOverlay(detected.boxes||[]);

    if(detected.ready){
      state.playerCards.splice(0,state.playerCards.length,...detected.playerCards);
      state.otherCards.length = 0;
      dealerUp.value = detected.dealerUp || '';
      detectorBadge.textContent = 'AUTO + CONFIRM';
      const pct=Math.round((detected.confidence||0)*100);
      detectorStatus.textContent = `${detected.message} OCR confidence ${pct}%.`;
      render();
    } else {
      detectorBadge.textContent = 'MANUAL CHECK';
      detectorStatus.textContent = detected.message;
    }
  } catch(err){
    if(id!==scanId) return;
    detectorBadge.textContent = 'MANUAL CHECK';
    detectorStatus.textContent = `Automatic scan unavailable: ${err?.message || 'unknown OCR error'}. Enter the ranks manually below.`;
    drawDetectorOverlay([]);
  }
}

function showCalculationError(message){
  emptyState.textContent = message || 'Could not calculate this hand.';
  emptyState.classList.add('error');
  emptyState.classList.remove('hidden');
  results.classList.add('hidden');
  remainingCount.textContent = '';
}

function showAnalysis(analysis){
  if(!analysis) return showCalculationError('No calculation result returned.');

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
  bestEv.textContent = `Expected value: ${formatEV(analysis.actions[analysis.best].ev)} original-bet units`;
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

  if(analysis.splitAvailable && analysis.splitNote){
    splitWarning.textContent = analysis.splitNote;
    splitWarning.classList.remove('hidden');
  } else {
    splitWarning.classList.add('hidden');
  }
}

function calculate(input, id){
  if(calcWorker){
    calcWorker.postMessage({id,input});
    return;
  }
  // Fallback for browsers that cannot create a module worker.
  setTimeout(() => {
    if(id !== requestId) return;
    try { showAnalysis(analyzeHand(input)); }
    catch(err){ showCalculationError(err?.message); }
  },0);
}

function renderResults(){
  const id = ++requestId;
  remainingCount.textContent = '';
  splitWarning.classList.add('hidden');

  if(!dealerUp.value || state.playerCards.length < 2){
    emptyState.textContent = 'Enter the dealer upcard and at least two player cards.';
    emptyState.classList.remove('error');
    emptyState.classList.remove('hidden');
    results.classList.add('hidden');
    return;
  }

  emptyState.textContent = 'Calculating GTA blackjack probabilities…';
  emptyState.classList.remove('error');
  emptyState.classList.remove('hidden');
  results.classList.add('hidden');

  calculate({
    playerCards: [...state.playerCards],
    dealerUp: dealerUp.value,
    otherVisible: [...state.otherCards],
    peekConfirmed: true,
  }, id);
}

function render(){
  renderChips(playerCardsEl, state.playerCards, 'playerCards');
  renderChips(otherCardsEl, state.otherCards, 'otherCards');
  updateHandSummary();
  renderResults();
}

buildRankGrid($('rankGrid'), 'playerCards');
buildRankGrid($('otherRankGrid'), 'otherCards');
dealerUp.addEventListener('change', render);

$('resetButton').addEventListener('click', () => {
  requestId++;
  scanId++;
  state.playerCards.length = 0;
  state.otherCards.length = 0;
  dealerUp.value = '';
  $('screenshotInput').value = '';
  $('previewWrap').classList.add('hidden');
  $('screenshotPreview').removeAttribute('src');
  drawDetectorOverlay([]);
  detectorBadge.textContent = 'AUTO + CONFIRM';
  detectorStatus.textContent = 'Choose a GTA blackjack screenshot or photo. The experimental reader will try to fill the ranks automatically, then you can correct anything it misreads.';
  render();
});

$('screenshotInput').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if(!file) return;
  if(!file.type.startsWith('image/')){
    detectorStatus.textContent = 'That file is not an image.';
    return;
  }

  const id=++scanId;
  const url = URL.createObjectURL(file);
  const img = $('screenshotPreview');
  const old = img.dataset.objectUrl;
  if(old) URL.revokeObjectURL(old);
  img.dataset.objectUrl = url;
  img.onload = () => {
    if(id!==scanId) return;
    $('previewWrap').classList.remove('hidden');
    drawDetectorOverlay([]);
    runScreenshotDetection(img,id);
  };
  img.src = url;
  $('previewWrap').classList.remove('hidden');
  detectorBadge.textContent = 'SCANNING';
  detectorStatus.textContent = 'Screenshot loaded. Preparing local card recognition…';
});

window.addEventListener('resize',()=>drawDetectorOverlay());

render();
