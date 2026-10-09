import {$,esc,api,guard} from './ui.js';
import {passwordAuthView} from './password-auth.js';
// The same flow is used at first launch and when adding another account.
export async function emailAuthView(target,{complete,cancel,changeEmail=false,purpose,email=''}) {
 const marker=document.createElement('p');marker.textContent='Загрузка…';target.replaceChildren(marker);
 let config;
 try{config=await api('/auth/config');}catch(e){if(e.name==='AbortError')return;config={email:false,passwordRegistration:false};}
 if(target.firstChild!==marker)return;
 if(!config.email){
  if(changeEmail||purpose){target.innerHTML='<p>Подтверждение по электронной почте пока недоступно.</p>'+(cancel?'<button class="secondary" id="auth-cancel">Назад</button>':'');target.querySelector('#auth-cancel')?.addEventListener('click',cancel);return;}
  return passwordAuthView(target,{complete,cancel,allowRegistration:config.passwordRegistration===true});
 }
 let mode=purpose|| (changeEmail?'change':'home'),step=purpose?1:0,busy=false,challenge=null,until=0;
 const draft={firstName:'',lastName:'',email,username:'',password:''};
 const content=()=>target.querySelector('.email-content');
 target.innerHTML='<section class="auth-card glass email-auth"><span class="eyebrow">CIPHERION</span><div class="email-content"></div></section>';
 async function perform(fn){if(busy)return;busy=true;const form=content().querySelector('form');const buttons=[...content().querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);const error=content().querySelector('[role="alert"]');if(error)error.textContent='';try{await fn();}catch(e){const el=content()?.querySelector('[role="alert"]');if(el)el.textContent=e.message;}finally{busy=false;for(const b of buttons)b.disabled=false;}}
 function draw(){
  const el=content();if(!el)return;
  if(mode==='home'){el.innerHTML='<h2>Добро пожаловать</h2><button class="primary" data-mode="register">Создать аккаунт</button><button class="secondary" data-mode="login">Войти</button><button class="secondary" data-mode="legacy">Войти по username и паролю</button>'+ (cancel?'<button class="secondary" id="auth-cancel">Назад к аккаунту</button>':'')+'<p role="alert"></p>';el.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;step=mode==='register'?0:1;draw();});if(cancel)el.querySelector('#auth-cancel').onclick=cancel;return;}
  const registration=mode==='register',code=step===2;
  el.innerHTML=`${registration?`<small>${step+1} из 3 · ${['Имя','Email','Подтверждение'][step]}</small>`:''}<h2>${mode==='legacy'?'Вход по username':code?'Подтвердите электронную почту':registration&&step===0?'Как вас зовут?':mode==='recovery'?'Восстановление доступа':changeEmail?'Новая электронная почта':'Ваша электронная почта'}</h2><form class="stack" id="email-form">${mode==='legacy'?`<label class="field">Username<input name="username" value="${esc(draft.username)}" required autocomplete="username"></label><label class="field">Пароль<input name="password" type="password" required autocomplete="current-password" value="${esc(draft.password)}"></label><label class="field">Код 2FA, если включён<input name="secondFactor" autocomplete="one-time-code"></label>`:code?`<p>Мы отправили код на ${esc(challenge.email)}</p><label class="field">Код из email<input class="email-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" minlength="6" required aria-label="Шестизначный код"></label>${!registration&&!changeEmail&&mode!=='security'?'<label class="field">Код 2FA, если включён<input name="secondFactor" autocomplete="one-time-code"></label>':''}`:registration&&step===0?`<label class="field">Имя *<input name="firstName" value="${esc(draft.firstName)}" autocomplete="given-name" maxlength="80" required></label><label class="field">Фамилия *<input name="lastName" value="${esc(draft.lastName)}" autocomplete="family-name" maxlength="80" required></label>`:`<p>Она понадобится для входа и восстановления доступа к аккаунту.</p><label class="field">Электронная почта *<input name="email" type="email" ${mode==='security'?'readonly':''} value="${esc(draft.email)}" autocomplete="email" maxlength="254" required></label>`}<p role="alert"></p><button class="primary" type="submit">Продолжить</button></form>${code?'<button class="secondary" id="email-resend">Отправить код повторно</button>':''}<button class="secondary" id="email-back">Назад</button>${mode==='login'&&!code?'<button class="secondary" id="email-recovery">Не можете войти?</button>':''}`;
  const remember=()=>{for(const input of el.querySelectorAll('input[name]'))if(input.name in draft)draft[input.name]=input.value;};
  el.querySelector('#email-back').onclick=()=>{remember();if(step===2){step=1;}else if(registration&&step===1){step=0;}else if(changeEmail||purpose){cancel?.();return;}else mode='home';draw();};
  if(el.querySelector('#email-recovery'))el.querySelector('#email-recovery').onclick=()=>{remember();mode='recovery';step=1;draw();};
  async function start(){challenge=await api('/auth/email/start','POST',{...draft,purpose:mode});until=Date.now()+challenge.retryAfter*1000;step=2;draw();}
  if(code)el.querySelector('#email-resend').onclick=()=>perform(async()=>{if(Date.now()<until)throw new Error(`Повторите через ${Math.ceil((until-Date.now())/1000)} сек.`);await start();});
  el.querySelector('form').onsubmit=e=>{e.preventDefault();const values=Object.fromEntries(new FormData(e.currentTarget));remember();void perform(async()=>{if(mode==='legacy'){const r=await api('/auth','POST',{username:draft.username,password:draft.password,code:values.secondFactor});draft.password='';await complete(r);return;}if(registration&&step===0){step=1;draw();return;}if(!code){await start();return;}const r=await api('/auth/email/confirm','POST',{challengeId:challenge.challengeId,code:values.code,secondFactor:values.secondFactor});await complete(r);});};
 }
 draw();
}
