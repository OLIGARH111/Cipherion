import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<div id="toast"></div><dialog id="modal"></dialog><main id="auth"></main>',{url:'https://cipherion.example'});
for(const k of ['window','document','navigator','Event','FormData','HTMLElement','localStorage','sessionStorage','location'])Object.defineProperty(globalThis,k,{configurable:true,value:dom.window[k]});
dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
after(()=>dom.window.close());const tick=()=>new Promise(r=>setTimeout(r,0));
const {saveAction,modal,peopleCount,api}=await import('../public/ui.js');const {setActiveAccount,accountURL,draftKey}=await import('../public/account-context.js');
test('shared save waits, rejects duplicate submits, retains input on failure and closes only on success',async()=>{
 modal('Edit','<form><input value="retained"><button>Сохранить</button></form>');let resolve,calls=0;const button=document.querySelector('button:not(#modal-close)'),form=document.querySelector('form');const event={currentTarget:form,preventDefault(){}};const handler=saveAction(()=>{calls++;return new Promise(r=>resolve=r);});const pending=handler(event);await handler(event);assert.equal(calls,1);assert.equal(button.disabled,true);assert.equal(document.querySelector('dialog').open,true);resolve();await pending;assert.equal(document.querySelector('dialog').open,false);
 modal('Edit','<form><input value="retained"><button>Сохранить</button></form>');const failed=saveAction(async()=>{throw Error('Server unavailable');});await failed({currentTarget:document.querySelector('form'),preventDefault(){}});assert.equal(document.querySelector('dialog').open,true);assert.equal(document.querySelector('input').value,'retained');assert.match(document.querySelector('[role=alert]').textContent,/Server unavailable/);assert.equal(document.querySelector('form button').disabled,false);
});
test('late responses and save completions cannot repaint another account; media and drafts are scoped',async()=>{
 setActiveAccount('a');let finish;globalThis.fetch=async()=>new Promise(r=>finish=r);const pending=api('/me');setActiveAccount('b');finish({ok:true,json:async()=>({user:{id:'a'}})});await assert.rejects(pending,{name:'AbortError'});assert.equal(accountURL('/api/media/id'),'/api/media/id?account=b');assert.equal(draftKey('chat'),'accounts/b/draft:chat');
 modal('A','<button id="save">Сохранить</button>');let saved;const save=saveAction(()=>new Promise(r=>saved=r));const saving=save({currentTarget:document.querySelector('#save'),preventDefault(){}});setActiveAccount('c');modal('B','<input value="other-account">');saved();await saving;assert.equal(document.querySelector('dialog').open,true);assert.equal(document.querySelector('input').value,'other-account');setActiveAccount(null);
});
test('email registration goes email → name and photo → cloud password → code and greets the user',async()=>{
 setActiveAccount(null);const {emailAuthView,splashTiming}=await import('../public/email-auth.js');splashTiming.hold=0;let completed=null,posts=[];globalThis.fetch=async(url,options)=>{if(url.endsWith('/auth/config'))return {ok:true,json:async()=>({email:true})};posts.push({url,data:JSON.parse(options.body)});return {ok:true,json:async()=>url.endsWith('/start')?{challengeId:'challenge',email:'s•••••@example.test',retryAfter:60}:{user:{id:'new',name:'Серафим',username:null}}};};
 const submit=async()=>{document.querySelector('#email-form').dispatchEvent(new Event('submit',{cancelable:true}));await tick();};
 await emailAuthView(document.querySelector('#auth'),{complete:r=>completed=r});assert.ok(document.querySelector('.intro-stage'));document.querySelector('[data-mode=register]').click();
 document.querySelector('[name=email]').value='serafim@example.test';await submit();
 assert.ok(document.querySelector('#flow-photo'));document.querySelector('[name=firstName]').value='Серафим';document.querySelector('[name=lastName]').value='Миронов';
 document.querySelector('#email-back').click();assert.equal(document.querySelector('[name=email]').value,'serafim@example.test');await submit();assert.equal(document.querySelector('[name=firstName]').value,'Серафим');await submit();
 assert.ok(document.querySelector('#flow-skip'));document.querySelector('[name=cloud]').value='secret1';document.querySelector('[name=cloudRepeat]').value='other12';await submit();assert.match(document.querySelector('[role=alert]').textContent,/не совпадают/);assert.equal(posts.length,0);
 document.querySelector('[name=cloudRepeat]').value='secret1';await submit();assert.equal(posts[0].data.firstName,'Серафим');assert.equal(posts[0].data.lastName,'Миронов');assert.equal(posts[0].data.purpose,'register');
 document.querySelector('[name=code]').value='123456';await submit();await tick();assert.equal(completed.user.id,'new');assert.equal(posts[1].data.challengeId,'challenge');assert.equal(posts[1].data.cloudPassword,'secret1');
 assert.match(document.querySelector('.auth-splash').textContent,/Добро пожаловать/);document.querySelector('.auth-splash').remove();
});
test('email login asks for the cloud password only when the account has one',async()=>{
 setActiveAccount(null);const {emailAuthView}=await import('../public/email-auth.js');let completed=null,posts=[];
 globalThis.fetch=async(url,options)=>{if(url.endsWith('/auth/config'))return {ok:true,json:async()=>({email:true})};const data=JSON.parse(options.body);posts.push(data);if(url.endsWith('/start'))return {ok:true,json:async()=>({challengeId:'c',email:'a•••••@example.test',retryAfter:60})};if(data.cloudPassword!=='cloud-pass')return {ok:false,status:401,json:async()=>({error:data.cloudPassword?'Неверный облачный пароль':'Введите облачный пароль',need:'cloudPassword'})};return {ok:true,json:async()=>({user:{id:'old',name:'Алиса'}})};};
 const submit=async()=>{document.querySelector('#email-form').dispatchEvent(new Event('submit',{cancelable:true}));await tick();};
 await emailAuthView(document.querySelector('#auth'),{complete:r=>completed=r});document.querySelector('[data-mode=login]').click();document.querySelector('[name=email]').value='alice@example.test';await submit();
 document.querySelector('[name=code]').value='123456';await submit();assert.equal(completed,null);assert.ok(document.querySelector('[name=cloud]'));
 document.querySelector('[name=cloud]').value='wrong-pass';await submit();assert.match(document.querySelector('[role=alert]').textContent,/Неверный/);
 document.querySelector('[name=cloud]').value='cloud-pass';await submit();await tick();assert.equal(completed.user.id,'old');assert.equal(posts.at(-1).code,'123456');
 assert.match(document.querySelector('.auth-splash').textContent,/С возвращением!/);document.querySelector('.auth-splash').remove();
});
test('subscriber count uses Russian plural rules',()=>{assert.deepEqual([1,2,5,11,21,22,25,111].map(n=>peopleCount(n,true)),['1 подписчик','2 подписчика','5 подписчиков','11 подписчиков','21 подписчик','22 подписчика','25 подписчиков','111 подписчиков']);});

