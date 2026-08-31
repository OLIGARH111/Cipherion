/* ui-fix: polls, stories visibility, call offline */
(function () {
  const POLL_KEY = 'cipherion_poll_votes';

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"');
  }

  function parsePoll(text) {
    if (!text || !String(text).includes('📊')) return null;
    const lines = String(text)
      .replace(/\r/g, '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const qLine = lines.find((l) => l.includes('Опрос:') || l.startsWith('📊'));
    if (!qLine) return null;
    const q = qLine.replace(/^📊\s*/, '').replace(/^Опрос:\s*/i, '').trim();
    const opts = lines
      .filter((l) => /^[•\-·*]\s*/.test(l) || /^\d+[.)]\s*/.test(l))
      .map((l) => l.replace(/^[•\-·*]\s*/, '').replace(/^\d+[.)]\s*/, '').trim())
      .filter(Boolean);
    if (!q || opts.length < 2) return null;
    return { q, opts };
  }

  function getVotes(id) {
    try {
      return JSON.parse(localStorage.getItem(POLL_KEY) || '{}')[id] || { counts: {}, mine: null };
    } catch {
      return { counts: {}, mine: null };
    }
  }

  function saveVote(id, i) {
    const all = JSON.parse(localStorage.getItem(POLL_KEY) || '{}');
    const cur = all[id] || { counts: {}, mine: null };
    if (cur.mine != null && cur.counts[cur.mine]) {
      cur.counts[cur.mine] = Math.max(0, (cur.counts[cur.mine] || 0) - 1);
    }
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
    card.dataset.pollId = id;
    let html = `<div class="poll-q">📊 ${esc(poll.q)}</div>`;
    poll.opts.forEach((opt, i) => {
      const c = votes.counts[i] || 0;
      const pct = total ? Math.round((c / total) * 100) : 0;
      const voted = votes.mine === i ? 'voted' : '';
      html += `<button type="button" class="poll-opt ${voted}" data-i="${i}"><span class="bar" style="width:${pct}%"></span><span class="poll-opt-label">${esc(opt)} · ${pct}%</span></button>`;
    });
    html += `<div class="poll-meta">Голосов: ${total}</div>`;
    card.innerHTML = html;
    card.querySelectorAll('.poll-opt').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        saveVote(id, +btn.dataset.i);
        const next = renderPollCard(msgEl, poll, id);
        card.replaceWith(next);
      });
    });
    return card;
  }

  function enhancePolls() {
    document.querySelectorAll('#messages .message').forEach((div) => {
      if (div.querySelector('.poll-card')) return;
      const id = div.dataset.msgId || ('m' + Math.random().toString(36).slice(2));
      if (!div.dataset.msgId) div.dataset.msgId = id;

      // Collect text from direct child divs that look like content
      let text = '';
      div.childNodes.forEach((n) => {
        if (n.nodeType === 1) {
          const el = n;
          if (
            el.classList.contains('message-sender') ||
            el.classList.contains('message-time') ||
            el.classList.contains('msg-actions') ||
            el.classList.contains('message-status') ||
            el.classList.contains('voice-message') ||
            el.classList.contains('poll-card')
          )
            return;
          const t = el.innerText || el.textContent || '';
          if (t.includes('📊') || t.includes('Опрос')) text = t;
        }
      });
      if (!text) text = div.innerText || '';
      const poll = parsePoll(text);
      if (!poll) return;

      // Replace the content div that holds the poll text
      let target = null;
      div.querySelectorAll(':scope > div').forEach((el) => {
        const t = el.textContent || '';
        if (t.includes('📊') || t.includes('Опрос')) target = el;
      });
      if (!target) return;
      const card = renderPollCard(div, poll, id);
      target.replaceWith(card);
    });
  }

  function watchPolls() {
    const box = document.getElementById('messages');
    if (!box || box.__pollFix) return;
    box.__pollFix = true;
    new MutationObserver(() => enhancePolls()).observe(box, { childList: true, subtree: true });
    enhancePolls();
  }

  /* Stories always visible at top */
  function forceStoriesRow() {
    const row = document.getElementById('stories-row');
    if (!row) return;
    row.classList.remove('hidden');
    row.style.setProperty('display', 'flex', 'important');
    row.style.setProperty('visibility', 'visible', 'important');
    row.style.setProperty('opacity', '1', 'important');
    row.style.setProperty('min-height', '88px', 'important');

    if (!row.querySelector('.story-bubble')) {
      row.innerHTML = `
        <div class="story-bubble" id="story-add-btn-fix">
          <div class="story-ring"><div class="story-ring-inner story-add">+</div></div>
          <div class="story-name">Ваша</div>
        </div>`;
      document.getElementById('story-add-btn-fix')?.addEventListener('click', () => {
        const modal = document.getElementById('story-compose-modal');
        if (modal) modal.classList.remove('hidden');
        else alert('Войдите и откройте VIP, чтобы добавить историю');
      });
    }
  }

  function patchLoadStories() {
    const orig = window.loadStories;
    if (typeof orig !== 'function' || orig.__patched) return;
    const wrapped = async function () {
      try {
        await orig.apply(this, arguments);
      } catch (e) {}
      forceStoriesRow();
    };
    wrapped.__patched = true;
    window.loadStories = wrapped;
  }

  /* Call offline handler */
  window.addEventListener('cipherion-ws-message', (ev) => {
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
    watchPolls();
    forceStoriesRow();
    patchLoadStories();
    setTimeout(forceStoriesRow, 500);
    setTimeout(forceStoriesRow, 1500);
    setTimeout(patchLoadStories, 800);
    setTimeout(() => {
      if (typeof window.loadStories === 'function') window.loadStories();
    }, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  window.addEventListener('load', init);
})();
