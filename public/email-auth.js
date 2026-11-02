import {esc,api,upload,toast} from './ui.js';
import {passwordAuthView,passwordResetView,recoveryKeyView} from './password-auth.js';
import {prepareAvatar,pickImage} from './media-compress.js';

// Showcase shown before choosing "Создать аккаунт" or "Войти".
const FEATURES=[
 {emoji:'🔐',orbit:['🔑','🛡️','🔒'],color:'#2fbf7a',title:'Сквозное шифрование',text:'Секретные чаты, которые не прочитает никто, кроме вас и собеседника'},
 {emoji:'✨',orbit:['💡','📝','🪄'],color:'#8b6cff',title:'AI-помощник в чате',text:'Подскажет ответ, перескажет переписку и поможет написать сообщение'},
 {emoji:'📞',orbit:['🎥','🎧','📡'],color:'#2f8fe8',title:'Звонки в HD',text:'Аудио- и видеозвонки с кем угодно, прямо из чата'},
 {emoji:'🎨',orbit:['🖼️','🌌','🌈'],color:'#ff7a45',title:'Обои от ИИ',text:'Опишите идею — и ИИ нарисует обои для любого чата'},
 {emoji:'🎭',orbit:['😎','🔥','🎉'],color:'#e94d8b',title:'Живые стикеры и истории',text:'Анимированные стикеры, кружки и истории для друзей'},
 {emoji:'👥',orbit:['🙋','🧑‍💻','🙌'],color:'#14b8a6',title:'До 3 аккаунтов',text:'Переключайтесь между аккаунтами в одно касание'},
];
const BACK='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CAMERA='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';

// Full-screen greeting after a successful sign-in or registration.
// A modal <dialog> sits in the top layer, so it also covers the "add account" window.
export const splashTiming={hold:1900};
export function authSplash(title,subtitle=''){
 const el=document.createElement('dialog');el.className='auth-splash';el.setAttribute('aria-live','polite');
 el.innerHTML=`<div class="auth-splash-burst" aria-hidden="true">${'<i></i>'.repeat(12)}</div><img class="auth-splash-logo" src="/brand/icon-192-99e4c7990351.png" alt="" width="96" height="96"><h1>${esc(title)}</h1>${subtitle?`<p>${esc(subtitle)}</p>`:''}`;
 el.addEventListener('cancel',e=>e.preventDefault());
 document.body.append(el);if(typeof el.showModal==='function')el.showModal();else el.setAttribute('open','');
 return {hide(){el.classList.add('leaving');setTimeout(()=>{el.close?.();el.remove();},500);}};
}

