import {createMultitrackAudio} from '../pamela-beat-demo/review-data.js?v=multitrack-v1';
import {createEightCountPanel, eightCountTitle} from '../pamela-beat-demo/eight-count-panel.js?v=300d71f833';
import {SCHEMA, METHODS, LABELS, prepareClip, playbackPose, blockAt, readMap} from './atomic.js?v=4bc7cdc476';
import {timingStats} from './experiment.js?v=0c54eefb16';
import {COLORS, fitCamera, drawPose, drawTimeline, PLOT_LEFT, PLOT_RIGHT, ROWS} from './renderer.js?v=84e78b2770';

const $ = selector => document.querySelector(selector);
const byId = id => document.getElementById(id);
const panel = createEightCountPanel($('.count-panel'), seek);
const highlights = [true, true, true];
const sound = {music: true, musicCue: false, motionCue: 'off'};
const manifestFiles = new Map([
  ['1.5', 'eight-count/manifest.json?v=c079d5ac3a'],
  ['1.2', 'eight-count/manifest-1.2.json?v=430903fcf0']
]);
const pairFile = 'slow_squat-16.json';
const pairSha = 'a224fc3b7802d6f4a96ed02803b99d1eb0adab2ba1f519df43e0992ea04a23ab';
const pairUrl = 'eight-count/' + pairFile + '?v=' + pairSha.slice(0, 10);
let pairBundle;
const manifests = new Map(), sharedAssets = new Map();
const audioGains = [];
const DEFAULT_LOOP = 'off';
const state = {ready: false, playing: false, resumeAfterLoad: false, offset: 0, loop: DEFAULT_LOOP, loopBlock: null, currentBlock: null, loadId: 0};
let musicCatalog, data, audioContext, splitter, audioBuffer, source, audioStart, playId = 0;
const fmt = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : '—';
const fullBeats = () => data.music.music_beats.map(b => b.time_sec);
function notice(message, error = false) {
  $('#status').textContent = message;
  $('#status').classList.toggle('error', error);
}

function initAudio() {
  if (audioContext) return;
  audioContext = new AudioContext({latencyHint: 'interactive'});
  splitter = audioContext.createChannelSplitter(6);
  const merger = audioContext.createChannelMerger(2);
  for (let i = 0; i < 6; i++) {
    const gain = audioContext.createGain();
    audioGains.push(gain);
    splitter.connect(gain, i);
    if (i < 2) gain.connect(merger, 0, i);
    else { gain.connect(merger, 0, 0); gain.connect(merger, 0, 1); }
  }
  merger.connect(audioContext.destination);
  updateSound();
}

function updateSound() {
  $('#music').setAttribute('aria-pressed', sound.music);
  $('#music-cue').setAttribute('aria-pressed', sound.musicCue);
  const levels = [sound.music ? .7 : 0, sound.music ? .7 : 0, sound.musicCue ? .14 : 0,
    ...METHODS.map((_, i) => sound.motionCue === String(i) ? .18 : 0)];
  audioGains.forEach((gain, i) => gain.gain.setValueAtTime(levels[i], audioContext.currentTime));
}

function bounds() {
  return state.loop === 'block' && state.loopBlock
    ? [state.loopBlock.start_time_sec, state.loopBlock.end_time_sec] : [0, data?.result.duration ?? 30];
}

function clockTime() {
  if (!state.playing) return state.offset;
  const stamp = audioContext.getOutputTimestamp?.();
  const audible = stamp?.contextTime > 0
    ? Math.min(audioContext.currentTime, stamp.contextTime + Math.max(0, performance.now() - stamp.performanceTime) / 1000)
    : Math.max(0, audioContext.currentTime - (audioContext.outputLatency || audioContext.baseLatency || 0));
  const t = state.offset + Math.max(0, audible - audioStart), [lo, hi] = bounds();
  return state.loop !== 'off' && t >= hi ? lo + (t - hi) % (hi - lo) : Math.min(t, data.result.duration);
}

function pause() {
  playId++;
  state.offset = clockTime();
  state.playing = false;
  if (source) { source.stop(); source.disconnect(); source = null; }
  $('#play').textContent = '播放';
  if (state.ready) render(state.offset);
}

