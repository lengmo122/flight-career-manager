// 拼接 index.html 声明的全部渲染器源码（src/*.js），供测试与工具做源码断言。
// 加载顺序以 index.html 的 <script> 标签为唯一权威来源。
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);

export async function rendererSourceFiles() {
  const html = await readFile(new URL("index.html", root), "utf8");
  const files = [...html.matchAll(/<script src="\.\/(src\/[^"]+\.js)" defer><\/script>/g)].map((m) => m[1]);
  if (!files.length) throw new Error("index.html 中未找到 src/*.js 脚本标签");
  return files;
}

export async function readAppSource() {
  const files = await rendererSourceFiles();
  const parts = await Promise.all(files.map((file) => readFile(new URL(file, root), "utf8")));
  return parts.join("\n");
}
