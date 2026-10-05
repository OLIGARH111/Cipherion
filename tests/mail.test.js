import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMailer} from '../server/mail.js';
test('Resend adapter sends a transactional code with idempotency and hides provider errors',async()=>{
 const calls=[],env={EMAIL_PROVIDER:'resend',RESEND_API_KEY:'private-test-key',EMAIL_FROM:'Cipherion <auth@example.test>'};
 const mail=createMailer({env,request:async(url,options)=>{calls.push({url,...options});return {ok:true,json:async()=>({id:'delivery'})};}});
 assert.equal(mail.ready(),true);await mail.send({email:'recipient@example.test',code:'004201',purpose:'register',challengeId:'challenge'});
 assert.equal(calls[0].url,'https://api.resend.com/emails');assert.equal(calls[0].headers['Idempotency-Key'],'cipherion-email/challenge');const body=JSON.parse(calls[0].body);assert.deepEqual(body.to,['recipient@example.test']);assert.match(body.text,/004201/);assert.match(body.text,/10 минут/);
 const failing=createMailer({env,request:async()=>{throw Error('private-test-key sensitive provider detail');}});await assert.rejects(failing.send({email:'a@b.test',code:'123456',challengeId:'c'}),e=>e.status===502&&!e.message.includes('private-test-key'));
 assert.equal(createMailer({env:{EMAIL_PROVIDER:'resend'}}).ready(),false);
});
test('webhook rejects plaintext transport and preserves existing delivery contract',async()=>{
 const insecure=createMailer({env:{EMAIL_VERIFICATION_URL:'http://example.test'}});await assert.rejects(insecure.send({}),{status:503});
 let sent;const mail=createMailer({env:{EMAIL_VERIFICATION_URL:'https://mail.example.test',VERIFICATION_TOKEN:'private'},request:async(_u,o)=>{sent=JSON.parse(o.body);return {ok:true};}});
 await mail.send({email:'a@b.test',code:'123456',purpose:'login',challengeId:'c'});assert.deepEqual(sent,{to:'a@b.test',code:'123456',kind:'email',purpose:'login',expiresIn:600});
});
