import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const captureMode = process.argv[2] || '--multi-queue';
const target = spawn(`${root}tools/panel-capture-source/MofeiCaptureTest.exe`, [captureMode], { windowsHide: true });
let host;
const deadline = setTimeout(() => { host?.kill(); target.kill(); }, 20000);
try {
  const [pidLine] = await once(target.stdout, "data");
  const pid = Number(pidLine.toString().trim());
  assert.equal(pid, target.pid, "Only inject the dedicated test process created by this test");
  host = spawn(`${root}tools/panel-capture/MofeiCaptureHost.exe`, [String(pid), `${root}tools/panel-capture/MofeiCapture.dll`], { windowsHide: true });
  host.stderr.on("data", (data) => process.stderr.write(data));
  host.stdin.write("CLEAR\nMARK 1 16711680 65280 256 256\n");
  let buffer = Buffer.alloc(0);
  const hashes = new Set();
  let frames = 0;
  await new Promise((resolve, reject) => {
    host.on("error", reject);
    host.on("exit", (code) => { if (frames < 5) reject(new Error(`Capture host exited before frames: ${code}`)); });
    host.stdout.on("data", (data) => {
      try {
        buffer = Buffer.concat([buffer, data]);
        while (buffer.length >= 20) {
          assert.equal(buffer.readUInt32LE(0), 0x314a464d);
          const length = buffer.readUInt32LE(16);
          if (buffer.length < 20 + length) break;
          assert.equal(buffer.readUInt32LE(4), 1);
          assert.equal(buffer.readUInt32LE(8), 256);
          assert.equal(buffer.readUInt32LE(12), 256);
          const jpeg = buffer.subarray(20, 20 + length);
          assert.equal(jpeg.readUInt16BE(0), 0xffd8);
          assert.equal(jpeg.readUInt16BE(jpeg.length - 2), 0xffd9);
          hashes.add(createHash("sha256").update(jpeg).digest("hex"));
          buffer = buffer.subarray(20 + length);
          if (++frames >= 5) resolve();
        }
      } catch (error) { reject(error); }
    });
  });
  assert.ok(hashes.size >= 2, "The captured DirectX texture must change over time");
  const exit = once(host, "exit");
  host.stdin.end("STOP\n");
  const [code] = await exit;
  assert.equal(code, 0);
  console.log(`Native capture: ${frames} real D3D12 frames, ${hashes.size} distinct JPEG images, clean host exit.`);
} finally {
  clearTimeout(deadline);
  host?.kill();
  target.kill();
}
