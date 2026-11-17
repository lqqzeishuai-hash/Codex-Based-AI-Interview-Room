const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { EventEmitter } = require('node:events');
const path = require('node:path');
class NativeSpeech extends EventEmitter {
  constructor() { super(); this.child = null; this.capabilities = null; this.starting = null; }
  async start() {
    if (this.capabilities && this.child) return this.capabilities;
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      const nativeDirectory = path.join(__dirname, '..', 'native').replace('app.asar', 'app.asar.unpacked');
      const script = path.join(nativeDirectory, 'speech-host.ps1');
      const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      this.child = child; let settled = false; let stderr = '';
      const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('Windows 语音服务启动超时。')); child.kill(); } }, 30000);
      readline.createInterface({ input: child.stdout }).on('line', line => {
        let event; try { event = JSON.parse(line.replace(/^\uFEFF/, '')); } catch { return; }
        if (event.type === 'capabilities') { this.capabilities = event; settled = true; clearTimeout(timer); resolve(event); }
        if (event.type === 'speech-error' && !settled) { settled = true; clearTimeout(timer); reject(new Error(event.message)); }
        this.emit('event', event);
      });
      child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-2000); });
      child.on('error', error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
      child.on('exit', code => { this.child = null; this.capabilities = null; if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`Windows 语音服务退出（${code}）：${stderr}`)); } this.emit('event', { type: 'listening', active: false }); });
    }).finally(() => { this.starting = null; });
    return this.starting;
  }
  async command(action, params = {}) { await this.start(); this.child.stdin.write(JSON.stringify({ ...params, action }) + '\n'); return { accepted: true }; }
  close() { if (this.child) { this.child.stdin.write(JSON.stringify({ action: 'shutdown' }) + '\n'); this.child.stdin.end(); const child = this.child; const timer = setTimeout(() => child.kill(), 1500); timer.unref(); } }
}
module.exports = { NativeSpeech };
