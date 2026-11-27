import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {blockAt, prepareClip, readMap, sampleAtom} from '../dist/pamela-dtw-demo/atomic.js';
import {interpolate} from '../dist/pamela-dtw-demo/dtw.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const published = path.join(root, 'dist/pamela-dtw-demo/eight-count');
const read = file => readFileSync(file);
const hash = data => createHash('sha256').update(data).digest('hex');
const floats = data => new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
const close = (a, b, tol = 1e-7) => assert.ok(Math.abs(a - b) <= tol, a + ' ≠ ' + b);
const bundleFile = 'slow_squat-16.json';
const bundleBytes = read(path.join(published, bundleFile));
const bundle = JSON.parse(bundleBytes);
const output = process.argv[2];
if (output) assert.equal(hash(bundleBytes), hash(read(path.join(output, bundleFile))));
assert.equal(bundle.id, 'slow_squat');
assert.deepEqual(Object.keys(bundle.profiles), ['1.2', '1.5']);
assert.equal(bundle.entryPoint, 'xtw.retime_motion_to_music');
assert.equal(bundle.builderSha256, hash(read(path.join(root, 'scripts/build_squat_two_eights.py'))));
const music = read(path.join(root, 'dist/pamela-beat-demo/analysis.json'));
assert.equal(hash(music), bundle.musicSha256);
const track = JSON.parse(music).clips.find(c => c.id === bundle.id);
let poseError = 0;
function comparePoses(actual, reference) {
  assert.equal(actual.length, reference.length);
  for (let j = 0; j < actual.length; j++) poseError = Math.max(poseError, Math.abs(actual[j] - reference[j]));
  assert.ok(poseError < 2e-6, String(poseError));
}

