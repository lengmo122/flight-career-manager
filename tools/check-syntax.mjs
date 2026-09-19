// 对全部渲染器源码与 Node 侧入口做语法检查（等价于逐个 node --check）。
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { rendererSourceFiles } from "../tests/helpers/app-source.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const files = [...(await rendererSourceFiles()), "terrain.js", "server.mjs", "electron-main.mjs", "preload.cjs"];
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    failed = true;
    console.error(`语法检查失败: ${file}`);
  }
}
if (failed) process.exit(1);
console.log(`语法检查通过（${files.length} 个文件）`);
