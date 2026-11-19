import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  DARK_DEFAULTS,DARK_CYCLES,DARK_GLOWS,DARK_SETTINGS_KEY,normalizeDarkSettings
} from '../src/dark-room.js';

assert.equal(DARK_SETTINGS_KEY,'miniroom-dark-room-v1');
assert.deepEqual(normalizeDarkSettings(null),DARK_DEFAULTS);
assert.deepEqual(normalizeDarkSettings({
  mode:'black',speed:'fast',intensity:'visible',autoHide:false
}),{mode:'black',speed:'fast',intensity:'visible',autoHide:false});
assert.deepEqual(normalizeDarkSettings({
  mode:'invalid',speed:'invalid',intensity:'white',autoHide:'false'
}),DARK_DEFAULTS);
assert.equal(DARK_DEFAULTS.mode,'fade');
assert.equal(DARK_DEFAULTS.intensity,'barely');
assert.equal(DARK_DEFAULTS.autoHide,true);
assert.deepEqual(DARK_CYCLES,{slow:31,medium:20,fast:12});
for(const [level,rgba] of Object.entries(DARK_GLOWS)){
  const match=/^rgba\((\d+), (\d+), (\d+), \.(\d+)\)$/.exec(rgba);
  assert.ok(match,'Invalid rgba for '+level);
  const [r,g,b,alpha]=match.slice(1).map(Number);
  assert.ok(Math.max(r,g,b)<16,'Dark peak unexpectedly bright for '+level);
  assert.ok(alpha>0&&alpha<100,'Opacity must stay fractional in '+level);
}
const css=await readFile(new URL('../assets/dark-room.css',import.meta.url),'utf8');
assert.match(css,/body\[data-room="dark"\][\s\S]*?background:#000!important/);
assert.match(css,/0%,12\.9%,100%\{opacity:0\}/);
assert.match(css,/51\.6%,61\.3%\{opacity:1\}/);
assert.match(css,/data-mode="black"\][\s\S]*?opacity:0!important/);
assert.ok(!/rgb\(255|#fff(?:fff)?|#ffffff/.test(css),'Full-white visuals are not permitted');
console.log('PASS: black room defaults, near-black peaks, 12/20/31-second cyclic dimming and true #000 mode');
