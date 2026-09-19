import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { PanelDiscovery } from './panel-discovery.mjs';
import { listCaptureTargets, startNativeCapture } from './panel-native.mjs';

export function panelLanHosts(interfaces = networkInterfaces()) {
  return [...new Set(Object.values(interfaces).flatMap(entries => entries || [])
    .filter(entry => entry.family === 'IPv4' && !entry.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address))
    .map(entry => entry.address))];
}

const messages = {
  'inspector-unavailable': '无法访问 MSFS 面板接口，请进入驾驶舱并检查游戏的 19999 端口。',
  'no-simulator': '等待 MSFS 启动。',
  'multiple-simulators': '检测到多个模拟器进程，请只保留一个。',
  'no-panels': '尚未发现可见仪表，请进入驾驶舱。',
  'process-access-denied': '无法访问游戏进程，请检查软件与游戏的运行权限。',
  'capture-already-running': '此游戏已有模飞生涯抓取进程，请先停止另一实例的截取。',
  'capture-load-failed': '抓取模块未能加载，请检查安全软件及运行权限。',
  'no-frames': '尚未收到面板画面。当前仅支持 DirectX 12；此面板或渲染路径可能不兼容。',
  'native-failed': '抓取模块发生错误，已停止截取。',
  'panel-lost': '面板已关闭、尺寸已改变或飞机已切换，请重新选择。',
  'native-missing': '抓取组件缺失，请重新安装完整软件。',
  'enhanced-barriers': '当前游戏使用增强型渲染屏障，此测试版尚不支持，已停止截取。',
  'restart-game-required': '游戏中仍加载着另一版本的截取模块，请结束飞行后重启游戏。',
  'hook-install-failed': 'DirectX 截取钩子安装失败。请重启 MSFS 后重试；若仍失败，请提供原生错误码。',
  'device-init-failed': '无法创建 DirectX 12 截取设备，请检查图形驱动和游戏渲染模式。',
  'gpu-device-lost': 'GPU 设备已重置或读回失败，截取已停止。',
  'capture-cancelled': '截取启动已取消。'
};

