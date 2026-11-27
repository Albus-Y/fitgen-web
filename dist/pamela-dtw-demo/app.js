import {createMultitrackAudio} from '../pamela-beat-demo/review-data.js?v=multitrack-v1';
import {createEightCountPanel,eightCountTitle as blockName} from '../pamela-beat-demo/eight-count-panel.js?v=7d91fd13bd';
import {exportExperiment,timingStats,PRESETS} from './experiment.js?v=0c54eefb16';
import {interpolate,SERVER_SCHEMA} from './dtw.js?v=7c1a1a71a8';
import {COLORS,fitCamera,drawPose,drawTimeline,drawMap,drawPath} from './renderer.js?v=99d49ce4b8';

const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const state={ready:false,playing:false,offset:0,startAt:0,loop:'all',loopBlock:null,token:0,result:null,clip:null,block:null,frames:0,maxFrameGap:0,lastFrame:0};
const eightCount=createEightCountPanel($('.count-panel'),seek);
const sound={music:true,musicCue:false,motionCue:'off'};
const beatHighlights=[true,true,true];
let catalog,musicCatalog,motionCatalog,serverCatalog,ctx,splitter,merger,gains,source,audioBuffer,worker,camera,currentData,lastPlot=0,playToken=0;
const cache=new Map();
const fmt=(v,d=0)=>v===null||v===undefined?'—':Number(v).toFixed(d);
function notice(message,error=false){$('#status').textContent=message;$('#status').classList.toggle('error',error);}
function initAudio(){
  if(ctx)return;ctx=new AudioContext({latencyHint:'interactive'});splitter=ctx.createChannelSplitter(6);merger=ctx.createChannelMerger(2);
  gains=Array.from({length:6},()=>ctx.createGain());
  gains.forEach((gain,i)=>{splitter.connect(gain,i);if(i<2)gain.connect(merger,0,i);else{gain.connect(merger,0,0);gain.connect(merger,0,1);}});
  merger.connect(ctx.destination);updateSound();
}
function updateSound(){
  $('#music').setAttribute('aria-pressed',sound.music);$('#music-cue').setAttribute('aria-pressed',sound.musicCue);
  const levels=[sound.music?.7:0,sound.music?.7:0,sound.musicCue?.14:0,...[0,1,2].map(i=>sound.motionCue===String(i)?.18:0)];
  gains?.forEach((gain,i)=>gain.gain.setValueAtTime(levels[i],ctx.currentTime));
}
function audioClock(){
  if(!ctx)return 0;const stamp=ctx.getOutputTimestamp?.();
  if(stamp?.contextTime>0)return Math.min(ctx.currentTime,stamp.contextTime+Math.max(0,performance.now()-stamp.performanceTime)/1000);
  return Math.max(0,ctx.currentTime-(ctx.outputLatency||ctx.baseLatency||0));
}
function bounds(){return state.loop==='block'&&state.loopBlock?[state.loopBlock.start_time_sec,state.loopBlock.end_time_sec]:[0,state.result?.duration||30];}
function time(){
  if(!state.playing)return state.offset;
  let t=state.offset+Math.max(0,audioClock()-state.startAt);const [lo,hi]=bounds();
  if(state.loop!=='off'&&t>=hi)t=lo+(t-hi)%(hi-lo);return Math.max(0,Math.min(t,state.result.duration));
}
function pause(){playToken++;state.offset=time();state.playing=false;if(source){try{source.stop();}catch{}source.disconnect();source=null;}$('#play').textContent='播放';}
async function play(){
  if(!state.ready||state.playing)return;const token=state.token,sequence=++playToken;initAudio();await ctx.resume();if(token!==state.token||sequence!==playToken||!state.ready)return;
  const [lo,hi]=bounds();if(state.offset>=hi-.001)state.offset=lo;
  source=ctx.createBufferSource();source.buffer=audioBuffer;source.loop=state.loop!=='off';source.loopStart=lo;source.loopEnd=hi;source.connect(splitter);
  state.startAt=ctx.currentTime+.06;state.playing=true;source.start(state.startAt,state.offset);$('#play').textContent='暂停';
}
function seek(t){if(!state.ready)return;pause();state.offset=Math.max(0,Math.min(t,state.result.duration));if(state.loop==='block'&&(state.offset<bounds()[0]||state.offset>=bounds()[1])){state.loop='all';state.loopBlock=null;$('#loop').value='all';}render(state.offset,true);}
function blockAt(t){return state.clip?.blocks.find(b=>t>=b.start_time_sec-1e-7&&t<b.end_time_sec-1e-7)||state.clip?.blocks.at(-1);}

