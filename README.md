# FitGen

FitGen 项目主页、模块路线图与研究汇报。通过 GitHub 协作，合并到 `main` 后自动构建、检查并发布到 GitHub Pages。

GitHub Pages：[FitGen](https://albus-y.github.io/fitgen-web/)

现有 Sites 地址：[FitGen Sites](https://fitgen-roadmap.fafafalalaa1.chatgpt.site)

## 本地浏览与检查

使用 Python 3.9 或更新版本，仅使用标准库，无需安装第三方依赖。在仓库根目录运行：

```bash
python3 scripts/build.py
python3 scripts/check.py
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

然后打开 <http://127.0.0.1:8000/>。按 `Ctrl+C` 停止预览。

主页和汇报页面也可直接打开 HTML。音视频 Demo 通过 HTTP 加载本仓库内的分片，因此完整预览请使用上面的本地服务。

## 项目结构

```text
dist/                         网站文件，也是 GitHub Pages 与 Sites 的静态发布目录
  index.html                  主页、路线图与汇报入口
  modules.js                  模块职责、输入、输出与流向
  module1-details.js          音乐分析说明
  module4-details.js          DTW 动作变速说明
  module8-details.js          能耗计算说明
  demo/                       音乐分析 Demo
  motion-beat-demo/            动作节拍检测 Demo，四段动作与原音乐切换
  xtw-demo/                   DTW Demo 制作中占位页
  energy-demo/                物理跟踪 Demo
  muscle-studio/              肌骨回放及带来源校验的静态数据包
  opensim-note/               四页 OpenSim 汇报、样式、脚本和配图
  vendor/katex/               公式排版资源及原许可证
content/opensim-note/         四页汇报的 Markdown、原始笔记和映射清单
templates/opensim-note.html   四页汇报共用的页面模板
scripts/build.py             从 Markdown 与模板生成汇报 HTML
scripts/check.py             检查本地链接和媒体分片
scripts/export_muscle_demo.py 从已有仿真归档导出肌骨回放
.github/workflows/pages.yml   构建检查与 GitHub Pages 自动发布
.openai/hosting.json          现有 FitGen Site 的项目绑定
AGENTS.md                    面向协作者与编码助手的约定
```

普通页面直接编辑 `dist/` 中的 HTML、CSS、JavaScript。OpenSim 汇报正文编辑 `content/opensim-note/` 下的 `index.md`、`model.md`、`pipeline.md`、`issues.md`，随后运行生成命令。生成的 HTML 也提交到 Git，保证拉取后能直接预览和发布；不要同时手改这四个生成页面。

`原文.md` 是原始笔记的快照，提供网页中的下载入口。四页正文是单独维护的展示版本；修改原始快照不会自动重写这四页。

当前 Markdown 生成器支持本次汇报使用的标题、段落、列表、表格、围栏代码、公式和 Obsidian 图片嵌入。公式在 Markdown 中使用行内 `$...$` 和独立 `$$...$$`。图片嵌入名称由 `images.json` 映射到 `dist/opensim-note/assets/`，新图片需要同时更新映射。

## 协作方式

1. 从 GitHub 拉取最新 `main`，为本次修改创建独立分支。
2. 修改内容，运行生成与检查命令，进行本地预览。
3. 提交修改并发起 Pull Request，由另一位协作者检查后合并。
4. 合并到 `main` 后，GitHub Actions 自动检查并发布到 GitHub Pages；如需同步现有 Sites，由发布负责人单独操作。

所有正式修改都先进入 GitHub，包括通过 ChatGPT 或 Codex 完成的修改。合作者可以使用自己的账号修改本地代码，无需获得原 Site 的编辑权限。

## 发布到 GitHub Pages

仓库的 Settings → Pages → Build and deployment → Source 使用 `GitHub Actions`。

`.github/workflows/pages.yml` 在 Pull Request 中运行构建与资源检查；推送到 `main` 后，检查通过即上传 `dist/` 并发布。也可从 Actions 页面手动运行，只有 `main` 分支会执行发布。

网站完全使用静态资源：音乐 Demo 展示预先分析的四首音乐，肌骨回放读取预先导出的数据，动作节拍检测 Demo 展示四段动作的真人视频、SMPL-X 骨架和 beat 对照。网页运行不需要后端接口或计算服务器。

动作节拍检测 Demo 默认开启原音乐、使用 1 倍速，点击播放后开始回放。可切换动作、原速/半速和原音乐，并定位检测出的 beat。查看页、视频、封面和公开参数摘要均位于 `dist/motion-beat-demo/`，使用站内相对路径；不包含原始 GLB、服务器路径或运行记录。完整 DTW 变速 Demo 仍待接入。

## 发布到现有 Sites

本仓库保留了原 Site 的源码历史与 `.openai/hosting.json`，继续使用同一个 `project_id`，不要创建新 Site 或更改访问范围。

准备发布时，可对站点所有者账号下的 Codex 或 ChatGPT 说：

> 将这个仓库最新 main 的内容发布到现有 FitGen Site。先核对 GitHub 与 Sites 源码历史，运行本地生成和检查，保留原 project_id、网址和访问设置。

Sites 的发布流程包括同步到 Sites 自带的源码仓库、打包、保存版本和部署。推送到 GitHub 会自动更新 GitHub Pages，但不会自动更新 Sites 地址。若 Sites 源码发生了独立修改，应先合并回 GitHub，再继续发布；不使用强制推送覆盖另一边的修改。

发布过程如果产生新的源码提交，也应同步回 GitHub，使两边的历史能继续合并。发布工具由 Sites 插件提供，本仓库不包含其短期凭证。

## 媒体与源码范围

仓库保留现有 Demo 所需的音视频分片、加载器和清单，完整运行不依赖上级目录或原作者的 Obsidian 文件。初始网站资源约 193 MB。普通代码修改可增量推送，Sites 的发布包仍可能包含完整媒体资源。

当前项目包含网站展示、交互代码、笔记与静态资源。页面描述的音乐分析、DTW、物理仿真等服务器算法源码不在这个网站仓库内。

保留已有第三方资源的许可证。仓库公开展示不代表新增开源授权。

## 肌骨回放数据更新

`muscle-studio` 的“前后分腿屈膝”使用 `breath-by-breath__zy_HIIT_x_right_0950-0960`，包含开头的弓步及随后的重复弓步、提膝。三组 Tracking 来自 `fitgen_lunge_0950_capture_20261125_v1/evaluations/attempt_01`；其他四个动作仍来自 `hiit_equal_activation50000_revisit_20261122_v1/evaluations/attempt_03`。数据包记录参考、checkpoint、实际状态文件的 SHA-256，以及采集实验和执行批次。

仅在已有 MyoFullBody 导出环境中运行下面的命令。各路径由调用者提供；网页浏览不依赖该环境。局部导出要求输出目录已有 `catalog.json`，只替换指定动作的参考与三组真实回放，并按实际状态重新计算激活、得分和误差：

```bash
python scripts/export_muscle_demo.py \
  --project "$MYOFULLBODY_PROJECT" --archive "$TRACKING_ARCHIVE" \
  --capture "$LUNGE_CAPTURE/evaluations/attempt_01" \
  --clip split-squat --output dist/muscle-studio/data
```

完整导出时省略 `--clip`，并重复传入两组 `--capture` 执行批次路径。后传入的来源覆盖同名片段。静态分片 URL 带内容哈希，目录清单会重新校验缓存，避免替换片段后加载旧回放。