async function play() {
  if (!state.ready || state.playing) return;
  const id = ++playId, loadId = state.loadId;
  await audioContext.resume();
  if (id !== playId || loadId !== state.loadId || !state.ready) return;
  const [lo, hi] = bounds();
  if (state.offset < lo || state.offset >= hi - .0001) state.offset = lo;
  source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.loop = state.loop !== 'off';
  source.loopStart = lo; source.loopEnd = hi;
  source.connect(splitter);
  audioStart = audioContext.currentTime + .04;
  source.start(audioStart, state.offset);
  state.playing = true;
  $('#play').textContent = '暂停';
  render(state.offset);
}

function seek(t) {
  if (!state.ready) return;
  pause();
  state.offset = Math.max(0, Math.min(t, data.result.duration));
  if (state.loop === 'block') {
    const b = blockAt(data.result.blocks, state.offset);
    if (b.is_complete && state.offset < b.end_time_sec) state.loopBlock = b;
    else { state.loop = 'all'; state.loopBlock = null; }
    $('#loop').value = state.loop;
  }
  render(state.offset);
}

async function fetchBytes(url, expected) {
  const response = await fetch(url);
  if (!response.ok) throw Error('资源读取失败 ' + url);
  const bytes = await response.arrayBuffer();
  if (expected) {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      n => n.toString(16).padStart(2, '0')).join('');
    if (hash !== expected) throw Error('文件指纹与实验清单不一致 ' + url);
  }
  return bytes;
}
const decode = bytes => JSON.parse(new TextDecoder().decode(bytes));

async function loadManifest(maxRate) {
  if (manifests.has(maxRate)) return manifests.get(maxRate);
  const manifest = decode(await fetchBytes(manifestFiles.get(maxRate)));
  if (manifest.schema !== SCHEMA || manifest.anchor.method !== 'anchor' || manifest.astra.model !== 'gpt-6.2-astra' ||
      manifest.rateBounds[0] !== .8 || manifest.rateBounds[1] !== Number(maxRate))
    throw Error('八拍编排清单与所选倍率不符');
  manifests.set(maxRate, manifest);
  return manifest;
}

function loadAssets(meta, track) {
  const key = meta.atomSha256 + '/' + track.audio_sha256;
  if (!sharedAssets.has(key)) {
    const pending = Promise.all([
      fetchBytes('eight-count/' + meta.atomFile + '?v=' + meta.atomSha256.slice(0, 10), meta.atomSha256),
      fetchBytes('../pamela-beat-demo/' + track.audio, track.audio_sha256).then(bytes => audioContext.decodeAudioData(bytes))
    ]).then(([bytes, audio]) => ({atom: new Float32Array(bytes), audio}));
    sharedAssets.set(key, pending);
    pending.catch(() => sharedAssets.delete(key));
  }
  return sharedAssets.get(key);
}

async function loadArrangement(base, clip, maxRate, paired) {
  if (!paired) {
    const url = 'eight-count/' + clip.file + '?v=' + clip.sha256.slice(0, 10);
    return {manifest: base, manifestUrl: manifestFiles.get(maxRate), meta: clip, record: decode(await fetchBytes(url, clip.sha256))};
  }
  pairBundle ??= decode(await fetchBytes(pairUrl, pairSha));
  const record = pairBundle.profiles[maxRate];
  if (pairBundle.schema !== 'fitgen-squat-two-eights-v1' || pairBundle.id !== clip.id ||
      pairBundle.atomSha256 !== clip.atomSha256 || pairBundle.musicSha256 !== base.musicSha256 ||
      pairBundle.templateBuilderSha256 !== base.builderSha256 || record?.windowBeats !== 16)
    throw Error('双八拍实验与当前动作或音乐不匹配');
  const meta = {...clip, file: pairFile, sha256: pairSha, referenceId: record.referenceId,
    referenceEdges: record.referenceEdges, repeats: record.candidates.map(c => c.repeats)};
  const manifest = {schema: pairBundle.schema, musicSha256: pairBundle.musicSha256, builderSha256: pairBundle.builderSha256,
    templateBuilderSha256: pairBundle.templateBuilderSha256,
    anchor: {method: 'anchor', version: pairBundle.solverVersion, entryPoint: pairBundle.entryPoint,
      sourceSha256: pairBundle.sourceSha256, warper: record.warper}, rateBounds: base.rateBounds, clips: [meta]};
  return {manifest, manifestUrl: pairUrl, meta, record};
}

