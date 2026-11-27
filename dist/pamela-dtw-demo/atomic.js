import {interpolate} from './dtw.js?v=7c1a1a71a8';
import {detectMotionBeats, samplePose} from './experiment.js?v=0c54eefb16';

export const METHODS = ['original', 'anchor', 'astra'];
export const LABELS = ['原速循环', 'Anchor xTW', 'Astra 编排'];
export const SCHEMA = 'fitgen-atomic-eight-v1';

export function blockAt(blocks, time) {
  return blocks.find(block => time < block.end_time_sec - 1e-9) ?? blocks.at(-1);
}

export function readMap(map, localTime) {
  const t = map.musicTimes, s = map.sourceTimes;
  let low = 0, high = t.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (t[mid] <= localTime) low = mid;
    else high = mid;
  }
  const rate = (s[high] - s[low]) / (t[high] - t[low]);
  const time = Math.min(t[high], Math.max(t[low], localTime));
  return {source: s[low] + (time - t[low]) * rate, rate};
}

export function sampleAtom(atom, meta, sourceTime, out = new Float32Array(66)) {
  const frame = Math.round(sourceTime * meta.fps * 1e10) / 1e10;
  const i = Math.floor(frame), a = frame - i, count = meta.frames;
  const first = (i % count) * 66, second = ((i + 1) % count) * 66;
  const cycle = Math.floor(i / count), next = Math.floor((i + 1) / count);
  const dx = atom[count * 66] - atom[0], dz = atom[count * 66 + 2] - atom[2];
  for (let j = 0; j < 66; j++) {
    const shift = j % 3 === 0 ? dx : j % 3 === 2 ? dz : 0;
    out[j] = (atom[first + j] + cycle * shift) * (1 - a) + (atom[second + j] + next * shift) * a;
  }
  return out;
}

export function playbackPose(variant, result, meta, atom, time, source) {
  // 相位跳变两侧从各自片段插值，避免把重置前后的两个 20 FPS 姿态混在一起。
  const frame = Math.floor(time * meta.fps + 1e-10);
  if (result.resetIntervals.has(frame)) return sampleAtom(atom, meta, source);
  return samplePose(variant.positions, result.frames, result.joints, result.fps, time);
}

function checkMap(map, duration, [slow, fast]) {
  const t = map.musicTimes, s = map.sourceTimes;
  if (!Array.isArray(t) || !Array.isArray(s) || t.length < 2 || s.length !== t.length ||
      Math.abs(t[0]) > 1e-8 || Math.abs(t.at(-1) - duration) > 1e-8) throw Error('八拍映射端点无效');
  for (let i = 0; i < t.length; i++) {
    if (!Number.isFinite(t[i]) || !Number.isFinite(s[i]) || s[i] < -1e-8) throw Error('映射含非法秒数');
    if (!i) continue;
    const speed = (s[i] - s[i - 1]) / (t[i] - t[i - 1]);
    if (t[i] <= t[i - 1] || speed < slow - 5e-6 || speed > fast + 5e-6) throw Error('映射超出倍率范围');
  }
}

function blockEvents(block, map, period, offsets) {
  const min = map.sourceTimes[0], max = map.sourceTimes.at(-1), events = [];
  for (let k = Math.floor(min / period); k <= Math.ceil(max / period); k++) {
    for (const offset of offsets) {
      const s = k * period + offset;
      if (s >= min - 1e-9 && s < max - 1e-9) events.push(block.start_time_sec + interpolate(map.sourceTimes, map.musicTimes, s));
    }
  }
  return events;
}

