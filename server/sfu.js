// Selective forwarding unit for group calls and voice rooms. Without it every participant sends
// their audio and video to every other participant, which stops working beyond ~6 people. Here each
// participant keeps one WebRTC connection to the server; the server receives their tracks once and
// forwards the RTP packets to everyone else without decoding them.
//
// Negotiation is always offered by the server, so the two sides never race with offers: the first
// offer has one audio and one video section for the participant's own media, and every forwarded
// track of another participant adds a send-only section (its stream id is that person's user id).
//
// Media passes through the server unencrypted at the RTP level (DTLS-SRTP ends here), unlike a
// direct call. The SFU needs UDP reachability: a public address (SFU_PUBLIC_IP + SFU_PORT_MIN/MAX)
// or a TURN server the process can allocate on.
import {RTCPeerConnection,MediaStream,MediaStreamTrack,useOPUS,useVP8,useNACK,usePLI,useREMB,useSdesMid} from 'werift';

export function sfuOptions(env=process.env){
  const min=Number(env.SFU_PORT_MIN),max=Number(env.SFU_PORT_MAX);
  return {
    icePortRange:Number.isInteger(min)&&Number.isInteger(max)&&min>1024&&max>=min?[min,max]:undefined,
    iceAdditionalHostAddresses:env.SFU_PUBLIC_IP?[env.SFU_PUBLIC_IP]:undefined,
    maxParticipants:Math.min(100,Math.max(2,Number(env.SFU_MAX_PARTICIPANTS)||30))
  };
}
// werift understands plain turn:/stun: URLs; transport hints are dropped and TLS-only servers skipped.
export function sfuIceServers(list=[]){
  const out=[];
  for(const s of list){
    const urls=[s?.urls].flat().filter(u=>typeof u==='string').map(u=>u.replace(/\?.*$/,'')).filter(u=>/^(stun|turn):/.test(u));
    for(const url of [...new Set(urls)])out.push({urls:url,...(s.username?{username:s.username,credential:s.credential}:{})});
  }
  return out.slice(0,6);
}

export function createSFU({iceServers=async()=>[],send,log=()=>{},onFailed=()=>{},options=sfuOptions()}={}){
  const rooms=new Map();
  const room=id=>{if(!rooms.has(id))rooms.set(id,new Map());return rooms.get(id);};
  const codecs={audio:[useOPUS()],video:[useVP8({rtcpFeedback:[useNACK(),usePLI(),useREMB()]})]};
  const headerExtensions={audio:[useSdesMid()],video:[useSdesMid()]};

  function negotiate(peer){
    if(peer.closed)return;
    if(peer.pc.signalingState!=='stable'||peer.offering){peer.again=true;return;}
    clearTimeout(peer.timer);
    // Several changes at once (many tracks of a new participant) become one offer.
    peer.timer=setTimeout(async()=>{
      if(peer.closed)return;peer.offering=true;peer.again=false;
      try{const offer=await peer.pc.createOffer();await peer.pc.setLocalDescription(offer);send(peer.user,peer.call,{description:{type:'offer',sdp:peer.pc.localDescription.sdp}});}
      catch(error){peer.offering=false;log('sfu_offer_failed',error);}
    },40);
  }
  function requestKeyFrame(publisher,track){
    if(track.kind!=='video'||!track.ssrc)return;
    const receiver=publisher.pc.getTransceivers().find(t=>t.receiver?.track===track||t.receiver?.tracks?.includes?.(track))?.receiver;
    receiver?.sendRtcpPLI(track.ssrc).catch(()=>{});
  }
  // Starts forwarding one of the publisher's tracks to the subscriber.
  function forward(subscriber,publisher,track){
    const key=publisher.user+':'+track.kind;
    if(subscriber.closed||subscriber.forwards.has(key))return;
    const out=new MediaStreamTrack({kind:track.kind});
    // The stream id tells the browser whose audio and video this is.
    publisher.stream||=new MediaStream({id:publisher.user});
    const transceiver=subscriber.pc.addTransceiver(out,{direction:'sendonly',streams:[publisher.stream]});
    const subscription=track.onReceiveRtp.subscribe(rtp=>{try{out.writeRtp(rtp);}catch{}});
    subscriber.forwards.set(key,{out,transceiver,stop:()=>subscription.unSubscribe()});
    negotiate(subscriber);
    setTimeout(()=>requestKeyFrame(publisher,track),800).unref?.();
  }
  function unforward(subscriber,publisherId){
    let changed=false;
    for(const [key,f] of subscriber.forwards)if(key.startsWith(publisherId+':')){f.stop();try{f.transceiver.stop();}catch{}subscriber.forwards.delete(key);changed=true;}
    if(changed)negotiate(subscriber);
  }
  async function join(callId,userId){
    const members=room(callId);
    if(members.has(userId))leave(callId,userId);
    if(members.size>=options.maxParticipants)throw Object.assign(new Error('В звонке уже максимум участников'),{status:409});
    const pc=new RTCPeerConnection({iceServers:sfuIceServers(await iceServers(userId)),codecs,headerExtensions,bundlePolicy:'max-bundle',
      ...(options.icePortRange?{icePortRange:options.icePortRange}:{}),...(options.iceAdditionalHostAddresses?{iceAdditionalHostAddresses:options.iceAdditionalHostAddresses}:{})});
    const peer={user:userId,call:callId,pc,tracks:new Map(),forwards:new Map(),closed:false,offering:false,again:false,timer:null};
    members.set(userId,peer);
    pc.addTransceiver('audio',{direction:'recvonly'});pc.addTransceiver('video',{direction:'recvonly'});
    pc.onTrack.subscribe(track=>{
      if(peer.closed)return;peer.tracks.set(track.kind,track);
      for(const other of members.values())if(other!==peer)forward(other,peer,track);
    });
    pc.onIceCandidate.subscribe(candidate=>{if(candidate&&!peer.closed)send(userId,callId,{candidate:candidate.toJSON()});});
    pc.connectionStateChange.subscribe(state=>{if(state==='failed'&&!peer.closed){log('sfu_peer_failed',new Error(userId));onFailed(callId,userId);}});
    for(const other of members.values())if(other!==peer)for(const track of other.tracks.values())forward(peer,other,track);
    negotiate(peer);
    return peer;
  }
  async function signal(callId,userId,data){
    const peer=rooms.get(callId)?.get(userId);
    if(data?.join){await join(callId,userId);return;}
    if(!peer)throw Object.assign(new Error('Сначала подключитесь к серверу звонка'),{status:409});
    if(data.description?.type==='answer'){
      await peer.pc.setRemoteDescription({type:'answer',sdp:String(data.description.sdp)});peer.offering=false;
      if(peer.again)negotiate(peer);
    }else if(data.candidate){await peer.pc.addIceCandidate(data.candidate).catch(()=>{});}
    else if(data.keyframe){for(const other of rooms.get(callId).values())if(other!==peer)for(const t of other.tracks.values())requestKeyFrame(other,t);}
  }
  function leave(callId,userId){
    const members=rooms.get(callId),peer=members?.get(userId);if(!peer)return;
    peer.closed=true;clearTimeout(peer.timer);members.delete(userId);
    for(const f of peer.forwards.values())f.stop();
    for(const other of members.values())unforward(other,userId);
    peer.pc.close().catch?.(()=>{});
    if(!members.size)rooms.delete(callId);
  }
  function end(callId){for(const userId of [...(rooms.get(callId)?.keys()||[])])leave(callId,userId);}
  const participants=callId=>[...(rooms.get(callId)?.keys()||[])];
  return {join,signal,leave,end,participants,maxParticipants:options.maxParticipants};
}