async function loadClip(id, maxRate, paired) {
  const base = await loadManifest(maxRate);
  const clip = base.clips.find(c => c.id === id);
  const track = musicCatalog.clips.find(c => c.id === id);
  const [{atom, audio}, {manifest, manifestUrl, meta, record}] = await Promise.all([
    loadAssets(clip, track), loadArrangement(base, clip, maxRate, paired)
  ]);
  const result = prepareClip(meta, track, record, atom, manifest.rateBounds);
  const music = {...track, duration: result.duration, blocks: result.blocks};
  const musicCues = track.music_beats.map(b => ({time: b.time_sec, frequency: b.is_downbeat ? 1050 : 720, amplitude: b.is_downbeat ? .9 : .65}));
  const motionCues = METHODS.map((_, i) => (result.variants[i]?.beats ?? []).map(time => ({time, frequency: [1800, 1450, 2100][i], amplitude: .8})));
  const mixed = createMultitrackAudio(audioContext, audio, result.duration, [musicCues, ...motionCues]);
  return {manifest, manifestUrl, maxRate, paired, meta, music, record, result, atom, mixed, camera: fitCamera(atom)};
}

function tableRow(tbody, values) {
  const row = document.createElement('tr');
  for (const value of values) {
    const cell = document.createElement('td');
    cell.textContent = value;
    row.append(cell);
  }
  tbody.append(row);
  return row;
}

function populate() {
  const {meta, music, result, record, manifest, paired} = data;
  const reference = result.blocks.find(b => b.block_id === meta.referenceId);
  $('main').classList.toggle('paired', paired);
  $('#reference').textContent = paired ? '回到参考 16 拍' : '回到参考八拍';
  $('#reference-heading').textContent = paired ? '参考 16 拍选了几轮' : '参考八拍选了几轮';
  $('#loop option[value="block"]').textContent = paired ? '当前编排窗口' : '当前完整八拍';
  $('#atom-duration').textContent = fmt(meta.period) + ' 秒';
  $('#atom-events').textContent = meta.events.map(t => fmt(t)).join(' / ') + ' 秒';
  METHODS.slice(1).forEach((method, index) => {
    const i = index + 1, repeats = record.selected[method], available = repeats != null;
    const card = byId('motion-card-' + i), highlight = byId('highlight-' + i);
    card.classList.toggle('unavailable', !available);
    byId('repeat-' + i).textContent = available ? repeats + ' 轮 / 八拍' : '无可行编排';
    highlight.disabled = !available;
    highlight.setAttribute('aria-pressed', available && highlights[i]);
    const cue = $('#motion-cue').querySelector('option[value="' + i + '"]');
    cue.disabled = !available;
    cue.hidden = !result.displayMethods.includes(method);
    if (!available) {
      card.classList.remove('beat-active');
      delete card.dataset.sourceTime;
      byId('rate-' + i).textContent = byId('phase-' + i).textContent = '—';
      if (sound.motionCue === String(i)) { sound.motionCue = 'off'; $('#motion-cue').value = 'off'; updateSound(); }
    }
  });
  $('#export-motion').textContent = paired ? '导出两路骨架' : meta.repeats.length ? '导出三路骨架' : '导出原速骨架';
  $('#manifest-link').href = data.manifestUrl;
  $('#reference-range').textContent = fmt(reference.start_time_sec) + '–' + fmt(reference.end_time_sec) + ' 秒';
  const select = $('#block');
  select.replaceChildren();
  for (const b of result.blocks) select.add(new Option(eightCountTitle(b) + ' · ' + fmt(b.start_time_sec) + '–' + fmt(b.end_time_sec) + ' s', b.block_id));
  const tbody = $('#candidates');
  tbody.replaceChildren();
  for (const c of record.candidates) {
    const s = c.stats, chosen = c.repeats === record.selected[c.method];
    const beatPositions = c.scheduledEvents.map(e => e.edgeIndex === meta.referenceEdges.length - 1 ? '组末' : String(e.edgeIndex + 1)).join(' · ');
    const row = tableRow(tbody, [LABELS[METHODS.indexOf(c.method)], c.repeats, beatPositions, s.hits + ' / ' + s.count,
      fmt(s.meanMs, 1) + ' ms', fmt(s.p95Ms, 1) + ' ms', fmt(s.minRate, 3) + '–' + fmt(s.maxRate, 3) + '×', chosen ? '选用' : '—']);
    row.dataset.selected = chosen;
  }
  const duration = meta.referenceEdges.at(-1), oneRoundRate = meta.period / duration;
  if (paired) {
    const count = record.selected.anchor;
    $('#finding').textContent = '首个 16 拍长 ' + fmt(duration) + ' 秒，可完成 ' + meta.repeats.join(' 或 ') +
      ' 轮。服务器 Anchor xTW 选用 ' + count + ' 轮，平均倍率 ' + fmt(count * oneRoundRate, 3) + '×。';
  } else if (meta.repeats.length > 1) {
    $('#finding').textContent = music.title_zh + '可在一组内完成 ' + meta.repeats.join(' 或 ') + ' 轮。Anchor xTW 选用 ' + record.selected.anchor + ' 轮，Astra 选用 ' + record.selected.astra + ' 轮。';
  } else if (meta.repeats.length) {
    $('#finding').textContent = music.title_zh + '每组可完成 ' + meta.repeats[0] + ' 轮，平均倍率 ' + fmt(meta.repeats[0] * oneRoundRate, 3) + '×。';
  } else {
    const n = Math.floor(manifest.rateBounds[1] / oneRoundRate);
    const rates = [n, n + 1].filter(k => k > 0).map(k => k + ' 轮需 ' + fmt(k * oneRoundRate, 3) + '×');
    $('#finding').textContent = '参考八拍长 ' + fmt(duration) + ' 秒。' + rates.join('，') + '，超出所选范围。';
  }
  tbody.closest('.table-wrap').hidden = !record.candidates.length;
  $('#provenance').textContent = meta.segment + ' / ' + meta.glb + ' · ' + meta.frames + ' 个内容帧及 1 个边界帧 · Module2_xtw ' + manifest.anchor.version +
    (paired ? ' · ' + manifest.anchor.entryPoint : ' · ' + manifest.astra.model);
  $('#inspection').textContent = '';
  $('#seek').max = result.duration;
  return reference;
}

