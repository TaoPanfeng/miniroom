import { DEFAULTS, loadState, saveState, loadPhoto, savePhoto, validateBackup } from './storage.js';
import { RoomAudio } from './audio.js';
import { initRoomSwitcher } from './room-switcher.js';

const $ = id => document.getElementById(id);
const state = loadState();
const audio = new RoomAudio();
const objectNames = { lamp: '台灯 · 开关暖光', books: '书架 · 留下一点想法', plant: '绿植 · 慢慢长大', photo: '相框 · 装进喜欢的瞬间', laptop: '电脑 · 开始专注', cat: '小满 · 来摸摸我', window: '窗边 · 换一场晴雨' };
const moodNames = { day: ['i-sun', '阳光正好'], rain: ['i-rain', '雨落窗边'], night: ['i-moon', '留一盏暖光'] };
let room;
let photoData = null;
let photoStorageAvailable = true;
let photoBusy = false;
let toastTimeout;
let saveWarningShown = false;
let noteTimeout;
let activeConfirmation;

function icon(button, name) { button.querySelector('use')?.setAttribute('href', `#${name}`); }
function toast(message, timeout = 3600) {
  clearTimeout(toastTimeout);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimeout = setTimeout(() => { $('toast').hidden = true; }, timeout);
}

function persist() {
  const saved = saveState(state);
  $('saveStatus').lastChild.textContent = saved ? '小屋的记忆，留在本机' : '本次改变尚未保存，请导出存档';
  if (!saved && !saveWarningShown) {
    saveWarningShown = true;
    toast('浏览器暂时无法保存设置。本次仍可使用，请及时导出存档。', 5500);
  }
  return saved;
}

function applyState() {
  document.body.dataset.mood = state.mood;
  $('roomTitle').textContent = state.roomName;
  document.title = `${document.body.dataset.room === 'gallery' ? '照片小屋' : state.roomName} · 栖间 miniroom`;
  const [symbol, text] = moodNames[state.mood];
  icon($('moodBadge'), symbol);
  $('moodBadge').querySelector('span').textContent = text;
  document.querySelectorAll('[data-mood-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.moodChoice === state.mood)));
  document.querySelectorAll('[data-accent]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.accent.toLowerCase() === state.accent.toLowerCase())));
  document.querySelector('[data-object="lamp"]').setAttribute('aria-pressed', String(state.lamp));
  $('volumeInput').value = state.volume;
  $('volumeOutput').value = `${state.volume}%`;
  $('noteTeaser').textContent = state.bookTitle.trim().split('\n')[0] || (state.notes ? '你的想法，已经好好收着' : '留下一点今天的想法');
  $('wateringCount').textContent = state.watering ? `你已经照顾它 ${state.watering} 次了` : '还没有浇过水';
  $('catCount').textContent = state.catPats ? `收到你的 ${state.catPats} 次温柔摸摸` : '今天也可以，什么都不着急。';
  room?.setMode(state.mood === 'night' ? 'night' : 'day');
  room?.setRain(state.mood === 'rain');
  room?.setLamp(state.lamp);
  room?.setAccent(state.accent);
  audio.setRain(state.mood === 'rain');
  audio.setVolume(state.volume);
}

function setMood(mood) {
  state.mood = mood;
  if (mood === 'night') state.lamp = true;
  applyState();
  persist();
  if (mood === 'rain' && !audio.enabled) toast('窗外开始下雨了。点击右上角声音按钮，可以听见雨声。');
}

function openDialog(id) {
  $('objectTooltip').hidden = true;
  if (id === 'settingsDialog') $('roomNameInput').value = state.roomName;
  if (id === 'booksDialog') {
    $('bookTitleInput').value = state.bookTitle;
    $('noteInput').value = state.notes;
    $('noteCount').value = `${state.notes.length} / 8000`;
  }
  if (id === 'photoDialog') updatePhotoPreview();
  if (!$(id).open) $(id).showModal();
}

// 原生 dialog 负责键盘焦点与 Escape，背景点击也可关闭。
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    document.querySelectorAll('.object-dock .selected').forEach(button => button.classList.remove('selected'));
    if (dialog.id === 'booksDialog') storeNotes(false);
  });
});

