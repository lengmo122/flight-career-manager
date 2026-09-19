import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [html, app, css] = await Promise.all([
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "styles.css"), "utf8")
]);

assert.match(html, /id="pilotAvatarPreview"/);
assert.match(html, /id="pilotAvatarFile"[^>]+accept="image\/png,image\/jpeg,image\/webp"/);
assert.match(html, /id="uploadAvatarBtn"/);
assert.match(html, /id="avatarChoiceGrid"/);
assert.match(html, /id="avatarChoiceStatus"/);
assert.match(html, /class="login-profile-layout"/);
assert.match(app, /avatarDataUrl: ""/);
assert.match(app, /avatarPreset: "preset-01"/);
assert.match(app, /const AVATAR_PRESETS = Array\.from\(\{ length: 9 \}/);
assert.match(app, /function isAvatarDataUrl\(/);
assert.match(app, /function resizeAvatarFile\(/);
assert.match(app, /state\.pilot\.avatarDataUrl = await resizeAvatarFile\(file\)/);
assert.match(app, /state\.pilot\.avatarPreset = ""/);
assert.match(app, /function renderAvatarChoices\(/);
assert.match(app, /function selectAvatar\(/);
assert.match(app, /merged\.pilot\.avatarPreset = AVATAR_PRESETS\.some/);
assert.match(app, /renderAvatar\(els\.pilotInitials, state\.pilot\.avatarDataUrl/);
assert.match(app, /uploadAvatarBtn\?\.addEventListener\("click"/);
assert.match(app, /avatarChoiceGrid\?\.addEventListener\("click"/);
assert.match(css, /\.login-profile-layout/);
assert.match(css, /\.login-avatar-panel/);
assert.match(css, /\.avatar-choice-grid/);
assert.match(css, /\.avatar-choice\.is-selected/);
assert.match(css, /\.avatar img/);

await Promise.all(Array.from({ length: 9 }, (_, index) =>
  access(path.join(root, "assets", "avatars", `preset-${String(index + 1).padStart(2, "0")}.png`))
));

console.log("preset avatar selection, custom upload and saved profile wiring passed");
