import { Scene } from './scene.js';

const $=id=>document.getElementById(id);
const arrays={float32:Float32Array,int8:Int8Array,uint8:Uint8Array,int16:Int16Array,uint32:Uint32Array};
const cache=new Map();
let catalog,model,scene,track,activeClip,frame=0,mode='tracking',playing=false;
let requestedTime=0,generation=0,pending,requestFrame=0,playStart=0,playFrame=0;

async function unpack(files,signal) {
  const key=files.join('|');
  if(cache.has(key))return cache.get(key);
  const chunks=await Promise.all(files.map(async file=>{
    const r=await fetch('data/'+file,{signal});
    if(!r.ok)throw Error('回放文件载入失败：'+r.status);
    return r.arrayBuffer();
  }));
  const body=new Blob(chunks).stream().pipeThrough(new DecompressionStream('gzip'));
  const buffer=await new Response(body).arrayBuffer();
  signal?.throwIfAborted();
  const bytes=new Uint8Array(buffer);
  const size=new DataView(buffer).getUint32(0,true);
  const header=JSON.parse(new TextDecoder().decode(bytes.subarray(4,4+size)));
  const result={meta:header.meta};
  for(const [name,layout] of Object.entries(header.arrays)){
    const len=layout.shape.reduce((a,b)=>a*b,1);
    const data=new arrays[layout.dtype](buffer,4+size+layout.offset,len);
    if(['pose','reference','path'].includes(name)){
      const stride=len/layout.shape[0];
      for(let i=stride;i<len;i++) data[i]+=data[i-stride];
    }
    result[name]=data;
  }
  if(result.meta.frames){
    if(cache.size>=2)cache.delete(cache.keys().next().value);
    cache.set(key,result);
  }
  return result;
}

function setOptions(select,options,value) {
  select.replaceChildren(...options.map(o=>new Option(o.label,o.id)));
  select.value=value;
}

function message(text){
  $('message').textContent=text;$('message').hidden=!text;
}
function lockTransport(disabled){
  for(const id of ['timeline','play','next','prev','start','speed'])$(id).disabled=disabled;
}
function pause(){
  playing=false;cancelAnimationFrame(requestFrame);requestFrame=0;
  $('play').textContent='▶';$('play').setAttribute('aria-label','播放');
}
function frameTime(){return track ? (track.meta.start||0)+frame/track.meta.hz : 0;}
function endTime(){return (track.meta.start||0)+(track.meta.frames-1)/track.meta.hz;}
function togglePlay(){
  if(!track)return;
  if(playing){pause();return;}
  if(frame===track.meta.frames-1)frame=0;
  playing=true;playFrame=frame;playStart=performance.now();
  $('play').textContent='❚❚';$('play').setAttribute('aria-label','暂停');
  function tick(now){
    if(!playing)return;
    const target=playFrame+Math.floor((now-playStart)*track.meta.hz*Number($('speed').value)/1000);
    seek(target);
    if(frame===track.meta.frames-1){pause();return;}
    requestFrame=requestAnimationFrame(tick);
  }
  requestFrame=requestAnimationFrame(tick);
}
function seek(value){
  if(!track)return;
  const target=Math.max(0,Math.min(track.meta.frames-1,Math.round(value)));
  if(target!==frame){frame=target;paint();}
}
function step(delta){pause();seek(frame+delta);}
function draw(){
  if(!track||!scene)return;
  const lower=mode==='tracking' && $('muscleDisplay').value==='lower_force';
  let highlight=null;
  if(mode==='tracking' && $('highlightTop5').checked){
    const start=(frame*2+Number(lower))*5;
    highlight=new Set(track.ranks.subarray(start,start+5));
    highlight.delete(-1);
    if(!highlight.size)highlight=null;
  }
  scene.draw(track,frame,{muscles:$('muscles').checked,reference:$('showref').checked,lower,highlight});
}

