import {
  parseCron, nextCronTime, formatElapsed, speakElapsed, intervalNextElapsed,
} from './meditation-cron.js';

export const MEDITATION_STORAGE_KEY='miniroom-meditation-preferences-v1';
const DEFAULTS=Object.freeze({
  schedule:'interval',minutes:5,cron:'0 */5 * * * ?',
  voice:true,bell:true,volume:.6,screenAwake:false,
});
const INTERVALS=[1,2,3,5,10,15,20,30,45,60];
const SAMPLE_CRONS=[
  ['0 */5 * * * ?','每逢钟表的 5 分钟整（6 段）'],
  ['*/5 * * * *','每逢钟表的 5 分钟整（5 段）'],
  ['*/10 * * * * *','每逢 10 秒（用于试听）'],
  ['0 0 * * * *','每小时整点'],
];
function readPreferences(){
  try {
    const value=JSON.parse(localStorage.getItem(MEDITATION_STORAGE_KEY)||'null');
    if(!value||typeof value!=='object')return {...DEFAULTS};
    const next={...DEFAULTS};
    if(['interval','cron'].includes(value.schedule))next.schedule=value.schedule;
    if(INTERVALS.includes(Number(value.minutes)))next.minutes=Number(value.minutes);
    if(typeof value.cron==='string'&&value.cron.length<=100)next.cron=value.cron;
    if(typeof value.voice==='boolean')next.voice=value.voice;
    if(typeof value.bell==='boolean')next.bell=value.bell;
    if(Number.isFinite(value.volume))next.volume=Math.max(0,Math.min(1,Number(value.volume)));
    if(typeof value.screenAwake==='boolean')next.screenAwake=value.screenAwake;
    return next;
  } catch {return {...DEFAULTS};}
}
export function clearMeditationPreferences(){
  try{localStorage.removeItem(MEDITATION_STORAGE_KEY);return true;}catch{return false;}
}

/**
 * 轻量冥想房间：无需 WebGL，无上传或外部音频资源。
 * 时间以 Date.now() 为准，浏览器后台限流时按真实流逝时间补算，
 * 不补播大量积压提醒。语音依赖用户本机浏览器的中文 TTS 能力。
 */
