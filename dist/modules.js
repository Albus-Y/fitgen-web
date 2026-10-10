// 后续在每个模块的 implementation、technicalDetails 中补充内容。
// 每个字段是一组纯文本段落；页面会自动生成可折叠详情。
window.FITGEN_MODULES = [
  { id: 1, title: "音乐结构分析", short: "音乐分析", english: "MUSIC ANALYSIS", description: "分析音乐的结构信息，建立整个生成流程的时间与节奏基础。", input: ["WAV 音乐"], output: ["八拍网格边界", "音乐段落边界", "段落标签", "Beat、downbeat、BPM"], next: "音乐结构 → 模块 2；音乐 beats → 模块 4", implementation: [], technicalDetails: [] },
  { id: 2, title: "八拍课程规划与 IR 生成", short: "课程规划", english: "COURSE PLANNING", description: "规划每个八拍的课程阶段、训练肌群和训练强度。", input: ["模块 1 的音乐结构信息", "用户需求"], output: ["每个八拍的音乐位置", "课程阶段", "目标肌群", "训练强度"], next: "八拍课程 IR → 模块 3", implementation: [], technicalDetails: [] },
  { id: 3, title: "动作候选闭集筛选", short: "候选筛选", english: "CANDIDATE SELECTION", description: "根据每个八拍的肌群、强度信息，筛选动作闭集。", input: ["模块 2 的八拍课程 IR", "带能量标签的动作数据库"], output: ["候选动作 ID 及能量信息", "候选 mask"], next: "候选动作闭集 → 模块 4", implementation: [], technicalDetails: [] },
  { id: 4, title: "XTW 动作变速", short: "XTW 变速", english: "MOTION RETIMING", description: "对已有动作进行节拍对齐和受约束变速，输出 30 FPS 骨架动作。", input: ["已有动作三维骨架与源 FPS", "模块 1 的音乐 beats", "音乐片段时长"], output: ["变速骨架、时间映射与诊断"], next: "变速骨架片段 → 模块 5", implementation: [], technicalDetails: [] },
  { id: 5, title: "动作拼接、连续化", short: "拼接连续化", english: "MOTION ASSEMBLY", description: "将 JSON 转换为 motion sequence，并平滑连接各段动作。", input: ["模块 4 的变速骨架片段", "带能量标签的动作数据库"], output: ["整个 track 的 motion sequence"], next: "完整动作序列 → 模块 6 渲染；生成的完整团操 → 模块 8 计算能耗", implementation: [], technicalDetails: [] },
  { id: 6, title: "Retarget 和数字人渲染", short: "数字人渲染", english: "RETARGET & RENDER", description: "根据 motion sequence 完成动作重定向与数字人渲染。", input: ["模块 5 的 motion sequence"], output: ["渲染好的视频"], next: "最终产出 · 数字人健身视频", implementation: [], technicalDetails: [] },
  { id: 7, title: "数据集构建", short: "数据集构建", english: "DATASET FOUNDATION", description: "提取公开健身、跳操视频，拆分原子动作，并标注锻炼肌群，构建外部动作数据库。", input: ["公开健身、跳操视频"], output: ["成对的 {music, motion sequence} 数据", "原子动作与锻炼肌群标签", "外部动作数据库"], next: "动作数据库调用模块 8 → 带能量标签的动作数据库 → 模块 3、4、5", implementation: [], technicalDetails: [] },
  { id: 8, title: "能量消耗计算", short: "能量消耗计算", english: "ENERGY EXPENDITURE", description: "为动作数据库计算能量标签，并对生成的完整团操计算总能量消耗及各肌群能量消耗。", input: ["动作数据库中的动作与肌群信息", "生成的完整团操动作序列"], output: ["带能量标签的动作数据库", "完整团操总能量消耗", "各肌群能量消耗"], next: "数据库能量标签 → 模块 3、4、5；团操能耗结果 → 课程结果展示", implementation: [], technicalDetails: [], overviewMeta: "模块职责 · 两种调用场景；具体算法与技术实现待补充", overviewSections: [
    { title: "01 · 为动作数据库补充能量标签", paragraphs: ["外部动作数据库调用能量消耗计算模块，为其中的动作计算能量消耗，输出带能量标签的动作数据库。", "标注后的数据库继续供动作筛选、XTW 变速与拼接使用。数据库保留为独立的数据资源，不再占用模块 8 的编号。"], code: "外部动作数据库 → 模块 8：能量消耗计算 → 带能量标签的动作数据库\n                                            ↓\n                                      模块 3 / 4 / 5" },
    { title: "02 · 计算完整团操的能量消耗", paragraphs: ["整个团操生成后，将最终动作序列交给模块 8，输出整节课程的总能量消耗和各肌群能量消耗。", "这里使用生成后的完整动作序列作为计算对象；具体计算方法、参数、计量单位与验证方式留待后续补充。"], code: "生成的完整团操 → 模块 8：能量消耗计算\n                      ├→ 总能量消耗\n                      └→ 各肌群能量消耗" }
  ] }
];