const rows=Array.from({length:5},()=>{
  const li=document.createElement('li');
  li.innerHTML='<div class="activation-row"><strong></strong><b></b></div><div class="activation-original"></div><progress max="100"></progress><div class="activation-detail"><span></span><span></span></div>';
  $('activationList').append(li);
  return {li,name:li.querySelector('strong'),number:li.querySelector('b'),id:li.querySelector('.activation-original'),
    bar:li.querySelector('progress'),direction:li.querySelector('.activation-detail span'),extra:li.querySelector('.activation-detail span:last-child')};
});
function paint(){
  if(!track)return;
  draw();
  $('clock').textContent=frameTime().toFixed(2)+' / '+endTime().toFixed(2)+' s';
  $('frameNumber').textContent='帧 '+(frame+1)+' / '+track.meta.frames+'　·　100 Hz';
  $('timeline').value=frame;
  const sim=mode==='tracking',lower=$('muscleDisplay').value==='lower_force';
  $('metric').textContent=sim?'17 点均误差 '+track.error[frame].toFixed(1)+' cm':'';
  $('activationTitle').textContent=lower?'臀腿发力 · Top 5':'主要激活肌肉 · Top 5';
  $('activationTime').textContent=sim?frameTime().toFixed(2)+' s':'';
  $('activationHint').textContent=sim?(lower?'当前帧按臀腿主动张力排序':'当前帧按实际肌肉激活排序'):'切到 Tracking 结果可查看实际肌肉激活。';
  $('activationNote').textContent=sim?(lower?'正功率表示输出，负功率表示吸收。':'速度为负表示缩短，为正表示拉长。'):'';
  $('activationList').classList.toggle('blue-list',sim&&$('highlightTop5').checked&&$('muscles').checked);
  const slot=(frame*2+Number(lower))*5;
  rows.forEach((row,i)=>{
    const id=sim?track.ranks[slot+i]:-1;
    row.li.hidden=id<0;
    if(id<0)return;
    const muscle=model.meta.muscles[id];
    const idx=(slot+i)*4,v=track.values;
    const activation=v[idx]*100,velocity=v[idx+1],threshold=lower ? .001 : 1e-6;
    row.name.textContent=muscle.zh;row.id.textContent=muscle.name;
    row.number.textContent=lower?v[idx+2].toFixed(1)+' N':activation.toFixed(1)+'%';
    row.bar.value=activation;
    row.direction.textContent=velocity < -threshold?'收缩（缩短）':velocity>threshold?'拉伸（变长）':lower?'近等长':'近乎不变';
    row.extra.textContent=lower?v[idx+3].toFixed(2)+' W':velocity.toFixed(4)+' m/s';
  });
}

