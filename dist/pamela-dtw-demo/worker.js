import {runExperiment} from './experiment.js?v=0c54eefb16';
self.onmessage=async({data})=>{
  try {
    const result=runExperiment(data.input),positions=result.variants[1].positions;
    const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',positions));
    const hash=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    if(hash!==data.input.serverCase.inputSha256)throw Error('扰动动作与服务器实际求解的输入不一致');
    result.inputVerified=true;
    self.postMessage({id:data.id,result},result.variants.slice(1).map(v=>v.positions.buffer));
  }
  catch(error){self.postMessage({id:data.id,error:error.message});}
};
