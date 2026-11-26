# 原创来源与致谢 / Attribution

## 上游项目 / Upstream project

本仓库是下列项目的衍生作品（derivative work），基于其 v5.1.3 源码：

- **KuroCat** — https://github.com/qianyiai/kurocat
- 官网 / Website: https://qianyi.one/kurocat/
- 许可证 / License: MIT
- 版权 / Copyright (c) 2026 KuroCat Contributors

上游的代码、资源、图标与文案，其版权与署名权归 KuroCat Contributors 所有。
本仓库不主张对上游部分的任何额外权利。

## 本项目的改动 / Modifications

在完整保留上游代码的前提下，新增了「从图片创建我的猫」（photo → cat appearance）能力：

新增文件：

- `src/photoCat.ts` — 本地图片分析：缩放采样、确定性 k-means 取色、外圈 15% 边缘带背景剔除、
  花纹/眼睛/脸型/耳型/胖瘦推断，输出 `CatSkinConfig`。
- `src/catStudio.ts` — 「猫咪工坊」面板：选图、实时 2D 预览、8 项微调、保存并应用。
- `docs/screenshots/*` — 功能截图。

修改文件：

- `menu.html` — 「角色外观」卡片内新增入口按钮，以及工坊面板的 DOM 结构。
- `src/style.css` — 工坊与入口按钮样式。
- `src/menuMain.ts` — 工坊初始化、入口点击、Esc 优先关闭工坊。
- `src-tauri/src/lib.rs` — 新增 `save_custom_cat`、`set_cat_studio_open` 两个命令，以及
  `studio_open` 焦点保护标志（避免系统选图对话框触发侧边菜单自动隐藏）。
- `locales/{zh-CN,zh-TW,en-US,ja-JP,ko-KR}.json` — 各新增 38 条界面文案。
- `README.md` — 改写为以新功能为中心的说明（上游说明仍可从 git 历史中查看）。

除上述改动外，原有功能、设置、渲染引擎、MCP/钩子联动逻辑均未修改。

## 项目名称 / Naming

本项目取名 **KuroCat Photo Studio（黑猫照相馆）**：
「KuroCat」保留与上游的谱系关系，「Photo Studio」对应本项目的核心新增能力 —— 用一张照片冲印出一只桌宠。

## 许可证 / License

本项目与上游一致，采用 MIT 许可证，全文见 [LICENSE](LICENSE)。
分发本项目的二进制或源码时，请一并保留本文件与 LICENSE 中的上游版权声明。