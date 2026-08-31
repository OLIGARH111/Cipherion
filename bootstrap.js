(() => {
  const critical = document.createElement('style');
  critical.textContent = `html,body{margin:0!important;width:100%!important;min-height:100%!important;background:#022c22!important}#auth-screen{display:flex!important;min-height:100vh;align-items:center;justify-content:center}#auth-screen.hidden{display:flex!important}.auth-box{display:block!important;visibility:visible!important;opacity:1!important}`;
  document.head.appendChild(critical);

  const files = ['app.js','mobile-nav.js','ui-v3.js','emerald.js','ws-bridge.js','webrtc-calls.js','ui-fix.js'];
  const load = (name) => new Promise(resolve => {
    if ([...document.scripts].some(s => (s.src || '').includes('/' + name))) return resolve();
    const s = document.createElement('script');
    s.src = '/' + name + '?boot=20260901';
    s.async = false;
    s.onload = resolve;
    s.onerror = () => { console.error('Cipherion: failed to load', name); resolve(); };
    document.body.appendChild(s);
  });
  files.reduce((p, f) => p.then(() => load(f)), Promise.resolve());
})();
