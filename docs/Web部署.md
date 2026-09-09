# Web 前端部署

目标入口为 <http://81.70.145.148>。公网网页自动连接当前网站的 WebSocket；Cocos 本机或局域网预览自动连接 `ws://81.70.145.148`。`Main.scene` 的 GameController **Server Url 留空**即自动选择；本机后端联调可显式填写 `ws://127.0.0.1:3000`。微信正式发布时填写已配置合法域名的 `wss://` 地址。

## 发布命令

在客户端仓库执行（需要 Node、Git、tar、SSH、服务器免密 sudo，默认 SSH 别名 `SEBaseline`）：

```powershell
npm run deploy:web
```

命令默认先用本机 Creator 3.8.8 构建 `build/web-desktop`，为文本资源生成 gzip 副本，上传网页与 Nginx 配置，在服务器使用缓存基础镜像构建前端镜像，然后滚动发布。默认构建步骤适用于 Windows；其他系统先在 Creator 中构建 Web Desktop，再执行：

```sh
node scripts/deploy-web.mjs --skip-build --host=SEBaseline
```

`--skip-build` 必须由调用者保证构建产物与源码一致。`--package-only` 只打包，不连接服务器；产物保存在忽略目录 `temp/web-publish`。建议先提交源码再发布；`/version.json` 记录提交、发布编号和打包时工作树是否有改动。

## 路由与恢复

- 资源、部署清单及 Nginx 配置全部归客户端仓库维护。Namespace 仍为 `skillludo`。
- 独立 `Deployment/web` 使用只读根文件系统、非 root 和临时目录；请求 10m CPU / 16 MiB，限制 250m / 64 MiB。
- 优先级 100 的 `Ingress/web` 接管首页，Nginx 的普通 GET `/` 提供网页；WebSocket Upgrade、`/healthz`、`/readyz` 转发到原 `Service/server:3000`。原后端入口与 CI 冒烟地址保留。
- `web-network` 和 `web-to-server` 只添加 Traefik → Web → Server 的必要连接。数据库隔离保持由服务端配置管理。
- Cocos Web 构建启用文件 MD5；有哈希的资源缓存一年，未哈希入口要求重新验证，文本使用 gzip，减少共享公网带宽消耗。
- 发布脚本先验证 Nginx 和 Pod 就绪，再切入口；内部版本/后端健康失败时恢复上一前端镜像，首次发布失败则移除前端 Ingress，恢复后端直接入口。
- 镜像及对应文件保存在 `/opt/skillludo/web/releases/<编号>`；`current-image`、`previous-image` 保存当前与上一版本。前端更新不会重启 Node 或清除房间，但旧 Nginx 连接结束时客户端需要自动重连。

手动撤回网页入口、恢复原后端直连：

```sh
ssh SEBaseline 'sudo -n kubectl -n skillludo delete ingress web'
```

恢复网页时重新执行发布命令。保留的镜像和目录会占用磁盘，清理前核对当前与回滚版本。

## 验证与 CI

```powershell
npm run check
npm run check:tests
npm test
npm run verify:published
```

公开站点验收脚本使用 Playwright 和 Chrome，观察实际网络地址，不替换 WebSocket 或认证。它通过服务器正常提供的游客身份创建临时双人房间，检查选色、开局、双骰动画和选择，最后离开房间；不覆盖账号注册/密码登录的 UI 流程。截图及结果保存在 `docs/verification/published-*`。

可设置 `SKILLLUDO_WEB_URL`、`SKILLLUDO_EXPECTED_SOCKET` 验证本机预览页是否连接公网；`PLAYWRIGHT_PATH`、`SKILLLUDO_BROWSER` 可指定测试依赖。

GitHub `Client checks` 自动执行 16 项纯逻辑回归、脚本语法和 Nginx 配置检查，不需要 Secrets。完整 Cocos 构建与前端发布由上述本机命令执行；后端原有 GitHub CI/CD 继续独立运行。不要将后端受限部署密钥改作前端 SSH shell 密钥。
