const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js';

let modulePromise = null;
let workerPromise = null;
let progressSink = null;

function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

async function getOcrWorker(onProgress){
  progressSink = onProgress || null;
  if(!modulePromise) modulePromise = import(TESSERACT_URL);
  const mod = await modulePromise;

  if(!workerPromise){
    workerPromise = mod.createWorker('eng', mod.OEM?.LSTM_ONLY ?? 1, {
      logger(message){
        if(progressSink) progressSink(message);
      },
    }).then(async worker => {
      await worker.setParameters({
        tessedit_pageseg_mode: mod.PSM?.SINGLE_WORD ?? '8',
        tessedit_char_whitelist: 'A23456789JQK10',
        preserve_interword_spaces: '0',
        user_defined_dpi: '300',
      });
      return worker;
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
  // Overlapping GTA cards can merge into one bright connected component. Split only very wide
  // components; normal single cards are taller than they are wide in the player's perspective.
  if(c.w/c.h < 1.12) return [c];
  const estimated = clamp(Math.round(c.w/(c.h*0.62)),2,4);
  const cardW=c.w/estimated;
  return Array.from({length:estimated},(_,i)=>({
    ...c,
    x:c.x+i*cardW,
    w:cardW,
    cx:c.x+(i+0.5)*cardW,
    count:c.count/estimated,
  }));
}

function classifyRows(candidates,width,height){
  const central=candidates
    .flatMap(splitWideCandidate)
    .filter(c=>c.cx/width>0.14 && c.cx/width<0.86 && c.cy/height>0.24 && c.cy/height<0.88);

  if(!central.length) return {dealer:[],player:[]};
  const rows=[];
  const tolerance=Math.max(18,height*0.065);
  for(const card of central.sort((a,b)=>a.cy-b.cy)){
    let row=rows.find(r=>Math.abs(r.cy-card.cy)<=tolerance);
    if(!row){ row={cy:card.cy,cards:[]}; rows.push(row); }
    row.cards.push(card);
    row.cy=row.cards.reduce((s,c)=>s+c.cy,0)/row.cards.length;
  }

  const dealerRows=rows.filter(r=>r.cy/height>=0.26 && r.cy/height<=0.60);
  const playerRows=rows.filter(r=>r.cy/height>=0.50 && r.cy/height<=0.86);
  const dealerRow=dealerRows.sort((a,b)=>Math.abs(a.cy/height-0.46)-Math.abs(b.cy/height-0.46))[0];
  let playerRow=playerRows
    .filter(r=>r!==dealerRow)
    .sort((a,b)=>Math.abs(a.cy/height-0.68)-Math.abs(b.cy/height-0.68))[0];

  if(!playerRow && rows.length>1){
    playerRow=[...rows].sort((a,b)=>b.cy-a.cy).find(r=>r!==dealerRow);
  }
  return {
    dealer:(dealerRow?.cards||[]).sort((a,b)=>a.cx-b.cx),
    player:(playerRow?.cards||[]).sort((a,b)=>a.cx-b.cx),
  };
}

function cropRankCanvas(sourceCanvas,box){
  const sx=clamp(Math.floor(box.x-box.w*0.03),0,sourceCanvas.width-1);
  const sy=clamp(Math.floor(box.y-box.h*0.03),0,sourceCanvas.height-1);
  const sw=clamp(Math.ceil(box.w*0.48),8,sourceCanvas.width-sx);
  const sh=clamp(Math.ceil(box.h*0.34),8,sourceCanvas.height-sy);
  const out=makeCanvas(260,220);
  const ctx=out.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle='#fff'; ctx.fillRect(0,0,out.width,out.height);
  ctx.drawImage(sourceCanvas,sx,sy,sw,sh,10,10,240,200);

  const id=ctx.getImageData(0,0,out.width,out.height);
  for(let i=0;i<id.data.length;i+=4){
    const r=id.data[i],g=id.data[i+1],b=id.data[i+2];
    const l=0.2126*r+0.7152*g+0.0722*b;
    // Keep rank ink (black or red) dark while whitening the bright card background.
    const isInk=l<150 || (r>g*1.25 && r>b*1.18 && r>80);
    const v=isInk?0:255;
    id.data[i]=v; id.data[i+1]=v; id.data[i+2]=v; id.data[i+3]=255;
  }
  ctx.putImageData(id,0,0);
  return out;
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

function cropHandRegionCanvas(sourceCanvas,role){
  const roi=role==='dealer'
    ? {x:0.26,y:0.28,w:0.48,h:0.33}
    : {x:0.22,y:0.52,w:0.56,h:0.33};
  const sx=Math.round(sourceCanvas.width*roi.x);
  const sy=Math.round(sourceCanvas.height*roi.y);
  const sw=Math.round(sourceCanvas.width*roi.w);
  const sh=Math.round(sourceCanvas.height*roi.h);
  const out=makeCanvas(Math.max(420,sw*2),Math.max(220,sh*2));
  const ctx=out.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle='#fff'; ctx.fillRect(0,0,out.width,out.height);
  ctx.drawImage(sourceCanvas,sx,sy,sw,sh,0,0,out.width,out.height);

  const id=ctx.getImageData(0,0,out.width,out.height);
  for(let i=0;i<id.data.length;i+=4){
    const r=id.data[i],g=id.data[i+1],b=id.data[i+2];
    const l=0.2126*r+0.7152*g+0.0722*b;
    const greenFelt=(g>r*1.08 && g>b*1.05 && g>55);
    const redInk=(r>g*1.22 && r>b*1.16 && r>75);
    const darkInk=l<125 && !greenFelt;
    const v=(redInk||darkInk)?0:255;
    id.data[i]=v; id.data[i+1]=v; id.data[i+2]=v; id.data[i+3]=255;
  }
  ctx.putImageData(id,0,0);
  return {canvas:out,roi};
}

async function readHandRegion(worker,sourceCanvas,role){
  const {canvas,roi}=cropHandRegionCanvas(sourceCanvas,role);
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
  const rankCanvas=cropRankCanvas(sourceCanvas,box);
  const result=await worker.recognize(rankCanvas,{rotateAuto:true});
  const rank=normalizeOcrRank(result?.data?.text);
  const confidence=Number(result?.data?.confidence)||0;
  return {rank,confidence,raw:String(result?.data?.text||'').trim()};
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
  const raw=findBrightComponents(ctx,canvas.width,canvas.height);
  const candidates=dedupeCandidates(raw);
  const rows=classifyRows(candidates,canvas.width,canvas.height);

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

  let validDealer=dealerReads.filter(r=>r.rank && r.confidence>=25).sort((a,b)=>b.confidence-a.confidence)[0]||null;
  let validPlayer=playerReads.filter(r=>r.rank && r.confidence>=25);
  let dealerUp=validDealer?.rank||null;
  let playerCards=validPlayer.map(r=>r.rank);
  const regionBoxes=[];
  const regionConfidences=[];

  // GTA often fans/overlaps cards so two physical cards can become one bright connected component.
  // If the card-shape pass is incomplete, OCR the whole expected hand region as a second pass.
  if(!dealerUp){
    onProgress?.({stage:'ocr',message:'Reading the dealer hand region…',progress:0.74});
    const region=await readHandRegion(worker,canvas,'dealer');
    if(region.ranks.length){
      dealerUp=region.ranks[0];
      regionConfidences.push(region.confidence);
      regionBoxes.push({role:'dealer',rank:dealerUp,confidence:region.confidence,...region.roi});
    }
  }
  if(playerCards.length<2){
    onProgress?.({stage:'ocr',message:'Reading the full player hand region…',progress:0.84});
    const region=await readHandRegion(worker,canvas,'player');
    if(region.ranks.length>=2){
      playerCards=region.ranks.slice(0,7);
      regionConfidences.push(region.confidence);
      regionBoxes.push({role:'player',rank:playerCards.join(','),confidence:region.confidence,...region.roi});
    }
  }

  const accepted=[...(validDealer?[validDealer]:[]),...validPlayer];
  const confidenceParts=[...accepted.map(r=>r.confidence),...regionConfidences].filter(Number.isFinite);
  const confidence=confidenceParts.length ? confidenceParts.reduce((s,v)=>s+v,0)/confidenceParts.length/100 : 0;
  const ready=Boolean(dealerUp && playerCards.length>=2);
  const boxes=[
    ...dealerReads.map(r=>cardForOverlay(r.box,'dealer',r.rank,r.confidence,canvas.width,canvas.height)),
    ...playerReads.map(r=>cardForOverlay(r.box,'player',r.rank,r.confidence,canvas.width,canvas.height)),
    ...regionBoxes,
  ];

  return {
    ready,playerCards,dealerUp,otherVisible:[],confidence,boxes,
    message:ready
      ? `Auto-read ${playerCards.length} player card${playerCards.length===1?'':'s'} and dealer ${dealerUp}. Confirm the ranks below before using the result.`
      : 'The scanner could not confidently read a dealer card plus two player cards. Enter or correct the ranks manually.',
  };
}

