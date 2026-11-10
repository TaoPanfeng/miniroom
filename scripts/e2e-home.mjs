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
  const homeCanvas=page.locator('.home-canvas');
  const sceneMode=await homeCanvas.getAttribute('data-camera-mode');
  if(sceneMode==='inside'){
    assert.equal(await homeCanvas.getAttribute('data-roof-visible'),'true','Indoor mode must have a sealed roof');
    const initialPosition=await homeCanvas.getAttribute('data-position');
    assert.ok(initialPosition?.startsWith('0.53,3.83'),'Default perspective must begin at entrance: '+initialPosition);
    await homeCanvas.focus();
    await page.keyboard.down('w');
    const didWalk=await page.waitForFunction((first)=>{
      const canvas=document.querySelector('.home-canvas');
      return canvas?.dataset.position && canvas.dataset.position!==first;
    },initialPosition,{timeout:4500}).then(()=>true,()=>false);
    const movementDiagnostics=await page.evaluate(()=>({
      position:document.querySelector('.home-canvas')?.dataset.position,
      frames:document.querySelector('.home-canvas')?.dataset.renderFrames,
      key:document.querySelector('.home-canvas')?.dataset.pressedKeys,
      mode:document.querySelector('.home-canvas')?.dataset.cameraMode,
      activeRoom:document.body.dataset.room
    }));
    await page.keyboard.up('w');
    assert.ok(didWalk,'W should move the viewer inside the corridor; debug '+JSON.stringify(movementDiagnostics));
    await page.locator('[data-home-tool="reset"]').click();
    assert.equal(await homeCanvas.getAttribute('data-position'),initialPosition,'Entrance reset must restore the same coordinates');
    await page.locator('[data-home-tool="roof"]').click();
    assert.equal(await homeCanvas.getAttribute('data-roof-visible'),'false','Roof toggle should hide ceiling');
    await page.locator('[data-home-tool="roof"]').click();
    assert.equal(await homeCanvas.getAttribute('data-roof-visible'),'true','Roof toggle should restore ceiling');
    passed('true entrance-eye perspective, roof presence and visibility, walk controls and reset');
  } else {
    assert.equal(await page.locator('.home-compat').isVisible(),true,'Expected Canvas fallback if WebGL unavailable');
    passed('CI graphics uses fallback; independent forced-WebGL-off checks below');
  }
  await page.locator('[data-home-tool="whole"]').click();
  if(sceneMode==='inside'){
    await page.waitForTimeout(1350);
    const drawCalls=Number(await homeCanvas.getAttribute('data-draw-calls'));
    assert.ok(Number.isFinite(drawCalls)&&drawCalls>0&&drawCalls<270,
      'Draw calls remain unexpectedly high after batching: '+drawCalls);
    const firstFrame=Number(await homeCanvas.getAttribute('data-render-frames'));
    await page.waitForTimeout(700);
    const nextFrame=Number(await homeCanvas.getAttribute('data-render-frames'));
    assert.ok(nextFrame-firstFrame<8,'Idle scene keeps rendering: '+(nextFrame-firstFrame)+' frames/700ms');
    passed('batched draw calls '+drawCalls+' and idle animation loop sleeps ('+(nextFrame-firstFrame)+' frames/700ms)');
  }
  await page.locator('[data-home-tool="top"]').click();
  await page.locator('[data-home-tool="walls"]').click();
  assert.equal(await page.locator('[data-home-tool="walls"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-home-tool="walls"]').click();
  assert.equal(await page.locator('[data-home-tool="walls"]').getAttribute('aria-pressed'),'false');
  await page.locator('[data-home-tool="reset"]').click();
  await page.locator('.home-tip').waitFor({state:'hidden',timeout:7000});
  await page.screenshot({path:new URL('home-desktop.png',output).pathname});
  passed('home camera tools and cutaway toggle');

  await page.locator('[data-home-tool="rooms"]').click();
  assert.equal(await page.locator('.home-room-nav').isVisible(),true,'Room navigation did not open');
  assert.equal(await page.locator('[data-home-focus]').count(),9);
  await page.locator('[data-home-focus="master"]').click();
  assert.equal(await page.locator('#homeRoomView').getAttribute('data-focus'),'master');
  assert.equal(await page.locator('.home-room-nav').isVisible(),false);
  await page.locator('[data-home-tool="rooms"]').click();
  await page.locator('[data-home-focus="loft"]').click();
  assert.equal(await page.locator('#homeRoomView').getAttribute('data-focus'),'loft');
  await page.waitForTimeout(1050);
  await page.screenshot({path:new URL('home-loft.png',output).pathname});
  await page.locator('[data-home-tool="top"]').click();
  assert.equal(await page.locator('#homeRoomView').getAttribute('data-focus'),null,'Top view must clear stale room focus');
  await page.locator('[data-home-tool="rooms"]').click();
  await page.locator('[data-home-focus="all"]').click();
  assert.equal(await page.locator('#homeRoomView').getAttribute('data-focus'),null);
  await page.locator('[data-home-tool="rooms"]').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.home-room-nav').isVisible(),false);
  passed('8 room inspection targets including pull-up loft, focus reset and Escape close');
  if(sceneMode==='inside'){
    await page.locator('[data-home-tool="rooms"]').click();
    await page.locator('[data-home-focus="bathroom"]').click();
    assert.equal(await homeCanvas.getAttribute('data-camera-mode'),'inside');
    assert.equal(await homeCanvas.getAttribute('data-roof-visible'),'true');
    await page.screenshot({path:new URL('home-inside-bathroom.png',output).pathname});
    await page.locator('[data-home-tool="rooms"]').click();
    await page.locator('[data-home-focus="living"]').click();
    await page.screenshot({path:new URL('home-inside-living.png',output).pathname});
    await page.locator('[data-home-tool="reset"]').click();
    passed('living room and bathroom have actual eye-height interior standing positions');
  }

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
  if(sceneMode==='inside')assert.ok(await page.locator('[data-home-move="KeyW"]').isVisible(),'Touch movement pad missing');
  passed('390px mobile viewport fits and keeps controls available');
  await page.locator('[data-home-tool="rooms"]').click();
  assert.ok(await page.locator('.home-room-nav').isVisible(),'Room navigation invisible on mobile');
  const mobilePanel=await page.locator('.home-room-nav').boundingBox();
  assert.ok(mobilePanel && mobilePanel.x>=-2 && mobilePanel.x+mobilePanel.width<=393,'Mobile navigation overflows viewport');
  await page.locator('[data-home-focus="kitchen"]').click();
  assert.equal(await page.locator('#homeRoomView').getAttribute('data-focus'),'kitchen');
  await page.locator('[data-home-tool="reset"]').click();
  passed('mobile room navigation fits and focuses correctly');

  // 不支持 WebGL 的设备仍能查看户型，并且「俯视」真的切换投影。
  const fallbackContext=await browser.newContext({viewport:{width:1090,height:740}});
  await fallbackContext.addInitScript(()=>{
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(kind,...args) {
      if(['webgl','webgl2','experimental-webgl'].includes(kind))return null;
      return original.call(this,kind,...args);
    };
  });
  const fallbackPage=await fallbackContext.newPage();
  const fallbackErrors=[];
  fallbackPage.on('pageerror',error=>fallbackErrors.push(error.message));
  await fallbackPage.goto(host,{waitUntil:'domcontentloaded'});
  await fallbackPage.locator('.home-loading').waitFor({state:'hidden',timeout:20000});
  assert.equal(await fallbackPage.locator('.home-error').isVisible(),false,'Canvas fallback failed');
  assert.equal(await fallbackPage.locator('.home-compat').isVisible(),true,'Canvas fallback badge missing');
  await fallbackPage.locator('[data-home-tool="top"]').click();
  await fallbackPage.locator('[data-home-tool="rooms"]').click();
  await fallbackPage.locator('[data-home-focus="loft"]').click();
  assert.equal(await fallbackPage.locator('#homeRoomView').getAttribute('data-focus'),'loft');
  await fallbackPage.screenshot({path:new URL('home-canvas-fallback.png',output).pathname});
  assert.deepEqual(fallbackErrors,[],'Canvas fallback runtime errors: '+fallbackErrors.join('; '));
  await fallbackContext.close();
  passed('WebGL-disabled Chrome uses functional 2D top view and room highlighting');

  assert.deepEqual(pageErrors,[],'Browser runtime errors: '+pageErrors.join('; '));
  passed('no uncaught browser errors');
  await context.close();
} finally {
  try{await browser?.close();}catch{}
  server.kill('SIGTERM');
}
