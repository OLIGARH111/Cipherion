// iOS can pan its visual viewport independently while opening the keyboard.
// Keep the app inside that visible area; only the message list should scroll.
const root = document.documentElement;
const viewport = window.visualViewport;
let frame, probe;
const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
// iOS 26 home-screen apps stop the page above the home indicator (100lvh still measures the
// whole screen). The system already keeps that strip free, so the app must not add the
// bottom safe-area inset a second time.
function largeViewport() {
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:100lvh;visibility:hidden;pointer-events:none';
    document.documentElement.append(probe);
  }
  return probe.offsetHeight;
}
function update() {
  frame = undefined;
  // Do not resize the app when the user intentionally pinch-zooms.
  if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
  const visible = viewport?.height || window.innerHeight;
  const editing = document.activeElement?.matches('input, textarea, [contenteditable="true"]');
  const keyboard = Boolean(editing && window.innerHeight - visible > 120);
  root.style.setProperty('--viewport-height', `${visible}px`);
  root.style.setProperty('--viewport-top', `${viewport?.offsetTop || 0}px`);
  root.classList.toggle('keyboard-open', keyboard);
  root.classList.toggle('short-viewport', !keyboard && standalone() && largeViewport() - Math.max(visible, window.innerHeight) > 20);
}
function schedule() {
  if (frame === undefined) frame = requestAnimationFrame(update);
}
viewport?.addEventListener('resize', schedule);
viewport?.addEventListener('scroll', schedule);
window.addEventListener('resize', schedule);
window.addEventListener('pageshow', schedule);
document.addEventListener('focusin', schedule);
document.addEventListener('focusout', schedule);
update();
