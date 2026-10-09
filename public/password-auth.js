import {api,esc} from './ui.js';

// Shown once after registration or a reset: the only way back in without email.
export function recoveryKeyView(target,key,done,{title='Сохраните ключ восстановления'}={}) {
 target.innerHTML=`<section class="auth-card glass"><span class="eyebrow">CIPHERION</span><h2>${esc(title)}</h2><p>Если вы забудете пароль, этим ключом можно задать новый. Мы показываем его только один раз и не можем восстановить.</p><code class="recovery-key" aria-label="Ключ восстановления">${esc(key)}</code><div class="row-actions"><button class="secondary" type="button" id="recovery-copy">Скопировать</button><button class="secondary" type="button" id="recovery-download">Сохранить файлом</button></div><label class="check-row"><input type="checkbox" id="recovery-saved"> Я сохранил(а) ключ в надёжном месте</label><button class="primary" type="button" id="recovery-done" disabled>Продолжить</button></section>`;
 target.querySelector('#recovery-saved').onchange=e=>{target.querySelector('#recovery-done').disabled=!e.target.checked;};
 target.querySelector('#recovery-copy').onclick=async e=>{try{await navigator.clipboard.writeText(key);e.target.textContent='Скопировано';}catch{e.target.textContent='Выделите и скопируйте вручную';}};
 target.querySelector('#recovery-download').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([`Ключ восстановления Cipherion\n\n${key}\n\nХраните его отдельно от пароля. После использования ключ заменяется новым.\n`],{type:'text/plain'}));a.download='cipherion-recovery-key.txt';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
 target.querySelector('#recovery-done').onclick=done;
}

// Forgotten password: username + recovery key + new password.
export function passwordResetView(target,{complete,back,hint=''}) {
 let busy=false;
 target.innerHTML=`<section class="auth-card glass"><span class="eyebrow">CIPHERION</span><h2>Восстановление пароля</h2><p>Введите username и ключ восстановления, который вы сохранили при регистрации или в настройках.</p>${hint}<form class="stack" id="reset-form"><label class="field">Username<input name="username" required autocomplete="username"></label><label class="field">Ключ восстановления<input name="key" required autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"></label><label class="field">Новый пароль<input name="password" type="password" required minlength="10" maxlength="256" autocomplete="new-password"></label><label class="field">Повторите пароль<input name="repeat" type="password" required minlength="10" maxlength="256" autocomplete="new-password"></label><label class="field">Код 2FA, если включён<input name="code" autocomplete="one-time-code"></label><p role="alert"></p><button class="primary" type="submit">Сменить пароль и войти</button></form><button class="secondary" id="reset-back">Назад ко входу</button></section>`;
 target.querySelector('#reset-back').onclick=()=>{if(!busy)back();};
 target.querySelector('form').onsubmit=async event=>{
  event.preventDefault();if(busy)return;
  const form=event.currentTarget,values=Object.fromEntries(new FormData(form)),error=form.querySelector('[role="alert"]');error.textContent='';
  if(values.password!==values.repeat){error.textContent='Пароли не совпадают';return;}
  busy=true;const buttons=[...target.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
  try{const result=await api('/auth/password-reset','POST',{username:values.username,key:values.key,password:values.password,code:values.code});recoveryKeyView(target,result.recoveryKey,()=>complete(result),{title:'Пароль изменён. Новый ключ восстановления'});}
  catch(e){if(form.isConnected&&e.name!=='AbortError')error.textContent=e.message;}
  finally{busy=false;buttons.forEach(b=>b.disabled=false);}
 };
}

// Keep existing password accounts and registration usable until mail is ready.
export function passwordAuthView(target,{complete,cancel,allowRegistration=true}) {
 let register=false,child=false,busy=false;
 const draft={name:'',username:'',password:'',birth:''};
 const remember=()=>{for(const input of target.querySelectorAll('input[name]'))if(input.name in draft)draft[input.name]=input.value;};
 function draw(){
  target.innerHTML=`<section class="auth-card glass"><span class="eyebrow">CIPHERION</span><h2>${register?'Создать аккаунт':'С возвращением'}</h2><form class="stack" id="password-form">${register?`<label class="field">Имя<input name="name" value="${esc(draft.name)}" required maxlength="80" autocomplete="name"></label>`:''}<label class="field">Username<input name="username" value="${esc(draft.username)}" required pattern="[a-zA-Z0-9_]{${register?'5':'3'},32}" autocomplete="username"></label><label class="field">Пароль<input name="password" type="password" value="${esc(draft.password)}" required minlength="10" maxlength="256" autocomplete="${register?'new-password':'current-password'}"></label>${register&&child?`<label class="field">Дата рождения ребёнка<input name="birth" type="date" value="${esc(draft.birth)}" required></label><p class="note">После регистрации необходима привязка родителя.</p>`:''}${!register?'<label class="field">Код 2FA, если включён<input name="code" autocomplete="one-time-code"></label>':''}<p role="alert"></p><button class="primary" type="submit">${register?'Создать аккаунт':'Войти'}</button></form>${!register?'<button class="link-button" type="button" id="password-forgot">Забыли пароль?</button>':''}${allowRegistration?`<button class="secondary" id="password-switch">${register?'Уже есть аккаунт? Войти':'Создать аккаунт'}</button>`:''}${register?`<button class="secondary" id="password-child">${child?'Обычная регистрация':'Создать детский аккаунт'}</button>`:''}${cancel?'<button class="secondary" id="password-cancel">Назад к аккаунту</button>':''}</section>`;
  target.querySelector('#password-switch')?.addEventListener('click',()=>{if(busy)return;remember();register=!register;draw();});
  target.querySelector('#password-child')?.addEventListener('click',()=>{if(busy)return;remember();child=!child;draw();});
  target.querySelector('#password-cancel')?.addEventListener('click',()=>{if(!busy)cancel();});
  target.querySelector('#password-forgot')?.addEventListener('click',()=>{if(busy)return;remember();passwordResetView(target,{complete,back:draw});const input=target.querySelector('input[name=username]');if(input)input.value=draft.username;});
  target.querySelector('form').onsubmit=async event=>{
   event.preventDefault();if(busy)return;busy=true;remember();
   const form=event.currentTarget,values=Object.fromEntries(new FormData(form));
   const buttons=[...target.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
   const error=form.querySelector('[role="alert"]');error.textContent='';
   try{const result=await api('/auth','POST',{...values,register,child:register&&child});draft.password='';if(register&&result.recoveryKey)recoveryKeyView(target,result.recoveryKey,()=>complete(result));else await complete(result);}
   catch(e){if(form.isConnected&&e.name!=='AbortError')error.textContent=e.message;}
   finally{busy=false;buttons.forEach(b=>b.disabled=false);}
  };
 }
 draw();
}
