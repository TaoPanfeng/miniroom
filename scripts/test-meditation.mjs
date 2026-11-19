import assert from 'node:assert/strict';
import { parseCron, nextCronTime, formatElapsed, speakElapsed, intervalNextElapsed } from '../src/meditation-cron.js';

const at=(y,m,d,h,minute,second=0)=>new Date(y,m-1,d,h,minute,second).getTime();
const next=(expr,after)=>nextCronTime(parseCron(expr),after);
assert.equal(next('*/5 * * * *',at(2026,11,19,10,2,45)),at(2026,11,19,10,5));
assert.equal(next('*/5 * * * *',at(2026,11,19,10,5,0)),at(2026,11,19,10,10));
assert.equal(next('0 */5 * * * ?',at(2026,11,19,10,2,5)),at(2026,11,19,10,5));
assert.equal(next('*/10 * * * * *',at(2026,11,19,10,2,3)),at(2026,11,19,10,2,10));
assert.equal(next('*/10 * * * * *',at(2026,11,19,10,2,10)),at(2026,11,19,10,2,20));
assert.equal(next('0 0 8 * * 1-5',at(2026,11,19,9,0)),at(2026,11,20,8,0));
assert.equal(next('0 0 8 13 * 1',at(2026,11,12,9,0)),at(2026,11,13,8,0));
assert.equal(next('0 0 8 * * 7',at(2026,11,15,7,30)),at(2026,11,15,8,0));
assert.equal(next('0 0 0 1 1 *',at(2026,1,1,0,10)),at(2027,1,1,0,0));
assert.equal(next('0 0 0 31 2 *',at(2026,11,19,8,0)),null);
assert.deepEqual(parseCron('5-10/2 8,9 * * *').minutes,[5,7,9]);
assert.equal(parseCron('0 0 * * * ?').withSeconds,true);
for(const bad of ['* * * *','* * * * * * *','61 * * * *','*/0 * * * *',
  '0 0 * * MON','0 0 12 L * ?','0 0 0 * ? *']){
  assert.throws(()=>parseCron(bad),'Expected invalid cron to fail: '+bad);
}
assert.equal(formatElapsed(65_999),'00:01:05');
assert.equal(formatElapsed(3_661_000),'01:01:01');
assert.equal(speakElapsed(5*60_000),'从冥想开始，已经过了5分钟。');
assert.equal(speakElapsed(10_000),'从冥想开始，已经过了10秒。');
assert.equal(intervalNextElapsed(120_000,5),300_000);
assert.equal(intervalNextElapsed(300_000,5),600_000);
assert.throws(()=>intervalNextElapsed(0,0));
console.log('PASS: meditation Cron (5/6 fields, seconds, DOM/DOW, ranges, timezone-local), elapsed speech, intervals, validation');
