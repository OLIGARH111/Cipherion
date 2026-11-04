// Link between the page and the native Cipherion iOS app (ios/).
// The native app rings incoming calls on the iPhone system call screen (CallKit),
// even when Cipherion is closed, and passes the user's choice here.
const native=()=>window.webkit?.messageHandlers?.cipherion;
export const isNativeApp=()=>!!native();
const post=message=>{try{native()?.postMessage(message);}catch{}};

let handlers=null,pending=[],tokens=null;
export function nativeCallEnded(call){if(call)post({type:'callEnded',call});}

// handlers: {register(tokens), answer({call,chat,account}), end({call}), mute({call,muted}), open(url)}
export function setupNativeBridge(h){
  if(!isNativeApp())return;
  handlers=h;
  for(const m of pending.splice(0))deliver(m);
  if(tokens)h.register(tokens);
  post({type:'ready'});
}
export function registerNativeTokens(){if(tokens&&handlers)return handlers.register(tokens);}
function deliver(m){
  if(!handlers){pending.push(m);return;}
  if(m.type==='tokens'){tokens={voip:m.voip||null,alert:m.alert||null,sandbox:m.sandbox===true};return handlers.register(tokens);}
  if(m.type==='answer')return handlers.answer(m);
  if(m.type==='end')return handlers.end(m);
  if(m.type==='mute')return handlers.mute?.(m);
  if(m.type==='open')return handlers.open(m.url);
}
if(typeof window!=='undefined')window.CipherionNative={receive:m=>{try{return Promise.resolve(deliver(m)).catch(e=>console.warn('Cipherion native',e));}catch(e){console.warn('Cipherion native',e);}}};
