import assert from 'node:assert/strict';
import {bundGridFor,validateBundYear,BUND_MAX_PHOTOS,BUND_DB_NAME} from '../src/bund-store.js';

assert.equal(BUND_MAX_PHOTOS,100);
assert.equal(BUND_DB_NAME,'miniroom-bund-memories-v1');
for(const n of [0,1,2,3,4,5,9,10,16,36,49,64,81,99,100]){
  const {columns,rows}=bundGridFor(n);
  assert.ok(columns>=1&&columns<=10,'columns limit violated for '+n);
  assert.ok(rows>=1&&rows<=10,'rows limit violated for '+n);
  assert.ok(columns*rows>=n,'capacity too small for '+n);
}
assert.deepEqual(bundGridFor(1),{columns:1,rows:1});
assert.deepEqual(bundGridFor(2),{columns:2,rows:1});
assert.deepEqual(bundGridFor(4),{columns:2,rows:2});
assert.deepEqual(bundGridFor(100),{columns:10,rows:10});
assert.throws(()=>bundGridFor(101),/100/);
assert.throws(()=>bundGridFor(-1));
assert.throws(()=>bundGridFor(2.5));
assert.equal(validateBundYear(2008),2008);
assert.throws(()=>validateBundYear(1972),/1990/);
assert.throws(()=>validateBundYear('abc'),/1990/);
assert.throws(()=>validateBundYear(3000),/1990/);
console.log('PASS: Bund yearly photo wall grid 1-100, 10x10 cap, portrait photo year validation');
