import {useServerAlignment,interpolate} from './dtw.js?v=7c1a1a71a8';

export const EXPERIMENT_VERSION='pamela-server-xtw-experiment-v1';
export const PRESETS={none:{label:'无扰动（对照）',amplitude:0},mild:{label:'轻微扰动',amplitude:.2},medium:{label:'中等扰动',amplitude:.4},strong:{label:'明显扰动',amplitude:.65}};

export function seededRandom(seed){let a=seed>>>0;return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}

// 正速度的解析时间扰动，固定 0 与 duration；不修改空间姿态，不裁掉动作。
export function makePerturbation(duration,amplitude,seed){
  if(!(duration>0&&amplitude>=0&&amplitude<1))throw Error('扰动参数无效');
  const random=seededRandom(seed),phase1=random()*2*Math.PI,phase2=random()*2*Math.PI,w=2*Math.PI/duration;
  const sample=t=>t+amplitude*(.65*(Math.cos(phase1)-Math.cos(w*t+phase1))/w+.35*(Math.cos(phase2)-Math.cos(2*w*t+phase2))/(2*w));
  const times=Array.from({length:Math.round(duration*100)+1},(_,i)=>i/100);
  return {outputTimes:times,sourceTimes:times.map(sample),parameters:{type:'positive_sinusoidal_rate',amplitude,seed:seed>>>0,phase1,phase2,duration},sample};
}

export function samplePose(data,frames,joints,fps,time,out=new Float32Array(joints*3)){
  const index=Math.max(0,Math.min(frames-1,time*fps)),lo=Math.floor(index),hi=Math.min(frames-1,lo+1),a=index-lo,stride=joints*3;
  for(let j=0;j<stride;j++)out[j]=data[lo*stride+j]*(1-a)+data[hi*stride+j]*a;
  return out;
}

export function resampleMotion(data,frames,joints,fps,sourceTimes){
  const result=new Float32Array(sourceTimes.length*joints*3),pose=new Float32Array(joints*3);
  sourceTimes.forEach((t,i)=>{samplePose(data,frames,joints,fps,t,pose);result.set(pose,i*joints*3);});return result;
}

// 沿用已审查网页的规则：均关节位移、sigma=5 帧、reflect、局部极小值、distance=4。
// 服务器通用高层提取器使用 nearest；本实验只替换对齐，输入 beat 规则不变。
export function detectMotionBeats(data,frames,joints,fps,{sigma=5,minInterval=.2}={}){
  const raw=new Float64Array(frames-1),stride=joints*3;
  for(let i=0;i<frames-1;i++){
    let sum=0;for(let j=0;j<joints;j++){const k=i*stride+j*3;sum+=Math.hypot(data[k+stride]-data[k],data[k+stride+1]-data[k+1],data[k+stride+2]-data[k+2]);}raw[i]=sum/joints;
  }
  const radius=Math.floor(4*sigma+.5),kernel=Array.from({length:2*radius+1},(_,i)=>Math.exp(-.5*((i-radius)/sigma)**2)),norm=kernel.reduce((a,b)=>a+b,0);
  const reflect=k=>{while(k<0||k>=raw.length)k=k<0?-k-1:2*raw.length-k-1;return k;};
  const signal=Array.from(raw,(_,i)=>kernel.reduce((sum,w,j)=>sum+w*raw[reflect(i+j-radius)]/norm,0));
  const candidates=[];
  for(let i=1;i<signal.length-1;i++){
    if(signal[i]<signal[i-1]){let end=i;while(end+1<signal.length&&signal[end+1]===signal[i])end++;if(end<signal.length-1&&signal[end]<signal[end+1])candidates.push(Math.floor((i+end)/2));i=end;}
  }
  const distance=Math.ceil(minInterval*fps),kept=[];
  candidates.sort((a,b)=>signal[a]-signal[b]||b-a).forEach(i=>{if(kept.every(j=>Math.abs(i-j)>=distance))kept.push(i);});
  kept.sort((a,b)=>a-b);return {frames:kept,beats:kept.map(i=>i/fps),signal,config:{fps,smoothing_sigma:sigma,min_interval:minInterval}};
}

