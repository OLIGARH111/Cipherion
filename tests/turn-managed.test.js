import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rtcConfigurationAsync,managedTurnConfigured} from '../server/turn.js';
test('managed TURN credentials are fetched server-side and keep the API token private',async()=>{
 const env={CLOUDFLARE_TURN_KEY_ID:'key',CLOUDFLARE_TURN_API_TOKEN:'secret-token'};let call;
 const request=async(url,options)=>{call={url,options};return {ok:true,json:async()=>({iceServers:[{urls:['stun:stun.cloudflare.com:3478','turn:turn.cloudflare.com:3478?transport=udp','turns:turn.cloudflare.com:443?transport=tcp'],username:'u',credential:'c'}]})};};
 assert.equal(managedTurnConfigured(env),true);
 const config=await rtcConfigurationAsync('alice',env,1000,request);
 assert.match(call.url,/turn\/keys\/key\/credentials\/generate-ice-servers$/);
 assert.equal(config.relayConfigured,true);assert.ok(!JSON.stringify(config).includes('secret-token'));
 const failing=await rtcConfigurationAsync('bob',{METERED_TURN_DOMAIN:'x.metered.live',METERED_TURN_API_KEY:'k'},1000,async()=>({ok:false,status:500}));
 assert.equal(failing.relayConfigured,false);assert.ok(failing.iceServers.length>=1);
});
