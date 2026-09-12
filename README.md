# SkillLudo Client

Cocos Creator **3.8.8**，2D 矢量棋盘 + 真实 3D 飞机/骰子。权威规则和随机数由相邻仓库 `../SkillLudo_Server` 提供，当前协议版本 **4**，必须配套更新。

房间通过下拉框选择期望阵营：英国（红）、法国（黄）、中国（蓝）、美国（绿）。双骰可反复预选，立即高亮可动飞机，点击飞机同时提交点数与目标；无可动飞机可换点数或确认跳过。登录页/大厅可查看技能图鉴，对局中通过“阵营技能 / 图鉴”改点、选目标或强化。AI 仅触发被动，已有强制反向调整仍需执行。

房间最多四个参赛席和两个观战席，下拉框可选择观战；观战可聊天，不能操作飞机。当前玩家 30 秒无有效操作进入托管，最后 10 秒红字提醒。技术暂停投票通过后封存 2 分钟，可离开网页再重连。冠军产生后弹框投票，一次性决定是否继续角逐第二名。聊天浮窗停留 30 秒，技能就绪/被动触发时有系统公告与橙色三次闪烁。

大厅图鉴位于创建/加入房间下方。所有场景左上角的齿轮可打开设置，通过滑动开关控制消息浮窗，选择在本机保存；关闭后仍可查看聊天记录。棋局浮窗更小、背景浅色半透明，最多三条。详见 [设置与消息浮窗](docs/设置与消息浮窗.md)，交互回归命令为 `npm run verify:settings`。

虫洞仅碰撞两端，整次行动最多一次同色跳跃。英国觉醒前可一次绑定敌机；绑定/诅咒有标记和同行动画。中国觉醒累计严格超过 100，升级后的图鉴动态说明免反向、储备和 ±2 范围；英国/中国改点不连投。

## 开发与构建

在 Creator 打开本项目和现有 `assets/scenes/Main.scene`，不需要重新搭场景。棋盘、模型和界面在运行时生成，编辑器静态视图不显示完整游戏。`GameController.serverUrl` 留空自动选择：公网网页连接本站，Creator 本地预览连接 `ws://81.70.145.148`；需要本机联调时显式填 `ws://127.0.0.1:3000` 并启动本机后端及 MySQL。

网页入口为 <http://81.70.145.148>。`npm run deploy:web` 可构建并发布到服务器，完整说明见 [Web 部署](docs/Web部署.md)。

网页支持默认缩放下的高分屏及横竖屏切换；微信小游戏构建使用横屏。屏幕尺寸与点击坐标回归运行 `npm run verify:viewport`，详见 [屏幕适配与微信横屏](docs/屏幕适配与微信横屏.md)。

```powershell
npm ci
npm run check
npm test
npm run board:export
npm run build:web
npm run preview:build
```

首次克隆应先让 Creator 导入项目，以生成 `temp/tsconfig.cocos.json`。命令行构建脚本默认查找 Windows 安装位置；不同安装位置设置 `COCOS_CREATOR` 为 Creator 3.8.8 可执行文件路径。正式 Web 产物在 `build/web-desktop`，本地静态服务端口 7459。需要调试构建时设置 `SKILLLUDO_DEBUG_BUILD=1`，正常构建默认关闭调试。

## 代码入口

| 模块 | 职责 |
| --- | --- |
| `BoardGeometry / BoardArtwork / BoardLayout` | 原图描图、96 格心、校准覆盖和标准坐标 |
| `BoardScene3D / TokenMeshes` | 网格模型、独立正交相机、透明渲染合成、落点阴影和点击区域 |
| `DiceView3D / DiceMotion` | 六面骰子、抛掷/回弹、服务器点数定面和重连恢复 |
| `BoardController / MotionTimeline` | 逐格移动、跳跃、虫洞、吃子、终点返航；可取消动画 |
| `GameController / PresentationQueue / NetworkManager` | 命令、顺序播放消息、快照、输入锁、断线恢复 |
| `GameUI / MatchHud` | 账号/房间与对局操作界面 |
| `SkillDialogs / ActionSelection` | 图鉴、改点预览、受击选择、目标确认与可撤销选骰 |
| `MatchOverlays / MatchPresentation` | 30 秒聊天浮窗、挂机倒计时、技术暂停和胜后投票 |
| `SkillCatalog / GameProtocol / PathData` | 服务端生成的技能文案、协议和公共航线映射 |
| `ResponsiveCanvas / GameViewport` | 横竖屏等比画布、棋盘和操作区布局 |

