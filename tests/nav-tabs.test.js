import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<div id="root"></div>',{url:'https://cipherion.example'});
for(const key of ['window','document','navigator','Event','HTMLElement'])Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]});
const {navTabs,navEditor,NAV_DEFAULT,NAV_MAX}=await import('../public/nav-tabs.js');
after(()=>dom.window.close());
const keys=s=>navTabs(s).map(([k])=>k);

test('bottom menu keeps the default order and repairs broken saved lists',()=>{
 assert.deepEqual(keys({}),NAV_DEFAULT);
 assert.deepEqual(keys({navTabs:['phone','settings','phone','bogus']}),['chat','phone','settings']);
 assert.deepEqual(keys({navTabs:['ai','phone','people','channel']}),['chat','ai','phone','people','settings']);
 assert.ok(keys({navTabs:['chat','ai','phone','people','channel','settings']}).length<=NAV_MAX);
});

test('menu editor reorders, hides and adds sections',()=>{
 const root=document.getElementById('root'),draft={},seen=[];
 navEditor(root,draft,list=>seen.push(list));
 const row=k=>root.querySelector(`[data-nav-key="${k}"]`);
 row('phone').querySelector('[data-nav-move="-1"]').click();
 assert.deepEqual(draft.navTabs,['chat','phone','ai','settings']);
 const ai=row('ai').querySelector('[data-nav-toggle]');ai.checked=false;ai.dispatchEvent(new Event('change'));
 assert.deepEqual(draft.navTabs,['chat','phone','settings']);
 const people=row('people').querySelector('[data-nav-toggle]');people.checked=true;people.dispatchEvent(new Event('change'));
 assert.deepEqual(draft.navTabs,['chat','phone','people','settings']);
 assert.equal(row('chat').querySelector('[data-nav-toggle]').disabled,true);
 assert.equal(row('settings').querySelector('[data-nav-toggle]').disabled,true);
 root.querySelector('[data-nav-reset]').click();
 assert.deepEqual(draft.navTabs,NAV_DEFAULT);
 assert.equal(seen.length,4);
});
