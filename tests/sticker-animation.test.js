import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {normalizeStickerAnimation} from '../server/sticker-animation.js';
test('animation is normalized to bounded WebP with a static PNG poster',{skip:spawnSync('ffmpeg',['-version']).status!==0},async()=>{const dir=await mkdtemp(join(tmpdir(),'sticker-anim-'));try{const gif=join(dir,'input.gif'),out=join(dir,'sticker');const fixture=spawnSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','testsrc=size=64x64:rate=8','-t','1','-y',gif]);assert.equal(fixture.status,0,fixture.stderr.toString());await normalizeStickerAnimation(gif,out,'image/gif');const bytes=await readFile(out),poster=await readFile(out+'.png');assert.equal(bytes.toString('ascii',8,12),'WEBP');assert.ok(bytes.length<2*1024*1024);assert.equal(poster.subarray(0,8).toString('hex'),'89504e470d0a1a0a');}finally{await rm(dir,{recursive:true,force:true});}});