function groupResults(block) {
  const music = fullBeats(), lo = block.start_time_sec, hi = block.end_time_sec;
  const inside = t => t >= lo - 1e-8 && t < hi - 1e-8;
  const values = data.result.variants.map(v => {
    const mapped = timingStats(v.beats.filter(inside), music), detected = timingStats(v.detectedBeats.filter(inside), music);
    const map = block.maps[v.id], rates = map.musicTimes.slice(1).map((x, i) =>
      (map.sourceTimes[i + 1] - map.sourceTimes[i]) / (x - map.musicTimes[i]));
    const ms = stats => stats.count ? fmt(stats.nearest.reduce((sum, e) => sum + Math.abs(e.errorMs), 0) / stats.count, 1) + ' ms' : '—';
    return [fmt((map.sourceTimes.at(-1) - map.sourceTimes[0]) / data.meta.period) + ' 轮',
      mapped.within100 + ' / ' + mapped.count, ms(mapped), detected.within100 + ' / ' + detected.count, ms(detected),
      fmt(Math.min(...rates), 3) + '–' + fmt(Math.max(...rates), 3) + '×',
      v.id === 'original' || !block.is_complete || !Number.isFinite(map.maxCorrectionSourceMs) ? '—' : fmt(map.maxCorrectionSourceMs, 1) + ' ms'];
  });
  $('#metrics').replaceChildren();
  ['本区间播放量', '映射转折命中', '映射平均误差', '骨架重检测命中', '重检测平均误差', '实际倍率', '限速修正的最大源时间差'].forEach((label, i) =>
    tableRow($('#metrics'), [label, ...data.result.displayMethods.map((_, j) => values[j]?.[i] ?? '—')]));
  $('#group-range').textContent = eightCountTitle(block) + ' · ' + fmt(lo) + '–' + fmt(hi) + ' 秒';
  if (data.paired) {
    const descriptions = {
      pair: [' 轮 / 16 拍', block.block_id === data.meta.referenceId
        ? '服务器在首个 16 拍选定轮数与转折拍位。动作连续跨过第 9 拍，命中数统计两个八拍内的全部转折。'
        : '沿用首个 16 拍的轮数和转折拍位，按本窗口的 17 个实际拍点迁移映射，并将局部速度约束在所选范围内。'],
      single: [' 轮 / 8 拍', '第 7 个八拍单独求解，在当前倍率内完成 ' + block.anchorRepeats + ' 轮深蹲。'],
      excerpt: ['模板前 8 拍', '第 7 个八拍在当前倍率内没有可行整数轮。此处沿用双八拍模板的前半段，播放量按实际经过的动作相位计算。'],
      partial: ['模板片段', '音乐残段播放双八拍模板的对应片段。']
    };
    const [badge, note] = descriptions[block.strategy];
    $('#repeat-1').textContent = (block.anchorRepeats ?? '') + badge;
    $('#group-note').textContent = note;
    return;
  }
  $('#group-note').textContent = !data.meta.repeats.length ? '所选范围没有可行整数轮，本区间仅显示原速循环的实测结果。' :
    block.block_type === 'gap' ? '此区间缺少已确认音乐拍，三栏按原速循环。' :
    !block.is_complete ? '这里播放模板的对应残段。下一完整八拍到来时，三栏动作相位重置，音乐连续播放。' :
    '命中分母包含本组的全部转折。骨架重检测使用 20 FPS 输出、5 帧高斯平滑及 0.2 秒最小间隔。' + (block.reset ? ' 本组第一拍重置动作相位。' : '');
}

