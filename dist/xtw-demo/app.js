const samples = window.XTW_DEMO;
const select = document.querySelector('#sample');
samples.forEach((s,i) => { const o=document.createElement('option');o.value=i;o.textContent=s.label+' · '+s.id;select.append(o); });
function showSample(){
  const s=samples[Number(select.value)];
  const video=document.querySelector('#video');video.pause();
  video.src='assets/'+s.id+'/comparison.mp4';
  document.querySelector('#plot').src='assets/'+s.id+'/warps_and_alignment.png';
  document.querySelector('#meta').textContent='音乐：Real Good Feeling · 起点 '+s.segment.start_seconds.toFixed(2)+' 秒 · 时长 '+s.segment.duration_seconds.toFixed(2)+' 秒 · 输入 '+s.motion.fps+' FPS → 输出 '+s.anchor.output_fps+' FPS · 动作 / 音乐 beats：'+s.motion.beat_times.length+' / '+s.segment.beats_relative_seconds.length;
  const ms=x=>(x*1000).toFixed(2)+' ms';
  const pct=x=>(x*100).toFixed(3)+'%';
  const rows=[
    ['动作 → 音乐 / 平均误差',...['original','anchor','event'].map(k=>ms(s.alignment[k].motion_to_music_seconds.mean))],
    ['音乐 → 动作 / 平均误差',...['original','anchor','event'].map(k=>ms(s.alignment[k].music_to_motion_seconds.mean))],
    ['动作 → 音乐 / P95',...['original','anchor','event'].map(k=>ms(s.alignment[k].motion_to_music_seconds.p95))],
    ['音乐 → 动作 / P95',...['original','anchor','event'].map(k=>ms(s.alignment[k].music_to_motion_seconds.p95))],
    ['最大相对骨长漂移',...['original','anchor','event'].map(k=>pct(s.quality[k].bone_length_drift.max_relative))],
    ['局部速度范围','1.000',s.anchor.warp_rate_min.toFixed(3)+'～'+s.anchor.warp_rate_max.toFixed(3),s.event.warp_rate_min.toFixed(3)+'～'+s.event.warp_rate_max.toFixed(3)],
    ['输出帧数',String(s.anchor.output_frame_count),String(s.anchor.output_frame_count),String(s.event.output_frame_count)]
  ];
  const tbody=document.querySelector('#metrics');tbody.replaceChildren();
  for(const row of rows){const tr=document.createElement('tr');for(const cell of row){const td=document.createElement('td');td.textContent=cell;tr.append(td);}tbody.append(tr);}
}
select.addEventListener('change',showSample);showSample();
