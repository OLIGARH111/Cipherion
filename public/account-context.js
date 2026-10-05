let active=null,epoch=0;const requests=new Set();
export const activeAccount=()=>active;
export const accountEpoch=()=>epoch;
export function setActiveAccount(id){if(active===id)return;epoch++;for(const c of requests)c.abort();requests.clear();active=id||null;if(active)localStorage.setItem('cipherion-active-account',active);else localStorage.removeItem('cipherion-active-account');}
export function accountURL(path,account=active){if(!account||!path.startsWith('/api/'))return path;const url=new URL(path,location.origin);url.searchParams.set('account',account);return url.pathname+url.search+url.hash;}
export async function accountFetch(path,options={},account=active){const controller=new AbortController(),ticket=epoch;requests.add(controller);const signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;try{const response=await fetch(path,{...options,signal,headers:{...options.headers,...(account?{'X-Cipherion-Account':account}:{})}});if(epoch!==ticket)throw new DOMException('Аккаунт переключён','AbortError');return response;}finally{const timer=setTimeout(()=>requests.delete(controller),120000);timer.unref?.();}}
export const draftKey=chat=>'accounts/'+active+'/draft:'+chat;
