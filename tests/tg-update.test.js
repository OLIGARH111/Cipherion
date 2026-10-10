import test from 'node:test';import assert from 'node:assert/strict';
import {describeAgent,activityText} from '../public/devices.js';
import {vipBadge} from '../public/ui.js';
test('devices list shows readable names instead of raw user agents',()=>{
  assert.deepEqual(describeAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'),{type:'mobile',model:'iPhone',os:'iOS 17.4',app:'Safari 17'});
  assert.deepEqual(describeAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0'),{type:'desktop',model:'Компьютер Windows',os:'Windows 10/11',app:'Edge 128'});
  assert.equal(describeAgent('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36').model,'Android-смартфон');
  assert.equal(describeAgent('').model,'Неизвестное устройство');
  const now=Date.parse('2026-10-10T12:00:00');assert.equal(activityText(now-30000,now),'в сети');assert.equal(activityText(now-5*60000,now),'5 мин. назад');
});
test('default VIP badge is the word VIP, other badges stay emoji',()=>{
  assert.match(vipBadge({vip:true,vipBadge:'✦'}),/vip-text"[^>]*>VIP</);
  assert.match(vipBadge({vip:true,vipBadge:'💎'}),/>💎</);
});
