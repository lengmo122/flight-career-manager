import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [html, app, css, douyinIcon, bilibiliIcon] = await Promise.all([
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "styles.css"), "utf8"),
  readFile(path.join(root, "assets", "support", "douyin.png")),
  readFile(path.join(root, "assets", "support", "bilibili.png"))
]);

assert.match(html, /id="supportBtn"/);
assert.match(html, /id="supportModal"/);
assert.match(html, /assets\/support\/alipay\.png/);
assert.match(html, /assets\/support\/wechat\.png/);
assert.match(html, /支付宝/);
assert.match(html, /微信/);
assert.match(html, /id="contactAuthorBtn"/);
assert.match(html, /id="contactModal"/);
assert.match(html, /1048217475/);
assert.match(html, /assets\/support\/douyin\.png/);
assert.match(html, /assets\/support\/bilibili\.png/);
assert.doesNotMatch(html, /data-lucide="music-2"/);
assert.doesNotMatch(html, /data-lucide="tv"/);
assert.match(html, /抖音[\s\S]*?搜索 游戏老啸/);
assert.match(html, /B站[\s\S]*?搜索 游戏老啸/);
assert.equal(douyinIcon.subarray(1, 4).toString("ascii"), "PNG");
assert.equal(bilibiliIcon.subarray(1, 4).toString("ascii"), "PNG");
assert.match(app, /function openSupport\(\)/);
assert.match(app, /supportBtn\?\.addEventListener\("click", openSupport\)/);
assert.match(app, /contactAuthorBtn\?\.addEventListener\("click", openContactAuthor\)/);
assert.match(app, /navigator\.clipboard\.writeText\(groupNumber\)/);
assert.match(css, /\.support-grid/);
assert.match(css, /\.contact-group-row/);
assert.match(css, /\.contact-platform-list/);
assert.match(css, /\.contact-platform-row/);
assert.match(css, /\.contact-platform-icon img/);

console.log("support button and QR dialog wiring passed");
