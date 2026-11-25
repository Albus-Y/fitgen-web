// 依据 myserverl40 的 Module1_music 当前工作树核对（2026-11-25）。
// 主要依据：webapp/server.py、eight_count_postprocessing/eight_count_grid.py、
// third_party/all-in-one-albus-y/src/allin1/。展示聚焦流程与能力边界。
Object.assign(window.FITGEN_MODULES.find(module => module.id === 1), {
  description: "从音乐中识别节拍与段落，整理成供团操编排和动作对齐使用的八拍网格。",
  status: "分析与八拍生成已实现",
  input: ["WAV 音乐"],
  output: ["节拍、强拍与 BPM", "段落边界、标签与八拍网格"],
  next: "八拍网格与段落交给模块 2 编排；逐拍拍点交给模块 4 对齐动作。",
  demoUrl: "demo/index.html",
  demoTitle: "音乐分析 Demo",
  demoDescription: "播放 4 首音乐，查看节拍、段落与八拍网格。",
  overviewSections: [
    {
      title: "从音乐到八拍网格",
      steps: ["WAV 音乐", "All-In-One 分析", "八拍分组", "输出时间网格"],
      paragraphs: [
        "All-In-One 先分离音轨、提取特征，再识别节拍、强拍、BPM 和主歌、副歌等段落。项目在这些结果上增加八拍分组，为后续动作编排提供时间边界。"
      ]
    },
    {
      title: "八拍如何组织",
      paragraphs: [
        "以可靠的 4/4 小节为基础，将两个连续小节组成一个八拍，第 1、5 拍为强拍。段落边界在允许范围内对齐到拍点，同时保留每个八拍所属的音乐段落。",
        "不足八拍或没有可靠节拍的区间单独保留，不补造拍点。结果同时记录秒级时间和 30 FPS 帧位置，便于编排与动作对齐。"
      ]
    },
    {
      title: "当前能力与边界",
      paragraphs: [
        "已支持新音乐分析、八拍生成和时间轴查看。完整八拍目前仅支持可靠的 4/4 节奏，其他区间保守保留。",
        "30 FPS 用于结果导出与动作时间轴对齐，模型内部仍以 100 FPS 推理。统一模块接口与整条编排链路的接入仍待完成。"
      ]
    }
  ]
});
