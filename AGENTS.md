# FitGen 协作约定

- 默认使用简体中文交流、编写说明和注释。
- 批量删除文件前询问用户；安装依赖、配置新环境或修改现有环境前询问用户。
- 网站源码与静态资源统一在当前仓库维护，不要再创建一份人工同步的发布源码目录。
- 主页与普通模块直接编辑 `dist/`。OpenSim 四页正文编辑 `content/opensim-note/`，页面结构编辑 `templates/opensim-note.html`，然后运行 `python3 scripts/build.py`。
- 不要只修改 OpenSim 的生成 HTML；将输入 Markdown、模板与生成结果一起提交。
- 写入本地 Markdown 的行内公式使用 `$...$`，多行公式使用 `$$...$$`。
- 提交前运行 `python3 scripts/build.py` 和 `python3 scripts/check.py`；涉及交互或布局时再进行适当的浏览器检查。
- 媒体分片、`dist/media-manifest.js` 与加载器要配套保留。不要直接把被分片代替的音视频引用改成不存在的文件。
- 不依赖原作者的绝对文件路径；所需输入都放在仓库内，路径相对仓库或脚本定位。
- 日常通过分支和 Pull Request 协作。GitHub 是正式修改的汇合点；在别处产生的修改先同步回来。
- 只有用户明确要求发布时才更新现有 Site。保留 `.openai/hosting.json` 的 `project_id`、网址和访问设置，不另建 Site。
- GitHub 推送与 Sites 发布是两个独立动作。发布前检查两边源码历史，发生分歧时先合并，不能强制覆盖。
- 不把账号令牌、短期发布凭证、本机环境文件或本地运行记录提交到 Git。
