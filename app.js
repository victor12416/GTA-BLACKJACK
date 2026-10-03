import { RANKS, analyzeHand, handValue, formatEV, formatPct } from './blackjack.js?v=20261003-4';
import { detectVisibleCards } from './card-detector.js?v=20261003-4';

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

const cameraMode = $('cameraMode');
const cameraVideo = $('cameraVideo');
const cameraFreeze = $('cameraFreeze');
const cameraOverlay = $('cameraOverlay');
const cameraStatus = $('cameraStatus');
const cameraHandText = $('cameraHandText');
const cameraMoveText = $('cameraMoveText');
const cameraEvText = $('cameraEvText');
const cameraCaptureButton = $('cameraCaptureButton');
const cameraRetakeButton = $('cameraRetakeButton');
const cameraUseManualButton = $('cameraUseManualButton');

let requestId = 0;
let scanId = 0;
let lastDetectionBoxes = [];
let calcWorker = null;
let cameraStream = null;
let cameraCaptured = false;
let cameraScanId = 0;

try {
  if('Worker' in window){
    calcWorker = new Worker(new URL('./calculator-worker.js?v=20261003-4', import.meta.url), {type:'module'});
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


function cameraIsOpen(){
  return cameraMode && !cameraMode.classList.contains('hidden');
}

function resetCameraHud(){
  cameraCaptured = false;
  cameraFreeze?.classList.add('hidden');
  if(cameraOverlay){
    const ctx=cameraOverlay.getContext('2d');
    ctx?.clearRect(0,0,cameraOverlay.width,cameraOverlay.height);
  }
  if(cameraStatus) cameraStatus.textContent = 'Point at the GTA blackjack table';
  if(cameraHandText) cameraHandText.textContent = 'Align the dealer and your cards inside the guides.';
  if(cameraMoveText) cameraMoveText.textContent = '';
  if(cameraEvText) cameraEvText.textContent = '';
  cameraRetakeButton?.classList.add('hidden');
  cameraUseManualButton?.classList.add('hidden');
  cameraCaptureButton?.classList.remove('hidden');
}

function drawCameraOverlay(boxes=[]){
  if(!cameraOverlay || !cameraFreeze?.width || !cameraFreeze?.height) return;
  cameraOverlay.width = cameraFreeze.width;
  cameraOverlay.height = cameraFreeze.height;
  const ctx=cameraOverlay.getContext('2d');
  const w=cameraOverlay.width, h=cameraOverlay.height;
  ctx.clearRect(0,0,w,h);
  ctx.lineWidth=Math.max(4,w/360);
  ctx.font=`700 ${Math.max(26,Math.round(w/32))}px system-ui`;
  ctx.textBaseline='top';

  for(const box of boxes){
    const x=box.x*w, y=box.y*h, bw=box.w*w, bh=box.h*h;
    const dealer=box.role==='dealer';
    ctx.strokeStyle=dealer?'#ffd27a':'#79e6a9';
    ctx.fillStyle=dealer?'#ffd27a':'#79e6a9';
    ctx.strokeRect(x,y,bw,bh);
    const label=`${dealer?'D':'YOU'} ${box.rank||'?'}`;
    const tw=ctx.measureText(label).width+18;
    const th=Math.max(34,Math.round(w/28));
    ctx.fillRect(x,Math.max(0,y-th),tw,th);
    ctx.fillStyle='#07110c';
    ctx.fillText(label,x+9,Math.max(0,y-th)+3);
  }
}

async function startCamera(){
  if(!navigator.mediaDevices?.getUserMedia){
    detectorStatus.textContent = 'This browser does not expose camera access. Use Choose screenshot instead.';
    return;
  }

  try {
    cameraStatus.textContent = 'Requesting rear camera…';
    cameraMode.classList.remove('hidden');
    document.body.classList.add('camera-open');
    resetCameraHud();

    if(!cameraStream){
      cameraStream = await navigator.mediaDevices.getUserMedia({
        audio:false,
        video:{
          facingMode:{ideal:'environment'},
          width:{ideal:1920},
          height:{ideal:1080},
        }
      });
      cameraVideo.srcObject=cameraStream;
    }
    await cameraVideo.play();
    cameraStatus.textContent = 'Point at the GTA blackjack table';
  } catch(err){
    stopCamera();
    detectorStatus.textContent = `Camera unavailable: ${err?.message || 'permission denied'}. You can still choose a screenshot.`;
  }
}

function stopCamera(){
  cameraScanId++;
  cameraStream?.getTracks().forEach(track=>track.stop());
  cameraStream=null;
  if(cameraVideo) cameraVideo.srcObject=null;
  cameraMode?.classList.add('hidden');
  document.body.classList.remove('camera-open');
  resetCameraHud();
}

function retakeCamera(){
  cameraScanId++;
  resetCameraHud();
  if(cameraVideo && cameraStream) cameraVideo.play().catch(()=>{});
}

async function runCameraDetection(id){
  if(!cameraFreeze) return;
  cameraStatus.textContent='Finding GTA cards…';
  cameraHandText.textContent='Analyzing captured frame…';
  cameraMoveText.textContent='';
  cameraEvText.textContent='';

  try {
    const detected=await detectVisibleCards(cameraFreeze,{
      onProgress(info){
        if(id!==cameraScanId) return;
        cameraStatus.textContent=info?.message || 'Analyzing…';
      }
    });
    if(id!==cameraScanId) return;

    drawCameraOverlay(detected.boxes||[]);
    const pct=Math.round((detected.confidence||0)*100);

    if(!detected.ready){
      cameraStatus.textContent='LOW CONFIDENCE';
      cameraHandText.textContent=`${detected.message} (${pct}% confidence)`;
      cameraMoveText.textContent='RETAKE';
      cameraEvText.textContent='No move was calculated from this scan.';
      cameraRetakeButton.classList.remove('hidden');
      cameraUseManualButton.classList.remove('hidden');
      cameraCaptureButton.classList.add('hidden');
      return;
    }

    state.playerCards.splice(0,state.playerCards.length,...detected.playerCards);
    state.otherCards.length=0;
    dealerUp.value=detected.dealerUp || '';
    cameraStatus.textContent='CARDS FOUND';
    cameraHandText.textContent=`You: ${detected.playerCards.join(', ')}   Dealer: ${detected.dealerUp}   • ${pct}%`;
    cameraMoveText.textContent='CALCULATING…';
    cameraEvText.textContent='Computing the GTA probability tree.';
    cameraRetakeButton.classList.remove('hidden');
    cameraUseManualButton.classList.remove('hidden');
    cameraCaptureButton.classList.add('hidden');
    render();
  } catch(err){
    if(id!==cameraScanId) return;
    cameraStatus.textContent='SCAN ERROR';
    cameraHandText.textContent=err?.message || 'Could not analyze this frame.';
    cameraMoveText.textContent='RETAKE';
    cameraEvText.textContent='';
    cameraRetakeButton.classList.remove('hidden');
    cameraUseManualButton.classList.remove('hidden');
    cameraCaptureButton.classList.add('hidden');
  }
}

function captureCamera(){
  if(!cameraVideo?.videoWidth || !cameraVideo?.videoHeight || cameraCaptured) return;
  cameraCaptured=true;
  const w=cameraVideo.videoWidth;
  const h=cameraVideo.videoHeight;
  cameraFreeze.width=w;
  cameraFreeze.height=h;
  const ctx=cameraFreeze.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(cameraVideo,0,0,w,h);
  cameraFreeze.classList.remove('hidden');
  cameraCaptureButton.classList.add('hidden');
  cameraStatus.textContent='Captured';
  const id=++cameraScanId;
  runCameraDetection(id);
}

function showCalculationError(message){
  if(cameraIsOpen() && cameraCaptured){
    cameraStatus.textContent='CALCULATION ERROR';
    cameraMoveText.textContent='CHECK HAND';
    cameraEvText.textContent=message || 'Could not calculate this hand.';
  }
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
    if(cameraIsOpen() && cameraCaptured){
      cameraStatus.textContent='RESULT';
      cameraMoveText.textContent=analysis.terminal;
      cameraEvText.textContent='The hand resolves automatically.';
    }
    bestMove.textContent = analysis.terminal;
    bestEv.textContent = 'The game resolves automatically.';
    actionCards.replaceChildren();
    splitWarning.classList.add('hidden');
    return;
  }

  bestMove.textContent = analysis.best;
  bestEv.textContent = `Expected value: ${formatEV(analysis.actions[analysis.best].ev)} original-bet units`;
  if(cameraIsOpen() && cameraCaptured){
    cameraStatus.textContent='RESULT';
    cameraMoveText.textContent=analysis.best;
    const metric=analysis.actions[analysis.best];
    cameraEvText.textContent=`EV ${formatEV(metric.ev)} • Win ${formatPct(metric.win)} • Push ${formatPct(metric.push)} • Lose ${formatPct(metric.loss)}`;
  }
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

$('startCameraButton')?.addEventListener('click', startCamera);
$('cameraCloseButton')?.addEventListener('click', stopCamera);
cameraCaptureButton?.addEventListener('click', captureCamera);
cameraRetakeButton?.addEventListener('click', retakeCamera);
cameraUseManualButton?.addEventListener('click', () => {
  stopCamera();
  document.getElementById('cards-title')?.scrollIntoView({behavior:'smooth',block:'start'});
});

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
  detectorStatus.textContent = 'Use the camera scanner or choose a GTA blackjack screenshot. Low-confidence OCR will never auto-fill the hand.';
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
document.addEventListener('visibilitychange', () => {
  if(document.hidden && cameraIsOpen()) stopCamera();
});
window.addEventListener('pagehide', () => {
  cameraStream?.getTracks().forEach(track=>track.stop());
});

render();
