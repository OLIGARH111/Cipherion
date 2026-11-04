// The browser side of a call through the server's SFU (server/sfu.js): one RTCPeerConnection to the
// server. The server always makes the offers: its first offer has two sections for our own audio
// and video, every other section brings one track of another participant, whose user id is the
// stream id. So this side only answers and never has to resolve offer collisions.
export function createSfuLink({iceServers,relayOnly=false,local,send,onTrack,onState=()=>{},debug=()=>{}}){
  const pc=new RTCPeerConnection({iceServers,iceTransportPolicy:relayOnly?'relay':'all',bundlePolicy:'max-bundle',rtcpMuxPolicy:'require'});
  let own=null,closed=false,queue=Promise.resolve(),pending=[];
  pc.onicecandidate=({candidate})=>{if(candidate&&!closed)send({candidate}).catch(()=>{});};
  pc.onconnectionstatechange=()=>{debug('sfu connection',pc.connectionState);onState(pc.connectionState);};
  pc.ontrack=({track,streams})=>{const owner=streams[0]?.id;if(!owner||!own)return;onTrack(owner,streams[0],track);};
  async function attachOwn(){
    // The first two sections (by mid order) are ours to send.
    const list=pc.getTransceivers();const audio=list.find(t=>t.receiver.track.kind==='audio'),video=list.find(t=>t.receiver.track.kind==='video');
    own={audio,video};
    for(const [t,kind] of [[audio,'audio'],[video,'video']]){if(!t)continue;t.direction='sendonly';const track=local().getTracks().find(x=>x.kind===kind&&x.readyState==='live')||null;await t.sender.replaceTrack(track);}
  }
  async function handle(signal){
    queue=queue.then(async()=>{
      if(closed)return;
      if(signal.description?.type==='offer'){
        await pc.setRemoteDescription(signal.description);
        if(!own)await attachOwn();
        await pc.setLocalDescription(await pc.createAnswer());
        await send({description:pc.localDescription});
        for(const c of pending.splice(0))await pc.addIceCandidate(c).catch(()=>{});
      }else if(signal.candidate){if(pc.remoteDescription)await pc.addIceCandidate(signal.candidate).catch(()=>{});else pending.push(signal.candidate);}
    }).catch(error=>debug('sfu signal',error.message));
    return queue;
  }
  return {
    pc,handle,
    join:()=>send({join:true}),
    // A camera switched on later travels in our own video section; no renegotiation needed.
    setTrack:async(kind,track)=>{const t=own?.[kind];if(t)await t.sender.replaceTrack(track);},
    keyframe:()=>send({keyframe:true}).catch(()=>{}),
    close:()=>{closed=true;pc.close();}
  };
}
