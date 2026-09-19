import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../styles.css", import.meta.url), "utf8");

assert.match(appSource, /id="companyNameInput"[^>]+type="text"[^>]+inputmode="latin"[^>]+minlength="3"[^>]+maxlength="3"/, "company name field should accept a three-letter airline code");
assert.match(appSource, /id="companyBaseInput"/, "company base should remain a direct ICAO input");
assert.match(appSource, /id="companyNameResult"/, "airline lookup result should be visible below the company field");
assert.match(appSource, /id="companyAircraftSelect"/, "initial company aircraft should be selectable");
assert.match(appSource, /const COMPANY_STARTUP_FUNDS_MAX = 100_000;/, "company startup funds should be capped at 100,000");
assert.match(appSource, /id="companyFundsInput"[^>]+max="\$\{COMPANY_STARTUP_FUNDS_MAX\}"/, "startup funds input should expose the 100,000 maximum");
assert.match(appSource, /if \(funds > COMPANY_STARTUP_FUNDS_MAX\) \{[\s\S]{0,140}return;/, "company creation should reject startup funds above the maximum");
assert.match(appSource, /updateCompanyCreatePreview\(\)/, "create preview should refresh from form input");
assert.match(appSource, /event\.target\.id === "companyBaseInput" \|\| event\.target\.id === "companyNameInput"/, "base and airline fields should update previews while typing");
assert.match(cssSource, /\.company-form-grid\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*repeat\(2/, "company fields should use an explicit two-column grid");
assert.match(cssSource, /\.company-form-grid \.field \{ min-width: 0; margin-bottom: 0; \}/, "company fields should align without inherited bottom margins");

console.log("Company create form: editable name, aligned fields and three-letter airline lookup passed");
