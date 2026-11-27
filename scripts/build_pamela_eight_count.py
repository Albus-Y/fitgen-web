"""准备八拍实验输入，或合并服务器和 Astra 的实际映射、骨架与验证记录。"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import struct

import numpy as np
from scipy.ndimage import gaussian_filter1d
from scipy.signal import find_peaks


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / 'dist/pamela-dtw-demo'
MUSIC = ROOT / 'dist/pamela-beat-demo/analysis.json'
MOTION = ROOT / 'dist/motion-beat-demo/catalog.json'
CLIPS = ('slow_squat', 'jumping_jack', 'reach_down_jump')
METHODS = ('original', 'anchor', 'astra')
DEFAULT_BOUNDS = (.8, 1.5)


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def save(path, value):
    with path.open('w', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
        stream.write('\n')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def beat_edges(music, block):
    i = block['start_beat_index']
    start, end = block['start_time_sec'], block['end_time_sec']
    beats = music['music_beats']
    assert block['is_complete'] and block['beat_count'] == 8
    assert abs(beats[i]['time_sec'] - start) < 1e-8 and abs(beats[i + 8]['time_sec'] - end) < 1e-8
    return np.round([b['time_sec'] - start for b in beats[i:i + 9]], 10)


def prepare(dataset, output, max_rate=DEFAULT_BOUNDS[1]):
    music = {x['id']: x for x in load(MUSIC)['clips']}
    motion = {x['id']: x for x in load(MOTION)['clips']}
    rows = []
    for segment, clip in enumerate(CLIPS, 2):
        glb, = (dataset / f'segment{segment:03}').glob('*.glb')
        with glb.open('rb') as stream:
            assert stream.read(4) == b'glTF'
            stream.seek(12)
            length, tag = struct.unpack('<II', stream.read(8))
            assert tag == 0x4E4F534A
            atom = json.loads(stream.read(length))['extras']['atomic_motion']
        exp, source = atom['export'], atom['provenance']['motion']
        frames, fps, period = exp['content_frame_count'], source['fps'], exp['duration_sec']
        assert exp['terminal_key_is_boundary_pose'] and exp['keyframe_count'] == frames + 1
        assert frames == source['end_frame_exclusive'] - source['start_frame'] and abs(period - frames / fps) < 1e-8
        events = [round(t - source['start_sec'], 10) for t in motion[clip]['beats']
                  if source['start_sec'] <= t < source['end_sec_exclusive']]
        ref = next(g for g in music[clip]['blocks'] if g['is_complete'])
        edges = beat_edges(music[clip], ref)
        repeats = list(range(math.ceil(DEFAULT_BOUNDS[0] * edges[-1] / period - 1e-9),
                             math.floor(max_rate * edges[-1] / period + 1e-9) + 1))
        rows.append({'id': clip, 'segment': glb.parent.name, 'glb': glb.name, 'glbSha256': sha(glb),
                     'atomId': atom['atom_id'], 'period': period, 'frames': frames, 'fps': fps,
                     'sourceFrames': [source['start_frame'], source['end_frame_exclusive']],
                     'events': events, 'repeats': repeats, 'referenceId': ref['block_id'],
                     'referenceEdges': edges.tolist(), 'duration': motion[clip]['media_duration']})
    output.mkdir(parents=True, exist_ok=False)
    save(output / 'inputs.json', {'schema': 'fitgen-atom-inputs-v1', 'musicSha256': sha(MUSIC),
                                  'motionCatalogSha256': sha(MOTION),
                                  'rateBounds': [DEFAULT_BOUNDS[0], max_rate], 'clips': rows})


def mapping(x, y, rate_bounds):
    """去掉共线内点。十二位秒数精度可保留不同帧率的真实边界。"""
    x, y = np.round(x, 12), np.round(y, 12)
    assert len(x) >= 2 and np.all(np.diff(x) > 0)
    rate = np.diff(y) / np.diff(x)
    assert rate.min() >= rate_bounds[0] - 5e-6 and rate.max() <= rate_bounds[1] + 5e-6, (rate.min(), rate.max())
    keep = np.r_[True, np.abs(np.diff(rate)) > 1e-8, True]
    return {'musicTimes': x[keep].tolist(), 'sourceTimes': y[keep].tolist()}


def events_in(warp, period, events):
    source = warp['sourceTimes']
    start, end = source[0], source[-1]
    turns = [round(k * period + e, 10) for k in range(math.floor(start / period), math.ceil(end / period) + 1)
             for e in events if start - 1e-9 <= k * period + e < end - 1e-9]
    return np.interp(turns, source, warp['musicTimes'])


def accuracy(events, beats):
    if not len(events) or not len(beats):
        return {'count': len(events), 'hits': 0, 'meanMs': None, 'p95Ms': None}
    errors = 1000 * np.min(np.abs(np.asarray(events)[:, None] - beats), axis=1)
    return {'count': len(events), 'hits': int(np.sum(errors <= 100 + 1e-4)),
            'meanMs': float(errors.mean()), 'p95Ms': float(np.percentile(errors, 95))}


def stats(warp, meta, beats):
    dt = np.diff(warp['musicTimes'])
    rates = np.diff(warp['sourceTimes']) / dt
    events = events_in(warp, meta['period'], meta['events'])
    return {**accuracy(events, beats), 'minRate': float(rates.min()), 'maxRate': float(rates.max()),
            'rmsRateDeviation': float(np.sqrt(np.average((rates - 1) ** 2, weights=dt))),
            'rateVariation': float(abs(np.diff(rates)).sum())}


def select(candidates):
    best_hits = max(c['stats']['hits'] / c['stats']['count'] for c in candidates)
    leaders = [c for c in candidates if c['stats']['hits'] / c['stats']['count'] == best_hits]
    threshold = min(c['stats']['meanMs'] for c in leaders) + 10
    return min((c for c in leaders if c['stats']['meanMs'] <= threshold),
               key=lambda c: (c['stats']['rmsRateDeviation'], c['stats']['rateVariation'], c['repeats']))


def transfer(template, new_edges, ref_edges, rate_bounds):
    """在九个真实边界间传送同一模板，也支持不足八拍的连续子区间。"""
    x, y = template['musicTimes'], template['sourceTimes']
    interior = [t for t in x if ref_edges[0] + 1e-9 < t < ref_edges[-1] - 1e-9]
    # 音乐拍处和模板斜率折点同时分段，精确组成两个分段线性函数。
    ref = np.unique(np.round(np.r_[ref_edges, interior], 10))
    t = np.interp(ref, ref_edges, new_edges)
    ideal = np.interp(ref, x, y)
    dt = np.diff(t)
    rate = np.diff(ideal) / dt
    span = ideal[-1] - ideal[0]
    duration = t[-1] - t[0]
    slow, fast = rate_bounds
    target = float(np.clip(span, slow * duration, fast * duration))
    if len(new_edges) == 9 and abs(ref_edges[0]) < 1e-8 and abs(ref_edges[-1] - x[-1]) < 1e-8:
        if abs(target - span) > 1e-7:
            raise ValueError('此完整八拍无法容纳参考组的轮数')
    result = ideal
    if rate.min() < slow - 1e-8 or rate.max() > fast + 1e-8:
        # 有界加权最小二乘投影：固定总位移，最小化 ∑dt·(v-v_ideal)²。
        lo, hi = slow - rate.max() - 1, fast - rate.min() + 1
        for _ in range(64):
            shift = (lo + hi) / 2
            if np.dot(dt, np.clip(rate + shift, slow, fast)) < target:
                lo = shift
            else:
                hi = shift
        result = ideal[0] + np.r_[0., np.cumsum(dt * np.clip(rate + (lo + hi) / 2, slow, fast))]
        result[-1] = ideal[0] + target
    warp = mapping(t, result, rate_bounds)
    warp['projected'] = result is not ideal
    warp['maxCorrectionSourceMs'] = round(float(np.max(abs(result - ideal)) * 1000), 4)
    return warp


def partial_edges(music, block, ref):
    start, end = block['start_time_sec'], block['end_time_sec']
    duration = end - start
    local = np.array([round(b['time_sec'] - start, 10) for b in music['music_beats']
                      if start - 1e-8 <= b['time_sec'] < end - 1e-8])
    if not len(local):
        return None
    if block['block_type'] == 'partial_head':
        ref_knots = list(ref[8 - len(local):])
        t = [*local, duration]
        if t[0] > 1e-8:
            ref_knots.insert(0, max(0., ref_knots[0] - t[0]))
            t.insert(0, 0.)
    else:
        t = list(local)
        ref_knots = list(ref[:len(t)])
        if t[0] > 1e-8:
            ref_knots = [v + t[0] for v in ref_knots]
            t.insert(0, 0.)
            ref_knots.insert(0, 0.)
        next_beat = next((b for b in music['music_beats'] if abs(b['time_sec'] - end) < 1e-7), None)
        ref_end = ref[len(local)] if next_beat else min(ref[-1], ref_knots[-1] + duration - t[-1])
        ref_knots.append(ref_end)
        t.append(duration)
    return np.array(t), np.array(ref_knots)


def compile_blocks(meta, music, chosen, rate_bounds):
    ref = np.array(meta['referenceEdges'])
    rows = []
    previous_end = dict.fromkeys(METHODS, 0.)
    for block in music['blocks']:
        full = block['is_complete']
        start, end = block['start_time_sec'], block['end_time_sec']
        length = round(end - start, 10)
        reset = bool(full and rows and not rows[-1]['full'])
        targets = (beat_edges(music, block), ref) if full else partial_edges(music, block, ref)
        row = {'id': block['block_id'], 'kind': block['block_type'], 'full': full,
               'start': start, 'end': end, 'reset': reset, 'maps': {}}
        for method in ('original', *chosen):
            if method == 'original' or targets is None:
                warp = mapping([0., length], [0., length], rate_bounds)
            else:
                warp = transfer(chosen[method], *targets, rate_bounds)
            first = warp['sourceTimes'][0]
            offset = 0 if reset else previous_end[method]
            if not rows and method != 'original' and targets is not None:
                offset = first  # 段首残拍使用模板的末段。
            warp['sourceTimes'] = [round(offset + v - first, 12) for v in warp['sourceTimes']]
            previous_end[method] = warp['sourceTimes'][-1]
            row['maps'][method] = warp
        rows.append(row)
    return rows


def sample_atom(atom, source, meta):
    phase_frames = np.round(source * meta['fps'], 10)
    low = np.floor(phase_frames).astype(int)
    frac = (phase_frames - low)[:, None, None]
    count = meta['frames']
    delta = (atom[-1, 0] - atom[0, 0]).astype(float)
    delta[1] = 0
    def pose(indices):
        return atom[indices % count] + (indices // count)[:, None, None] * delta
    return (pose(low) * (1 - frac) + pose(low + 1) * frac).astype('<f4')


def detect(poses, fps):
    velocity = np.linalg.norm(np.diff(poses.astype(float), axis=0), axis=-1).mean(axis=1)
    smooth = gaussian_filter1d(velocity, sigma=5, mode='reflect')
    frames, _ = find_peaks(-smooth, distance=math.ceil(.2 * fps))
    return frames / fps


def assemble(work, output):
    from arrange_atom_astra import solve_astra
    import scipy
    inputs = load(work / 'inputs.json')
    server = work / 'server'
    anchor = load(server / 'anchor.json')
    assert inputs['musicSha256'] == sha(MUSIC) and inputs['motionCatalogSha256'] == sha(MOTION)
    assert anchor['provenance']['inputSha256'] == sha(work / 'inputs.json')
    rate_bounds = tuple(inputs.get('rateBounds', DEFAULT_BOUNDS))
    warper = anchor['provenance']['warper']
    assert rate_bounds == (warper['min_warp_rate'], warper['max_warp_rate'])
    suffix = '' if rate_bounds == DEFAULT_BOUNDS else f'-{rate_bounds[1]:g}'
    music = {c['id']: c for c in load(MUSIC)['clips']}
    output.mkdir(parents=True, exist_ok=False)
    validation = work / 'validation'
    validation.mkdir(exist_ok=False)
    manifest = {'schema': 'fitgen-atomic-eight-v1', 'musicSha256': inputs['musicSha256'],
                'motionCatalogSha256': inputs['motionCatalogSha256'], 'rateBounds': rate_bounds,
                'anchor': anchor['provenance'], 'astra': {'model': 'gpt-6.2-astra',
                'solverSha256': sha(Path(__file__).with_name('arrange_atom_astra.py')), 'scipy': scipy.__version__},
                'builderSha256': sha(Path(__file__)), 'clips': []}
    checks = []
    for meta in inputs['clips']:
        clip = meta['id']
        catalog = music[clip]
        edges = np.array(meta['referenceEdges'])
        server_row = anchor['clips'][clip]
        atom_file = server / (clip + '.f32')
        assert sha(atom_file) == server_row['atomSha256']
        atom = np.fromfile(atom_file, dtype='<f4').reshape(meta['frames'] + 1, 22, 3)
        asset = {**meta, 'parents': server_row['parents'], 'atomFile': atom_file.name,
                 'atomSha256': server_row['atomSha256']}
        shutil.copyfile(atom_file, output / atom_file.name)
        candidates = []
        for repeats in meta['repeats']:
            x = next(c for c in server_row['candidates'] if c['repeats'] == repeats)
            a = solve_astra(meta['period'], meta['events'], repeats, edges, rate_bounds)
            for method, raw in [('anchor', x), ('astra', a)]:
                warp = mapping(raw['musicTimes'], raw['sourceTimes'], rate_bounds)
                result = {**warp, 'method': method, 'repeats': repeats, 'diagnostics': raw['diagnostics'],
                          'stats': stats(warp, meta, edges)}
                scheduled = []
                for t in events_in(warp, meta['period'], meta['events']):
                    beat = int(np.argmin(abs(edges - t)))
                    scheduled.append({'musicTime': float(t), 'edgeIndex': beat,
                                      'offsetMs': float(1000 * (t - edges[beat]))})
                result['scheduledEvents'] = scheduled
                assert result['stats']['count'] == repeats * len(meta['events'])
                if method == 'anchor':
                    path = server / f'{clip}-{repeats}-anchor.f32'
                    assert sha(path) == x['validationSha256']
                    real = np.fromfile(path, dtype='<f4').reshape(-1, 22, 3)
                    t = np.arange(len(real)) / meta['fps']
                    expected = sample_atom(atom, np.interp(t, warp['musicTimes'], warp['sourceTimes']), meta)
                    np.testing.assert_allclose(expected, real, atol=2e-6, rtol=0)
                candidates.append(result)
        chosen = {m: select([c for c in candidates if c['method'] == m])
                  for m in ('anchor', 'astra')} if candidates else {}
        blocks = compile_blocks(meta, catalog, chosen, rate_bounds)
        result = {'schema': manifest['schema'], 'id': clip, 'rateBounds': rate_bounds, 'candidates': candidates,
                  'selected': {m: c['repeats'] for m, c in chosen.items()}, 'blocks': blocks, 'detected': {}}
        t = np.arange(round(meta['duration'] * meta['fps'])) / meta['fps']
        for m in ('original', *chosen):
            source = np.full(len(t), np.nan)
            for b in blocks:
                mask = (t >= b['start'] - 1e-10) & (t < b['end'] - 1e-10)
                w = b['maps'][m]
                source[mask] = np.interp(t[mask] - b['start'], w['musicTimes'], w['sourceTimes'])
                if b['full'] and m in chosen:
                    assert abs(w['sourceTimes'][-1] - w['sourceTimes'][0] - chosen[m]['repeats'] * meta['period']) < 1e-7
            assert np.isfinite(source).all()
            poses = sample_atom(atom, source, meta)
            result['detected'][m] = detect(poses, meta['fps']).tolist()
            path = validation / f'{clip}-{m}.f32'
            poses.tofile(path)
            checks.append({'clip': clip, 'method': m, 'file': path.name, 'sha256': sha(path)})
        json_path = output / (clip + suffix + '.json')
        save(json_path, result)
        manifest['clips'].append({**asset, 'file': json_path.name, 'sha256': sha(json_path)})
    save(validation / 'manifest.json', checks)
    save(output / ('manifest' + suffix + '.json'), manifest)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest='mode', required=True)
    p = subs.add_parser('prepare')
    p.add_argument('--atom-root', required=True, type=Path)
    p.add_argument('--work', required=True, type=Path)
    p.add_argument('--max-rate', type=float, choices=(1.2, 1.5), default=DEFAULT_BOUNDS[1])
    p = subs.add_parser('assemble')
    p.add_argument('--work', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if args.mode == 'prepare':
        prepare(args.atom_root, args.work, args.max_rate)
    else:
        assemble(args.work, args.output)
