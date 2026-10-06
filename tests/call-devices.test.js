import test from 'node:test';
import assert from 'node:assert/strict';
import {replaceCallTracks} from '../public/calls.js';
const track=(kind,enabled=true)=>({kind,enabled,stopped:false,stop(){this.stopped=true;}});
const stream=tracks=>({getTracks:()=>tracks.slice(),addTrack:t=>tracks.push(t),removeTrack:t=>tracks.splice(tracks.indexOf(t),1)});
const peer=(audio,video,rejectVideo=false)=>{
 const senders=[audio,video].map(t=>({track:t,async replaceTrack(next){if(rejectVideo&&next!==video&&next.kind==='video')throw Error('Camera rejected');this.track=next;}}));
 return {pc:{getSenders:()=>senders}};
};
test('changing call devices preserves mute and disabled camera on every peer',async()=>{
 const a=track('audio',false),v=track('video',false),nextA=track('audio'),nextV=track('video');
 const local=stream([a,v]),peers=new Map([['a',peer(a,v)],['b',peer(a,v)]]);
 await replaceCallTracks(local,peers,stream([nextA,nextV]));
 assert.equal(nextA.enabled,false);assert.equal(nextV.enabled,false);
 assert.deepEqual(local.getTracks(),[nextA,nextV]);assert.ok(a.stopped&&v.stopped);
 for(const p of peers.values())assert.deepEqual(p.pc.getSenders().map(s=>s.track),[nextA,nextV]);
});
test('a rejected device change restores previous senders and releases new microphone/camera',async()=>{
 const a=track('audio',false),v=track('video'),nextA=track('audio'),nextV=track('video');
 const local=stream([a,v]),peers=new Map([['a',peer(a,v)],['b',peer(a,v,true)]]);
 await assert.rejects(replaceCallTracks(local,peers,stream([nextA,nextV])),/Camera rejected/);
 assert.deepEqual(local.getTracks(),[a,v]);assert.equal(a.stopped,false);assert.equal(v.stopped,false);
 assert.ok(nextA.stopped&&nextV.stopped);
 for(const p of peers.values())assert.deepEqual(p.pc.getSenders().map(s=>s.track),[a,v]);
});
