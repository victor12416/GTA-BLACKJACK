const TESSERACT_ESM_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js';
const TESSERACT_UMD_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';

let modulePromise = null;
let workerPromise = null;
let progressSink = null;
let fallbackScriptPromise = null;

function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

function resolveTesseractApi(mod){
  if(mod?.createWorker) return mod;
  if(mod?.default?.createWorker) return mod.default;
  if(mod?.Tesseract?.createWorker) return mod.Tesseract;
  if(globalThis.Tesseract?.createWorker) return globalThis.Tesseract;
  return null;
}

function loadFallbackScript(){
  if(globalThis.Tesseract?.createWorker) return Promise.resolve(globalThis.Tesseract);
  if(fallbackScriptPromise) return fallbackScriptPromise;

  fallbackScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TESSERACT_UMD_URL;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      if(globalThis.Tesseract?.createWorker) resolve(globalThis.Tesseract);
      else reject(new Error('Tesseract loaded, but createWorker was not available.'));
    };
    script.onerror = () => reject(new Error('Could not download the OCR engine.'));
    document.head.appendChild(script);
  });

  return fallbackScriptPromise;
}

async function loadTesseractApi(){
  let mod = null;
  try {
    mod = await import(TESSERACT_ESM_URL);
    const api = resolveTesseractApi(mod);
    if(api) return api;
  } catch(_err){
    // Some Android/mobile browsers do not expose the jsDelivr ESM bundle the
    // same way desktop browsers do. Fall back to the documented global build.
  }

  const fallback = await loadFallbackScript();
  const api = resolveTesseractApi(fallback);
  if(!api) throw new Error('OCR engine loaded, but createWorker is unavailable.');
  return api;
}