function render(t) {
  if (!state.ready) return;
  const {result, meta, record, music, camera, atom} = data;
  const block = blockAt(result.blocks, t);
  if (state.currentBlock !== block) {
    state.currentBlock = block;
    $('#block').value = block.block_id;
    $('#loop option[value="block"]').disabled = !block.is_complete;
    $('#grid-position').textContent = eightCountTitle(block);
    groupResults(block);
  }
  panel.render(music, block, t);
  $('#clock').innerHTML = fmt(t) + ' <small>/ ' + fmt(result.duration) + ' s</small>';
  $('#clock').dataset.time = t.toFixed(6);
  $('#seek').value = String(t);
  result.variants.forEach((v, i) => {
    const point = readMap(block.maps[v.id], t - block.start_time_sec);
    const pose = playbackPose(v, result, meta, atom, t, point.source);
    const active = drawPose(byId('pose-' + i), v, t, result, meta.parents, camera, COLORS[i], pose);
    const card = byId('motion-card-' + i);
    card.classList.toggle('beat-active', highlights[i] && active);
    card.dataset.sourceTime = point.source.toFixed(6);
    byId('rate-' + i).textContent = fmt(point.rate, 2) + '×';
    const round = point.source / meta.period;
    byId('phase-' + i).textContent = fmt((round - Math.floor(round + 1e-9)) * meta.period + 1e-10);
  });
  drawTimeline($('#overview'), result, music, t);
  drawTimeline($('#zoom'), result, music, t, [block.start_time_sec, block.end_time_sec]);
  $('#diagnostics').textContent = JSON.stringify({clip: meta.id, rateBounds: data.manifest.rateBounds, ready: true, playing: state.playing, time: t,
    loop: state.loop, bounds: bounds(), sound, highlights, selected: record.selected, block: block.block_id,
    windowBeats: record.windowBeats ?? 8, strategy: block.strategy,
    detected: result.variants.map(v => v.detectedBeats.length), audioChannels: audioBuffer.numberOfChannels});
}

