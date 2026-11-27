// 两个 Pamela demo 共用音乐八拍查看器，始终使用页面传入的秒级播放时间。
export function eightCountTitle(block){
  if(!block)return '没有八拍网格';
  if(block.is_complete)return '第 '+block.fullNumber+' 组八拍';
  return ({partial_head:'段首不足八拍',partial_tail:'段尾不足八拍',gap:'无法可靠分组'})[block.block_type]||'未完成区间';
}

export function createEightCountPanel(root,onSeek){
  const field=name=>root.querySelector('[data-count="'+name+'"]');
  const title=field('title'),type=field('type'),cells=field('cells'),note=field('note');
  const clock=field('clock'),duration=field('duration'),prev=field('prev'),next=field('next');
  let clip=null,block=null;

  function step(direction){
    if(!clip||!block)return;
    const target=clip.blocks[clip.blocks.indexOf(block)+direction];
    if(target)onSeek(target.start_time_sec);
  }
  prev.onclick=()=>step(-1);next.onclick=()=>step(1);

  function clear(){
    clip=null;block=null;root.dataset.blockId='';root.dataset.renderTime='';
    title.textContent='八拍网格';type.textContent='等待分析结果';
    cells.replaceChildren();cells.dataset.activeBeat='';note.textContent='';
    clock.textContent='0.00';clock.dataset.time='0.000000';duration.textContent='—';
    prev.disabled=true;next.disabled=true;
  }

  function render(currentClip,currentBlock,time){
    if(clip!==currentClip||block!==currentBlock){
      clip=currentClip;block=currentBlock;root.dataset.blockId=block?.block_id??'';
      title.textContent=eightCountTitle(block);
      type.textContent=block?.is_complete?'完整 8 拍':block?.block_type==='gap'?'空缺':'不足 8 拍';
      note.textContent=block?block.start_time_sec.toFixed(2)+'–'+block.end_time_sec.toFixed(2)+' 秒'+(block.is_complete?' · 第 1、5 拍为小节首拍':' · 保留原分析结果，不补齐'):'没有可靠网格';
      duration.textContent=clip.duration.toFixed(2);cells.replaceChildren();
      const beats=!block||block.start_beat_index==null?[]:clip.music_beats.filter(beat=>beat.beat_index>=block.start_beat_index&&beat.beat_index<=block.end_beat_index);
      if(!beats.length){
        const empty=document.createElement('div');empty.className='count-empty';
        empty.textContent='此区间没有可靠分组的拍点。请结合原音乐审查。';cells.append(empty);
      }
      beats.forEach((beat,index)=>{
        const button=document.createElement('button');button.type='button';
        button.className='count-cell'+(beat.is_downbeat?' downbeat':'');
        button.dataset.beatIndex=beat.beat_index;button.dataset.time=beat.time_sec;
        const label=block.is_complete?index+1:(beat.beat_in_bar??'•');
        button.append(document.createTextNode(label));
        const small=document.createElement('small');small.textContent=beat.time_sec.toFixed(2)+'s';button.append(small);
        button.title='音乐拍 '+(beat.beat_index+1)+'，'+beat.time_sec.toFixed(3)+' 秒'+(block.is_complete?'，八拍内第 '+label+' 拍':'，小节内位置 '+label)+(beat.is_downbeat?'，小节首拍':'');
        button.onclick=()=>onSeek(beat.time_sec);cells.append(button);
      });
      if(block&&!block.is_complete&&beats.length)note.textContent+='；按钮数字为小节内位置。';
      const index=clip.blocks.indexOf(block);
      prev.disabled=index<=0;next.disabled=index<0||index>=clip.blocks.length-1;
    }
    clock.textContent=time.toFixed(2);clock.dataset.time=time.toFixed(6);root.dataset.renderTime=time.toFixed(6);
    const current=clip.music_beats.findLast(beat=>beat.time_sec<=time+1e-6);
    cells.dataset.activeBeat=current?.beat_index??'';
    for(const cell of cells.querySelectorAll('.count-cell')){
      const active=Number(cell.dataset.beatIndex)===current?.beat_index;
      cell.classList.toggle('current',active);cell.setAttribute('aria-current',String(active));
    }
  }
  clear();
  return {render,clear};
}
