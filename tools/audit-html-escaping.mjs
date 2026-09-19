// 扫描 app.js 中 HTML 模板字符串里的未转义字符串字段插值，
// 并（--fix 时）自动用 escapeHtml() 包裹可以安全包裹的表达式。
import { readFile, writeFile } from "node:fs/promises";

const FIX = process.argv.includes("--fix");
const src = await readFile(new URL("../app.js", import.meta.url), "utf8");

const templates = [];
// 帧栈：code 帧含大括号深度；template 帧含正在累积的模板信息
const frames = [{ type: "code", depth: 0 }];
let i = 0;
let lastSig = ""; // 上一个有效字符，用于判断 / 是否为正则

const REGEX_PRECEDING = new Set(["=", "(", ",", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);

function top() { return frames[frames.length - 1]; }
function templateFrameBelow() {
  for (let k = frames.length - 2; k >= 0; k--) if (frames[k].type === "template") return frames[k];
  return null;
}

while (i < src.length) {
  const frame = top();
  const ch = src[i];
  const next = src[i + 1];
  if (frame.type === "code") {
    if (ch === "/" && next === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (ch === "/" && next === "*") { const end = src.indexOf("*/", i + 2); i = end === -1 ? src.length : end + 2; continue; }
    if (ch === '"' || ch === "'") {
      i++;
      while (i < src.length && src[i] !== ch) { if (src[i] === "\\") i++; i++; }
      i++; lastSig = ch; continue;
    }
    if (ch === "/" && (REGEX_PRECEDING.has(lastSig) || lastSig === "" || /return$|typeof$|case$|in$|of$|new$|do$|else$/.test(src.slice(Math.max(0, i - 8), i).trim()))) {
      i++;
      let inClass = false;
      while (i < src.length) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        else if (src[i] === "/" && !inClass) break;
        else if (src[i] === "\n") break; // 不是正则，放弃
        i++;
      }
      i++; lastSig = "/"; continue;
    }
    if (ch === "`") {
      frames.push({ type: "template", start: i, staticText: "", interps: [], pendingInterp: null });
      i++; continue;
    }
    if (ch === "{") { frame.depth++; i++; lastSig = ch; continue; }
    if (ch === "}") {
      if (frame.depth > 0) { frame.depth--; i++; lastSig = ch; continue; }
      // 插值结束
      const tplFrame = frames[frames.length - 2];
      if (tplFrame && tplFrame.type === "template" && tplFrame.pendingInterp !== null) {
        tplFrame.interps.push({ start: tplFrame.pendingInterp, end: i + 1, expr: src.slice(tplFrame.pendingInterp + 2, i) });
        tplFrame.pendingInterp = null;
        frames.pop();
        i++; continue;
      }
      i++; lastSig = ch; continue;
    }
    if (!/\s/.test(ch)) lastSig = ch;
    i++; continue;
  }
  // template frame
  if (ch === "\\") { frame.staticText += next || ""; i += 2; continue; }
  if (ch === "`") {
    frame.end = i + 1;
    templates.push(frame);
    frames.pop();
    i++; lastSig = "`"; continue;
  }
  if (ch === "$" && next === "{") {
    frame.pendingInterp = i;
    frames.push({ type: "code", depth: 0 });
    i += 2; lastSig = ""; continue;
  }
  frame.staticText += ch;
  i++;
}

const lineOf = (offset) => src.slice(0, offset).split("\n").length;
const STRING_FIELD = /\.(name|title|notes|label|detail|description|city|country|icao|code|callsign|manufacturer|model|from|to|airline|base|runway|airport|remark|text|message|site|category|subtype|summary|route|origin|destination|id|src|avatar|status|reason)\b/;
const UNSAFE_TO_WRAP = /`|<|render|\.map\(|join\(|emptyCard|escapeHtml/;

const findings = [];
for (const tpl of templates) {
  if (!/<[a-zA-Z/]/.test(tpl.staticText)) continue;
  for (const interp of tpl.interps) {
    const expr = interp.expr;
    if (expr.includes("escapeHtml")) continue;
    if (!STRING_FIELD.test(expr)) continue;
    findings.push({ ...interp, line: lineOf(interp.start), wrappable: !UNSAFE_TO_WRAP.test(expr) });
  }
}

findings.sort((a, b) => a.start - b.start);
for (const f of findings) {
  console.log(`${f.wrappable ? "WRAP" : "MANUAL"} ${f.line}: \${${f.expr.slice(0, 100)}}`);
}
console.log(`total=${findings.length} wrappable=${findings.filter(f => f.wrappable).length} templates=${templates.length}`);

if (FIX) {
  let out = src;
  for (const f of [...findings].reverse()) {
    if (!f.wrappable) continue;
    out = out.slice(0, f.start) + "${escapeHtml(" + f.expr + ")}" + out.slice(f.end);
  }
  await writeFile(new URL("../app.js", import.meta.url), out, "utf8");
  console.log("fixed");
}
