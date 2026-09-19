import WebSocket from 'ws';
import { inspectPanelPage, markPanelPage } from './panel-agent.mjs';

class InstrumentConnection {
  constructor(id) {
    this.pending = new Map();
    this.sequence = 0;
    this.socket = new WebSocket(`ws://127.0.0.1:19999/devtools/page/${id}`, { handshakeTimeout: 2500, maxPayload: 256 * 1024 });
    this.ready = new Promise((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
      this.socket.once('close', () => reject(new Error('instrument-disconnected')));
    });
    this.ready.catch(() => {});
    this.socket.on('error', () => {});
    this.socket.on('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('instrument-disconnected'));
      this.pending.clear();
    });
    this.socket.on('message', bytes => {
      try {
        const reply = JSON.parse(bytes.toString());
        const pending = this.pending.get(reply.id);
        if (!pending) return;
        if (reply.error || reply.result?.wasThrown || reply.result?.exceptionDetails) pending.reject(new Error('instrument-evaluation-failed'));
        else pending.resolve(reply.result?.result?.value);
      } catch { /* Ignore unrelated inspector events. */ }
    });
  }
  async evaluate(fn, argument) {
    await this.ready;
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(reject, new Error('instrument-timeout')), 2500);
      const finish = (callback, value) => { clearTimeout(timer); this.pending.delete(id); callback(value); };
      this.pending.set(id, { resolve: value => finish(resolve, value), reject: error => finish(reject, error) });
      this.socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: {
        expression: `JSON.stringify((${fn.toString()})(${JSON.stringify(argument ?? null)}))`, returnByValue: true
      } }), error => { if (error) finish(reject, error); });
    }).then(value => JSON.parse(value));
  }
  close() { this.socket.terminate(); }
}

export class PanelDiscovery {
  constructor() { this.connections = new Map(); this.markedPages = new Set(); this.closed = false; }
  async scan() {
    const response = await fetch('http://127.0.0.1:19999/pagelist.json', { signal: AbortSignal.timeout(2500), redirect: 'error' });
    if (!response.ok) throw new Error('inspector-unavailable');
    const text = await response.text();
    if (text.length > 256 * 1024) throw new Error('inspector-invalid');
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error('inspector-invalid');
    const pages = data.filter(page => Number.isInteger(page.id) && page.id >= 0 &&
      /^coui:\/\/html_ui\/(?:pages\/vcockpit\/core\/vcockpit\.html|efb_ui\/)/i.test(page.url)).slice(0, 48);
    if (this.closed) return [];
    for (const [id, connection] of this.connections) {
      if (!pages.some(page => page.id === id)) { connection.close(); this.connections.delete(id); }
    }
    const panels = [];
    const deadline = Date.now() + 6000;
    for (const page of pages) {
      if (this.closed || Date.now() > deadline) break;
      let connection = this.connections.get(page.id);
      if (!connection) { connection = new InstrumentConnection(page.id); this.connections.set(page.id, connection); }
      try {
        const instruments = await connection.evaluate(inspectPanelPage);
        for (const panel of instruments) panels.push({ ...panel, id: `${page.id}-${panel.index}`, pageId: page.id, name: panel.name.replace(/_/g, ' ') });
      } catch {
        connection.close(); this.connections.delete(page.id);
      }
    }
    return panels;
  }
  async mark(panel, marker) {
    const connection = this.connections.get(panel.pageId);
    if (!connection) throw new Error('instrument-disconnected');
    if (marker) this.markedPages.add(panel.pageId);
    const marked = await connection.evaluate(markPanelPage, marker ? { ...marker, index: panel.index } : null);
    if (marker && !marked) throw new Error('panel-no-longer-visible');
    if (!marker) this.markedPages.delete(panel.pageId);
  }
  async close() {
    this.closed = true;
    await Promise.all([...this.markedPages].map(id => this.connections.get(id)?.evaluate(markPanelPage, null).catch(() => {})));
    for (const connection of this.connections.values()) {
      connection.close();
    }
    this.connections.clear(); this.markedPages.clear();
  }
}