async function switchClip() {
  const id = $('#clip').value, maxRate = $('#rate-range').value;
  const paired = id === 'slow_squat' && $('#window-size').value === '2';
  $('#window-setting').hidden = id !== 'slow_squat';
  const sameClip = data?.meta.id === id;
  state.resumeAfterLoad = sameClip && (state.playing || (!state.ready && state.resumeAfterLoad));
  pause();
  state.ready = false; state.currentBlock = null;
  const request = ++state.loadId;
  for (const id of ['play', 'seek', 'reference', 'export', 'export-motion', 'block', 'loop']) byId(id).disabled = true;
  panel.clear();
  $('.three-up').setAttribute('aria-busy', 'true');
  notice('正在核对骨架、音乐和候选映射…');
  try {
    const value = await loadClip(id, maxRate, paired);
    if (request !== state.loadId) return;
    data = value; audioBuffer = value.mixed;
    const reference = populate();
    state.ready = true;
    if (sameClip) {
      if (state.loop === 'block') state.loopBlock = blockAt(value.result.blocks, state.offset);
    } else {
      state.offset = reference.start_time_sec; state.loop = DEFAULT_LOOP; state.loopBlock = null;
    }
    $('#loop').value = state.loop;
    for (const id of ['play', 'seek', 'reference', 'export', 'export-motion', 'block', 'loop']) byId(id).disabled = false;
    const description = value.meta.repeats.length ? '' : ' · 此范围没有可行整数轮，可播放原速循环';
    const grid = paired ? value.result.blocks.filter(b => b.strategy === 'pair').length + ' 个双八拍窗口，末尾余 1 个八拍'
      : value.result.blocks.filter(b => b.is_complete).length + ' 个完整八拍';
    notice(value.music.title_zh + ' · ' + grid + ' · 容许倍率 ' + value.manifest.rateBounds.join('–') + '×' + description);
    render(state.offset);
    if (state.resumeAfterLoad) await play();
  } catch (error) {
    if (request !== state.loadId) return;
    if (data) {
      $('#clip').value = data.meta.id;
      $('#rate-range').value = data.maxRate;
      $('#window-setting').hidden = data.meta.id !== 'slow_squat';
      if (data.meta.id === 'slow_squat') $('#window-size').value = data.paired ? '2' : '1';
      state.ready = true;
      for (const id of ['play', 'seek', 'reference', 'export', 'export-motion', 'block', 'loop']) byId(id).disabled = false;
      render(state.offset);
    }
    notice('载入失败。' + error.message + (data ? '。当前显示' + data.music.title_zh + '。' : ''), true);
  } finally {
    if (request === state.loadId) $('.three-up').removeAttribute('aria-busy');
  }
}

function inspect(event) {
  if (!state.ready) return;
  const c = event.currentTarget, rect = c.getBoundingClientRect(), lo = Number(c.dataset.start), hi = Number(c.dataset.end);
  const px = event.clientX - rect.left, py = event.clientY - rect.top;
  const scale = (rect.width - PLOT_LEFT - PLOT_RIGHT) / (hi - lo);
  const t = Math.max(lo, Math.min(hi, lo + (px - PLOT_LEFT) / scale));
  const row = ROWS.findIndex(y => Math.abs(py - y) <= 14);
  if (row < 0) { seek(t); return; }
  const detected = row > 0 && py > ROWS[row] + 1;
  const sourceBeats = row === 0 ? fullBeats() : data.result.variants[row - 1]?.[detected ? 'detectedBeats' : 'beats'] ?? [];
  const nearest = sourceBeats.reduce((best, v, i) => Math.abs(v - t) < Math.abs((sourceBeats[best] ?? Infinity) - t) ? i : best, -1);
  const point = sourceBeats[nearest];
  if (!Number.isFinite(point) || point < lo || point > hi || Math.abs(point - t) * scale > 9) { seek(t); return; }
  seek(point);
  const music = fullBeats(), label = row ? LABELS[row - 1] + (detected ? '骨架转折' : '映射转折') : '音乐拍';
  const indices = timingStats(sourceBeats.slice(Math.max(0, nearest - 1), nearest + 1), music).nearest;
  const match = indices.at(-1);
  const step = row && indices.length === 2 ? '，距上一转折跨 ' + (match.musicIndex - indices[0].musicIndex) + ' 拍' : '';
  const group = blockAt(data.result.blocks, match.musicTime);
  const beatOffset = match.musicIndex - group.start_beat_index;
  const beatInGroup = group.is_complete ? '（第 ' + (group.fullNumber + Math.floor(beatOffset / 8)) + ' 组第 ' + (beatOffset % 8 + 1) + ' 拍）' : '（残段）';
  $('#inspection').textContent = label + ' ' + fmt(point, 3) + ' 秒，最近音乐拍 ' + fmt(match.musicTime, 3) + ' 秒' + beatInGroup +
    (row ? '，' + (match.errorMs < 0 ? '提前 ' : '滞后 ') + fmt(Math.abs(match.errorMs), 1) + ' ms' + step : '') + '。';
}

