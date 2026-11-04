import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RTCPeerConnection,MediaStreamTrack,RtpPacket,RtpHeader,useOPUS,useVP8} from 'werift';
import {createSFU} from '../server/sfu.js';

// Three participants send audio through the SFU; each must receive the other two, labelled by user id.
test('SFU forwards every participant’s audio to the others and stops when someone leaves',{timeout:60000},async()=>{
  const clients=new Map(),timers=[];
  const sfu=createSFU({send:(user,call,signal)=>clients.get(user)?.onSignal(signal),options:{maxParticipants:30}});
  function client(user){
    const pc=new RTCPeerConnection({codecs:{audio:[useOPUS()],video:[useVP8()]}}),audio=new MediaStreamTrack({kind:'audio'});
    const c={user,pc,received:new Map(),first:true};
    pc.ontrack=e=>{const owner=e.streams?.[0]?.id;e.track.onReceiveRtp.subscribe(()=>c.received.set(owner,(c.received.get(owner)||0)+1));};
    pc.onIceCandidate.subscribe(candidate=>{if(candidate)sfu.signal('call',user,{candidate:candidate.toJSON()}).catch(()=>{});});
    c.onSignal=async s=>{
      if(s.description){await pc.setRemoteDescription(s.description);
        if(c.first){c.first=false;const own=pc.getTransceivers()[0];own.setDirection('sendonly');await own.sender.replaceTrack(audio);}
        await pc.setLocalDescription(await pc.createAnswer());await sfu.signal('call',user,{description:{type:'answer',sdp:pc.localDescription.sdp}});}
      else if(s.candidate)await pc.addIceCandidate(s.candidate);
    };
    let seq=0,ts=0;timers.push(setInterval(()=>audio.writeRtp(new RtpPacket(new RtpHeader({payloadType:111,sequenceNumber:(seq++)&0xffff,timestamp:(ts+=960)>>>0,ssrc:1000+clients.size}),Buffer.alloc(40,1))),20));
    clients.set(user,c);return c;
  }
  try{
    for(const u of ['alice','bob','carol']){client(u);await sfu.signal('call',u,{join:true});await new Promise(r=>setTimeout(r,400));}
    await new Promise(r=>setTimeout(r,5000));
    for(const c of clients.values()){
      const others=[...clients.keys()].filter(u=>u!==c.user);
      for(const o of others)assert.ok((c.received.get(o)||0)>50,`${c.user} hears ${o}: ${c.received.get(o)}`);
      assert.equal(c.received.get(c.user),undefined);
    }
    assert.deepEqual(sfu.participants('call').sort(),['alice','bob','carol']);
    sfu.leave('call','bob');await new Promise(r=>setTimeout(r,800));
    const before=clients.get('alice').received.get('bob');await new Promise(r=>setTimeout(r,1500));
    assert.ok(clients.get('alice').received.get('bob')-before<5);
    sfu.end('call');assert.deepEqual(sfu.participants('call'),[]);
  }finally{timers.forEach(clearInterval);for(const c of clients.values())await c.pc.close().catch(()=>{});}
});
