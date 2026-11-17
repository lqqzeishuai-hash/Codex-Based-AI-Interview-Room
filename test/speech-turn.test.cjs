const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('rejected speech after a partial hypothesis resumes sending the confirmed answer', () => {
  const elements = new Map();
  const timers = new Map();
  let timerSequence = 0;
  let onEvent;
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {}, replaceChildren() {}, append() {}, insertAdjacentHTML() {}
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: element, querySelectorAll: () => [], addEventListener() {} },
    window: {
      interview: { onEvent: callback => { onEvent = callback; }, invoke: () => new Promise(() => {}) },
      addEventListener() {}
    },
    setTimeout: callback => { const id = ++timerSequence; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id), setInterval: () => ++timerSequence, clearInterval() {},
    Date, console
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8'), context);
  vm.runInContext("state.settings={autoSend:true,silenceMs:3200};state.session={status:'active'};state.listeningRequested=true;render=()=>{};answerSent=0;sendAnswer=async()=>{answerSent++;};", context);
  const emit = event => onEvent({ type: 'speech', event });
  emit({ type: 'recognized', text: '先提交数据库，再删除缓存' });
  assert.equal(element('answer-text').value, '先提交数据库，再删除缓存');
  assert.equal(timers.size, 1);
  emit({ type: 'hypothesis', text: '噪声' });
  assert.equal(timers.size, 0);
  emit({ type: 'rejected' });
  assert.equal(element('hypothesis').textContent, '');
  assert.equal(element('answer-text').value, '先提交数据库，再删除缓存');
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.equal(vm.runInContext('answerSent', context), 1);
  vm.runInContext('state.paused=true', context);
  emit({ type: 'rejected' });
  assert.equal(timers.size, 0, 'a paused interview must not start another send timer');
});
