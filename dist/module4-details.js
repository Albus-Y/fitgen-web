// 依据 myserverl40 的 Module2_xtw v0.4.2 当前工作树核对（2026-11-25）。
// 主要依据：motion_beat_extractor/core.py、xtw/descriptors.py、xtw/drop_dtw.py、
// xtw/time_warper.py、xtw/event_warper.py、xtw/resampling.py。
// GDTW 目标按当前后端的平方误差、累计偏移与原始斜率惩罚写成连续形式。
Object.assign(window.FITGEN_MODULES.find(module => module.id === 4), {
  description: "调整已有动作的播放节奏，让动作节拍与音乐拍点对齐，并适配目标片段时长。",
  status: "单段动作变速已实现",
  input: ["三维骨架动作与源帧率", "音乐拍点与目标片段时长"],
  output: ["30 FPS 变速骨架动作", "时间映射与对齐诊断"],
  next: "变速后的动作片段交给模块 5，按编排顺序拼接。",
  demos: [
    {
      title: "动作节拍检测demo",
      description: "选择 4 段健身动作，对照真人视频、SMPL-X 骨架与动作节拍，原速回放并可开关原音乐。",
      url: "motion-beat-demo/index.html"
    },
    {
      title: "Pamela音乐-动作beat分析demo",
      description: "对照 3 段 Pamela 动作的原音乐八拍网格与动作 beat，支持独立提示音、拍点定位和八拍循环。",
      url: "pamela-beat-demo/index.html"
    },
    {
      title: "原子动作八拍编排 demo",
      description: "在一个八拍内对比原速循环、服务器 Anchor xTW 与 GPT-6.2 Astra 编排。慢速深蹲还可切换到两个八拍，查看 Anchor xTW 怎样跨组安排整数轮动作。",
      url: "pamela-dtw-demo/index.html",
      tag: { label: "Demo 3 · 原子动作八拍编排", query: "?window=2&rate=1.2" }
    }
  ],
  overviewSections: [
    {
      title: "把已有动作放到音乐时间轴上",
      steps: ["动作节拍", "拍点匹配", "受约束时间映射", "30 FPS 动作"],
      paragraphs: [
        String.raw`编排模块选定动作后，DTW 负责决定它应当怎样快放或慢放。输入是骨架序列 $X\in\mathbb{R}^{T\times J\times3}$、源帧率 $f_m$，以及模块 1 给出的音乐拍点。$T$ 是帧数，$J$ 是关节数；原动作时长记为 $D_m$，目标音乐片段时长记为 $D_s$。`,
        String.raw`核心是求时间映射 $\phi$：音乐播放到 $t$ 秒时，读取原动作 $\phi(t)$ 秒处的姿态。输出动作记为 $Y$，音乐保持原速，动作的前后顺序保持不变。`,
        String.raw`例如，把 6 秒动作放进 4 秒音乐，匀速方案是 $\phi(t)=1.5t$，音乐第 2 秒对应原动作第 3 秒。DTW 在此基础上允许局部快慢变化，让动作中的停顿或换向更接近音乐拍点。`
      ],
      math: String.raw`\begin{aligned}
        D_m&=\frac{T-1}{f_m},\qquad t\in[0,D_s]\\
        t_{\mathrm{motion}}&=\phi(t),\qquad Y(t)=X\bigl(\phi(t)\bigr)
      \end{aligned}`
    },
    {
      title: "① 提取动作节拍：寻找运动的低谷",
      paragraphs: [
        String.raw`先计算相邻两帧的关节位移，加权得到一条运动强度曲线 $v_k$，再用高斯滤波 $G_{\sigma_v}$ 平滑，$\sigma_v$ 控制平滑宽度。$X_{k,j}$ 是第 $k$ 帧第 $j$ 个关节的位置，$w_j$ 是归一化关节权重，默认等权。`,
        String.raw`平滑曲线的局部极小值对应减速、短暂停顿或换向的候选时刻。把这些低谷的索引记为 $k_i$，换算成动作节拍 $m_i$。这里的 $v_k$ 是帧间位移指标；音乐节拍 $s_j$ 则直接使用模块 1 的秒级结果。`
      ],
      math: String.raw`\begin{aligned}
        v_k&=\sum_{j=1}^{J}w_j\lVert X_{k+1,j}-X_{k,j}\rVert_2,\quad \sum_j w_j=1\\
        \widetilde v&=G_{\sigma_v}*v,\qquad m_i=\frac{k_i}{f_m}
      \end{aligned}`
    },
    {
      title: "② 匹配拍点：允许有些拍不对应",
      paragraphs: [
        String.raw`动作和音乐的拍点数可能不同，逐个强行配对会拉乱节奏。默认 Anchor 路线先为每个拍点构造描述子 $z$：在整段中的相对位置，以及前后拍间隔的对数。式中 $b$ 表示该侧的拍点时间，$D$ 是该侧时长，$\Delta^-$、$\Delta^+$ 是前后间隔。`,
        String.raw`动作拍 $m_i$ 与音乐拍 $s_j$ 的匹配代价 $C_{ij}$ 是描述子的加权绝对差，$a_\ell$ 控制三项特征的权重。位置项衡量它们是否处于片段的相近阶段，间隔项衡量附近的节奏疏密。`,
        String.raw`Drop-DTW 用动态规划在“匹配、跳过动作拍、跳过音乐拍”三种选择中寻找总成本最低的路径。$F_{i,j}$ 表示前 $i$ 个动作拍与前 $j$ 个音乐拍的最小成本，$\gamma_m,\gamma_s$ 是跳过拍点的代价。`,
        "最终得到保持时间顺序的一对一匹配，作为下一步的时间锚点。跳过的是拍点匹配，原动作片段仍完整保留。"
      ],
      math: String.raw`\begin{aligned}
        z(b;D)&=\bigl[b/D,\ \log\Delta^-,\ \log\Delta^+\bigr]\\
        C_{ij}&=\sum_{\ell=1}^{3}a_\ell\left|z_\ell(m_i;D_m)-z_\ell(s_j;D_s)\right|\\[4pt]
        F_{i,j}&=\min\begin{cases}
          F_{i-1,j-1}+C_{ij} & \text{匹配}\\
          F_{i-1,j}+\gamma_m & \text{跳过动作拍}\\
          F_{i,j-1}+\gamma_s & \text{跳过音乐拍}
        \end{cases}
      \end{aligned}`
    },
    {
      title: "③ 求解时间映射：在合拍与变速幅度间权衡",
      paragraphs: [
        String.raw`将匹配拍点连同起点、终点连接，得到分段线性的参考映射。GDTW（广义动态时间规整）在它的引导下寻找受约束的映射，不要求结果精确穿过每一个锚点。`,
        String.raw`求解时将两侧时间归一化到 $[0,1]$：$u=t/D_s$，$\psi(u)=\phi(D_su)/D_m$，归一化后的参考映射记为 $r(u)$。下面用连续形式说明目标，实际在离散网格上求解。`,
        String.raw`三项依次鼓励贴近拍点参考、少偏离整体匀速进度、避免过大的局部斜率。$\lambda_c,\lambda_v$ 控制后两项的权重；斜率项约束变速幅度，并不直接惩罚加速度。`,
        String.raw`真实秒时间下固定 $\phi(0)=0$、$\phi(D_s)=D_m$，默认要求 $0.5\leq\phi'(t)\leq2$。斜率为 1 表示原速，大于 1 加速，小于 1 减速；正斜率保证动作不会倒放。求解时将这组速度界限换算到归一化时间轴。`
      ],
      math: String.raw`\begin{aligned}
        \min_{\psi}\quad &\int_0^1\bigl(\psi(u)-r(u)\bigr)^2\,du\\
        &+\lambda_c\int_0^1\bigl(\psi(u)-u\bigr)^2\,du\\
        &+\lambda_v\int_0^1\bigl(\psi'(u)\bigr)^2\,du
      \end{aligned}`
    },
    {
      title: "可选 Event 路线：直接对齐节拍曲线",
      paragraphs: [
        String.raw`另一条已实现的路线在每个拍点周围放一个高斯峰，得到动作曲线 $e_m$ 和音乐曲线 $e_s$。$b_i$ 是对应一侧的拍点，$\sigma_e$ 控制峰在秒时间轴上的宽度；多个峰重叠时取最大值。`,
        String.raw`Event 路线直接比较变速后的动作事件曲线与音乐事件曲线，替换上一步的第一项匹配误差，共用其余正则项和首尾、速度约束。它省去描述子和 Drop-DTW，作为显式可选的对比路线；默认仍使用 Anchor。`
      ],
      math: String.raw`\begin{aligned}
        e(t)&=\max_i\exp\!\left(-\frac{(t-b_i)^2}{2\sigma_e^2}\right)\\
        E_{\mathrm{event}}&=\int_0^1\!\bigl[e_m(D_m\psi(u))-e_s(D_su)\bigr]^2\,du
      \end{aligned}`
    },
    {
      title: "④ 重采样：得到真正可播放的动作",
      paragraphs: [
        String.raw`获得 $\phi$ 后，在音乐时间轴上每秒取 30 帧。每个输出时刻 $t_n$ 先映射回原动作时间，再按源帧率换成帧位置 $q_n$；若落在两帧之间，就对关节位置做线性插值。所有关节使用同一条时间映射。`,
        String.raw`式中 $k_n$ 是前一帧，$\alpha_n$ 是两帧间的比例，后一帧 $k_n^+$ 在片段末尾限制为最后一帧。输出共 $N=\lceil30D_s\rceil$ 帧，同时保留时间映射、局部速度和对齐诊断，供后续拼接与检查。`
      ],
      math: String.raw`\begin{aligned}
        t_n&=n/30,\qquad q_n=f_m\phi(t_n)\\
        k_n&=\lfloor q_n\rfloor,\qquad \alpha_n=q_n-k_n\\
        k_n^+&=\min(k_n+1,T-1)\\
        Y_n&=(1-\alpha_n)X_{k_n}+\alpha_n X_{k_n^+}
      \end{aligned}`
    },
    {
      title: "当前能力与使用边界",
      paragraphs: [
        String.raw`已实现单段动作的完整变速流程。由于固定首尾，平均速度 $D_m/D_s$ 必须落在允许范围内；例如把 10 秒动作压进 4 秒音乐，需要 2.5 倍速度，超出默认上限时会明确报错。`,
        "当前插值对象是三维关节位置，尚不包含旋转插值、脚底锁定或物理约束，可能出现骨长漂移。拍点匹配也不保证每一个音乐拍都有动作响应，效果需要结合动作回放检查。",
        "与编排、整曲拼接的串联仍待接入；现有 Demo 用于观察当前效果。"
      ]
    }
  ]
});
