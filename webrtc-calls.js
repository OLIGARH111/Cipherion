/* Cipherion real voice calls — WebRTC + WebSocket signaling */
(function () {
  const CALLS_KEY = 'cipherion_call_history';
  const ICE_SERVERS = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' }
    ]
  };

  let pc = null;
  let localStream = null;
  let remoteAudio = null;
  let callState = null; // { role, peerId, peerName, peerAvatar, chatId, callId, startedAt, connected }
  let callTimer = null;
  let pendingOffer = null;

  function $(s, r) {
    return (r || document).querySelector(s);
  }

  function myId() {
    return Number(localStorage.getItem('userId') || 0);
  }

  function myName() {
    return localStorage.getItem('username') || '';
  }

  function sendSignal(msg) {
    const ws = window.__cipherionWS;
    if (!ws || ws.readyState !== 1) {
      console.warn('WS not ready for call signal', msg.type);
      return false;
    }
    ws.send(JSON.stringify(msg));
    return true;
  }

  function ensureUI() {
    let el = $('#call-screen');
    if (!el) {
      el = document.createElement('div');
      el.id = 'call-screen';
      el.className = 'call-screen hidden';
      el.innerHTML = `
        <div class="cs-av" id="cs-av">?</div>
        <div class="cs-name" id="cs-name"></div>
        <div class="cs-status" id="cs-status">Вызов…</div>
        <div id="cs-timer" style="font-variant-numeric:tabular-nums;opacity:.85">0:00</div>
        <div id="cs-incoming-actions" style="display:none;gap:16px;margin-top:20px">
          <button type="button" id="cs-accept" style="width:64px;height:64px;border-radius:50%;border:none;background:#10b981;color:#fff;font-size:26px">✓</button>
          <button type="button" id="cs-reject" style="width:64px;height:64px;border-radius:50%;border:none;background:#ef4444;color:#fff;font-size:26px">✕</button>
        </div>
        <button type="button" class="cs-hang" id="cs-hang" title="Завершить">📵</button>
        <audio id="cs-remote-audio" autoplay playsinline></audio>
      `;
      document.body.appendChild(el);
      $('#cs-hang').onclick = () => hangup(true);
      $('#cs-accept').onclick = () => acceptIncoming();
      $('#cs-reject').onclick = () => rejectIncoming();
    }
    remoteAudio = $('#cs-remote-audio');
    return el;
  }

  function showCallUI({ name, avatar, status, incoming }) {
    const el = ensureUI();
    const av = $('#cs-av');
    if (avatar) av.innerHTML = '<img src="' + avatar + '" alt="">';
    else av.textContent = (name || '?')[0].toUpperCase();
    $('#cs-name').textContent = name || 'Абонент';
    $('#cs-status').textContent = status || 'Вызов…';
    $('#cs-timer').textContent = '0:00';
    const inc = $('#cs-incoming-actions');
    const hang = $('#cs-hang');
    if (incoming) {
      inc.style.display = 'flex';
      hang.style.display = 'none';
    } else {
      inc.style.display = 'none';
      hang.style.display = '';
    }
    el.classList.remove('hidden');
  }

  function hideCallUI() {
    const el = $('#call-screen');
    if (el) el.classList.add('hidden');
    clearInterval(callTimer);
    callTimer = null;
  }

  function startTimer() {
    clearInterval(callTimer);
    const t0 = Date.now();
    callTimer = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      const m = Math.floor(s / 60);
      const r = String(s % 60).padStart(2, '0');
      const node = $('#cs-timer');
      if (node) node.textContent = m + ':' + r;
    }, 500);
  }

  function saveHistory(entry) {
    try {
      const list = JSON.parse(localStorage.getItem(CALLS_KEY) || '[]');
      list.unshift(entry);
      localStorage.setItem(CALLS_KEY, JSON.stringify(list.slice(0, 100)));
      if (typeof window.__renderCallsList === 'function') window.__renderCallsList();
    } catch (e) {}
  }

  async function getMic() {
    if (localStream) return localStream;
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
    return localStream;
  }

  function createPC() {
    if (pc) {
      try {
        pc.close();
      } catch (e) {}
    }
    pc = new RTCPeerConnection(ICE_SERVERS);
    pc.onicecandidate = (ev) => {
      if (!ev.candidate || !callState) return;
      sendSignal({
        type: 'call_ice',
        to_user_id: callState.peerId,
        call_id: callState.callId,
        candidate: ev.candidate.toJSON()
      });
    };
    pc.ontrack = (ev) => {
      ensureUI();
      if (remoteAudio) {
        remoteAudio.srcObject = ev.streams[0];
        remoteAudio.play().catch(() => {});
      }
      if (callState && !callState.connected) {
        callState.connected = true;
        callState.startedAt = Date.now();
        const st = $('#cs-status');
        if (st) st.textContent = 'Разговор';
        startTimer();
      }
    };
    pc.onconnectionstatechange = () => {
      if (!pc) return;
      const s = pc.connectionState;
      if (s === 'failed' || s === 'disconnected' || s === 'closed') {
        if (callState) hangup(false);
      }
    };
    return pc;
  }

  async function addLocalTracks() {
    const stream = await getMic();
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
  }

  /** Outgoing call from profile */
  async function startCall({ name, avatar, userId, chatId }) {
    if (!userId) {
      alert('Некому звонить');
      return;
    }
    if (callState) {
      alert('Уже идёт звонок');
      return;
    }
    if (!window.__cipherionWS || window.__cipherionWS.readyState !== 1) {
      alert('Нет соединения. Подождите и попробуйте снова.');
      return;
    }

    const callId = 'c' + Date.now() + '_' + myId();
    callState = {
      role: 'caller',
      peerId: Number(userId),
      peerName: name,
      peerAvatar: avatar,
      chatId: chatId || null,
      callId,
      connected: false,
      startedAt: null
    };

    showCallUI({ name, avatar, status: 'Вызов…', incoming: false });

    const ok = sendSignal({
      type: 'call_invite',
      to_user_id: Number(userId),
      call_id: callId,
      from_username: myName(),
      from_avatar: localStorage.getItem('avatarUrl') || null,
      chat_id: chatId || null
    });
    if (!ok) {
      cleanupMedia();
      callState = null;
      hideCallUI();
      alert('Не удалось отправить вызов');
    }
  }

  async function onInvite(data) {
    if (callState) {
      sendSignal({
        type: 'call_busy',
        to_user_id: data.from_user_id,
        call_id: data.call_id
      });
      return;
    }
    callState = {
      role: 'callee',
      peerId: Number(data.from_user_id),
      peerName: data.from_username || 'Абонент',
      peerAvatar: data.from_avatar || null,
      chatId: data.chat_id || null,
      callId: data.call_id,
      connected: false,
      startedAt: null
    };
    showCallUI({
      name: callState.peerName,
      avatar: callState.peerAvatar,
      status: 'Входящий звонок',
      incoming: true
    });
    try {
      // soft ring via vibration if available
      if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
    } catch (e) {}
  }

  async function acceptIncoming() {
    if (!callState || callState.role !== 'callee') return;
    $('#cs-incoming-actions').style.display = 'none';
    $('#cs-hang').style.display = '';
    $('#cs-status').textContent = 'Соединение…';

    sendSignal({
      type: 'call_accept',
      to_user_id: callState.peerId,
      call_id: callState.callId
    });

    try {
      createPC();
      await addLocalTracks();
      // Wait for offer from caller
    } catch (e) {
      console.error(e);
      alert('Нет доступа к микрофону');
      hangup(true);
    }
  }

  function rejectIncoming() {
    if (!callState) return;
    sendSignal({
      type: 'call_reject',
      to_user_id: callState.peerId,
      call_id: callState.callId
    });
    saveHistory({
      id: Date.now(),
      name: callState.peerName,
      avatar: callState.peerAvatar,
      userId: callState.peerId,
      chatId: callState.chatId,
      direction: 'in',
      status: 'rejected',
      duration: 0,
      at: new Date().toISOString()
    });
    cleanupMedia();
    callState = null;
    hideCallUI();
  }

  async function onAccept(data) {
    if (!callState || callState.role !== 'caller') return;
    if (data.call_id && data.call_id !== callState.callId) return;
    $('#cs-status').textContent = 'Соединение…';
    try {
      createPC();
      await addLocalTracks();
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      sendSignal({
        type: 'call_offer',
        to_user_id: callState.peerId,
        call_id: callState.callId,
        sdp: pc.localDescription
      });
    } catch (e) {
      console.error(e);
      alert('Не удалось начать звонок (микрофон?)');
      hangup(true);
    }
  }

  async function onOffer(data) {
    if (!callState || callState.role !== 'callee') return;
    if (data.call_id && data.call_id !== callState.callId) return;
    try {
      if (!pc) {
        createPC();
        await addLocalTracks();
      }
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal({
        type: 'call_answer',
        to_user_id: callState.peerId,
        call_id: callState.callId,
        sdp: pc.localDescription
      });
    } catch (e) {
      console.error(e);
      hangup(true);
    }
  }

  async function onAnswer(data) {
    if (!callState || callState.role !== 'caller' || !pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } catch (e) {
      console.error(e);
    }
  }

  async function onIce(data) {
    if (!pc || !data.candidate) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (e) {
      console.warn('ICE error', e);
    }
  }

  function onReject(data) {
    if (!callState) return;
    $('#cs-status').textContent = 'Отклонён';
    saveHistory({
      id: Date.now(),
      name: callState.peerName,
      avatar: callState.peerAvatar,
      userId: callState.peerId,
      chatId: callState.chatId,
      direction: callState.role === 'caller' ? 'out' : 'in',
      status: 'rejected',
      duration: 0,
      at: new Date().toISOString()
    });
    setTimeout(() => {
      cleanupMedia();
      callState = null;
      hideCallUI();
    }, 800);
  }

  function onBusy() {
    if (!callState) return;
    $('#cs-status').textContent = 'Занято';
    setTimeout(() => {
      cleanupMedia();
      callState = null;
      hideCallUI();
    }, 1200);
  }

  function onRemoteEnd() {
    if (!callState) return;
    const dur =
      callState.connected && callState.startedAt
        ? Math.floor((Date.now() - callState.startedAt) / 1000)
        : 0;
    saveHistory({
      id: Date.now(),
      name: callState.peerName,
      avatar: callState.peerAvatar,
      userId: callState.peerId,
      chatId: callState.chatId,
      direction: callState.role === 'caller' ? 'out' : 'in',
      status: callState.connected ? 'answered' : 'missed',
      duration: dur,
      at: new Date().toISOString()
    });
    cleanupMedia();
    callState = null;
    hideCallUI();
  }

  function hangup(notifyPeer) {
    if (callState && notifyPeer) {
      sendSignal({
        type: 'call_end',
        to_user_id: callState.peerId,
        call_id: callState.callId
      });
      const dur =
        callState.connected && callState.startedAt
          ? Math.floor((Date.now() - callState.startedAt) / 1000)
          : 0;
      saveHistory({
        id: Date.now(),
        name: callState.peerName,
        avatar: callState.peerAvatar,
        userId: callState.peerId,
        chatId: callState.chatId,
        direction: callState.role === 'caller' ? 'out' : 'in',
        status: callState.connected ? 'answered' : 'cancelled',
        duration: dur,
        at: new Date().toISOString()
      });
    }
    cleanupMedia();
    callState = null;
    hideCallUI();
  }

  function cleanupMedia() {
    clearInterval(callTimer);
    callTimer = null;
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    if (pc) {
      try {
        pc.close();
      } catch (e) {}
      pc = null;
    }
    if (remoteAudio) remoteAudio.srcObject = null;
  }

  function handleSignal(data) {
    if (!data || !data.type) return;
    switch (data.type) {
      case 'call_invite':
        onInvite(data);
        break;
      case 'call_accept':
        onAccept(data);
        break;
      case 'call_reject':
        onReject(data);
        break;
      case 'call_busy':
        onBusy();
        break;
      case 'call_offer':
        onOffer(data);
        break;
      case 'call_answer':
        onAnswer(data);
        break;
      case 'call_ice':
        onIce(data);
        break;
      case 'call_end':
        onRemoteEnd();
        break;
      default:
        break;
    }
  }

  window.addEventListener('cipherion-ws-message', (ev) => {
    try {
      const data = JSON.parse(ev.detail);
      handleSignal(data);
    } catch (e) {}
  });

  // Override demo startCall from emerald.js
  window.startCall = startCall;
  window.__cipherionStartCall = startCall;
  window.__cipherionHangup = hangup;

  // Hook profile call button after emerald creates it
  const obs = new MutationObserver(() => {
    const btn = document.getElementById('pf-call');
    if (btn && !btn.__rtc) {
      btn.__rtc = true;
      btn.addEventListener(
        'click',
        (e) => {
          // emerald may have already bound; we re-read state from dataset if any
        },
        true
      );
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });

  // Patch emerald startCall if it runs later
  Object.defineProperty(window, '__overrideStartCall', {
    set: function () {},
    get: function () {
      return startCall;
    }
  });

  console.log('[Cipherion] WebRTC calls ready');
})();
