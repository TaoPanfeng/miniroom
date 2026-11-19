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
    await page.locator('#'+(name==='home'?'homeRoomView':name==='study'?'studyRoomView':name==='gallery'?'galleryRoomView':name==='meditation'?'meditationRoomView':'darkRoomView')).waitFor({state:'visible',timeout:18000});
  }
  await page.goto(host,{waitUntil:'domcontentloaded'});
  await page.locator('#loadingIndicator').waitFor({state:'hidden',timeout:20000});
  assert.equal(await page.locator('#sceneError').isVisible(),false,'Original study scene failed');
  assert.equal(await page.locator('#studyRoomView').isVisible(),true);
  assert.equal(await page.locator('#homeRoomView').isVisible(),false);
  assert.equal(await page.locator('#galleryRoomView').isVisible(),false);
  assert.equal(await page.locator('#roomSwitcherBtn').getAttribute('aria-label'),'切换小屋，当前在书房');
  assert.ok((await page.locator('#photoPreview').getAttribute('src'))?.endsWith('/assets/default-photo.webp'), 'Study default frame should use the bundled Doraemon image');
  assert.equal(await page.locator('[data-room-choice]').count(),5);
  passed('original study with Doraemon frame is the default');
  await enter('home');
  await page.locator('.home-loading').waitFor({state:'hidden',timeout:20000});
  assert.equal(await page.locator('.home-error').isVisible(),false,'Home model displayed an error');
  assert.equal(await page.locator('#homeRoomView').isVisible(),true);
  passed('separate 3D home still opens on demand');
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
    const batchedPieces=Number(await homeCanvas.getAttribute('data-batched-pieces'));
    assert.ok(batchedPieces>=100,'Not enough static furniture got instanced: '+batchedPieces);
    passed('batched draw calls '+drawCalls+', instanced static pieces '+batchedPieces+' and idle animation loop sleeps ('+(nextFrame-firstFrame)+' frames/700ms)');
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

  await enter('meditation');
  await page.screenshot({path:new URL('meditation-desktop.png',output).pathname});
  assert.equal(await page.locator('#meditationRoomView').isVisible(),true);
  assert.equal(await page.locator('#studyRoomView').isVisible(),false);
  assert.equal(await page.locator('.meditation-room canvas').count(),0,'Meditation should not load a 3D renderer');
  assert.equal(await page.locator('.med-elapsed').textContent(),'00:00:00');
  assert.equal(await page.locator('[data-med-schedule="interval"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-med-schedule="cron"]').click();
  await page.locator('#medCron').fill('not a cron');
  assert.equal(await page.locator('.med-cron-validation').getAttribute('data-valid'),'false');
  await page.locator('#medVoice').uncheck();
  await page.locator('#medBell').uncheck();
  await page.locator('#medCron').fill('*/1 * * * * *');
  assert.equal(await page.locator('.med-cron-validation').getAttribute('data-valid'),'true');
  await page.locator('[data-med-action="start"]').click();
  assert.equal(await page.locator('.meditation-room').getAttribute('data-phase'),'running');
  await page.waitForFunction(()=>Number(document.querySelector('.meditation-room')?.dataset.announcements)>=1,null,{timeout:9000});
  assert.match(await page.locator('.med-announcement').textContent(),/从冥想开始，已经过了/);
  await page.locator('[data-med-action="pause"]').click();
  const paused=await page.locator('.med-elapsed').textContent();
  await page.waitForTimeout(1250);
  assert.equal(await page.locator('.med-elapsed').textContent(),paused,'Paused meditation should not advance');
  await page.locator('[data-med-action="start"]').click();
  const resuming=await page.locator('.med-elapsed').textContent();
  await enter('study');
  await page.waitForTimeout(1120);
  await enter('meditation');
  assert.notEqual(await page.locator('.med-elapsed').textContent(),resuming,'Meditation should continue across room switches');
  await page.locator('[data-med-action="finish"]').click();
  assert.equal(await page.locator('.meditation-room').getAttribute('data-phase'),'finished');
  assert.ok((await page.evaluate(()=>localStorage.getItem('miniroom-meditation-preferences-v1')))?.includes('*/1'));
  passed('meditation room Cron validation, timed announcement, pause/resume, voice text, saved config and cross-room continuity');

  await enter('dark');
  const darkView=page.locator('#darkRoomView');
  const darkHaze=page.locator('.dark-haze');
  assert.equal(await darkView.isVisible(),true);
  assert.equal(await page.locator('.dark-room-view canvas, .dark-room-view img').count(),0,
    'Black room must not render images or furniture');
  assert.equal(await page.locator('#studyRoomView').isVisible(),false);
  assert.equal(await page.locator('.dark-room-view').getAttribute('data-mode'),'fade');
  assert.equal(await page.locator('.dark-room-view').getAttribute('data-speed'),'slow');
  const fadeName=await darkHaze.evaluate(el=>getComputedStyle(el).animationName);
  assert.ok(fadeName.includes('dark-luminous-breath'),'Black room fade needs a compositor animation: '+fadeName);
  assert.equal(await page.locator('body').getAttribute('data-room'),'dark');
  await page.locator('[data-dark-mode="black"]').click();
  assert.equal(await page.locator('.dark-room-view').getAttribute('data-mode'),'black');
  assert.equal(await darkHaze.evaluate(el=>getComputedStyle(el).opacity),'0');
  assert.equal(await darkHaze.evaluate(el=>getComputedStyle(el).animationName),'none');
  assert.equal(await page.locator('.dark-field').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(0, 0, 0)');
  await page.waitForFunction(()=>document.querySelector('.dark-room-view')?.dataset.controls==='hidden',null,{timeout:6000});
  assert.equal(await page.locator('.dark-controls').getAttribute('data-visible'),'false');
  await page.screenshot({path:new URL('dark-room-black.png',output).pathname});
  await page.locator('.dark-field').click({position:{x:150,y:180}});
  assert.equal(await page.locator('.dark-controls').getAttribute('data-visible'),'true');
  await page.locator('[data-dark-mode="fade"]').click();
  await page.locator('#darkSpeed').selectOption('fast');
  await page.locator('#darkIntensity').selectOption('faint');
  assert.equal(await darkView.getAttribute('data-speed'),'fast');
  assert.equal(await darkView.getAttribute('data-intensity'),'faint');
  const darkStyle=await darkView.evaluate(el=>({
    duration:getComputedStyle(el.querySelector('.dark-haze')).animationDuration,
    peak:el.style.getPropertyValue('--dark-peak')
  }));
  assert.equal(darkStyle.duration,'12s');
  assert.match(darkStyle.peak,/rgba\(10, 11, 11, \.66\)/);
  await page.waitForFunction(()=>document.querySelector('.dark-room-view')?.dataset.controls==='hidden',null,{timeout:6000});
  await darkHaze.evaluate(el=>{el.style.animationDelay='-6s';});
  await page.waitForTimeout(110);
  await page.screenshot({path:new URL('dark-room-faint.png',output).pathname});
  assert.ok((await page.evaluate(()=>localStorage.getItem('miniroom-dark-room-v1')))?.includes('fast'));
  await page.keyboard.press('Escape');
  assert.equal(await darkView.getAttribute('data-controls'),'visible');
  await page.locator('[data-dark-action="exit"]').click();
  await page.locator('#studyRoomView').waitFor({state:'visible'});
  assert.equal(await page.locator('#roomSwitcherBtn').getAttribute('aria-label'),'切换小屋，当前在书房');
  passed('fifth dark room: black is mathematically #000, subtle looping fade, controls auto-hide, reveal, Escape, persisted settings and exit');

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
  await page.locator('#loadingIndicator').waitFor({state:'hidden',timeout:20000});
  assert.equal(await page.locator('#studyRoomView').isVisible(),true);
  assert.equal(await page.locator('#homeRoomView').isVisible(),false);
  assert.ok((await page.locator('#photoPreview').getAttribute('src'))?.endsWith('/assets/default-photo.webp'), 'Study default frame should use the bundled Doraemon image');
  passed('room switches preserve existing data; reload returns to original study');
  await enter('meditation');
  assert.equal(await page.locator('#medCron').inputValue(),'*/1 * * * * *','Meditation preferences should survive reload');
  assert.equal(await page.locator('[data-med-schedule="cron"]').getAttribute('aria-pressed'),'true');
  await enter('dark');
  assert.equal(await page.locator('.dark-room-view').getAttribute('data-mode'),'fade','Dark room settings must survive refresh');
  assert.equal(await page.locator('#darkSpeed').inputValue(),'fast');
  await page.locator('[data-dark-action="exit"]').click();
  await page.locator('#studyRoomView').waitFor({state:'visible'});
  await enter('home');
  await page.locator('.home-loading').waitFor({state:'hidden',timeout:20000});

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
  await enter('meditation');
  const medMobile=await page.evaluate(()=>({
    width:document.documentElement.scrollWidth,viewport:innerWidth,
    cron:document.querySelector('#medCron')?.value
  }));
  assert.ok(medMobile.width<=medMobile.viewport+3,'Meditation mobile horizontal overflow '+JSON.stringify(medMobile));
  await page.screenshot({path:new URL('meditation-mobile.png',output).pathname});
  await enter('study');
  passed('meditation timer stays usable in 390px mobile viewport');
  await enter('dark');
  await page.locator('.dark-field').click({position:{x:80,y:280}});
  const overlayBox=await page.locator('.dark-controls').boundingBox();
  assert.ok(overlayBox&&overlayBox.x>=-1&&overlayBox.x+overlayBox.width<=393,'Dark controls overflow on mobile');
  await page.screenshot({path:new URL('dark-room-mobile-controls.png',output).pathname});
  await page.locator('[data-dark-action="exit"]').click();
  await page.locator('#studyRoomView').waitFor({state:'visible'});
  passed('fifth dark room mobile controls fit within 390px; exit returns to unchanged study');

  // 使用浏览器虚拟时钟验证「从开始计时每隔 N 分钟」，无需实际等待一分钟。
  const intervalPage=await context.newPage();
  await intervalPage.goto(host,{waitUntil:'domcontentloaded'});
  await intervalPage.locator('#loadingIndicator').waitFor({state:'hidden',timeout:20000});
  await intervalPage.locator('#roomSwitcherBtn').click();
  await intervalPage.locator('#roomPickerDialog [data-room-choice="meditation"]').click();
  await intervalPage.locator('#meditationRoomView').waitFor({state:'visible',timeout:12000});
  await intervalPage.clock.install({time:new Date(2026,10,19,8,2,0)});
  await intervalPage.locator('[data-med-schedule="interval"]').click();
  await intervalPage.locator('#medMinutes').selectOption('1');
  await intervalPage.locator('#medVoice').uncheck();
  await intervalPage.locator('#medBell').uncheck();
  await intervalPage.locator('[data-med-action="start"]').click();
  await intervalPage.clock.fastForward(60_500);
  assert.equal(await intervalPage.locator('.meditation-room').getAttribute('data-announcements'),'1');
  assert.match(await intervalPage.locator('.med-announcement').textContent(),/1分钟/);
  await intervalPage.locator('[data-med-action="pause"]').click();
  const pausedElapsed=await intervalPage.locator('.med-elapsed').textContent();
  await intervalPage.clock.fastForward(32_000);
  assert.equal(await intervalPage.locator('.med-elapsed').textContent(),pausedElapsed);
  await intervalPage.locator('[data-med-action="start"]').click();
  await intervalPage.clock.fastForward(60_000);
  assert.equal(await intervalPage.locator('.meditation-room').getAttribute('data-announcements'),'2');
  await intervalPage.close();
  passed('interval reminders run at elapsed minute boundaries; pausing excludes elapsed time');

  // 「清理全部」同时删除第四间冥想和第五间黑屋偏好，不删除普通原文件。
  assert.ok(await page.evaluate(()=>!!localStorage.getItem('miniroom-meditation-preferences-v1')));
  assert.ok(await page.evaluate(()=>!!localStorage.getItem('miniroom-dark-room-v1')));
  await page.locator('#storageManagerBtn').click();
  await page.locator('[data-sm-scope="all"]').click();
  await page.locator('.sm-accept').click();
  await page.waitForFunction(()=>localStorage.getItem('miniroom-meditation-preferences-v1')===null
    && localStorage.getItem('miniroom-dark-room-v1')===null,null,{timeout:20000});
  await page.locator('.sm-close').click();
  await enter('meditation');
  assert.equal(await page.locator('[data-med-schedule="interval"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.med-elapsed').textContent(),'00:00:00');
  await enter('study');
  await enter('dark');
  assert.equal(await page.locator('.dark-room-view').getAttribute('data-speed'),'slow');
  assert.equal(await page.locator('.dark-room-view').getAttribute('data-intensity'),'barely');
  await page.locator('[data-dark-action="exit"]').click();
  await page.locator('#studyRoomView').waitFor({state:'visible'});
  passed('clear-all wipes meditation and black-room preferences, preserving other rooms');

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
  await fallbackPage.locator('#loadingIndicator').waitFor({state:'hidden',timeout:20000});
  assert.equal(await fallbackPage.locator('#studyRoomView').isVisible(),true);
  await fallbackPage.locator('#roomSwitcherBtn').click();
  await fallbackPage.locator('#roomPickerDialog [data-room-choice="home"]').click();
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
