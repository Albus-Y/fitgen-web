"""调用服务器现有 xTW；发布紧凑时间映射，完整重采样结果用于独立核对。"""
from __future__ import annotations

import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import importlib
import json
from pathlib import Path
import subprocess
import sys


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n', encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--module-root', type=Path, required=True)
    parser.add_argument('--inputs', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = args.module_root.resolve()
    if args.output.exists():
        raise FileExistsError('输出目录已存在，请使用新目录。')
    sys.path.insert(0, str(root))
    import numpy as np
    import scipy
    import xtw
    from scipy.ndimage import gaussian_filter1d
    from scipy.signal import find_peaks
    from xtw import BeatDescriptorConfig, DropDTWConfig, TimeWarperConfig, retime_motion_to_music
    from xtw.time_warper import _load_official_gdtw

    package = json.loads((args.inputs / 'inputs.json').read_text(encoding='utf-8'))
    assert package['schema'] == 'pamela-xtw-inputs-v1'
    descriptor, drop, warper = BeatDescriptorConfig(), DropDTWConfig(), TimeWarperConfig()
    backend_fn = _load_official_gdtw()
    def review_beats(positions, fps):
        # 固定沿用已审查网页的 reflect 规则；不调用使用 nearest 的高层提取器。
        values = np.asarray(positions, dtype=np.float64)
        raw = np.linalg.norm(np.diff(values, axis=0), axis=-1).mean(axis=-1)
        signal = gaussian_filter1d(raw, sigma=5, mode='reflect')
        indices, _ = find_peaks(-signal, distance=int(np.ceil(.2 * fps)))
        return indices / fps
    source_files = {}
    for package_name in ('xtw', 'motion_beat_extractor'):
        for file in sorted((root / package_name).glob('*.py')):
            source_files[file.relative_to(root).as_posix()] = digest(file.read_bytes())
    backend_files = {}
    for module_name, module in sorted(sys.modules.copy().items()):
        if module_name.startswith('gdtw') and getattr(module, '__file__', None):
            file = Path(module.__file__)
            if file.is_file():
                backend_files[module_name + '/' + file.name] = digest(file.read_bytes())
    git = lambda *cmd: subprocess.check_output(['git', '-C', str(root), *cmd], text=True).strip()
    provenance = {
        'module': 'Module2_xtw', 'moduleVersion': xtw.__version__, 'method': 'anchor',
        'entryPoint': 'xtw.retime_motion_to_music',
        'gitHead': git('rev-parse', 'HEAD'), 'workingTree': git('status', '--short').splitlines(),
        'sourceSha256': source_files, 'backendSha256': backend_files,
        'backendFunction': backend_fn.__module__ + '.' + backend_fn.__name__,
        'python': sys.version.split()[0], 'numpy': np.__version__, 'scipy': scipy.__version__,
        'generatedAtUtc': datetime.now(timezone.utc).isoformat(),
        'runnerSha256': digest(Path(__file__).read_bytes()),
        'inputManifestSha256': digest((args.inputs / 'inputs.json').read_bytes()),
        'settings': {'descriptor': asdict(descriptor), 'drop': asdict(drop), 'warper': asdict(warper)},
        'reviewDetector': {'smoothingSigmaFrames': 5, 'boundaryMode': 'reflect', 'minIntervalSeconds': .2, 'note': '沿用已审查规则；服务器通用高层提取器为 nearest，本实验使用接收外部 beat 的低层 xTW 入口。'},
        'boundaryPolicy': '600 帧的最后姿态保持到 30 秒；额外重复末帧仅供接口定义 30 秒端点，输出仍为 600 帧。',
    }
    publish = args.output / 'publish'
    validation = args.output / 'validation'
    publish.mkdir(parents=True)
    validation.mkdir()
    clips, validation_rows = {}, []
    for item in package['cases']:
        data = (args.inputs / item['file']).read_bytes()
        assert digest(data) == item['inputSha256']
        source = np.frombuffer(data, dtype='<f4').reshape(item['frames'], item['joints'], 3)
        # 只重复最后姿态以明确末端保持；原 600 帧及传入事件完全不变。
        bounded = np.concatenate((source, source[-1:]), axis=0)
        assert abs((len(bounded) - 1) / item['fps'] - item['duration']) < 1e-10
        if item['beatMode'] == 'redetect':
            detected = review_beats(source, item['fps'])
            np.testing.assert_allclose(detected, item['inputBeats'], atol=1e-12, rtol=0)
        result = retime_motion_to_music(
            bounded, motion_fps=item['fps'], motion_beats=item['inputBeats'],
            music_beats=item['musicBeats'], music_duration=item['duration'], target_fps=item['fps'],
            descriptor_config=descriptor, drop_config=drop, time_warper_config=warper,
        )
        warp = result.time_warp
        assert np.isfinite(result.retimed_motion).all()
        assert result.retimed_motion.shape == source.shape
        assert (np.diff(warp.motion_times) > 0).all()
        assert np.all(warp.warp_rates >= warper.min_warp_rate - 5e-6)
        assert np.all(warp.warp_rates <= warper.max_warp_rate + 5e-6)
        np.testing.assert_allclose([warp.music_times[0], warp.motion_times[0], warp.music_times[-1], warp.motion_times[-1]], [0, 0, item['duration'], item['duration']], atol=1e-10)
        # Float32 转换与网页实际渲染一致；完整输出留在验证目录，不放入 Pages。
        poses = result.retimed_motion.astype('<f4')
        output_file = item['id'].replace('/', '-') + '.f32'
        poses.tofile(validation / output_file)
        detected = review_beats(poses, item['fps'])
        alignment = {
            'method': 'anchor', 'moduleVersion': xtw.__version__, 'backend': warp.backend,
            'outputTimes': warp.music_times.tolist(), 'inputTimes': warp.motion_times.tolist(),
            'referenceInputTimes': warp.reference_motion_times.tolist(),
            'matches': result.drop_dtw_result.matches,
            'anchorPairs': result.anchor_pairs.tolist(),
            'droppedMotionIndices': result.drop_dtw_result.dropped_motion_indices,
            'droppedMusicIndices': result.drop_dtw_result.dropped_music_indices,
            'resolvedDropCosts': [result.drop_dtw_result.motion_drop_cost, result.drop_dtw_result.music_drop_cost],
            'diagnostics': result.diagnostics,
        }
        row = {key: item[key] for key in ('id', 'clip', 'preset', 'beatMode', 'seed', 'frames', 'joints', 'fps', 'duration', 'inputSha256', 'originalSha256', 'inputBeats', 'musicBeats')}
        row.update(alignment=alignment, outputDetectedBeats=detected.tolist())
        clips.setdefault(item['clip'], []).append(row)
        validation_rows.append({'caseId': item['id'], 'file': output_file, 'sha256': digest(poses.tobytes()), 'maxAbsCoordinate': float(abs(poses).max())})
        print(json.dumps({'case': item['id'], 'matched': len(result.anchor_pairs), 'rate': [float(warp.warp_rates.min()), float(warp.warp_rates.max())]}, ensure_ascii=False), flush=True)
    manifest = {'schema': 'pamela-server-xtw-v1', 'seed': package['seed'], 'caseCount': len(package['cases']), 'provenance': provenance, 'clips': []}
    for clip, cases in clips.items():
        filename = clip + '.json'
        write_json(publish / filename, {'schema': manifest['schema'], 'clip': clip, 'cases': cases})
        manifest['clips'].append({'id': clip, 'file': filename, 'sha256': digest((publish / filename).read_bytes()), 'caseCount': len(cases)})
    write_json(publish / 'manifest.json', manifest)
    write_json(validation / 'manifest.json', {'cases': validation_rows})
    print(json.dumps({'completed': len(package['cases']), 'publishBytes': sum(p.stat().st_size for p in publish.iterdir()), 'output': str(args.output)}), flush=True)


if __name__ == '__main__':
    main()
