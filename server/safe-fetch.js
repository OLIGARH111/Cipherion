// Outgoing HTTP requests to addresses chosen by users (link previews, bot webhooks).
// Every hop is resolved and checked here, and the socket connects to exactly the
// address that was checked, so a hostname cannot point the server at its own network
// (localhost, cloud metadata, private ranges), even through a redirect or a DNS change.
import http from 'node:http';
import https from 'node:https';
import {lookup} from 'node:dns';
import {isIP} from 'node:net';

function v4number(ip){return ip.split('.').reduce((n,p)=>n*256+Number(p),0);}
const ranges4=[['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]].map(([base,bits])=>[v4number(base),bits]);

// True for an address the server must never connect to on a user's behalf.
export function privateAddress(ip){
  const kind=isIP(ip);
  if(kind===4){const n=v4number(ip);return ranges4.some(([base,bits])=>Math.floor(n/2**(32-bits))===Math.floor(base/2**(32-bits)));}
  if(kind===6){
    const a=ip.toLowerCase();
    if(a==='::'||a==='::1')return true;
    const mapped=/^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);if(mapped)return privateAddress(mapped[1]);
    // Unique local fc00::/7, link-local fe80::/10, multicast ff00::/8, NAT64 and documentation ranges.
    return /^(f[cd]|fe[89ab]|ff)/.test(a)||a.startsWith('64:ff9b:')||a.startsWith('2001:db8')||a.startsWith('100::');
  }
  return true;
}

function guardedLookup(hostname,options,callback){
  lookup(hostname,{all:true},(error,addresses)=>{
    if(error)return callback(error);
    const safe=addresses.filter(a=>!privateAddress(a.address));
    if(!safe.length||safe.length!==addresses.length)return callback(Object.assign(new Error('Адрес недоступен'),{code:'EBLOCKED'}));
    if(options?.all)return callback(null,safe);
    callback(null,safe[0].address,safe[0].family);
  });
}

export function checkURL(raw){
  let url;try{url=new URL(String(raw));}catch{return null;}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return null;
  if(url.port&&!['80','443','8080','8443'].includes(url.port))return null;
  const host=url.hostname.replace(/^\[|\]$/g,'');
  if(!host||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal'))return null;
  if(isIP(host)&&privateAddress(host))return null;
  return url;
}

// Fetches a URL with redirects, a byte cap and a timeout. Resolves to {status,headers,body,url}.
export async function safeFetch(raw,{method='GET',headers={},body=null,maxBytes=1024*1024,timeout=8000,redirects=3}={}){
  let url=checkURL(raw);if(!url)throw Object.assign(new Error('Недопустимый адрес'),{status:400});
  const deadline=Date.now()+timeout;
  for(let hop=0;hop<=redirects;hop++){
    const result=await new Promise((resolve,reject)=>{
      const client=url.protocol==='https:'?https:http;
      const request=client.request(url,{method,lookup:guardedLookup,headers:{'User-Agent':'CipherionBot/1.0 (+link preview)','Accept-Language':'ru,en;q=0.8',...headers},timeout:Math.max(500,deadline-Date.now())},response=>{
        const chunks=[];let size=0;
        if([301,302,303,307,308].includes(response.statusCode)&&response.headers.location){response.resume();return resolve({redirect:response.headers.location});}
        response.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){chunks.push(chunk.subarray(0,Math.max(0,chunk.length-(size-maxBytes))));response.destroy();resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks),truncated:true});return;}chunks.push(chunk);});
        response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)}));
        response.on('error',reject);
      });
      request.on('timeout',()=>request.destroy(Object.assign(new Error('Сайт не ответил вовремя'),{code:'ETIMEDOUT'})));
      request.on('error',reject);
      if(body)request.write(body);
      request.end();
    });
    if(!result.redirect)return {...result,url:url.href};
    const next=checkURL(new URL(result.redirect,url).href);if(!next)throw Object.assign(new Error('Недопустимое перенаправление'),{status:400});
    url=next;if(method==='POST')return {status:310,headers:{},body:Buffer.alloc(0),url:url.href};
  }
  throw Object.assign(new Error('Слишком много перенаправлений'),{status:400});
}
