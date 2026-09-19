# 模飞生涯（Flight Career Manager）

微软模拟飞行（MSFS）职业生涯与任务管理器，Electron 桌面应用。

## 开发

```bash
pnpm install          # 安装依赖
npm run desktop       # 启动桌面应用
npm start             # 仅启动本地服务（浏览器访问 http://localhost:4174）
npm run test:js       # 并行运行全部 JS 测试（node --test）
npm run check         # 语法检查 + JS 测试 + .NET 遥测测试
npm run dist:win      # 打包 Windows 版本
```

## 代码结构

渲染器源码在 `src/` 下，为按加载顺序编号的经典脚本（共享全局作用域），
加载顺序以 `index.html` 中的 `<script>` 标签为唯一权威来源：

| 文件 | 职责 |
| --- | --- |
| `src/01-save-storage.js` | 存档加密（AES-GCM）与持久化读写 |
| `src/02-game-data.js` | 航司 / 机场 / 机型 / 任务池 / 成就等静态数据 |
| `src/03-dom-refs.js` | DOM 引用（`els`）与运行时变量 |
| `src/04-state-core.js` | 状态默认值、合并、规范化、防抖存档 |
| `src/05-aircraft-telemetry.js` | 机型识别、遥测匹配、着陆损耗与飞行生命周期 |
| `src/06-ui-core.js` | 转义 / 头像 / 视图切换 / 监视器 / 提示与设置 |
| `src/07-map-plan.js` | 地图（Leaflet）与计划任务生成 |
| `src/08-render-panels.js` | 任务卡片、日志、机库、公司等面板渲染 |
| `src/09-sop.js` | SOP 监测规则、评分与报告 |
| `src/10-missions.js` | 任务接受 / 完成 / 遥测处理 / 模拟器轮询 |
| `src/11-economy-company.js` | 备份、买卖飞机、航空公司经营 |
| `src/12-app-boot.js` | 输入处理、事件绑定、`state` 初始化与启动 |

注意：`state` 在 `12-app-boot.js` 初始化——`defaultState()` 依赖前面文件的函数，
而函数提升不跨文件，新增顶层立即执行代码时须注意加载顺序。

服务端为 `server.mjs`（静态文件 + `/api/*`，仅监听 127.0.0.1，全部 API
经过本机同源校验）；Electron 主进程为 `electron-main.mjs`。

## 测试

测试在 `tests/`，多数通过 `tests/helpers/app-source.mjs` 读取拼接后的渲染器
源码做断言。`tools/audit-html-escaping.mjs` 可扫描（`--fix` 自动修复）HTML
模板中未转义的用户可控插值，建议在改动渲染代码后运行。
