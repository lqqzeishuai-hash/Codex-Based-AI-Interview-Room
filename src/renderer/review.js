'use strict';
const reviewUI = { session: null, pairs: [], selected: '', pending: false, loading: false, request: 0, drafts: new Map(), listSignature: '', chatSignature: '' };
const verdictLabels = { ok: '无明显问题', improve: '需要改进', insufficient: '证据不足', unanswered: '未回答' };
function reviewNode(tag, className, text) { const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node; }
function reviewPairs(session) {
 const pairs=[];let current;for(const [index,m] of (session.messages||[]).entries()){if(m.role==='assistant'){current={id:'q-'+(index+1),number:pairs.length+1,question:m.text,answer:''};pairs.push(current);}else if(m.role==='user'&&current)current.answer+=(current.answer?'\n\n':'')+m.text;}return pairs;
}
async function openQuestionReview(id) {
 if(reviewUI.session)reviewUI.drafts.set(reviewUI.session.id,$('coach-input').value);
 const request=++reviewUI.request;reviewUI.loading=true;reviewUI.session=null;reviewUI.pairs=[];state.viewedSession=null;showView('review');renderQuestionReview();
 try {
  if(!id){const sessions=await api.invoke('session/history');id=sessions[0]?.id;}
  if(!id){reviewUI.loading=false;renderQuestionReview();return;}
  const session=await api.invoke('session/read',{id});if(request!==reviewUI.request)return;
  reviewUI.session=session;reviewUI.pairs=reviewPairs(session);reviewUI.selected='';state.viewedSession=session;
  $('coach-input').value=reviewUI.drafts.get(id)??session.reviewChat?.draft?.text??'';
  if(session.reviewChat?.draft?.questionId)reviewUI.selected=session.reviewChat.draft.questionId;
  $('review-filter').value='all';
 }catch(error){toast(error.message);}finally{if(request===reviewUI.request){reviewUI.loading=false;renderQuestionReview();}}
}
function renderQuestionReview() {
 const session=reviewUI.session, review=session?.questionReview, chat=session?.reviewChat;
 const pending=reviewUI.pending||review?.status==='generating'||!!chat?.pending;
 const blocked=active()||state.busy||state.reviewBusy;
 const pairs=reviewUI.pairs;
 $('review-context').textContent=session?[session.role,session.settings?.company,session.settings?.department,new Date(session.createdAt).toLocaleString('zh-CN')].filter(Boolean).join(' · '):'选择一场面试，回看每一个回答。';
 const counts=(review?.items||[]).reduce((all,i)=>(all[i.verdict]=(all[i.verdict]||0)+1,all),{});
 $('review-summary').textContent=review?.status==='generating'?`正在逐题核对 · 已处理 ${review.processed||0} / ${review.total||pairs.length} 题`:
  review?.items?.length?`${pairs.length} 道问题 · ${counts.improve||0} 道需要改进 · ${counts.ok||0} 道无明显问题${counts.insufficient?' · '+counts.insufficient+' 道证据不足':''}${counts.unanswered?' · '+counts.unanswered+' 道未回答':''}`:'逐问核对会保留原回答，并给出具体建议。';
 buttonText('generate-review',review?.status==='generating'?'正在核对…':review?.status==='failed'?'重试逐问核对':review?.items?.length?'重新生成核对':'生成逐问核对','spark');
 $('generate-review').disabled=!session||!pairs.length||pending||blocked;
 $('stop-review').classList.toggle('hidden',!pending||!session);$('stop-review').disabled=reviewUI.pending&&!review?.status&&!chat?.pending;
 $('review-overview').disabled=!session;$('review-export').disabled=!session;
 $('review-error').classList.toggle('hidden',!review?.error);$('review-error').textContent=review?.error||'';
 const signature=JSON.stringify([session?.id,review,pairs,reviewUI.selected,$('review-filter').value,reviewUI.loading,pending]);
 if(signature!==reviewUI.listSignature){reviewUI.listSignature=signature;const list=$('question-review-list');list.replaceChildren();
  if(!pairs.length){list.append(reviewNode('div','review-empty',reviewUI.loading?'正在读取面试记录…':'还没有可核对的面试记录。请先完成一场面试。'));}
  let shown=0;
  for(const pair of pairs){const item=review?.items?.find(i=>i.id===pair.id);if($('review-filter').value==='improve'&&item?.verdict!=='improve')continue;shown++;
   const card=reviewNode('article','question-review-card '+(item?.verdict||'pending'));card.classList.toggle('selected',pair.id===reviewUI.selected);
   const header=reviewNode('div','question-review-header');header.append(reviewNode('strong','','第 '+String(pair.number).padStart(2,'0')+' 题'),reviewNode('span','verdict-tag '+(item?.verdict||''),verdictLabels[item?.verdict]||(pair.answer?'待核对':'未回答')));card.append(header);
   card.append(reviewNode('h2','review-question',pair.question),reviewNode('div','review-field-label','你的原回答'),reviewNode('p','original-answer',pair.answer||'这道题尚未记录回答。'));
   if(item){card.append(reviewNode('p','review-judgment',item.summary));for(const issue of item.issues){const block=reviewNode('div','review-issue');block.append(reviewNode('div','review-field-label','具体问题'),reviewNode('blockquote','',issue.quote),reviewNode('p','',issue.reason),reviewNode('p','issue-suggestion','可以这样调整：'+issue.suggestion));card.append(block);}if(item.recommendedAnswer){const recommendation=reviewNode('section','recommended-answer');recommendation.append(reviewNode('h3','',item.verdict==='insufficient'?'练习框架（需结合真实情况）':'推荐回答'),reviewNode('p','',item.recommendedAnswer));card.append(recommendation);}}
   const actions=reviewNode('div','question-review-actions');const ask=reviewNode('button','text-button',pair.id===reviewUI.selected?'正在讨论这道题':'针对这道题提问');ask.disabled=pending;ask.addEventListener('click',()=>{reviewUI.selected=pair.id;renderQuestionReview();$('coach-input').focus({preventScroll:true});});actions.append(ask);card.append(actions);list.append(card);
  }
  if(pairs.length&&!shown)list.append(reviewNode('div','review-empty',review?.status==='completed'?'本场没有标记为“需要改进”的回答。':'请先生成逐问核对，再筛选需要改进的回答。'));
 }
 const select=$('coach-question');if(select.dataset.session!==session?.id){select.replaceChildren(new Option('整场面试',''));for(const p of pairs)select.add(new Option('第 '+p.number+' 题 · '+p.question.slice(0,35),p.id));select.dataset.session=session?.id||'';}select.value=reviewUI.selected;select.disabled=!session||pending;
 const chatSignature=JSON.stringify([session?.id,chat?.messages,chat?.pending]);
 if(chatSignature!==reviewUI.chatSignature){reviewUI.chatSignature=chatSignature;const messages=$('coach-messages');messages.replaceChildren();
  if(!chat?.messages?.length)messages.append(reviewNode('p','coach-welcome',!session?'完成面试后，可以在这里针对某道题继续提问。':'我了解这场面试的岗位、公司、项目背景和问答。选一道题，可以问我哪里答得不准确，也可以让我举例讲解。'));
  for(const message of chat?.messages||[]){const box=reviewNode('div','coach-message '+message.role);const pair=pairs.find(p=>p.id===message.questionId);box.append(reviewNode('div','coach-message-label',(message.role==='user'?'你':'答疑教练')+' · '+(pair?'第 '+pair.number+' 题':'整场面试')));const body=reviewNode('div','coach-message-body');renderMarkdown(body,message.text);box.append(body);messages.append(box);}messages.scrollTop=messages.scrollHeight;
 }
 $('coach-pending').classList.toggle('hidden',!chat?.pending);$('coach-error').classList.toggle('hidden',!chat?.error);$('coach-error').textContent=chat?.error||'';
 $('coach-input').disabled=!session||pending||blocked;$('coach-send').disabled=!session||pending||blocked||!$('coach-input').value.trim();
 if(active())$('review-summary').textContent+=' · 请结束当前面试后生成或提问';
}
function receiveReview(session) {if(reviewUI.session?.id!==session.id)return;reviewUI.session=session;reviewUI.pairs=reviewPairs(session);state.viewedSession=session;renderQuestionReview();}
async function generateQuestionReview(){const session=reviewUI.session;if(!session||reviewUI.pending)return;reviewUI.pending=true;renderQuestionReview();try{receiveReview(await api.invoke('review/generate',{id:session.id}));}catch(error){toast(error.message);}finally{reviewUI.pending=false;renderQuestionReview();}}
async function askReview(event){event.preventDefault();const session=reviewUI.session,text=$('coach-input').value.trim(),questionId=reviewUI.selected;if(!session||!text||reviewUI.pending)return;reviewUI.pending=true;reviewUI.drafts.set(session.id,text);renderQuestionReview();try{const result=await api.invoke('review/ask',{id:session.id,questionId,text});reviewUI.drafts.delete(session.id);if(reviewUI.session?.id===session.id){$('coach-input').value='';receiveReview(result);}}catch(error){toast(error.message);}finally{reviewUI.pending=false;renderQuestionReview();}}
$('nav-review').addEventListener('click',()=>openQuestionReview(state.viewedSession?.id||state.session?.id));
$('open-question-review').addEventListener('click',()=>openQuestionReview(state.viewedSession?.id));
$('review-overview').addEventListener('click',()=>{if(reviewUI.session)showReport(reviewUI.session);});
$('review-export').addEventListener('click',exportReport);
$('generate-review').addEventListener('click',generateQuestionReview);
$('stop-review').addEventListener('click',async()=>{try{await api.invoke('review/interrupt',{id:reviewUI.session.id});}catch(error){toast(error.message);}});
$('review-filter').addEventListener('change',renderQuestionReview);
$('coach-question').addEventListener('change',()=>{reviewUI.selected=$('coach-question').value;renderQuestionReview();});
$('coach-form').addEventListener('submit',askReview);
$('coach-input').addEventListener('input',()=>{if(reviewUI.session)reviewUI.drafts.set(reviewUI.session.id,$('coach-input').value);renderQuestionReview();});
$('coach-input').addEventListener('keydown',event=>{if(event.ctrlKey&&event.key==='Enter'){event.preventDefault();if(!$('coach-send').disabled)$('coach-form').requestSubmit();}});
api.onEvent(event=>{if(event.type==='review-state'){state.reviewBusy=event.reviewBusy;receiveReview(event.session);render();}else if(event.type==='state'){state.reviewBusy=event.reviewBusy;if(state.view==='review')renderQuestionReview();}});