function confirmChange(message, title = '确认这个小改变？') {
  if (activeConfirmation) activeConfirmation(false);
  $('confirmText').textContent = message;
  $('confirmTitle').textContent = title;
  return new Promise(resolve => {
    activeConfirmation = resolve;
    $('confirmDialog').showModal();
  });
}
function finishConfirmation(result) {
  const resolve = activeConfirmation;
  activeConfirmation = undefined;
  $('confirmDialog').close();
  resolve?.(result);
}
$('confirmAccept').addEventListener('click', () => finishConfirmation(true));
$('confirmCancel').addEventListener('click', () => finishConfirmation(false));
$('confirmDialog').addEventListener('close', () => {
  const resolve = activeConfirmation;
  activeConfirmation = undefined;
  resolve?.(false);
});

function selectObject(id) {
  document.querySelectorAll('.object-dock button').forEach(button => button.classList.toggle('selected', button.dataset.object === id));
  if (id === 'lamp') {
    state.lamp = !state.lamp;
    applyState(); persist();
    toast(state.lamp ? '灯亮了，留一盏暖光给自己。' : '台灯关好了。');
  } else if (id === 'window') {
    setMood(state.mood === 'rain' ? 'day' : 'rain');
  } else if (id === 'laptop') {
    $('focusCard').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
    $('focusCard').classList.add('highlight');
    $('focusStart').focus({ preventScroll: true });
    setTimeout(() => $('focusCard').classList.remove('highlight'), 1600);
    toast('为接下来的一小段时间，选一件想做的事。');
  } else {
    const dialogs = { books: 'booksDialog', plant: 'plantDialog', photo: 'photoDialog', cat: 'catDialog' };
    if (dialogs[id]) openDialog(dialogs[id]);
  }
  if (['lamp', 'laptop', 'window'].includes(id)) setTimeout(() => document.querySelector(`[data-object="${id}"]`)?.classList.remove('selected'), 1000);
}

document.querySelectorAll('[data-object]').forEach(button => button.addEventListener('click', () => selectObject(button.dataset.object)));
document.querySelectorAll('[data-mood-choice]').forEach(button => button.addEventListener('click', () => setMood(button.dataset.moodChoice)));
document.querySelectorAll('[data-accent]').forEach(button => button.addEventListener('click', () => {
  state.accent = button.dataset.accent;
  applyState(); persist();
}));
$('helpBtn').addEventListener('click', () => openDialog('helpDialog'));
$('settingsBtn').addEventListener('click', () => openDialog('settingsDialog'));
$('quickNotesBtn').addEventListener('click', () => openDialog('booksDialog'));
$('viewReset').addEventListener('click', () => { room?.resetView(); toast('回到最初的角度。'); });
$('retryBtn').addEventListener('click', () => location.reload());

$('audioToggle').addEventListener('click', async () => {
  const button = $('audioToggle');
  button.disabled = true;
  try {
    await audio.setEnabled(!audio.enabled);
    button.setAttribute('aria-pressed', String(audio.enabled));
    const label = audio.enabled ? '关闭环境声音' : '开启环境声音';
    button.setAttribute('aria-label', label);
    button.title = label;
    icon(button, audio.enabled ? 'i-volume' : 'i-mute');
    if (audio.enabled && state.mood !== 'rain') toast('声音已开启。切换到「听雨」时会响起雨声。');
    else toast(audio.enabled ? '听，雨落在窗边。' : '安静下来，也很好。');
  } catch (error) { toast(error.message || '声音暂时无法开启，请稍后重试。'); }
  finally { button.disabled = false; }
});

$('volumeInput').addEventListener('input', event => {
  state.volume = Number(event.target.value);
  $('volumeOutput').value = `${state.volume}%`;
  audio.setVolume(state.volume);
  persist();
});
$('saveSettingsBtn').addEventListener('click', () => {
  const name = $('roomNameInput').value.trim();
  if (!name) { $('roomNameInput').focus(); toast('给小屋写一个名字吧。'); return; }
  state.roomName = name.slice(0, 30);
  applyState();
  if (persist()) toast('小屋有了新名字。');
  $('settingsDialog').close();
});
$('resetLookBtn').addEventListener('click', async () => {
  if (!await confirmChange('名字、氛围、沙发颜色、灯光和音量会恢复默认。书架笔记、照片与互动记录都会保留。')) return;
  ['roomName', 'mood', 'lamp', 'accent', 'volume'].forEach(key => { state[key] = DEFAULTS[key]; });
  $('roomNameInput').value = state.roomName;
  applyState();
  room?.resetView();
  if (persist()) toast('回到最初的温暖模样，记忆都还在。');
});