export function createMeditationRoom({container,notify=()=>{}}={}){
  if(!(container instanceof HTMLElement))throw new Error('冥想房间容器不存在。');
  const preferences=readPreferences();
  let phase='idle',elapsedBefore=0,startedAt=0,timer=0,nextCronAt=null;
  let compiled=null,lastMilestone=0,announcements=0,lastAnnouncedAt=0;
  let active=false,disposed=false,context=null,wakeLock=null,lastRendered='',lastSpeech='';
  const events=new AbortController();
  const intervalOptions=INTERVALS.map(n=>'<option value="'+n+'">'+n+' 分钟</option>').join('');
  const examples=SAMPLE_CRONS.map(([value,description])=>
    '<button type="button" class="med-cron-example" data-med-cron="'+value+'"><code>'+value+'</code><span>'+description+'</span></button>'
  ).join('');
  container.classList.add('meditation-room');
  container.innerHTML=[
    '<section class="med-page" aria-label="冥想计时小屋">',
    '<header class="med-heading"><span class="med-eyebrow">BREATHE · NOTICE · RETURN</span>',
    '<h1>此刻，静下来。</h1><p>不必追逐时间，让提醒轻轻告诉你：已经走了多远。</p></header>',
    '<div class="med-clock-wrap">',
    '<div class="med-orbit" aria-hidden="true"><span class="med-orbit-inner"></span></div>',
    '<div class="med-clock"><span class="med-clock-kicker">从开始到现在</span>',
    '<strong class="med-elapsed" aria-label="已冥想时长">00:00:00</strong>',
    '<span class="med-status" aria-live="polite">准备开始</span></div>',
    '</div>',
    '<div class="med-actions">',
    '<button type="button" class="med-primary" data-med-action="start">开始冥想</button>',
    '<button type="button" class="med-secondary" data-med-action="pause" disabled>暂停</button>',
    '<button type="button" class="med-quiet" data-med-action="finish" disabled>结束本次</button>',
    '</div>',
    '<div class="med-next" role="status" aria-live="polite">',
    '<span class="med-next-label">下一次温柔提醒</span><strong class="med-next-time">开始后计算</strong>',
    '<p class="med-announcement">还没有提醒。你只管专注呼吸。</p></div>',
    '<section class="med-controls" aria-label="提醒设置">',
    '<div class="med-control-title"><h2>提醒节奏</h2><span>仅保存在当前浏览器</span></div>',
    '<div class="med-modes" role="group" aria-label="选择提醒计算方式">',
    '<button type="button" data-med-schedule="interval" aria-pressed="true">从开始每隔…</button>',
    '<button type="button" data-med-schedule="cron" aria-pressed="false">Cron 表达式</button></div>',
    '<div class="med-interval-row"><label for="medMinutes">每隔</label>',
    '<select id="medMinutes" aria-label="提醒间隔">'+intervalOptions+'</select>',
    '<span>提醒一次，从开始计时，不受钟表整点影响。</span></div>',
    '<div class="med-cron-row" hidden><label for="medCron">Cron（本机时间）</label>',
    '<input type="text" id="medCron" maxlength="100" inputmode="text" autocomplete="off" spellcheck="false" placeholder="0 */5 * * * ?">',
    '<p class="med-cron-validation" role="status" aria-live="polite"></p>',
    '<details class="med-cron-help"><summary>示例与格式说明</summary><div class="med-cron-presets">'+examples+'</div>',
    '<p>5 段：分 时 日 月 周；6 段：秒 分 时 日 月 周。支持 *、?（仅日/周）、逗号、范围和 / 步长。周日为 0 或 7。日与周同时限制时，按常见 Unix Cron 的“或”规则。</p>',
    '<p><strong>注意：</strong>Cron 按钟表触发。例如 08:02 开始，*/5 * * * * 将在 08:05 首次提醒，和“开始后每满 5 分钟”不同。暂不支持 Quartz 的 L、W、#、年份字段。</p>',
    '</details></div>',
    '<div class="med-audio-controls">',
    '<label class="med-check"><input type="checkbox" id="medVoice"><span>中文语音播报已过去多久</span></label>',
    '<label class="med-check"><input type="checkbox" id="medBell"><span>轻柔提示音</span></label>',
    '<label class="med-check"><input type="checkbox" id="medAwake"><span>保持屏幕常亮（设备支持时）</span></label>',
    '<div class="med-volume-line"><label for="medVolume">提醒音量</label>',
    '<input type="range" id="medVolume" min="0" max="1" step=".05"><output class="med-volume-value">60%</output></div>',
    '<button type="button" class="med-test" data-med-action="test">试听提醒</button>',
    '</div></section>',
    '<p class="med-footnote">⚠️ 浏览器需要先点击开始或试听，才允许发声；语音质量取决于浏览器中文语音包。切换小屋后计时继续，但锁屏、休眠、关闭标签页或系统省电可能延迟甚至阻止提醒。它不是系统级后台闹钟。</p>',
    '</section>'
  ].join('');
  const $=selector=>container.querySelector(selector);
  const $start=$('[data-med-action="start"]'),$pause=$('[data-med-action="pause"]');
  const $finish=$('[data-med-action="finish"]');
  const $elapsed=$('.med-elapsed'),$state=$('.med-status');
  const $next=$('.med-next-time'),$last=$('.med-announcement');
  const $minutes=$('#medMinutes'),$cron=$('#medCron');
  const $cronHelp=$('.med-cron-validation');
  const $intervalRow=$('.med-interval-row'),$cronRow=$('.med-cron-row');
  const $voice=$('#medVoice'),$bell=$('#medBell'),$awake=$('#medAwake'),$volume=$('#medVolume');
  const scheduleButtons=[...container.querySelectorAll('[data-med-schedule]')];
  function storePreferences(){
    try{localStorage.setItem(MEDITATION_STORAGE_KEY,JSON.stringify(preferences));}
    catch{notify('提醒设置未能保存；本次仍可以使用。',4500);}
  }
  function elapsed(now=Date.now()){
    return elapsedBefore+(phase==='running'?Math.max(0,now-startedAt):0);
  }
  function currentNext(now=Date.now()){
    if(phase!=='running')return null;
    if(preferences.schedule==='cron')return nextCronAt===null?null:Math.max(0,nextCronAt-now);
    return Math.max(0,intervalNextElapsed(elapsed(now),preferences.minutes)-elapsed(now));
  }
  function presentTime(ms){
    const seconds=Math.max(0,Math.ceil(ms/1000));
    const m=Math.floor(seconds/60),s=seconds%60;
    return m>=60?Math.floor(m/60)+'小时'+m%60+'分'+s+'秒':m+'分'+String(s).padStart(2,'0')+'秒';
  }
  function render(){
    if(disposed)return;
    const now=Date.now(),time=formatElapsed(elapsed(now));
    if(time!==lastRendered){$elapsed.textContent=time;lastRendered=time;}
    $state.textContent=phase==='running'?'冥想中 · 回到呼吸'
      :phase==='paused'?'已暂停 · 时间没有继续走'
      :phase==='finished'?'这一段静坐已结束':'准备开始';
    $start.textContent=phase==='running'?'正在冥想'
      :phase==='paused'?'继续冥想'
      :phase==='finished'?'开始新一次':'开始冥想';
    $start.disabled=phase==='running';
    $pause.disabled=phase!=='running';
    $finish.disabled=phase==='idle'||phase==='finished';
    const locked=phase==='running'||phase==='paused';
    for(const b of scheduleButtons)b.disabled=locked;
    $minutes.disabled=locked;$cron.disabled=locked;
    for(const b of container.querySelectorAll('.med-cron-example'))b.disabled=locked;
    container.dataset.phase=phase;
    if(phase==='running'){
      const n=currentNext(now);
      if(n===null)$next.textContent='暂无未来触发时间';
      else if(preferences.schedule==='cron'&&nextCronAt!==null)
        $next.textContent=presentTime(n)+'后 · '+new Date(nextCronAt).toLocaleTimeString('zh-CN',{hour12:false});
      else $next.textContent=presentTime(n)+'后';
    }else if(phase==='paused')$next.textContent='已暂停';
    else if(phase==='finished')$next.textContent='已完成 '+formatElapsed(elapsedBefore);
    else $next.textContent='开始后计算';
  }
  function validateCron(){
    try{
      const rule=parseCron(preferences.cron);
      const future=nextCronTime(rule,Date.now());
      if(future===null)throw new Error('未来 5 年内找不到触发时间，请调整表达式。');
      $cronHelp.textContent='✅ 有效 · 下次按本机时间 '+new Date(future).toLocaleString('zh-CN',{hour12:false});
      $cronHelp.dataset.valid='true';
      return {rule,future};
    }catch(error){
      $cronHelp.textContent='❌ '+(error.message||'表达式无效');
      $cronHelp.dataset.valid='false';
      return null;
    }
  }
  function updateSettings(){
    $intervalRow.hidden=preferences.schedule!=='interval';
    $cronRow.hidden=preferences.schedule!=='cron';
    for(const b of scheduleButtons)b.setAttribute('aria-pressed',String(b.dataset.medSchedule===preferences.schedule));
    $minutes.value=String(preferences.minutes);
    $cron.value=preferences.cron;
    $voice.checked=preferences.voice;
    $bell.checked=preferences.bell;
    $awake.checked=preferences.screenAwake;
    $volume.value=String(preferences.volume);
    $('.med-volume-value').textContent=Math.round(preferences.volume*100)+'%';
    if(preferences.schedule==='cron')validateCron();
    render();
  }
  function audioContext(){
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(!Audio)return null;
    if(!context){try{context=new Audio();}catch{return null;}}
    if(context.state==='suspended')void context.resume().catch(()=>{});
    return context;
  }
  function bellSound(){
    if(!preferences.bell)return;
    const ac=audioContext();
    if(!ac)return;
    try{
      const t=ac.currentTime;
      for(const [note,start] of [[587.33,0],[783.99,.14]]){
        const gain=ac.createGain(),osc=ac.createOscillator();
        osc.type='sine';osc.frequency.value=note;
        gain.gain.setValueAtTime(.0001,t+start);
        gain.gain.exponentialRampToValueAtTime(Math.max(.0002,preferences.volume*.055),t+start+.025);
        gain.gain.exponentialRampToValueAtTime(.0001,t+start+.56);
        osc.connect(gain);gain.connect(ac.destination);
        osc.start(t+start);osc.stop(t+start+.57);
      }
    }catch{ /* AudioContext policy may forbid playback in inactive tabs. */ }
  }
  function voiceSay(message){
    if(!preferences.voice)return;
    if(!('speechSynthesis' in window)||!('SpeechSynthesisUtterance' in window)){
      $last.textContent=message+'（当前浏览器没有语音引擎，仅显示文字）';
      return;
    }
    try{
      const synth=window.speechSynthesis;
      synth.cancel();
      const utterance=new SpeechSynthesisUtterance(message);
      utterance.lang='zh-CN';
      utterance.rate=.88;utterance.pitch=1;utterance.volume=preferences.volume;
      const voices=synth.getVoices();
      const selected=voices.find(v=>/^zh[-_](CN|Hans)/i.test(v.lang))
        ||voices.find(v=>/^zh/i.test(v.lang));
      if(selected)utterance.voice=selected;
      synth.speak(utterance);
    }catch{/* Keep the on-screen elapsed message even when speech fails. */}
  }
  function announce(now=Date.now()){
    announcements++;
    lastAnnouncedAt=now;
    lastSpeech=speakElapsed(elapsed(now));
    $last.textContent='第 '+announcements+' 次提醒：'+lastSpeech;
    container.dataset.announcements=String(announcements);
    bellSound();
    voiceSay(lastSpeech);
  }
  function tick(){
    if(disposed||phase!=='running')return;
    const now=Date.now();
    if(preferences.schedule==='interval'){
      const index=Math.floor(elapsed(now)/(preferences.minutes*60_000));
      if(index>lastMilestone){
        lastMilestone=index;
        announce(now); // When waking from sleep, speak once with actual elapsed time.
      }
    }else if(nextCronAt!==null&&now>=nextCronAt){
      announce(now);
      nextCronAt=nextCronTime(compiled,now);
    }
    render();
  }
  function runTimer(){
    clearInterval(timer);
    timer=window.setInterval(tick,250);
    tick();
  }
  async function takeWakeLock(){
    if(!preferences.screenAwake||phase!=='running'||document.hidden||!navigator.wakeLock?.request)return;
    try{if(!wakeLock)wakeLock=await navigator.wakeLock.request('screen');}
    catch{notify('此设备不允许屏幕常亮，计时仍会继续。',3500);}
  }
  function releaseWakeLock(){
    const lock=wakeLock;wakeLock=null;
    if(lock)void lock.release().catch(()=>{});
  }
  function stopAudio(){
    if('speechSynthesis' in window)try{window.speechSynthesis.cancel();}catch{}
  }
  function prepareSession(){
    if(preferences.schedule==='cron'){
      const parsed=validateCron();
      if(!parsed){notify('Cron 表达式无效，请先修改再开始。',5000);$cron.focus();return false;}
      compiled=parsed.rule;
      nextCronAt=nextCronTime(compiled,Date.now());
      if(nextCronAt===null){notify('Cron 暂无未来触发时刻。');return false;}
    }else{compiled=null;nextCronAt=null;}
    return true;
  }
  function start(){
    if(phase==='running')return;
    if(phase==='idle'||phase==='finished'){
      if(!prepareSession())return;
      elapsedBefore=0;announcements=0;lastMilestone=0;lastAnnouncedAt=0;lastSpeech='';
      $last.textContent='还没有提醒。你只管专注呼吸。';
      container.dataset.announcements='0';
    }
    if(phase==='paused'&&preferences.schedule==='cron'){
      nextCronAt=nextCronTime(compiled,Date.now());
    }
    // A real click is the audio permission gesture; do not defer activation to a timer.
    if(preferences.bell)audioContext();
    phase='running';startedAt=Date.now();lastRendered='';
    void takeWakeLock();
    runTimer();
    render();
  }
  function pause(){
    if(phase!=='running')return;
    elapsedBefore=elapsed();phase='paused';clearInterval(timer);timer=0;
    nextCronAt=null;stopAudio();releaseWakeLock();render();
  }
  function finish(){
    if(phase!=='running'&&phase!=='paused')return;
    elapsedBefore=elapsed();phase='finished';clearInterval(timer);timer=0;
    releaseWakeLock();stopAudio();nextCronAt=null;
    $last.textContent='本次冥想 '+formatElapsed(elapsedBefore)+' · 安住当下，已经很好。';
    render();
  }
  const on=(node,name,fn)=>node.addEventListener(name,fn,{signal:events.signal});
  on($start,'click',start);
  on($pause,'click',pause);
  on($finish,'click',finish);
  on($('[data-med-action="test"]'),'click',()=>{
    if(preferences.bell)bellSound();
    const text=phase==='running'?speakElapsed(elapsed()):'声音测试。放轻肩膀，回到呼吸。';
    voiceSay(text);notify(preferences.voice?'已尝试语音播报。请确认设备音量和中文语音设置。':'已试听轻柔提示音。',4200);
  });
  for(const b of scheduleButtons)on(b,'click',()=>{
    if(phase==='running'||phase==='paused')return;
    preferences.schedule=b.dataset.medSchedule;
    storePreferences();updateSettings();
  });
  on($minutes,'change',()=>{preferences.minutes=Number($minutes.value);storePreferences();render();});
  on($cron,'input',()=>{preferences.cron=$cron.value;validateCron();storePreferences();render();});
  for(const example of container.querySelectorAll('[data-med-cron]')){
    on(example,'click',()=>{
      if(phase==='running'||phase==='paused')return;
      preferences.cron=example.dataset.medCron;
      $cron.value=preferences.cron;storePreferences();validateCron();
    });
  }
  for(const [input,key] of [[$voice,'voice'],[$bell,'bell'],[$awake,'screenAwake']]){
    on(input,'change',()=>{
      preferences[key]=input.checked;storePreferences();
      if(key==='screenAwake'){if(input.checked)void takeWakeLock();else releaseWakeLock();}
      if(key==='voice'&&!input.checked)stopAudio();
    });
  }
  on($volume,'input',()=>{
    preferences.volume=Number($volume.value);
    $('.med-volume-value').textContent=Math.round(preferences.volume*100)+'%';
    storePreferences();
  });
  on(document,'visibilitychange',()=>{
    if(phase==='running'){
      tick();
      if(!document.hidden)void takeWakeLock();
    }
  });
  on(window,'pageshow',()=>{if(phase==='running')tick();});
  updateSettings();
  container.dataset.announcements='0';
  return {
    get busy(){return false;},
    get running(){return phase==='running';},
    open(){active=true;container.hidden=false;render();return true;},
    close(){active=false;container.hidden=true;return true;}, // Keep timer running when switching rooms.
    clearSavedSettings(){
      // 「全部清理」同时终止正在进行的冥想提醒，避免旧计划继续发声。
      clearInterval(timer);timer=0;releaseWakeLock();stopAudio();
      phase='idle';elapsedBefore=0;startedAt=0;nextCronAt=null;compiled=null;
      announcements=0;lastMilestone=0;lastSpeech='';lastAnnouncedAt=0;
      container.dataset.announcements='0';
      $last.textContent='还没有提醒。你只管专注呼吸。';
      Object.assign(preferences,DEFAULTS);
      const cleared=clearMeditationPreferences();
      lastRendered='';updateSettings();
      return cleared;
    },
    dispose(){
      if(disposed)return;
      disposed=true;clearInterval(timer);releaseWakeLock();stopAudio();events.abort();
      if(context)void context.close().catch(()=>{});
      container.replaceChildren();container.hidden=true;
    },
  };
}
