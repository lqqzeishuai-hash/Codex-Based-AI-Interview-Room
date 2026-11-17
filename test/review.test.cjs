const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { questionPairs, parseReview, ReviewService } = require('../src/core/review.cjs');
const { Store, toMarkdown } = require('../src/core/store.cjs');
const messages = [
 { role:'assistant', text:'TTL是多少？' }, { role:'user', text:'37秒。' },
 { role:'assistant', text:'outbox如何避免重复副作用？' }, { role:'user', text:'天然保证恰好一次。' },
 { role:'assistant', text:'你实际做了什么？' }
];
const good = { items:[
 { id:'q-1', verdict:'ok', summary:'与项目TTL一致。', issues:[], recommendedAnswer:'' },
 { id:'q-3', verdict:'improve', summary:'投递可能重试。', issues:[{ quote:'天然保证恰好一次', reason:'outbox不能独自保证端到端恰好一次。', suggestion:'解释重试和消费幂等。' }], recommendedAnswer:'outbox保证本地事务与事件写入一致；投递可能重复，消费者应做幂等。' }
] };
function directory(t) { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'interview-review-test-'));t.after(()=>{const resolved=path.resolve(dir);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(resolved).startsWith('interview-review-test-'));fs.rmSync(resolved,{recursive:true,force:true});});return dir; }
test('question review keeps original words, follow-ups, and the final unanswered question',()=>{
 const pairs=questionPairs({messages:[{role:'user',text:'背景'},...messages]});assert.equal(pairs.length,3);assert.equal(pairs[0].question,'TTL是多少？');assert.equal(pairs[0].answer,'37秒。');assert.equal(pairs[1].answer,'天然保证恰好一次。');assert.equal(pairs[2].answer,'');
 const continued=questionPairs({messages:[...messages,{role:'user',text:'说明一'},{role:'user',text:'补充二'}]});assert.equal(continued[2].answer,'说明一\n\n补充二');
});
test('structured review rejects omissions, duplicate IDs and invented quotations',()=>{
 const pairs=questionPairs({messages}).slice(0,2);assert.equal(parseReview(JSON.stringify(good),pairs)[1].verdict,'improve');
 assert.throws(()=>parseReview('{"items":[]}',pairs),/漏题/);
 const duplicate=structuredClone(good);duplicate.items[1].id='q-1';assert.throws(()=>parseReview(JSON.stringify(duplicate),pairs),/题号/);
 const fabricated=structuredClone(good);fabricated.items[1].issues[0].quote='我没说过这句话';assert.throws(()=>parseReview(JSON.stringify(fabricated),pairs),/原回答不一致/);
 const missing=structuredClone(good);missing.items[1].recommendedAnswer='';assert.throws(()=>parseReview(JSON.stringify(missing),pairs),/推荐说法/);
 const okay=structuredClone(good);okay.items[0].issues=good.items[1].issues;assert.throws(()=>parseReview(JSON.stringify(okay),pairs));
});
test('review and scoped coaching remain available after restart and in export; legacy records still open',t=>{
 const dir=directory(t),store=new Store(dir);const session={id:'review-record',createdAt:'2026-11-17T01:00:00Z',role:'后端开发',status:'completed',messages,report:'原总体复盘',questionReview:{status:'completed',items:good.items},reviewChat:{messages:[{role:'user',questionId:'q-3',text:'为什么会重复？'},{role:'assistant',questionId:'q-3',text:'发送成功后标记失败，可能再次发送。'}]}};
 store.saveSession(session);const restored=new Store(dir).session(session.id);assert.deepEqual(restored,session);const exported=toMarkdown(restored);for(const text of ['原总体复盘','逐问核对','天然保证恰好一次','消费幂等','为什么会重复','q-3'])assert.ok(exported.includes(text));
 const legacy={...session,id:'legacy'};delete legacy.questionReview;delete legacy.reviewChat;store.saveSession(legacy);assert.ok(toMarkdown(new Store(dir).session('legacy')).includes('原总体复盘'));
});
test('interrupted review and coaching are recoverable without losing saved results or the draft',t=>{
 const store=new Store(directory(t));store.saveSession({id:'interrupted',createdAt:'2026-11-17',role:'后端',messages,questionReview:{status:'generating',items:good.items},reviewChat:{pending:true,draft:{text:'请再解释',questionId:'q-3'},messages:[]}});
 const review=new ReviewService({store,getCurrent:()=>null});const restored=review.read('interrupted');assert.equal(restored.questionReview.status,'failed');assert.equal(restored.questionReview.items.length,2);assert.equal(restored.reviewChat.pending,false);assert.equal(restored.reviewChat.draft.text,'请再解释');assert.match(restored.reviewChat.error,/中断/);assert.deepEqual(new Store(store.directory).session('interrupted'),restored);
});
