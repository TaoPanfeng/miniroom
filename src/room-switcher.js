/** 两间小屋共享入口，书房状态与照片小屋的媒体数据各自保存。 */
export function initRoomSwitcher({ getStudyName, onChange, notify, onRequestStorage = () => {} }) {
  const button = document.getElementById('roomSwitcherBtn');
  const picker = document.getElementById('roomPickerDialog');
  const study = document.getElementById('studyRoomView');
  const galleryHost = document.getElementById('galleryRoomView');
  const choices = [...picker.querySelectorAll('[data-room-choice]')];
  const key = 'miniroom-current-room-v1';
  let current = 'study';
  let gallery = null;
  let switching = false;
  let disposed = false;

  function paint() {
    document.body.dataset.room = current;
    document.getElementById('currentRoomLabel').textContent = current === 'gallery' ? '照片小屋' : '书房';
    button.setAttribute('aria-label', `切换小屋，当前在${current === 'gallery' ? '照片小屋' : '书房'}`);
    document.getElementById('studyChoiceName').textContent = getStudyName();
    for (const choice of choices) {
      const active = choice.dataset.roomChoice === current;
      choice.setAttribute('aria-pressed', String(active));
      choice.querySelector('.room-choice-status').textContent = active ? '当前小屋' : '进入小屋';
    }
    document.getElementById('helpBtn').hidden = current === 'gallery';
    document.getElementById('settingsBtn').hidden = current === 'gallery';
    document.title = `${current === 'gallery' ? '照片小屋' : getStudyName()} · 栖间 miniroom`;
  }

  async function enter(next, { restore = false } = {}) {
    if (disposed || switching || next === current) { picker.close(); return false; }
    switching = true;
    button.disabled = true;
    choices.forEach(choice => { choice.disabled = true; });
    picker.close();
    const previous = current;
    try {
      if (next === 'gallery') {
        if (!gallery) {
          const { createGallery } = await import('./gallery.js');
          if (disposed) return false;
          gallery = createGallery({ container: galleryHost, notify, onRequestStudy: () => enter('study'), onRequestStorage });
        }
        // open() 会同步显示加载状态；同一轮隐藏书房，慢存储时也不叠出两间小屋。
        const opening = gallery.open();
        study.hidden = true;
        current = 'gallery';
        paint();
        onChange(current);
        if (!await opening) throw new Error('照片小屋暂时没有打开，请重新尝试。');
      } else {
        if (gallery && !gallery.close()) return false;
        study.hidden = false;
        current = 'study';
        paint();
        onChange(current);
      }
      try { localStorage.setItem(key, current); } catch { /* 切换本身不依赖可写存储。 */ }
      if (!restore) window.scrollTo({ top: 0, behavior: 'instant' });
      button.focus({ preventScroll: true });
      return true;
    } catch (error) {
      if (previous === 'study') {
        gallery?.close(); study.hidden = false; galleryHost.hidden = true;
        current = previous; paint(); onChange(current);
      }
      notify(error.message || '这间小屋暂时没有打开，请刷新后重试。', 5500);
      return false;
    } finally {
      switching = false;
      button.disabled = false;
      choices.forEach(choice => { choice.disabled = false; });
    }
  }

  const openPicker = () => { paint(); if (!picker.open) picker.showModal(); };
  button.addEventListener('click', openPicker);
  const handlers = choices.map(choice => {
    const handler = () => enter(choice.dataset.roomChoice);
    choice.addEventListener('click', handler);
    return [choice, handler];
  });
  paint();
  try { if (localStorage.getItem(key) === 'gallery') enter('gallery', { restore: true }); } catch { /* 默认进入书房。 */ }

  return {
    get current() { return current; },
    get busy() { return switching || Boolean(gallery?.busy); },
    async refreshStorage(cleared = []) {
      if (disposed) return;
      paint();
      if (gallery && cleared.includes('gallery')) await gallery.refreshStorage();
      if (!disposed) paint();
    },
    dispose() {
      disposed = true;
      gallery?.dispose();
      button.removeEventListener('click', openPicker);
      handlers.forEach(([choice, handler]) => choice.removeEventListener('click', handler));
    },
  };
}
