// 导出服务器实际求解的输入；不导出原序列或真实扰动映射。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {PRESETS,makePerturbation,resampleMotion,detectMotionBeats} from '../dist/pamela-dtw-demo/experiment.js';
import {interpolate} from '../dist/pamela-dtw-demo/dtw.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=process.argv[2];
if(!out)throw Error('用法：node scripts/export_pamela_xtw_inputs.mjs <新输出目录>');
if(fs.existsSync(out))throw Error('输出目录已存在，请使用新目录。');
fs.mkdirSync(out,{recursive:true});
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const body=read('dist/pamela-dtw-demo/data/manifest.json');
const motion=read('dist/motion-beat-demo/catalog.json');
const music=read('dist/pamela-beat-demo/analysis.json');
const sha=b=>createHash('sha256').update(b).digest('hex');
const cases=[],seed=20261126;
for(const meta of body.clips){
  const bytes=fs.readFileSync(path.join(root,'dist/pamela-dtw-demo/data',meta.file));
  if(sha(bytes)!==meta.sha256)throw Error('动作来源校验失败：'+meta.id);
  const original=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const m=motion.clips.find(x=>x.id===meta.id),musi=music.clips.find(x=>x.id===meta.id);
  const [frames,joints]=meta.shape,fps=meta.fps,duration=m.media_duration;
  if(JSON.stringify(detectMotionBeats(original,frames,joints,fps).beats)!==JSON.stringify(m.beats))throw Error('原动作 beat 不一致');
  for(const [preset,parameters] of Object.entries(PRESETS)){
    const truth=makePerturbation(duration,parameters.amplitude,seed);
    const times=Array.from({length:frames},(_,i)=>truth.sample(i/fps));
    const positions=resampleMotion(original,frames,joints,fps,times);
    const payload=Buffer.from(positions.buffer,positions.byteOffset,positions.byteLength);
    const file=meta.id+'-'+preset+'.f32';fs.writeFileSync(path.join(out,file),payload);
    const modes={tracked:m.beats.map(t=>interpolate(truth.sourceTimes,truth.outputTimes,t)),redetect:detectMotionBeats(positions,frames,joints,fps).beats};
    for(const [beatMode,inputBeats] of Object.entries(modes))cases.push({
      id:[meta.id,preset,beatMode].join('/'),clip:meta.id,preset,beatMode,seed,
      frames,joints,fps,duration,file,inputSha256:sha(payload),originalSha256:meta.sha256,
      inputBeats,musicBeats:musi.music_beats.map(b=>b.time_sec)
    });
  }
}
const result={schema:'pamela-xtw-inputs-v1',seed,cases};
fs.writeFileSync(path.join(out,'inputs.json'),JSON.stringify(result));
console.log(JSON.stringify({cases:cases.length,poseFiles:body.clips.length*Object.keys(PRESETS).length,output:out}));