// The same flow is used at first launch and when adding another account.
export async function emailAuthView(target,{complete,cancel,changeEmail=false,purpose,email=''}) {
 const marker=document.createElement('p');marker.textContent='Загрузка…';target.replaceChildren(marker);
 let config;
 try{config=await api('/auth/config');}catch(e){if(e.name==='AbortError')return;config={email:false,passwordRegistration:false,unavailable:true};}
 if(target.firstChild!==marker)return;
 if(!config.email){
  if(changeEmail||purpose){target.innerHTML='<p>Подтверждение по электронной почте пока недоступно.</p>'+(cancel?'<button class="secondary" id="auth-cancel">Назад</button>':'');target.querySelector('#auth-cancel')?.addEventListener('click',cancel);return;}
  if(config.unavailable)return passwordAuthView(target,{complete,cancel,allowRegistration:false});
 }
 // Without email on the server the same steps use username and password.
 const pw=!config.email,canRegister=!pw||config.passwordRegistration===true;
 // mode: intro | register | login | recovery | legacy | change | security
 let mode=purpose||(changeEmail?'change':'intro'),step='email',busy=false,challenge=null,until=0,slide=0,timer=null,photo=null,photoURL='';
 const draft={firstName:'',lastName:'',email,username:'',password:'',cloud:'',cloudRepeat:'',newPassword:'',code:'',passwordRepeat:'',secondFactor:''};
 const history=[];
 target.innerHTML='<section class="auth-card glass email-auth auth-flow"><div class="email-content"></div></section>';
 const content=()=>target.querySelector('.email-content');
 const remember=()=>{for(const input of content()?.querySelectorAll('input[name]')||[])if(input.name in draft)draft[input.name]=input.value;};
 const go=(next,nextMode=mode)=>{remember();history.push([mode,step]);mode=nextMode;step=next;draw();};
 function back(){
  remember();
  if(history.length){[mode,step]=history.pop();draw();return;}
  if(changeEmail||purpose){cancel?.();return;}
  mode='intro';draw();
 }
 async function perform(fn){
  if(busy)return;busy=true;const el=content(),buttons=[...el.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
  const alert=el.querySelector('[role="alert"]');if(alert)alert.textContent='';
  try{await fn();}catch(e){if(e.name==='AbortError')return;const box=content()?.querySelector('[role="alert"]');if(box)box.textContent=e.message;}
  finally{busy=false;for(const b of buttons)b.disabled=false;}
 }
 async function start(){
  challenge=await api('/auth/email/start','POST',{firstName:draft.firstName,lastName:draft.lastName,email:draft.email,purpose:mode});
  until=Date.now()+challenge.retryAfter*1000;
 }
 // Confirms the email code; for sign-in the server then says whether a cloud password or 2FA code is needed.
 async function confirm(){
  const body={challengeId:challenge.challengeId,code:draft.code};
  if(draft.cloud)body.cloudPassword=draft.cloud;
  if(draft.secondFactor)body.secondFactor=draft.secondFactor;
  if(mode==='recovery'&&draft.newPassword)body.newPassword=draft.newPassword;
  let r;
  try{r=await api('/auth/email/confirm','POST',body);}
  catch(e){
   if(e.need==='cloudPassword'&&step!=='cloud'){draft.cloud='';go('cloud');return;}
   if(e.need==='secondFactor'&&step!=='second'){go('second');return;}
   throw e;
  }
  await finish(r);
 }
 async function finish(r){
  if(!r?.user){await complete(r);return;}
  stopTimer();
  if(mode==='register'&&(photo||pw&&draft.lastName)){
   try{const patch=pw?{surname:draft.lastName.trim()}:{};if(photo)patch.avatar=(await upload(await prepareAvatar(photo),r.user.id)).id;await api('/profile/details','PATCH',patch,undefined,r.user.id);}
   catch(e){if(e.name!=='AbortError')toast('Не удалось сохранить фото или фамилию: '+e.message);}
  }
  const name=[r.user.name||draft.firstName,mode==='register'?draft.lastName:''].filter(Boolean).join(' ');
  const splash=authSplash(mode==='register'?'Добро пожаловать!':'С возвращением!',name);
  await new Promise(resolve=>setTimeout(resolve,splashTiming.hold));
  try{await complete(r);}finally{splash.hide();}
 }
 async function passwordLogin(){
  let r;
  try{r=await api('/auth','POST',{username:draft.username.trim(),password:draft.password,code:draft.secondFactor||undefined});}
  catch(e){if(e.need==='secondFactor'&&step!=='second'){go('second');return;}throw e;}
  draft.password='';await finish(r);
 }
 async function passwordRegister(){
  const r=await api('/auth','POST',{register:true,name:draft.firstName.trim(),username:draft.username.trim(),password:draft.password});
  draft.password=draft.passwordRepeat='';
  if(r.recoveryKey)recoveryKeyView(target,r.recoveryKey,()=>void finish(r));else await finish(r);
 }
 function stopTimer(){clearInterval(timer);timer=null;}

 function shell(title,body,{note='',dots=0,at=0,footer=''}={}){
  return `<div class="flow-top"><button type="button" class="flow-back" id="email-back" aria-label="Назад">${BACK}</button>${dots?`<div class="flow-steps" aria-label="Шаг ${at+1} из ${dots}">${Array.from({length:dots},(_,i)=>`<i class="${i<=at?'on':''}"></i>`).join('')}</div>`:''}</div><div class="flow-body"><h2>${title}</h2>${note?`<p class="flow-note">${note}</p>`:''}<form class="stack" id="email-form" novalidate>${body}<p role="alert"></p>${footer}</form></div>`;
 }
 const pill=(label,extra='')=>`<button class="primary pill" type="submit" ${extra}>${label}</button>`;
 const field=(label,name,attrs='')=>`<label class="field">${label}<input name="${name}" value="${esc(draft[name]||'')}" ${attrs}></label>`;

 function drawIntro(el){
  const f=FEATURES[slide];
  el.innerHTML=`<div class="intro"><div class="intro-stage" style="--f:${f.color}" aria-hidden="true"><div class="intro-ring r1"></div><div class="intro-ring r2"></div><div class="intro-ring r3"></div><div class="intro-orbit">${f.orbit.map((o,i)=>`<span style="--i:${i}">${o}</span>`).join('')}</div><div class="intro-core">${f.emoji}</div></div><div class="intro-text" aria-live="polite"><h2>${esc(f.title)}</h2><p>${esc(f.text)}</p></div><div class="intro-dots">${FEATURES.map((x,i)=>`<button type="button" class="${i===slide?'on':''}" data-slide="${i}" aria-label="${esc(x.title)}"></button>`).join('')}</div><div class="intro-actions">${canRegister?'<button class="primary pill" data-mode="register">Создать аккаунт</button>':''}<button class="${canRegister?'secondary':'primary'} pill" data-mode="login">Войти</button>${pw?(canRegister?'<button class="link-button" id="intro-child">Создать детский аккаунт</button>':''):'<button class="link-button" data-mode="legacy">Войти по username и паролю</button>'}${cancel?'<button class="link-button" id="auth-cancel">Назад к аккаунту</button>':''}</div></div>`;
  el.querySelectorAll('[data-slide]').forEach(b=>b.onclick=()=>{slide=+b.dataset.slide;restart();drawIntro(el);});
  el.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{stopTimer();draft.cloud=draft.cloudRepeat='';draft.secondFactor='';history.length=0;history.push(['intro','email']);mode=b.dataset.mode;step=mode==='legacy'?'legacy':pw?(mode==='register'?'profile':'username'):'email';draw();});
  el.querySelector('#intro-child')?.addEventListener('click',()=>{stopTimer();passwordAuthView(target,{complete,cancel,register:true,child:true,back:()=>emailAuthView(target,{complete,cancel})});});
  el.querySelector('#auth-cancel')?.addEventListener('click',()=>{stopTimer();cancel();});
  const stage=el.querySelector('.intro');let x0=null;
  stage.addEventListener('pointerdown',e=>{x0=e.clientX;});
  stage.addEventListener('pointerup',e=>{if(x0===null)return;const dx=e.clientX-x0;x0=null;if(Math.abs(dx)<40)return;slide=(slide+(dx<0?1:FEATURES.length-1))%FEATURES.length;restart();drawIntro(el);});
 }
 function restart(){
  stopTimer();
  if(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)return;
  timer=setInterval(()=>{const el=content();if(!el||mode!=='intro'){stopTimer();return;}slide=(slide+1)%FEATURES.length;drawIntro(el);},3600);
 }

 function draw(){
  const el=content();if(!el)return;
  if(mode==='intro'){drawIntro(el);if(!timer)restart();return;}
  stopTimer();
  const reg=mode==='register';
  if(step==='legacy'){
   el.innerHTML=shell('Вход по username',`${field('Username','username','required autocomplete="username"')}${field('Пароль','password','type="password" required autocomplete="current-password"')}<label class="field">Код 2FA, если включён<input name="secondFactor" autocomplete="one-time-code"></label>${pill('Войти')}`,{footer:'<button class="link-button" type="button" id="legacy-forgot">Забыли пароль?</button>'});
  }else if(step==='email'){
   const title=mode==='security'?'Подтвердите действие':mode==='change'?'Новая электронная почта':mode==='recovery'?'Восстановление доступа':reg?'Ваш email':'Вход по email';
   const note=reg?'Мы отправим на него код подтверждения':mode==='login'?'Введите почту, к которой привязан аккаунт':'Мы отправим код на электронную почту';
   el.innerHTML=shell(title,`<label class="field">Электронная почта<input name="email" type="email" inputmode="email" ${mode==='security'?'readonly':''} value="${esc(draft.email)}" autocomplete="email" maxlength="254" required placeholder="name@example.com"></label>${pill('Продолжить')}`,{note,dots:reg?4:0,at:0,footer:mode==='login'?'<button class="link-button" type="button" id="email-recovery">Не можете войти?</button>':''});
  }else if(step==='profile'){
   el.innerHTML=shell('Как вас зовут?',`<button type="button" class="flow-photo${photoURL?' has':''}" id="flow-photo" aria-label="Добавить фото">${photoURL?`<img src="${esc(photoURL)}" alt="">`:CAMERA}<span>${photoURL?'Изменить фото':'Добавить фото'}</span></button>${field('Имя','firstName','autocomplete="given-name" maxlength="80" required')}${field('Фамилия','lastName','autocomplete="family-name" maxlength="80" required')}${pill('Продолжить')}`,{dots:pw?3:4,at:pw?0:1});
   el.querySelector('#flow-photo').onclick=()=>pickImage(file=>{remember();photo=file;if(photoURL)URL.revokeObjectURL(photoURL);photoURL=URL.createObjectURL(file);draw();});
  }else if(step==='username'){
   el.innerHTML=shell(reg?'Придумайте username':'Вход по username',`${field('Username','username',`required autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="32" placeholder="${reg?'например, alena_99':''}"`)}${pill('Продолжить')}`,{note:reg?'Латинские буквы, цифры и _ — от 5 до 32 символов. По нему вас смогут найти.':'Введите username вашего аккаунта',dots:reg?3:0,at:1});
  }else if(step==='password'){
   el.innerHTML=shell(reg?'Придумайте пароль':'Введите пароль',`${field('Пароль','password',`type="password" required minlength="10" maxlength="256" autocomplete="${reg?'new-password':'current-password'}"`)}${reg?field('Подтвердите пароль','passwordRepeat','type="password" required minlength="10" maxlength="256" autocomplete="new-password"'):''}${pill(reg?'Зарегистрироваться':'Продолжить')}`,{note:reg?'Минимум 10 символов. Он нужен для входа на других устройствах.':`Аккаунт @${esc(draft.username.trim().toLowerCase())}`,dots:reg?3:0,at:2,footer:reg?'':'<button class="link-button" type="button" id="legacy-forgot">Забыли пароль?</button>'});
  }else if(step==='cloud-setup'){
   el.innerHTML=shell('Облачный пароль',`${field('Пароль','cloud','type="password" minlength="6" maxlength="256" autocomplete="new-password"')}${field('Подтвердите пароль','cloudRepeat','type="password" minlength="6" maxlength="256" autocomplete="new-password"')}${pill('Зарегистрироваться')}<button class="secondary pill" type="button" id="flow-skip">Пропустить</button>`,{note:'Советуем добавить облачный пароль. Его спросят при входе на новом устройстве — даже если кто-то получит доступ к вашей почте.',dots:4,at:2});
   el.querySelector('#flow-skip').onclick=()=>{draft.cloud='';draft.cloudRepeat='';void perform(async()=>{await start();go('code');});};
  }else if(step==='code'){
   el.innerHTML=shell('Введите код',`<label class="field">Код из письма<input class="email-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" minlength="6" required aria-label="Шестизначный код"></label>${mode==='recovery'?field('Новый пароль для входа по username (необязательно)','newPassword','type="password" minlength="10" maxlength="256" autocomplete="new-password"'):''}${pill('Продолжить')}`,{note:`Мы отправили код на ${esc(challenge?.email||draft.email)}`,dots:reg?4:0,at:3,footer:'<button class="link-button" type="button" id="email-resend">Отправить код повторно</button>'});
   el.querySelector('#email-resend').onclick=()=>perform(async()=>{if(Date.now()<until)throw new Error(`Повторите через ${Math.ceil((until-Date.now())/1000)} сек.`);await start();});
  }else if(step==='cloud'){
   el.innerHTML=shell('Облачный пароль',`${field('Облачный пароль','cloud','type="password" required autocomplete="current-password" autofocus')}${pill('Продолжить')}`,{note:'Аккаунт защищён облачным паролем. Введите его, чтобы войти.'});
  }else if(step==='second'){
   el.innerHTML=shell('Двухэтапная защита',`<label class="field">Код из приложения или резервный код<input name="secondFactor" autocomplete="one-time-code" required></label>${pill('Продолжить')}`,{note:'Введите код из приложения-аутентификатора.'});
  }
  el.querySelector('#email-back').onclick=back;
  el.querySelector('#email-recovery')?.addEventListener('click',()=>go('email','recovery'));
  el.querySelector('#legacy-forgot')?.addEventListener('click',()=>{remember();passwordResetView(target,{complete,back:()=>emailAuthView(target,{complete,cancel,changeEmail,purpose,email}),hint:pw?'':'<p class="note">Если к аккаунту привязана подтверждённая почта, можно вернуться назад и выбрать «Войти» → «Не можете войти?»: код придёт на email.</p>'});});
  el.querySelector('form').onsubmit=e=>{
   e.preventDefault();remember();const form=e.currentTarget;
   if(step==='second')draft.secondFactor=form.elements.secondFactor.value;
   void perform(async()=>{
    if(step==='legacy'){const r=await api('/auth','POST',{username:draft.username,password:draft.password,code:form.elements.secondFactor.value});draft.password='';await complete(r);return;}
    if(step==='email'){
     if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim()))throw new Error('Проверьте электронную почту');
     if(reg){go('profile');return;}
     await start();go('code');return;
    }
    if(step==='profile'){if(!draft.firstName.trim()||!draft.lastName.trim())throw new Error('Укажите имя и фамилию');go(pw?'username':'cloud-setup');return;}
    if(step==='username'){if(!new RegExp(`^[a-zA-Z0-9_]{${reg?5:3},32}$`).test(draft.username.trim()))throw new Error(reg?'Username: от 5 до 32 латинских букв, цифр или _':'Проверьте username');go('password');return;}
    if(step==='password'){
     if(reg){if(draft.password.length<10)throw new Error('Пароль — минимум 10 символов');if(draft.password!==draft.passwordRepeat)throw new Error('Пароли не совпадают');await passwordRegister();return;}
     if(!draft.password)throw new Error('Введите пароль');await passwordLogin();return;
    }
    if(step==='cloud-setup'){
     if(draft.cloud||draft.cloudRepeat){if(draft.cloud.length<6)throw new Error('Облачный пароль — минимум 6 символов');if(draft.cloud!==draft.cloudRepeat)throw new Error('Пароли не совпадают');}
     await start();go('code');return;
    }
    if(step==='code'&&!/^\d{6}$/.test(draft.code))throw new Error('Введите шестизначный код');
    if(step==='cloud'&&!draft.cloud)throw new Error('Введите облачный пароль');
    if(pw){await passwordLogin();return;}
    await confirm();
   });
  };
  el.querySelector('input:not([readonly])')?.focus?.({preventScroll:true});
 }
 draw();
}
