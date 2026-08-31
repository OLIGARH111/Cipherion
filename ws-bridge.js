/* Must load before app.js — exposes live WS for WebRTC signaling */
(function () {
  const Native = window.WebSocket;
  function Wrapped(url, protocols) {
    const ws =
      protocols !== undefined ? new Native(url, protocols) : new Native(url);
    window.__cipherionWS = ws;
    try {
      window.dispatchEvent(new CustomEvent('cipherion-ws', { detail: ws }));
    } catch (e) {}
    ws.addEventListener('message', function (ev) {
      try {
        window.dispatchEvent(
          new CustomEvent('cipherion-ws-message', { detail: ev.data })
        );
      } catch (e) {}
    });
    return ws;
  }
  Wrapped.prototype = Native.prototype;
  ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) {
    Wrapped[k] = Native[k];
  });
  window.WebSocket = Wrapped;
})();
