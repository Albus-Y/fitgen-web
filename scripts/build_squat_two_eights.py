"""用 Module2_xtw 为慢速深蹲生成双八拍演示，复用已有的音乐网格与原子骨架。"""
import argparse
from dataclasses import asdict
import math
from pathlib import Path
import sys

import numpy as np

from build_pamela_eight_count import (
    beat_edges, detect, events_in, load, mapping, partial_edges, sample_atom,
    save, select, sha, stats, transfer,
)


def music_windows(track):
    blocks = track['blocks']
    i = 0
    while i < len(blocks):
        first = last = blocks[i]
        if first['is_complete'] and i + 1 < len(blocks) and blocks[i + 1]['is_complete']:
            last = blocks[i + 1]
            assert last['start_time_sec'] == first['end_time_sec']
            assert last['start_beat_index'] == first['start_beat_index'] + 8
        members = [first] if first is last else [first, last]
        edges = None
        if first['is_complete']:
            edges = beat_edges(track, first)
            if first is not last:
                edges = np.round(np.r_[edges, edges[-1] + beat_edges(track, last)[1:]], 10)
        yield members, edges
        i += len(members)


def feasible(duration, period, bounds):
    return range(max(1, math.ceil(bounds[0] * duration / period - 1e-9)),
                 math.floor(bounds[1] * duration / period + 1e-9) + 1)


def solve(meta, atom, edges, n, config, validation_file):
    from xtw import retime_motion_to_music

    period, fps = meta['period'], meta['fps']
    delta = (atom[-1, 0] - atom[0, 0]).astype(float)
    delta[1] = 0
    poses = np.concatenate([atom[:-1] + i * delta for i in range(n)] + [atom[:1] + n * delta])
    events = [i * period + e for i in range(n) for e in meta['events']]
    result = retime_motion_to_music(poses, motion_fps=fps, motion_beats=events, music_beats=edges,
                                    music_duration=float(edges[-1]), target_fps=fps, time_warper_config=config)
    raw = result.time_warp
    warp = mapping(raw.music_times, raw.motion_times, (config.min_warp_rate, config.max_warp_rate))
    np.testing.assert_allclose([warp['musicTimes'][0], warp['musicTimes'][-1],
                                warp['sourceTimes'][0], warp['sourceTimes'][-1]],
                               [0, edges[-1], 0, n * period], atol=1e-8, rtol=0)
    times = np.arange(len(result.retimed_motion)) / fps
    expected = sample_atom(atom, np.interp(times, warp['musicTimes'], warp['sourceTimes']), meta)
    np.testing.assert_allclose(expected, result.retimed_motion, rtol=0, atol=2e-6)
    result.retimed_motion.astype('<f4').tofile(validation_file)
    scheduled = []
    for t in events_in(warp, period, meta['events']):
        j = int(np.argmin(abs(edges - t)))
        scheduled.append({'musicTime': float(t), 'edgeIndex': j, 'offsetMs': float(1000 * (t - edges[j]))})
    return {**warp, 'method': 'anchor', 'repeats': n, 'stats': stats(warp, meta, edges),
            'scheduledEvents': scheduled, 'diagnostics': {'backend': raw.backend,
            'anchorPairs': result.anchor_pairs.tolist(), 'validationSha256': sha(validation_file)}}


