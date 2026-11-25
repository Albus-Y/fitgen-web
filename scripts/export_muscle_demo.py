"""从 WSL Studio 的只读归档生成 FitGen 的五动作静态回放包。"""
import argparse
import gzip
import hashlib
import json
import shutil
import struct
import sys
from pathlib import Path

import mujoco as mj
import numpy as np

CLIPS = [
    ("squat", "反复深蹲", "breath-by-breath__zy_HIIT_x_back_0040-0050"),
    ("high-knees", "高抬腿", "mixing-chamber__jl_HIIT_x_front_0030-0040"),
    ("split-squat", "前后分腿屈膝", "breath-by-breath__zy_HIIT_x_right_0940-0950"),
    ("arm-swings", "站姿摆臂", "mixing-chamber__jl_HIIT_x_front_1400-1410"),
    ("floor-transition", "低姿俯撑转换", "breath-by-breath__zy_HIIT_x_right_1120-1130"),
]
POLICIES = {
    "equal": ("纯 CLIP 加宽 · 等权约束 · 50,000 轮", "equal_50000"),
    "pure": ("纯 CLIP 加宽 · 质量加权 · 93,000 轮", "mass_93000"),
    "wide": ("混合加宽 · 质量加权 · 29,000 轮", "mixed_29000"),
}
MODEL_SHA = "16eeffde0b3a28105512c9eb5a3df79f8e7272d33420cbde14a9296b78e0920f"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pack(folder, name, meta, arrays):
    """头部记录每个数组的类型、形状及对齐偏移，包按需分片。"""
    payload = bytearray()
    layout = {}
    for key, arr in arrays.items():
        arr = np.ascontiguousarray(arr)
        payload.extend(bytes((-len(payload)) % 4))
        layout[key] = dict(dtype=arr.dtype.name, shape=arr.shape, offset=len(payload))
        payload.extend(arr.tobytes())
    header = json.dumps(dict(meta=meta, arrays=layout), ensure_ascii=False).encode()
    header += b" " * ((-len(header)) % 4)
    raw = gzip.compress(struct.pack("<I", len(header)) + header + payload, compresslevel=5, mtime=0)
    files = []
    size = 3 * 1024 * 1024
    for i in range(0, len(raw), size):
        filename = f"{name}.{i // size}.bin"
        (folder / filename).write_bytes(raw[i:i+size])
        files.append(filename)
    return files


def model_mesh(model):
    vertices, normals, bodies, faces = [], [], [], []
    offset = 0
    for i in np.flatnonzero((model.geom_group == 0) & (model.geom_type == mj.mjtGeom.mjGEOM_MESH)):
        mesh_id = model.geom_dataid[i]
        v0, nv = model.mesh_vertadr[mesh_id], model.mesh_vertnum[mesh_id]
        f0, nf = model.mesh_faceadr[mesh_id], model.mesh_facenum[mesh_id]
        v = model.mesh_vert[v0:v0+nv].astype(float)
        rot = np.empty(9)
        mj.mju_quat2Mat(rot, model.geom_quat[i])
        v = v @ rot.reshape(3, 3).T + model.geom_pos[i]
        # 2 mm 网格合并，仅用于网页显示。
        _, inv = np.unique(np.rint(v * 500).astype(int), axis=0, return_inverse=True)
        inv = inv.reshape(-1)
        counts = np.bincount(inv)
        v = np.column_stack([np.bincount(inv, weights=axis) / counts for axis in v.T])
        f = inv[model.mesh_face[f0:f0+nf]].reshape(-1, 3)
        f = f[(f[:,0] != f[:,1]) & (f[:,1] != f[:,2]) & (f[:,2] != f[:,0])]
        n = np.zeros_like(v)
        fn = np.cross(v[f[:,1]]-v[f[:,0]], v[f[:,2]]-v[f[:,0]])
        for corner in f.T:
            np.add.at(n, corner, fn)
        n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
        vertices.append(v); normals.append(n); faces.append(f+offset)
        bodies.append(np.full(len(v), model.geom_bodyid[i]))
        offset += len(v)
    return dict(vertex=np.concatenate(vertices).astype("<f4"), normal=np.rint(np.concatenate(normals)*127).astype("i1"),
                body=np.concatenate(bodies).astype("u1"), face=np.concatenate(faces).astype("<u4"))


