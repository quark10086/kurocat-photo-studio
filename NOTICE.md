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
  分部位（头/躯干/腹/四肢/尾）取色、花纹/眼睛/脸型/耳型/胖瘦推断，输出 `CatSkinConfig`。
- `src/catStudio.ts` — 「猫咪工坊」面板：选图、实时 2D 预览、简易/高级两档、8+ 项微调、保存并应用。
- `src/catBreeds.ts` — 8 个品种预设、花纹亲缘矩阵与匹配打分。
- `src/speciesBody.ts` — 蛇 / 鸡的 2D 形体绘制（含蛇尾、鸡爪与喙的动作）。
- `src/mouseStyles.ts` — 8 款鼠标配色与按猫 id 的确定性分配。
- `site/` — 项目落地页（GitHub Pages）。
- `docs/screenshots/*`、`docs/release-notes/*` — 功能截图与发布说明。

修改文件：

- `menu.html`、`index.html` — 「角色外观」入口、工坊面板 DOM、物种选择、键盘四档、鼠标样式行。
- `src/style.css` — 工坊、物种选择、配色分组、鼠标样式行样式。
- `src/menuMain.ts`、`src/main.ts` — 工坊初始化、切猫动效触发、鼠标风格应用、非猫物种强制 2D。
- `src/keyboardLayout.ts` — 新增 75% 与 87 TKL 阵列、`isWideKeyboard` / `normalizeKeyboardLayoutId`。
- `src/catEngine.ts`、`src/catEngine3d.ts`、`src/keyboard3d.ts` — 布局判定语义化、鼠标配色、换岗动效、
  非猫物种的分支绘制（复用原有打字目标，不改打字逻辑）。
- `src/catSkins.ts` — 新增可选 `species` 字段与解析。
- `src/agentCompanion.ts` — 新增 salute / hiss / ignore / heart 四个动作与切猫随机动效。
- `src-tauri/src/lib.rs` — 新增 `save_custom_cat`、`set_cat_studio_open` 两个命令，
  `studio_open` 焦点保护标志，四档键盘的窗口尺寸 `base_dimensions`。
- `src-tauri/src/cats.rs` — `CatSkinConfig` 新增可选 `species` 字段。
- `src-tauri/src/config.rs`、`tray.rs`、`mcp.rs` — 键盘布局四档的规范化、托盘菜单与 MCP schema。
- `locales/{zh-CN,zh-TW,en-US,ja-JP,ko-KR}.json` — 各新增材质/物种/键盘/鼠标相关文案。
- `README.md` — 改写为以新功能为中心的说明（上游说明仍可从 git 历史中查看）。
## 项目名称 / Naming

本项目取名 **KuroCat Photo Studio（黑猫照相馆）**：
「KuroCat」保留与上游的谱系关系，「Photo Studio」对应本项目的核心新增能力 —— 用一张照片冲印出一只桌宠。

## 许可证 / License

本项目与上游一致，采用 MIT 许可证，全文见 [LICENSE](LICENSE)。
分发本项目的二进制或源码时，请一并保留本文件与 LICENSE 中的上游版权声明。