async function fetchSource(id){
  if(cache.has(id))return cache.get(id);initAudio();
  const meta=catalog.clips.find(c=>c.id===id),music=musicCatalog.clips.find(c=>c.id===id),motion=motionCatalog.clips.find(c=>c.id===id);
  const resultMeta=serverCatalog.clips.find(c=>c.id===id);if(!resultMeta)throw Error('缺少该片段的服务器结果');
  const [bodyResponse,audioResponse,resultResponse]=await Promise.all([fetch('data/'+meta.file),fetch('../pamela-beat-demo/'+music.audio),fetch('results/'+resultMeta.file+'?v='+resultMeta.sha256.slice(0,10))]);
  if(!bodyResponse.ok||!audioResponse.ok||!resultResponse.ok)throw Error('共用资源或服务器结果读取失败');
  const [body,audioBytes,resultBytes]=await Promise.all([bodyResponse.arrayBuffer(),audioResponse.arrayBuffer(),resultResponse.arrayBuffer()]);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',body)),b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==meta.sha256)throw Error('动作数据 SHA256 不匹配');
  const positions=new Float32Array(body);if(positions.length!==meta.shape.reduce((a,b)=>a*b,1)||positions.some(v=>!Number.isFinite(v)))throw Error('动作数据形状或数值无效');
  const resultHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',resultBytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(resultHash!==resultMeta.sha256)throw Error('服务器结果 SHA256 不匹配');
  const results=JSON.parse(new TextDecoder().decode(resultBytes));if(results.schema!==SERVER_SCHEMA||results.clip!==id)throw Error('服务器结果版本或片段不一致');
  const decoded=await ctx.decodeAudioData(audioBytes);const data={meta,music,motion,positions,decoded,results};cache.set(id,data);return data;
}
async function run(){
  const seed=serverCatalog.seed;
  pause();state.ready=false;state.result=null;state.offset=0;state.loop='all';state.loopBlock=null;state.block=null;$('#loop').value='all';
  eightCount.clear();
  $$('.motion-card').forEach(card=>card.classList.remove('beat-active'));
  ['play','seek','export','export-motion'].forEach(id=>$('#'+id).disabled=true);
  worker?.terminate();const token=++state.token;notice('正在载入服务器 xTW 结果并核对扰动输入…');
  try{
    const data=await fetchSource($('#clip').value);if(token!==state.token)return;currentData=data;
    const [frames,joints]=data.meta.shape;
    let fullNumber=0;state.clip={...data.music,duration:data.motion.media_duration,blocks:data.music.blocks.map(b=>({...b,fullNumber:b.is_complete?++fullNumber:null}))};
    document.title=data.motion.title+' · DTW 扰动实验 · FitGen';
    const preset=$('#preset').value,beatMode=$('#beat-mode').value;
    const serverCase=data.results.cases.find(c=>c.preset===preset&&c.beatMode===beatMode&&c.seed===seed);
    if(!serverCase||serverCase.originalSha256!==data.meta.sha256)throw Error('没有对应设置和动作版本的服务器结果');
    const input={original:data.positions,frames,joints,fps:data.meta.fps,duration:data.motion.media_duration,originalBeats:data.motion.beats,musicBeats:data.music.music_beats.map(b=>b.time_sec),preset,seed,beatMode,serverCase};
    worker=new Worker(new URL('./worker.js?v=5467e55b54',import.meta.url),{type:'module'});
    const result=await new Promise((resolve,reject)=>{worker.onmessage=({data})=>data.error?reject(Error(data.error)):resolve(data.result);worker.onerror=error=>reject(Error(error.message||'DTW 计算失败'));worker.postMessage({id:token,input});});
    if(token!==state.token)return;worker.terminate();worker=null;
    state.result=result;camera=fitCamera(data.positions);state.frames=0;state.maxFrameGap=0;state.lastFrame=0;
    const musicCues=state.clip.music_beats.map(b=>({time:b.time_sec,frequency:b.is_downbeat?1050:720,amplitude:b.is_downbeat?.9:.65}));
    const motionCues=result.variants.map((v,i)=>v.beats.map(t=>({time:t,frequency:[1800,1450,2100][i],amplitude:.8})));
    audioBuffer=createMultitrackAudio(ctx,data.decoded,result.duration,[musicCues,...motionCues]);
    populate();state.ready=true;['play','seek','export','export-motion'].forEach(id=>$('#'+id).disabled=false);
    notice('已载入 '+data.motion.title+' · '+PRESETS[input.preset].label+' · 服务器 Anchor xTW（Drop-DTW + GDTW）。扰动输入 SHA256 核对一致。');
    render(0,true);
  }catch(error){if(token!==state.token)return;notice('实验未完成：'+error.message,true);}
}

