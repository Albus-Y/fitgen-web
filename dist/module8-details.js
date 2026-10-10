// 第一层依据用户提供的研究方案；服务器实现将在核对后补充到 detailSections。
Object.assign(window.FITGEN_MODULES.find(m => m.id === 8), {
  demoUrl: 'energy-demo/index.html',
  demoTitle: 'Stage B · SMPL 与物理跟踪对比 Demo',
  demoDescription: '播放已生成的 Kyra Bad Energy 对比视频，查看原始 SMPL-X 动作与物理跟踪结果。',
  overviewMeta: '三阶段研究路线 · A 必做基线 → B 主研究路线 → C 长期机理目标',
  overviewSections: [
    {
      title: 'Stage A · Pose-only：动作直接预测能耗（规划）',
      paragraphs: [
        'SMPL 动作转换为三维关节轨迹，使用 Pose2Met / STAPFormer 风格的时序网络预测能耗。作为必要基线，先回答“仅看动作能预测多少能量消耗”。',
        '输出能耗率与整段总能耗；优先迁移到 E3V-K5，以 Vid2Burn 复现已有基准。此阶段尚未显式建模力矩、接触或肌肉状态。'
      ],
      code: 'SMPL → 3D joints → Pose-only 时序网络 → 能耗率 / 总能耗'
    },
    {
      title: 'Stage B · Physics-aware：加入动力学信息（当前推进）',
      paragraphs: [
        '主研究路线；当前已完成物理跟踪与原生动力学导出，能耗回归部分待接入。用 ProtoMotions（首选）或 PHC 跟踪动作，提取关节位置、速度、力矩和接触力，再把关节功率 $P_j(t)=\\tau_j(t)\\dot q_j(t)$ 等物理特征输入能耗预测器。',
        '在相同数据与划分下比较 Pose → 加力矩 → 加功率 → 加接触的增益。机械功率作为预测特征，不能直接当作人体代谢能耗。'
      ],
      code: 'SMPL → Physics tracking → 力矩 / 功率 / 接触特征 → EE 预测器 → 能耗率 / 总能耗'
    },
    {
      title: 'Stage C · Physics + Muscle：追溯肌肉代谢（长期目标）',
      paragraphs: [
        '长期目标。在动力学基础上引入 SOMA 肌肉几何，通过肌骨求解器估计激活、肌力、长度与收缩速度，再接 Bhargava / Umberger 代谢模型，得到肌肉级能耗及其汇总。',
        'SOMA 提供几何，肌肉激活与肌力仍需另行求解。先在 B 稳定后推进，最终支撑团操总能耗与各肌群能耗的解释。'
      ],
      code: 'Physics + SOMA 肌肉几何 → 肌肉状态求解 → 代谢功率 → 总能耗 / 各肌群能耗'
    }
  ],
  detailMeta: 'Stage B 实现核对 · /opt/data/private/PrtoMotions · 2026-10-10',
  detailSections: []
});
Object.assign(window.FITGEN_MODULES.find(m => m.id === 8), {
  implementation: [
    '当前交付链路：PromptHMR SMPL-X → 30 FPS 连续片段 → 固定 SMPL rig / MotionLib → 官方预训练 tracker → IsaacLab / PhysX → 原生动力学张量。',
    '研究方案给出 A/B/C 的递进目标；服务器当前完成的是 Stage B 的物理数据提取部分。尚未发现已实现的 kcal 回归器、数据库能量标注或各肌群能耗输出。'
  ],
  technicalDetails: [
    '下方按实际源码、现有 manifest 与产物组织说明。路线图卡片上的数据库标签、总能耗和各肌群能耗是模块目标，不代表当前服务器已经输出这些结果。',
    '本次只读核对服务器源码并复用现有环境做 CPU 验证，不修改环境、不训练 tracker、不重跑 GPU 仿真。'
  ],
  detailSections: [
    {
      title: '01 · 研究方案与当前交付边界',
      paragraphs: [
        '第一层三个 stage 依据用户提供的《能量计算方案.md》：A 是必要基线，B 是主研究路线，C 是肌肉机理目标。文档中的引用标记未包含可解析的来源链接，本页不把它们当作已核验的参考文献。',
        '服务器当前具备动作转换、物理跟踪、120 Hz 原生动力学导出和同步对比视频；功率、加速度特征以及 dynamics → metabolism 监督回归尚未接入当前导出链路。A 的 pose-only 训练与 C 的肌肉求解也不列为当前成果。'
      ],
      table: {headers: ['步骤', '当前状态'], rows: [
        ['SMPL-X / MotionLib / 官方 tracker / PhysX', '已有完整 Kyra 样例与产物'],
        ['角度、角速度、施加力矩、接触等原生状态', '19 个时间对齐字段，120 Hz'],
        ['关节功率、加速度、EE 预测器与 K5 监督', '研究方案中的下一步，当前未完成'],
        ['总 kcal、数据库能量标签、肌群能耗', '模块目标；现有物理导出不是这些结果']
      ]},
      sources: ['能量计算方案.md：三阶段路线与 M1–M5', 'AGENTS.md：Capture Interfaces / Native Dynamics', 'protomotions/utils/native_dynamics_capture.py']
    },
    {
      title: '02 · 输入动作与 30 FPS 连续片段',
      paragraphs: [
        'prepare_results_comparison.py 读取可信 PromptHMR results.pkl 中 source_fps、people[track_id].frames 与 smplx_world 的 pose / trans / shape。姿态要求 $[T,165]$、平移 $[T,3]$，帧索引必须严格递增；检查非有限值。',
        '按源帧缺口拆分观测区间，每段单独重采样到 30 FPS。局部旋转沿 SO(3) 最短弧插值，平移和体型系数线性插值；不跨缺口插值。完整视频时间轴保留缺失帧并标记，物理数据只覆盖观测区间。',
        '单条 NPZ 转换入口 prepare_prompthmr_smpl.py 要求连续帧、均匀时间戳与整数 FPS；长序列 results.pkl 入口可先把非整数源帧率映射到 30 FPS，两者输入契约不能混用。'
      ],
      sources: ['data/scripts/prepare_results_comparison.py:prepare / resample_rotations', 'data/scripts/prepare_prompthmr_smpl.py']
    },
    {
      title: '03 · SMPL-X 到固定 SMPL 物理骨架',
      paragraphs: [
        '从 PromptHMR 的 Y-up 坐标绕 X 轴旋转 $90^\\circ$ 到右手 Z-up；每个观测区间减去恒定水平原点，并执行固定的区间高度校正。',
        '物理侧使用官方 SMPL rig：24 个刚体、69 个旋转 DOF。复用 SMPL-X 前 22 个共享关节，两个末端 SMPL 手关节旋转设零；源 betas 不改变物理机器人。原始 SMPL-X 网格的体型与固定机器人存在差异。',
        '转换器生成 .motion，motions.yaml 列举分段，MotionLib 将它们打包为 motions.pt。输入是关节旋转与根平移，并非将任意 XYZ 骨架直接传入现有 tracker。'
      ],
      sources: ['data/scripts/prepare_results_comparison.py', 'data/scripts/convert_amass_to_proto.py', 'protomotions/components/motion_lib.py', 'protomotions/data/assets/mjcf/smpl_humanoid.xml']
    },
    {
      title: '04 · 预训练 tracker 与逐物理步采样',
      paragraphs: [
        '使用 data/pretrained_models/motion_tracker/smpl/last.ckpt 及相邻冻结推理配置，本流程没有重新训练 tracker。策略在 30 Hz 跟踪 MotionLib 参考动作，IsaacLab / PhysX 以 120 Hz 推进，每个策略步含 4 个物理子步。',
        'IsaacLab 的 _physics_step 在每个子步执行控制、仿真和 scene.update，再调用 _native_dynamics_callback。capture_native_dynamics 随后读取状态，并在同一 time_s 查询参考状态；保存的是物理步后的数据。',
        'raw capture 只允许 IsaacLab、单环境和指定 motion_id。长时间序列以整数策略帧重新设置 motion_times，避免浮点累积漂移；忽略结束前预期的一步超前完成通知，保证完整覆盖。'
      ],
      sources: ['protomotions/inference_agent.py', 'protomotions/simulator/isaaclab/simulator.py:_physics_step', 'protomotions/utils/native_dynamics_capture.py']
    },
    {
      title: '05 · 原生动力学输出：19 个对齐字段',
      paragraphs: [
        '每段 .pt 保存张量与 metadata，schema 为 protomotions.native_dynamics.v1。所有张量沿同一采样轴 $N$ 对齐；metadata 包含 DOF / body 名称、单位、坐标、FPS、参考来源、checkpoint、失败与恢复索引。',
        '四元数顺序为 xyzw，位置和力采用世界坐标。输出先写 .partial 再替换为最终 .pt；目标或 partial 已存在则拒绝覆盖。下表覆盖全部 19 个原生字段。'
      ],
      table: {headers: ['字段组', '形状', '含义 / 单位'], rows: [
        ['dof_pos / dof_vel / dof_forces（3）', '$[N,69]$', '角度 rad / 角速度 rad/s / 施加力矩 N·m'],
        ['rigid_body_pos / vel / ang_vel（3）', '$[N,24,3]$', '刚体位置 m / 线速度 m/s / 角速度 rad/s'],
        ['rigid_body_rot（1）', '$[N,24,4]$', '刚体四元数 xyzw'],
        ['rigid_body_contacts / contact_forces（2）', '$[N,24]$ / $[N,24,3]$', '接触标志 / 接触传感器净力 N'],
        ['root_pos / rot / vel / ang_vel（4）', '$[N,3]$ / $[N,4]$ / $[N,3]$ / $[N,3]$', '根位置、四元数、线速度与角速度'],
        ['reference_dof_pos / rigid_body_pos / rigid_body_rot（3）', '$[N,69]$ / $[N,24,3]$ / $[N,24,4]$', '同一时间的 MotionLib 参考状态'],
        ['reference_root_pos / reference_root_rot（2）', '$[N,3]$ / $[N,4]$', '参考根位姿'],
        ['time_s（1）', '$[N]$', '片段内物理时间，秒']
      ]},
      sources: ['protomotions/utils/native_dynamics_capture.py:fields / metadata', '.cache/kyra_bad_energy/native_dynamics/manifest.json']
    },
    {
      title: '06 · 时间映射、缺失区间与恢复重置',
      paragraphs: [
        '每段首个样本在 $1/120\\,\\mathrm{s}$，不计时刻零的 reset 状态。$N_{\\mathrm{physics}}=4(N_{\\mathrm{motion}}-1)$。全视频时间为片段内 time_s 加 manifest 中 timeline_start_s；三个片段分别独立初始化。',
        '结束前的异常 done、terminated 或平均刚体跟踪误差超过 $0.5\\,\\mathrm{m}$ 会记录 failure，并在下一策略步按当前参考时间恢复。失败样本保留，reset_frames 标明恢复；阈值是恢复策略，不是动作精度验收标准。',
        '恢复会引入物理不连续，缺失区间没有虚构动力学。后续计算导数、功率积分或窗口特征必须检查分段与 reset 标记，不能跨缺口或恢复边界直接累积。'
      ],
      math: 't_i^{\\mathrm{local}}=\\frac{i+1}{120},\\qquad t_i^{\\mathrm{timeline}}=t_{\\mathrm{start}}+t_i^{\\mathrm{local}}',
      sources: ['protomotions/utils/native_dynamics_capture.py:record_step / recovery', '.cache/kyra_bad_energy/native_dynamics/manifest.json']
    },
    {
      title: '07 · 力矩与接触力的物理含义',
      paragraphs: [
        'dof_forces 从 IsaacLab 的 applied_torque 读取，表示仿真控制器实际施加的关节力矩，不是人体测得的关节力矩或肌肉力。',
        '接触只配置左右 ankle / toe 共四个传感器，读取 net_forces_w；其余刚体对应的接触力与标志通道为零。接触标志阈值为 $0.01\\,\\mathrm{N}$。传感器净力尚未验证等同于包含摩擦的完整足底地面反力。',
        '固定体型机器人、动作重定向、控制器和真实人体之间的差异仍需在能耗学习中处理；物理跟踪输出提供 dynamics 信息，不能直接证明人体能耗正确。'
      ],
      sources: ['protomotions/simulator/isaaclab/simulator.py:_get_simulator_dof_forces / _get_simulator_bodies_contact_buf', 'protomotions/utils/native_dynamics_capture.py:force_semantics']
    },
    {
      title: '08 · 当前 Kyra 样例与对比验证',
      paragraphs: [
        '源动作包含 23,557 个观测 SMPL-X 帧，源帧率为 $30000/1001$ FPS。重采样完整视频共 23,677 帧、789.233 秒，其中 99 帧明确缺失；三个观测片段共 23,578 个 30 FPS 动作帧。',
        '原生动力学三段分别保存 324、1,684、92,292 个物理样本，共 94,300 步、19 个字段；该次 120 Hz 回放有 12 次恢复。较早的 30 FPS 视频轨迹有 13 次恢复，两者是独立仿真，不能按帧视为同一次轨迹。',
        '对比视频左侧是原始 55 关节 SMPL-X 网格和逐帧体型，右侧是记录的 PhysX 刚体轨迹。MuJoCo / EGL 只绘制，不做物理推进。视频报告的平均刚体位置误差约 0.1106 m、P95 约 0.1692 m，对比对象是固定 rig 的参考，不是原始网格顶点误差。'
      ],
      table: {headers: ['产物', '用途'], rows: [
        ['.cache/kyra_bad_energy/motions.pt', '三段 MotionLib 参考动作'],
        ['native_dynamics/segment_000～002.pt', '120 Hz 原生动力学张量'],
        ['native_dynamics/manifest.json', '时间映射、字段、单位、文件哈希与恢复记录'],
        ['output/renderings/kyra_bad_energy_smpl_vs_physics.mp4', '1920×720、30 FPS 同步对比视频'],
        ['.cache/kyra_bad_energy/verification.json', '既有视频全解码、帧数、来源与轨迹验证记录']
      ]},
      sources: ['docs/prompthmr_comparison.md', '.cache/kyra_bad_energy/native_dynamics/manifest.json', '.cache/kyra_bad_energy/verification.json', 'data/scripts/render_results_comparison.py']
    },
    {
      title: '09 · 后续：从动力学特征到 kcal',
      paragraphs: [
        '按研究方案，下一步先从力矩与角速度派生功率 $P_j(t)=\\tau_j(t)\\dot q_j(t)$，组合运动学、接触等特征，再用 E3V-K5 的能耗标签学习回归。功率导出、EE 网络和标定属于后续工作，不是现有 .pt 的新增字段。',
        '统一输出能耗率 $\\hat e_k$（kcal/min）与总量 $\\hat E_{\\mathrm{total}}$（kcal）。下式中的 $\\Delta t_k$ 用秒，不能直接把机械功转成代谢 kcal。',
        '方案建议以约 10 秒标签窗口做 MAE-rate、MAE-total 与时间相关性比较，在相同 split 下比较 A 与 B。各肌群能耗归因是 Stage C 的长期目标；当前 69-DOF 力矩不等于肌肉级能耗标签。'
      ],
      math: '\\hat E_{\\mathrm{total}}=\\sum_k\\hat e_k\\frac{\\Delta t_k}{60}\\quad[\\mathrm{kcal}]',
      sources: ['能量计算方案.md：Physics-aware / 数据与评估 / M2–M5']
    },
    {
      title: '10 · 调用入口与本次核对',
      paragraphs: [
        '源码根目录 /opt/data/private/PrtoMotions。既有环境 .conda/envs/protomotions_isaaclab；本页给出复现命令示例，不会自动启动仿真。三个片段用不同 motion_id 和不同输出路径分别捕获，输出文件禁止覆盖。',
        'HEAD 为 607ca7a0bb92e261120bcab8d9f97f28b3130ffc，转换、捕获、文档等修改尚未提交。本说明依据当前工作树及已有产物，不应只用 HEAD 复现。',
        '已阅读根 AGENTS.md、研究方案、相关转换与重采样、原生动力学与轨迹采集、IsaacLab 状态接口、渲染及验证记录。此次 CPU 回读三个动力学文件，核对全部 19 字段的形状、有限值、94,300 样本与 120 Hz 时间轴；旋转最短弧和 SciPy 对照的两项现有测试通过。未跑全仓 pytest、未重新验证 GPU 跟踪或 kcal 准确率。'
      ],
      code: '# 在项目既有环境中运行；目标目录 / 文件必须尚不存在\npython data/scripts/prepare_results_comparison.py \\\n  --input /path/to/trusted/results.pkl --output .cache/new_comparison\n\npython protomotions/inference_agent.py \\\n  --checkpoint data/pretrained_models/motion_tracker/smpl/last.ckpt \\\n  --motion-file .cache/new_comparison/motions.pt \\\n  --simulator isaaclab --num-envs 1 --headless \\\n  --raw-dynamics-motion-id 0 \\\n  --raw-dynamics-output .cache/new_comparison/native_segment_000.pt',
      sources: ['AGENTS.md', 'protomotions/inference_agent.py', 'protomotions/tests/test_results_comparison.py', '.cache/kyra_bad_energy/native_dynamics/RUN_STATUS.md']
    }
  ]
});
