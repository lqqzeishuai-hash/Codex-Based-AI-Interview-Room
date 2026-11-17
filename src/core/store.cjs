const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const DEFAULTS = { role: '软件开发工程师', company: '', department: '', projectPath: '', personalContext: '', stylePrompt: '', jobDescription: '', sourceThreadId: '', sourceThreadName: '', difficulty: '标准', duration: 20, autoSend: true, silenceMs: 3200, voiceName: 'Microsoft Huihui Desktop', speechRate: 0, speakEnabled: true };
class Store {
  constructor(directory) { this.directory = directory; fs.mkdirSync(path.join(directory, 'sessions'), { recursive: true }); }
  read(name, fallback) { try { return JSON.parse(fs.readFileSync(path.join(this.directory, name), 'utf8')); } catch { return fallback; } }
  write(name, value) {
    const target = path.join(this.directory, name); const temporary = `${target}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8'); fs.renameSync(temporary, target);
  }
  settings() { return { ...DEFAULTS, ...this.read('settings.json', {}) }; }
  saveSettings(value) {
    const previous = this.settings();
    const allowed = Object.fromEntries(Object.keys(DEFAULTS).filter(key => key in value).map(key => [key, value[key]]));
    const next = { ...previous, ...allowed };
    next.role = String(next.role || '软件开发工程师').slice(0, 120);
    next.duration = Math.max(5, Math.min(120, Number(next.duration) || 20));
    next.silenceMs = Math.max(2000, Math.min(10000, Number(next.silenceMs) || 3200));
    next.speechRate = Math.max(-5, Math.min(5, Number(next.speechRate) || 0));
    for (const key of ['company','department','projectPath','personalContext','stylePrompt','jobDescription','sourceThreadId','sourceThreadName']) next[key] = String(next[key] || '').slice(0, key.endsWith('Context') || key === 'jobDescription' || key === 'stylePrompt' ? 20000 : 2000);
    for (const key of ['autoSend','speakEnabled']) next[key] = Boolean(next[key]);
    this.write('settings.json', next); return next;
  }
  saveSession(session) { this.write(path.join('sessions', `${session.id}.json`), session); }
  session(id) { if (!/^[\w-]+$/.test(id)) throw new Error('无效的面试编号。'); return this.read(path.join('sessions', `${id}.json`), null); }
  sessions() {
    return fs.readdirSync(path.join(this.directory, 'sessions')).filter(name => /^[\w-]+\.json$/.test(name))
      .map(name => this.read(path.join('sessions', name), null)).filter(Boolean)
      .sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(({ id, createdAt, role, status, messages, projectPath, report, threadId }) => ({ id, createdAt, role, status, turns: messages.filter(m => m.role === 'user').length, projectPath, hasReport: Boolean(report), threadId }));
  }
}
function toMarkdown(session) {
  const settings = session.settings || {}; const lines = [`# ${session.role} · 模拟面试`, '', `开始时间：${session.createdAt}`, `模拟公司：${settings.company || '未指定'}`, `模拟部门：${settings.department || '未指定'}`, `项目目录：${session.projectPath || '通用面试'}`, `Codex 会话：${session.threadId || ''}`]; if (settings.stylePrompt) lines.push(`面试风格提示词：${settings.stylePrompt}`); lines.push('', '## 面试记录', '');
  for (const message of session.messages) lines.push(`### ${message.role === 'user' ? '我的回答' : '面试官'}`, '', message.text, '');
  if (session.report) lines.push('## 面试复盘', '', session.report, '');
  if (session.questionReview?.items?.length) {
    const { questionPairs } = require('./review.cjs');
    lines.push('## 逐问核对', '');
    if (session.questionReview.status !== 'completed') lines.push('上次生成未完成，以下为之前已保存的核对结果。', '');
    for (const pair of questionPairs(session)) {
      const item = session.questionReview.items.find(i => i.id === pair.id); if (!item) continue;
      lines.push(`### 第${pair.number}题 · ${{ok:'无明显问题',improve:'需要改进',insufficient:'证据不足',unanswered:'未回答'}[item.verdict]}`, '', pair.question, '', '我的原回答：', '', pair.answer || '未回答', '', item.summary, '');
      for (const issue of item.issues) lines.push(`> ${issue.quote}`, '', `问题：${issue.reason}`, '', `建议：${issue.suggestion}`, '');
      if (item.recommendedAnswer) lines.push('推荐回答：', '', item.recommendedAnswer, '');
    }
  }
  if (session.reviewChat?.messages?.length) {
    lines.push('## 核对答疑', '');
    for (const m of session.reviewChat.messages) lines.push(`### ${m.role === 'user' ? '我的提问' : '答疑教练'} · ${m.questionId || '整场面试'}`, '', m.text, '');
  }
  return lines.join('\n');
}
module.exports = { Store, DEFAULTS, toMarkdown };