function populate(){
  const r=state.result,variants=r.variants,select=$('#block');select.replaceChildren();
  for(const b of state.clip.blocks){const option=document.createElement('option');option.value=b.block_id;option.textContent=blockName(b)+' · '+fmt(b.start_time_sec,2)+'–'+fmt(b.end_time_sec,2)+' s';select.append(option);}
  variants.forEach((v,i)=>{$('#beat-count-'+i).textContent=v.beats.length+' 个事件';v.detectedStats=timingStats(v.detectedBeats,state.clip.music_beats.map(b=>b.time_sec));});
  const rows=[
    ['映射事件 → 音乐拍 · 误差中位数',v=>fmt(v.musicStats.median)+' ms'],
    ['映射事件 → 音乐拍 · P95',v=>fmt(v.musicStats.p95)+' ms'],
    ['映射事件 · ±100 ms 内',v=>v.musicStats.within100+' / '+v.musicStats.count+' ('+fmt(100*v.musicStats.within100/v.musicStats.count)+'%)'],
    ['相对原始时序 · RMSE',v=>fmt(v.recoveryStats.rmse)+' ms'],
    ['相对原始时序 · P95',v=>fmt(v.recoveryStats.p95)+' ms'],
    ['相对原序列的总速度 · 范围',v=>fmt(v.recoveryStats.rateMin,3)+'–'+fmt(v.recoveryStats.rateMax,2)+'×'],
    ['服务器对扰动输入施加的变速',v=>v.id==='corrected'?fmt(r.alignment.diagnostics.warp_rate_min,3)+'–'+fmt(r.alignment.diagnostics.warp_rate_max,3)+'×':'—'],
    ['重采样后重新检测 · beat 数',v=>String(v.detectedBeats.length)],
    ['重新检测 beat → 音乐拍 · 中位数',v=>fmt(v.detectedStats.median)+' ms']
  ];
  const tbody=$('#metrics');tbody.replaceChildren();for(const [label,value] of rows){const tr=document.createElement('tr'),th=document.createElement('td');th.textContent=label;tr.append(th);variants.forEach(v=>{const td=document.createElement('td');td.textContent=value(v);tr.append(td);});tbody.append(tr);}
  const before=variants[1],after=variants[2],musicGain=before.musicStats.median-after.musicStats.median,recoveryGain=before.recoveryStats.rmse-after.recoveryStats.rmse;
  const recoveryText=Math.abs(recoveryGain)<.5?'与扰动序列相近':recoveryGain>0?'减少 '+fmt(recoveryGain)+' ms':'增加 '+fmt(-recoveryGain)+' ms';
  const extreme=after.recoveryStats.outsideHalfDouble;
  $('#finding').textContent='DTW 映射事件的贴拍中位误差'+(musicGain>=0?'减少 ':'增加 ')+fmt(Math.abs(musicGain))+' ms；相对原始时序的 RMSE '+recoveryText+'。'+(extreme>.01?' 局部速度有 '+fmt(extreme*100)+'% 的时段超出 0.5–2×，请结合画面和重检测结果审查。':'');
  $('#finding').classList.toggle('warn',recoveryGain<-.5||extreme>.01);
  $('#provenance').textContent='骨架：已审查 SMPL-X GLB 身体 22 关节，600 帧 / 20 FPS。原始 beat、原音乐和八拍继续复用。当前模式：'+(r.beatMode==='tracked'?'已确认事件随动作一起扰动。':'按审查版 reflect 规则重新检测事件。')+' 模块版本 '+serverCatalog.provenance.moduleVersion+'；代码基准 '+serverCatalog.provenance.gitHead.slice(0,10)+'，实际工作区文件 SHA256 随结果保存。';
  const a=r.alignment;
  $('#algorithm-info').textContent='Drop-DTW：'+a.matches.length+' 对匹配，丢弃 '+a.droppedMotionIndices.length+' 个动作事件、'+a.droppedMusicIndices.length+' 个音乐拍；代价 '+fmt(a.diagnostics.drop_dtw_total_cost,5)+'。GDTW：'+a.outputTimes.length+' 个采样点，目标值 '+fmt(a.diagnostics.gdtw_objective,6)+'。后端 '+a.backend+'。';
  drawPath($('#path'),r);
}

