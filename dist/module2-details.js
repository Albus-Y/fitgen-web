// 两个连续八拍，取自 FitGen 编排设计稿 v0.6 的局部示例。
Object.assign(window.FITGEN_MODULES.find(module => module.id === 2), {
  overviewMeta: "接口设计 · fitgen-arrangement-v1",
  overviewSections: [
    {
      title: "从整曲安排到单个八拍",
      paragraphs: [
        "Agent 结合训练目标、目标肌群、跟练经验（如有）和音乐段落安排整节课。热身时可先教基础侧步，主歌让用户跟稳，副歌在熟悉的脚步上加入手臂，尾声减速收势。若歌曲开头就是副歌，也要给新动作留出学习时间。",
        "每个八拍按真实拍点分配时段。预留过渡后，完整动作原速时长除以目标播放时长，就是所需的平均播放倍率。倍率在素材允许范围内才能选用；最高倍率仍放不下时改选其他素材。同一素材做两次就写两个条目。"
      ]
    },
    {
      title: "怎样从动作库挑出一个真实素材",
      table: {
        headers: ["素材字段", "编排用途"],
        rows: [
          ["clip_id、smplx_ref", "用唯一 ID 选择一次完整播放，并定位其 SMPL-X 序列。"],
          ["action_name、description", "读出动作语义、复合动作顺序和这段素材实际完成的动作。"],
          ["source_duration_sec、rate_range", "判断完整周期能否在允许倍率内放入目标时段。"],
          ["primary_muscles、energy_kj", "结合目标肌群和整段素材的原速能耗选动作。标签来自模块 8。"],
          ["impact、coordination", "按冲击程度和协调难度组织引入、加强与恢复。"]
        ]
      },
      paragraphs: ["关系图中，mirror_id 将右侧提膝与对应的左侧素材配对。variation_of 从变式指向基础动作。要给已教的提膝加双臂上举，可从基础素材反查这个变式。"]
    },
    {
      title: "何时为过渡腾出时间",
      paragraphs: [
        "MotionGraph 比较前段末尾和后段开头的 SMPL-X 序列，也检查相邻八拍之间的接缝。能平滑衔接时直接安排动作；如果仍要保留一对差距明显的动作，Agent 在块内写入带时长的 transition_request。",
        "定稿后，下游按 IR 取素材、拍点和条目时长，调用模块 4 做单段变速。模块 5 依播放顺序平滑接缝，在预留窗口根据前后骨架生成过渡。速度或过渡时长无法满足时，将受影响的八拍交回 Agent 改排。"
      ]
    },
    {
      title: "两个八拍如何播放",
      paragraphs: ["以下是 120 BPM 的设计示例，时间单位为秒，区间左闭右开。前一块在主歌中引入点肩，后一块跨过主歌与副歌边界，继续复练同一动作。"],
      table: {
        headers: ["八拍与教学意图", "播放区间（秒）", "条目"],
        rows: [
          ["block_004 · teach", "[12, 14)", "预留过渡：由站姿进入双手俯撑。"],
          ["block_004 · teach", "[14, 16)", "完整播放一次交替点肩。"],
          ["block_005 · repeat", "[16, 18)、[18, 20)", "依次播放两次同一素材，每次 2 秒。"]
        ]
      }
    },
    {
      title: "交给下游的逐八拍 IR",
      paragraphs: [
        "music_grid_ref 与 block_id 用于回查模块 1 的逐拍拍点和块类型。music_sections 按上游 section_ids 的顺序保留每个段落的 ID 和标签。partial_head、partial_tail、gap 均沿用上游实际边界。",
        "teaching_role 按本块的教学目的取 teach、repeat 或 null。首次教新动作或新配合用 teach，复练用 repeat，没有明确教学意图时用 null。下游从 start_sec 起依次累加所有条目的正时长，恰好到达 end_sec。"
      ],
      code: `{
  "schema_version": "fitgen-arrangement-v1",
  "music_grid_ref": "song_001.eight.json",
  "blocks": [
    {
      "block_id": "block_004",
      "start_sec": 12.0,
      "end_sec": 16.0,
      "music_sections": [
        { "section_id": "section_01", "section_label": "verse" }
      ],
      "teaching_role": "teach",
      "items": [
        {
          "kind": "transition_request",
          "duration_sec": 2.0,
          "instruction": "从上一八拍结束时的站姿进入双手俯撑，为交替点肩做好准备"
        },
        { "kind": "motion", "clip_id": "plank_tap_02", "duration_sec": 2.0 }
      ]
    },
    {
      "block_id": "block_005",
      "start_sec": 16.0,
      "end_sec": 20.0,
      "music_sections": [
        { "section_id": "section_01", "section_label": "verse" },
        { "section_id": "section_02", "section_label": "chorus" }
      ],
      "teaching_role": "repeat",
      "items": [
        { "kind": "motion", "clip_id": "plank_tap_02", "duration_sec": 2.0 },
        { "kind": "motion", "clip_id": "plank_tap_02", "duration_sec": 2.0 }
      ]
    }
  ]
}`
    }
  ]
});
