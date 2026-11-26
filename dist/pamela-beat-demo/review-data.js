// 复用已有动作目录；只保存本次新增的音乐分析结果。
export function composeClip(music, motion) {
  if (!music || !motion || music.id !== motion.id) throw Error('动作与音乐目录不匹配');
  const musicBeats = music.music_beats;
  const blocks = music.blocks.map(block => ({ ...block }));
  const nearest = motion.beats.map((time, motionIndex) => {
    const beat = musicBeats.reduce((best, candidate) =>
      !best || Math.abs(candidate.time_sec - time) < Math.abs(best.time_sec - time) ? candidate : best, null);
    const block = beat && blocks.find(item => item.start_beat_index !== null &&
      item.start_beat_index <= beat.beat_index && beat.beat_index <= item.end_beat_index);
    return {
      motion_index: motionIndex, time,
      music_index: beat?.beat_index ?? null, music_time: beat?.time_sec ?? null,
      delta_ms: beat ? (time - beat.time_sec) * 1000 : null,
      block_id: block?.block_id ?? null,
      count_in_eight: block?.is_complete ? beat.beat_index - block.start_beat_index + 1 : null
    };
  });
  const distances = nearest.filter(row => row.delta_ms !== null).map(row => Math.abs(row.delta_ms)).sort((a, b) => a - b);
  const percentile = q => {
    if (!distances.length) return null;
    const index = (distances.length - 1) * q, lo = Math.floor(index), hi = Math.ceil(index);
    return distances[lo] + (distances[hi] - distances[lo]) * (index - lo);
  };
  const shared = '../motion-beat-demo/';
  return {
    ...music, title: motion.title, duration: motion.media_duration, motion_duration: motion.motion_duration,
    motion_fps: motion.fps, motion_beats: [...motion.beats], blocks, nearest,
    stats: { median_ms: percentile(.5), p95_ms: percentile(.95),
      within_100ms: distances.filter(value => value <= 100 + 1e-6).length, total: motion.beats.length },
    media: { video: shared + motion.assets.normal, poster: shared + motion.assets.poster,
      manifest: shared + motion.assets.manifest, audio: music.audio }
  };
}

// 原声与两种提示音共享一个采样轴，提示音无需作为媒体文件发布。
export function createReviewAudio(context, decoded, clip) {
  if (decoded.numberOfChannels !== 2) throw Error('原声没有解码为双声道');
  if (Math.abs(decoded.duration - clip.duration) > .002) throw Error('原声与片段时长不一致');
  const rate = decoded.sampleRate, length = Math.round(clip.duration * rate);
  const result = context.createBuffer(4, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    result.getChannelData(channel).set(decoded.getChannelData(channel).subarray(0, length));
  }
  function click(time, channel, frequency, amplitude) {
    const output = result.getChannelData(channel), start = Math.round(time * rate);
    const count = Math.min(Math.round(.045 * rate), length - start);
    if (start < 0 || count <= 0) return;
    for (let i = 0; i < count; i++) {
      const t = i / rate;
      output[start + i] += amplitude * Math.sin(2 * Math.PI * frequency * t) * Math.exp(-t * 95) * Math.min(t / .002, 1);
    }
  }
  clip.music_beats.forEach(beat => click(beat.time_sec, 2, beat.is_downbeat ? 1050 : 720, beat.is_downbeat ? .9 : .65));
  clip.motion_beats.forEach(time => click(time, 3, 1800, .8));
  return result;
}
