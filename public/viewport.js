// iOS can pan its visual viewport independently while opening the keyboard.
// Keep the app inside that visible area; only the message list should scroll.
const root = document.documentElement;
const viewport = window.visualViewport;
let frame;
function update() {
  frame = undefined;
  // Do not resize the app when the user intentionally pinch-zooms.
  if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
  const height = viewport?.height || window.innerHeight;
  const top = viewport?.offsetTop || 0;
  root.style.setProperty('--viewport-height', `${height}px`);
  root.style.setProperty('--viewport-top', `${top}px`);
  const editing = document.activeElement?.matches('input, textarea, [contenteditable="true"]');
  root.classList.toggle('keyboard-open', Boolean(editing && window.innerHeight - height > 120));
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