function storeNotes(showFeedback) {
  clearTimeout(noteTimeout);
  state.bookTitle = $('bookTitleInput').value.slice(0, 160);
  state.notes = $('noteInput').value.slice(0, 8000);
  $('noteCount').value = `${state.notes.length} / 8000`;
  applyState();
  const saved = persist();
  if (showFeedback && saved) toast('这一页，已经好好收着了。');
}
for (const id of ['bookTitleInput', 'noteInput']) {
  $(id).addEventListener('input', () => {
    $('noteCount').value = `${$('noteInput').value.length} / 8000`;
    clearTimeout(noteTimeout);
    noteTimeout = setTimeout(() => storeNotes(false), 500);
  });
}
$('saveNotesBtn').addEventListener('click', () => { storeNotes(true); $('booksDialog').close(); });

$('waterBtn').addEventListener('click', () => {
  if (state.watering >= 1000000) return;
  state.watering++;
  applyState(); persist();
  const illustration = $('plantIllustration');
  illustration.classList.remove('watering');
  void illustration.offsetWidth;
  illustration.classList.add('watering');
  $('waterBtn').disabled = true;
  setTimeout(() => { illustration.classList.remove('watering'); $('waterBtn').disabled = false; }, 1600);
  toast('一点水，一点耐心。小绿意谢谢你的照顾。');
});

const catMessages = ['呼噜呼噜……你来啦，我就很开心。', '我负责打盹，你负责慢慢来。', '今天做得很好啦。来，靠近一点。', '再忙，也别忘了给自己一个小休息。', '小屋里的阳光，有你的一半，也有我的一半。', '书可以慢慢读，日子也可以慢慢过。'];
$('petCatBtn').addEventListener('click', () => {
  state.catPats = Math.min(state.catPats + 1, 1000000);
  $('catMessage').textContent = catMessages[state.catPats % catMessages.length];
  applyState(); persist();
  const illustration = $('catIllustration');
  illustration.classList.remove('petted');
  void illustration.offsetWidth;
  illustration.classList.add('petted');
  setTimeout(() => illustration.classList.remove('petted'), 1100);
});

