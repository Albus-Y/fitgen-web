import { composeClip, createReviewAudio } from './review-data.js';
import { createEightCountPanel, eightCountTitle as blockTitle } from './eight-count-panel.js?v=300d71f833';

const $=s=>document.querySelector(s);
const video=$('#video');
const theme=getComputedStyle(document.documentElement);
const palette={music:theme.getPropertyValue('--music').trim(),motion:theme.getPropertyValue('--accent').trim(),ink:theme.getPropertyValue('--ink').trim(),muted:theme.getPropertyValue('--muted').trim(),line:theme.getPropertyValue('--line').trim()};
const state={clip:null,ready:false,playing:false,offset:0,loop:'all',loopBlock:null,selected:null,blockId:null,startAt:0,videoStarted:false,token:0};
const eightCount=createEightCountPanel($('.count-panel'),t=>{if(state.ready)seek(t)});
let ctx,splitter,merger,gains,source,audioBuffer,abort,videoUrl,videoSeekToken=0,playSequence=0;
const sound={music:true,musicClick:false,motionClick:false};
const sync={maxUiGapMs:0,corrections:0,frames:0,lastFrame:0,lastVideoTime:0};
const diagnostics=document.createElement('output');diagnostics.id='diagnostics';diagnostics.hidden=true;document.body.append(diagnostics);
const number=(v,d=0)=>v===null||v===undefined?'—':Number(v).toFixed(d);
function notice(message,error=false){$('#notice').textContent=message;$('#notice').classList.toggle('error',error)}
function initAudio(){
  if(ctx)return;
  ctx=new AudioContext({latencyHint:'interactive'});
  splitter=ctx.createChannelSplitter(4);merger=ctx.createChannelMerger(2);
  gains=Array.from({length:4},()=>ctx.createGain());
  gains.forEach((gain,i)=>{splitter.connect(gain,i);if(i<2)gain.connect(merger,0,i);else{gain.connect(merger,0,0);gain.connect(merger,0,1)}});
  merger.connect(ctx.destination);updateSound();
}
function updateSound(){
  $('#music').setAttribute('aria-pressed',sound.music);
  $('#music-click').setAttribute('aria-pressed',sound.musicClick);
  $('#motion-click').setAttribute('aria-pressed',sound.motionClick);
  if(gains)[sound.music?.7:0,sound.music?.7:0,sound.musicClick?.14:0,sound.motionClick?.18:0].forEach((v,i)=>gains[i].gain.setValueAtTime(v,ctx.currentTime));
}
function audibleClock(){
  if(!ctx)return 0;
  const s=ctx.getOutputTimestamp?.();
  if(s?.contextTime>0)return Math.min(ctx.currentTime,s.contextTime+Math.max(0,performance.now()-s.performanceTime)/1000);
  return Math.max(0,ctx.currentTime-(ctx.outputLatency||ctx.baseLatency||0));
}
function bounds(){
  if(state.loop==='block'&&state.loopBlock)return [state.loopBlock.start_time_sec,state.loopBlock.end_time_sec];
  return [0,state.clip?.duration||30];
}
function time(){
  if(!state.playing)return state.offset;
  let t=state.offset+Math.max(0,audibleClock()-state.startAt);
  const [lo,hi]=bounds();
  if(state.loop!=='off'&&t>=hi)t=lo+(t-hi)%(hi-lo);
  return Math.max(0,Math.min(t,state.clip.duration));
}
function stopAudio(){if(source){try{source.stop()}catch{}source.disconnect();source=null}}
function pause(){
  playSequence++;
  state.offset=time();state.playing=false;state.videoStarted=false;
  stopAudio();video.pause();$('#play').textContent='播放';
}
async function seekVideo(t){
  const token=++videoSeekToken;
  if(video.readyState===0)return;
  if(Math.abs(video.currentTime-t)<.0005&&!video.seeking)return;
  await new Promise(resolve=>{
    let timer;
    const finish=()=>{clearTimeout(timer);video.removeEventListener('seeked',finish);resolve()};
    video.addEventListener('seeked',finish,{once:true});
    timer=setTimeout(finish,2000);
    video.currentTime=Math.min(t,Math.max(0,(video.duration||state.clip.duration)-.001));
  });
  return token===videoSeekToken;
}
async function play(){
  if(!state.ready||state.playing)return;
  const token=state.token,sequence=++playSequence;
  initAudio();await ctx.resume();
  let [lo,hi]=bounds();
  if(state.offset>=hi-.002)state.offset=lo;
  await seekVideo(state.offset);
  if(token!==state.token||sequence!==playSequence||!state.ready)return;
  source=ctx.createBufferSource();source.buffer=audioBuffer;
  source.loop=state.loop!=='off';source.loopStart=lo;source.loopEnd=hi;
  source.connect(splitter);
  state.startAt=ctx.currentTime+.08;
  state.playing=true;state.videoStarted=false;
  video.playbackRate=1;
  source.start(state.startAt,state.offset);
  $('#play').textContent='暂停';
}
function blockAt(t){return state.clip?.blocks.find(b=>t>=b.start_time_sec-1e-7&&t<b.end_time_sec-1e-7)||state.clip?.blocks.at(-1)}
function seek(t){
  pause();state.offset=Math.max(0,Math.min(t,state.clip.duration));
  if(state.loop==='block'&&(state.offset<bounds()[0]||state.offset>=bounds()[1])){
    state.loop='all';state.loopBlock=null;$('#loop').value='all';
  }
  seekVideo(state.offset);render(time());
}
function chooseMotion(i){
  state.selected=i;seek(state.clip.nearest[i].time);
  renderSelection();
}
function renderSelection(){
  const row=state.clip?.nearest[state.selected];
  document.querySelectorAll('#rows tr').forEach((r,i)=>r.classList.toggle('selected',i===state.selected));
  if(!row){$('#selection').textContent='选择一个动作 beat，查看最近音乐拍和提前／滞后时间。';return}
  if(row.music_time===null){$('#selection').textContent='动作 beat '+(row.motion_index+1)+'：没有可比较的音乐拍。';return}
  const b=state.clip.blocks.find(b=>b.block_id===row.block_id);
  const delta=Math.abs(row.delta_ms)<.5?'同一时刻':(row.delta_ms<0?'提前 ':'滞后 ')+number(Math.abs(row.delta_ms))+' ms';
  $('#selection').textContent='动作 beat '+(row.motion_index+1)+'（'+number(row.time,2)+' 秒） → 最近音乐拍 '+(row.music_index+1)+'（'+number(row.music_time,2)+' 秒），'+delta+'。最近音乐拍位于'+blockTitle(b)+(row.count_in_eight?'，第 '+row.count_in_eight+' 拍。':'。')+(blockAt(row.time)?.block_type==='gap'?' 动作拍处于音乐网格空缺区间，需结合原声审查。':'');
}
function refreshBlock(b){
  state.blockId=b?.block_id;
  $('#zoom-title').textContent=blockTitle(b)+' · 放大';
  $('#block-select').value=b?.block_id||'';
  $('#loop-block').disabled=!b?.is_complete;
}
function resizeCanvas(canvas){
  const w=canvas.getBoundingClientRect().width,h=canvas.getBoundingClientRect().height,dpr=devicePixelRatio||1;
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr)}
  const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);
  return {c,w,h};
}
function draw(canvas,lo,hi,t,zoom=false){
  const {c,w,h}=resizeCanvas(canvas);if(w<100||hi<=lo)return;
  const left=48,right=w-14,xx=v=>left+(right-left)*(v-lo)/(hi-lo);
  const musicY=zoom?72:60,motionY=zoom?119:93;
  const blue=palette.music,orange=palette.motion;
  c.font='11px "Segoe UI","Microsoft YaHei",sans-serif';c.textBaseline='middle';
  state.clip.blocks.forEach(b=>{
    const start=Math.max(lo,b.start_time_sec),end=Math.min(hi,b.end_time_sec);if(end<=start)return;
    c.fillStyle=b.is_complete?(b.fullNumber%2?'#273440':'#222b36'):'#302c35';
    c.fillRect(xx(start),5,xx(end)-xx(start),22);
    c.strokeStyle=palette.line;c.strokeRect(xx(start),5,xx(end)-xx(start),22);
    c.fillStyle=palette.muted;
    const label=b.is_complete?'八拍 '+b.fullNumber:b.block_type==='gap'?'空缺':'未满';
    if(xx(end)-xx(start)>30){c.save();c.beginPath();c.rect(xx(start)+3,5,xx(end)-xx(start)-6,22);c.clip();c.fillText(label,xx(start)+5,16);c.restore()}
  });
  [musicY,motionY].forEach(y=>{c.strokeStyle=palette.line;c.beginPath();c.moveTo(left,y);c.lineTo(right,y);c.stroke()});
  c.fillStyle=blue;c.fillText('音乐',3,musicY);
  c.fillStyle=orange;c.fillText('动作',3,motionY);
  const tick=zoom?(hi-lo>6?1:.5):5;
  c.fillStyle=palette.muted;c.font='10px "Segoe UI",sans-serif';
  for(let v=Math.ceil(lo/tick)*tick;v<=hi;v+=tick){const x=xx(v);c.fillText(number(v,zoom?1:0)+'s',x-6,h-8)}
  state.clip.music_beats.filter(b=>b.time_sec>=lo&&b.time_sec<hi).forEach(b=>{
    const x=xx(b.time_sec);c.strokeStyle=blue;c.lineWidth=b.is_downbeat?2:1;
    c.beginPath();c.moveTo(x,musicY-15);c.lineTo(x,musicY+12);c.stroke();
    if(b.is_downbeat){c.fillStyle='#d1e6f8';c.beginPath();c.moveTo(x,musicY-21);c.lineTo(x+4,musicY-17);c.lineTo(x,musicY-13);c.lineTo(x-4,musicY-17);c.fill()}
    if(zoom){
      const block=blockAt(b.time_sec);const count=block?.is_complete?b.beat_index-block.start_beat_index+1:null;
      c.fillStyle=blue;c.font='600 13px "Segoe UI",sans-serif';c.textAlign='center';c.fillText(count??'·',x,musicY-31);
      c.font='10px "Segoe UI",sans-serif';c.fillStyle=palette.muted;c.fillText(number(b.time_sec,2),x,musicY+24);c.textAlign='left';
    }
  });
  state.clip.motion_beats.forEach((v,i)=>{
    if(v<lo||v>=hi)return;
    const x=xx(v),selected=state.selected===i;
    c.fillStyle=orange;c.beginPath();c.arc(x,motionY,selected?6:4,0,Math.PI*2);c.fill();
    if(selected){c.strokeStyle=palette.motion;c.lineWidth=2;c.beginPath();c.arc(x,motionY,10,0,Math.PI*2);c.stroke();
      const near=state.clip.nearest[i];
      if(near.music_time!==null){c.strokeStyle=palette.motion;c.lineWidth=1;c.setLineDash([3,3]);c.beginPath();c.moveTo(x,motionY-8);c.lineTo(xx(near.music_time),musicY+14);c.stroke();c.setLineDash([])}
    }
    if(zoom){c.font='10px "Segoe UI",sans-serif';c.textAlign='center';c.fillText('#'+(i+1),x,motionY+17);c.textAlign='left'}
  });
  c.lineWidth=1;
  if(t>=lo&&t<=hi){const x=xx(t);c.strokeStyle=palette.ink;c.lineWidth=1.4;c.beginPath();c.moveTo(x,2);c.lineTo(x,h-19);c.stroke();c.fillStyle=palette.ink;c.beginPath();c.moveTo(x-4,0);c.lineTo(x+4,0);c.lineTo(x,6);c.fill()}
  canvas.dataset.renderTime=t.toFixed(6);canvas.dataset.start=lo;canvas.dataset.end=hi;
}
function render(t){
  if(!state.clip)return;
  const b=state.loop==='block'?state.loopBlock:blockAt(t);
  if(b?.block_id!==state.blockId)refreshBlock(b);
  eightCount.render(state.clip,b,t);
  $('#seek').value=t;
  draw($('#overview'),0,state.clip.duration,t);
  draw($('#zoom'),b?.start_time_sec??0,b?.end_time_sec??state.clip.duration,t,true);
}
function tick(now){
  const t=time();
  if(state.ready&&state.playing){
    if(state.loop==='off'&&t>=state.clip.duration-.0001)pause();
    else if(audibleClock()>=state.startAt){
      if(!state.videoStarted){
        state.videoStarted=true;video.currentTime=Math.min(t,video.duration-.001);
        video.play().catch(e=>{pause();notice('画面未能播放：'+e.message,true)});
      }else if(!video.seeking&&video.readyState>=2&&Math.abs(video.currentTime-t)>.04){
        video.currentTime=Math.min(t,video.duration-.001);sync.corrections++;
        if(video.paused)video.play().catch(()=>{});
      }
    }
    if(sync.lastFrame&&document.visibilityState==='visible')sync.maxUiGapMs=Math.max(sync.maxUiGapMs,Math.min(1000,now-sync.lastFrame));
    sync.frames++;
  }
  sync.lastFrame=state.playing?now:0;
  render(t);
  if(state.clip)diagnostics.textContent=JSON.stringify({clip:state.clip.id,ready:state.ready,playing:state.playing,time:t,videoTime:video.currentTime,speed:1,loop:state.loop,bounds:bounds(),audioChannels:audioBuffer?.numberOfChannels??0,audioDuration:audioBuffer?.duration??0,sound,audioContext:ctx?.state,block:state.blockId,sync});
  requestAnimationFrame(tick);
}
function canvasClick(event){
  if(!state.ready)return;
  const canvas=event.currentTarget,rect=canvas.getBoundingClientRect(),x=event.clientX-rect.left;
  const lo=Number(canvas.dataset.start),hi=Number(canvas.dataset.end);
  let t=lo+(x-48)/(rect.width-62)*(hi-lo);t=Math.max(lo,Math.min(t,hi));
  const nearest=state.clip.motion_beats.map((v,i)=>({v,i,d:Math.abs(v-t)/(hi-lo)*(rect.width-62)})).sort((a,b)=>a.d-b.d)[0];
  const y=event.clientY-rect.top,motionY=canvas.id==='zoom'?119:93;
  if(nearest&&nearest.d<12&&Math.abs(y-motionY)<23)chooseMotion(nearest.i);else seek(t);
}
function populate(){
  const d=state.clip;
  $('#clip-title').textContent=d.title_zh+' / '+d.title;document.title=d.title_zh+' · Pamela beat 分析 · FitGen';
  $('#duration').textContent=d.duration.toFixed(2);$('#seek').max=d.duration;
  $('#median').textContent=number(d.stats.median_ms)+' ms';$('#p95').textContent=number(d.stats.p95_ms)+' ms';
  $('#within').textContent=d.stats.within_100ms+' / '+d.stats.total+'（'+number(100*d.stats.within_100ms/d.stats.total)+'%）';
  $('#beat-summary').textContent=d.music_beats.length+' 个音乐拍 / '+d.motion_beats.length+' 个动作 beat';
  const picker=$('#block-select');picker.replaceChildren();d.blocks.forEach(b=>{const o=document.createElement('option');o.value=b.block_id;o.textContent=blockTitle(b)+' · '+number(b.start_time_sec,2)+'–'+number(b.end_time_sec,2)+'s';picker.append(o)});
  $('#rows').replaceChildren();
  d.nearest.forEach(row=>{
    const tr=document.createElement('tr'),bt=document.createElement('button');bt.textContent='#'+(row.motion_index+1);bt.setAttribute('aria-label','定位动作 beat '+(row.motion_index+1));bt.onclick=()=>chooseMotion(row.motion_index);
    const td=document.createElement('td');td.append(bt);tr.append(td);
    const block=d.blocks.find(b=>b.block_id===row.block_id);
    [number(row.time,3)+' s',row.music_index===null?'—':'#'+(row.music_index+1),number(row.music_time,3)+' s',
      row.delta_ms===null?'—':Math.abs(row.delta_ms)<.5?'同一时刻':(row.delta_ms<0?'提前 ':'滞后 ')+number(Math.abs(row.delta_ms))+' ms',
      row.count_in_eight?'第 '+block.fullNumber+' 组 · 第 '+row.count_in_eight+' 拍':blockTitle(block)].forEach((value,i)=>{const cell=document.createElement('td');cell.textContent=value;if(i===3)cell.className=Math.abs(row.delta_ms)<=100+1e-6?'ok':'warn';tr.append(cell)});
    $('#rows').append(tr);
  });
  $('#analysis-note').textContent='分别分析原始 MP4 的原声；All-In-One harmonix-all，30 FPS activation，现有八拍后处理。动作 beat 直接复用已确认结果，20 FPS。完整八拍 '+d.grid_summary.full_block_count+' 组；未完成区间 '+d.grid_summary.partial_block_count+' 段；空缺 '+d.grid_summary.gap_block_count+' 段。'+(d.bpm?' 模型 BPM：'+number(d.bpm,1)+'。':'');
  $('#warnings').textContent=d.warnings.length?'分析诊断：'+d.warnings.join('；'):'分析模块没有额外警告。';
  const links=$('#data-links');links.replaceChildren();
  [['analysis.json','音乐八拍、诊断与版本'],[d.media.manifest,'动作 beat 检测记录']].forEach(([url,label])=>{const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.textContent=label;links.append(a)});
  renderSelection();state.blockId=null;render(0);
}
async function loadClip(id){
  pause();state.ready=false;state.clip=null;state.selected=null;state.blockId=null;state.offset=0;state.loop='all';state.loopBlock=null;
  $('#loop').value='all';$('#play').disabled=true;$('#seek').disabled=true;$('#rows').replaceChildren();
  eightCount.clear();notice('正在加载原声、画面与八拍网格…');
  abort?.abort();abort=new AbortController();const signal=abort.signal,token=++state.token;
  video.removeAttribute('src');video.load();
  if(videoUrl){URL.revokeObjectURL(videoUrl);videoUrl=null}
  try{
    initAudio();
    const item=catalog.clips.find(c=>c.id===id);
    const d=composeClip(item,motionCatalog.clips.find(c=>c.id===id));
    let n=0;d.blocks.forEach(b=>b.fullNumber=b.is_complete?++n:null);
    state.clip=d;populate();video.poster=d.media.poster;
    // 与站内分片媒体相同，使用 Blob 保证无 Range 支持的本地预览也能准确定位。
    const [ar,vr]=await Promise.all([fetch(d.media.audio,{signal}),fetch(d.media.video,{signal})]);
    if(!ar.ok)throw Error('原声读取失败');if(!vr.ok)throw Error('共用视频读取失败');
    const [decoded,videoBlob]=await Promise.all([ar.arrayBuffer().then(buffer=>ctx.decodeAudioData(buffer)),vr.blob()]);
    if(token!==state.token)return;
    audioBuffer=createReviewAudio(ctx,decoded,d);
    videoUrl=URL.createObjectURL(videoBlob);video.src=videoUrl;video.load();
    if(video.readyState<2)await new Promise((resolve,reject)=>{
      const done=()=>{clearTimeout(timer);video.removeEventListener('loadeddata',done);video.removeEventListener('error',bad);resolve()};
      const bad=()=>{clearTimeout(timer);video.removeEventListener('loadeddata',done);reject(Error('画面加载失败'))};
      const timer=setTimeout(bad,25000);video.addEventListener('loadeddata',done,{once:true});video.addEventListener('error',bad,{once:true});
    });
    if(token!==state.token)return;
    state.ready=true;$('#play').disabled=false;$('#seek').disabled=false;
    sync.maxUiGapMs=0;sync.corrections=0;sync.frames=0;sync.lastFrame=0;
    notice('已加载 '+d.title_zh+'。音乐网格待人工审查；可分别开启两种提示音。');
  }catch(e){if(e.name==='AbortError'||token!==state.token)return;notice('加载失败：'+e.message+'。请刷新或重新选择片段。',true)}
}
let catalog,motionCatalog;
$('#play').onclick=()=>state.playing?pause():play().catch(e=>notice(e.message,true));
$('#seek').oninput=e=>{if(state.ready)seek(Number(e.target.value))};
$('#music').onclick=()=>{sound.music=!sound.music;updateSound()};
$('#music-click').onclick=()=>{sound.musicClick=!sound.musicClick;updateSound()};
$('#motion-click').onclick=()=>{sound.motionClick=!sound.motionClick;updateSound()};
$('#loop').onchange=async e=>{
  const was=state.playing;pause();const b=blockAt(state.offset);
  state.loop=e.target.value;state.loopBlock=state.loop==='block'&&b?.is_complete?b:null;
  if(state.loop==='block'&&!state.loopBlock){state.loop='all';e.target.value='all'}
  if(was)await play();
};
$('#block-select').onchange=e=>{const b=state.clip.blocks.find(b=>b.block_id===e.target.value);if(b)seek(b.start_time_sec)};
$('#overview').onclick=canvasClick;$('#zoom').onclick=canvasClick;
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.playing){pause();notice('页面进入后台，已暂停；返回后点击播放继续审查。')}});
video.addEventListener('error',()=>{if(state.ready){pause();notice('视频解码失败，请刷新页面。',true)}});
window.addEventListener('keydown',e=>{if(e.code==='Space'&&!['INPUT','SELECT','BUTTON','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();$('#play').click()}});
try{
  const responses=await Promise.all([fetch('analysis.json'),fetch('../motion-beat-demo/catalog.json')]);
  if(responses.some(r=>!r.ok))throw Error('音乐分析或共用动作目录读取失败');
  [catalog,motionCatalog]=await Promise.all(responses.map(r=>r.json()));
  const select=$('#clip-select');
  catalog.clips.forEach(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=c.title_zh+' / '+motionCatalog.clips.find(m=>m.id===c.id).title;select.append(o)});
  select.disabled=false;select.onchange=()=>loadClip(select.value);
  requestAnimationFrame(tick);await loadClip(catalog.clips[0].id);
}catch(e){notice('无法读取示例：'+e.message+'。请刷新页面。',true)}
