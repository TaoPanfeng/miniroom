import { HOME_FOCUS } from './home-layout.js';

/** 第三间小屋的独立页面。无左侧面板，不写入书房或照片墙存档。 */
export function createHomeView({ container, notify = () => {} }) {
  if (!(container instanceof HTMLElement)) throw new Error('我的家缺少容器。');
  let room = null, disposed = false, opening = null, active = false, tipTimer = 0;
  let mode = '3d';
  const events = new AbortController();
  container.classList.add('home-room-view');
  const focusChoices=Object.entries(HOME_FOCUS).map(([key,spot]) =>
    '<button type="button" data-home-focus="'+key+'" aria-pressed="false">'+spot.label+'</button>'
  ).join('');
  container.innerHTML = [
    '<section class="home-scene-shell" aria-label="我的家三维模型">',
    '<div class="home-canvas-wrap">',
    '<canvas class="home-canvas" aria-label="我的家。默认站在主门，拖动转头、WASD 行走；可以切换全屋鸟瞰。" tabindex="0"></canvas>',
    '<div class="home-loading" role="status"><span class="home-loading-house" aria-hidden="true">⌂</span><span>正在打开「我的家」…</span></div>',
    '<div class="home-error" role="alert" hidden><strong>暂时无法显示房屋模型</strong><p></p><button type="button" class="home-retry">重新打开</button></div>',
    '<div class="home-tip" role="status" aria-live="polite" hidden></div>',
    '<div class="home-compat" hidden>轻量模式 · 户型示意</div>',
    '</div>',
    '<div class="home-hint" aria-hidden="true">室内：拖动转头 <span>·</span> WASD 行走 <span>·</span> 点击门开关</div>',
    '<div class="home-camera-tools" aria-label="三维视角工具">',
    '<button type="button" data-home-tool="reset" aria-label="回到主门" title="回到主门"><svg viewBox="0 0 24 24"><path d="M3 10 12 3l9 7v11H3Z"/><path d="M9 21v-8h6v8"/></svg></button>',
    '<button type="button" data-home-tool="whole" aria-label="全屋模型" title="全屋模型"><svg viewBox="0 0 24 24"><path d="m3 10 9-7 9 7-9 7Z"/><path d="M3 10v8l9 5 9-5v-8M12 17v6"/></svg></button>',
    '<button type="button" data-home-tool="top" aria-label="俯视房屋" title="俯视房屋"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 4v16M4 12h16"/></svg></button>',
    '<button type="button" data-home-tool="walls" aria-label="切换墙体剖面" title="切换墙体剖面" aria-pressed="false"><svg viewBox="0 0 24 24"><path d="M3 20V5l9-3 9 3v15M12 2v18M3 13h18"/></svg></button>',
    '<button type="button" data-home-tool="roof" aria-label="隐藏屋顶" title="隐藏屋顶" aria-pressed="true"><svg viewBox="0 0 24 24"><path d="m3 11 9-7 9 7-9 7Z"/><path d="M3 11v5l9 5 9-5v-5"/></svg></button>',
    '<button type="button" data-home-tool="rooms" aria-label="按房间查看" title="按房间查看" aria-controls="homeRoomNav" aria-expanded="false"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M11 3v11M3 14h18M16 14v7M11 8h10"/></svg></button>',
    '</div>',
    '<section class="home-room-nav" id="homeRoomNav" aria-label="房间导航" hidden>',
    '<div class="home-room-nav-title"><strong>站在哪间房？</strong><small>约 50㎡ · 手绘估算</small></div>',
    '<div class="home-room-nav-grid">',
    focusChoices,
    '</div>',
    '<button type="button" class="home-room-nav-all" data-home-focus="all">切换到全屋模型</button>',
    '</section>',
    '<div class="home-meter-note" aria-label="当前视角与面积估算"><span class="home-view-status">室内 · 主门</span><span> · 约 50㎡ 示意</span></div>',
    '<div class="home-walk-pad" aria-label="触屏室内行走">',
    '<button type="button" data-home-move="KeyW" aria-label="向前行走">↑</button>',
    '<div><button type="button" data-home-move="KeyA" aria-label="向左行走">←</button><button type="button" data-home-move="KeyS" aria-label="向后行走">↓</button><button type="button" data-home-move="KeyD" aria-label="向右行走">→</button></div>',
    '</div>',
    '</section>'
  ].join('');
  const $=selector=>container.querySelector(selector);
  const canvas=()=>$('.home-canvas');
  const report=$('.home-tip');
  const buttons=[...container.querySelectorAll('[data-home-tool]')];
  const nav=$('.home-room-nav');
  const navToggle=$('[data-home-tool="rooms"]');
  const focusButtons=[...container.querySelectorAll('[data-home-focus]')];
  const walkPad=$('.home-walk-pad');
  const status=$('.home-view-status');
  function applyMode(viewLabel) {
    const isInside=mode==='3d'&&room?.getMode?.()==='inside';
    walkPad.hidden=!isInside;
    status.textContent=mode==='2d'?'轻量户型示意':isInside?'室内 · '+viewLabel:'全屋模型';
    $('.home-hint').textContent=mode==='2d'
      ? '兼容模式：平面示意 · 按房间定位 · 滚轮缩放'
      : isInside
        ? '室内：拖动转头 · WASD / 方向键行走 · 点击门开关'
        : '全屋：拖动旋转 · 滚轮缩放 · 点房间可进入室内';
    const roofOn=Boolean(room?.roofVisible?.());
    const roofButton=$('[data-home-tool="roof"]');
    roofButton.setAttribute('aria-pressed',String(roofOn));
    roofButton.title=roofOn?'隐藏屋顶':'显示屋顶';
    roofButton.setAttribute('aria-label',roofButton.title);
    roofButton.disabled=mode==='2d';
    $('[data-home-tool="walls"]').setAttribute('aria-pressed','false');
  }
  function closeNavigation() {
    nav.hidden=true;
    navToggle.setAttribute('aria-expanded','false');
  }
  function resetFocus() {
    delete container.dataset.focus;
    focusButtons.forEach(button=>button.setAttribute('aria-pressed','false'));
  }
  function showInfo(message) {
    if(disposed)return;
    clearTimeout(tipTimer);
    report.textContent=message;
    report.hidden=false;
    tipTimer=setTimeout(()=>{report.hidden=true;},4600);
  }
  function reportError(error) {
    $('.home-loading').hidden=true;
    $('.home-error').hidden=false;
    $('.home-error p').textContent=error?.message || '请使用支持 WebGL 的浏览器重新打开。';
    notify('我的家暂时无法打开：'+$('.home-error p').textContent,5000);
  }
  async function mount() {
    if(disposed)return;
    $('.home-error').hidden=true;
    $('.home-loading').hidden=false;
    try {
      const module=await import('./home-room.js');
      if(disposed)return;
      try {
        room=module.createHomeRoom({
          canvas:canvas(),onPick:showInfo,
          onReady:()=>{$('.home-loading').hidden=true;}
        });
      } catch(error) {
        if(!/webgl|context|gpu|renderer/i.test(error?.message||'')) throw error;
        const old=canvas(),replacement=old.cloneNode(false);
        old.replaceWith(replacement);
        const fallback=await import('./home-room-lite.js');
        if(disposed)return;
        room=fallback.createHomeRoomLite({
          canvas:replacement,onPick:showInfo,
          onReady:()=>{$('.home-loading').hidden=true;}
        });
        mode='2d';
        $('.home-compat').hidden=false;
        $('.home-hint').textContent='轻量户型示意 · 滚轮缩放 · 使用右下角视角工具';
        console.info('Miniroom home: WebGL unavailable; Canvas fallback enabled.');
      }
      room.setPaused(!active);
      applyMode('主门');
    }catch(error){reportError(error);}
  }
  function runTool(name) {
    if(name==='rooms') {
      nav.hidden=!nav.hidden;
      navToggle.setAttribute('aria-expanded',String(!nav.hidden));
      if(!nav.hidden)focusButtons[0]?.focus({preventScroll:true});
      return;
    }
    if(!room){showInfo('房屋还没有加载完成。');return;}
    if(name==='reset'){
      room.resetView();resetFocus();applyMode('主门');
      showInfo(mode==='2d'?'已恢复轻量户型示意':'已回到主门，面向屋内');
    }
    if(name==='whole'){
      if(room.showWhole)room.showWhole();
      else room.resetView();
      resetFocus();applyMode('全屋');
      showInfo('全屋模型 · 为看见家具已暂时隐藏顶板，点击屋顶按钮可恢复封顶');
    }
    if(name==='top'){
      room.topView();resetFocus();applyMode('俯视');
      showInfo('俯视房屋 · 点击“站在哪间房”可以从室内查看');
    }
    if(name==='roof'){
      if(!room.toggleRoof){showInfo('当前是兼容模式，屋顶显示需要 WebGL。');return;}
      const visible=room.toggleRoof();
      applyMode(status.textContent.split(' · ').at(-1));
      showInfo(visible?'屋顶已封顶（可再次点击隐藏）':'已隐藏屋顶，方便从上方查看家具');
    }
    if(name==='walls'){
      const cutaway=room.toggleWalls();
      $('[data-home-tool="walls"]').setAttribute('aria-pressed',String(!cutaway));
      showInfo(cutaway?'墙体已剖切，方便查看布局':'已恢复高墙');
    }
  }
  for(const b of buttons)b.addEventListener('click',()=>runTool(b.dataset.homeTool),{signal:events.signal});
  for(const button of focusButtons) {
    button.addEventListener('click',()=>{
      const key=button.dataset.homeFocus;
      closeNavigation();
      if(!room) { showInfo('房屋还没有加载完成。'); return; }
      if(key==='all') {
        if(room.showWhole)room.showWhole();else room.resetView();
        resetFocus();applyMode('全屋');return;
      }
      if(!room.focusRoom?.(key)) {showInfo('这个区域暂时无法定位。');return;}
      container.dataset.focus=key;
      focusButtons.forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
      applyMode(HOME_FOCUS[key].label);
      showInfo(mode==='2d'
        ? HOME_FOCUS[key].label+'：已在俯视示意中标出位置'
        : key==='loft'
          ? '夹层从引体架一侧敞口、顶板保留；尺寸及承重需实测'
          : '正在查看 '+HOME_FOCUS[key].label+' · 房间尺寸仍为估算');
    },{signal:events.signal});
  }
  for(const button of walkPad.querySelectorAll('[data-home-move]')){
    const code=button.dataset.homeMove;
    const stop=event=>{
      if(event?.pointerId!==undefined&&button.hasPointerCapture(event.pointerId))
        button.releasePointerCapture(event.pointerId);
      room?.setWalkKey?.(code,false);
    };
    button.addEventListener('pointerdown',event=>{
      if(mode!=='3d'||room?.getMode?.()!=='inside')return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      room?.setWalkKey?.(code,true);
    },{signal:events.signal});
    button.addEventListener('pointerup',stop,{signal:events.signal});
    button.addEventListener('pointercancel',stop,{signal:events.signal});
    button.addEventListener('lostpointercapture',()=>room?.setWalkKey?.(code,false),{signal:events.signal});
  }
  container.addEventListener('pointerdown',event=>{
    if(!nav.hidden&&!nav.contains(event.target)&&!navToggle.contains(event.target))closeNavigation();
  },{signal:events.signal});
  container.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!nav.hidden) {event.preventDefault();closeNavigation();navToggle.focus({preventScroll:true});}
  },{signal:events.signal});
  $('.home-retry').addEventListener('click',()=>{opening=null;void open();},{signal:events.signal});
  async function open() {
    if(disposed)return false;
    active=true;container.hidden=false;
    if(!room&&!opening)opening=mount().finally(()=>{opening=null;});
    if(opening)await opening;
    if(disposed)return false;
    room?.setPaused(false);
    return true;
  }
  function close() {
    active=false;clearTimeout(tipTimer);report.hidden=true;closeNavigation();
    room?.setPaused(true);container.hidden=true;
    return true;
  }
  return {
    open, close, get busy(){return !!opening;},get mode(){return mode;},
    dispose() {
      if(disposed)return;
      disposed=true;clearTimeout(tipTimer);events.abort();room?.dispose();room=null;
      container.replaceChildren();container.hidden=true;
    }
  };
}