// 用绝对结束时间计算倒计时，标签页在后台时也不会逐秒累积误差。
const TIMER_KEY = 'miniroom-focus-v1';
let timer = { total: state.focusMinutes * 60, remaining: state.focusMinutes * 60, deadline: null, finished: false };
try {
  const saved = JSON.parse(localStorage.getItem(TIMER_KEY) || 'null');
  if (saved && [900, 1500, 2700].includes(saved.total) && Number.isFinite(saved.remaining) && saved.remaining >= 0 && saved.remaining <= saved.total && (saved.deadline === null || (Number.isFinite(saved.deadline) && saved.deadline <= Date.now() + saved.total * 1000))) {
    timer = { total: saved.total, remaining: saved.remaining, deadline: saved.deadline, finished: Boolean(saved.finished) };
    state.focusMinutes = saved.total / 60;
  }
} catch { /* 存储不可用不影响本次计时。 */ }
function persistTimer() { try { localStorage.setItem(TIMER_KEY, JSON.stringify(timer)); } catch { /* 计时仍在当前页面工作。 */ } }
function remainingSeconds() { return timer.deadline ? Math.max(0, Math.ceil((timer.deadline - Date.now()) / 1000)) : timer.remaining; }
function renderTimer() {
  const remaining = remainingSeconds();
  const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
  const seconds = String(remaining % 60).padStart(2, '0');
  $('timerDisplay').replaceChildren(document.createTextNode(minutes), Object.assign(document.createElement('span'), { textContent: ':' }), document.createTextNode(seconds));
  $('timerDisplay').setAttribute('aria-label', `专注剩余 ${Math.floor(remaining / 60)} 分 ${remaining % 60} 秒`);
  $('focusStart').querySelector('span').textContent = timer.deadline ? '暂停专注' : timer.finished ? '再来一段' : timer.remaining < timer.total ? '继续专注' : '开始专注';
  icon($('focusStart'), timer.deadline ? 'i-pause' : 'i-play');
  $('focusTag').textContent = timer.deadline ? '进行中' : timer.finished ? '完成啦' : timer.remaining < timer.total ? '歇一会儿' : '慢慢来';
  $('timerDescription').textContent = timer.deadline ? '这一刻，专心做眼前的小事。' : timer.finished ? '做得很好。看看远处，休息一下。' : timer.remaining < timer.total ? '准备好了，就接着来。' : '只做一件事，就很好。';
  $('timerProgress').style.width = `${(1 - remaining / timer.total) * 100}%`;
  $('focusCard').classList.toggle('is-running', Boolean(timer.deadline));
  document.querySelectorAll('[data-minutes]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.minutes) === timer.total / 60)));
}
function completeTimer() {
  timer.deadline = null;
  timer.remaining = 0;
  timer.finished = true;
  persistTimer(); renderTimer();
  audio.chime();
  toast('这一段专注完成了。辛苦啦，起来活动一下吧。', 6500);
}
function resetTimer() {
  timer = { total: state.focusMinutes * 60, remaining: state.focusMinutes * 60, deadline: null, finished: false };
  persistTimer(); renderTimer();
}
$('focusStart').addEventListener('click', () => {
  if (timer.deadline) {
    timer.remaining = remainingSeconds();
    timer.deadline = null;
    if (!timer.remaining) { completeTimer(); return; }
  } else {
    if (!timer.remaining || timer.finished) { timer.remaining = timer.total; timer.finished = false; }
    timer.deadline = Date.now() + timer.remaining * 1000;
  }
  persistTimer(); renderTimer();
});
$('focusReset').addEventListener('click', async () => {
  if ((timer.deadline || timer.remaining < timer.total) && !timer.finished && !await confirmChange('当前这一段计时会重新开始，其他小屋内容不会改变。', '重新开始这一段？')) return;
  resetTimer();
});
document.querySelectorAll('[data-minutes]').forEach(button => button.addEventListener('click', async () => {
  const minutes = Number(button.dataset.minutes);
  if (timer.total === minutes * 60) return;
  if ((timer.deadline || timer.remaining < timer.total) && !timer.finished && !await confirmChange('切换时长会结束当前计时，并准备一段新的专注时间。', '换一个专注时长？')) return;
  state.focusMinutes = minutes;
  persist(); resetTimer();
}));
const timerInterval = setInterval(() => {
  if (!timer.deadline) return;
  if (remainingSeconds() === 0) completeTimer();
  else if (!document.hidden) renderTimer();
}, 500);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (timer.deadline && remainingSeconds() === 0) completeTimer(); else renderTimer(); } });

function updatePhotoPreview() {
  $('photoPreview').hidden = !photoData;
  $('photoPlaceholder').hidden = Boolean(photoData);
  if (photoData) $('photoPreview').src = photoData;
  else $('photoPreview').removeAttribute('src');
  $('removePhotoBtn').disabled = photoBusy || !photoData;
}
// 照片、存档共用操作锁，避免较慢的照片读取覆盖后发起的导入操作。
function setPhotoBusy(value) {
  photoBusy = value;
  for (const id of ['uploadPhotoBtn', 'importBtn', 'exportBtn']) $(id).disabled = value;
  $('removePhotoBtn').disabled = value || !photoData;
}
function decodeImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => image.naturalWidth > 0 && image.naturalHeight > 0 ? resolve(image) : reject(new Error('图片是空的，请换一张。'));
    image.onerror = () => reject(new Error('图片无法解码，请使用有效的 JPG、PNG 或 WebP。'));
    image.src = source;
  });
}
async function resizePhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片。');
  if (file.size > 15 * 1024 * 1024) throw new Error('照片超过 15 MB，请选一张小一点的图片。');
  const objectURL = URL.createObjectURL(file);
  try {
    const image = await decodeImage(objectURL);
    const scale = Math.min(900 / Math.max(image.naturalWidth, image.naturalHeight), 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器暂时无法处理图片，请稍后再试。');
    context.fillStyle = '#f3ead9'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .85);
  } finally { URL.revokeObjectURL(objectURL); }
}
$('uploadPhotoBtn').addEventListener('click', () => $('photoInput').click());
$('photoInput').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (photoBusy) { event.target.value = ''; return; }
  setPhotoBusy(true);
  try {
    const resized = await resizePhoto(file);
    // 先确认场景能显示，再提交到持久存储；保存失败时还原画面。
    await room?.setPhoto(resized);
    try { await savePhoto(resized); }
    catch (error) { await room?.setPhoto(photoData).catch(() => {}); throw error; }
    photoData = resized;
    photoStorageAvailable = true;
    updatePhotoPreview();
    toast('喜欢的瞬间，已经放进相框，只保存在本机。');
  } catch (error) { toast(error.message || '照片没有保存，请稍后再试。', 5000); }
  finally { setPhotoBusy(false); event.target.value = ''; }
});
$('removePhotoBtn').addEventListener('click', async () => {
  if (photoBusy || !photoData) return;
  setPhotoBusy(true);
  try {
    if (!await confirmChange('本浏览器保存的相框照片会移除，恢复为默认山景。电脑上的原始照片不会改变。', '恢复默认画作？')) return;
    await room?.setPhoto(null);
    try { await savePhoto(null); }
    catch (error) { await room?.setPhoto(photoData).catch(() => {}); throw error; }
    photoData = null;
    photoStorageAvailable = true;
    updatePhotoPreview();
    toast('相框换回了温柔的山景。');
  } catch (error) { toast(error.message || '照片暂时无法移除。'); }
  finally { setPhotoBusy(false); }
});

