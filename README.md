# SkillLudo Client

Cocos Creator **3.8.8**，2D 矢量棋盘 + 真实 3D 飞机/骰子。权威规则和随机数由相邻仓库 `../SkillLudo_Server` 提供，当前协议版本 **2**，必须配套更新。

## 开发与构建

在 Creator 打开本项目和现有 `assets/scenes/Main.scene`，不需要重新搭场景。棋盘、模型和界面在运行时生成，编辑器静态视图不显示完整游戏。`GameController.serverUrl` 留空自动选择：公网网页连接本站，Creator 本地预览连接 `ws://81.70.145.148`；需要本机联调时显式填 `ws://127.0.0.1:3000` 并启动本机后端及 MySQL。

网页入口为 <http://81.70.145.148>。`npm run deploy:web` 可构建并发布到服务器，完整说明见 [Web 部署](docs/Web部署.md)。

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
| `ResponsiveCanvas / GameViewport` | 横竖屏等比画布、棋盘和操作区布局 |

新默认棋盘由代码绘制，原 PNG `assets/resources/textures/ludo-classic-board-cropped.png` 保留作参照。复刻图与逐格标记见 `docs/board/classic-board-v2.svg`、`anchors-review.svg`、`default-positions.json`。全部默认格心来自同一几何数据，普通落子无额外 XY 偏移，叠子使用高度区分。

管理账号的校准入口与聊天 `adjust 01` 等命令保留。拖动黑色标记后确认，保存到服务端 `config/board-positions.json`；旋转只影响显示，保存坐标会逆变换回标准棋盘坐标。已有校准覆盖继续有效，无覆盖时直接使用新默认格心。

## 联机验收

相邻服务端仓库执行 `npm run verify:server`（端口 3101，内存身份、无需 MySQL），客户端另一个终端执行 `npm run preview:build`。然后：

```powershell
npm run verify:fixtures
npm run verify:browser
```

浏览器脚本使用 Playwright 和本机 Chrome。可通过 `PLAYWRIGHT_PATH`、`SKILLLUDO_BROWSER` 指定路径；本机 Codex 依赖也可自动发现。`verify:browser` 只在测试浏览器中显式连接 3101（可用 `SKILLLUDO_TEST_SERVER` 覆盖），并设置本地游客 UI；这不修改正式认证流程。检查包括真实点击选骰/选飞机/确认移动、重连、视角、特殊动作、格心、旋转校准和横竖屏。`docs/verification/README.md` 区分真实联机和本地表现夹具。`verify:published` 单独验收公网网页和实际自动选址，不使用端口替换。

## 微信小游戏

```powershell
$env:WECHAT_APP_ID = '<你的小游戏 AppID>'
npm run build:wechat
npm run verify:wechat
```

导入微信开发者工具的目录为 `build/wechatgame`。未设置 AppID 时用 `touristappid` 生成验证包；最新验证产物为 30 个文件、3,531,517 字节（约 3.53 MB），静态预算检查通过。保持横屏、真实 3D 网格与程序动画，不依赖 3D 物理或额外 WASM。原图仍在包内。

这次已完成 Creator 构建和静态包体检查，尚未完成微信真机运行、上传或审核。上线配置还需真实 AppID、客户端 WSS 地址、微信后台 socket 合法域名、服务端微信登录凭证校验；生产环境关闭调试骰子。微信端内存、帧率、RenderTexture、切后台恢复及刘海/胶囊安全区须在真机验收。

平台依据：[Cocos 微信发布文档](https://docs.cocos.com/creator/3.8/manual/en/editor/publish/publish-wechatgame.html)、[RenderTexture](https://docs.cocos.com/creator/3.8/manual/en/asset/render-texture.html)、[命令行构建](https://docs.cocos.com/creator/3.8/manual/en/editor/publish/publish-in-command-line.html)。恢复进度见 `docs/重构进度日志.md`。
