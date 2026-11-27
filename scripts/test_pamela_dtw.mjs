// 运行：node scripts/test_pamela_dtw.mjs [实验记录输出目录] [服务器 validation 目录]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {useServerAlignment,interpolate,SERVER_SCHEMA} from '../dist/pamela-dtw-demo/dtw.js';
import {makePerturbation,runExperiment,exportExperiment,samplePose} from '../dist/pamela-dtw-demo/experiment.js';
import {createReviewAudio,createMultitrackAudio} from '../dist/pamela-beat-demo/review-data.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const meta=read('dist/pamela-dtw-demo/data/manifest.json'),music=read('dist/pamela-beat-demo/analysis.json'),motion=read('dist/motion-beat-demo/catalog.json');
const server=read('dist/pamela-dtw-demo/results/manifest.json');
const output=process.argv[2]&&path.resolve(process.argv[2]);if(output)fs.mkdirSync(output,{recursive:true});
const serverValidation=process.argv[3]&&path.resolve(process.argv[3]);
const serverReference=serverValidation&&JSON.parse(fs.readFileSync(path.join(serverValidation,'manifest.json'),'utf8'));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
let checks=0;const check=(condition,message)=>{assert(condition,message);checks++;};

check(server.schema===SERVER_SCHEMA&&server.provenance.method==='anchor','未使用服务器 Anchor xTW');
check(server.caseCount===24&&server.seed===20261126,'服务器场景数量或随机种子不一致');
check(Object.keys(server.provenance.sourceSha256).length>0&&Object.keys(server.provenance.backendSha256).length>0,'缺少服务器源码或后端指纹');
assert.throws(()=>useServerAlignment(null,[1],[1],30),/缺少服务器/);
check(true,'缺失服务器结果时必须失败');
const p=makePerturbation(30,.65,20261126),p2=makePerturbation(30,.65,20261126);
check(JSON.stringify(p.sourceTimes)===JSON.stringify(p2.sourceTimes),'扰动不确定');
check(Math.abs(p.sample(0))<1e-10&&Math.abs(p.sample(30)-30)<1e-10,'扰动边界错误');
check(p.sourceTimes.every((x,i)=>!i||x>p.sourceTimes[i-1]),'扰动不严格单调');
check(Math.abs(interpolate(p.sourceTimes,p.outputTimes,p.sample(12.34))-12.34)<1e-5,'扰动逆映射不一致');
check(samplePose(new Float32Array([0,0,0,2,4,6]),2,1,1,.5).join(',')==='1,2,3','姿态插值错误');

// 复用音频工具后，旧页面默认的两个提示音声道与泛化接口逐采样一致。
const rate=1000,channels=[new Float32Array(2000),new Float32Array(2000)],decoded={numberOfChannels:2,duration:2,sampleRate:rate,getChannelData:i=>channels[i]};
channels[0][42]=.5;channels[1][74]=-.2;
const context={createBuffer:(n,len,r)=>{const ch=Array.from({length:n},()=>new Float32Array(len));return{numberOfChannels:n,duration:len/r,getChannelData:i=>ch[i]};}};
const audioClip={duration:2,music_beats:[{time_sec:.5,is_downbeat:true},{time_sec:1,is_downbeat:false}],motion_beats:[.7,1.5]};
const legacy=createReviewAudio(context,decoded,audioClip),shared=createMultitrackAudio(context,decoded,2,[[{time:.5,frequency:1050,amplitude:.9},{time:1,frequency:720,amplitude:.65}],[{time:.7,frequency:1800,amplitude:.8},{time:1.5,frequency:1800,amplitude:.8}]]);
for(let i=0;i<4;i++)assert.deepEqual(legacy.getChannelData(i),shared.getChannelData(i));
check(legacy.numberOfChannels===4&&legacy.duration===2,'旧音频接口被改变');
assert.deepEqual(legacy.getChannelData(0),channels[0]);assert.deepEqual(legacy.getChannelData(1),channels[1]);

