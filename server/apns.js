import {connect} from 'node:http2';
import {createHash,createPrivateKey,sign} from 'node:crypto';

// Apple Push Notification service for the native iOS app.
// VoIP pushes wake the app and show the system call screen (CallKit) even when the app is closed.
// Alert pushes deliver message notifications to the same app.
// Configure with an APNs auth key (.p8) from developer.apple.com → Keys.
export function apnsConfig(env=process.env){
  const keyId=env.APNS_KEY_ID,teamId=env.APNS_TEAM_ID,bundleId=env.APNS_BUNDLE_ID||'com.cipherion.app';
  const pem=(env.APNS_PRIVATE_KEY||'').replace(/\\n/g,'\n').trim();
  if(!keyId||!teamId||!pem)return null;
  let key;try{key=createPrivateKey(pem);}catch{return null;}
  return {keyId,teamId,bundleId,key};
}

// CallKit identifies calls by UUID; derive a stable one from the server call id.
export function callUUID(callId){
  const h=createHash('sha256').update('cipherion-call:'+callId).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-${(8|parseInt(h[16],16)&3).toString(16)}${h.slice(17,20)}-${h.slice(20,32)}`.toUpperCase();
}

export function apnsToken(config,issuedAt=Math.floor(Date.now()/1000)){
  const part=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
  const input=part({alg:'ES256',kid:config.keyId})+'.'+part({iss:config.teamId,iat:issuedAt});
  return input+'.'+sign('sha256',Buffer.from(input),{key:config.key,dsaEncoding:'ieee-p1363'}).toString('base64url');
}

export function createApns(config){
  if(!config)return null;
  const sessions=new Map();let jwt=null,jwtAt=0;
  function bearer(){const t=Math.floor(Date.now()/1000);if(!jwt||t-jwtAt>2400){jwt=apnsToken(config,t);jwtAt=t;}return jwt;}
  function session(sandbox){
    const host=sandbox?'https://api.sandbox.push.apple.com':'https://api.push.apple.com';
    let s=sessions.get(host);
    if(!s||s.closed||s.destroyed){s=connect(host);s.on('error',()=>{});s.on('close',()=>{if(sessions.get(host)===s)sessions.delete(host);});s.setTimeout(600000,()=>s.close());s.unref?.();sessions.set(host,s);}
    return s;
  }
  // Resolves on acceptance; rejects with statusCode 410 for tokens that no longer exist.
  function send({token,sandbox,type,payload,expiration=0,priority=10,collapseId}){
    if(!/^[0-9a-f]{64,200}$/i.test(token||''))return Promise.reject(Object.assign(new Error('BadDeviceToken'),{statusCode:410}));
    return new Promise((resolve,reject)=>{
      const headers={':method':'POST',':path':'/3/device/'+token,authorization:'bearer '+bearer(),'apns-topic':type==='voip'?config.bundleId+'.voip':config.bundleId,'apns-push-type':type,'apns-priority':String(priority),'apns-expiration':String(expiration),...(collapseId?{'apns-collapse-id':collapseId.slice(0,64)}:{})};
      let req;try{req=session(sandbox).request(headers);}catch(e){reject(e);return;}
      let status=0,body='';
      req.setTimeout(10000,()=>req.close());
      req.on('response',h=>{status=h[':status'];});
      req.on('data',c=>{body+=c;});
      req.on('end',()=>{
        if(status===200){resolve();return;}
        let reason='';try{reason=JSON.parse(body).reason||'';}catch{}
        const gone=status===410||['BadDeviceToken','Unregistered','DeviceTokenNotForTopic'].includes(reason);
        reject(Object.assign(new Error('APNs '+status+' '+reason),{statusCode:gone?410:status||502,reason}));
      });
      req.on('error',reject);
      req.end(JSON.stringify(payload));
    });
  }
  return {send,bundleId:config.bundleId};
}
