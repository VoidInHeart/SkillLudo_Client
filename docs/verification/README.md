# SkillLudo 验收记录

## 2026-09-12 高分屏与旋转修复

新增 `viewport-result.json` 与 `viewport-*.png`：桌面 DPR 1/2/1.25、模拟微信 Android 横/竖屏 DPR 3、小屏手机和平板共 7 种环境，验证初始画布边界、旋转后布局、输入框实例和文本保留，以及实际按钮/实体骰子/飞机点击。修复前桌面 DPR 2 的 1280×800 窗口被 2560×1600 CSS 画布裁切。详见 `../屏幕适配与微信横屏.md`。

`preview-result.json` 与常规截图已更新为本次真实联机回归；微信最新为 30 文件、3,575,162 字节、landscape。浏览器设备模拟不是微信真机测试。此前 v4 发布清单与暂停验收继续作为对应版本历史证据，当前修复的公网发布信息见阶段日志。

修复已上线，生产客户端 `e29b717`、后端 `774cf18`，清单 `release-viewport-v1.json`。`published-viewport-result.json` 的 7 组公网适配测试全部通过，`published-viewport-*.png` 为对应截图；`published-result.json` 则是新版真实公网双人对局。两类结果均无浏览器错误。

## 当前：2026-09-11 协议 v4

客户端 22、服务端 80 项回归通过。`preview-result.json`、`skill-result.json`、`lifecycle-result.json` 三组浏览器检查通过且错误为空；后两组是拦截命令的 Cocos 交互测试，网络正确性由服务端真实 WebSocket 用例覆盖。

新增证据：`lifecycle-room-spectators.png`、`lifecycle-room-toast.png`、`lifecycle-afk-toast.png`、`lifecycle-pause-vote.png`、`lifecycle-pause.png`、`lifecycle-winner.png`、`lifecycle-winner-portrait.png`、`lifecycle-binding.png`、`lifecycle-checkpoint.png`。已检查桌面及 390×844 竖屏。绑定场景来自服务器，不依赖生产测试接口。

重现新增交互：服务端 `npm run verify:skill-fixtures`，客户端 `npm run verify:lifecycle`；前置为最新 Web 构建、7459 静态服务和 3101 独立验收服务。`skill-fixtures.json` 现在含七组场景。截图来源为 Chrome SwiftShader，不能当作手机性能数据。

当前生产为客户端 `e174337`、服务端 `774cf18`，协议 4，发布清单见 `release-v4.json`；两仓 CI 全部通过，包含真实 MySQL 集成。`published-result.json` 为公网页面实际连接公网后端的双人对局，`local-preview-result.json` 为本机预览自动连接公网，两者均无浏览器错误。

`published-lifecycle-result.json` 另以两个参赛者和一个观战者，在真实公网完成观战加入/聊天、参赛真人全票技术暂停、整页刷新恢复同一身份/棋局/截止时间，实际等待 120 秒后恢复且未误入托管，再投双骰行动。截图为 `published-pause-reconnect.png`。复现：`npm run verify:published -- --lifecycle`；本机预览会输出 `local-preview-*`，避免覆盖公网证据。该验收不修改服务器时钟或注入棋局。

微信静态构建成功：30 文件、3,572,525 字节，低于 4 MiB；尚未进行微信真机/上传验收或新版容量压测。以下为上一轮历史记录，其中同名 JSON 已由当前验收覆盖，历史版本清单仍为 `release-v3.json`。

## 历史：2026-09-11 协议 v3 / 阵营技能

`preview-result.json` 和常规截图已更新：实际点击图鉴、房间期望下拉框、反复预选两枚骰子，再点击飞机一次提交；重连、四组动画落点、两方视角、旋转校准与竖屏通过。新交互看 `move-preview.png`，旧 `move-confirmation.png` 仅为历史画面。

`skill-result.json`、`skill-*.png` 为五组权威计算的本地表现夹具：英国合计预选与换位绕行、中国 ±2/能量/CD、法国响应和锁标、美国五格轰炸/中国回起飞处、巴黎救援。脚本截获并校验前端命令，不声称这些是实际网络回合；法国真实网络响应/超时/重连/退出/托管另由服务器 `SkillNetwork.test.ts` 覆盖。浏览器错误为零。

重现：服务端执行 `npm run verify:skill-fixtures`，再由客户端执行 `npm run verify:skills`；需要已构建的 7459 页面和 3101 验收服务。法国锁定名单检查包含实际 ID 数组，防止 Creator 对 Set 展开的编译差异再次出现。

最新微信 `wechat-build-result.json` 为 30 文件、3,556,038 字节，4 MiB 预算内，仍只代表静态构建；无微信真机、上传或审核验证。下面日期较早的段落为历史边界。

`published-result.json` 已更新为 2026-09-11 上线后的真实公网验收：前端 `3aa8a94` / 后端 `f430d83`，无地址替换，双人房间/选阵营/双骰预选/原子移动通过；`local-preview-result.json` 是同日从本机预览自动连接公网的结果。两次浏览器均零错误。生产版本清单为 `release-v3.json`。

所有截图来自构建后的 Cocos Web 运行画面。使用两个隔离浏览器上下文连接本地真实 WebSocket 服务；Chrome 以 SwiftShader 软件渲染运行，因此不把桌面帧率作为手机性能结论。

| 检查 | 证据 |
| --- | --- |
| 真实开房、颜色意愿、准备和开局 | `home.png`、`room-preferences.png` |
| 双方各自机场左下 | `game-green.png`、`game-blue.png` |
| 真实投骰、实体骰子点击、未选骰重连 | `dice-airborne.png`、`dice-choice.png` |
| 真实飞机点击、确认和起飞 | `move-confirmation.png`、`after-takeoff.png` |
| 本地吃子/虫洞/终点/回弹表现 | 四张 `*-motion.png` |
| 本地旋转校准拖动与标准坐标保存检查 | `calibration-rotated.png` |
| 竖屏等比重排 | `game-portrait.png` |
| 自动检查通过、浏览器零错误 | `preview-result.json` |
| 微信正式构建和包体静态检查 | `wechat-build-result.json` |

特殊动作使用 `export-motion-fixtures.ts` 调用相邻服务端的真实 `GameRules` 生成 `motion-fixtures.json`，再送入本地表现层；不冒充真实网络回合。每个动作结束检查 XY 与预期格心距离小于 0.01 棋盘单位。校准测试拦截本地保存回调，不改服务器校准文件；服务器保存流程另有自动化测试。

微信构建通过（Creator 3.8.8，退出码 36），30 文件合计 3,530,535 字节；AppID 仍为测试占位。尚未执行微信开发者工具上传、真机性能/安全区检查或生产微信身份认证联调。

## 2026-09-10 公网前端

`published-login.png`、`published-game.png`、`published-result.json` 来自 <http://81.70.145.148> 的正式构建，实际 WebSocket 为 `ws://81.70.145.148`，不拦截地址或认证。两名服务器游客完成临时开房、颜色意愿、开局、随机双骰动画与选择，退出时清理房间；没有覆盖注册/密码登录的 UI 流程，也没有重跑上面的全部特殊动作夹具。

本机 `http://127.0.0.1:7459` 自动连公网的成功证据为 `local-preview-result.json`；一次早期运行遇到 4 次握手失败后恢复，诊断复测零错误。当前 `wechat-build-result.json` 已更新为本轮构建：30 文件、3,531,517 字节，仍只代表静态验证。