def quantize(values, scale):
    x = np.rint(values * scale)
    if not np.isfinite(x).all() or np.max(np.abs(x)) > 32767:
        raise ValueError("显示数据超出量化范围")
    return x.astype("<i2")


def delta(arr):
    out = arr.copy()
    out[1:] = arr[1:] - arr[:-1]
    return out


def sample(model, bundle, tendon_ids, capacity, lower_ids, body_ids, origin, tracking):
    from muscle_panel import active_tendon_tension
    n = len(bundle["qpos"])
    points = np.repeat(np.arange(len(capacity)), capacity)
    local = np.arange(len(points)) - np.repeat(np.cumsum(capacity)-capacity, capacity)
    tendons = tendon_ids[points]
    pose = np.empty((n,model.nbody,7), "<i2")
    path = np.empty((n,len(points),3), "<i2")
    ref_points = bundle["ref"]
    arrays = {}
    if tracking:
        ranks = np.full((n,2,5),-1,"<i2")
        values = np.zeros((n,2,5,4),"<f4")
        err = np.zeros(n,"<f4")
    d = mj.MjData(model)
    for i, q in enumerate(bundle["qpos"]):
        d.qpos[:] = q
        mj.mj_fwdPosition(model,d)
        pose[i,:,:3] = quantize(d.xpos-origin,2000)
        pose[i,:,3:] = quantize(d.xquat,32767)
        counts = d.ten_wrapnum[tendon_ids]
        if np.any(counts > capacity) or np.any(counts < 2):
            raise ValueError("肌束路径与模型不一致")
        idx = d.ten_wrapadr[tendons] + np.minimum(local, counts[points]-1)
        path[i] = quantize(d.wrap_xpos.reshape(-1,3)[idx]-origin,2000)
        if tracking:
            d.qvel[:] = bundle["qvel"][i]
            d.act[:] = bundle["act"][i]
            mj.mj_fwdVelocity(model,d)
            force = active_tendon_tension(model,d)
            act = d.act[model.actuator_actadr]
            selected = lower_ids[force[lower_ids] > 1e-6]
            groups = [np.argsort(-act,kind="stable")[:5],
                      selected[np.argsort(-force[selected],kind="stable")[:5]]]
            for mode, ids in enumerate(groups):
                ranks[i,mode,:len(ids)] = ids
                v = d.actuator_velocity[ids]
                values[i,mode,:len(ids)] = np.column_stack([act[ids],v,force[ids],-force[ids]*v])
            err[i] = np.linalg.norm(d.xpos[body_ids]-ref_points[i],axis=1).mean()*100
    arrays.update(pose=delta(pose), path=delta(path), reference=delta(quantize(ref_points-origin,2000)))
    if tracking:
        arrays.update(ranks=ranks,values=values,error=err)
    return arrays


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    for key in ("project","archive","capture","output"):
        cli.add_argument("--"+key,type=Path,required=True)
    args=cli.parse_args()
    folder=args.output.resolve()
    folder.mkdir(parents=True,exist_ok=True)
    src=args.project/"experiments/energy_evaluation/clip_energy_hiit_wsl_20261109_v1"
    sys.path.insert(0,str(args.project/"local_viewer/code"))
    from reference_preview import build_preview
    from muscle_panel import TopMuscleHighlight, chinese_muscle_name
    from energyc.muscle_labeling.scoring import score_trajectory
    modelpath=args.archive/"models"/(MODEL_SHA+".mjb")
    assert digest(modelpath)==MODEL_SHA
    model=mj.MjModel.from_binary_path(str(modelpath))
    tids=model.actuator_trnid[:,0]
    lower_ids=TopMuscleHighlight(model).lower_actuator_ids
    caps=[]
    muscles=[]
    for i,t in enumerate(tids):
        wraps=model.wrap_type[model.tendon_adr[t]:model.tendon_adr[t]+model.tendon_num[t]]
        caps.append(int(len(wraps)+np.sum(wraps!=mj.mjtWrap.mjWRAP_SITE)))
        name=model.actuator(i).name
        muscles.append(dict(name=name.removeprefix("robot/"),zh=chinese_muscle_name(name),lower=bool(i in lower_ids),
                            capacity=caps[-1],radius=float(model.tendon_width[t])))
    model_info=dict(muscles=muscles,bodies=model.nbody,sha256=MODEL_SHA)
    index=dict(model=pack(folder,"model",model_info,model_mesh(model)),clips=[])
    cfg=json.loads((args.capture/"experiment_config.json").read_text())
    attempt=args.capture/"evaluations/attempt_03"
    identity=json.loads((attempt/"identities.json").read_text())
    assert identity["model_sha256"]==MODEL_SHA
    assert identity["actuator_names"]==[model.actuator(i).name for i in range(model.nu)]
    assert identity["activation_addresses"]==model.actuator_actadr.tolist()
    for slug,label,clip in CLIPS:
        source=src/"data/motions"/(clip+".npz")
        refsha=digest(source)
        archive_ref=args.archive/"references"/(refsha+".npz")
        assert digest(archive_ref)==refsha
        preview=build_preview(archive_ref,model)
        n=len(preview["qpos"])
        origin=np.array([*preview["ref"][0,0,:2],0.])
        ids=preview["body_ids"]
        meta=dict(frames=n,hz=100,referenceSha=refsha)
        data=sample(model,preview,tids,np.array(caps),lower_ids,ids,origin,False)
        row=dict(id=slug,label=label,clip=clip,reference=pack(folder,slug+"-ref",meta,data),results=[])
        selection=next(c for c in cfg["clips"] if c["id"]==clip)
        assert selection["sha256"]==refsha
        wsl_run=args.archive/selection["previous_wide29000_run"]
        wsl_manifest=json.loads((wsl_run/"manifest.json").read_text())
        assert wsl_manifest["reference_sha256"]==refsha and digest(wsl_run/"tracking.npz")==wsl_manifest["tracking_sha256"]
        with np.load(wsl_run/"tracking.npz") as z:
            reference=z["reference_body_positions_m"]
            assert list(ids)==[model.body("robot/"+str(name)).id for name in z["body_names"]]
        for key,(cp_label,policy) in POLICIES.items():
            stage=attempt/policy
            receipt=json.loads((stage/"receipt.json").read_text())
            result=json.loads((stage/"v3/result.json").read_text())
            cp_sha=cfg["policies"][policy]["sha256"]
            assert cp_sha==receipt["checkpoint_sha256"]==result["checkpoint_sha256"]
            record=next(x for x in receipt["records"] if x["id"]==clip)
            f=stage/(clip+".npz")
            assert digest(f)==record["sha256"]
            with np.load(f) as z:
                bundle={k:z[k] for k in ("act","qpos","qvel")}
                times=z["post_step_time_s"]
            frames=len(times)
            assert record["frames"]==frames and np.allclose(times,np.arange(1,frames+1)/100)
            bundle["ref"]=reference[1:frames+1]
            data=sample(model,bundle,tids,np.array(caps),lower_ids,ids,origin,True)
            with np.load(stage/"v3/tracking_curves.npz") as curves:
                curve=curves["mean17_original_world_m"][curves["clip_names"].tolist().index(clip),:frames]
                assert np.allclose(data["error"]/100,curve,atol=0.0001),clip
            scores=score_trajectory(model,{**bundle,"time_s":times},top_k=5)
            evaluation=next(x for x in result["per_clip"] if x["clip_id"]==clip)
            stats=dict(score=scores["top"],scoreHz=100,fall=evaluation["actual_fall_s"],
                       noFall=evaluation["physical_complete_without_fall"],trackingPass=evaluation["common_tracking_pass"])
            trackmeta=dict(frames=frames,hz=100,start=.01,referenceSha=refsha,**stats,
                           checkpointSha=cp_sha,sourceSha=record["sha256"],sourceExperiment=args.capture.name,
                           policy=policy,attempt="attempt_03")
            row["results"].append(dict(id=policy,label=cp_label,files=pack(folder,slug+"-"+key,trackmeta,data)))
        index["clips"].append(row)
        print(slug,n,flush=True)
    (folder/"catalog.json").write_text(json.dumps(index,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    import importlib.metadata as metadata
    package=metadata.distribution("musclemimic-models")
    for name in ["LICENSE","NOTICE"]:
        candidate=next(f for f in package.files if f.name==name and "licenses" in f.parts)
        shutil.copyfile(package.locate_file(candidate),folder.parent/name)


if __name__=="__main__":
    main()
