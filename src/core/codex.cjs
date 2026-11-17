const { spawn, spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const readline = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { parse } = require('smol-toml');

function redact(value) {
  return String(value || '').replace(/\bsk-[\w-]{12,}/g, '[已隐藏密钥]')
    .replace(/(Bearer\s+)[\w.\-+/=]+/gi, '$1[已隐藏]')
    .replace(/((?:api[_-]?key|access_token|authorization)\s*[=:]\s*)[^\s,;]+/gi, '$1[已隐藏]');
}
function configSummary() {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const configPath = path.join(home, 'config.toml');
  try {
    const config = parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
    const providerId = config.model_provider || 'openai';
    const provider = config.model_providers?.[providerId] || {};
    let gateway = '';
    try { gateway = new URL(provider.base_url || config.openai_base_url || 'https://api.openai.com').host; } catch {}
    return { configPath, model: config.model || 'Codex 默认模型', provider: providerId,
      gateway, protocol: provider.wire_api || 'responses', mcpCount: Object.keys(config.mcp_servers || {}).length,
      custom: providerId !== 'openai' || Boolean(config.openai_base_url), error: null };
  } catch (error) {
    return { configPath, model: 'Codex 默认模型', provider: '默认', gateway: '', mcpCount: 0, error: redact(error.message) };
  }
}
function discoverCodex() {
  if (process.env.AI_INTERVIEW_CODEX_BIN && fs.existsSync(process.env.AI_INTERVIEW_CODEX_BIN)) return process.env.AI_INTERVIEW_CODEX_BIN;
  const windowsApps = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WindowsApps');
  try {
    const installs = fs.readdirSync(windowsApps).filter(name => /^OpenAI\.Codex_/.test(name)).sort((a,b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const name of installs) {
      const candidate = path.join(windowsApps, name, 'app', 'resources', 'codex.exe');
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {}
  try {
    const installed = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '(Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1 -ExpandProperty InstallLocation)'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    const installPath = (installed.stdout || '').trim();
    const desktopBinary = path.join(installPath, 'app', 'resources', 'codex.exe');
    if (installPath && fs.existsSync(desktopBinary)) return desktopBinary;
  } catch {}
  const npmRoot = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', '@openai', 'codex');
  const candidates = [
    path.join(npmRoot, 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'),
    path.join(npmRoot, 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'codex', 'codex.exe'),
    path.join(npmRoot, 'vendor', 'x86_64-pc-windows-msvc', 'codex', 'codex.exe')
  ];
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  throw new Error('没有找到本机 Codex。请安装 Codex 桌面版，或设置 AI_INTERVIEW_CODEX_BIN 指向 codex.exe。');
}
class CodexClient extends EventEmitter {
  constructor() { super(); this.nextId = 1; this.pending = new Map(); this.turns = new Map(); this.child = null; this.ready = false; this.connecting = null; this.stderr = ''; }
  async connect() {
    if (this.ready) return this.info;
    if (this.connecting) return this.connecting;
    this.connecting = this._connect().finally(() => { this.connecting = null; });
    return this.connecting;
  }
  async _connect() {
    this.binary = discoverCodex();
    const child = spawn(this.binary, ['app-server', '--listen', 'stdio://'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', line => { try { this.handle(JSON.parse(line)); } catch (error) { this.emit('diagnostic', redact(error.message)); } });
    child.stderr.on('data', data => { this.stderr = redact((this.stderr + data.toString('utf8')).slice(-4000)); });
    child.on('error', error => this.fail(error));
    child.on('exit', (code) => { if (this.child === child) { this.child = null; this.ready = false; this.fail(new Error(`Codex 连接已关闭（${code ?? '退出'}）。请重新连接。`)); } });
    const result = await this.request('initialize', { clientInfo: { name: 'ai_interview_studio', title: 'AI面试室', version: '0.1.0' }, capabilities: { experimentalApi: true } }, 45000);
    this.notify('initialized', {});
    this.info = { ...configSummary(), binary: this.binary, version: result.userAgent || result.serverInfo?.version || '本机 Codex' };
    this.ready = true;
    this.emit('connected', this.info);
    return this.info;
  }
  fail(error) {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
    for (const turn of this.turns.values()) { clearTimeout(turn.timer); turn.reject(error); }
    this.turns.clear();
    this.emit('connection-error', redact(error.message));
  }
  notify(method, params) { if (this.child?.stdin.writable) this.child.stdin.write(JSON.stringify({ method, params }) + '\n'); }
  request(method, params, timeout = 60000) {
    return new Promise((resolve, reject) => {
      if (!this.child?.stdin.writable) return reject(new Error('Codex 尚未连接。'));
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} 等待超时，请检查模型网关或重新连接。`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  handle(message) {
    if (message.id != null && !message.method) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id); clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(redact(message.error.message)));
      else entry.resolve(message.result);
      return;
    }
    if (message.method && message.id != null) {
      const method = message.method;
      let result;
      if (method.includes('requestApproval')) result = method.includes('permissions') ? { permissions: {}, scope: 'turn' } : { decision: 'decline' };
      else if (method.includes('elicitation')) result = { action: 'cancel', content: null };
      else if (method === 'tool/requestUserInput') result = { answers: {} };
      if (result) this.child?.stdin.write(JSON.stringify({ id: message.id, result }) + '\n');
      else this.child?.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: 'Unsupported host request' } }) + '\n');
      this.emit('activity', { kind: 'permission', label: '已保持项目只读权限' });
      return;
    }
    const params = message.params || {};
    const turn = this.turns.get(params.threadId);
    if (message.method === 'turn/started' && turn) turn.turnId = params.turn?.id;
    if (message.method === 'item/agentMessage/delta' && turn) {
      const text = (turn.deltas.get(params.itemId) || '') + (params.delta || '');
      turn.deltas.set(params.itemId, text);
    }
    if (message.method === 'item/started') {
      const type = params.item?.type;
      const labels = { commandExecution: '正在阅读项目资料', mcpToolCall: '正在使用已配置的工具', collabAgentToolCall: 'Agent 正在协作', webSearch: '正在检索资料' };
      if (labels[type]) this.emit('activity', { kind: type, label: labels[type] });
    }
    if (message.method === 'item/completed' && turn && params.item?.type === 'agentMessage') {
      const item = params.item;
      turn.messages.push({ id: item.id, text: item.text || turn.deltas.get(item.id) || '', phase: item.phase });
    }
    if (message.method === 'turn/completed' && turn) {
      this.turns.delete(params.threadId); clearTimeout(turn.timer);
      const state = params.turn;
      if (state?.status !== 'completed') return turn.reject(new Error(redact(state?.error?.message || (state?.status === 'interrupted' ? '本轮已停止。' : '模型未完成回答，请重试。'))));
      const finals = turn.messages.filter(item => item.phase === 'final_answer');
      const selected = finals.length ? finals : turn.messages.slice(-1);
      const text = selected.map(item => item.text).join('\n').trim();
      if (!text) return turn.reject(new Error('模型返回了空内容，请检查网关的 Responses 流式兼容性。'));
      turn.resolve({ text, turnId: state.id });
    }
  }
  async createThread({ cwd, instructions, sourceThreadId }) {
    await this.connect();
    const params = { cwd, sandbox: 'read-only', approvalPolicy: 'never', developerInstructions: instructions,
      config: { model_reasoning_effort: 'low', model_verbosity: 'low', web_search: 'disabled' } };
    const result = sourceThreadId
      ? await this.request('thread/fork', { ...params, threadId: sourceThreadId })
      : await this.request('thread/start', params);
    return result.thread;
  }
  async runPrompt(threadId, text, timeout = 240000) {
    if (this.turns.has(threadId)) throw new Error('上一轮还在进行中，请稍候。');
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.turns.delete(threadId); this.interrupt(threadId).catch(() => {}); reject(new Error('模型响应超过四分钟，请检查网关后重试。')); }, timeout);
      this.turns.set(threadId, { resolve, reject, timer, deltas: new Map(), messages: [], turnId: null });
    });
    // Attach the handler before sending: a fast local provider may finish before the RPC response.
    done.catch(() => {});
    try {
      const result = await this.request('turn/start', { threadId, input: [{ type: 'text', text, text_elements: [] }] });
      const active = this.turns.get(threadId); if (active) active.turnId = result.turn?.id;
    } catch (error) {
      const active = this.turns.get(threadId);
      if (active) { this.turns.delete(threadId); clearTimeout(active.timer); active.reject(error); }
    }
    return done;
  }
  async interrupt(threadId) {
    const active = this.turns.get(threadId);
    if (active?.turnId && this.child) await this.request('turn/interrupt', { threadId, turnId: active.turnId }, 10000);
  }
  async listThreads() {
    await this.connect();
    const result = await this.request('thread/list', { limit: 40, archived: false, modelProviders: [], sourceKinds: ['cli', 'vscode', 'appServer', 'exec'] });
    return (result.data || []).map(thread => ({ id: thread.id, name: thread.name || thread.preview?.slice(0,70) || '未命名会话', cwd: thread.cwd || '', updatedAt: thread.updatedAt }));
  }
  async close() {
    const child = this.child; this.child = null; this.ready = false;
    this.fail(new Error('Codex 连接已重置。'));
    if (child) { child.stdin.end(); child.kill(); }
  }
}
module.exports = { CodexClient, configSummary, discoverCodex, redact };