export function percentile(values,q){if(!values.length)return null;const v=[...values].sort((a,b)=>a-b),i=(v.length-1)*q;return v[Math.floor(i)]+(v[Math.ceil(i)]-v[Math.floor(i)])*(i-Math.floor(i));}
export function timingStats(beats,music){
  const nearest=beats.map(t=>{const index=music.reduce((best,b,i)=>Math.abs(b-t)<Math.abs(music[best]-t)?i:best,0);return{time:t,musicIndex:index,musicTime:music[index],errorMs:1000*(t-music[index])};});
  const errors=nearest.map(x=>Math.abs(x.errorMs));return {count:beats.length,median:percentile(errors,.5),p95:percentile(errors,.95),within100:errors.filter(x=>x<=100+1e-6).length,nearest};
}
export function mappingStats(sourceTimes,times){
  const errors=times.map((t,i)=>Math.abs(sourceTimes[i]-t)*1000),rates=times.slice(1).map((t,i)=>(sourceTimes[i+1]-sourceTimes[i])/(t-times[i]));
  return {rmse:Math.sqrt(errors.reduce((sum,x)=>sum+x*x,0)/errors.length),p95:percentile(errors,.95),max:Math.max(...errors),rateMin:Math.min(...rates),rateMax:Math.max(...rates),outsideHalfDouble:rates.filter(x=>x<.5-1e-6||x>2+1e-6).length/rates.length};
}

export function runExperiment({original,frames,joints,fps,duration,originalBeats,musicBeats,preset='medium',seed=20261126,beatMode='tracked',serverCase}){
  if(!PRESETS[preset])throw Error('未知扰动档位');
  if(!serverCase||serverCase.seed!==seed||serverCase.preset!==preset||serverCase.beatMode!==beatMode||serverCase.frames!==frames||serverCase.joints!==joints||serverCase.fps!==fps)throw Error('没有与当前实验设置对应的服务器结果');
  const times=Array.from({length:frames},(_,i)=>i/fps);
  const truth=makePerturbation(duration,PRESETS[preset].amplitude,seed);
  const disturbedTimes=times.map(truth.sample),disturbed=resampleMotion(original,frames,joints,fps,disturbedTimes);
  const observed=detectMotionBeats(disturbed,frames,joints,fps);
  // 重建与服务器输入一致的扰动动作和事件，核对后使用服务器计算的时间映射。
  const generatedBeats=originalBeats.map(t=>interpolate(truth.sourceTimes,truth.outputTimes,t));
  if(!['tracked','redetect'].includes(beatMode))throw Error('未知 beat 输入模式');
  const inputBeats=beatMode==='tracked'?generatedBeats:observed.beats;
  if(inputBeats.length<2)throw Error('扰动后不足两个动作 beat');
  const alignment=useServerAlignment(serverCase,inputBeats,musicBeats,duration);
  const inputTimes=times.map(t=>interpolate(alignment.outputTimes,alignment.inputTimes,t));
  const corrected=resampleMotion(disturbed,frames,joints,fps,inputTimes);
  const correctedDetection=detectMotionBeats(corrected,frames,joints,fps);
  const correctedBeats=inputBeats.map(t=>interpolate(alignment.inputTimes,alignment.outputTimes,t));
  // 真值仅用于评价；服务器调用只取得扰动动作和 beat，不取得这个映射。
  const correctedSourceTimes=inputTimes.map(truth.sample);
  const originalDetection=detectMotionBeats(original,frames,joints,fps);
  const variants=[
    {id:'original',beats:originalBeats,detectedBeats:originalDetection.beats,positions:original,sourceTimes:times,signal:originalDetection.signal},
    {id:'disturbed',beats:inputBeats,detectedBeats:observed.beats,positions:disturbed,sourceTimes:disturbedTimes,signal:observed.signal},
    {id:'corrected',beats:correctedBeats,detectedBeats:correctedDetection.beats,positions:corrected,sourceTimes:correctedSourceTimes,signal:correctedDetection.signal}
  ];
  variants.forEach(v=>{v.musicStats=timingStats(v.beats,musicBeats);v.recoveryStats=mappingStats(v.sourceTimes,times);});
  const truthData={parameters:truth.parameters,outputTimes:truth.outputTimes,sourceTimes:truth.sourceTimes};
  return {version:EXPERIMENT_VERSION,frames,joints,fps,duration,times,beatMode,variants,alignment,truth:truthData,originalDetectorAgreement:JSON.stringify(originalDetection.beats)===JSON.stringify(originalBeats)};
}

export function exportExperiment(result,metadata){
  return {schema_version:EXPERIMENT_VERSION,metadata,beat_mode:result.beatMode,frames:result.frames,joints:result.joints,fps:result.fps,duration:result.duration,times:result.times,
    perturbation_truth_evaluation_only:result.truth,dtw:result.alignment,
    variants:result.variants.map(({positions,signal,...v})=>v),original_detector_agreement:result.originalDetectorAgreement};
}