function download(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], {type: 'application/json'}));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('#clip').onchange = switchClip;
$('#rate-range').onchange = switchClip;
$('#window-size').onchange = switchClip;
$('#play').onclick = () => state.playing ? pause() : play().catch(e => notice(e.message, true));
$('#reference').onclick = () => {
  const block = data.result.blocks.find(b => b.block_id === data.meta.referenceId);
  state.loop = 'block'; state.loopBlock = block; $('#loop').value = 'block'; seek(block.start_time_sec);
};
$('#seek').oninput = e => seek(Number(e.target.value));
$('#block').onchange = e => seek(data.result.blocks.find(b => b.block_id === e.target.value).start_time_sec);
$('#loop').onchange = async e => {
  const wasPlaying = state.playing;
  pause();
  state.loop = e.target.value;
  state.loopBlock = state.loop === 'block' ? blockAt(data.result.blocks, state.offset) : null;
  if (state.loop === 'all') state.offset = 0;
  render(state.offset);
  if (wasPlaying) await play();
};
$('#music').onclick = () => { sound.music = !sound.music; updateSound(); if (state.ready) render(clockTime()); };
$('#music-cue').onclick = () => { sound.musicCue = !sound.musicCue; updateSound(); if (state.ready) render(clockTime()); };
$('#motion-cue').onchange = e => { sound.motionCue = e.target.value; updateSound(); if (state.ready) render(clockTime()); };
document.querySelectorAll('[data-beat-highlight]').forEach(button => {
  button.onclick = () => {
    const i = Number(button.dataset.beatHighlight);
    highlights[i] = !highlights[i]; button.setAttribute('aria-pressed', highlights[i]);
    if (state.ready) render(clockTime());
  };
});
$('#overview').onclick = inspect; $('#zoom').onclick = inspect;
const exportPrefix = () => data.meta.id + '-' + data.manifest.rateBounds.join('-') + (data.paired ? '-16beat' : '');
$('#export').onclick = () => download({manifest: data.manifest, atom: data.meta, arrangement: data.record,
  mapped: Object.fromEntries(data.result.variants.map(v => [v.id, v.beats]))}, exportPrefix() + '-eight-count.json');
$('#export-motion').onclick = () => download({schema: SCHEMA, clip: data.meta.id, windowBeats: data.record.windowBeats ?? 8, rateBounds: data.manifest.rateBounds, fps: data.result.fps,
  shape: [data.result.variants.length, data.result.frames, 22, 3], variants: data.result.variants.map(v => ({...v, positions: Array.from(v.positions)}))}, exportPrefix() + '-body22.json');
document.addEventListener('visibilitychange', () => { if (document.hidden && state.playing) pause(); });
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && !['BUTTON', 'SELECT', 'INPUT', 'A', 'SUMMARY'].includes(document.activeElement.tagName)) {
    e.preventDefault(); $('#play').click();
  }
});
window.addEventListener('resize', () => { if (state.ready) render(clockTime()); });
function tick() {
  if (state.playing) {
    const t = clockTime();
    if (state.loop === 'off' && t >= data.result.duration) pause();
    else render(t);
  }
  requestAnimationFrame(tick);
}
try {
  const manifest = await loadManifest('1.5');
  musicCatalog = decode(await fetchBytes('../pamela-beat-demo/analysis.json', manifest.musicSha256));
  initAudio();
  for (const m of manifest.clips) $('#clip').add(new Option(musicCatalog.clips.find(c => c.id === m.id).title_zh, m.id));
  for (const maxRate of manifestFiles.keys()) $('#rate-range').add(new Option('0.8–' + maxRate + '×', maxRate));
  const params = new URLSearchParams(location.search);
  if (manifestFiles.has(params.get('rate'))) $('#rate-range').value = params.get('rate');
  if (params.get('window') === '2') { $('#clip').value = 'slow_squat'; $('#window-size').value = '2'; }
  $('#rate-range').disabled = false;
  $('#clip').disabled = false;
  await switchClip();
  requestAnimationFrame(tick);
} catch (error) { notice(error.message, true); }
