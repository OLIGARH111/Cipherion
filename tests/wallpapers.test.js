import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validWallpaper, validateWallpaperSettings, cleanSpec } from '../server/wallpapers.js';

test('chat wallpapers: only small, well-formed values are stored',()=>{
  assert.ok(validWallpaper('/api/media/abc-123'));
  assert.ok(validWallpaper({kind:'preset',id:'aurora',dim:.3}));
  assert.ok(validWallpaper({kind:'photo',src:'/api/media/x1'}));
  assert.ok(!validWallpaper({kind:'photo',src:'https://evil.example/a.png'}));
  assert.ok(!validWallpaper({kind:'preset',id:'nope'}));
  assert.ok(!validWallpaper({kind:'preset',id:'aurora',dim:2}));
  const ai=cleanSpec({name:'  Неон  ',motif:'flow',colors:['#00E5FF','#111111','#222222','#333333'],seed:42.7});
  assert.deepEqual(ai,{kind:'ai',name:'Неон',motif:'flow',colors:['#00e5ff','#111111','#222222','#333333'],seed:42});
  assert.ok(validWallpaper(ai));
  assert.equal(cleanSpec({motif:'flow',colors:['red','#111111']}),null);
  assert.equal(cleanSpec({motif:'<svg>',colors:['#000000','#111111']}),null);
  assert.equal(validateWallpaperSettings({chatWallpapers:{c1:ai,c2:{kind:'preset',id:'neon'}},aiWallpapers:[ai]}),null);
  assert.ok(validateWallpaperSettings({chatWallpapers:{c1:{kind:'ai',motif:'flow',colors:['#000000','#111111'],seed:1,name:'x',extra:'y'.repeat(500)}}}));
  assert.ok(validateWallpaperSettings({aiWallpapers:Array(13).fill(ai)}));
  // A legacy wallpaper stays accepted until the person changes it.
  assert.equal(validateWallpaperSettings({wallpaper:'legacy'},{wallpaper:'legacy'}),null);
  assert.ok(validateWallpaperSettings({wallpaper:'javascript:alert(1)'},{}));
});