function render(t,force=false){
  if(!state.result)return;const r=state.result,b=blockAt(t);
  if(state.block!==b.block_id){state.block=b.block_id;$('#block').value=b.block_id;$('#loop-block').disabled=!b.is_complete;}
  eightCount.render(state.clip,b,t);
  const musicIndex=state.clip.music_beats.findLastIndex(x=>x.time_sec<=t);
  const count=b.is_complete&&musicIndex>=b.start_beat_index?musicIndex-b.start_beat_index+1:null;
  $('#grid-position').textContent=blockName(b)+(count?' · 第 '+count+' 拍':'');
  $('#clock').innerHTML=fmt(t,2)+' <small>/ '+fmt(r.duration,2)+' s</small>';$('#clock').dataset.time=t.toFixed(6);$('#seek').value=t.toFixed(3);
  r.variants.forEach((v,i)=>{
    const active=drawPose($('#pose-'+i),v,t,r,currentData.meta.parents,camera,COLORS[i]);
    const card=$('#motion-card-'+i);card.classList.toggle('beat-active',beatHighlights[i]&&active);card.dataset.beatHighlightEnabled=String(beatHighlights[i]);
    $('#source-time-'+i).textContent=fmt(interpolate(r.times,v.sourceTimes,t),2);
  });
  drawTimeline($('#overview'),r,state.clip,t);drawTimeline($('#zoom'),r,state.clip,t,[b.start_time_sec,b.end_time_sec]);
  if(force||performance.now()-lastPlot>100){drawMap($('#map'),r,t);lastPlot=performance.now();}
  $('#diagnostics').textContent=JSON.stringify({clip:state.clip.id,ready:state.ready,playing:state.playing,time:t,speed:1,loop:state.loop,bounds:bounds(),audioChannels:audioBuffer?.numberOfChannels,audioDuration:audioBuffer?.duration,sound,beatHighlights,method:r.alignment.method,backend:r.alignment.backend,inputVerified:r.inputVerified,caseId:r.alignment.caseId,beatMode:r.beatMode,seed:r.truth.parameters.seed,amplitude:r.truth.parameters.amplitude,counts:r.variants.map(v=>v.beats.length),detected:r.variants.map(v=>v.detectedBeats.length),sync:{frames:state.frames,maxFrameGapMs:state.maxFrameGap}});
}
function tick(now){
  if(state.playing){if(state.lastFrame)state.maxFrameGap=Math.max(state.maxFrameGap,now-state.lastFrame);state.lastFrame=now;state.frames++;}else state.lastFrame=0;
  if(state.ready){const t=time();if(state.playing&&state.loop==='off'&&t>=state.result.duration-.0001)pause();render(t);}
  requestAnimationFrame(tick);
}
function canvasSeek(event){const canvas=event.currentTarget,rect=canvas.getBoundingClientRect(),lo=Number(canvas.dataset.start),hi=Number(canvas.dataset.end),fraction=Math.max(0,Math.min(1,(event.clientX-rect.left-64)/(rect.width-78)));seek(lo+fraction*(hi-lo));}
function download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function metadata(){return {clip:state.clip.id,source:currentData.meta,music_analysis:musicCatalog.source,server_module:serverCatalog.provenance,server_case:state.result.alignment.caseId,input_beat_mode:state.result.beatMode,motion_detector:{fps:20,smoothing_sigma:5,min_interval:.2,boundary_mode:'reflect'}};}
$('#play').onclick=()=>state.playing?pause():play().catch(error=>notice(error.message,true));
$('#seek').oninput=e=>seek(Number(e.target.value));
$('#music').onclick=()=>{sound.music=!sound.music;updateSound();};$('#music-cue').onclick=()=>{sound.musicCue=!sound.musicCue;updateSound();};$('#motion-cue').onchange=e=>{sound.motionCue=e.target.value;updateSound();};
$$('[data-beat-highlight]').forEach(button=>{button.onclick=()=>{const i=Number(button.dataset.beatHighlight);beatHighlights[i]=!beatHighlights[i];button.setAttribute('aria-pressed',String(beatHighlights[i]));if(state.ready)render(time(),true);};});
$('#loop').onchange=async e=>{const was=state.playing;pause();const b=blockAt(state.offset);state.loop=e.target.value;state.loopBlock=state.loop==='block'&&b?.is_complete?b:null;if(state.loop==='block'&&!state.loopBlock){state.loop='all';$('#loop').value='all';}if(was)await play();};
$('#block').onchange=e=>{const b=state.clip.blocks.find(b=>b.block_id===e.target.value);seek(b.start_time_sec);};
$('#overview').onclick=canvasSeek;$('#zoom').onclick=canvasSeek;
$('#run').onclick=run;['clip','preset','beat-mode'].forEach(id=>$('#'+id).onchange=run);
$('#export').onclick=()=>download(exportExperiment(state.result,metadata()),'pamela-dtw-'+state.clip.id+'-'+state.result.truth.parameters.seed+'.json');
$('#export-motion').onclick=()=>download({schema_version:'fitgen-motion-triplet-v1',shape:[3,state.result.frames,state.result.joints,3],fps:state.result.fps,duration:state.result.duration,metadata:metadata(),variants:state.result.variants.map(v=>({id:v.id,positions:Array.from(v.positions),beats:v.beats}))},'pamela-dtw-motion-'+state.clip.id+'.json');
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.playing){pause();notice('页面进入后台，已暂停。返回后点击播放继续。');}});
window.addEventListener('keydown',e=>{if(e.code==='Space'&&!['BUTTON','INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();$('#play').click();}});
window.addEventListener('resize',()=>{if(state.result){drawPath($('#path'),state.result);render(time(),true);}});
try{
  const responses=await Promise.all([fetch('data/manifest.json'),fetch('../pamela-beat-demo/analysis.json'),fetch('../motion-beat-demo/catalog.json'),fetch('results/manifest.json?v=e0445c2d3d')]);if(responses.some(r=>!r.ok))throw Error('实验目录读取失败');
  [catalog,musicCatalog,motionCatalog,serverCatalog]=await Promise.all(responses.map(r=>r.json()));
  if(serverCatalog.schema!==SERVER_SCHEMA||serverCatalog.provenance.method!=='anchor')throw Error('服务器实验清单版本不匹配');
  $('#seed').value=serverCatalog.seed;
  for(const meta of catalog.clips){const option=document.createElement('option');option.value=meta.id;option.textContent=musicCatalog.clips.find(c=>c.id===meta.id).title_zh+' / '+motionCatalog.clips.find(c=>c.id===meta.id).title;$('#clip').append(option);}
  $('#clip').disabled=false;$('#run').disabled=false;requestAnimationFrame(tick);await run();
}catch(error){notice(error.message,true);}
