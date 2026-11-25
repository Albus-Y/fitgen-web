Object.assign(window.FITGEN_MODULES.find(module => module.id === 8), {
  demoTitle: "MyoFullBody 肌肉跟踪回放",
  demoDescription: "选择五条 HIIT 动作之一，比较三种加宽策略的实际动作和肌肉激活。",
  demoUrl: "muscle-studio/index.html",
  overviewMeta: "当前流程",
  overviewSections: [
    {
      title: "从 SMPL-X 动作到仿真记录",
      steps: ["SMPL-X 动作", "动作重定向", "MyoFullBody 参考动作", "策略在 MuJoCo 中跟踪"],
      paragraphs: ["跟踪策略驱动模型肌肉完成参考动作。仿真同步记录模型实际完成的动作，以及每一时刻的肌肉激活等状态。"]
    },
    {
      title: "同一段仿真记录得到两项结果",
      table: {
        headers: ["输出", "计算方式"],
        rows: [
          ["能量消耗", "将仿真动作与肌肉状态送入 Umberger 代谢模型，按动作时长累计代谢功率，估计整段消耗的能量。"],
          ["锻炼肌群", "结合仿真中实际完成的动作和各肌束的激活等信息，按解剖肌群汇总，识别主要参与的肌群。"]
        ]
      }
    }
  ]
});