def profile(track, meta, atom, bounds, output):
    from xtw import TimeWarperConfig

    config = TimeWarperConfig(min_warp_rate=bounds[0], max_warp_rate=bounds[1])
    windows = list(music_windows(track))
    reference, ref_edges = next((members[0], edges) for members, edges in windows if len(members) == 2)
    period = meta['period']

    def run(block, edges, repeats):
        file = output / f'{bounds[1]}-{block["block_id"]}-{repeats}-anchor.f32'
        return solve(meta, atom, edges, repeats, config, file)

    candidates = [run(reference, ref_edges, n) for n in feasible(ref_edges[-1], period, bounds)]
    winner = select(candidates)
    rows = []
    ends = {'original': 0., 'anchor': 0.}
    after_excerpt = False
    for members, edges in windows:
        first, last = members[0], members[-1]
        start, end = first['start_time_sec'], last['end_time_sec']
        length = round(end - start, 10)
        full = first['is_complete']
        chosen = None
        repeats = None
        if len(members) == 2:
            strategy = 'pair'
            repeats = winner['repeats']
            if repeats not in feasible(length, period, bounds):
                raise ValueError(f"{first['block_id']} 的两个八拍放不下参考轮数")
            if first is reference:
                chosen = winner
        elif full:
            options = [run(first, edges, n) for n in feasible(length, period, bounds)]
            chosen = select(options) if options else None
            strategy = 'single' if chosen else 'excerpt'
            if chosen:
                repeats = chosen['repeats']
        else:
            strategy = 'partial'

        original = mapping([0, length], [0, length], bounds)
        if chosen:
            anchor = {k: chosen[k] for k in ('musicTimes', 'sourceTimes')}
        elif strategy == 'pair':
            anchor = transfer(winner, edges, ref_edges, bounds)
            np.testing.assert_allclose(anchor['sourceTimes'][-1] - anchor['sourceTimes'][0],
                                       repeats * period, atol=1e-8, rtol=0)
        elif full:
            anchor = transfer(winner, edges, ref_edges[:9], bounds)
        else:
            # 段首衔接模板末端；第七组用了前八拍时，段尾继续用后八拍的相位。
            half = ref_edges[8:] if first['block_type'] == 'partial_head' or after_excerpt else ref_edges[:9]
            targets = partial_edges(track, first, half - half[0])
            anchor = transfer(winner, targets[0], targets[1] + half[0], bounds) if targets else original
        after_excerpt = strategy == 'excerpt'
        reset = bool(full and rows and not rows[-1]['full'])
        row = {'id': first['block_id'], 'blockIds': [b['block_id'] for b in members], 'start': start,
               'end': end, 'full': full, 'reset': reset, 'strategy': strategy, 'maps': {},
               'anchorRepeats': repeats}
        if chosen:
            row['diagnostics'] = chosen['diagnostics']
        for method, warp in [('original', original), ('anchor', anchor)]:
            s = np.asarray(warp['sourceTimes'])
            offset = s[0] if not rows else (0. if reset else ends[method])
            row['maps'][method] = {**warp, 'sourceTimes': np.round(offset + (s - s[0]), 12).tolist()}
            ends[method] = row['maps'][method]['sourceTimes'][-1]
        rows.append(row)

    detected = {}
    clock = np.arange(round(meta['duration'] * meta['fps'])) / meta['fps']
    for method in ends:
        source = np.full(len(clock), np.nan)
        for row in rows:
            mask = (clock >= row['start'] - 1e-10) & (clock < row['end'] - 1e-10)
            w = row['maps'][method]
            source[mask] = np.interp(clock[mask] - row['start'], w['musicTimes'], w['sourceTimes'])
        assert np.isfinite(source).all()
        poses = sample_atom(atom, source, meta)
        poses.tofile(output / f'{bounds[1]}-{method}.f32')
        detected[method] = detect(poses, meta['fps']).tolist()
    return {'schema': 'fitgen-atomic-eight-v1', 'id': meta['id'], 'windowBeats': 16, 'rateBounds': bounds,
            'referenceId': reference['block_id'], 'referenceEdges': ref_edges.tolist(), 'candidates': candidates,
            'selected': {'anchor': winner['repeats']}, 'blocks': rows, 'detected': detected, 'warper': asdict(config)}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ('music', 'manifest', 'atom', 'module-root', 'output'):
        p.add_argument('--' + name, required=True, type=Path)
    args = p.parse_args()
    sys.path.insert(0, str(args.module_root.resolve()))
    import xtw

    manifest = load(args.manifest)
    helper_sha = sha(Path(__file__).with_name('build_pamela_eight_count.py'))
    assert helper_sha == manifest['builderSha256']
    meta = next(c for c in manifest['clips'] if c['id'] == 'slow_squat')
    assert sha(args.atom) == meta['atomSha256'] and sha(args.music) == manifest['musicSha256']
    for name, digest in manifest['anchor']['sourceSha256'].items():
        assert sha(args.module_root / 'xtw' / name) == digest
    track = next(c for c in load(args.music)['clips'] if c['id'] == meta['id'])
    atom = np.fromfile(args.atom, dtype='<f4').reshape(meta['frames'] + 1, 22, 3)
    args.output.mkdir(parents=True, exist_ok=False)
    result = {'schema': 'fitgen-squat-two-eights-v1', 'id': meta['id'], 'atomSha256': meta['atomSha256'],
              'musicSha256': manifest['musicSha256'], 'solverVersion': xtw.__version__,
              'entryPoint': 'xtw.retime_motion_to_music', 'sourceSha256': manifest['anchor']['sourceSha256'],
              'builderSha256': sha(Path(__file__)), 'templateBuilderSha256': helper_sha, 'profiles': {}}
    for cap in (1.2, 1.5):
        result['profiles'][str(cap)] = profile(track, meta, atom, (.8, cap), args.output)
    save(args.output / 'slow_squat-16.json', result)


if __name__ == '__main__':
    main()
