import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mergeMessages,messageKey,reconcileMessages,optimisticMessage} from '../public/message-state.js';
const item={id:'client-1',user:'alice',chat:'chat',created:100,payload:{body:'hello'}};
const confirmed={id:'server-1',client_id:item.id,chat_id:'chat',user_id:'alice',body:'hello',created:101};
test('HTTP, realtime, stale history and outbox converge without replacing optimistic object',()=>{
 for(const order of [[confirmed,confirmed],[confirmed,{...confirmed,clientMessageId:item.id}], [{...confirmed,clientMessageId:item.id},confirmed]]){
  let rows=mergeMessages([],[optimisticMessage(item)]),original=rows[0];const key=messageKey(original);
  rows=mergeMessages(rows,[]);assert.equal(rows[0],original);
  for(const m of order)rows=mergeMessages(rows,[m]);
  rows=mergeMessages(rows,[optimisticMessage({...item,error:'late network failure'})]);
  assert.equal(rows.length,1);assert.equal(rows[0],original);assert.equal(messageKey(original),key);assert.equal(original.id,'server-1');assert.equal(original.pending,false);
 }
});
test('keys are scoped to sender, equal text is not deduplicated, deletes and edits survive delayed ACK',()=>{
 let rows=mergeMessages([],[confirmed,{...confirmed,id:'server-2',user_id:'bob'}, {...confirmed,id:'server-3',client_id:'client-3'}]);assert.equal(rows.length,3);
 rows=mergeMessages(rows,[{...confirmed,body:'edited',edited:200}]);rows=mergeMessages(rows,[confirmed]);assert.equal(rows[0].body,'edited');
 rows=mergeMessages(rows,[{...confirmed,body:'',deleted:true}]);rows=mergeMessages(rows,[confirmed]);assert.equal(rows[0].deleted,true);assert.equal(rows[0].body,'');
});
test('DOM article and body remain attached through ACK; repeated history preserves playing media',()=>{
 const dom=new JSDOM('<section></section>'),box=dom.window.document.querySelector('section');
 const html=(id,status)=>`<article data-key="client:alice:client-1" data-id="${id}"><div class="bubble"><div class="body">hello</div><audio src="/file"></audio><small>${status}</small></div></article>`;
 reconcileMessages(box,html('local:client-1','sending'));const article=box.firstChild,body=article.querySelector('.body'),audio=article.querySelector('audio');audio.currentTime=12;
 reconcileMessages(box,html('server-1','sent'));reconcileMessages(box,html('server-1','sent'));
 assert.equal(box.children.length,1);assert.equal(box.firstChild,article);assert.equal(article.querySelector('.body'),body);assert.equal(article.querySelector('audio'),audio);assert.equal(audio.currentTime,12);assert.equal(article.dataset.id,'server-1');dom.window.close();
});
