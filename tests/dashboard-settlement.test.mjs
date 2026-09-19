import { readAppSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [html, app, css] = await Promise.all([
  readFile(path.join(root, "index.html"), "utf8"),
  readAppSource(),
  readFile(path.join(root, "styles.css"), "utf8")
]);

assert.match(html, /id="dashboardSettlement"/);
assert.match(html, /id="sidebarLogs"[\s\S]*id="dashboardSettlement"/, "settlement should be placed below the task log in the right sidebar");
assert.doesNotMatch(html.slice(html.indexOf('id="dashboardView"'), html.indexOf('class="metric-grid"')), /dashboardSettlement/, "settlement should not occupy the dashboard hero");
assert.match(app, /function latestCompletedTaskLog\(\)/);
assert.match(app, /function renderDashboardSettlement\(\)/);
assert.match(app, /settledAt/);
assert.match(app, /飞行时间/);
assert.match(app, /飞行距离/);
assert.match(app, /消耗燃油/);
assert.match(app, /净收入/);
assert.match(app, /暂无已完成任务/);
const dashboardStart = app.indexOf("function renderDashboardSettlement()");
const dashboardFunction = app.slice(dashboardStart, app.indexOf("function renderLiveTaskProgress", dashboardStart));
assert.doesNotMatch(dashboardFunction, /renderSopReport\(/, "the dashboard settlement must stay compact; full SOP details belong in flight logs");
assert.match(css, /\.dashboard-settlement/);
assert.match(css, /\.settlement-grid/);

console.log("dashboard settlement summary passed");
