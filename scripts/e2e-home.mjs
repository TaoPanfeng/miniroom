import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const output = new URL('../e2e-output/', import.meta.url);
mkdirSync(output, { recursive: true });
const exe = ['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser']
  .find(path => existsSync(path));
if (!exe) throw new Error('Runner does not have Chrome / Chromium installed.');
const host='http://127.0.0.1:18765/';
const server=spawn(process.execPath, ['scripts/serve.mjs','--port','18765'], {stdio:['ignore','pipe','pipe']});
let serverLog='';
server.stdout.on('data',value=>{serverLog+=String(value);});
server.stderr.on('data',value=>{serverLog+=String(value);});
let browser;
const passed = message => console.log('PASS: '+message);
try {
  let reachable=false;
  for(let n=0;n<60;n++){
    try{const result=await fetch(host);if(result.ok){reachable=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,120));
  }
  assert.ok(reachable, 'Static server did not start: '+serverLog);
  browser=await chromium.launch({
    executablePath:exe,
    headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']
  });
  const context=await browser.newContext({viewport:{width:1440,height:860},acceptDownloads:true});
  const page=await context.newPage();
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  const picker=page.locator('#roomPickerDialog');
  async function enter(name){
    await page.locator('#roomSwitcherBtn').click();
    await picker.locator('[data-room-choice="'+name+'"]').click();
    await page.locator('#'+(name==='home'?'homeRoomView':name==='study'?'studyRoomView':'galleryRoomView')).waitFor({state:'visible',timeout:18000});
  }
  await page.goto(host,{waitUntil:'domcontentloaded'});
  await page.locator('.home-loading').waitFor({state:'hidden',timeout:20000});
  assert.equal(await page.locator('.home-error').isVisible(),false,'Home model displayed an error');
  assert.equal(await page.locator('#homeRoomView').isVisible(),true);
  assert.equal(await page.locator('#studyRoomView').isVisible(),false);
  assert.equal(await page.locator('#galleryRoomView').isVisible(),false);
  assert.equal(await page.locator('#roomSwitcherBtn').getAttribute('aria-label'),'切换小屋，当前在我的家');
  assert.equal(await page.locator('[data-room-choice]').count(),3);
  passed('home is the default; only the centered home is visible');
  await page.locator('[data-home-tool="top"]').click();
  await page.locator('[data-home-tool="walls"]').click();
  assert.equal(await page.locator('[data-home-tool="walls"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-home-tool="walls"]').click();
  assert.equal(await page.locator('[data-home-tool="walls"]').getAttribute('aria-pressed'),'false');
  await page.locator('[data-home-tool="reset"]').click();
  await page.locator('.home-tip').waitFor({state:'hidden',timeout:7000});
  await page.screenshot({path:new URL('home-desktop.png',output).pathname});
  passed('home camera tools and cutaway toggle');

  await enter('study');
  await page.locator('#loadingIndicator').waitFor({state:'hidden',timeout:20000});
  assert.equal(await page.locator('#sceneError').isVisible(),false,'Study rendered an error');
  await page.locator('#quickNotesBtn').click();
  await page.locator('#bookTitleInput').fill('户型验收测试');
  await page.locator('#noteInput').fill('回到书房，笔记应该保留。');
  await page.locator('#saveNotesBtn').click();
  passed('existing study opens and notes can be saved');

  await enter('gallery');
  await page.locator('.gw-loading').waitFor({state:'hidden',timeout:18000});
  const testImage = new URL('../assets/default-photo.webp',import.meta.url).pathname;
  await page.locator('.gw-file-input').setInputFiles([testImage,testImage]);
  await page.waitForFunction(()=>document.querySelector('.gw-all-count')?.textContent==='2',null,{timeout:25000});
  assert.equal(await page.locator('.gw-item').count(),2);
  await page.locator('.gw-card-open').first().click();
  await page.locator('.gw-viewer-close').click();
  await page.locator('.gw-select-toggle').click();
  await page.locator('.gw-check input').first().check();
  await page.locator('.gw-crop-selection').click();
  await page.locator('.crop-dialog').waitFor({state:'visible',timeout:15000});
  await page.locator('.crop-cancel').click();
  await page.locator('.crop-dialog').waitFor({state:'detached'});
  passed('gallery batch import, photo preview and crop cancellation');

  await page.locator('.gw-storage-manage').click();
  await page.locator('[data-sm-scope="gallery"]').click();
  await page.locator('.sm-cancel').click();
  assert.equal(await page.locator('.gw-all-count').textContent(),'2');
  await page.locator('[data-sm-scope="gallery"]').click();
  await page.locator('.sm-accept').click();
  await page.waitForFunction(()=>document.querySelector('.gw-all-count')?.textContent==='0',null,{timeout:15000});
  await page.locator('.sm-close').click();
  passed('cleanup cancellation leaves originals, confirmed photo-room cleanup removes local copies');

  await enter('study');
  await page.locator('#quickNotesBtn').click();
  assert.equal(await page.locator('#noteInput').inputValue(),'回到书房，笔记应该保留。');
  await page.locator('#booksDialog [data-close]').click();
  await enter('home');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('.home-loading').waitFor({state:'hidden',timeout:20000});
  assert.equal(await page.locator('#homeRoomView').isVisible(),true);
  assert.equal(await page.locator('#studyRoomView').isVisible(),false);
  passed('room switches preserve existing study data; reload defaults home');

  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:new URL('home-mobile.png',output).pathname});
  const sizes=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:window.innerWidth}));
  assert.ok(sizes.width<=sizes.viewport+3,'Horizontal overflow on mobile: '+JSON.stringify(sizes));
  assert.ok(await page.locator('[data-home-tool="reset"]').isVisible(),'Home controls missing on mobile');
  passed('390px mobile viewport fits and keeps controls available');

  assert.deepEqual(pageErrors,[],'Browser runtime errors: '+pageErrors.join('; '));
  passed('no uncaught browser errors');
  await context.close();
} finally {
  try{await browser?.close();}catch{}
  server.kill('SIGTERM');
}
