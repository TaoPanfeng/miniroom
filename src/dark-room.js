/**
 * 黑屋：完全不渲染物体，渐变仅在近黑色之间循环。
 * CSS 负责动画，JavaScript 只处理参数、沉浸操作与本机设置。
 */
export const DARK_SETTINGS_KEY='miniroom-dark-room-v1';
export const DARK_DEFAULTS=Object.freeze({
  mode:'fade',speed:'slow',intensity:'barely',autoHide:true
});
export const DARK_CYCLES=Object.freeze({slow:31,medium:20,fast:12});
export const DARK_GLOWS=Object.freeze({
  barely:'rgba(7, 8, 8, .55)',
  faint:'rgba(10, 11, 11, .66)',
  visible:'rgba(13, 14, 14, .79)',
});
export function normalizeDarkSettings(value){
  const v=value&&typeof value==='object'?value:{};
  return {
    mode:v.mode==='black'?'black':'fade',
    speed:Object.hasOwn(DARK_CYCLES,v.speed)?v.speed:DARK_DEFAULTS.speed,
    intensity:Object.hasOwn(DARK_GLOWS,v.intensity)?v.intensity:DARK_DEFAULTS.intensity,
    autoHide:typeof v.autoHide==='boolean'?v.autoHide:DARK_DEFAULTS.autoHide,
  };
}
export function clearDarkSettings(){
  try{localStorage.removeItem(DARK_SETTINGS_KEY);return true;}catch{return false;}
}
export function createDarkRoom({container,onExit=()=>{},notify=()=>{}}={}){
  if(!(container instanceof HTMLElement))throw new Error('黑屋缺少容器。');
  const events=new AbortController();
  let settings;
  try{settings=normalizeDarkSettings(JSON.parse(localStorage.getItem(DARK_SETTINGS_KEY)||'null'));}
  catch{settings={...DARK_DEFAULTS};}
  let active=false,disposed=false,autoHideTimer=0;
  container.classList.add('dark-room-view');
  container.setAttribute('aria-label','黑屋：纯黑或几乎无法察觉的微光循环');
  container.innerHTML=[
    '<div class="dark-field" tabindex="0" role="group" aria-label="黑屋视觉区域。点击任意位置显示控制面板。"></div>',
    '<div class="dark-haze" aria-hidden="true"></div>',
    '<div class="dark-controls" role="region" aria-label="黑屋控制面板" data-visible="true">',
    '<div class="dark-control-heading"><div><strong>黑屋</strong><small>只有黑度的变化，没有房屋与物体。</small></div>',
    '<button type="button" class="dark-exit" data-dark-action="exit" aria-label="退出黑屋，返回书房">退出黑屋</button></div>',
    '<div class="dark-modes" role="group" aria-label="光线模式">',
    '<button type="button" data-dark-mode="black" aria-pressed="false">全黑</button>',
    '<button type="button" data-dark-mode="fade" aria-pressed="true">微光循环</button>',
    '</div>',
    '<div class="dark-settings">',
    '<label class="dark-field-label" for="darkSpeed">渐变速度</label>',
    '<select id="darkSpeed"><option value="slow">慢 · 31 秒</option><option value="medium">中 · 20 秒</option><option value="fast">快 · 12 秒</option></select>',
    '<label class="dark-field-label" for="darkIntensity">最亮时的黑度</label>',
    '<select id="darkIntensity"><option value="barely">极弱 · 若有若无</option><option value="faint">微弱 · 几乎看不清</option><option value="visible">稍明显 · 仍然近黑</option></select>',
    '</div>',
    '<div class="dark-control-footer">',
    '<label class="dark-hide-option"><input type="checkbox" id="darkAutoHide">无操作时自动隐藏控制</label>',
    '<button type="button" data-dark-action="fullscreen">进入全屏</button></div>',
    '<p class="dark-note">微光只改变接近纯黑的灰雾强度；全程没有可辨认的场景。屏幕材质、亮度和环境光会影响实际观感。</p>',
    '</div>',
    '<button type="button" class="dark-reveal" title="显示控制" aria-label="显示黑屋控制面板" hidden>显示控制</button>'
  ].join('');
  const field=container.querySelector('.dark-field');
  const overlay=container.querySelector('.dark-controls');
  const reveal=container.querySelector('.dark-reveal');
  const modeButtons=[...container.querySelectorAll('[data-dark-mode]')];
  const speed=container.querySelector('#darkSpeed');
  const intensity=container.querySelector('#darkIntensity');
  const autoHide=container.querySelector('#darkAutoHide');
  const fullscreenButton=container.querySelector('[data-dark-action="fullscreen"]');
  const exitButton=container.querySelector('[data-dark-action="exit"]');
  const on=(node,type,handler)=>node.addEventListener(type,handler,{signal:events.signal});

  function save(){
    try{localStorage.setItem(DARK_SETTINGS_KEY,JSON.stringify(settings));}
    catch{notify('黑屋偏好未能写入本机，仍可正常使用。',4200);}
  }
  function render(){
    container.dataset.mode=settings.mode;
    container.style.setProperty('--dark-cycle',DARK_CYCLES[settings.speed]+'s');
    container.style.setProperty('--dark-peak',DARK_GLOWS[settings.intensity]);
    modeButtons.forEach(button=>
      button.setAttribute('aria-pressed',String(button.dataset.darkMode===settings.mode)));
    speed.value=settings.speed;intensity.value=settings.intensity;
    autoHide.checked=settings.autoHide;
    speed.disabled=intensity.disabled=settings.mode==='black';
    container.dataset.speed=settings.speed;
    container.dataset.intensity=settings.intensity;
  }
  function hide(){
    if(disposed||!active)return;
    if(!settings.autoHide)return;
    if(overlay.contains(document.activeElement))field.focus({preventScroll:true});
    overlay.dataset.visible='false';
    overlay.inert=true;
    reveal.hidden=false;
    container.dataset.controls='hidden';
  }
  function scheduleHide(){
    clearTimeout(autoHideTimer);
    if(active&&settings.autoHide)autoHideTimer=window.setTimeout(hide,3300);
  }
  function show({focusExit=false}={}){
    if(disposed||!active)return;
    overlay.inert=false;
    overlay.dataset.visible='true';
    reveal.hidden=true;
    container.dataset.controls='visible';
    if(focusExit)exitButton.focus({preventScroll:true});
    scheduleHide();
  }
  function gesture(){
    if(!active||disposed)return;
    show();
  }
  on(field,'pointerdown',gesture);
  on(field,'pointermove',e=>{if(e.pointerType==='mouse'&&container.dataset.controls==='hidden')show();});
  on(reveal,'click',gesture);
  on(overlay,'pointerdown',scheduleHide);
  on(overlay,'keydown',scheduleHide);
  for(const button of modeButtons){
    on(button,'click',()=>{
      settings.mode=button.dataset.darkMode;
      render();save();show();
    });
  }
  on(speed,'change',()=>{settings.speed=speed.value;render();save();show();});
  on(intensity,'change',()=>{settings.intensity=intensity.value;render();save();show();});
  on(autoHide,'change',()=>{
    settings.autoHide=autoHide.checked;save();
    show();
    if(!settings.autoHide)clearTimeout(autoHideTimer);
  });
  on(exitButton,'click',()=>{void Promise.resolve(onExit());});
  on(fullscreenButton,'click',async()=>{
    try{
      if(document.fullscreenElement===container)await document.exitFullscreen();
      else if(container.requestFullscreen)await container.requestFullscreen();
      else notify('当前浏览器不支持全屏，可以继续使用满屏黑屋。',4000);
    }catch{notify('浏览器没有允许全屏，仍可直接使用黑屋。',4000);}
    show();
  });
  on(document,'fullscreenchange',()=>{
    fullscreenButton.textContent=document.fullscreenElement===container?'退出全屏':'进入全屏';
  });
  on(document,'keydown',event=>{
    if(!active||disposed)return;
    if(event.key==='Escape'){
      if(!document.fullscreenElement){
        show({focusExit:true});
        event.stopPropagation();
      }
    }else if(event.key==='Tab'&&container.dataset.controls==='hidden'){
      show();
    }
  });
  render();

  return {
    open(){
      if(disposed)return false;
      active=true;container.hidden=false;
      // Re-entering always begins on a black field; CSS animation restarts at zero.
      render();field.focus({preventScroll:true});show();
      return true;
    },
    close(){
      active=false;
      clearTimeout(autoHideTimer);
      overlay.inert=true;
      container.hidden=true;
      if(document.fullscreenElement===container)
        void document.exitFullscreen().catch(()=>{});
      return true;
    },
    clearSavedSettings(){
      const ok=clearDarkSettings();
      Object.assign(settings,DARK_DEFAULTS);render();
      return ok;
    },
    dispose(){
      if(disposed)return;
      this.close();disposed=true;events.abort();
      container.replaceChildren();
    },
  };
}
