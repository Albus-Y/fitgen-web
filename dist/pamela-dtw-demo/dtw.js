// 服务器现有 Anchor xTW 的结果适配器；网页不实现或退回标准 DTW。
export const SERVER_SCHEMA='pamela-server-xtw-v1';

export function interpolate(xs, ys, x) {
  if (x<=xs[0]) return ys[0];
  if (x>=xs.at(-1)) return ys.at(-1);
  let lo=0,hi=xs.length-1;
  while(hi-lo>1){const m=(lo+hi)>>1;if(xs[m]<=x)lo=m;else hi=m;}
  const a=(x-xs[lo])/(xs[hi]-xs[lo]);
  return ys[lo]*(1-a)+ys[hi]*a;
}

export function useServerAlignment(record,motionBeats,musicBeats,duration){
  if(!record||record.alignment?.method!=='anchor')throw Error('缺少服务器 Anchor xTW 结果；不会退回标准 DTW');
  const same=(a,b)=>a?.length===b.length&&b.every((v,i)=>Number.isFinite(a[i])&&Math.abs(a[i]-v)<1e-8);
  if(!same(record.inputBeats,motionBeats)||!same(record.musicBeats,musicBeats)||record.duration!==duration)throw Error('服务器结果与当前输入 beat 或时长不一致');
  const a=record.alignment,x=a.outputTimes,y=a.inputTimes;
  if(!Array.isArray(x)||!Array.isArray(y)||x.length!==y.length||x.length<2)throw Error('服务器时间映射格式无效');
  for(let i=0;i<x.length;i++){
    if(!Number.isFinite(x[i])||!Number.isFinite(y[i])||(i&&(x[i]<=x[i-1]||y[i]<=y[i-1])))throw Error('服务器时间映射必须有限且严格递增');
    if(i){const rate=(y[i]-y[i-1])/(x[i]-x[i-1]);if(rate<.5-5e-6||rate>2+5e-6)throw Error('服务器结果超出记录的速度约束');}
  }
  if(Math.abs(x[0])+Math.abs(y[0])+Math.abs(x.at(-1)-duration)+Math.abs(y.at(-1)-duration)>1e-8)throw Error('服务器时间映射端点不一致');
  return {...a,caseId:record.id,inputSha256:record.inputSha256};
}
