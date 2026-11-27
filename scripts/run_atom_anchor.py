"""在已有 Module2_xtw 环境中将一个原子动作的整数轮映射到一个完整八拍。"""
import argparse
from dataclasses import asdict
import hashlib
import json
from pathlib import Path
import subprocess
import sys

import numpy as np


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inputs', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--module-root', required=True, type=Path)
    parser.add_argument('--adapter-dir', required=True, type=Path)
    parser.add_argument('--atoms', required=True, nargs=3, type=Path,
                        help='慢速深蹲、开合跳、俯身触地跳的原子 GLB，按此顺序。')
    args = parser.parse_args()
    module = args.module_root.resolve()
    sys.path[:0] = [str(args.adapter_dir.resolve()), str(module)]
    from glb_to_module2_skel import GLB, BODY_NODES, BODY_PARENTS
    from xtw import BeatDescriptorConfig, DropDTWConfig, TimeWarperConfig, retime_motion_to_music
    from xtw.time_warper import _load_official_gdtw
    import scipy
    import xtw

    inputs = json.loads(args.inputs.read_text(encoding='utf-8'))
    assert inputs['schema'] == 'fitgen-atom-inputs-v1' and len(inputs['clips']) == 3
    args.output.mkdir(parents=True, exist_ok=False)
    backend = _load_official_gdtw()
    slow, fast = inputs.get('rateBounds', (.8, 1.5))
    config = TimeWarperConfig(min_warp_rate=slow, max_warp_rate=fast)
    descriptor, drop = BeatDescriptorConfig(), DropDTWConfig()
    sources = {p.name: digest(p) for p in sorted((module / 'xtw').glob('*.py'))}
    backend_files = {name: digest(Path(mod.__file__)) for name, mod in list(sys.modules.items())
                     if name.startswith('gdtw') and getattr(mod, '__file__', None)}
    report = {'provenance': {
        'entryPoint': 'xtw.retime_motion_to_music', 'method': 'anchor', 'version': xtw.__version__,
        'gitHead': subprocess.check_output(['git', '-C', str(module), 'rev-parse', 'HEAD'], text=True).strip(),
        'sourceSha256': sources, 'backendSha256': backend_files, 'backendFunction': backend.__module__ + '.' + backend.__name__,
        'runnerSha256': digest(Path(__file__)), 'adapterSha256': digest(args.adapter_dir / 'glb_to_module2_skel.py'),
        'inputSha256': digest(args.inputs), 'python': sys.version.split()[0], 'numpy': np.__version__,
        'scipy': scipy.__version__, 'descriptor': asdict(descriptor), 'drop': asdict(drop), 'warper': asdict(config),
    }, 'clips': {}}
    for meta, path in zip(inputs['clips'], args.atoms):
        clip = meta['id']
        glb = GLB(path)
        assert glb.sha256 == meta['glbSha256'], 'GLB 与指定的 WSL 原子动作不一致'
        times, world, parents = glb.keyframe_world()
        names = [node.get('name') for node in glb.g['nodes']]
        assert all(names.count(name) == 1 for name in BODY_NODES)
        joints = np.array([names.index(name) for name in BODY_NODES])
        assert all(parents[joints[j]] == joints[p] for j, p in enumerate(BODY_PARENTS) if p >= 0)
        atom = world[:, joints][:, :, :3, 3].astype('<f4')
        frames, fps = meta['frames'], meta['fps']
        assert atom.shape == (frames + 1, 22, 3) and np.isfinite(atom).all()
        np.testing.assert_allclose(times, np.arange(frames + 1) / fps, rtol=0, atol=2e-6)
        atom_file = args.output / (clip + '.f32')
        atom.tofile(atom_file)
        # 下一轮第 0 帧承接水平根位移。末端关键帧给出位移和周期，不重复计帧。
        delta = (atom[-1, 0] - atom[0, 0]).astype(float)
        delta[1] = 0
        row = {'atomSha256': digest(atom_file), 'parents': BODY_PARENTS.tolist(), 'candidates': []}
        edges = meta['referenceEdges']
        for repeats in meta['repeats']:
            poses = np.concatenate([atom[:-1] + k * delta for k in range(repeats)]
                                   + [atom[:1] + repeats * delta])
            events = [k * meta['period'] + event for k in range(repeats) for event in meta['events']]
            result = retime_motion_to_music(
                poses, motion_fps=fps, motion_beats=events, music_beats=edges,
                music_duration=edges[-1], target_fps=fps, descriptor_config=descriptor,
                drop_config=drop, time_warper_config=config)
            warp = result.time_warp
            check_file = args.output / f'{clip}-{repeats}-anchor.f32'
            result.retimed_motion.astype('<f4').tofile(check_file)
            row['candidates'].append({
                'repeats': repeats, 'musicTimes': warp.music_times.tolist(), 'sourceTimes': warp.motion_times.tolist(),
                'diagnostics': {'backend': warp.backend, 'anchorPairs': result.anchor_pairs.tolist(),
                                'matches': result.drop_dtw_result.matches, 'solver': result.diagnostics},
                'validationSha256': digest(check_file),
            })
        report['clips'][clip] = row
    (args.output / 'anchor.json').write_text(json.dumps(report, ensure_ascii=False, allow_nan=False), encoding='utf-8')
    print('服务器 Anchor xTW 完成', sum(len(row['candidates']) for row in report['clips'].values()), '个候选')


if __name__ == '__main__':
    main()
