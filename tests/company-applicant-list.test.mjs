import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../styles.css", import.meta.url), "utf8");

assert.match(appSource, /Alex Carter/, "recruitment names should include English names");
assert.match(appSource, /function companyApplicants\(count = 6\)/, "recruitment refresh should generate a batch with unique names");
assert.ok(appSource.includes('replace(/\\d+$/, "")'), "legacy applicant suffix digits should be removed");
assert.match(appSource, /normalizeCompanyApplicants\(incomingCompany\.applicants\)/, "legacy applicants should be normalized on load");
assert.match(cssSource, /\.company-applicant-row \{ grid-template-columns: 32px minmax\(0, 1fr\) auto; \}/, "applicant cards should align avatar, details and actions in three columns");
assert.match(cssSource, /\.company-row, \.company-pilot-row, \.company-applicant-row \{ grid-template-columns: 1fr; \}/, "applicant cards should stack cleanly on narrow screens");

console.log("Company applicant list: mixed names, dedupe, suffix cleanup and aligned layout passed");