const summaries=[],caseChecks=[];
for(const c of meta.clips){
  const bytes=fs.readFileSync(path.join(root,'dist/pamela-dtw-demo/data',c.file));
  check(crypto.createHash('sha256').update(bytes).digest('hex')===c.sha256,'骨架 SHA256 不一致');
  const original=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),m=music.clips.find(x=>x.id===c.id),o=motion.clips.find(x=>x.id===c.id);
  const input={original,frames:c.shape[0],joints:c.shape[1],fps:c.fps,duration:o.media_duration,originalBeats:o.beats,musicBeats:m.music_beats.map(b=>b.time_sec),seed:20261126};
  const entry=server.clips.find(x=>x.id===c.id),resultBytes=fs.readFileSync(path.join(root,'dist/pamela-dtw-demo/results',entry.file));
  check(sha(resultBytes)===entry.sha256,'服务器结果文件校验失败');
  const saved=JSON.parse(resultBytes);
  check(saved.schema===SERVER_SCHEMA&&saved.cases.length===8,'服务器结果格式或场景不全');
  for(const preset of ['none','mild','medium','strong'])for(const beatMode of ['tracked','redetect']){
    const serverCase=saved.cases.find(x=>x.preset===preset&&x.beatMode===beatMode);
    check(serverCase.originalSha256===c.sha256,'服务器使用的原动作版本不一致');
    const r=runExperiment({...input,preset,beatMode,serverCase});
    const disturbed=r.variants[1].positions;
    check(sha(Buffer.from(disturbed.buffer,disturbed.byteOffset,disturbed.byteLength))===serverCase.inputSha256,'网页扰动输入不是服务器实际求解的输入');
    check(r.originalDetectorAgreement,'原始检测器与已审查 beat 不一致');
    check(r.variants.every(v=>v.positions.length===original.length&&v.positions.every(Number.isFinite)),'重采样形状或有限性错误');
    check(r.alignment.matches.every(([a,b],i)=>!i||(a>r.alignment.matches[i-1][0]&&b>r.alignment.matches[i-1][1])),'Drop-DTW 匹配不严格单调');
    check(r.alignment.matches.length+r.alignment.droppedMotionIndices.length===r.variants[1].beats.length,'动作事件匹配与丢弃计数错误');
    check(r.alignment.matches.length+r.alignment.droppedMusicIndices.length===input.musicBeats.length,'音乐事件匹配与丢弃计数错误');
    check(r.alignment.outputTimes.length===181,'未使用服务器默认 GDTW 采样参数');
    const warpRate=r.alignment.inputTimes.slice(1).map((t,i)=>(t-r.alignment.inputTimes[i])/(r.alignment.outputTimes[i+1]-r.alignment.outputTimes[i]));
    check(warpRate.every(v=>v>=.5-5e-6&&v<=2+5e-6),'GDTW 速度超出硬约束');
    check(r.variants.every(v=>v.beats.every(t=>t>=0&&t<=30)),'beat 越界');
    check(r.variants.every(v=>v.sourceTimes.every((t,i)=>t>=0&&t<=30&&(!i||t>v.sourceTimes[i-1]))),'时间映射越界或倒退');
    check(r.variants[0].recoveryStats.rmse===0,'原序列恢复误差应为 0');
    if(beatMode==='tracked')check(r.variants.every(v=>v.beats.length===o.beats.length),'追踪事件数量变化');
    if(preset==='none'){assert.deepEqual(r.variants[1].positions,original);check(r.variants[1].recoveryStats.rmse===0,'无扰动对照没有保持原始动作');}
    assert.deepEqual(r.variants[2].detectedBeats,serverCase.outputDetectedBeats);check(true,'重检测与服务器 SciPy 交叉校验');
    assert.throws(()=>runExperiment({...input,preset,beatMode,serverCase,seed:input.seed+1}),/对应/);
    const wrong={...serverCase,inputBeats:[...serverCase.inputBeats]};wrong.inputBeats[0]+=.01;
    assert.throws(()=>useServerAlignment(wrong,r.variants[1].beats,input.musicBeats,30),/不一致/);
    check(true,'不匹配输入或种子不能伪装为服务器求解');
    let maxPositionError=null;
    if(serverValidation){
      const reference=serverReference.cases.find(x=>x.caseId===serverCase.id),bytes=fs.readFileSync(path.join(serverValidation,reference.file));
      check(sha(bytes)===reference.sha256,'服务器骨架参考数据损坏');
      const expected=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),actual=r.variants[2].positions;
      check(expected.length===actual.length,'服务器与前端输出形状不一致');
      maxPositionError=expected.reduce((maximum,v,i)=>Math.max(maximum,Math.abs(v-actual[i])),0);
      check(maxPositionError<=1e-6,'网页重采样与服务器实际输出不一致');
    }
    caseChecks.push({caseId:serverCase.id,maxPositionError});
    if(preset==='medium'&&beatMode==='tracked'){
      summaries.push({clip:c.id,events:o.beats.length,medianMs:r.variants.map(v=>+v.musicStats.median.toFixed(2)),recoveryRmseMs:r.variants.map(v=>+v.recoveryStats.rmse.toFixed(2)),redetectedCounts:r.variants.map(v=>v.detectedBeats.length),appliedWarpRate:[r.alignment.diagnostics.warp_rate_min,r.alignment.diagnostics.warp_rate_max],totalMotionRate:[r.variants[2].recoveryStats.rateMin,r.variants[2].recoveryStats.rateMax],matched:r.alignment.matches.length});
      if(output){fs.writeFileSync(path.join(output,c.id+'.json'),JSON.stringify(exportExperiment(r,{clip:c.id,source:c}),null,2));r.variants.forEach(v=>fs.writeFileSync(path.join(output,c.id+'-'+v.id+'.f32'),Buffer.from(v.positions.buffer,v.positions.byteOffset,v.positions.byteLength)));}
    }
  }
}
if(output)fs.writeFileSync(path.join(output,'validation.json'),JSON.stringify({checks,cases:24,summary:summaries,caseChecks,serverProvenance:server.provenance},null,2));
console.log(JSON.stringify({result:'passed',checks,cases:24,maxPositionError:serverValidation?Math.max(...caseChecks.map(x=>x.maxPositionError)):null,summary:summaries},null,2));
