/* ui-fix: polls, stories, settings guard, resilient boot */
(function () {
  const POLL_KEY = 'cipherion_poll_votes';

  function killAppSettingsModal() {
    const m = document.getElementById('app-settings-modal');
    if (!m) return;
    m.classList.add('hidden');
    m.style.setProperty('display', 'none', 'important');
    m.style.setProperty('visibility', 'hidden', 'important');
    m.style.setProperty('pointer-events', 'none', 'important');
  }

  function watchKillModal() {
    const m = document.getElementById('app-settings-modal');
    if (!m || m.__killObs) return;
    m.__killObs = true;
    new MutationObserver(() => killAppSettingsModal()).observe(m, { attributes: true, attributeFilter: ['class', 'style'] });
    killAppSettingsModal();
  }

  // Recover the initial screen if a stale/broken client script left both screens hidden.
  function ensureBootVisible() {
    const auth = document.getElementById('auth-screen');
    const app = document.getElementById('app-screen');
    if (!auth || !app) return;
    const token = localStorage.getItem('token');
    if (token) {
      app.classList.remove('hidden');
      app.style.removeProperty('display');
      auth.classList.add('hidden');
    } else {
      auth.classList.remove('hidden');
      auth.style.setProperty('display', 'flex', 'important');
      app.classList.add('hidden');
    }
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('#menu-app-settings');
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    killAppSettingsModal();
    if (window.__cipherionMobile && window.__cipherionMobile.openSettingsView) window.__cipherionMobile.openSettingsView();
  }, true);

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function parsePoll(text) {
    if (!text || !String(text).includes('📊')) return null;
    const lines = String(text).replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
    const qLine = lines.find(l => l.includes('Опрос:') || l.startsWith('📊'));
    if (!qLine) return null;
    const q = qLine.replace(/^📊\s*/, '').replace(/^Опрос:\s*/i, '').trim();
    const opts = lines.filter(l => /^[•\-·*]\s*/.test(l) || /^\d+[.)]\s*/.test(l))
      .map(l => l.replace(/^[•\-·*]\s*/, '').replace(/^\d+[.)]\s*/, '').trim()).filter(Boolean);
    if (!q || opts.length < 2) return null;
    return { q, opts };
  }

  function getVotes(id) {
    try { return JSON.parse(localStorage.getItem(POLL_KEY) || '{}')[id] || { counts: {}, mine: null }; }
    catch { return { counts: {}, mine: null }; }
  }

  function saveVote(id, i) {
    let all;
    try { all = JSON.parse(localStorage.getItem(POLL_KEY) || '{}'); } catch { all = {}; }
    const cur = all[id] || { counts: {}, mine: null };
    if (cur.mine != null && cur.counts[cur.mine]) cur.counts[cur.mine] = Math.max(0, (cur.counts[cur.mine] || 0) - 1);
    cur.mine = i;
    cur.counts[i] = (cur.counts[i] || 0) + 1;
    all[id] = cur;
    localStorage.setItem(POLL_KEY, JSON.stringify(all));
    return cur;
  }

  function renderPollCard(msgEl, poll, id) {
    const votes = getVotes(id);
    const total = Object.values(votes.counts).reduce((a, b) => a + b, 0) || 0;
    const card = document.createElement('div');
    card.className = 'poll-card';
    let html = `<div class="poll-q">📊 ${esc(poll.q)}</div>`;
    poll.opts.forEach((opt, i) => {
      const c = votes.counts[i] || 0;
      const pct = total ? Math.round((c / total) * 100) : 0;
      const voted = votes.mine === i ? 'voted' : '';
      html += `<button type="button" class="poll-opt ${voted}" data-i="${i}"><span class="bar" style="width:${pct}%"></span><span class="poll-opt-label">${esc(opt)} · ${pct}%</span></button>`;
    });
    html += `<div class="poll-meta">Голосов: ${total}</div>`;
    card.innerHTML = html;
    card.querySelectorAll('.poll-opt').forEach(btn => btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      saveVote(id, +btn.dataset.i);
      card.replaceWith(renderPollCard(msgEl, poll, id));
    }));
    return card;
  }

  function enhancePolls() {
    document.querySelectorAll('#messages .message').forEach(div => {
      if (div.querySelector('.poll-card')) return;
      const id = div.dataset.msgId || ('m' + Math.random().toString(36).slice(2));
      if (!div.dataset.msgId) div.dataset.msgId = id;
      let text = '';
      div.querySelectorAll(':scope > div').forEach(el => {
        const t = el.textContent || '';
        if (t.includes('📊') || t.includes('Опрос')) text = t;
      });
      if (!text) text = div.innerText || '';
      const poll = parsePoll(text);
      if (!poll) return;
      let target = null;
      div.querySelectorAll(':scope > div').forEach(el => {
        const t = el.textContent || '';
        if (t.includes('📊') || t.includes('Опрос')) target = el;
      });
      if (target) target.replaceWith(renderPollCard(div, poll, id));
    });
  }

  function watchPolls() {
    const box = document.getElementById('messages');
    if (!box || box.__pollFix) return;
    box.__pollFix = true;
    new MutationObserver(() => enhancePolls()).observe(box, { childList: true, subtree: true });
    enhancePolls();
  }

  function forceStoriesRow() {
    const row = document.getElementById('stories-row');
    if (!row) return;
    row.classList.remove('hidden');
    row.style.setProperty('display', 'flex', 'important');
    if (!row.querySelector('.story-bubble')) {
      row.innerHTML = '<div class="story-bubble" id="story-add-btn-fix"><div class="story-ring"><div class="story-ring-inner story-add">+</div></div><div class="story-name">Ваша</div></div>';
      document.getElementById('story-add-btn-fix')?.addEventListener('click', () => document.getElementById('story-compose-modal')?.classList.remove('hidden'));
    }
  }

  function patchLoadStories() {
    const orig = window.loadStories;
    if (typeof orig !== 'function' || orig.__patched) return;
    const wrapped = async function () {
      try { await orig.apply(this, arguments); } catch (e) { console.warn('loadStories', e); }
      forceStoriesRow();
    };
    wrapped.__patched = true;
    window.loadStories = wrapped;
  }

  window.addEventListener('cipherion-ws-message', ev => {
    try {
      const data = JSON.parse(ev.detail);
      if (data.type === 'call_offline') {
        const st = document.getElementById('cs-status');
        if (st) st.textContent = 'Абонент не в сети';
        setTimeout(() => {
          if (typeof window.__cipherionHangup === 'function') window.__cipherionHangup(false);
          else document.getElementById('call-screen')?.classList.add('hidden');
        }, 1500);
      }
    } catch (e) {}
  });

  function init() {
    try {
      ensureBootVisible();
      watchKillModal();
      killAppSettingsModal();
      watchPolls();
      forceStoriesRow();
      patchLoadStories();
    } catch (e) { console.warn('ui-fix init', e); }
    setTimeout(ensureBootVisible, 300);
    setTimeout(killAppSettingsModal, 300);
    setTimeout(forceStoriesRow, 600);
    setTimeout(patchLoadStories, 900);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  window.addEventListener('load', init);
})();
