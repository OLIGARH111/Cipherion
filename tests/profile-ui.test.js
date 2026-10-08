import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<section class="workspace"></section><dialog id="modal"></dialog><div id="toast"></div>',{url:'https://cipherion.example'});
for(const key of ['window','document','navigator','Event','FormData','HTMLElement','localStorage','sessionStorage','location'])Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]});
dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new Event('close'));};
dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
globalThis.matchMedia=()=>({matches:true});
const requests=[];let profile={id:'me',name:'Alice',surname:'',bio:'Hello',username:'alice',own:true,vip:true,vipBadge:'✦',profile:{badge:'✦'},savedProfile:{badge:'✦'},shared:[],media:[]};
let rejectSave=false;
globalThis.fetch=async(url,options={})=>{
 const data=options.body?JSON.parse(options.body):null;requests.push({url,data});let value={};
 if(url.startsWith('/api/profile?')||url==='/api/profile')value=profile;
 if(url.startsWith('/api/stories'))value=[];
 if(url==='/api/profile/details'&&options.method==='PATCH'){
  if(rejectSave)return {ok:false,status:409,json:async()=>({error:'Username уже занят'})};
  profile={...profile,...data,vipBadge:data.badge,profile:{...profile.profile,badge:data.badge}};value={ok:true};
 }
 if(url==='/api/me')value={user:profile,settings:{}};
 if(url.startsWith('/api/users?q='))value=[{id:'bob',name:'Bob',username:'bob_test',vip:true,vipBadge:'💎'}];
 if(url==='/api/chats')value={id:'created'};
 return {ok:true,json:async()=>structuredClone(value)};
};
const {$,vipBadge}=await import('../public/ui.js');
const {createChatDialog}=await import('../public/create-chat.js');
const {editProfile,configureProfiles}=await import('../public/profiles.js');
const {settingsPage}=await import('../public/settings.js');
const tick=()=>new Promise(r=>setTimeout(r,10));
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await tick();}assert.fail('timeout');}
after(()=>dom.window.close());
test('pencil dialog switches between all three types, clears recipients, validates and submits the chosen type',async()=>{
 let opened;const context={refresh:async()=>{},openChat:async id=>{opened=id;}};
 createChatDialog('direct',context);
 assert.equal(document.querySelectorAll('[name="chat-kind"]').length,3);
 $('#user-search').value='bob';$('#user-search').dispatchEvent(new Event('input'));await until(()=>$('#user-results input'));
 $('#user-results input').click();assert.equal($('#chosen-users').textContent,'Bob');assert.equal($('#user-results .vip-badge').textContent,'💎');
 document.querySelector('[name="chat-kind"][value="group"]').click();
 assert.equal($('#chosen-users').textContent,'');assert.equal($('#user-results input'),null);assert.equal($('#group-title').required,true);
 $('#group-title').value='My group';document.querySelector('[name="chat-kind"][value="channel"]').click();
 assert.equal($('#group-title').value,'');assert.match($('#chat-kind-help').textContent,/Подписчики читают/);
 $('#group-title').value='My channel';$('#create-chat').click();await until(()=>opened);
 assert.deepEqual(requests.find(r=>r.url==='/api/chats').data,{kind:'channel',title:'My channel',users:[]});
 createChatDialog('direct',context);$('#create-chat').click();await tick();assert.match($('#create-chat-error').textContent,/собеседника/);
});
test('profile editor previews name and VIP badge, preserves form on errors and saves all fields in one request',async()=>{
 const state={user:profile,settings:{},accounts:{show:async()=>{}}};configureProfiles({state,refresh:async()=>{}});
 await editProfile();
 $('#profile-all [name="name"]').value='New Alice';$('#profile-all [name="name"]').dispatchEvent(new Event('input',{bubbles:true}));
 document.querySelector('[name="badge"][value="👑"]').click();
 assert.match($('#edit-profile-preview h2').textContent,/New Alice/);assert.equal($('#edit-profile-preview .vip-badge').textContent,'👑');
 rejectSave=true;$('#profile-all button[type="submit"]').click();await until(()=>document.querySelector('[data-save-error]'));
 assert.equal($('#modal').open,true);assert.equal($('#profile-all [name="name"]').value,'New Alice');
 rejectSave=false;$('#profile-all button[type="submit"]').click();await until(()=>!$('#modal').open);
 assert.equal(state.user.name,'New Alice');assert.equal(state.user.vipBadge,'👑');
 assert.equal(requests.filter(r=>r.url==='/api/me'&&r.data).length,0);
 settingsPage(state,async()=>{},async()=>{});$('#view-my-profile').click();await until(()=>$('#profile-edit-all'));
 assert.match($('#modal h2').textContent,/Ваш профиль/);assert.equal($('#modal .vip-badge').textContent,'👑');
 assert.equal(vipBadge({vip:false,vipBadge:'👑'}),'');assert.match(vipBadge({vip:true,vipBadge:'<img>'}),/✦/);
});
