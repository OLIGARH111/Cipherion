import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {reconcileChatList} from '../public/message-state.js';

const row=(id,text=id)=>({id,html:`<button data-chat="${id}"><img src="/${id}.png"><span>${text}</span></button>`});
test('typing updates preserve other chats, focus, images and handlers',()=>{
  const dom=new JSDOM('<main></main>');const box=dom.window.document.querySelector('main');
  let bindings=0,clicks=0;
  const bind=node=>{bindings++;node.onclick=()=>clicks++;};
  const rows=Array.from({length:1000},(_,i)=>row(String(i)));
  reconcileChatList(box,rows,bind);
  const original=[...box.children],image=original[500].firstChild;
  original[500].focus();
  const observer=new dom.window.MutationObserver(()=>{});observer.observe(box,{subtree:true,childList:true,attributes:true,characterData:true});
  reconcileChatList(box,rows,bind);
  assert.equal(observer.takeRecords().length,0);
  assert.equal(bindings,1000);
  rows[3]=row('3','печатает…');reconcileChatList(box,rows,bind);
  assert.equal(bindings,1001);
  assert.deepEqual([...box.children],original);
  assert.equal(box.children[500].firstChild,image);
  assert.equal(dom.window.document.activeElement,original[500]);
  original[500].click();assert.equal(clicks,1);
  assert.equal(box.children[3].textContent,'печатает…');
  observer.disconnect();dom.window.close();
});
test('sorting, deletion, search results and account replacement leave no stale rows',()=>{
  const dom=new JSDOM('<main><div>Search results</div></main>');const box=dom.window.document.querySelector('main');
  const bind=()=>{};
  reconcileChatList(box,[row('a'),row('b'),row('c')],bind);const b=box.children[1];
  reconcileChatList(box,[row('c'),row('b'),row('d')],bind);
  assert.deepEqual([...box.children].map(n=>n.dataset.chat),['c','b','d']);assert.equal(box.children[1],b);
  reconcileChatList(box,[row('other-account')],bind);
  assert.equal(box.children.length,1);assert.equal(box.textContent,'other-account');
  reconcileChatList(box,[],bind);assert.equal(box.children.length,0);dom.window.close();
});
