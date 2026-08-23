# SkillLudo Client

Cocos Creator 3.8.8 的四人联机飞行棋客户端。客户端只负责输入、UI 和动画；骰子与规则裁决全部来自 `../SkillLudo_Server`。

## 场景接线

1. 在 Cocos Creator 打开本项目并新建/打开 2D 场景，在 `Canvas` 下放一个节点作为棋盘根节点，挂载 `BoardController`。
2. 在 `Canvas` 或根节点挂载 `GameController`，并在 Inspector 中绑定 `BoardController`、`GameUI`。本地调试服务地址保持 `ws://127.0.0.1:3000`。
3. 挂载 `GameUI` 即可：如果未手动绑定 Label、输入框和按钮，它会在运行时自动生成完整的调试 HUD（创建/加入房间、准备、开始、投骰子）。
4. 默认棋盘资源是 `assets/resources/textures/ludo-classic-board-cropped.png`。该资源和 HUD 都在点击 Cocos 的运行按钮后动态生成，因此 Scene 编辑视图中不会预先显示；这是正常的。

`BoardController` 会加载常见十字布局棋盘并在对局开始后生成 16 架飞机。其坐标映射位于 `assets/scripts/game/BoardLayout.ts`；修改美术或分辨率时只需替换该表现层，不要把规则移入 Cocos 端。

## 微信发布

小游戏发布前将 `GameController.serverUrl` 配为已备案、TLS 终止后的 `wss://` 域名，并把 `SessionManager` 的开发游客认证替换为微信登录凭证的服务端校验。