function summary(){
  const sim=mode==='tracking',meta=track.meta;
  $('modeLabel').textContent=(sim?'Tracking':'参考动作')+' · '+activeClip.label;
  $('clipId').textContent=activeClip.clip;
  $('outcome').classList.toggle('warn',sim&&!meta.noFall);
  $('outcome').textContent=!sim?'MyoFullBody 参考动作 · 运动学预览':meta.noFall?
    '完整无跌倒 · '+(meta.trackingPass?'全程跟踪通过':'全程跟踪未通过'):
    '跌倒确认于 '+meta.fall.toFixed(2)+' s · 记录至此结束';
  $('scoreStatus').textContent=sim?'观测区间 '+(meta.start||0).toFixed(2)+'–'+endTime().toFixed(2)+' s · '+meta.scoreHz+' Hz':'切到 Tracking 结果可查看肌束得分。';
  $('scoreNote').hidden=!sim;
  $('segmentScoreList').replaceChildren(...(meta.score||[]).map((s,i)=>{
    const li=document.createElement('li');
    for(const [tag,cls,text] of [['span','rank',i+1],['strong','',s.name_zh],['span','score-number',s.score_s.toFixed(3)+' s']]){
      const el=document.createElement(tag);el.className=cls;el.textContent=text;li.append(el);
    }
    li.title=s.name;return li;
  }));
  $('ruler').replaceChildren(...Array.from({length:6},(_,i)=>{
    const tick=document.createElement('span');tick.textContent=(endTime()*i/5).toFixed(1)+' s';return tick;
  }));
  $('muscleDisplay').disabled=!sim;$('highlightTop5').disabled=!sim||!$('muscles').checked;
  $('timeline').max=meta.frames-1;
  $('status').textContent='已载入 · '+(sim?activeClip.results.find(r=>r.id===$('resultSelect').value).label:'参考动作');
}
async function loadView(reset=false){
  if (!scene || !catalog) return;
  const t=reset ? 0 : track ? frameTime() : requestedTime;
  requestedTime=t;
  track=null;
  const token=++generation;
  pause();pending?.abort();pending=new AbortController();
  const clip=catalog.clips.find(c=>c.id===$('motion').value);
  const result=clip.results.find(r=>r.id===$('resultSelect').value);
  const files=mode==='reference'?clip.reference:result.files;
  $('refMode').setAttribute('aria-pressed',String(mode==='reference'));
  $('simMode').setAttribute('aria-pressed',String(mode==='tracking'));
  lockTransport(true);message('正在载入'+clip.label+'…');$('status').textContent='正在载入回放';
  try{
    const next=await unpack(files,pending.signal);
    if(token!==generation)return;
    const changed=activeClip!==clip;
    track=next;activeClip=clip;
    frame=Math.max(0,Math.min(next.meta.frames-1,Math.round((t-(next.meta.start||0))*next.meta.hz)));
    if(changed){
      scene.anchor=[next.reference[0]/2000,next.reference[1]/2000,.83];
      scene.reset();
    }
    summary();paint();message('');lockTransport(false);
  }catch(error){
    if(token!==generation)return;
    track=null;message('回放载入失败。\n'+error.message);$('status').textContent='请重新选择动作或刷新页面';
  }
}

$('play').onclick=togglePlay;$('prev').onclick=()=>step(-1);$('next').onclick=()=>step(1);
$('start').onclick=()=>{pause();seek(0);};
$('timeline').oninput=()=>{pause();seek(Number($('timeline').value));};
$('speed').onchange=()=>{if(playing){playFrame=frame;playStart=performance.now();}};
$('showref').onchange=draw;$('muscles').onchange=()=>{if(track){summary();paint();}};
$('highlightTop5').onchange=paint;$('muscleDisplay').onchange=paint;
$('resetView').onclick=()=>{scene?.reset();draw();};
$('motion').onchange=()=>loadView(true);
$('resultSelect').onchange=()=>{mode='tracking';loadView();};
for(const [id,value] of [['refMode','reference'],['simMode','tracking']]){
  $(id).onclick=()=>{if(catalog && (mode!==value || !track)){mode=value;loadView();}};
}
document.addEventListener('keydown',e=>{
  if(e.ctrlKey||e.metaKey||e.altKey||e.target.closest('select,button,input,summary,a'))return;
  if(!['Space','ArrowLeft','ArrowRight'].includes(e.code))return;
  e.preventDefault();
  if(e.code==='Space'){if(!e.repeat)togglePlay();}
  else step(e.code==='ArrowLeft'?-1:1);
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
async function start(){
  lockTransport(true);
  const response=await fetch('data/catalog.json',{cache:'no-cache'});
  if(!response.ok)throw Error('找不到动作清单。');
  catalog=await response.json();
  const first=catalog.clips[0];
  setOptions($('motion'),catalog.clips,first.id);
  setOptions($('resultSelect'),first.results,first.results[0].id);
  if(matchMedia('(max-width:720px)').matches)$('activationCard').open=false;
  model=await unpack(catalog.model);
  scene=new Scene($('scene'),model,draw);
  await loadView(true);
}
start().catch(error=>{message('三维回放无法打开。\n'+error.message);$('status').textContent='载入失败';});
