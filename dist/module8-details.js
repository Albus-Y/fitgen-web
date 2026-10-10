// Stage B 采用机械功近似能耗；与根 AGENTS.md 的原生功率接口说明对应。
Object.assign(window.FITGEN_MODULES.find(m => m.id === 8), {
  "implementation": [
    "当前链路：SMPL → ProtoMotions MotionLib → 官方预训练 SMPL 跟踪策略 → SMPL 物理人形 → IsaacLab / PhysX → Dynamics → 原生功率接口 → 区间积分。",
    "Stage B 使用累计关节机械功近似运动能耗。已有物理采集文件及原生功率函数；根 AGENTS.md 提供实时输出与离线积分方法，功率 CSV 与正式区间能耗报告尚未生成。"
  ],
  "technicalDetails": [
    "主指标为机械功绝对值累计（J），同时可报告正机械功及实际 dynamics 覆盖时长。人体 kcal 标定和各肌群代谢能耗不作为当前 Stage B 输出。",
    "实时功率说明位于 /opt/data/private/PrtoMotions/AGENTS.md 的「功率接口与时间区间机械功计算（2026-10-10）」一节；下方说明以该文档与当前源码为依据。"
  ],
  "overviewMeta": "三阶段路线 · A 动作预测基线 → B 机械功近似能耗 → C 肌肉代谢机理",
  "overviewSections": [
    {
      "title": "Stage A · Pose-only：动作直接预测能耗（规划）",
      "paragraphs": [
        "SMPL 动作转换为三维关节轨迹，使用 Pose2Met / STAPFormer 风格的时序网络预测能耗。作为必要基线，先回答“仅看动作能预测多少能量消耗”。",
        "输出能耗率与整段总能耗；优先迁移到 E3V-K5，以 Vid2Burn 复现已有基准。此阶段尚未显式建模力矩、接触或肌肉状态。"
      ],
      "code": "SMPL → 3D joints → Pose-only 时序网络 → 能耗率 / 总能耗"
    },
    {
      "title": "Stage B · Physics-aware：以机械功近似运动能耗（当前路线）",
      "paragraphs": [
        "直接使用 ProtoMotions 原有 power_consumption_sum 接口输出实时功率：每个关节的力矩乘角速度取绝对值后求和，得到 $P_{\\mathrm{abs}}(t)=\\sum_i|\\tau_i(t)\\omega_i(t)|$（W）。按 120 Hz 物理步记录，再对目标时间区间积分，得到累计机械功 $E_{\\mathrm{abs}}$（J），作为当前运动能耗的近似指标。",
        "当前路线采用功率 → 时间积分，无需先训练能耗回归器。机械功是仿真关节做功的代理量，并非经生理标定的人体代谢能耗；各肌群代谢归因仍属于 Stage C。现有 dynamics 可直接复用原接口计算，AGENTS.md 已给出实时调用与离线区间积分方法，尚未生成正式功率报告。"
      ],
      "code": "ProtoMotions 实时功率（W） → 时间区间积分 → 累计机械功（J） → 运动能耗近似指标",
      "math": "\\begin{gathered}\\mathrm{SMPL}\\rightarrow\\text{ProtoMotions MotionLib}\\rightarrow\\substack{\\text{MotionTracking Policy}\\\\\\text{(Pretrained SMPL Trackers)}}\\\\\\rightarrow\\text{SMPL Physics Humanoid}\\rightarrow\\text{PhysicsSimulator (IsaacLab)}\\rightarrow\\text{Dynamics}\\end{gathered}",
      "sources": [
        "/opt/data/private/PrtoMotions/AGENTS.md：功率接口与时间区间机械功计算",
        "protomotions/envs/rewards/base.py:power_consumption_sum"
      ]
    },
    {
      "title": "Stage C · Physics + Muscle：追溯肌肉代谢（长期目标）",
      "paragraphs": [
        "长期目标。在动力学基础上引入 SOMA 肌肉几何，通过肌骨求解器估计激活、肌力、长度与收缩速度，再接 Bhargava / Umberger 代谢模型，得到肌肉级能耗及其汇总。",
        "SOMA 提供几何，肌肉激活与肌力仍需另行求解。先在 B 稳定后推进，最终支撑团操总能耗与各肌群能耗的解释。"
      ],
      "code": "Physics + SOMA 肌肉几何 → 肌肉状态求解 → 代谢功率 → 总能耗 / 各肌群能耗"
    }
  ],
  "demoUrl": "energy-demo/index.html",
  "demoTitle": "Stage B · SMPL 与物理跟踪对比 Demo",
  "demoDescription": "播放已生成的 Kyra Bad Energy 对比视频，查看原始 SMPL-X 动作与物理跟踪结果。",
  "detailMeta": "Stage B 实现核对 · /opt/data/private/PrtoMotions · 2026-10-10",
  "detailSections": [
    {
      "title": "01 · 研究方案与当前交付边界",
      "paragraphs": [
        "Stage A 与 C 保留原研究方案；Stage B 按当前确定的路线更新为直接使用机械功近似运动能耗。功率取自 ProtoMotions 的原有线性接口，再对物理时间积分，不经过 EE 监督回归器。",
        "服务器已有 120 Hz 力矩、角速度和时间记录，可离线调用同一接口；也可在每个 PhysX 步更新状态后直接调用接口记录实时功率。根 AGENTS.md 说明了两种方法，但本次文档更新没有为采集器新增功率字段，也没有生成正式功率 CSV / 能耗报告。"
      ],
      "table": {
        "headers": [
          "步骤",
          "当前状态"
        ],
        "rows": [
          [
            "SMPL / MotionLib / 预训练 tracker / IsaacLab",
            "已有完整 Kyra 动作与物理采集产物"
          ],
          [
            "力矩、角速度、时间等原生状态",
            "19 个对齐字段，120 Hz"
          ],
          [
            "power_consumption_sum + 区间积分",
            "已有原生函数与 AGENTS.md 调用方法；正式报告待生成"
          ],
          [
            "运动能耗近似指标",
            "累计机械功（J），可辅助报告正机械功与覆盖时长"
          ],
          [
            "人体代谢 kcal / 各肌群代谢能耗",
            "不属于当前 Stage B 已实现输出"
          ]
        ]
      },
      "sources": [
        "/opt/data/private/PrtoMotions/AGENTS.md：功率接口与时间区间机械功计算",
        "protomotions/envs/rewards/base.py:power_consumption_sum",
        "protomotions/utils/native_dynamics_capture.py"
      ]
    },
    {
      "title": "02 · 输入动作与 30 FPS 连续片段",
      "paragraphs": [
        "prepare_results_comparison.py 读取可信 PromptHMR results.pkl 中 source_fps、people[track_id].frames 与 smplx_world 的 pose / trans / shape。姿态要求 $[T,165]$、平移 $[T,3]$，帧索引必须严格递增；检查非有限值。",
        "按源帧缺口拆分观测区间，每段单独重采样到 30 FPS。局部旋转沿 SO(3) 最短弧插值，平移和体型系数线性插值；不跨缺口插值。完整视频时间轴保留缺失帧并标记，物理数据只覆盖观测区间。",
        "单条 NPZ 转换入口 prepare_prompthmr_smpl.py 要求连续帧、均匀时间戳与整数 FPS；长序列 results.pkl 入口可先把非整数源帧率映射到 30 FPS，两者输入契约不能混用。"
      ],
      "sources": [
        "data/scripts/prepare_results_comparison.py:prepare / resample_rotations",
        "data/scripts/prepare_prompthmr_smpl.py"
      ]
    },
    {
      "title": "03 · SMPL-X 到固定 SMPL 物理骨架",
      "paragraphs": [
        "从 PromptHMR 的 Y-up 坐标绕 X 轴旋转 $90^\\circ$ 到右手 Z-up；每个观测区间减去恒定水平原点，并执行固定的区间高度校正。",
        "物理侧使用官方 SMPL rig：24 个刚体、69 个旋转 DOF。复用 SMPL-X 前 22 个共享关节，两个末端 SMPL 手关节旋转设零；源 betas 不改变物理机器人。原始 SMPL-X 网格的体型与固定机器人存在差异。",
        "转换器生成 .motion，motions.yaml 列举分段，MotionLib 将它们打包为 motions.pt。输入是关节旋转与根平移，并非将任意 XYZ 骨架直接传入现有 tracker。"
      ],
      "sources": [
        "data/scripts/prepare_results_comparison.py",
        "data/scripts/convert_amass_to_proto.py",
        "protomotions/components/motion_lib.py",
        "protomotions/data/assets/mjcf/smpl_humanoid.xml"
      ]
    },
    {
      "title": "04 · 预训练 tracker 与逐物理步采样",
      "paragraphs": [
        "使用 data/pretrained_models/motion_tracker/smpl/last.ckpt 及相邻冻结推理配置，本流程没有重新训练 tracker。策略在 30 Hz 跟踪 MotionLib 参考动作，IsaacLab / PhysX 以 120 Hz 推进，每个策略步含 4 个物理子步。",
        "IsaacLab 的 _physics_step 在每个子步执行控制、仿真和 scene.update，再调用 _native_dynamics_callback。capture_native_dynamics 随后读取状态，并在同一 time_s 查询参考状态；保存的是物理步后的数据。",
        "raw capture 只允许 IsaacLab、单环境和指定 motion_id。长时间序列以整数策略帧重新设置 motion_times，避免浮点累积漂移；忽略结束前预期的一步超前完成通知，保证完整覆盖。"
      ],
      "sources": [
        "protomotions/inference_agent.py",
        "protomotions/simulator/isaaclab/simulator.py:_physics_step",
        "protomotions/utils/native_dynamics_capture.py"
      ]
    },
    {
      "title": "05 · 原生动力学输出：19 个对齐字段",
      "paragraphs": [
        "每段 .pt 保存张量与 metadata，schema 为 protomotions.native_dynamics.v1。所有张量沿同一采样轴 $N$ 对齐；metadata 包含 DOF / body 名称、单位、坐标、FPS、参考来源、checkpoint、失败与恢复索引。",
        "四元数顺序为 xyzw，位置和力采用世界坐标。输出先写 .partial 再替换为最终 .pt；目标或 partial 已存在则拒绝覆盖。下表覆盖全部 19 个原生字段。"
      ],
      "table": {
        "headers": [
          "字段组",
          "形状",
          "含义 / 单位"
        ],
        "rows": [
          [
            "dof_pos / dof_vel / dof_forces（3）",
            "$[N,69]$",
            "角度 rad / 角速度 rad/s / 施加力矩 N·m"
          ],
          [
            "rigid_body_pos / vel / ang_vel（3）",
            "$[N,24,3]$",
            "刚体位置 m / 线速度 m/s / 角速度 rad/s"
          ],
          [
            "rigid_body_rot（1）",
            "$[N,24,4]$",
            "刚体四元数 xyzw"
          ],
          [
            "rigid_body_contacts / contact_forces（2）",
            "$[N,24]$ / $[N,24,3]$",
            "接触标志 / 接触传感器净力 N"
          ],
          [
            "root_pos / rot / vel / ang_vel（4）",
            "$[N,3]$ / $[N,4]$ / $[N,3]$ / $[N,3]$",
            "根位置、四元数、线速度与角速度"
          ],
          [
            "reference_dof_pos / rigid_body_pos / rigid_body_rot（3）",
            "$[N,69]$ / $[N,24,3]$ / $[N,24,4]$",
            "同一时间的 MotionLib 参考状态"
          ],
          [
            "reference_root_pos / reference_root_rot（2）",
            "$[N,3]$ / $[N,4]$",
            "参考根位姿"
          ],
          [
            "time_s（1）",
            "$[N]$",
            "片段内物理时间，秒"
          ]
        ]
      },
      "sources": [
        "protomotions/utils/native_dynamics_capture.py:fields / metadata",
        ".cache/kyra_bad_energy/native_dynamics/manifest.json"
      ]
    },
    {
      "title": "06 · 时间映射、缺失区间与恢复重置",
      "paragraphs": [
        "每段首个样本在 $1/120\\,\\mathrm{s}$，不计时刻零的 reset 状态。$N_{\\mathrm{physics}}=4(N_{\\mathrm{motion}}-1)$。全视频时间为片段内 time_s 加 manifest 中 timeline_start_s；三个片段分别独立初始化。",
        "结束前的异常 done、terminated 或平均刚体跟踪误差超过 $0.5\\,\\mathrm{m}$ 会记录 failure，并在下一策略步按当前参考时间恢复。失败样本保留，reset_frames 标明恢复；阈值是恢复策略，不是动作精度验收标准。",
        "缺失区间没有虚构动力学，恢复时的状态跳变不计机械功。采用右端矩形积分，仅累计每个真实物理步与目标区间重叠的时长，不跨片段或 reset 做插值；若使用梯形积分，必须在这些边界切段。"
      ],
      "math": "t_i^{\\mathrm{local}}=\\frac{i+1}{120},\\qquad t_i^{\\mathrm{timeline}}=t_{\\mathrm{start}}+t_i^{\\mathrm{local}}",
      "sources": [
        "protomotions/utils/native_dynamics_capture.py:record_step / recovery",
        ".cache/kyra_bad_energy/native_dynamics/manifest.json"
      ]
    },
    {
      "title": "07 · 力矩与接触力的物理含义",
      "paragraphs": [
        "dof_forces 从 IsaacLab 的 applied_torque 读取，表示仿真控制器实际施加的关节力矩，不是人体测得的关节力矩或肌肉力。",
        "接触只配置左右 ankle / toe 共四个传感器，读取 net_forces_w；其余刚体对应的接触力与标志通道为零。接触标志阈值为 $0.01\\,\\mathrm{N}$。传感器净力尚未验证等同于包含摩擦的完整足底地面反力。",
        "当前采用仿真关节机械功近似运动能耗；固定机器人、动作重定向和控制器会影响该近似量。接触传感器净力不参与当前力矩乘角速度的功率计算，不能把 69 个关节的功率直接当作各肌群代谢能耗。"
      ],
      "sources": [
        "protomotions/simulator/isaaclab/simulator.py:_get_simulator_dof_forces / _get_simulator_bodies_contact_buf",
        "protomotions/utils/native_dynamics_capture.py:force_semantics"
      ]
    },
    {
      "title": "08 · 当前 Kyra 样例与对比验证",
      "paragraphs": [
        "源动作包含 23,557 个观测 SMPL-X 帧，源帧率为 $30000/1001$ FPS。重采样完整视频共 23,677 帧、789.233 秒，其中 99 帧明确缺失；三个观测片段共 23,578 个 30 FPS 动作帧。",
        "原生动力学三段分别保存 324、1,684、92,292 个物理样本，共 94,300 步、19 个字段；该次 120 Hz 回放有 12 次恢复。较早的 30 FPS 视频轨迹有 13 次恢复，两者是独立仿真，不能按帧视为同一次轨迹。",
        "对比视频左侧是原始 55 关节 SMPL-X 网格和逐帧体型，右侧是记录的 PhysX 刚体轨迹。MuJoCo / EGL 只绘制，不做物理推进。视频报告的平均刚体位置误差约 0.1106 m、P95 约 0.1692 m，对比对象是固定 rig 的参考，不是原始网格顶点误差。"
      ],
      "table": {
        "headers": [
          "产物",
          "用途"
        ],
        "rows": [
          [
            ".cache/kyra_bad_energy/motions.pt",
            "三段 MotionLib 参考动作"
          ],
          [
            "native_dynamics/segment_000～002.pt",
            "120 Hz 原生动力学张量"
          ],
          [
            "native_dynamics/manifest.json",
            "时间映射、字段、单位、文件哈希与恢复记录"
          ],
          [
            "output/renderings/kyra_bad_energy_smpl_vs_physics.mp4",
            "1920×720、30 FPS 同步对比视频"
          ],
          [
            ".cache/kyra_bad_energy/verification.json",
            "既有视频全解码、帧数、来源与轨迹验证记录"
          ]
        ]
      },
      "sources": [
        "docs/prompthmr_comparison.md",
        ".cache/kyra_bad_energy/native_dynamics/manifest.json",
        ".cache/kyra_bad_energy/verification.json",
        "data/scripts/render_results_comparison.py"
      ]
    },
    {
      "title": "09 · 原生接口：导出逐物理步实时功率",
      "paragraphs": [
        "调用函数位于 protomotions/envs/rewards/base.py，接口名 power_consumption_sum。在 IsaacLab 初始化后、每个 PhysX 步结束并更新机器人状态后，在已有逐步回调中读取 simulator.get_robot_state()。使用施加力矩 dof_forces（N·m）与角速度 dof_vel（rad/s），当前每环境包含 69 个旋转 DOF；输出为每个环境一个 W 值。",
        "必须指定 use_torque_squared=False。True 分支计算力矩平方和，没有 W 的单位；power_consumption_exp 是指数变换的奖励值，不能积分为机械功。原接口负责计算值，持久化导出需同时记录 time_s、motion_id 与 recovery reset 事件。物理采样频率为 120 Hz，策略为 30 Hz，不能只保存策略步并称为完整物理步采样。",
        "该函数还支持 indices 选择 DOF 子集，用于关节组的机械功统计；这不是肌肉级代谢归因。已有原始 dynamics 可以直接离线调用同一个函数，无需重新仿真。"
      ],
      "math": "P_{\\mathrm{abs}}(t)=\\sum_{i=1}^{69}|\\tau_i(t)\\omega_i(t)|\\quad[\\mathrm{W}],\\qquad P_{+}(t)=\\sum_{i=1}^{69}\\max(\\tau_i(t)\\omega_i(t),0)",
      "code": "# IsaacLab 初始化后，在已有逐物理步回调中调用\nfrom protomotions.envs.rewards.base import power_consumption_sum\n\nstate = simulator.get_robot_state()\npower_abs_w = power_consumption_sum(\n    dof_forces=state.dof_forces,\n    dof_vel=state.dof_vel,\n    use_torque_squared=False,\n)\n# 按 120 Hz 保存物理时间、片段 ID、reset 事件和功率\nprint(\"机械功率绝对值之和（W）:\", power_abs_w.detach().cpu().tolist())",
      "sources": [
        "/opt/data/private/PrtoMotions/AGENTS.md：在仿真中直接调用原有接口输出实时功率",
        "protomotions/envs/rewards/base.py:power_consumption_sum",
        "protomotions/simulator/isaaclab/simulator.py:_physics_step"
      ]
    },
    {
      "title": "10 · 时间积分：区间机械功与覆盖时长",
      "paragraphs": [
        "主指标累计各关节正功与负功的绝对值，单位 J，作为运动能耗的近似。另可计算正机械功：先对每个关节的力矩乘角速度取正值，再求和与积分。两者不能混用；相同单位的 kcal 换算也不代表经过人体代谢标定。",
        "目标区间采用视频全局时间。每段 time_s 加 manifest 中 timeline_start_s；每个真实物理步对应区间 $(t_k-\\Delta t,t_k]$，用与目标区间 $[a,b]$ 重叠的时长加权，按步末功率做右端矩形积分。包含每段首个物理步，不在片段、缺口或 reset 两侧连线；该数值近似不假定已记录步内连续功率。",
        "缺失源帧没有 dynamics，报告实际覆盖秒数与请求秒数，不补零称为全时段能耗。Recovery reset 的非物理跳变不添加能量；保留失败步和恢复后的真实物理步，因此结果描述这次带恢复机制的仿真。若改为梯形积分，按片段和 reset 切段。",
        "AGENTS.md 给出了全局 60–70 秒区间的 CSV 示例。输出 motion_id、time_video_s、power_abs_W、power_positive_W、integration_duration_s，并打印两种累计机械功及覆盖时长；使用独占写入模式，拒绝覆盖已有报告。"
      ],
      "math": "\\begin{gathered}E_{\\mathrm{abs}}[a,b]=\\int_a^b P_{\\mathrm{abs}}(t)\\,\\mathrm{d}t\\approx\\sum_k P_{\\mathrm{abs}}(t_k)\\,\\delta t_k\\quad[\\mathrm{J}]\\\\\\delta t_k=\\max\\{0,\\min(t_k,b)-\\max(t_k-\\Delta t,a)\\},\\qquad\\Delta t=1/120\\,\\mathrm{s}\\end{gathered}",
      "code": "# data 为可信的已导出 .pt；segment 来自 manifest\nfrom protomotions.envs.rewards.base import power_consumption_sum\n\ntorque = data[\"dof_forces\"].double()\nvelocity = data[\"dof_vel\"].double()\npower_abs = power_consumption_sum(torque, velocity, use_torque_squared=False)\npower_positive = (torque * velocity).clamp_min(0).sum(dim=-1)\ntime = data[\"time_s\"].double() + segment[\"timeline_start_s\"]\ndt = float(data[\"metadata\"][\"dt\"])\nstart_s, end_s = 60.0, 70.0\nduration = (\n    time.clamp(max=end_s) - (time-dt).clamp(min=start_s)\n).clamp(min=0, max=dt)\nenergy_abs_j = float((power_abs * duration).sum())\nenergy_positive_j = float((power_positive * duration).sum())\ncovered_s = float(duration.sum())\n# 对所有观测片段分别计算并求和；不补齐缺失区间",
      "sources": [
        "/opt/data/private/PrtoMotions/AGENTS.md：从已导出的 dynamics 输出功率并积分",
        ".cache/kyra_bad_energy/native_dynamics/manifest.json"
      ]
    },
    {
      "title": "11 · 动力学采集入口与核对记录",
      "paragraphs": [
        "源码根目录 /opt/data/private/PrtoMotions。既有环境 .conda/envs/protomotions_isaaclab；本页给出复现命令示例，不会自动启动仿真。三个片段用不同 motion_id 和不同输出路径分别捕获，输出文件禁止覆盖。",
        "HEAD 为 607ca7a0bb92e261120bcab8d9f97f28b3130ffc，转换、捕获、文档等修改尚未提交。本说明依据当前工作树及已有产物，不应只用 HEAD 复现。",
        "前次核对已完成三个动力学文件的 CPU 回读（19 字段、94,300 样本、120 Hz 时间轴）及两项旋转插值测试。本次再次核对根 AGENTS.md 新增的功率调用 / 积分说明和 base.py 原生函数，没有运行仿真或生成新的功率报告。"
      ],
      "code": "# 在项目既有环境中运行；目标目录 / 文件必须尚不存在\npython data/scripts/prepare_results_comparison.py \\\n  --input /path/to/trusted/results.pkl --output .cache/new_comparison\n\npython protomotions/inference_agent.py \\\n  --checkpoint data/pretrained_models/motion_tracker/smpl/last.ckpt \\\n  --motion-file .cache/new_comparison/motions.pt \\\n  --simulator isaaclab --num-envs 1 --headless \\\n  --raw-dynamics-motion-id 0 \\\n  --raw-dynamics-output .cache/new_comparison/native_segment_000.pt",
      "sources": [
        "AGENTS.md",
        "protomotions/inference_agent.py",
        "protomotions/tests/test_results_comparison.py",
        ".cache/kyra_bad_energy/native_dynamics/RUN_STATUS.md"
      ]
    }
  ]
});