test('unconfigured email uses password signup and login, including child and 2FA fields',async()=>{
 setActiveAccount(null);const {emailAuthView}=await import('../public/email-auth.js');let completed,posts=[];
 globalThis.fetch=async(path,options)=>{if(path.endsWith('/auth/config'))return {ok:true,json:async()=>({email:false,passwordRegistration:true})};posts.push(JSON.parse(options.body));return {ok:true,json:async()=>({user:{id:'password-user'}})};};
 const target=document.querySelector('#auth');await emailAuthView(target,{complete:r=>completed=r});
 assert.equal(target.querySelector('[data-mode=register]'),null);assert.ok(target.querySelector('[name=code]'));
 target.querySelector('#password-switch').click();target.querySelector('[name=name]').value='Alice';target.querySelector('[name=username]').value='alice_new';target.querySelector('[name=password]').value='strong-password';
 target.querySelector('#password-child').click();assert.equal(target.querySelector('[name=name]').value,'Alice');assert.equal(target.querySelector('[name=username]').getAttribute('pattern'),'[a-zA-Z0-9_]{5,32}');target.querySelector('[name=birth]').value='2013-01-01';
 target.querySelector('form').dispatchEvent(new Event('submit',{cancelable:true}));await tick();
 assert.equal(posts.length,1);assert.equal(posts[0].register,true);assert.equal(posts[0].child,true);assert.equal(posts[0].birth,'2013-01-01');assert.equal(completed.user.id,'password-user');
 await emailAuthView(target,{complete:r=>completed=r});target.querySelector('[name=username]').value='old';target.querySelector('[name=password]').value='strong-password';target.querySelector('[name=code]').value='123456';target.querySelector('form').dispatchEvent(new Event('submit',{cancelable:true}));await tick();assert.equal(posts[1].register,false);assert.equal(posts[1].code,'123456');
 await emailAuthView(target,{changeEmail:true,complete(){}});assert.equal(target.querySelector('form'),null);assert.match(target.textContent,/пока недоступно/);
});

test('push subscription is independently registered for every authorized account',async()=>{
 setActiveAccount('push-a');const calls=[];globalThis.fetch=async(path,options)=>{calls.push({path,account:options.headers['X-Cipherion-Account']});return {ok:true,json:async()=>path==='/api/accounts'?[{user:{id:'push-a'}},{user:{id:'push-b'}}]:{ok:true}};};
 const {registerDevicePush}=await import('../public/notifications.js');await registerDevicePush({endpoint:'test'});assert.deepEqual(calls.filter(c=>c.path==='/api/push/subscriptions').map(c=>c.account),['push-a','push-b']);
});
test('callbacks retained by an old file picker cannot act as the new account',async()=>{
 const {guard}=await import('../public/ui.js');setActiveAccount('picker-a');let calls=0;const callback=guard(()=>calls++);setActiveAccount('picker-b');await callback();assert.equal(calls,0);
});

test('email security approval uses the verified address and completes without creating a session',async()=>{
 setActiveAccount('security-ui');const {emailAuthView}=await import('../public/email-auth.js');const target=document.querySelector('#auth');let completed;
 globalThis.fetch=async(path,options)=>({ok:true,json:async()=>path.endsWith('/auth/config')?{email:true}:path.endsWith('/start')?{challengeId:'security',email:'s•••••@example.test',retryAfter:60}:{approvalToken:'proof'}});
 await emailAuthView(target,{purpose:'security',email:'security@example.test',complete:r=>completed=r});const email=target.querySelector('[name=email]');assert.equal(email.readOnly,true);assert.equal(email.value,'security@example.test');
 target.querySelector('form').dispatchEvent(new Event('submit',{cancelable:true}));await tick();assert.equal(target.querySelector('[name=password]'),null);target.querySelector('[name=code]').value='123456';target.querySelector('form').dispatchEvent(new Event('submit',{cancelable:true}));await tick();assert.deepEqual(completed,{approvalToken:'proof'});
});
