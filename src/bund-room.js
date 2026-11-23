import {
  BUND_MAX_PHOTOS,bundList,bundCount,bundAdd,bundUpdateYear,bundRemove,bundClear,
  prepareBundPhoto,bundGridFor,validateBundYear
} from './bund-store.js';

const SCENES=['day','dusk','night'];
const SCENE_LABEL={day:'晨光',dusk:'落日',night:'夜色'};
const BUND_PREFERENCES_KEY='miniroom-bund-preferences-v1';
function safePrefs(){
  try{
    const p=JSON.parse(localStorage.getItem(BUND_PREFERENCES_KEY)||'null');
    return {
      scene:SCENES.includes(p?.scene)?p.scene:'dusk',
      autoColor:typeof p?.autoColor==='boolean'?p.autoColor:true,
      motion:typeof p?.motion==='boolean'?p.motion:true,
      spotlight:typeof p?.spotlight==='boolean'?p.spotlight:true,
    };
  }catch{return {scene:'dusk',autoColor:true,motion:true,spotlight:true};}
}
export function clearBundPreferences(){
  try{localStorage.removeItem(BUND_PREFERENCES_KEY);return true;}catch{return false;}
}
function el(tag,cls,text){
  const element=document.createElement(tag);
  if(cls)element.className=cls;
  if(text!==undefined)element.textContent=text;
  return element;
}
function yearOptions(){
  const max=new Date().getFullYear()+1,arr=[];
  for(let year=max;year>=1990;year--)arr.push('<option value="'+year+'">'+year+' 年</option>');
  return arr.join('');
}
/**
 * 新增第六间「外滩时光」。仅使用 CSS 景深与按需更新 DOM，绝不加载 WebGL。
 * 用户照片的压缩副本保存在独立 IndexedDB，不和既有照片墙共享数据。
 */
