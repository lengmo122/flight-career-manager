import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const run = promisify(execFile);
export const captureDirectory = process.resourcesPath && existsSync(join(process.resourcesPath, 'panel-capture', 'MofeiCaptureHost.exe'))
  ? join(process.resourcesPath, 'panel-capture') : join(import.meta.dirname, 'tools', 'panel-capture');

export async function listCaptureTargets() {
  if (process.platform !== 'win32') return [];
  const { stdout } = await run(join(captureDirectory, 'MofeiCaptureHost.exe'), ['--list'], { windowsHide: true, timeout: 3000, maxBuffer: 64 * 1024 });
  return JSON.parse(stdout).filter(item => /^FlightSimulator(?:2024)?\.exe$/i.test(item.name) && Number.isInteger(item.pid));
}

export class FrameParser {
  constructor(onFrame) { this.buffer = Buffer.alloc(0); this.onFrame = onFrame; }
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 20) {
      const [magic, id, width, height, length] = Array.from({ length: 5 }, (_, i) => this.buffer.readUInt32LE(i * 4));
      if (magic !== 0x314a464d || !id || !width || !height || width > 4096 || height > 4096 || length < 4 || length > 24 * 1024 * 1024) throw new Error('invalid-native-frame');
      if (this.buffer.length < length + 20) break;
      const jpeg = this.buffer.subarray(20, length + 20);
      if (jpeg.readUInt16BE(0) !== 0xffd8 || jpeg.readUInt16BE(length - 2) !== 0xffd9) throw new Error('invalid-native-jpeg');
      this.onFrame({ id, width, height, jpeg });
      this.buffer = this.buffer.subarray(length + 20);
    }
  }
}

export function startNativeCapture(pid, marker, callbacks, directory = captureDirectory) {
  const child = spawn(join(directory, 'MofeiCaptureHost.exe'), [String(pid), join(directory, 'MofeiCapture.dll')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stopping;
  const parser = new FrameParser(callbacks.frame);
  child.stdout.on('data', chunk => {
    try { parser.push(chunk); } catch (error) { callbacks.error(error.message); void stop(); }
  });
  let stderr = '';
  child.stderr.on('data', chunk => {
    stderr = (stderr + chunk.toString()).slice(-8192);
    const lines = stderr.split(/\r?\n/); stderr = lines.pop();
    for (const line of lines) {
      const match = line.match(/^capture-state:(-?\d+)$/);
      if (match) callbacks.state(Number(match[1]));
      else if (line.startsWith('capture-diag:')) callbacks.diagnostic?.(line.slice('capture-diag:'.length));
      else if (line) callbacks.error(line.slice(0, 200));
    }
  });
  child.on('error', error => callbacks.error(error.code || error.message));
  child.stdin.on('error', () => {});
  const exited = new Promise(resolve => child.once('close', (code, signal) => {
    callbacks.exit(code, signal); resolve();
  }));
  function stop() {
    if (stopping) return stopping;
    child.stdin.end('STOP\n');
    stopping = new Promise(resolve => {
      const timer = setTimeout(() => child.kill(), 2000);
      exited.then(() => { clearTimeout(timer); resolve(); });
    });
    return stopping;
  }
  child.stdin.write(`CLEAR\nMARK ${marker.id} ${marker.first} ${marker.second} ${marker.width} ${marker.height}\n`);
  return { stop, pid: child.pid };
}
