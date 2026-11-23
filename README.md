# 星瀚金建 · 视频顺序连播（Tampermonkey 用户脚本）

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Userscript](https://img.shields.io/badge/Tampermonkey-Userscript-orange)](xinghan-auto-next.user.js)
[![Version](https://img.shields.io/badge/version-1.0.2-blue)](CHANGELOG.md)

一个只为「少点几次鼠标」而写的用户脚本：**当前小节播放结束后，等 10~20 秒，点目录里紧挨着的下一节**。

只做三件事：**点播放 → 等 `ended` → 切下一节**。
不伪造学时、不拖进度条、不改播放速度、不多开窗口。

> 这是一个针对单一站点的适配脚本，不是通用刷课工具。平台明示禁止「多窗口 / 并行刷课」并带有反作弊统计，
> 是否认账、学时是否记满，脚本无法保证。**使用前请先读 [免责声明](DISCLAIMER.md)。**

---

## 目录

- [这个脚本是什么](#这个脚本是什么)
- [它做什么 / 它刻意不做什么](#它做什么--它刻意不做什么)
- [安装](#安装)
- [使用](#使用)
- [配置项](#配置项)
- [工作原理（简版）](#工作原理简版)
- [常见问题](#常见问题)
- [项目结构](#项目结构)
- [版本记录](#版本记录)
- [反馈与贡献](#反馈与贡献)
- [免责声明](#免责声明)
- [License](#license)

---

## 这个脚本是什么

星瀚金建（`xinghanjjkj.com`）的课程视频页是一节一个页面（`/user/node?nodeId=NNN`），
每看完一节都要自己回目录点下一节。这个脚本把这步自动化掉：检测到视频自然播完，等待一个随机间隔，
然后点击目录里**紧邻的下一节**，整页跳转，循环往复，直到最后一节。

适用页面：

```
https://cumtyc.xinghanjjkj.com/user/node*
https://*.xinghanjjkj.com/user/node*
```

适配的播放器是站点自带的 **ckplayer**（容器 `#videoContent`），不是通用 HTML5 播放器。

---

## 它做什么 / 它刻意不做什么

| 会做 | 不会做 |
| --- | --- |
| 本页首次进入时，点播放器自带的「点击播放」按钮（最多 3 次） | 直接对 `<video>` 调 `play()`（会导致 ckplayer 状态不更新、学时为 0） |
| 监听原生 `ended`，另加 `currentTime ≥ duration - 1.2` 兜底 | 修改 `currentTime` / `playState` / `totalTime` |
| 播完后随机等待 10~20 秒再切 | 固定间隔、无延迟连跳 |
| 只点同一 `.list` 内、`nodeId` 递增且跨度 ≤ 10 的下一项 | 跳大章节、跨分组、回跳、乱跳 |
| 跨标签页心跳互斥，先开的标签页优先，其余待命 | 多标签并行播放（站点明确禁止，且会触发平台检测） |
| 切换前写入 `sessionStorage` 意图，落地后校验实际 `nodeId` | 无条件跳转、失败后继续硬跳 |
| 默认 1.0 倍速、静音、页面在后台时不切 | 默认倍速、清空平台自己的 `localStorage` 键 |
| 面板 + 本地日志（最多 300 条，可导出） | hook `XMLHttpRequest` / `fetch`，伪造 `/user/node/study` 请求 |

**一句话**：脚本只负责「翻页」，不负责「记学时」。平台算的是**真实处于播放状态的秒数**，
这部分完全由平台自己的 `video.js` 上报，脚本不介入。

---

## 安装

### 1. 安装用户脚本管理器

- Chrome / Edge / Brave：安装 [Tampermonkey](https://www.tampermonkey.net/)
- Firefox：Tampermonkey 或 [Violentmonkey](https://violentmonkey.github.io/)
- Safari：需先在 App Store 安装 Tampermonkey，并在「设置 → 扩展」中启用

### 2. 安装脚本

**方式 A：本地导入（推荐，便于自己改）**

1. 打开 Tampermonkey 面板 → 「实用工具」→ 「导入」
2. 选择本仓库的 `xinghan-auto-next.user.js`
3. 确认安装

**方式 B：手工新建**

1. Tampermonkey → 「添加新脚本」
2. 删掉模板内容，把 `xinghan-auto-next.user.js` 全文粘贴进去
3. `Ctrl/Cmd + S` 保存

**方式 C：Greasyfork（可选）**

若后续发布到 Greasyfork，直接打开脚本页点「安装此脚本」即可。仓库地址以实际发布为准。

### 3. 验证

打开任意 `/user/node?nodeId=...` 页面，右下角出现「星瀚金建 · 顺序连播」面板即安装成功。
控制台也能看到 `[星瀚·连播]` 开头的日志。

---

## 使用

1. 打开课程某一节，等面板出现。若视频没有自动起播，**手动点一下播放器左下角的播放按钮**（只需一次）。
2. 面板显示「播放中」，脚本开始接管：播完 → 倒计时 → 切下一节。
3. 中途想停：取消勾选「启用自动切换」。
4. 想立刻切：点「立即切下一节」。
5. 出问题：点「导出日志」，把 txt 贴到 Issue 里，附上 `node=` 编号、浏览器版本、脚本版本。

> 建议只开**一个**课程页面。多开时后开的页面会自动进入「待命」状态，不会并行播放。

---

## 配置项

面板里的选项都存在 `localStorage` 的 `xh_an_cfg_v1` 里：

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| 启用自动切换 `enabled` | `true` | 总开关 |
| 静音 `muted` | `true` | 只是为了让浏览器允许自动起播，**不影响学时**（学时按秒数算） |
| 倍速 `playbackRate` | `1.0` | 默认原速。倍速会让本节累计秒数少于视频时长，**可能导致学时不足**，面板会提示 |
| 播完等待 `waitMinSec` ~ `waitMaxSec` | `10` ~ `20` | 随机区间，单位秒；设为 0 表示立即切换 |
| 跳过已完成节 `skipCompleted` | `false` | 进入页面时 `#study-state == 2` 则直接切下一节 |
| 末节行为 `lastAction` | `stop` | `stop` 原地停止；`back` 返回课程页 |
| 后台不切 `requireVisible` | `true` | 页面在后台（`visibilityState !== 'visible'`）时不切，避免被浏览器节流 |
| 待命心跳 `xh_an_hb_*` | — | 每个标签页一个，15 秒过期；仅用于互斥，不上报 |
| 日志 `xh_an_logs_v1` | 300 条上限 | 跨页保留，可一键导出 |
| 跳转意图 `xh_an_pending_nav_v1` | 一次性 | `sessionStorage`，落地后立即删除，60 秒超时 |

想彻底重置：面板「恢复默认」，或在控制台执行 `localStorage.removeItem('xh_an_cfg_v1')`。

---

## 工作原理（简版）

想要完整的技术细节（页面结构、学时上报机制、平台的多窗口检测、适配其他站点的步骤），
见 **[docs/technical-notes.md](docs/technical-notes.md)**。

- **目录识别**：只取 `.detmain-navlist .list .item > a[href="/user/node?nodeId=NNN"]`。
  站点里「视频播放」tab 和讨论区「点赞」也带 `class="on"`，所以必须把范围锁死在目录容器内。
- **下一节判定**：当前项的**紧邻下一项**、同一份 `.list`、`nodeId` 递增且跨度 ≤ 10，否则拒绝切换。
- **防误切**：本页必须真的观测到 `play` 事件（`armed`）才允许自动切换；目录连续两次采样一致才动作。
- **起播**：只点 ckplayer 自己的 `[data-title="点击播放"]`（优先点内部 `canvas`，首次失败改用
  `mousedown/mouseup/click` 完整序列）。绝不直接 `video.play()`。
- **兜底**：部分播放器不派发原生 `ended`，用 `currentTime ≥ duration - 1.2` 补一次判定。
- **落点校验**：跳转前把 `{from, to, href}` 写进 `sessionStorage`；新页面读取后核对实际 `nodeId` 与目录
  选中项，不符则**永久停用**自动切换并记录错误。
- **不强行恢复**：本人或平台一旦暂停，脚本不会强推播放，自然不会触发 `ended`，也就不会切节。

---

## 常见问题

<details>
<summary><b>装了脚本没反应 / 面板不出现</b></summary>

1. 确认当前地址是 `/user/node?nodeId=...`，不是课程列表页或 `/user/course` 页。
2. Tampermonkey 里脚本处于「已启用」状态，且 `@match` 没被手动改坏。
3. 刷新页面（脚本只在页面加载时启动一次）。
4. 打开控制台看有没有 `[星瀚·连播]` 日志；没有则说明脚本没注入（检查扩展权限 / 其他脚本冲突）。
</details>

<details>
<summary><b>为什么视频不自动起播？</b></summary>

Chrome 的自动播放策略：没有用户手势时，只有 `muted` 的视频才允许自动播放。
脚本已经默认静音并尝试点播放按钮；若仍失败（日志提示「自动起播 3 次都未生效」），
**手动点一次播放器上的播放按钮**即可，之后脚本自动接管，不再重复打扰。
</details>

<details>
<summary><b>播完了却不切下一节</b></summary>

面板和日志会给出原因，常见有：

- `本页尚未观测到播放，不切换`：没有检测到 `play` 事件（多为直接调 `play()` 或播放器状态没同步）。
- `目录尚未稳定`：页面还在加载/刷新目录，等两秒会自动重试。
- `页面在后台，暂不切换`：取消勾选「后台不切」，或把标签页切到前台。
- `没有合法的紧邻下一节`：已到最后一节，或目录结构变化（`nodeId` 不再连续）。
- `落点校验失败，已停用`：上一次跳转落到了意外的 `nodeId`，脚本为安全起见停用，需刷新并检查目录。
- `视频加载失败，等待恢复`：网络/资源问题，视频恢复后自动继续。
</details>

<details>
<summary><b>学时没记满 / 学时为 0</b></summary>

平台按「`playState === 'playing'` 的真实秒数」累计学时，不按视频进度算。所以：

- 倍速播放 → 累计秒数少于视频时长，学时可能不足（面板会标黄提示）。
- 中途暂停、切后台被节流 → 少算。
- 直接 `video.play()` 绕过 ckplayer → `playState` 不变，可能一秒钟都不算。

脚本默认原速、静音、不 seek，就是为了不踩这些坑；但它**不能替你保证学时被认账**。
</details>

<details>
<summary><b>开了两个标签页，只有一个在跑？</b></summary>

这是设计如此。站点明确禁止多窗口并行播放，且平台每 567ms 写一次 `localStorage['node_play_...']` 做检测。
脚本用 15 秒心跳互斥，先开的标签页优先，后开的自动「待命」，避免自己触发平台的告警。
</details>

<details>
<summary><b>会不会被判定为作弊？</b></summary>

脚本不做伪造：不 hook 请求、不改 `studyTime`、不改 `playState`、不拖进度。它只是把「点下一节」这一步自动化。
但平台声明会统计浏览器头、播放器记录、鼠标轨迹等用于评估真实性，**脚本不具备也不提供任何规避检测的能力**。
风险与后果请自行评估，见 [DISCLAIMER.md](DISCLAIMER.md)。
</details>

<details>
<summary><b>能改成支持别的平台吗？</b></summary>

可以，但适配层要重写：目录选择器、播放器容器、播放按钮、结束判定都要换。
步骤见 [docs/technical-notes.md](docs/technical-notes.md) 的「移植到其他站点」一节。
欢迎以 PR 形式提交，但**不接受任何以规避检测、伪造学时为目的的改动**。
</details>

<details>
<summary><b>怎么反馈问题最有效？</b></summary>

附三样东西：① 面板「导出日志」的 txt；② 当前 `node` 编号与目录结构截图；
③ 浏览器 + Tampermonkey + 脚本版本。必要时用 [tools/xinghan-probe.user.js](tools/xinghan-probe.user.js)
采集一份只读的结构 JSON。
</details>

---

## 项目结构

```
.
├── xinghan-auto-next.user.js     # 主脚本（唯一需要安装的文件）
├── README.md                     # 本文件
├── CHANGELOG.md                  # 版本记录
├── DISCLAIMER.md                 # 免责声明与合规说明
├── LICENSE                       # MIT
├── .gitignore
├── docs/
│   └── technical-notes.md        # 页面结构 / 学时机制 / 适配指南
├── tools/
│   └── xinghan-probe.user.js     # 只读诊断脚本（采集 JSON，不发请求）
└── .github/
    ├── ISSUE_TEMPLATE/bug-report.yml
    └── workflows/check.yml       # 语法检查
```

---

## 版本记录

完整记录见 [CHANGELOG.md](CHANGELOG.md)。

| 版本 | 要点 |
| --- | --- |
| `1.0.2` | 移除全部验证码/弹窗文本检测，修正 v1.0.0 全局文本匹配导致的整体停摆 |
| `1.0.1` | 起播加固：优先点 `canvas`，失败改用完整鼠标序列重试 |
| `1.0.0` | 初始版本：单页顺序连播、跨标签互斥、落点校验、面板与日志 |

---

## 反馈与贡献

- 提交 Issue 请使用 [Bug 反馈模板](.github/ISSUE_TEMPLATE/bug-report.yml)，附日志。
- 提交 PR 前请确认：不新增网络请求伪造、不引入规避检测逻辑、不改变默认原速行为。
- 本项目面向「单一站点的页面自动化」维护，不追求做成通用刷课框架。

---

## 免责声明

本项目仅用于**减少手动翻页操作**，不用于替代学习过程，也不鼓励任何违反平台协议或学校规定的行为。
使用者应自行确认所在平台的服务条款与教学管理要求。完整条款见 **[DISCLAIMER.md](DISCLAIMER.md)**。

---

## License

[MIT](LICENSE) © 2026 胡耀刚

脚本按「现状」提供，不附带任何明示或暗示的担保。
