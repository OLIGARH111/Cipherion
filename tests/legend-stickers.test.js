import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';

test('legendary «Сифа» pack: every sticker animates and has a still poster',async()=>{
 const {sifa}=JSON.parse(await readFile('public/stickers-v4/packs.json','utf8'));
 assert.equal(sifa.length,16);
 for(const [n,{label,emoji}]of sifa.entries()){
  assert.ok(label&&emoji);
  const name='public/stickers-v4/sifa-'+String(n).padStart(2,'0');
  const animated=await readFile(name+'.svg','utf8'),still=await readFile(name+'-still.svg','utf8');
  assert.match(animated,/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 512 512">/);
  assert.match(animated,/@keyframes/);assert.doesNotMatch(animated,/<script|href=/i);
  assert.match(still,/\*\{animation:none!important\}/);await access(name+'-still.svg');
 }
});

test('chat list has a search button next to the pencil and no folders',async()=>{
 const app=await readFile('public/app.js','utf8');
 assert.match(app,/id="open-search"[^]*id="new-chat"/);
 assert.match(app,/id="side-search" hidden/);
 assert.doesNotMatch(app,/folderTabs|manage-folders|data-filter|Непрочитанные/);
 assert.doesNotMatch(await readFile('public/extensions.js','utf8'),/foldersPage/);
});