function downloadFile(data, name, mimeType) {
  const url = typeof data === 'string' && data.startsWith('data:') ? data : URL.createObjectURL(new Blob([data], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name;
  document.body.append(anchor); anchor.click(); anchor.remove();
  if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 1500);
}
const dateStamp = () => new Date().toLocaleDateString('en-CA').replace(/[^\d-]/g, '-');
$('screenshotBtn').addEventListener('click', () => {
  if (!room) { toast('请等小屋加载完成后再拍照。'); return; }
  try {
    const source = room.snapshot();
    // 将透明画布合成在当前背景上，导出的 PNG 和页面观感一致。
    decodeImage(source).then(image => {
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context.fillStyle = getComputedStyle(document.body).backgroundColor;
      context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0);
      downloadFile(canvas.toDataURL('image/png'), `miniroom-${dateStamp()}.png`);
      toast('小屋的这一刻，已生成 PNG 截图。');
    }).catch(() => toast('截图没有生成，请稍后再试。'));
  } catch { toast('截图没有生成，请稍后再试。'); }
});
$('exportBtn').addEventListener('click', async () => {
  if (photoBusy) return;
  setPhotoBusy(true);
  try {
    // 使用已读取的内存副本，照片存储不可用时也允许带走笔记和设置。
    const backup = { format: 'miniroom-backup', version: 1, exportedAt: new Date().toISOString(), state: { ...state }, photo: photoData };
    downloadFile(JSON.stringify(backup, null, 2), `miniroom-backup-${dateStamp()}.json`, 'application/json');
    toast(photoStorageAvailable ? '存档已生成。里面有你的笔记与照片，请妥善保管。' : '设置与笔记已导出。照片存储不可用，本次存档不含无法读取的照片。', 5500);
  } catch (error) { toast(error.message || '存档没有导出，请稍后再试。'); }
  finally { setPhotoBusy(false); }
});
$('importBtn').addEventListener('click', () => $('backupInput').click());
$('backupInput').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (photoBusy) { event.target.value = ''; return; }
  setPhotoBusy(true);
  try {
    if (file.size > 3 * 1024 * 1024) throw new Error('存档超过 3 MB，请选择从本小屋导出的 JSON 文件。');
    let parsed;
    try { parsed = JSON.parse(await file.text()); } catch { throw new Error('存档不是有效的 JSON 文件，当前小屋没有更改。'); }
    const backup = validateBackup(parsed);
    if (backup.photo) await decodeImage(backup.photo);
    if (!await confirmChange('这份存档会替换当前的名字、氛围、笔记、照片和互动记录，并重置专注计时。建议先导出当前存档。', '把这间小屋搬进来？')) return;
    const previous = { ...state };
    const previousPhoto = photoData;
    let photoSkipped = false;
    await room?.setPhoto(backup.photo);
    if (!saveState(backup.state)) {
      await room?.setPhoto(previousPhoto).catch(() => {});
      throw new Error('浏览器无法保存设置，导入已取消，当前小屋没有更改。');
    }
    try { await savePhoto(backup.photo); photoStorageAvailable = true; }
    catch (error) {
      await room?.setPhoto(previousPhoto).catch(() => {});
      if (backup.photo !== null) {
        const restored = saveState(previous);
        if (!restored) throw new Error('照片导入失败，设置回滚也未能保存。请立即导出当前内存存档备份后再刷新。');
        throw error;
      }
      // 没有照片的存档仍可导入文本；无法访问的原照片不作删除。
      photoSkipped = true;
      photoStorageAvailable = false;
    }
    Object.assign(state, backup.state);
    photoData = photoSkipped ? previousPhoto : backup.photo;
    $('roomNameInput').value = state.roomName;
    applyState(); updatePhotoPreview(); resetTimer();
    toast(photoSkipped ? '设置和笔记已导入。照片存储暂不可用，原相框照片未改动。' : '欢迎回来。存档里的小屋，已经准备好了。', 5500);
  } catch (error) { toast(error.message || '导入没有完成，请检查存档文件。', 5500); }
  finally { setPhotoBusy(false); event.target.value = ''; }
});

