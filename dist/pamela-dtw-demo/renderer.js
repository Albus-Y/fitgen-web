import {LABELS} from './atomic.js?v=4bc7cdc476';

export const COLORS=['#b8d7f2','#ffb196','#c1b3f1'];
const INK='#f4f0ec',MUTED='#b4aeb7',LINE='#3b3844';
export function canvasContext(canvas){
  const rect=canvas.getBoundingClientRect(),ratio=window.devicePixelRatio||1;
  const width=Math.max(1,rect.width),height=Math.max(1,rect.height);
  if(canvas.width!==Math.round(width*ratio)||canvas.height!==Math.round(height*ratio)){canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);}
  const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);return {ctx,width,height};
}

export function fitCamera(data){
  const angle=26*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(let i=0;i<data.length;i+=3){const x=c*data[i]+s*data[i+2],y=data[i+1];minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  return {c,s,rootX:c*data[0]+s*data[2],cx:(minX+maxX)/2,cy:(minY+maxY)/2,spanX:Math.max(maxX-minX,.4)*1.12,spanY:Math.max(maxY-minY,1)*1.08,floor:minY};
}

export function drawPose(canvas,variant,time,result,parents,camera,color,pose){
  const {ctx,width,height}=canvasContext(canvas);
  const scale=Math.min((height-48)/camera.spanY,(width-24)/camera.spanX),ox=width/2,oy=height*.47;
  const followX=camera.c*pose[0]+camera.s*pose[2]-camera.rootX;
  const project=(x,y,z)=>[ox+scale*(camera.c*x+camera.s*z-camera.cx-followX),oy-scale*(y-camera.cy)];
  const floorY=project(0,camera.floor,0)[1];
  const gradient=ctx.createLinearGradient(0,0,0,height);gradient.addColorStop(0,'#22222d');gradient.addColorStop(1,'#191921');ctx.fillStyle=gradient;ctx.fillRect(0,0,width,height);
  ctx.strokeStyle='#34323f';ctx.lineWidth=.7;
  for(let v=-1.25;v<=1.25;v+=.25){for(const ends of [[[-1.25,camera.floor,v],[1.25,camera.floor,v]],[[v,camera.floor,-1.25],[v,camera.floor,1.25]]]){const a=project(...ends[0]),b=project(...ends[1]);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();}}
  ctx.fillStyle='#00000040';ctx.beginPath();ctx.ellipse(ox,floorY,scale*.28,scale*.045,0,0,Math.PI*2);ctx.fill();
  const points=Array.from({length:result.joints},(_,j)=>project(...pose.subarray(j*3,j*3+3)));
  const depths=Array.from({length:result.joints},(_,j)=>-camera.s*pose[j*3]+camera.c*pose[j*3+2]);
  const active=variant.beats.some(b=>Math.abs(b-time)<=.05);
  const bones=parents.map((p,j)=>({p,j})).filter(x=>x.p>=0).sort((a,b)=>(depths[a.j]+depths[a.p])-(depths[b.j]+depths[b.p]));
  const radii=j=>[1,2,4,5].includes(j)?9:[3,6,9].includes(j)?11:[7,8,16,17,18,19].includes(j)?6:4;
  ctx.lineCap='round';ctx.lineJoin='round';
  for(const {p,j} of bones){
    ctx.beginPath();ctx.moveTo(...points[p]);ctx.lineTo(...points[j]);ctx.lineWidth=radii(j)*Math.max(.7,scale/150)+3;ctx.strokeStyle='#111119';ctx.stroke();
    ctx.lineWidth-=3;ctx.strokeStyle=active?color:'#8b8d9f';ctx.stroke();
    ctx.lineWidth=Math.max(1,ctx.lineWidth*.32);ctx.strokeStyle=active?'#ffffff88':'#cbd1e088';ctx.stroke();
  }
  points.forEach((p,j)=>{ctx.beginPath();ctx.arc(...p,j===15?scale*.057:Math.max(2.5,scale*.018),0,Math.PI*2);ctx.fillStyle=active?color:'#a1a7b7';ctx.fill();});
  const head=points[15];ctx.beginPath();ctx.arc(head[0]+scale*.018,head[1]-scale*.006,1.3,0,Math.PI*2);ctx.fillStyle='#292937';ctx.fill();
  ctx.font=(width<180?'10':'12')+'px "DM Sans","Microsoft YaHei",sans-serif';ctx.fillStyle=active?color:MUTED;ctx.textAlign='left';ctx.fillText(active?'● 动作 beat':width<180?'身体 22 关节':'SMPL-X 身体 22 关节',width<180?7:14,height-14);
  canvas.dataset.renderTime=time.toFixed(6);canvas.dataset.frame=(time*result.fps).toFixed(3);
  canvas.dataset.beatActive=String(active);
  return active;
}

export const PLOT_LEFT = 82, PLOT_RIGHT = 12;
export const ROWS = [47, 81, 115, 149];

export function drawTimeline(canvas, result, music, time, range = [0, result.duration]) {
  const {ctx, width, height} = canvasContext(canvas);
  const [lo, hi] = range, left = PLOT_LEFT, right = width - PLOT_RIGHT;
  const x = t => left + (t - lo) * (right - left) / (hi - lo);
  const visible = t => t >= lo - 1e-8 && t <= hi + 1e-8;
  ctx.font = '11px "DM Sans","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'left';
  for (const block of result.blocks) {
    const a = Math.max(lo, block.start_time_sec), b = Math.min(hi, block.end_time_sec);
    if (a >= b) continue;
    ctx.fillStyle = block.is_complete ? '#b8d7f21b' : '#b9a6d52b';
    ctx.fillRect(x(a), 5, x(b) - x(a), 18);
    const label = block.beat_count === 16 ? '八拍 ' + block.fullNumber + '–' + (block.fullNumber + 1) :
      block.strategy === 'excerpt' ? '余 8 拍 · 模板片段' :
      block.is_complete ? '八拍 ' + block.fullNumber : block.block_type === 'gap' ? '空缺' : '残拍';
    if (ctx.measureText(label).width + 6 < x(b) - x(a)) {
      ctx.fillStyle = MUTED;
      ctx.fillText(label, x(a) + 4, 18);
    }
    if (block.reset && visible(block.start_time_sec)) {
      ctx.strokeStyle = '#b4a1c8';
      ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(x(block.start_time_sec), 24); ctx.lineTo(x(block.start_time_sec), height - 24); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (block.middleTime != null && visible(block.middleTime)) {
      ctx.fillStyle = '#9caabb66';
      ctx.fillRect(x(block.middleTime), 20, 1, height - 42);
    }
  }
  ['音乐', ...LABELS.slice(0, result.displayMethods.length)].forEach((label, i) => {
    ctx.fillStyle = i ? COLORS[i - 1] : MUTED;
    ctx.fillText(label, 4, ROWS[i] + 3);
    ctx.strokeStyle = LINE;
    ctx.beginPath(); ctx.moveTo(left, ROWS[i]); ctx.lineTo(right, ROWS[i]); ctx.stroke();
  });
  for (const beat of music.music_beats) {
    if (!visible(beat.time_sec)) continue;
    const xx = x(beat.time_sec);
    ctx.fillStyle = COLORS[0];
    ctx.fillRect(xx - .7, ROWS[0] - 6, beat.is_downbeat ? 2 : 1, 12);
    if (beat.is_downbeat) {
      ctx.beginPath(); ctx.moveTo(xx, 34); ctx.lineTo(xx + 3, 37); ctx.lineTo(xx, 40); ctx.lineTo(xx - 3, 37); ctx.closePath(); ctx.fill();
    }
  }
  result.variants.forEach((v, i) => {
    ctx.fillStyle = COLORS[i]; ctx.strokeStyle = COLORS[i];
    for (const t of v.beats.filter(visible)) {
      ctx.beginPath(); ctx.arc(x(t), ROWS[i + 1] - 3, Math.abs(t - time) < .05 ? 4 : 2.8, 0, 2 * Math.PI); ctx.fill();
    }
    for (const t of v.detectedBeats.filter(visible)) {
      ctx.beginPath(); ctx.arc(x(t), ROWS[i + 1] + 5, 2.5, 0, 2 * Math.PI); ctx.stroke();
    }
  });
  ctx.fillStyle = MUTED;
  const step = hi - lo > 15 ? 5 : 1;
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) {
    ctx.textAlign = t === hi ? 'right' : 'center';
    ctx.fillText(t + 's', x(t), height - 5);
  }
  if (visible(time)) {
    ctx.strokeStyle = INK;
    ctx.beginPath(); ctx.moveTo(x(time), 24); ctx.lineTo(x(time), height - 21); ctx.stroke();
  }
  canvas.dataset.start = lo; canvas.dataset.end = hi; canvas.dataset.renderTime = time.toFixed(6);
}
