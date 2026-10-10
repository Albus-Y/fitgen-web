// 依据服务器源码整理。文字记录的是实际工作树，规划中的接口单独标记。
Object.assign(window.FITGEN_MODULES.find(module => module.id === 1), {
  demoUrl: "demo/index.html",
  implementation: [
    "WAV → HTDemucs 四轨分离 → 100 FPS 对数频谱 → All-In-One 多任务推理 → 秒级节拍与段落 → 30 FPS 导出 → 确定性八拍网格。",
    "Web 负责排队、调用推理子进程与缓存；eight_count_postprocessing 负责纯后处理。模型推理与八拍规则分层。"
  ],
  technicalDetails: [
    "默认使用 Albus-Y/all-in-one 的 feat/30fps-task-aware-activations 分支，Web 默认模型为 harmonix-all、设备为 CUDA。",
    "八拍 schema：eight-count-grid-v1；实际工作树算法版本：0.2.1。秒级 JSON 是事件依据，30 FPS NPZ 用于帧轴与数据完整性校验。"
  ],
  detailMeta: "源码核对：2026-10-10 · 已实现内容与待实施规划分别列出",
  overviewMeta: "流程说明 · 已对照 GitHub 原版与服务器 fork",
  overviewSections: [
    {
      title: "All-In-One 如何生成八拍网格？",
      paragraphs: [
        "All-In-One 原版先提供音乐结构：BPM、Beat、Downbeat、每拍在小节中的位置和带标签的段落。项目在这些结果上增加八拍后处理，将音乐整理为后续课程规划可使用的时间网格。"
      ],
      code: "WAV 音乐\n  ↓ All-In-One 分离音轨、提取特征、推理与解码\n秒级 JSON：Beat / Downbeat / 段落 / BPM\n  ↓ 项目八拍后处理（同时校验 30 FPS NPZ）\n八拍网格：完整八拍 + 不完整片段 + 空段",
      links: [{ label: "GitHub 原版：推理与结果保存", url: "https://github.com/mir-aidj/all-in-one/blob/main/src/allin1/helpers.py" }]
    },
    {
      title: "从音乐到网格，分四步完成",
      paragraphs: [
        "① 分析音乐。原版先用 HTDemucs 分离四轨，再提取 100 FPS 频谱并运行多任务模型；DBN 解码出节拍、强拍和小节位置，段落后处理给出边界与标签。",
        "② 导出分析结果。服务器 fork 保留原版秒级 JSON，并额外输出 30 FPS 的任务感知 activation。节拍和段落的依据始终是秒级事件。",
        "③ 组装八拍。后处理先校验节拍与 4/4 小节，将段落边界在安全范围内对齐到拍点，然后把两个连续可靠小节组成八拍；第 1、5 拍是强拍。不足八拍或无可靠节拍的部分也保留下来。",
        "④ 写出网格。将秒边界映射到 30 FPS 帧索引，生成 .eight.json，并另写诊断文件。每块带类型、所属段落、拍数以及秒 / 帧边界，供模块 2 规划课程。"
      ],
      links: [{ label: "GitHub 原版：音频分析流程", url: "https://github.com/mir-aidj/all-in-one/blob/main/src/allin1/analyze.py" }, { label: "GitHub 原版：节拍与强拍解码", url: "https://github.com/mir-aidj/all-in-one/blob/main/src/allin1/postprocessing/metrical.py" }]
    },
    {
      title: "项目在原版之上增加了什么？",
      table: {
        headers: ["改动", "如何处理", "对后续模块的作用"],
        rows: [
          ["30 FPS 任务感知导出", "内部推理仍为 100 FPS；最终事件生成高斯脉冲，标签概率按时间区间加权平均", "统一帧轴，方便衔接动作；不会把抽帧后的曲线用于重新找拍"],
          ["确定性八拍后处理", "可靠 4/4 小节两两分组；保留 partial / gap；严格条件下合并跨段互补片段", "提供明确、连续覆盖的八拍时间块"],
          ["秒与帧同时输出", "保留秒级边界，用 np.rint 映射到 30 FPS；区分第 8 拍与区间末帧", "课程规划和动作时间对齐使用同一份网格"],
          ["缓存与质量检查", "文件替换、参数或版本变化使缓存失效；可只刷新八拍；输出校验与诊断分开", "减少重复推理，定位不可靠区间"]
        ]
      },
      paragraphs: [
        "30 FPS 是导出和对齐方式的改进，没有重新训练模型，也不代表检测准确率提升。当前完整八拍只支持可靠 4/4；非 4/4 和异常区间保守保留。"
      ]
    }
  ],
  detailSections: [
    {
      title: "01 · 实现分层与当前状态",
      paragraphs: [
        "当前主链路已具备新 WAV 分析、节拍与段落输出、30 FPS activation、八拍后处理、缓存复用和 Web 时间轴查看。",
        "默认 fork 位于 third_party/all-in-one-albus-y/；MIR 原版保留为对照。third_party/beat_this/ 已存在，但当前 Web、脚本和八拍核心中未发现 Beat This! 调用，不能将其列为当前主链路引擎。"
      ],
      table: {
        headers: ["层级", "实际代码", "职责"],
        rows: [
          ["编排与展示", "webapp/server.py + webapp/static/", "WAV 索引、异步线程、串行推理、进度、结果 API 与时间轴"],
          ["模型与解码", "third_party/all-in-one-albus-y/src/allin1/", "分离、频谱、多任务模型、DBN、段落和 30 FPS 导出"],
          ["八拍核心", "eight_count_postprocessing/eight_count_grid.py", "输入校验、拍号判断、段落吸附、分组与帧投影"],
          ["I/O 与 CLI", "eight_count_postprocessing/io.py、cli.py", "来源记录、稳定 JSON、原子写入、单文件与批处理"]
        ]
      },
      sources: ["AGENTS.md", "eight_count_postprocessing/AGENTS.md", "webapp/server.py:235", "eight_count_postprocessing/eight_count_grid.py:15"]
    },
    {
      title: "02 · 音源分离、特征与多任务模型",
      paragraphs: [
        "HTDemucs 使用 htdemucs 模型，将音频分离为 bass、drums、other、vocals 四轨。每轨转为单声道频谱，堆叠为 $[4,T,81]$，再增加 batch 维送入模型。",
        "特征链为分帧 → STFT → 滤波频谱 → 对数变换。配置采样率 44,100 Hz、窗长 2,048、hop 441，对应 100 FPS；滤波器设置 num_bands=12、频率范围 30–17,000 Hz。",
        "模型以卷积产生逐帧 embedding，经时间膨胀邻域注意力与乐器间注意力编码，分别输出 beat、downbeat、section、function 四个任务头。具体模型超参数来自加载的 checkpoint 配置。",
        "harmonix-all 包含 harmonix-fold0 至 fold7 八个模型，在 logits 层求平均，再进行事件和段落解码。30 FPS 改造没有修改模型权重、内部频谱帧率或 DBN 帧率。"
      ],
      sources: ["third_party/all-in-one-albus-y/src/allin1/demix.py", "third_party/all-in-one-albus-y/src/allin1/spectrogram.py", "third_party/all-in-one-albus-y/src/allin1/models/allinone.py", "third_party/all-in-one-albus-y/src/allin1/models/ensemble.py", "third_party/all-in-one-albus-y/src/allin1/models/loaders.py"]
    },
    {
      title: "03 · 秒级节拍、强拍、段落与 BPM",
      paragraphs: [
        "Beat 与 Downbeat logits 经过 sigmoid，组合为普通拍、强拍、无拍的概率，再由 madmom 的 DBNDownBeatTrackingProcessor 解码。模型解码允许每小节 3 或 4 拍；八拍核心另行施加严格 4/4 规则。",
        "段落边界经过局部极大值过滤与 peak picking，补入 0 秒和音频终点。每段对十类 softmax 概率求时间均值，再取 argmax 作为段落标签。",
        "十类标签为 start、end、intro、outro、break、bridge、inst、solo、verse、chorus。",
        "BPM 根据相邻 Beat 的间隔计算 $\\frac{60}{\\Delta t}$，逐个取整后取出现次数最多的值；少于两拍时为 None。八拍输出保留原始 JSON 的 BPM，不从 30 FPS 时间点重新估计。"
      ],
      sources: ["third_party/all-in-one-albus-y/src/allin1/postprocessing/metrical.py", "third_party/all-in-one-albus-y/src/allin1/postprocessing/functional.py", "third_party/all-in-one-albus-y/src/allin1/postprocessing/tempo.py"]
    },
    {
      title: "04 · 30 FPS 任务感知导出",
      paragraphs: [
        "100 FPS 默认输出保留原始 sigmoid / softmax；指定 --activ --activ-fps 30 时，导出的是后处理事件的任务感知表示。",
        "设源帧数为 $T_{100}$，则时长 $D=\\frac{T_{100}}{100}$，目标帧数 $T_{30}=\\lceil30D\\rceil$，$t_j=\\frac{j}{30}$；音频终点不额外生成一帧。",
        "beat、downbeat 使用最终 DBN 事件；segment 使用内部段落起点，排除 0 秒与终点。每个事件在目标时间轴上生成高斯脉冲，重叠取最大值。默认 $\\sigma=\\frac{0.5}{30}\\,\\mathrm{s}\\approx16.667\\,\\mathrm{ms}$，计算范围截断到 $4\\sigma$；可通过 --event-sigma-ms 调整。",
        "label 保留十类概率，以源、目标时间区间的重叠面积加权平均，再逐帧归一化；零和帧回退到十类均匀概率，不先取 argmax。",
        "八拍核心只读取秒级 JSON 中的事件，NPZ 用于验证 time、帧数、通道形状和有限值，禁止从高斯曲线再次检测 Beat。"
      ],
      table: {
        headers: ["产物", "内容", "形状 / 语义"],
        rows: [
          ["song.json", "bpm、beats、downbeats、beat_positions、segments、activation_info", "秒级事件与段落"],
          ["song.activ.30fps.npz", "time、beat、downbeat、segment", "各为 $[T_{30}]$"],
          ["同一 NPZ 的 label", "十类标签概率", "$[10,T_{30}]$"],
          ["activation_info", "file、fps、source_fps、num_frames、duration_seconds、methods、sigma、label_names", "记录当前导出文件和语义"]
        ]
      },
      sources: ["third_party/all-in-one-albus-y/src/allin1/helpers.py:21", "third_party/all-in-one-albus-y/src/allin1/postprocessing/activation_resampling.py"]
    },
    {
      title: "05 · 八拍生成：从可靠小节到完整覆盖",
      paragraphs: [
        "先排序 Beat、去除完全重复的时间点并记录警告。合法且对齐的 beat_positions 优先确定小节位置；其 $\\mathrm{position}=1$ 是强拍依据，与 downbeats 不一致时标记冲突。没有合法位置时，尝试将 Downbeat 吸附到最近 Beat。",
        "相邻强拍之间必须正好含四拍；若存在合法位置，其序列必须是 1,2,3,4，且不能含强拍冲突。全曲有效小节比例达到 0.80 才允许生成 full。",
        "在有效 Section 内寻找连续可靠小节，两小节组成一个 full：8 个连续 Beat，位置为 1,2,3,4,1,2,3,4，第 1、5 拍为 Downbeat。",
        "full 的结束时刻是第二个小节之后的下一个强拍，通常与第 8 拍时刻不同。头部、尾部及不可靠区间保留 partial_head / partial_tail；区间没有 Beat 时显式输出 gap。",
        "非 4/4、节拍缺失或冲突时采取保守输出，不补拍、不插值，也不强行生成完整八拍。每个 Section 的全部时间都必须被 full、partial 或 gap 覆盖。"
      ],
      table: {
        headers: ["参数 / 策略", "当前默认", "含义"],
        rows: [
          ["meter_policy", "strict_4_4", "完整八拍仅接受可靠 4/4"],
          ["meter_support_threshold", "0.80", "有效小节数 / 推断小节数"],
          ["Downbeat 吸附阈值", "$\\min(0.12\\,\\mathrm{s},0.25\\Delta t_{\\mathrm{local}})$", "匹配最近 Beat"],
          ["Segment 吸附阈值", "$\\min(0.35\\,\\mathrm{s},0.50\\Delta t_{\\mathrm{local}})$", "优先可靠 Downbeat，其次普通 Beat"],
          ["segment / partial / gap", "split / keep / explicit", "分段生成，保留不完整区间，显式覆盖空段"],
          ["fallback_anchor", "false", "禁止任意补造起始锚点"]
        ]
      },
      sources: ["eight_count_postprocessing/eight_count_grid.py:26", "eight_count_postprocessing/eight_count_grid.py:304", "eight_count_postprocessing/eight_count_grid.py:606"]
    },
    {
      title: "06 · 段落边界与跨段八拍",
      paragraphs: [
        "Section 保存原始 Segment 边界与吸附后的有效边界。阈值内优先选择 Downbeat，再选 Beat；超阈值或吸附后产生倒序、零长度时保留原边界并记录警告。",
        "默认 full 不跨 Section。唯一例外：同一边界两侧相邻 partial 均有正数拍，各自拍数不能被 4 整除，合计正好为 8，并满足 Beat 连续、4/4 相位、第 1/5 拍强拍及无冲突条件。",
        "例如 $7+1$、$3+5$ 可在满足上述条件时合并；$4+4$ 不按此规则合并。合并后保留两个 section_ids，记录 merged_across_segment_boundary 与具体拍数组合标记。",
        "投影后不足一帧的 Section 或区间会按安全规则并入邻接区间，并记录 subframe_interval_merged；无法安全合并时抛出校验错误。"
      ],
      sources: ["eight_count_postprocessing/eight_count_grid.py:334", "eight_count_postprocessing/eight_count_grid.py:459", "eight_count_postprocessing/eight_count_grid.py:747", "eight_count_postprocessing/eight_count_grid.py:835"]
    },
    {
      title: "07 · 时间与帧索引契约",
      paragraphs: [
        "秒区间采用左闭右开 $[t_{\\mathrm{start}},t_{\\mathrm{end}})$，帧覆盖采用闭区间 $[f_{\\mathrm{start}},f_{\\mathrm{end}}]$。",
        "事件帧使用 $\\operatorname{rint}(30t)$，裁剪到 $0,\\ldots,T_{30}-1$。区间起止边界先分别 np.rint，再将结束边界减 1 得到覆盖末帧；np.rint 的半整数行为必须保留。",
        "last_beat_frame_id 指向第 8 拍，end_frame_id 指向整个八拍时段的覆盖末帧，下游不能混用。例如结束时刻 10.8 秒，结束覆盖帧为 323。",
        "输出校验检查全曲与每个 Section 的秒级和帧级连续覆盖、无重叠、合法 section_ids，以及 full 的拍数、索引、相位和强拍约束。"
      ],
      code: "event_frame = clip(np.rint(time_sec * 30), 0, T30 - 1)\nstart_frame = clip(np.rint(start_time_sec * 30), 0, T30)\nend_frame   = clip(np.rint(end_time_sec * 30), 0, T30) - 1",
      sources: ["eight_count_postprocessing/eight_count_grid.py:73", "eight_count_postprocessing/eight_count_grid.py:918", "eight_count_postprocessing/eight_count_grid.py:939"]
    },
    {
      title: "08 · 输出文件与下游接口",
      table: {
        headers: ["文件 / 字段", "作用"],
        rows: [
          ["song.eight.json", "主输出：music_id、audio_path、audio_fps、bpm、beats、sections、eight_count_grid"],
          ["beats[]", "beat_index、time_sec、beat_in_bar、is_downbeat、frame_id，必要时附 quality_flags"],
          ["sections[]", "section_id、section_label、源边界、有效秒边界、闭区间帧范围与质量标记"],
          ["eight_count_grid[]", "block_id、section_id / section_ids、类型、完整性、Beat 索引与数量、秒 / 帧边界、last_beat_frame_id、quality_flags"],
          ["song.eight.diagnostics.json", "schema / 算法版本、来源、输入指纹、参数、缓存签名、统计、边界调整和警告"],
          ["主输出约束", "不含 energy_curve；不写动态生成时间戳；相同输入、来源和参数产生稳定 JSON"]
        ]
      },
      paragraphs: ["模块 2 可消费 sections 和 eight_count_grid 规划课程。BPM、Beat、强拍与段落信息也保留在输出中；诊断旁路文件用于追踪质量和来源。", "纯后处理 CLI 支持单个 JSON 或目录批处理，提供 --check-only、--fail-on-warning、--overwrite 和参数覆盖。以下示例仅展示调用方式："],
      code: "python -m eight_count_postprocessing.cli song.json --activation song.activ.30fps.npz --audio song.wav --check-only",
      sources: ["eight_count_postprocessing/eight_count_grid.py:1053", "eight_count_postprocessing/io.py:43"]
    },
    {
      title: "09 · Web、任务队列与缓存",
      paragraphs: [
        "新音频入口只枚举 data/web_test_audio/ 第一层 WAV；产物保存到 outputs/web-test-audio/ 下各任务目录。路径检查限制 WAV 和 NPZ 在指定目录内。",
        "ThreadingHTTPServer 提供请求服务，每次分析启动 daemon worker 线程，_analysis_lock 使 GPU 推理串行执行。当前状态为 idle → queued → running → ready，失败为 error；进度从日志推断，并提供 heartbeat，进度百分比不是精确耗时估计。",
        "默认命令指定 --activ --activ-fps 30 --model harmonix-all --device cuda --keep-byproducts --no-multiprocess，并通过 PYTHONPATH 指向 fork/src。",
        "音频指纹为文件名、大小与 mtime_ns，文件名 SHA-256 前 12 位只用于任务目录命名，尚不是音频内容哈希。替换同名 WAV 会使缓存失效，分析和后处理后也会再次检查源文件是否变化。",
        "八拍缓存签名包含音频指纹、schema、算法版本、参数、FPS、fork 分支 / commit 和模型。原始结果有效但八拍过期时，只刷新后处理；兼容旧 fork 缓存的分支仍保留。",
        "八拍主输出和诊断采用临时文件、fsync、os.replace 与失败回滚；这不代表所有模型原始产物都使用同一原子事务。"
      ],
      table: {
        headers: ["当前 HTTP 接口", "作用"],
        rows: [
          ["GET /api/new-audio", "列举 WAV 与任务状态"],
          ["POST /api/new-audio/{file_id}/analyze", "发起分析；ready 返回 200，其余接受状态返回 202"],
          ["GET /api/new-audio/{file_id}", "查询状态与进度"],
          ["GET /api/new-audio/{file_id}/result", "获取已就绪的展示结果；无参考标注"],
          ["GET /api/tracks 与 /api/tracks/{id}", "浏览 Harmonix 评测与人工参考"],
          ["GET /api/health", "当前 Web 服务健康检查"]
        ]
      },
      sources: ["webapp/server.py:235", "webapp/server.py:364", "webapp/server.py:574", "webapp/server.py:608", "webapp/server.py:864", "eight_count_postprocessing/io.py:47"]
    },
    {
      title: "10 · 评测口径与验证边界",
      paragraphs: [
        "Harmonix 标注用于 Beat、Downbeat、结构段落与 BPM 评测。批处理按完整 metadata 排序索引 modulo 8 分配对应 harmonix-foldN，音频时长与 metadata 的差值默认不超过 2 秒；正式解释结果仍需核对该映射与训练折一致。",
        "节拍指标使用 madmom BeatEvaluation，事件容差 70 ms，包含 F1、Precision、Recall、CMLt、AMLt。段落用 mir_eval，边界容差 0.5 秒，并记录 Pairwise / NCE F1 与 100 FPS 标签帧准确率；BPM 记录绝对误差、4% 命中率和倍频容错指标。",
        "harmonix-all 是八折模型集成，不能把其在 Harmonix 上的结果当作无泄漏泛化性能。新 WAV 没有人工参考，Web 明确设置 has_reference=false，不提供参考 F1。",
        "项目实施记录的 20 首 WAV 验收验证的是 30 FPS 导出相对原生秒级结果的重建一致性：事件全匹配，最大时间误差约 16.667 ms，239 个段落类别一致；这不是人工标注准确率评测，本次未重新运行该音频验收。",
        "已有评测 provenance 仍读取 third_party/all-in-one/ 的 commit，运行脚本通过 import allin1 选中环境中的包。复用这套评测时必须确认实际导入来源，不能据旧 provenance 自动认定评测使用了当前 fork。"
      ],
      sources: ["AGENTS.md：评测原则", "scripts/run_allin1_harmonix_eval.py", "scripts/evaluate_allin1_harmonix.py:138", "scripts/evaluate_allin1_harmonix.py:236", "third_party/all-in-one-albus-y/30FPS_TASK_AWARE_ACTIVATION_IMPLEMENTATION.md：第 11 节"]
    },
    {
      title: "11 · 已实现边界与待实施接入",
      paragraphs: [
        "当前 V1 八拍不支持将非 4/4 拍生成 full，不提供能量曲线，也没有当前 BPM 变速检测能力。Beat This! 尚未接入现有生成链路。",
        "推理编排、任务状态与缓存逻辑仍集中在 webapp/server.py。_jobs 是进程内字典，排队与运行中任务没有持久化恢复；已完成结果可从磁盘缓存识别。",
        "MODULE1_MUSIC_MODULEIZATION_PLAN.md 明确标为待实施：稳定 module1_music 包、MusicAnalyzer、统一结果 DTO、/api/v1/music/jobs、SQLite JobStore、内容 SHA-256 缓存和产物 manifest 属于规划。本次检查未发现 module1_music/ 包，网页不会将这些接口标为已交付。"
      ],
      sources: ["MODULE1_MUSIC_MODULEIZATION_PLAN.md：文档状态与阶段规划", "webapp/server.py:267", "eight_count_postprocessing/AGENTS.md"]
    },
    {
      title: "12 · 代码来源与本次核对",
      paragraphs: [
        "服务器项目：/opt/data/private/ChoreoGraph/Module1_music。项目 HEAD 为 c7d00d9038df56eb84f251d796e9a79d261615b9。",
        "默认 fork 分支：feat/30fps-task-aware-activations；commit：f681569344c57668bee6ea492b789f77a1646a7f。",
        "阅读时八拍核心和对应测试存在未提交修改，实际 ALGORITHM_VERSION 为 0.2.1；本文依据当前工作树，不能仅靠项目 HEAD 复现这些修改。",
        "已阅读模块根 AGENTS.md、八拍子目录 AGENTS.md、主链路核心代码、Web 服务与前端关键逻辑、评测脚本和现有测试。此次不修改服务器源码，不安装依赖，不运行 GPU 音频推理。",
        "本次复用现有 allin1 环境验证：八拍核心 30 项、Web 编排与缓存 8 项、activation 导出 21 项，共 59 项测试全部通过。Web 测试使用模拟推理，activation 测试使用合成输入；不能代替真实音频模型准确率评测。",
        "本地网页已通过 JavaScript 语法与渲染结构检查：8 个折叠模块、12 节技术说明、5 张参数和字段表。此轮未新增浏览器视觉验收。"
      ],
      sources: ["eight_count_postprocessing/eight_count_grid.py:16", "eight_count_postprocessing/tests/test_eight_count_grid.py", "third_party/all-in-one-albus-y/tests/test_activation_*.py", "webapp/test_server.py"]
    }
  ]
});