for (const [cap, record] of Object.entries(bundle.profiles)) {
  const narrow = cap === '1.2';
  const base = JSON.parse(read(path.join(published, narrow ? 'manifest-1.2.json' : 'manifest.json')));
  const single = base.clips.find(c => c.id === bundle.id);
  assert.deepEqual(bundle.sourceSha256, base.anchor.sourceSha256);
  assert.equal(bundle.templateBuilderSha256, base.builderSha256);
  assert.equal(bundle.solverVersion, base.anchor.version);
  const atomBytes = read(path.join(published, single.atomFile)), atom = floats(atomBytes);
  assert.equal(hash(atomBytes), bundle.atomSha256);
  assert.equal(single.atomSha256, bundle.atomSha256);
  const meta = {...single, referenceId: record.referenceId, referenceEdges: record.referenceEdges,
    repeats: record.candidates.map(c => c.repeats)};
  const result = prepareClip(meta, track, record, atom, base.rateBounds);
  assert.deepEqual(result.displayMethods, ['original', 'anchor']);
  assert.deepEqual(result.variants.map(v => v.id), result.displayMethods);
  assert.deepEqual(record.rateBounds, [.8, Number(cap)]);
  assert.equal(record.warper.max_warp_rate, Number(cap));
  assert.equal(record.warper.min_warp_rate, .8);
  assert.equal(record.windowBeats, 16);
  assert.deepEqual(record.selected, {anchor: narrow ? 3 : 4});
  assert.deepEqual(meta.repeats, narrow ? [3] : [3, 4]);
  const grid = track.music_beats.filter(b => b.time_sec >= .87 && b.time_sec <= 8.55);
  assert.equal(record.referenceEdges.length, 17);
  record.referenceEdges.forEach((e, i) => close(e, grid[i].time_sec - .87));
  assert.deepEqual(result.blocks.filter(b => b.is_complete).map(b => [b.fullNumber, b.beat_count, b.strategy]), [
    [1, 16, 'pair'], [3, 16, 'pair'], [5, 16, 'pair'], [7, 8, narrow ? 'excerpt' : 'single']
  ]);
  assert.deepEqual(result.blocks.filter(b => b.reset).map(b => b.start_time_sec), [.87]);
  const ref = blockAt(result.blocks, .87);
  assert.equal(ref.block_id, record.referenceId);

  // 逐帧核对服务器原始返回值。每次服务器求解从源时间 0 开始。
  function checkServerMap(blockId, n, map, diagnostics) {
    assert.ok(diagnostics.backend.includes('gdtw') && diagnostics.anchorPairs.length > 0);
    if (!output) return;
    const buffer = read(path.join(output, cap + '-' + blockId + '-' + n + '-anchor.f32'));
    assert.equal(hash(buffer), diagnostics.validationSha256);
    const reference = floats(buffer);
    assert.equal(reference.length, Math.ceil(map.musicTimes.at(-1) * meta.fps) * 66);
    for (let i = 0; i < reference.length / 66; i++) {
      const source = readMap(map, i / meta.fps).source - map.sourceTimes[0];
      comparePoses(sampleAtom(atom, meta, source), reference.subarray(i * 66, (i + 1) * 66));
    }
  }
  for (const c of record.candidates) {
    assert.equal(c.method, 'anchor');
    close(c.sourceTimes[0], 0);
    close(c.sourceTimes.at(-1), c.repeats * meta.period);
    assert.equal(c.scheduledEvents.length, 2 * c.repeats);
    const errors = c.scheduledEvents.map((event, i) => {
      const s = Math.floor(i / 2) * meta.period + meta.events[i % 2];
      const t = interpolate(c.sourceTimes, c.musicTimes, s);
      close(t, event.musicTime);
      close(event.offsetMs, 1000 * (t - record.referenceEdges[event.edgeIndex]));
      const err = 1000 * Math.min(...record.referenceEdges.map(edge => Math.abs(t - edge)));
      close(Math.abs(event.offsetMs), err);
      return err;
    });
    assert.equal(c.stats.hits, errors.filter(e => e <= 100).length);
    assert.equal(c.stats.hits, c.repeats === 3 ? 4 : 8);
    assert.equal(c.stats.count, errors.length);
    close(c.stats.meanMs, errors.reduce((a, b) => a + b) / errors.length);
    checkServerMap(ref.block_id, c.repeats, c, c.diagnostics);
  }
  const singleResult = prepareClip(single, track, JSON.parse(read(path.join(published, single.file))), atom, base.rateBounds);
  assert.deepEqual(result.variants[0].positions, singleResult.variants[0].positions);
  const template = record.candidates.find(c => c.repeats === record.selected.anchor);
  for (const [i, block] of result.blocks.entries()) {
    const map = block.maps.anchor, older = result.blocks[i - 1];
    if (older && !block.reset) close(map.sourceTimes[0], older.maps.anchor.sourceTimes.at(-1));
    map.musicTimes.slice(1).forEach((t, j) => {
      const rate = (map.sourceTimes[j + 1] - map.sourceTimes[j]) / (t - map.musicTimes[j]);
      assert.ok(rate >= .8 - 5e-6 && rate <= Number(cap) + 5e-6);
    });
    if (block.strategy === 'pair') {
      assert.equal(block.end_beat_index - block.start_beat_index + 1, 16);
      assert.equal(block.middleTime, track.music_beats[block.start_beat_index + 8].time_sec);
      const middle = block.middleTime - block.start_time_sec;
      assert.equal(blockAt(result.blocks, block.middleTime), block);
      const edges = track.music_beats.slice(block.start_beat_index, block.end_beat_index + 2)
        .map(beat => beat.time_sec - block.start_time_sec);
      const actualBeats = result.variants[1].beats.filter(t => t >= block.start_time_sec && t < block.end_time_sec);
      const beatIndices = actualBeats.map(t => {
        const localTime = t - block.start_time_sec;
        return edges.reduce((best, edge, j) => Math.abs(edge - localTime) < Math.abs(edges[best] - localTime) ? j : best, 0);
      });
      assert.deepEqual(beatIndices, template.scheduledEvents.map(e => e.edgeIndex));
      if (block !== ref) {
        const points = [...record.referenceEdges, ...template.musicTimes];
        const corrections = points.map(t => {
          const local = interpolate(record.referenceEdges, edges, t);
          return Math.abs(readMap(map, local).source - map.sourceTimes[0] - readMap(template, t).source);
        });
        close(1000 * Math.max(...corrections), map.maxCorrectionSourceMs, .0001);
        assert.equal(map.projected, map.maxCorrectionSourceMs > 0);
      }
      if (narrow) {
        const phase = (readMap(map, middle).source - map.sourceTimes[0]) / meta.period;
        assert.ok(phase > 1.4 && phase < 1.6);
      }
    }
    if (block.anchorRepeats != null) {
      close(map.sourceTimes.at(-1) - map.sourceTimes[0], block.anchorRepeats * meta.period);
      if (block.strategy === 'single') checkServerMap(block.block_id, block.anchorRepeats, map, record.blocks[i].diagnostics);
    }
  }
  const last = blockAt(result.blocks, 23.9);
  const amount = (last.maps.anchor.sourceTimes.at(-1) - last.maps.anchor.sourceTimes[0]) / meta.period;
  if (narrow) {
    assert.equal(last.anchorRepeats, null);
    close(amount, readMap(ref.maps.anchor, 3.84).source / meta.period);
  } else close(amount, 2);
  for (const variant of result.variants) {
    assert.equal(variant.positions.length, 600 * 66);
    assert.deepEqual(variant.detectedBeats, record.detected[variant.id]);
    if (output) comparePoses(variant.positions, floats(read(path.join(output, cap + '-' + variant.id + '.f32'))));
  }
}
console.log('双八拍验证通过：两档倍率，3 个参考候选，每档 3 个完整窗口及第 7 组收尾。' +
  (output ? '服务器逐帧最大坐标差 ' + poseError.toExponential(2) : ''));
