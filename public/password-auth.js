import {api,esc} from './ui.js';

// Keep existing password accounts and registration usable until mail is ready.
export function passwordAuthView(target,{complete,cancel,allowRegistration=true}) {
 let register=false,child=false,busy=false;
 const draft={name:'',username:'',password:'',birth:''};
 const remember=()=>{for(const input of target.querySelectorAll('input[name]'))if(input.name in draft)draft[input.name]=input.value;};
 function draw(){
  target.innerHTML=`<section class="auth-card glass"><span class="eyebrow">CIPHERION</span><h2>${register?'Создать аккаунт':'С возвращением'}</h2><form class="stack" id="password-form">${register?`<label class="field">Имя<input name="name" value="${esc(draft.name)}" required maxlength="80" autocomplete="name"></label>`:''}<label class="field">Username<input name="username" value="${esc(draft.username)}" required pattern="[a-zA-Z0-9_]{${register?'5':'3'},32}" autocomplete="username"></label><label class="field">Пароль<input name="password" type="password" value="${esc(draft.password)}" required minlength="10" maxlength="256" autocomplete="${register?'new-password':'current-password'}"></label>${register&&child?`<label class="field">Дата рождения ребёнка<input name="birth" type="date" value="${esc(draft.birth)}" required></label><p class="note">После регистрации необходима привязка родителя.</p>`:''}${!register?'<label class="field">Код 2FA, если включён<input name="code" autocomplete="one-time-code"></label>':''}<p role="alert"></p><button class="primary" type="submit">${register?'Создать аккаунт':'Войти'}</button></form>${allowRegistration?`<button class="secondary" id="password-switch">${register?'Уже есть аккаунт? Войти':'Создать аккаунт'}</button>`:''}${register?`<button class="secondary" id="password-child">${child?'Обычная регистрация':'Создать детский аккаунт'}</button>`:''}${cancel?'<button class="secondary" id="password-cancel">Назад к аккаунту</button>':''}</section>`;
  target.querySelector('#password-switch')?.addEventListener('click',()=>{if(busy)return;remember();register=!register;draw();});
  target.querySelector('#password-child')?.addEventListener('click',()=>{if(busy)return;remember();child=!child;draw();});
  target.querySelector('#password-cancel')?.addEventListener('click',()=>{if(!busy)cancel();});
  target.querySelector('form').onsubmit=async event=>{
   event.preventDefault();if(busy)return;busy=true;remember();
   const form=event.currentTarget,values=Object.fromEntries(new FormData(form));
   const buttons=[...target.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
   const error=form.querySelector('[role="alert"]');error.textContent='';
   try{const result=await api('/auth','POST',{...values,register,child:register&&child});draft.password='';await complete(result);}
   catch(e){if(form.isConnected&&e.name!=='AbortError')error.textContent=e.message;}
   finally{busy=false;buttons.forEach(b=>b.disabled=false);}
  };
 }
 draw();
}