async function getOcrWorker(onProgress){
  progressSink = onProgress || null;
  if(!modulePromise) modulePromise = loadTesseractApi();
  const api = await modulePromise;

  if(!workerPromise){
    workerPromise = api.createWorker('eng', api.OEM?.LSTM_ONLY ?? 1, {
      logger(message){
        if(progressSink) progressSink(message);
      },
    }).then(async worker => {
      await worker.setParameters({
        tessedit_pageseg_mode: api.PSM?.SINGLE_WORD ?? '8',
        tessedit_char_whitelist: 'A23456789JQK10',
        preserve_interword_spaces: '0',
        user_defined_dpi: '300',
      });
      return worker;
    }).catch(err => {
      // Let a later screenshot retry initialization instead of permanently
      // caching a rejected worker promise.
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

function makeCanvas(width, height){
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function prepareAnalysisCanvas(image){
  const naturalW = image.naturalWidth || image.width;
  const naturalH = image.naturalHeight || image.height;
  if(!naturalW || !naturalH) throw new Error('Screenshot has no readable dimensions.');

  const maxW = 900;
  const scale = Math.min(1, maxW / naturalW);
  const canvas = makeCanvas(naturalW * scale, naturalH * scale);
  const ctx = canvas.getContext('2d', {willReadFrequently:true});
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return {canvas, ctx, naturalW, naturalH, scale};
}

function brightNeutral(r,g,b){
  const max = Math.max(r,g,b);
  const min = Math.min(r,g,b);
  const luma = 0.2126*r + 0.7152*g + 0.0722*b;
  return luma >= 158 && max - min <= 92;
}

function findBrightComponents(ctx, width, height){
  const image = ctx.getImageData(0,0,width,height);
  const data = image.data;
  const mask = new Uint8Array(width*height);
  const visited = new Uint8Array(width*height);

  for(let y=0;y<height;y++){
    const yn = y/height;
    if(yn < 0.16 || yn > 0.92) continue;
    for(let x=0;x<width;x++){
      const xn = x/width;
      if(xn < 0.08 || xn > 0.92) continue;
      const p = (y*width+x)*4;
      if(brightNeutral(data[p],data[p+1],data[p+2])) mask[y*width+x] = 1;
    }
  }

  const stack = new Int32Array(width*height);
  const components = [];
  const minPixels = Math.max(90, Math.round(width*height*0.00020));

  for(let seed=0;seed<mask.length;seed++){
    if(!mask[seed] || visited[seed]) continue;
    let top=0;
    stack[top++] = seed;
    visited[seed] = 1;
    let count=0;
    let minX=width, maxX=0, minY=height, maxY=0;

    while(top){
      const i = stack[--top];
      const y = Math.floor(i/width);
      const x = i-y*width;
      count++;
      if(x<minX) minX=x; if(x>maxX) maxX=x;
      if(y<minY) minY=y; if(y>maxY) maxY=y;

      const left=i-1, right=i+1, up=i-width, down=i+width;
      if(x>0 && mask[left] && !visited[left]){ visited[left]=1; stack[top++]=left; }
      if(x<width-1 && mask[right] && !visited[right]){ visited[right]=1; stack[top++]=right; }
      if(y>0 && mask[up] && !visited[up]){ visited[up]=1; stack[top++]=up; }
      if(y<height-1 && mask[down] && !visited[down]){ visited[down]=1; stack[top++]=down; }
    }

    if(count < minPixels) continue;
    const w=maxX-minX+1, h=maxY-minY+1;
    if(w < width*0.012 || w > width*0.24) continue;
    if(h < height*0.025 || h > height*0.30) continue;
    const aspect = w/h;
    if(aspect < 0.22 || aspect > 2.35) continue;
    const fill = count/(w*h);
    if(fill < 0.18) continue;
    components.push({x:minX,y:minY,w,h,count,fill,cx:minX+w/2,cy:minY+h/2});
  }
  return components;
}

function overlapRatio(a,b){
  const x1=Math.max(a.x,b.x), y1=Math.max(a.y,b.y);
  const x2=Math.min(a.x+a.w,b.x+b.w), y2=Math.min(a.y+a.h,b.y+b.h);
  if(x2<=x1 || y2<=y1) return 0;
  const intersection=(x2-x1)*(y2-y1);
  return intersection/Math.min(a.w*a.h,b.w*b.h);
}

function dedupeCandidates(candidates){
  const sorted=[...candidates].sort((a,b)=>(b.count*b.fill)-(a.count*a.fill));
  const kept=[];
  for(const c of sorted){
    if(kept.some(k=>overlapRatio(c,k)>0.62)) continue;
    kept.push(c);
  }
  return kept;
}

function splitWideCandidate(c){
  // GTA's camera perspective can make one real card look somewhat wide, so do
  // not split mild landscape shapes. Only very wide connected components are
  // treated as multiple overlapping/fanned cards; the hand-region OCR is the
  // primary fallback for overlap.
  const aspect=c.w/c.h;
  if(aspect < 1.45) return [c];
  const estimated=clamp(Math.round(aspect/0.78),2,4);
  const cardW=c.w/estimated;
  return Array.from({length:estimated},(_,i)=>({
    ...c,
    x:c.x+i*cardW,
    w:cardW,
    cx:c.x+(i+0.5)*cardW,
    count:c.count/estimated,
  }));
}

const GTA_LAYOUT = {
  // Ratios are relative to the active gameplay image after black letterbox bars
  // are removed. These bounds were calibrated from several GTA Online first-
  // person blackjack screenshots with green and purple felt.
  dealer: {
    detect:{x:0.36,y:0.16,w:0.32,h:0.43},
    ocr:{x:0.36,y:0.18,w:0.32,h:0.39},
    targetY:0.36,
  },
  player: {
    detect:{x:0.34,y:0.45,w:0.36,h:0.44},
    ocr:{x:0.34,y:0.48,w:0.36,h:0.39},
    targetY:0.67,
  },
};

function findActiveContentBounds(ctx,width,height){
  const image=ctx.getImageData(0,0,width,height);
  const data=image.data;
  const sampleStep=Math.max(1,Math.floor(width/220));

  function rowIsLetterbox(y){
    let dark=0,total=0;
    for(let x=0;x<width;x+=sampleStep){
      const p=(y*width+x)*4;
      total++;
      if(data[p]<18 && data[p+1]<18 && data[p+2]<18) dark++;
    }
    return total>0 && dark/total>=0.94;
  }

  let top=0;
  while(top<height*0.28 && rowIsLetterbox(top)) top++;
  let bottom=height-1;
  while(bottom>height*0.72 && rowIsLetterbox(bottom)) bottom--;

  // Ignore tiny dark edges; only treat meaningful bars as letterboxing.
  if(top<height*0.025) top=0;
  if((height-1-bottom)<height*0.025) bottom=height-1;
  if(bottom<=top) return {x:0,y:0,w:width,h:height};

  return {x:0,y:top,w:width,h:bottom-top+1};
}

function layoutRect(activeBounds,role,kind='detect'){
  const spec=GTA_LAYOUT[role][kind];
  return {
    x:activeBounds.x+activeBounds.w*spec.x,
    y:activeBounds.y+activeBounds.h*spec.y,
    w:activeBounds.w*spec.w,
    h:activeBounds.h*spec.h,
  };
}

function pointInRect(x,y,rect){
  return x>=rect.x && x<=rect.x+rect.w && y>=rect.y && y<=rect.y+rect.h;
}

function roleShapeLooksPlausible(card,activeBounds,role){
  const rw=card.w/activeBounds.w;
  const rh=card.h/activeBounds.h;
  if(role==='dealer'){
    return rw>=0.018 && rw<=0.16 && rh>=0.025 && rh<=0.20;
  }
  return rw>=0.025 && rw<=0.18 && rh>=0.050 && rh<=0.24;
}

function pickRoleRow(candidates,activeBounds,role){
  const region=layoutRect(activeBounds,role,'detect');
  const cards=candidates
    .flatMap(splitWideCandidate)
    .filter(c=>pointInRect(c.cx,c.cy,region))
    .filter(c=>roleShapeLooksPlausible(c,activeBounds,role));

  if(!cards.length) return [];

  const rows=[];
  const tolerance=Math.max(12,activeBounds.h*0.055);
  for(const card of [...cards].sort((a,b)=>a.cy-b.cy)){
    let row=rows.find(r=>Math.abs(r.cy-card.cy)<=tolerance);
    if(!row){ row={cy:card.cy,cards:[]}; rows.push(row); }
    row.cards.push(card);
    row.cy=row.cards.reduce((s,c)=>s+c.cy,0)/row.cards.length;
  }

  const target=GTA_LAYOUT[role].targetY;
  const best=rows.sort((a,b)=>{
    const ay=(a.cy-activeBounds.y)/activeBounds.h;
    const by=(b.cy-activeBounds.y)/activeBounds.h;
    // Prefer rows near the expected GTA seat location; a small bonus for
    // multiple card-shaped components helps overlapping/fanned hands.
    const aScore=Math.abs(ay-target)-Math.min(a.cards.length,4)*0.025;
    const bScore=Math.abs(by-target)-Math.min(b.cards.length,4)*0.025;
    return aScore-bScore;
  })[0];

  if(!best) return [];
  const bestRelativeY=(best.cy-activeBounds.y)/activeBounds.h;
  // If the closest row is still far from where GTA places this hand, do not
  // trust it. Region OCR is safer than reading thumbnail text or betting boxes.
  if(Math.abs(bestRelativeY-target)>0.18) return [];

  return best.cards.sort((a,b)=>a.cx-b.cx);
}

function classifyRows(candidates,width,height,activeBounds){
  const bounds=activeBounds||{x:0,y:0,w:width,h:height};
  return {
    dealer:pickRoleRow(candidates,bounds,'dealer'),
    player:pickRoleRow(candidates,bounds,'player'),
  };
}

function cropRankCanvas(sourceCanvas,box,variant={}){
  const cropW=variant.cropW ?? 0.48;
  const cropH=variant.cropH ?? 0.34;
  const threshold=variant.threshold ?? 150;
  const pad=variant.pad ?? 0.03;

  const sx=clamp(Math.floor(box.x-box.w*pad),0,sourceCanvas.width-1);
  const sy=clamp(Math.floor(box.y-box.h*pad),0,sourceCanvas.height-1);
  const sw=clamp(Math.ceil(box.w*cropW),8,sourceCanvas.width-sx);
  const sh=clamp(Math.ceil(box.h*cropH),8,sourceCanvas.height-sy);
  const out=makeCanvas(300,250);
  const ctx=out.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle='#fff'; ctx.fillRect(0,0,out.width,out.height);
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(sourceCanvas,sx,sy,sw,sh,10,10,280,230);

  const id=ctx.getImageData(0,0,out.width,out.height);
  for(let i=0;i<id.data.length;i+=4){
    const r=id.data[i],g=id.data[i+1],b=id.data[i+2];
    const l=0.2126*r+0.7152*g+0.0722*b;
    // Preserve both black and red GTA rank glyphs. The threshold is varied
    // across OCR passes because compression/phone screenshots can wash out a
    // tiny A/2 differently from the card background.
    const redInk=(r>g*1.18 && r>b*1.12 && r>65);
    const isInk=l<threshold || redInk;
    const v=isInk?0:255;
    id.data[i]=v; id.data[i+1]=v; id.data[i+2]=v; id.data[i+3]=255;
  }
  ctx.putImageData(id,0,0);
  return out;
}

function cropCandidateClusterCanvas(sourceCanvas,boxes){
  if(!boxes?.length) return null;
  const minX=Math.min(...boxes.map(b=>b.x));
  const minY=Math.min(...boxes.map(b=>b.y));
  const maxX=Math.max(...boxes.map(b=>b.x+b.w));
  const maxY=Math.max(...boxes.map(b=>b.y+b.h));
  const unionW=Math.max(8,maxX-minX);
  const unionH=Math.max(8,maxY-minY);
  const padX=unionW*0.22;
  const padY=unionH*0.16;
  const sx=clamp(Math.floor(minX-padX),0,sourceCanvas.width-1);
  const sy=clamp(Math.floor(minY-padY),0,sourceCanvas.height-1);
  const sw=clamp(Math.ceil(unionW+padX*2),8,sourceCanvas.width-sx);
  const sh=clamp(Math.ceil(unionH+padY*2),8,sourceCanvas.height-sy);

  const out=makeCanvas(Math.max(420,sw*3),Math.max(260,sh*3));
  const ctx=out.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle='#fff';
  ctx.fillRect(0,0,out.width,out.height);
  ctx.drawImage(sourceCanvas,sx,sy,sw,sh,0,0,out.width,out.height);

  const id=ctx.getImageData(0,0,out.width,out.height);
  for(let i=0;i<id.data.length;i+=4){
    const r=id.data[i],g=id.data[i+1],b=id.data[i+2];
    const l=0.2126*r+0.7152*g+0.0722*b;
    const redInk=(r>g*1.22 && r>b*1.16 && r>75);
    const darkInk=l<145;
    const v=(redInk||darkInk)?0:255;
    id.data[i]=v; id.data[i+1]=v; id.data[i+2]=v; id.data[i+3]=255;
  }
  ctx.putImageData(id,0,0);

  return {
    canvas:out,
    roi:{
      x:sx/sourceCanvas.width,
      y:sy/sourceCanvas.height,
      w:sw/sourceCanvas.width,
      h:sh/sourceCanvas.height,
    }
  };
}

async function readCandidateCluster(worker,sourceCanvas,boxes){
  const cropped=cropCandidateClusterCanvas(sourceCanvas,boxes);
  if(!cropped) return null;
  let result;
  await worker.setParameters({tessedit_pageseg_mode:'11'});
  try {
    result=await worker.recognize(cropped.canvas,{rotateAuto:true});
  } finally {
    await worker.setParameters({tessedit_pageseg_mode:'8'});
  }
  return {
    ranks:extractOcrRanks(result?.data?.text),
    confidence:Number(result?.data?.confidence)||0,
    raw:String(result?.data?.text||'').trim(),
    roi:cropped.roi,
  };
}

function normalizeOcrRank(text){
  const clean=String(text||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(!clean) return null;
  if(clean.includes('10')) return '10';
  const first=clean[0];
  if(first==='A') return 'A';
  if('23456789'.includes(first)) return first;
  if('JQK'.includes(first)) return '10';
  return null;
}


function extractOcrRanks(text){
  const clean=String(text||'').toUpperCase().replace(/[^A-Z0-9]+/g,' ');
  const matches=clean.match(/10|[A23456789JQK]/g)||[];
  return matches.map(token=>'JQK'.includes(token)?'10':token);
}

function cropHandRegionCanvas(sourceCanvas,role,activeBounds){
  const bounds=activeBounds||{x:0,y:0,w:sourceCanvas.width,h:sourceCanvas.height};
  const px=layoutRect(bounds,role,'ocr');
  const sx=clamp(Math.round(px.x),0,sourceCanvas.width-1);
  const sy=clamp(Math.round(px.y),0,sourceCanvas.height-1);
  const sw=clamp(Math.round(px.w),8,sourceCanvas.width-sx);
  const sh=clamp(Math.round(px.h),8,sourceCanvas.height-sy);
  const out=makeCanvas(Math.max(420,sw*2),Math.max(220,sh*2));
  const ctx=out.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle='#fff'; ctx.fillRect(0,0,out.width,out.height);
  ctx.drawImage(sourceCanvas,sx,sy,sw,sh,0,0,out.width,out.height);

  const id=ctx.getImageData(0,0,out.width,out.height);
  for(let i=0;i<id.data.length;i+=4){
    const r=id.data[i],g=id.data[i+1],b=id.data[i+2];
    const l=0.2126*r+0.7152*g+0.0722*b;
    const greenFelt=(g>r*1.08 && g>b*1.05 && g>55);
    const purpleFelt=(r>35 && b>35 && Math.abs(r-b)<70 && g<Math.max(r,b)*0.95);
    const redInk=(r>g*1.22 && r>b*1.16 && r>75);
    const darkInk=l<125 && !greenFelt && !purpleFelt;
    const v=(redInk||darkInk)?0:255;
    id.data[i]=v; id.data[i+1]=v; id.data[i+2]=v; id.data[i+3]=255;
  }
  ctx.putImageData(id,0,0);

  // Overlay rectangles are normalized to the complete screenshot, not to the
  // cropped active area.
  const roi={
    x:sx/sourceCanvas.width,
    y:sy/sourceCanvas.height,
    w:sw/sourceCanvas.width,
    h:sh/sourceCanvas.height,
  };
  return {canvas:out,roi};
}

async function readHandRegion(worker,sourceCanvas,role,activeBounds){
  const {canvas,roi}=cropHandRegionCanvas(sourceCanvas,role,activeBounds);
  let result;
  await worker.setParameters({tessedit_pageseg_mode:'11'}); // sparse text
  try {
    result=await worker.recognize(canvas,{rotateAuto:true});
  } finally {
    // Always restore card-corner mode, even if a region OCR pass fails.
    await worker.setParameters({tessedit_pageseg_mode:'8'});
  }
  const ranks=extractOcrRanks(result?.data?.text);
  const confidence=Number(result?.data?.confidence)||0;
  return {ranks,confidence,raw:String(result?.data?.text||'').trim(),roi};
}

async function readCandidate(worker,sourceCanvas,box){
  const variants=[
    {cropW:0.48,cropH:0.34,threshold:150,pad:0.03},
    {cropW:0.58,cropH:0.42,threshold:178,pad:0.05},
    {cropW:0.40,cropH:0.30,threshold:190,pad:0.02},
  ];
  const reads=[];

  for(const variant of variants){
    const rankCanvas=cropRankCanvas(sourceCanvas,box,variant);
    const result=await worker.recognize(rankCanvas,{rotateAuto:true});
    const rank=normalizeOcrRank(result?.data?.text);
    const confidence=Number(result?.data?.confidence)||0;
    reads.push({rank,confidence,raw:String(result?.data?.text||'').trim()});

    // A very strong first/second pass does not need a third OCR call.
    if(rank && confidence>=82) break;
  }

  const ranked=reads.filter(r=>r.rank);
  if(!ranked.length) return {rank:null,confidence:0,raw:reads.map(r=>r.raw).filter(Boolean).join(' | '),reads};

  const votes=new Map();
  for(const r of ranked){
    const current=votes.get(r.rank)||{count:0,total:0,max:0};
    current.count++;
    current.total+=r.confidence;
    current.max=Math.max(current.max,r.confidence);
    votes.set(r.rank,current);
  }

  const winner=[...votes.entries()].sort((a,b)=>{
    if(b[1].count!==a[1].count) return b[1].count-a[1].count;
    return b[1].max-a[1].max;
  })[0];
  const [rank,stats]=winner;
  const avg=stats.total/stats.count;
  // Agreement between independent crops is stronger evidence than one noisy
  // OCR confidence score, especially for GTA's tiny corner glyphs.
  const confidence=Math.min(99,Math.max(stats.max,avg+(stats.count>=2?18:0)));
  return {rank,confidence,raw:reads.map(r=>r.raw).filter(Boolean).join(' | '),reads};
}

function cardForOverlay(box,role,rank,confidence,width,height){
  return {
    role,rank,confidence,
    x:box.x/width,y:box.y/height,w:box.w/width,h:box.h/height,
  };
}

export async function detectVisibleCards(image,{onProgress}={}){
  if(!image) throw new Error('No screenshot image supplied.');
  if(image.decode && !image.complete) await image.decode();

  onProgress?.({stage:'detect',message:'Finding card shapes…',progress:0.05});
  const {canvas,ctx}=prepareAnalysisCanvas(image);
  const activeBounds=findActiveContentBounds(ctx,canvas.width,canvas.height);
  const raw=findBrightComponents(ctx,canvas.width,canvas.height);
  const candidates=dedupeCandidates(raw);
  const rows=classifyRows(candidates,canvas.width,canvas.height,activeBounds);

  onProgress?.({stage:'ocr',message:'Loading local OCR…',progress:0.12});
  const worker=await getOcrWorker(m=>{
    if(m?.status && typeof m.progress==='number'){
      onProgress?.({stage:'ocr',message:`OCR: ${m.status}`,progress:0.12+m.progress*0.20});
    }
  });

  const dealerChoices=rows.dealer.slice(0,2);
  const playerChoices=rows.player.slice(0,7);
  const dealerReads=[];
  const playerReads=[];

  for(let i=0;i<dealerChoices.length;i++){
    onProgress?.({stage:'ocr',message:`Reading dealer card ${i+1}/${dealerChoices.length}…`,progress:0.34});
    dealerReads.push({...await readCandidate(worker,canvas,dealerChoices[i]),box:dealerChoices[i]});
  }
  for(let i=0;i<playerChoices.length;i++){
    onProgress?.({stage:'ocr',message:`Reading your card ${i+1}/${playerChoices.length}…`,progress:0.40+0.30*((i+1)/Math.max(1,playerChoices.length))});
    playerReads.push({...await readCandidate(worker,canvas,playerChoices[i]),box:playerChoices[i]});
  }

  let validDealer=dealerReads.filter(r=>r.rank && r.confidence>=45).sort((a,b)=>b.confidence-a.confidence)[0]||null;
  let validPlayer=playerReads.filter(r=>r.rank && r.confidence>=45);
  let dealerUp=validDealer?.rank||null;
  let playerCards=validPlayer.map(r=>r.rank);
  const regionBoxes=[];
  const regionConfidences=[];

  // GTA often fans/overlaps cards so two physical cards can become one bright connected component.
  // If the card-shape pass is incomplete, OCR the whole expected hand region as a second pass.
  if(!dealerUp){
    onProgress?.({stage:'ocr',message:'Reading the dealer hand region…',progress:0.74});
    const region=await readHandRegion(worker,canvas,'dealer',activeBounds);
    if(region.ranks.length && region.confidence>=45){
      dealerUp=region.ranks[0];
      regionConfidences.push(region.confidence);
      regionBoxes.push({role:'dealer',rank:dealerUp,confidence:region.confidence,...region.roi});
    }
  }
  if(playerCards.length<2 && playerChoices.length){
    onProgress?.({stage:'ocr',message:'Reading only the detected player-card cluster…',progress:0.82});
    const cluster=await readCandidateCluster(worker,canvas,playerChoices);
    const agreesWithAnchor=Boolean(
      cluster?.ranks.length>=2 &&
      validPlayer.length>=1 &&
      cluster.ranks[0]===validPlayer[0].rank
    );
    const clusterTrusted=Boolean(
      cluster?.ranks.length>=2 &&
      (cluster.confidence>=45 || (agreesWithAnchor && cluster.confidence>=20))
    );
    if(clusterTrusted){
      // Never let unrestricted table text create extra cards. This crop is
      // anchored to actual card-shaped pixels. If a low-confidence cluster
      // agrees with a separately OCR'd corner, that corroboration is allowed
      // to rescue the second rank on heavily overlapped GTA cards.
      const maxPlausible=Math.min(7,Math.max(2,playerChoices.length+1));
      playerCards=cluster.ranks.slice(0,maxPlausible);
      const effectiveConfidence=agreesWithAnchor
        ? Math.max(cluster.confidence,Math.min(99,validPlayer[0].confidence+8))
        : cluster.confidence;
      regionConfidences.push(effectiveConfidence);
      regionBoxes.push({role:'player',rank:playerCards.join(','),confidence:effectiveConfidence,...cluster.roi});
    }
  }

  if(playerCards.length<2 && !playerChoices.length){
    // Do not auto-fill player cards from a large fixed table region. That old
    // fallback could OCR felt markings (for example a stray "10") as a card.
    // With no physical card-shaped component to anchor the crop, correctness
    // is more important than forcing a guess.
    onProgress?.({stage:'ocr',message:'Player cards were not isolated clearly enough for a safe read.',progress:0.88});
  }

  const accepted=[...(validDealer?[validDealer]:[]),...validPlayer];
  const confidenceParts=[...accepted.map(r=>r.confidence),...regionConfidences].filter(Number.isFinite);
  const confidence=confidenceParts.length ? confidenceParts.reduce((s,v)=>s+v,0)/confidenceParts.length/100 : 0;
  const ready=Boolean(dealerUp && playerCards.length>=2 && confidence>=0.45);
  const boxes=[
    ...dealerReads.map(r=>cardForOverlay(r.box,'dealer',r.rank,r.confidence,canvas.width,canvas.height)),
    ...playerReads.map(r=>cardForOverlay(r.box,'player',r.rank,r.confidence,canvas.width,canvas.height)),
    ...regionBoxes,
  ];

  return {
    ready,playerCards,dealerUp,otherVisible:[],confidence,boxes,
    message:ready
      ? `Auto-read ${playerCards.length} player card${playerCards.length===1?'':'s'} and dealer ${dealerUp}. Confirm the ranks below before using the result.`
      : confidence>0
        ? `I found possible cards, but confidence was only ${Math.round(confidence*100)}%. I did not auto-fill them. Retake the image or enter/correct the ranks manually.`
        : 'The scanner could not confidently read a dealer card plus two player cards. Retake the image or enter the ranks manually.',
  };
}

