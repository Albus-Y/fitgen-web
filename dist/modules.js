// 后续在每个模块的 implementation、technicalDetails 中补充内容。
// 每个字段是一组纯文本段落；页面会自动生成可折叠详情。
window.FITGEN_MODULES = [
  { id: 1, title: "音乐结构分析", short: "音乐分析", english: "MUSIC ANALYSIS", description: "分析音乐的结构信息，建立整个生成流程的时间与节奏基础。", input: ["WAV 音乐"], output: ["八拍网格边界", "音乐段落边界", "段落标签", "Beat、downbeat、BPM"], next: "音乐结构 → 模块 2；音乐 beats → 模块 4", implementation: [], technicalDetails: [] },
  {
    id: 2, title: "团操编排 Agent", short: "团操编排 Agent", english: "WORKOUT ARRANGEMENT",
    status: "编排方案已确定",
    description: "结合整首音乐和跟练目标，安排教学与复练，为每个八拍选定可完整播放的徒手动作。",
    input: ["训练目标、目标肌群、身高与体重", "模块 1 的音乐段落、八拍网格与逐拍拍点", "原子动作库的素材、训练标签与动作关系"],
    output: ["逐八拍 IR（fitgen-arrangement-v1）", "每块的时间边界、音乐段落、教学意图与有序条目"],
    next: "下游按 IR 取素材与目标时长，调用模块 4 变速，再由模块 5 按顺序拼接并执行预留过渡。",
    implementation: [], technicalDetails: []
  },
  { id: 4, title: "DTW 动作变速", short: "DTW 变速", english: "MOTION RETIMING", description: "对已有动作进行节拍对齐和受约束变速，输出 30 FPS 骨架动作。", input: ["已有动作三维骨架与源 FPS", "模块 1 的音乐 beats", "音乐片段时长"], output: ["变速骨架、时间映射与诊断"], next: "变速骨架片段 → 模块 5", implementation: [], technicalDetails: [] },
  { id: 5, title: "动作拼接与过渡", short: "拼接与过渡", english: "MOTION ASSEMBLY", description: "按整曲 IR 排列变速后的片段，平滑常规接缝，在预留时段调用过渡动作生成工具。", input: ["模块 2 的条目顺序与过渡请求", "模块 4 的变速骨架片段及相邻动作端点"], output: ["整曲连续的动作序列"], next: "完整动作序列交给模块 6 渲染，同时可送入模块 8 评估整课能耗。", implementation: [], technicalDetails: [] },
  { id: 6, title: "Retarget 和数字人渲染", short: "数字人渲染", english: "RETARGET & RENDER", description: "根据 motion sequence 完成动作重定向与数字人渲染。", input: ["模块 5 的 motion sequence"], output: ["渲染好的视频"], next: "最终产出 · 数字人健身视频", implementation: [], technicalDetails: [] },
  { id: 7, title: "数据集构建", short: "数据集构建", english: "DATASET FOUNDATION", description: "从健身视频提取完整的原子动作周期，为徒手团操建立可检索的 SMPL-X 素材库。", input: ["公开健身、跳操视频"], output: ["配对的音乐与动作序列", "原子动作素材、语义描述与镜像或变式关系"], next: "素材库调用模块 8 补充能耗和肌群标签，供模块 2 选动作。下游按选定的 clip_id 读取骨架。", implementation: [], technicalDetails: [] },
  {
    id: 8, title: "能耗与锻炼肌群", short: "能耗与肌群", english: "ENERGY & MUSCLE GROUPS",
    description: "在 MuJoCo 中用肌肉驱动模型跟踪动作，从同一段仿真记录估计能量消耗并识别主要锻炼肌群。",
    input: ["单段原子动作或完整团操的 SMPL-X 序列"],
    output: ["动作时段内的能量消耗估计", "主要锻炼肌群"],
    next: "单段结果写入动作库，供模块 2 选动作；完整团操的结果用于课程评估。",
    status: "当前版本", implementation: [], technicalDetails: []
  }
];
