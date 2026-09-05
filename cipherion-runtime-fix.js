/* Cipherion — runtime compatibility fixes for the enhanced mobile UI */
(() => {
  'use strict';

  window.__openChatInfoOriginal = window.__openChatInfoOriginal || (() => document.getElementById('chat-info-btn')?.click());

  const localPollKey = id => `cipherion_poll_${id}`;
  const parsePoll = text => {
    try { if (!String(text||'').startsWith('[POLL]')) return null; return JSON.parse(String(text).slice(6)); } catch (_) { return null; }
  };

  function decoratePollElement(div) {
    if (!div || div.dataset.pollEnhanced === '1') return;
    const text = div.querySelector('.message-text');
    const poll = parsePoll(text?.textContent || '');
    if (!poll) return;
    div.dataset.pollEnhanced='1';
    const saved = (() => { try{return JSON.parse(localStorage.getItem(localPollKey(div.dataset.msgId))||'{}')}catch{return{}} })();
    const box=document.createElement('div'); box.className='ce-poll';
    box.innerHTML=`<b>${escapeHtml(poll.question)}</b><div>${(poll.options||[]).map((o,i)=>`<button type="button" data-poll-index="${i}">${escapeHtml(o)}<span>${Number(saved[i]||0)}</span></button>`).join('')}</div><small>Опрос</small>`;
    text?.replaceWith(box);
    box.querySelectorAll('[data-poll-index]').forEach(btn=>btn.addEventListener('click',()=>{
      const votes=(()=>{try{return JSON.parse(localStorage.getItem(localPollKey(div.dataset.msgId))||'{}')}catch{return{}}})();
      const i=btn.dataset.pollIndex; votes[i]=Number(votes[i]||0)+1; localStorage.setItem(localPollKey(div.dataset.msgId),JSON.stringify(votes));
      box.querySelectorAll('[data-poll-index]').forEach(b=>b.querySelector('span').textContent=Number(votes[b.dataset.pollIndex]||0));
    }));
  }
  function escapeHtml(v){const d=document.createElement('div');d.textContent=v==null?'':String(v);return d.innerHTML;}
  function scanPolls(){document.querySelectorAll('#messages .message').forEach(decoratePollElement);}

  function install(){
    if(document.documentElement.dataset.cipherionRuntimeFix==='1')return;
    document.documentElement.dataset.cipherionRuntimeFix='1';
    const style=document.createElement('style');
    style.textContent='@media(max-width:700px){body:has(#app-settings-modal:not(.hidden)) #mobile-bottom-nav,body:has(#app-settings-modal:not(.hidden)) .mobile-bottom-nav{display:none!important} .ce-settings-page.hidden{display:none!important}}';
    document.head.appendChild(style);

    document.addEventListener('click',e=>{
      const profile=e.target.closest('[data-ce-action="profile"]');
      if(profile){e.preventDefault();e.stopImmediatePropagation();document.getElementById('menu-settings')?.click();}
    },true);

    const messages=document.getElementById('messages');
    if(messages)new MutationObserver(scanPolls).observe(messages,{childList:true,subtree:true});
    scanPolls();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else setTimeout(install,0);
})();
