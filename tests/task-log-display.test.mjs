import { readAppSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readAppSource();

assert.match(source, /const latestEvent = events\.slice\(0, 1\)/, "sidebar task log should select only the newest event");
assert.match(source, /els\.sidebarLogs\.innerHTML = liveProgress \|\| latestEvent/, "sidebar should render live progress or one latest event");
assert.doesNotMatch(source, /const history = events\.slice\(0, activeMission \? 7 : 8\)/, "sidebar should not render the event history list");

console.log("Task log display: one latest status card with live-progress priority passed");