export class PanelService {
  constructor({ discovery = new PanelDiscovery(), targets = listCaptureTargets, native = startNativeCapture, port = 4186 } = {}) {
    this.discovery = discovery; this.targets = targets; this.native = native; this.requestedPort = port;
    this.panels = []; this.simulator = null; this.capture = null; this.selected = null;
    this.clients = new Set(); this.token = randomBytes(24).toString('hex');
    this.lastScan = 0; this.scanPromise = null; this.startPromise = null; this.closed = false;
    this.error = ''; this.nativeState = 0; this.nativeDiagnostics = ''; this.frame = null; this.frameTime = 0;
    this.captureStarting = false; this.stopping = null;
    this.generation = 0; this.captureTask = null; this.frameTimes = [];
  }
  async ensureStarted() {
    if (this.closed) throw new Error('service-closed');
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.listen().catch(error => { this.startPromise = null; throw error; });
    return this.startPromise;
  }
  async listen() {
    const [viewer, script] = await Promise.all([
      readFile(new URL('./assets/panels/viewer.html', import.meta.url)),
      readFile(new URL('./assets/panels/viewer.js', import.meta.url))
    ]);
    this.server = createServer((req, res) => {
      const path = (req.url || '').split('?')[0];
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src blob:; connect-src 'self'; frame-ancestors http://127.0.0.1:* http://localhost:*");
      if (req.method === 'GET' && /^\/panel\/[\w-]{1,80}$/.test(path)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(viewer);
      } else if (req.method === 'GET' && path === '/viewer.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); res.end(script);
      } else { res.writeHead(404); res.end(); }
    });
    this.ws = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
    this.server.on('upgrade', (req, socket, head) => {
      let url;
      try { url = new URL(req.url, 'http://localhost'); } catch { socket.destroy(); return; }
      const token = Buffer.from(url.searchParams.get('token') || '');
      const expected = Buffer.from(this.token);
      const origin = req.headers.origin;
      if (url.pathname !== '/stream' || token.length !== expected.length || !timingSafeEqual(token, expected) ||
          (origin && origin !== `http://${req.headers.host}`) || this.clients.size >= 8) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
      }
      const id = url.searchParams.get('panel');
      const fps = Math.max(1, Math.min(60, Number(url.searchParams.get('fps')) || 30));
      this.ws.handleUpgrade(req, socket, head, ws => {
        const client = { ws, id, interval: 1000 / fps, lastSent: 0, alive: true };
        this.clients.add(client);
        ws.on('error', () => {});
        ws.on('pong', () => { client.alive = true; });
        ws.on('close', () => this.clients.delete(client));
        this.sendViewerStatus(client);
        if (this.selected?.id === id && Date.now() - this.frameTime < 3000 && this.frame) ws.send(this.frame);
      });
    });
    await new Promise((resolve, reject) => {
      let fallback = false;
      const onError = error => {
        if (error.code === 'EADDRINUSE' && !fallback) { fallback = true; this.server.listen(0, '0.0.0.0'); }
        else reject(error);
      };
      this.server.on('error', onError);
      this.server.once('listening', () => { this.server.off('error', onError); resolve(); });
      this.server.listen(this.requestedPort, '0.0.0.0');
    });
    this.server.on('error', () => { this.error = 'lan-error'; });
    this.port = this.server.address().port;
    this.timer = setInterval(() => { if (this.capture && !this.closed) void this.scan(true); }, 3000);
    this.timer.unref();
    this.statusTimer = setInterval(() => {
      if (this.capture && Date.now() - (this.frameTime || this.startedAt) > 20000) {
        this.error = 'no-frames'; void this.stopCapture();
      }
      for (const client of this.clients) this.sendViewerStatus(client);
    }, 1000);
    this.statusTimer.unref();
    this.pingTimer = setInterval(() => {
      for (const client of this.clients) {
        if (!client.alive) { client.ws.terminate(); continue; }
        client.alive = false; client.ws.ping();
      }
    }, 15000);
    this.pingTimer.unref();
  }
  async scan(force = false) {
    if (this.closed) return;
    if (this.scanPromise) return this.scanPromise;
    if (!force && Date.now() - this.lastScan < 3000) return;
    this.scanPromise = (async () => {
      try {
        const targets = await this.targets();
        if (!targets.length) throw new Error('no-simulator');
        if (targets.length !== 1) throw new Error('multiple-simulators');
        if (this.simulator && this.simulator.pid !== targets[0].pid) await this.stopCapture();
        this.simulator = targets[0];
        const panels = await this.discovery.scan();
        if (this.closed) return;
        this.panels = panels;
        if (this.selected && this.capture) {
          const current = panels.find(panel => panel.id === this.selected.id);
          if (!current || current.width !== this.selected.width || current.height !== this.selected.height || current.name !== this.selected.name) {
            await this.stopCapture(); this.error = 'panel-lost';
          } else await this.discovery.mark(current, this.marker);
        }
        if (['no-simulator', 'multiple-simulators', 'inspector-unavailable', 'no-panels', 'native-missing'].includes(this.error)) this.error = '';
      } catch (error) {
        this.panels = [];
        await this.stopCapture();
        if (error.message === 'no-simulator' || error.message === 'multiple-simulators') this.simulator = null;
        this.error = error.code === 'ENOENT' ? 'native-missing' : messages[error.message] ? error.message : 'inspector-unavailable';
      } finally { this.lastScan = Date.now(); }
    })().finally(() => { this.scanPromise = null; });
    return this.scanPromise;
  }
  captureStatus() {
    const now = Date.now();
    const fresh = !!this.capture && !!this.frameTime && now - this.frameTime < 5000;
    const error = this.error || (this.capture && now - this.startedAt > 10000 && !fresh ? 'no-frames' : '');
    return {
      phase: error ? 'error' : this.captureStarting ? 'starting' : this.capture ? fresh ? 'live' : 'waiting' : 'idle',
      error,
      message: messages[error] || (error ? `截取错误：${error}` : this.captureStarting ? '正在启动截取' : this.capture ? fresh ? '截取运行中' : '等待 GPU 面板画面' : '请选择面板并开始截取'),
      fps: fresh ? this.frameTimes.filter(time => now - time < 1000).length : 0,
      viewers: [...this.clients].filter(client => client.id === this.selected?.id).length,
      frameAgeMs: this.frameTime ? now - this.frameTime : null,
      nativeState: this.nativeState,
      diagnostics: this.nativeDiagnostics
    };
  }
  sendViewerStatus(client) {
    if (client.ws.readyState !== WebSocket.OPEN || client.ws.bufferedAmount > 512 * 1024) return;
    const status = this.captureStatus();
    if (this.selected && client.id !== this.selected.id) {
      status.phase = 'idle'; status.message = '已切换到其他面板，请重新打开对应分享地址';
    }
    client.ws.send(JSON.stringify({ type: 'status', ...status, clear: status.phase !== 'live' }));
  }
  async status() {
    await this.ensureStarted();
    await this.scan();
    const captureStatus = this.captureStatus();
    return {
      connected: true, independent: true, port: this.port, shareToken: this.token, lanHosts: panelLanHosts(),
      capturing: !!this.capture, selectedId: this.selected?.id || '',
      ...captureStatus,
      engine: { version: '1', pid: this.simulator?.pid || null },
      state: { msfsDetected: !!this.simulator, msfsConnection: !this.simulator ? 'off' : this.panels.length ? 'connected' : 'waiting-for-flight',
        aircraft: this.simulator?.name || '', directX: this.nativeState >= 1 ? { version: 12, supported: true } : null,
        markerInjection: { status: this.frameTime && Date.now() - this.frameTime < 5000 ? 'ok' : 'pending' } },
      panels: this.panels.map(panel => ({ id: panel.id, name: panel.name, width: panel.width, height: panel.height,
        gpuMatched: this.selected?.id === panel.id && !!this.frameTime && Date.now() - this.frameTime < 5000 }))
    };
  }
  startCapture(id) {
    if (this.captureTask || this.stopping) return Promise.reject(new Error('capture-busy'));
    this.captureTask = this.runStartCapture(id).finally(() => { this.captureTask = null; });
    return this.captureTask;
  }
  async runStartCapture(id) {
    if (this.captureStarting || this.stopping) throw new Error('capture-busy');
    this.captureStarting = true;
    const generation = ++this.generation;
    let panel;
    try {
      await this.ensureStarted(); await this.scan(true);
      if (this.closed || generation !== this.generation) throw new Error('capture-cancelled');
      panel = this.panels.find(panel => panel.id === id);
      if (this.closed || !this.simulator || !panel) throw new Error(this.error || 'no-panels');
      await this.stopCapture(false);
      if (this.closed || generation !== this.generation) throw new Error('capture-cancelled');
      this.selected = panel; this.marker = { id: 1, first: 0xff0000, second: 0x00ff00, width: panel.width, height: panel.height };
      this.error = ''; this.nativeState = 0; this.nativeDiagnostics = ''; this.startedAt = Date.now();
      await this.discovery.mark(panel, this.marker);
      if (this.closed || generation !== this.generation) throw new Error('capture-cancelled');
      this.capture = this.native(this.simulator.pid, this.marker, {
        frame: frame => {
          if (this.closed || generation !== this.generation || this.stopping || frame.id !== this.marker?.id || !this.selected) return;
          this.frame = frame.jpeg; this.frameTime = Date.now();
          this.frameTimes = this.frameTimes.filter(time => this.frameTime - time < 1000);
          this.frameTimes.push(this.frameTime);
          for (const client of this.clients) {
            if (client.id !== this.selected.id || client.ws.readyState !== WebSocket.OPEN || client.ws.bufferedAmount > 512 * 1024 || this.frameTime - client.lastSent < client.interval) continue;
            client.lastSent = this.frameTime; client.ws.send(frame.jpeg);
          }
        },
        state: state => {
          if (generation !== this.generation) return;
          this.nativeState = state;
          if (state < 0) {
            this.error = state <= -100 || state === -2 ? 'hook-install-failed'
              : ({'-1':'device-init-failed','-3':'enhanced-barriers','-4':'gpu-device-lost'}[state] || 'native-failed');
            void this.stopCapture();
          }
        },
        diagnostic: diagnostic => { if (generation === this.generation) this.nativeDiagnostics = diagnostic; },
        error: error => { if (generation === this.generation && this.error !== 'restart-game-required') this.error = error === 'ENOENT' ? 'native-missing' : error; },
        exit: code => {
          if (this.stopping || generation !== this.generation) return;
          this.error ||= code ? 'native-failed' : 'panel-lost';
          void this.stopCapture();
        }
      });
    } catch (error) {
      await this.stopCapture(false);
      if (panel) await this.discovery.mark(panel, null).catch(() => {});
      if (error.message !== 'capture-cancelled') this.error ||= error.message;
      throw error;
    } finally { this.captureStarting = false; }
  }
  async stopCapture(cancelStart = true) {
    if (cancelStart) this.generation++;
    if (this.stopping) return this.stopping;
    const capture = this.capture, panel = this.selected;
    this.capture = null; this.selected = null; this.frame = null; this.frameTime = 0; this.frameTimes = [];
    for (const client of this.clients) this.sendViewerStatus(client);
    this.stopping = (async () => {
      if (capture) await capture.stop();
      if (panel) await this.discovery.mark(panel, null).catch(() => {});
    })();
    try { await this.stopping; } finally { this.stopping = null; }
  }
  async close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.closePromise = (async () => {
      await this.startPromise?.catch(() => {});
      clearInterval(this.timer); clearInterval(this.pingTimer); clearInterval(this.statusTimer);
      await this.stopCapture();
      await this.captureTask?.catch(() => {});
      await this.scanPromise?.catch(() => {});
      await this.discovery.close();
      for (const client of this.clients) client.ws.terminate();
      this.clients.clear(); this.ws?.close();
      if (this.server?.listening) await new Promise(resolve => {
        this.server.close(resolve); this.server.closeAllConnections();
      });
    })();
    return this.closePromise;
  }
}