export function prepareClip(meta, music, record, atom, rateBounds = record.rateBounds ?? [.8, 1.5]) {
  const paired = record.windowBeats === 16;
  if (record.schema !== SCHEMA || record.id !== meta.id || music.id !== meta.id ||
      (paired && meta.id !== 'slow_squat') || atom.length !== (meta.frames + 1) * 66 ||
      atom.some(x => !Number.isFinite(x))) throw Error('原子动作或音乐网格不匹配');
  if (record.rateBounds && (record.rateBounds[0] !== rateBounds[0] || record.rateBounds[1] !== rateBounds[1]))
    throw Error('编排与所选倍率范围不一致');
  const displayMethods = paired ? ['original', 'anchor'] : METHODS;
  const methods = meta.repeats.length ? displayMethods : ['original'];
  for (const method of displayMethods.slice(1)) {
    const n = record.selected[method];
    if (meta.repeats.length ? !meta.repeats.includes(n) : n != null)
      throw Error('所选重复次数与可行轮数不符');
  }
  let nextBlock = 0, fullNumber = 0;
  const blocks = record.blocks.map(row => {
    const ids = paired ? row.blockIds : [row.id];
    if (!ids?.length || ids.length > 2) throw Error('八拍窗口长度无效');
    const members = music.blocks.slice(nextBlock, nextBlock + ids.length);
    nextBlock += ids.length;
    const first = members[0], last = members.at(-1), pair = ids.length === 2;
    if (members.length !== ids.length || members.some((b, i) => b.block_id !== ids[i] || b.is_complete !== row.full) ||
        first.block_id !== row.id || first.start_time_sec !== row.start || last.end_time_sec !== row.end ||
        (pair && (!row.full || first.end_time_sec !== last.start_time_sec || last.start_beat_index !== first.start_beat_index + 8)))
      throw Error('八拍结果与音乐边界不匹配');
    if (paired && (pair !== (row.strategy === 'pair') || (pair && row.anchorRepeats !== record.selected.anchor)))
      throw Error('双八拍的轮数或窗口不匹配');
    for (const method of methods) {
      const map = row.maps[method];
      checkMap(map, row.end - row.start, rateBounds);
      const span = map.sourceTimes.at(-1) - map.sourceTimes[0];
      const repeats = paired ? row.anchorRepeats : record.selected[method];
      if (row.full && method !== 'original' && repeats != null && Math.abs(span - meta.period * repeats) > 1e-7)
        throw Error('完整组的重复次数不匹配');
      if (row.reset && Math.abs(map.sourceTimes[0]) > 1e-7) throw Error('动作相位未在完整组首拍重置');
    }
    const number = row.full ? fullNumber + 1 : null;
    if (row.full) fullNumber += ids.length;
    return {...first, end_time_sec: last.end_time_sec, end_beat_index: last.end_beat_index,
      end_frame_id: last.end_frame_id, last_beat_frame_id: last.last_beat_frame_id, beat_count: pair ? 16 : first.beat_count,
      fullNumber: number, middleTime: pair ? last.start_time_sec : null, strategy: row.strategy,
      anchorRepeats: row.anchorRepeats, maps: row.maps, reset: row.reset};
  });
  if (nextBlock !== music.blocks.length) throw Error('编排没有覆盖音乐网格');
  const frames = Math.round(meta.duration * meta.fps);
  const variants = methods.map(method => {
    const beats = blocks.flatMap(b => blockEvents(b, b.maps[method], meta.period, meta.events));
    const positions = new Float32Array(frames * 66);
    for (let frame = 0; frame < frames; frame++) {
      const t = frame / meta.fps, block = blockAt(blocks, t);
      const {source} = readMap(block.maps[method], t - block.start_time_sec);
      sampleAtom(atom, meta, source, positions.subarray(frame * 66, frame * 66 + 66));
    }
    const detectedBeats = detectMotionBeats(positions, frames, 22, meta.fps).beats;
    const expected = record.detected[method];
    if (detectedBeats.length !== expected.length || detectedBeats.some((t, i) => Math.abs(t - expected[i]) > 1e-7))
      throw Error('重采样骨架的转折与离线校验不一致');
    return {id: method, beats, positions, detectedBeats};
  });
  const resetIntervals = new Set(blocks.filter(b => b.reset).map(b => Math.ceil(b.start_time_sec * meta.fps - 1e-9) - 1));
  return {blocks, frames, fps: meta.fps, duration: meta.duration, joints: 22, variants, resetIntervals, displayMethods};
}
