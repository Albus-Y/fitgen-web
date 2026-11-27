import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {METHODS, SCHEMA, blockAt, playbackPose, prepareClip, readMap, sampleAtom} from '../dist/pamela-dtw-demo/atomic.js';
import {interpolate} from '../dist/pamela-dtw-demo/dtw.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const published = path.join(root, 'dist/pamela-dtw-demo/eight-count');
const bytes = p => fs.readFileSync(p);
const hash = b => createHash('sha256').update(b).digest('hex');
const json = p => JSON.parse(bytes(p));
const floats = buffer => new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length));
const analysis = path.join(root, 'dist/pamela-beat-demo/analysis.json'), music = json(analysis);
function verifyPreset(cap, filename, verification) {
  const manifest = json(path.join(published, filename));
  const validation = verification && json(path.join(verification, 'validation/manifest.json'));
  let candidates = 0, fullBlocks = 0, poses = 0, maxError = 0;
  const report = [];
  const close = (a, b, e = 1e-7) => assert.ok(Math.abs(a - b) <= e, a + ' / ' + b);
  assert.equal(manifest.schema, SCHEMA);
  assert.deepEqual(manifest.rateBounds, [.8, cap]);
  assert.equal(manifest.anchor.warper.max_warp_rate, cap);
  assert.equal(manifest.anchor.warper.min_warp_rate, .8);
  assert.equal(manifest.anchor.entryPoint, 'xtw.retime_motion_to_music');
  assert.equal(manifest.astra.model, 'gpt-6.2-astra');
  assert.equal(hash(bytes(analysis)), manifest.musicSha256);
  assert.equal(hash(bytes(path.join(root, 'dist/motion-beat-demo/catalog.json'))), manifest.motionCatalogSha256);
  if (verification) {
    const input = bytes(path.join(verification, 'inputs.json'));
    const meta = JSON.parse(input);
    if (meta.rateBounds) {
      assert.equal(hash(input), manifest.anchor.inputSha256);
    } else {
      // 早期 0.8–1.5× 验证目录的输入清单尚未写入倍率字段。
      assert.equal(cap, 1.5);
      assert.equal(meta.musicSha256, manifest.musicSha256);
      assert.equal(meta.motionCatalogSha256, manifest.motionCatalogSha256);
      assert.deepEqual(meta.clips, manifest.clips.map(({parents, atomFile, atomSha256, file, sha256, ...clip}) => clip));
    }
  }
  for (const [name, fingerprint] of [['run_atom_anchor.py', manifest.anchor.runnerSha256],
    ['arrange_atom_astra.py', manifest.astra.solverSha256], ['build_pamela_eight_count.py', manifest.builderSha256]]) {
    assert.equal(hash(bytes(path.join(root, 'scripts', name))), fingerprint);
  }
  for (const meta of manifest.clips) {
    const track = music.clips.find(c => c.id === meta.id);
    const audio = bytes(path.join(root, 'dist/pamela-beat-demo', track.audio));
    assert.equal(hash(audio), track.audio_sha256);
    const file = bytes(path.join(published, meta.file)), raw = bytes(path.join(published, meta.atomFile));
    assert.equal(hash(file), meta.sha256); assert.equal(hash(raw), meta.atomSha256);
    const atom = floats(raw), record = JSON.parse(file);
    const result = prepareClip(meta, track, record, atom, manifest.rateBounds), edges = meta.referenceEdges;
    assert.equal(result.frames, 600); assert.equal(result.fps, 20);
    assert.deepEqual(record.rateBounds, manifest.rateBounds);
    assert.deepEqual(meta.repeats, Array.from({length: Math.floor(cap * edges[8] / meta.period)}, (_, i) => i + 1)
      .filter(n => n * meta.period >= .8 * edges[8] - 1e-8));
    assert.equal(record.candidates.length, 2 * meta.repeats.length);
    assert.deepEqual(result.variants.map(v => v.id), meta.repeats.length ? METHODS : ['original']);
    if (!meta.repeats.length) {
      assert.equal(meta.id, 'slow_squat'); assert.equal(cap, 1.2);
      assert.deepEqual(record.selected, {});
      assert.deepEqual(Object.keys(record.detected), ['original']);
      assert.ok(record.blocks.every(b => Object.keys(b.maps).join() === 'original'));
    }
    for (const c of record.candidates) {
      candidates++;
      const events = [];
      for (let k = 0; k < c.repeats; k++) for (const event of meta.events)
        events.push(interpolate(c.sourceTimes, c.musicTimes, k * meta.period + event));
      const errors = events.map(t => 1000 * Math.min(...edges.map(b => Math.abs(t - b))));
      assert.equal(c.scheduledEvents.length, events.length);
      for (let i = 0; i < events.length; i++) {
        const e = c.scheduledEvents[i];
        close(e.musicTime, events[i]);
        close(e.offsetMs, 1000 * (events[i] - edges[e.edgeIndex]));
        close(Math.abs(e.offsetMs), errors[i]);
      }
      assert.equal(c.stats.hits, errors.filter(x => x <= 100.0001).length);
      close(c.stats.meanMs, errors.reduce((a,b) => a+b) / errors.length);
      assert.equal(c.stats.count, 2 * c.repeats);
      assert.ok(c.stats.minRate >= .8 - 5e-6 && c.stats.maxRate <= cap + 5e-6);
      close(c.sourceTimes[0], 0); close(c.sourceTimes.at(-1), c.repeats * meta.period);
      if (c.method === 'anchor') {
        assert.ok(c.diagnostics.backend.includes('gdtw'));
        if (verification) {
          const real = floats(bytes(path.join(verification, 'server', meta.id + '-' + c.repeats + '-anchor.f32')));
          assert.equal(real.length, Math.ceil(edges[8] * meta.fps) * 66);
          for (let n = 0; n < real.length / 66; n++) {
            const pose = sampleAtom(atom, meta, readMap(c, n / meta.fps).source);
            for (let j = 0; j < 66; j++) close(pose[j], real[n * 66 + j], 2e-6);
          }
        }
      } else {
        assert.equal(c.diagnostics.status, 'optimal');
        assert.ok(c.diagnostics.inverseSpeedKnots.length > 20);
      }
    }
    for (const m of Object.keys(record.selected)) {
      const options = record.candidates.filter(c => c.method === m);
      const best = Math.max(...options.map(c => c.stats.hits / c.stats.count));
      const leaders = options.filter(c => c.stats.hits / c.stats.count === best);
      const error = Math.min(...leaders.map(c => c.stats.meanMs));
      const winner = leaders.filter(c => c.stats.meanMs <= error + 10).sort((a,b) =>
        a.stats.rmsRateDeviation - b.stats.rmsRateDeviation || a.stats.rateVariation - b.stats.rateVariation || a.repeats - b.repeats)[0];
      assert.equal(record.selected[m], winner.repeats);
    }
    const resets = result.blocks.filter(b => b.reset).map(b => b.start_time_sec);
    if (meta.id === 'reach_down_jump') assert.deepEqual(resets, [2.31, 8.07, 25.35]);
    for (const [i, b] of result.blocks.entries()) {
      const duration = b.end_time_sec - b.start_time_sec;
      if (b.is_complete) fullBlocks++;
      for (const v of result.variants) {
        const m = v.id, w = b.maps[m];
        if (i && !b.reset) close(result.blocks[i-1].maps[m].sourceTimes.at(-1), w.sourceTimes[0]);
        if (b.reset) {
          close(w.sourceTimes[0], 0);
          assert.deepEqual(playbackPose(v, result, meta, atom, b.start_time_sec, 0), atom.slice(0, 66));
        }
        if (m === 'original' || b.block_type === 'gap') close(w.sourceTimes.at(-1) - w.sourceTimes[0], duration);
        if (b.is_complete && m !== 'original') {
          const count = record.selected[m];
          assert.equal(v.beats.filter(t => t >= b.start_time_sec - 1e-8 && t < b.end_time_sec - 1e-8).length, 2 * count);
          const template = record.candidates.find(c => c.method === m && c.repeats === count);
          for (let beat = 0; beat <= 8; beat++) {
            const t = track.music_beats[b.start_beat_index + beat].time_sec - b.start_time_sec;
            const err = Math.abs(readMap(w, t).source - w.sourceTimes[0] - readMap(template, edges[beat]).source);
            assert.ok(err <= (w.maxCorrectionSourceMs ?? 0) / 1000 + 2e-6);
          }
        }
        assert.ok(w.musicTimes.slice(1).every((t,k) => {
          const rate = (w.sourceTimes[k+1] - w.sourceTimes[k]) / (t - w.musicTimes[k]);
          return rate >= .8 - 5e-6 && rate <= cap + 5e-6;
        }));
      }
    }
    for (const v of result.variants) {
      assert.deepEqual(v.detectedBeats, record.detected[v.id]);
      if (verification) {
        const ref = validation.find(c => c.clip === meta.id && c.method === v.id);
        const buffer = bytes(path.join(verification, 'validation', ref.file));
        assert.equal(hash(buffer), ref.sha256);
        const independent = floats(buffer);
        assert.equal(independent.length, v.positions.length);
        for (let i = 0; i < independent.length; i++) maxError = Math.max(maxError, Math.abs(independent[i] - v.positions[i]));
        poses += independent.length / 66;
      }
    }
    const first = result.blocks.find(b => b.is_complete);
    assert.equal(blockAt(result.blocks, first.start_time_sec).block_id, meta.referenceId);
    const corrupted = structuredClone(record);
    corrupted.blocks[0].maps.original.sourceTimes[1] += 20;
    assert.throws(() => prepareClip(meta, track, corrupted, atom), /倍率|映射/);
    report.push({clip: meta.id, selected: record.selected, resets, mapped: result.variants.map(v => v.beats.length),
      detected: result.variants.map(v => v.detectedBeats.length)});
  }
  assert.equal(candidates, cap === 1.5 ? 8 : 4); assert.equal(fullBlocks, 20); assert.ok(maxError < 2e-6);
  return {cap, candidates, fullBlocks, poses, maxError, report};
}

const wide = verifyPreset(1.5, 'manifest.json', process.argv[2]);
const narrow = verifyPreset(1.2, 'manifest-1.2.json', process.argv[3]);
for (const {clip} of wide.report) {
  const broad = json(path.join(published, clip + '.json')), tight = json(path.join(published, clip + '-1.2.json'));
  assert.deepEqual(broad.detected.original, tight.detected.original);
  assert.deepEqual(broad.blocks.map(b => b.maps.original), tight.blocks.map(b => b.maps.original));
}
console.log(JSON.stringify({result: 'PASS', presets: [wide, narrow]}, null, 2));