export function createBundRoom({container,notify=()=>{}}={}){
  if(!(container instanceof HTMLElement))throw new Error('缺少外滩小屋容器。');
  const prefs=safePrefs(),events=new AbortController();
  let active=false,disposed=false,busy=false,rows=[],spotIndex=-1;
  let urls=new Map(),spotTimer=0,colorTimer=0,panFrame=0,opening=null;
  let removeConfirmation=false,viewerId=null,previewUrl=null,importErrors=[];
  let colorsIndex=SCENES.indexOf(prefs.scene);
  container.classList.add('bund-room');
  container.innerHTML=[
    '<section class="bund-scene" data-scene="dusk" aria-label="上海外滩家庭时光墙">',
    '<div class="bund-scenery" aria-hidden="true">',
    '<div class="bund-background"></div><div class="bund-cloudglow"></div>',
    '<div class="bund-reflection"></div><div class="bund-vignette"></div></div>',
    '<header class="bund-heading">',
    '<div class="bund-intro"><span class="bund-kicker">SHANGHAI · THE BUND · OUR YEARS</span>',
    '<h1>外滩时光<span> · </span>一年一张</h1>',
    '<p>黄浦江依旧，年年相聚的人与笑容，都在这里。</p></div>',
    '<div class="bund-top-tools">',
    '<label class="bund-year-selector" for="bundUploadYear">拍摄年份 <select id="bundUploadYear">'+yearOptions()+'</select></label>',
    '<button type="button" data-bund-action="add" class="bund-add">＋ 添加照片</button>',
    '<input type="file" id="bundFileInput" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,.heic,.heif" multiple hidden>',
    '</div></header>',
    '<div class="bund-stage" aria-label="按年份排列的家庭照片墙">',
    '<div class="bund-wall" role="list" aria-label="外滩家庭照片，按年份排列"></div>',
    '<div class="bund-empty"><span class="bund-empty-symbol">✧</span><strong>第一张外滩合影，放在这里。</strong>',
    '<p>选择年份，添加一张竖版照片。<br>以后每一年，再来留一张。</p>',
    '<button type="button" data-bund-action="empty-add">添加我们的第一张照片</button></div>',
    '</div>',
    '<footer class="bund-bottom">',
    '<div class="bund-progress"><strong class="bund-count">0 / 100</strong>',
    '<span class="bund-years">时间，从第一张照片开始。</span></div>',
    '<div class="bund-controls">',
    '<div class="bund-scene-modes" role="group" aria-label="外滩颜色"><button type="button" data-bund-scene="day">晨光</button>',
    '<button type="button" data-bund-scene="dusk" aria-pressed="true">落日</button>',
    '<button type="button" data-bund-scene="night">夜色</button></div>',
    '<label class="bund-check"><input type="checkbox" id="bundAutoColor">自动变色</label>',
    '<label class="bund-check"><input type="checkbox" id="bundParallax">3D 景深</label>',
    '<label class="bund-check"><input type="checkbox" id="bundSpotlight">照片呼吸</label>',
    '</div><p class="bund-privacy">照片仅保存在当前浏览器。存储的是适度压缩的副本，不是永久备份；请保留手机原片。<button type="button" data-bund-action="clear">清空外滩相册</button></p>',
    '<p class="bund-credit"><a href="https://commons.wikimedia.org/wiki/File:Night_view_of_Shanghai_taken_at_the_Bund.jpg" target="_blank" rel="noopener noreferrer">背景原摄影：JinshengLuGary / Wikimedia Commons（CC BY-SA 4.0）</a> · 色调与景深由页面动态呈现</p>',
    '</footer>',
    '<div class="bund-import-status" role="status" aria-live="polite" hidden></div>',
    '</section>',
    '<dialog class="bund-viewer" aria-label="查看与编辑外滩照片">',
    '<div class="bund-viewer-inner">',
    '<button type="button" class="bund-close-viewer" aria-label="关闭照片">×</button>',
    '<div class="bund-viewer-art"><img alt="已保存的外滩合影"></div>',
    '<div class="bund-viewer-info"><span class="bund-viewer-kicker">OUR MEMORIES AT THE BUND</span>',
    '<h2 class="bund-viewer-year">2026</h2><p class="bund-viewer-name"></p>',
    '<label for="bundEditYear">修改拍摄年份</label><select id="bundEditYear">'+yearOptions()+'</select>',
    '<div class="bund-viewer-actions"><button type="button" data-bund-action="save-year">保存年份</button>',
    '<button type="button" data-bund-action="download">下载展示图</button>',
    '<button type="button" class="bund-delete" data-bund-action="remove">删除照片</button></div>',
    '<p class="bund-delete-note" hidden>再点击一次「确认删除」才能删除；不会删除手机原片。</p>',
    '</div></div></dialog>'
  ].join('');
  const $=selector=>container.querySelector(selector);
  const scene=$('.bund-scene'),stage=$('.bund-stage'),wall=$('.bund-wall'),empty=$('.bund-empty');
  const fileInput=$('#bundFileInput'),uploadYear=$('#bundUploadYear');
  const viewer=$('.bund-viewer'),status=$('.bund-import-status');
  const photoImage=$('.bund-viewer-art img'),editYear=$('#bundEditYear');
  const sceneButtons=[...container.querySelectorAll('[data-bund-scene]')];
  const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
  const on=(node,type,handler)=>node.addEventListener(type,handler,{signal:events.signal});

  function savePrefs(){
    try{localStorage.setItem(BUND_PREFERENCES_KEY,JSON.stringify(prefs));}
    catch{notify('外滩背景偏好暂时无法保存。',4200);}
  }
  function report(message){
    status.hidden=false;status.textContent=message;
    notify(message,4200);
  }
  function paintScene(){
    scene.dataset.scene=prefs.scene;
    scene.dataset.motion=String(prefs.motion&&!reducedMotion.matches);
    colorsIndex=SCENES.indexOf(prefs.scene);
    sceneButtons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.bundScene===prefs.scene)));
    $('#bundAutoColor').checked=prefs.autoColor;
    $('#bundParallax').checked=prefs.motion;
    $('#bundSpotlight').checked=prefs.spotlight;
    clearInterval(colorTimer);colorTimer=0;
    if(active&&prefs.autoColor&&!reducedMotion.matches){
      colorTimer=window.setInterval(()=>{
        if(document.hidden||!active)return;
        colorsIndex=(colorsIndex+1)%SCENES.length;
        prefs.scene=SCENES[colorsIndex];
        scene.dataset.scene=prefs.scene;
        sceneButtons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.bundScene===prefs.scene)));
      },28000);
    }
  }
  function layout(){
    const count=rows.length,grid=bundGridFor(count);
    const rect=stage.getBoundingClientRect();
    const availableWidth=Math.max(270,rect.width-40);
    const availableHeight=Math.max(280,rect.height-35);
    const gutter=count>35?5:count>15?9:14;
    const widthCap=count===1?280:count<=4?238:count<=12?185:140;
    const captionHeight=count>=35?11:count>=12?15:23;
    const width=Math.max(24,Math.min(
      widthCap,(availableWidth-(grid.columns+1)*gutter)/grid.columns,
      ((availableHeight-grid.rows*(gutter+captionHeight))/grid.rows)*.75
    ));
    wall.style.setProperty('--bund-columns',grid.columns);
    wall.style.setProperty('--bund-tile',width.toFixed(1)+'px');
    wall.style.setProperty('--bund-gap',gutter+'px');
    wall.dataset.columns=String(grid.columns);
    wall.dataset.rows=String(grid.rows);
    wall.dataset.count=String(count);
    stage.dataset.layout=count===0?'empty':count===1?'hero':count<=4?'few':count>64?'dense':'wall';
    empty.hidden=count!==0;
    $('.bund-count').textContent=count+' / 100';
    $('.bund-years').textContent=count
      ? rows[0].year+' — '+rows[rows.length-1].year+' · '+count+' 个被珍藏的瞬间'
      :'时间，从第一张照片开始。';
    container.querySelector('[data-bund-action="add"]').disabled=count>=BUND_MAX_PHOTOS;
    container.querySelector('[data-bund-action="empty-add"]').disabled=count>=BUND_MAX_PHOTOS;
  }
  function revokeUrls(){
    for(const url of urls.values())URL.revokeObjectURL(url);
    urls.clear();
  }
  function markSpotlight(){
    const cards=[...wall.querySelectorAll('.bund-card')];
    cards.forEach((card,index)=>{card.dataset.spotlight=String(prefs.spotlight&&index===spotIndex);});
  }
  function startSpotlight(){
    clearInterval(spotTimer);spotTimer=0;
    if(!active||!prefs.spotlight||reducedMotion.matches||rows.length<2)return;
    spotTimer=window.setInterval(()=>{
      if(!active||document.hidden||viewer.open)return;
      spotIndex=(spotIndex+1)%rows.length;
      markSpotlight();
    },4500);
  }
  function renderPhotos(){
    revokeUrls();wall.replaceChildren();
    const fragment=document.createDocumentFragment();
    rows.forEach((row,index)=>{
      const button=el('button','bund-card');
      button.type='button';button.dataset.id=row.id;button.dataset.year=String(row.year);
      button.setAttribute('role','listitem');
      button.setAttribute('aria-label',row.year+'年外滩照片：'+row.name+'，点击放大');
      const frame=el('span','bund-card-frame');
      const image=el('img','bund-card-photo');
      image.alt=row.year+'年·上海外滩合影';
      image.loading=index<12?'eager':'lazy';image.decoding='async';
      const url=URL.createObjectURL(row.imageBlob);urls.set(row.id,url);
      image.src=url;
      frame.append(image);
      const year=el('span','bund-card-year',String(row.year));
      button.append(frame,year);
      button.addEventListener('click',()=>showViewer(row.id),{signal:events.signal});
      fragment.append(button);
    });
    wall.append(fragment);spotIndex=rows.length?0:-1;markSpotlight();
    layout();startSpotlight();
  }
  async function refresh(){
    if(disposed)return;
    rows=await bundList();
    if(disposed)return;
    renderPhotos();
  }
  async function importFiles(files){
    if(busy||disposed)return;
    const incoming=[...files];
    if(!incoming.length)return;
    const maxRemaining=BUND_MAX_PHOTOS-rows.length;
    if(maxRemaining<=0){report('照片墙已满100张，请先删除旧照片。');return;}
    busy=true;importErrors=[];
    const target=incoming.slice(0,maxRemaining);
    const skipped=incoming.length-target.length;
    const year=validateBundYear(uploadYear.value);
    let saved=0;
    try{
      for(let i=0;i<target.length;i++){
        if(disposed)break;
        status.hidden=false;
        status.textContent='正在整理第 '+(i+1)+' / '+target.length+' 张照片…';
        try{
          const photo=await prepareBundPhoto(target[i],year);
          await bundAdd(photo);saved++;
        }catch(error){importErrors.push(target[i].name+'：'+(error.message||'导入失败'));}
      }
    }finally{
      busy=false;fileInput.value='';
      try{await refresh();}catch(error){report(error.message||'已导入但列表刷新失败，请重新进入小屋。');return;}
      const errors=importErrors.length?'；失败 '+importErrors.length+' 张（'+importErrors.slice(0,2).join('；')+'）':'';
      report('已保存 '+saved+' 张'+(skipped?'，超出100张上限跳过 '+skipped+' 张':'')+errors);
    }
  }
  function clearViewerUrl(){
    if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}
    photoImage.removeAttribute('src');
  }
  function showViewer(id){
    const photo=rows.find(row=>row.id===id);
    if(!photo||disposed)return;
    viewerId=id;removeConfirmation=false;
    $('.bund-delete-note').hidden=true;
    $('[data-bund-action="remove"]').textContent='删除照片';
    clearViewerUrl();previewUrl=URL.createObjectURL(photo.imageBlob);
    photoImage.src=previewUrl;
    photoImage.alt=photo.year+'年上海外滩的照片';
    $('.bund-viewer-year').textContent=String(photo.year);
    $('.bund-viewer-name').textContent=photo.name;
    editYear.value=String(photo.year);
    if(!viewer.open)viewer.showModal();
  }
  function closeViewer(){
    if(viewer.open)viewer.close();
    viewerId=null;clearViewerUrl();
  }
  function nowRow(){return rows.find(row=>row.id===viewerId);}
  async function updateYear(){
    const row=nowRow();if(!row)return;
    try{
      await bundUpdateYear(row.id,editYear.value);
      await refresh();
      const selected=rows.find(x=>x.id===row.id);
      if(selected){$('.bund-viewer-year').textContent=String(selected.year);editYear.value=String(selected.year);}
      report('拍摄年份已修改为 '+editYear.value+' 年。');
    }catch(error){report(error.message||'年份修改失败');}
  }
  async function removePhoto(){
    const row=nowRow();if(!row)return;
    const button=$('[data-bund-action="remove"]');
    if(!removeConfirmation){
      removeConfirmation=true;button.textContent='确认删除';
      $('.bund-delete-note').hidden=false;
      return;
    }
    try{await bundRemove(row.id);closeViewer();await refresh();report('已从浏览器照片墙删除，手机原片不受影响。');}
    catch(error){report(error.message||'删除失败，请重试。');}
  }
  function downloadPhoto(){
    const row=nowRow();if(!row)return;
    const url=URL.createObjectURL(row.imageBlob);
    const link=document.createElement('a');
    link.href=url;link.download='上海外滩-'+row.year+'-'+row.id.slice(0,6)+(row.imageBlob.type==='image/webp'?'.webp':'.jpg');
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),800);
  }
  function onPointerMove(event){
    if(!prefs.motion||reducedMotion.matches||!active)return;
    if(panFrame)return;
    const rect=scene.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width-.5;
    const y=(event.clientY-rect.top)/rect.height-.5;
    panFrame=requestAnimationFrame(()=>{
      panFrame=0;
      scene.style.setProperty('--bund-shift-x',(x*13).toFixed(1)+'px');
      scene.style.setProperty('--bund-shift-y',(y*9).toFixed(1)+'px');
    });
  }
  function resetPan(){scene.style.setProperty('--bund-shift-x','0px');scene.style.setProperty('--bund-shift-y','0px');}
  async function open(){
    if(disposed)return false;
    active=true;container.hidden=false;paintScene();
    if(!opening)opening=refresh().catch(error=>{report(error.message||'外滩照片墙暂时无法读取。');});
    await opening;opening=null;
    if(disposed)return false;
    layout();startSpotlight();
    return true;
  }
  function close(){
    active=false;clearInterval(spotTimer);clearInterval(colorTimer);
    spotTimer=colorTimer=0;
    if(panFrame)cancelAnimationFrame(panFrame);panFrame=0;resetPan();
    closeViewer();container.hidden=true;
    return true;
  }
  const add=()=>{if(!busy)fileInput.click();};
  on($('[data-bund-action="add"]'),'click',add);
  on($('[data-bund-action="empty-add"]'),'click',add);
  on(fileInput,'change',()=>{void importFiles(fileInput.files);});
  for(const b of sceneButtons)on(b,'click',()=>{
    prefs.scene=b.dataset.bundScene;prefs.autoColor=false;
    savePrefs();paintScene();
  });
  on($('#bundAutoColor'),'change',e=>{prefs.autoColor=e.target.checked;savePrefs();paintScene();});
  on($('#bundParallax'),'change',e=>{prefs.motion=e.target.checked;savePrefs();paintScene();if(!prefs.motion)resetPan();});
  on($('#bundSpotlight'),'change',e=>{prefs.spotlight=e.target.checked;savePrefs();startSpotlight();markSpotlight();});
  on(scene,'pointermove',onPointerMove);
  on(scene,'pointerleave',resetPan);
  on(document,'visibilitychange',()=>{if(!document.hidden){layout();startSpotlight();}});
  const observer=new ResizeObserver(()=>{if(active)layout();});observer.observe(stage);
  on($('.bund-close-viewer'),'click',closeViewer);
  on(viewer,'close',()=>{viewerId=null;clearViewerUrl();});
  on(viewer,'click',event=>{if(event.target===viewer)closeViewer();});
  on($('[data-bund-action="save-year"]'),'click',()=>{void updateYear();});
  on($('[data-bund-action="download"]'),'click',downloadPhoto);
  on($('[data-bund-action="remove"]'),'click',()=>{void removePhoto();});
  // Deliberately require a second click before deleting all locally saved yearly memories.
  let clearArmed=false,clearHandle=0;
  on($('[data-bund-action="clear"]'),'click',async()=>{
    const button=$('[data-bund-action="clear"]');
    if(!clearArmed){
      clearArmed=true;button.textContent='确认清空100张以内的全部照片？';
      clearTimeout(clearHandle);
      clearHandle=setTimeout(()=>{clearArmed=false;button.textContent='清空外滩相册';},6500);
      return;
    }
    clearArmed=false;clearTimeout(clearHandle);button.textContent='清空外滩相册';
    try{await bundClear();await refresh();report('外滩相册已清空。手机原片没有删除。');}
    catch(error){report(error.message||'清理失败，请重试。');}
  });
  uploadYear.value=String(new Date().getFullYear());
  paintScene();layout();
  return {
    open,close,
    get busy(){return busy;},
    async refreshStorage(){if(!disposed)await refresh();},
    async clearLocal(){
      if(busy)throw new Error('正在导入照片，请完成后再清理。');
      await bundClear();clearBundPreferences();Object.assign(prefs,safePrefs());
      if(active)await refresh();
    },
    dispose(){
      if(disposed)return;
      disposed=true;close();clearTimeout(clearHandle);observer.disconnect();
      events.abort();revokeUrls();container.replaceChildren();
    },
  };
}