新默认棋盘由代码绘制，原 PNG `assets/resources/textures/ludo-classic-board-cropped.png` 保留作参照。复刻图与逐格标记见 `docs/board/classic-board-v2.svg`、`anchors-review.svg`、`default-positions.json`。全部默认格心来自同一几何数据，普通落子无额外 XY 偏移，叠子使用高度区分。

管理账号的校准入口与聊天 `adjust 01` 等命令保留。拖动黑色标记后确认，保存到服务端 `config/board-positions.json`；旋转只影响显示，保存坐标会逆变换回标准棋盘坐标。已有校准覆盖继续有效，无覆盖时直接使用新默认格心。

## 联机验收

相邻服务端仓库执行 `npm run verify:server`（端口 3101，内存身份、无需 MySQL），客户端另一个终端执行 `npm run preview:build`。然后：

```powershell
npm run verify:fixtures
npm run verify:browser
```

浏览器脚本使用 Playwright 和本机 Chrome。可通过 `PLAYWRIGHT_PATH`、`SKILLLUDO_BROWSER` 指定路径；本机 Codex 依赖也可自动发现。`verify:browser` 只在测试浏览器中显式连接 3101（可用 `SKILLLUDO_TEST_SERVER` 覆盖），并设置本地游客 UI；这不修改正式认证流程。检查包括真实点击下拉框/图鉴/双骰反复预选/飞机一次提交、重连、视角、特殊动作、格心、旋转校准和横竖屏。`docs/verification/README.md` 区分真实联机和本地表现夹具。`verify:published` 单独验收公网网页和实际自动选址，不使用端口替换。

技能表现回归：先在服务端运行 `npm run verify:skill-fixtures`，再运行本仓 `npm run verify:skills` 和 `npm run verify:lifecycle`。七组权威场景覆盖原技能、英国绑定同行/检查点落下；新流程同时点击验证观战、技能闪烁、托管提示、暂停和冠军投票及竖屏。脚本隔离网络并核对命令，不等同于真实网络回合。真实 WebSocket 由服务端 `SkillNetwork.test.ts`、`Spectators.test.ts`、`LifecycleSockets.test.ts` 覆盖。本仓 22 项纯逻辑回归。

## 微信小游戏

```powershell
$env:WECHAT_APP_ID = '<你的小游戏 AppID>'
npm run build:wechat
npm run verify:wechat
```

导入微信开发者工具的目录为 `build/wechatgame`。未设置 AppID 时用 `touristappid` 生成验证包；2026-09-11 验证产物为 30 个文件、3,556,038 字节（约 3.56 MB），低于 4 MiB 静态预算。保持横屏、真实 3D 网格与程序动画，不依赖 3D 物理或额外 WASM。原图仍在包内。

这次已完成 Creator 构建和静态包体检查，尚未完成微信真机运行、上传或审核。上线配置还需真实 AppID、客户端 WSS 地址、微信后台 socket 合法域名、服务端微信登录凭证校验；生产环境关闭调试骰子。微信端内存、帧率、RenderTexture、切后台恢复及刘海/胶囊安全区须在真机验收。

平台依据：[Cocos 微信发布文档](https://docs.cocos.com/creator/3.8/manual/en/editor/publish/publish-wechatgame.html)、[RenderTexture](https://docs.cocos.com/creator/3.8/manual/en/asset/render-texture.html)、[命令行构建](https://docs.cocos.com/creator/3.8/manual/en/editor/publish/publish-in-command-line.html)。恢复进度见 `docs/重构进度日志.md`。
