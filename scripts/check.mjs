import { readFile, readdir, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const errors = [];
const files = [];
async function collect(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const name = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) await collect(name);
    else if (/\.(?:js|mjs)$/.test(name)) files.push(name);
  }
}
for (const directory of ['src', 'vendor', 'scripts']) await collect(directory);
for (const file of files) {
  const checked = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (checked.status !== 0) errors.push(`${file}: ${checked.stderr}`);
}

const html = await readFile(path.join(root, 'index.html'), 'utf8');
const importMapText = html.match(/<script\s+type="importmap"[^>]*>([\s\S]*?)<\/script>/)?.[1];
const imports = importMapText ? JSON.parse(importMapText).imports : {};
async function checkReference(reference, from) {
  if (/^(?:data:|#)/.test(reference)) return;
  if (/^(?:https?:|\/\/)/.test(reference)) {
    errors.push(`${from}: runtime resource must be local: ${reference}`);
    return;
  }
  const mapped = imports[reference];
  const target = mapped
    ? path.resolve(root, mapped)
    : path.resolve(root, path.dirname(from), reference.split(/[?#]/)[0]);
  if (!target.startsWith(root + path.sep)) errors.push(`${from}: invalid resource path ${reference}`);
  else {
    try { await access(target); }
    catch { errors.push(`${from}: missing resource ${reference}`); }
  }
}
for (const match of html.matchAll(/<(?:script|link|img)\b[^>]*\b(?:src|href)="([^"]+)"/g)) {
  await checkReference(match[1], 'index.html');
}
for (const reference of Object.values(imports)) await checkReference(reference, 'index.html');
for (const file of files.filter((name) => !name.startsWith('scripts/'))) {
  // 官方附加模块注释里含 npm 导入示例，不把注释当作实际依赖。
  const source = (await readFile(path.join(root, file), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of source.matchAll(/\b(?:from\s*|import\s*\()(['"])([^'"\n]+)\1/g)) {
    await checkReference(match[2], file);
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log(`Checked ${files.length} JavaScript files; all runtime imports and HTML resources are local and present.`);


// 户型与入口基本契约：部署前检查约 50㎡、房间不重叠、三入口均在。
const { HOME_PLAN, HOME_ROOMS, HOME_FOCUS, homeArea, roomAt } = await import('../src/home-layout.js');
const totalArea = HOME_ROOMS.reduce((sum, key) => sum + homeArea(key), 0);
if (totalArea < 45 || totalArea > 58) errors.push('Home area estimate outside expected 50 m² range: ' + totalArea);
for (let i=0;i<HOME_ROOMS.length;i++) for(let j=i+1;j<HOME_ROOMS.length;j++){
  const a=HOME_PLAN[HOME_ROOMS[i]], b=HOME_PLAN[HOME_ROOMS[j]];
  const iw=Math.min(a.x2,b.x2)-Math.max(a.x1,b.x1);
  const ih=Math.min(a.z2,b.z2)-Math.max(a.z1,b.z1);
  if(iw>1e-6&&ih>1e-6)errors.push('Home rooms overlap: '+HOME_ROOMS[i]+' / '+HOME_ROOMS[j]);
}
for(const room of ['home','study','gallery']){
  if(!html.includes('data-room-choice="'+room+'"'))errors.push('Missing room picker choice: '+room);
}
if(!html.includes('id="homeRoomView"'))errors.push('Missing home view container');
for (const [key, spot] of Object.entries(HOME_FOCUS)) {
  if (!HOME_PLAN[spot.room]) errors.push('Unknown focus room: ' + key);
  if (roomAt(spot.x,spot.z) !== spot.room) errors.push('Focus outside expected room: ' + key);
  if (!Number.isFinite(spot.y) || spot.y < 0 || spot.y > 3) errors.push('Invalid focus height: ' + key);
  if (!Number.isFinite(spot.zoom) || spot.zoom < 1 || spot.zoom > 2.5) errors.push('Invalid focus zoom: ' + key);
}
if (Object.keys(HOME_FOCUS).length !== 8) errors.push('Expected 7 room focuses and 1 loft focus');
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
else console.log('Home layout verified: '+HOME_ROOMS.length+' rooms, ~'+totalArea.toFixed(1)+' m²; 3 room choices.');
