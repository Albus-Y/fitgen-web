(() => {
 const tasks=new WeakMap(),urls=new WeakMap();
 const base=new URL('.',document.currentScript.src);
 window.FitGenMedia={attach:async(element,path)=>{
  const task={};tasks.set(element,task);element.pause();
  const status=document.createElement('p');status.setAttribute('role','status');status.style.cssText='font-size:12px;color:#70848b';status.textContent='正在载入音视频…';
  element.after(status);
  try {
   const key=decodeURIComponent(new URL(path,document.baseURI).pathname.slice(base.pathname.length));
   const entry=window.FITGEN_MEDIA[key];
   let url=new URL(path,document.baseURI).href;
   if(entry){
    const buffers=new Array(entry.parts.length);let next=0,done=0;
    await Promise.all(Array.from({length:Math.min(3,entry.parts.length)},async()=>{
     while(next<entry.parts.length){const i=next++;const r=await fetch(new URL(entry.parts[i],base));if(!r.ok)throw Error('资源载入失败');buffers[i]=await r.arrayBuffer();status.textContent='正在载入音视频 '+Math.round(++done/entry.parts.length*100)+'%';}
    }));
    if(tasks.get(element)!==task)return;
    url=URL.createObjectURL(new Blob(buffers,{type:entry.type}));
   }
   if(tasks.get(element)!==task)return;
   const old=urls.get(element);if(old)URL.revokeObjectURL(old);
   if(url.startsWith('blob:'))urls.set(element,url);else urls.delete(element);
   element.src=url;element.load();status.remove();
  } catch(error) {if(tasks.get(element)===task)status.textContent='资源载入失败，请刷新重试。';}
  finally {if(tasks.get(element)!==task)status.remove();}
 }};
})();
