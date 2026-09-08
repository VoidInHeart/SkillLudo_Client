# 2026-09-09 验收记录

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
