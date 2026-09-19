import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
// panel-package / panel-ui 需要 playwright；panel-native* 需要专用参数，由 test:panels:native 单独运行。
const EXCLUDED = new Set([
  "panel-package.test.mjs",
  "panel-ui.test.mjs",
  "panel-native.test.mjs",
  "panel-native-lan.test.mjs"
]);

const files = (await readdir(new URL("../tests", import.meta.url)))
  .filter((name) => name.endsWith(".test.mjs") && !EXCLUDED.has(name))
  .sort()
  .map((name) => `tests/${name}`);

const child = spawn(process.execPath, ["--test", ...process.argv.slice(2), ...files], {
  stdio: "inherit",
  cwd: root
});
child.on("exit", (code) => process.exit(code ?? 1));