applyState();
renderTimer();
if (timer.deadline && remainingSeconds() === 0) completeTimer();
const roomSwitcher = initRoomSwitcher({
  getStudyName: () => state.roomName,
  notify: toast,
  onChange(current) {
    room?.setPaused(current === 'gallery');
    audio.setSuspended(current === 'gallery');
  },
});

async function initializeRoom() {
  setPhotoBusy(true);
  const options = canvas => ({
    canvas,
    onSelect: selectObject,
    onHover(id, position) {
      const tooltip = $('objectTooltip');
      tooltip.hidden = !id;
      if (!id) return;
      tooltip.textContent = objectNames[id] || '';
      const bounds = $('canvasWrap').getBoundingClientRect();
      tooltip.style.left = `${Math.max(8, Math.min(position.x - bounds.left + 14, bounds.width - 190))}px`;
      tooltip.style.top = `${Math.max(8, Math.min(position.y - bounds.top - 37, bounds.height - 40))}px`;
    },
    onReady() {
      $('loadingIndicator').classList.add('done');
      setTimeout(() => { $('loadingIndicator').hidden = true; }, 500);
    },
  });
  try {
    const { createRoom } = await import('./room.js');
    try { room = createRoom(options($('roomCanvas'))); }
    catch (error) {
      if (!/webgl|creating.*context|context.*creat/i.test(error.message || '')) throw error;
      // 已申请过 WebGL 的画布不能可靠地切到 2D，替换节点再启动兼容绘制。
      const previousCanvas = $('roomCanvas');
      const canvas = previousCanvas.cloneNode(false);
      previousCanvas.replaceWith(canvas);
      const { createRoomLite } = await import('./room-lite.js');
      room = createRoomLite(options(canvas));
      canvas.setAttribute('aria-label', '轻量小屋画面，拖动微调角度，滚轮缩放。下方物品按钮提供完整互动。');
      $('renderModeBadge').hidden = false;
      $('renderModeNotice').hidden = false;
      $('sceneHintText').textContent = '拖动微调角度 · 滚轮缩放 · 点击物品发现小惊喜';
      console.info('Miniroom: WebGL unavailable; using the Canvas lightweight renderer.');
    }
    applyState();
    room.setPaused(roomSwitcher.current === 'gallery');
  } catch (error) {
    $('loadingIndicator').hidden = true;
    $('sceneError').hidden = false;
    $('sceneErrorText').textContent = location.protocol === 'file:'
      ? '请使用项目里的 start.bat 或 start.sh 启动小屋，浏览器直接打开 HTML 无法加载三维模块。'
      : '请确认浏览器支持 WebGL 并开启图形加速。若刚更新过小屋，请刷新页面，或换用较新的 Chrome、Edge、Firefox、Safari。';
    console.error('Miniroom could not initialize:', error);
  }
  try {
    const savedPhoto = await loadPhoto();
    if (savedPhoto) await decodeImage(savedPhoto);
    photoData = savedPhoto;
    photoStorageAvailable = true;
    try { if (photoData) await room?.setPhoto(photoData); }
    catch { toast('照片存档已经读取，画面暂时无法更新。原照片仍保存在本机。', 5000); }
  } catch (error) {
    photoStorageAvailable = false;
    toast(error.message || '相框照片暂时无法读取；设置和笔记仍可使用及导出。', 5000);
  } finally { setPhotoBusy(false); updatePhotoPreview(); }
}
initializeRoom();
window.addEventListener('pagehide', event => {
  if ($('booksDialog').open) storeNotes(false);
  persistTimer();
  if (!event.persisted) { clearInterval(timerInterval); roomSwitcher.dispose(); audio.dispose(); room?.dispose(); }
});
