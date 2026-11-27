import {samplePose} from './experiment.js?v=0c54eefb16';

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
  return {c,s,cx:(minX+maxX)/2,cy:(minY+maxY)/2,spanX:Math.max(maxX-minX,.4)*1.12,spanY:Math.max(maxY-minY,1)*1.08,floor:minY};
}

export function drawPose(canvas,variant,time,result,parents,camera,color){
  const {ctx,width,height}=canvasContext(canvas),pose=samplePose(variant.positions,result.frames,result.joints,result.fps,time);
  const scale=Math.min((height-48)/camera.spanY,(width-24)/camera.spanX),ox=width/2,oy=height*.47;
  const project=(x,y,z)=>[ox+scale*(camera.c*x+camera.s*z-camera.cx),oy-scale*(y-camera.cy)];
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

export function drawTimeline(canvas,result,music,time,range=[0,result.duration]){
  const {ctx,width,height}=canvasContext(canvas),left=64,right=14,top=32,rows=[59,100,140,180],[lo,hi]=range;
  const x=t=>left+(t-lo)/(hi-lo)*(width-left-right);
  ctx.font='11px "DM Sans","Microsoft YaHei",sans-serif';ctx.textAlign='left';
  for(const block of music.blocks){
    const start=Math.max(lo,block.start_time_sec),end=Math.min(hi,block.end_time_sec);if(end<=start)continue;
    const span=x(end)-x(start);ctx.fillStyle=block.is_complete?'#b8d7f219':'#c1b3f112';ctx.fillRect(x(start),8,span,18);
    let label=block.is_complete?'八拍 '+block.fullNumber:block.block_type==='gap'?'空缺':'未满';
    if(ctx.measureText(label).width>span-8&&block.is_complete)label=String(block.fullNumber);
    if(ctx.measureText(label).width<=span-8){ctx.fillStyle=MUTED;ctx.fillText(label,x(start)+4,21);}
  }
  ['音乐','原序列','扰动','DTW'].forEach((label,i)=>{ctx.fillStyle=i?COLORS[i-1]:MUTED;ctx.fillText(label,5,rows[i]+4);ctx.strokeStyle=LINE;ctx.beginPath();ctx.moveTo(left,rows[i]);ctx.lineTo(width-right,rows[i]);ctx.stroke();});
  for(const beat of music.music_beats){if(beat.time_sec<lo||beat.time_sec>hi)continue;const xx=x(beat.time_sec);ctx.strokeStyle=COLORS[0];ctx.lineWidth=beat.is_downbeat?2:1;ctx.beginPath();ctx.moveTo(xx,rows[0]-9);ctx.lineTo(xx,rows[0]+9);ctx.stroke();if(beat.is_downbeat){ctx.fillStyle=COLORS[0];ctx.beginPath();ctx.moveTo(xx,rows[0]-15);ctx.lineTo(xx+3,rows[0]-11);ctx.lineTo(xx,rows[0]-7);ctx.lineTo(xx-3,rows[0]-11);ctx.fill();}}
  result.variants.forEach((variant,k)=>variant.beats.forEach(t=>{if(t<lo||t>hi)return;ctx.fillStyle=COLORS[k];ctx.beginPath();ctx.arc(x(t),rows[k+1],Math.abs(t-time)<.05?4.5:3,0,Math.PI*2);ctx.fill();}));
  const step=hi-lo>15?5:1;ctx.fillStyle=MUTED;ctx.textAlign='center';for(let t=Math.ceil(lo/step)*step;t<=hi;t+=step)ctx.fillText(t.toFixed(hi-lo>15?0:1)+'s',x(t),height-8);
  if(time>=lo&&time<=hi){ctx.strokeStyle=INK;ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(x(time),top-7);ctx.lineTo(x(time),height-24);ctx.stroke();}
  canvas.dataset.renderTime=time.toFixed(6);canvas.dataset.start=lo;canvas.dataset.end=hi;
}

export function drawMap(canvas,result,time){
  const {ctx,width,height}=canvasContext(canvas),pad=38,w=width-pad-12,h=height-pad-15,x=t=>pad+t/result.duration*w,y=t=>height-pad-t/result.duration*h;
  ctx.font='10px "DM Sans","Microsoft YaHei",sans-serif';ctx.strokeStyle=LINE;ctx.fillStyle=MUTED;
  for(let t=0;t<=30;t+=5){ctx.beginPath();ctx.moveTo(x(t),y(0));ctx.lineTo(x(t),y(30));ctx.moveTo(x(0),y(t));ctx.lineTo(x(30),y(t));ctx.stroke();ctx.fillText(String(t),x(t)-4,height-22);ctx.fillText(String(t),13,y(t)+3);}
  result.variants.forEach((v,k)=>{ctx.strokeStyle=COLORS[k];ctx.lineWidth=k===0?1:1.7;ctx.setLineDash(k===0?[4,4]:[]);ctx.beginPath();v.sourceTimes.forEach((s,i)=>{const xx=x(result.times[i]),yy=y(s);if(i===0)ctx.moveTo(xx,yy);else ctx.lineTo(xx,yy);});ctx.stroke();});ctx.setLineDash([]);
  ctx.strokeStyle='#f4f0ec88';ctx.beginPath();ctx.moveTo(x(time),y(0));ctx.lineTo(x(time),y(30));ctx.stroke();
  ctx.fillStyle=MUTED;ctx.fillText('音乐时间（秒）',width/2-30,height-4);ctx.fillText('原动作时间（秒）',pad,10);
}

export function drawPath(canvas,result){
  const {ctx,width,height}=canvasContext(canvas),p=30,w=width-p-12,h=height-p-16,a=result.alignment;
  const x=t=>p+t/result.duration*w,y=t=>height-p-t/result.duration*h;
  ctx.fillStyle=MUTED;ctx.font='10px "Microsoft YaHei",sans-serif';ctx.fillText('扰动输入时间（秒）',p,11);ctx.fillText('音乐时间（秒）',width-92,height-3);
  ctx.strokeStyle=LINE;ctx.lineWidth=.7;
  for(let t=0;t<=result.duration;t+=5){ctx.beginPath();ctx.moveTo(x(t),y(0));ctx.lineTo(x(t),y(result.duration));ctx.moveTo(x(0),y(t));ctx.lineTo(x(result.duration),y(t));ctx.stroke();ctx.fillText(String(t),x(t)-4,height-15);ctx.fillText(String(t),8,y(t)+3);}
  const line=(values,color,dashed)=>{ctx.strokeStyle=color;ctx.lineWidth=1.6;ctx.setLineDash(dashed?[4,4]:[]);ctx.beginPath();values.forEach((value,i)=>{if(i)ctx.lineTo(x(a.outputTimes[i]),y(value));else ctx.moveTo(x(a.outputTimes[i]),y(value));});ctx.stroke();};
  line(a.referenceInputTimes,'#b4aeb7',true);line(a.inputTimes,COLORS[2],false);
  ctx.fillStyle=COLORS[1];for(const [motion,music] of a.anchorPairs){ctx.beginPath();ctx.arc(x(music),y(motion),2.7,0,Math.PI*2);ctx.fill();}
}
