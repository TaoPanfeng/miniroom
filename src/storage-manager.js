const SCOPES = {
  gallery: {
    title: '仅照片小屋', name: '照片小屋',
    description: '照片原片、视频、缩略图与裁剪图',
    confirmation: '照片墙里的照片、视频和裁剪结果会从当前浏览器移除。',
    icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
  },
  study: {
    title: '仅书房数据', name: '书房数据',
    description: '相框照片、书架笔记、设置与专注计时',
    confirmation: '书房的相框照片、笔记、设置、专注计时与互动记录会清空，恢复初始状态。',
    icon: '<path d="M4 4h6v16H4zM10 4h5v16h-5zM16 5l4-1 3 15-4 1zM6 8h2m4 7h1"/>',
  },
  all: {
    title: '全部小屋数据', name: '全部小屋数据',
    description: '一起清理照片小屋与书房',
    confirmation: '照片小屋与书房在当前浏览器保存的数据都会清理。书房恢复初始状态，照片墙变为空白。',
    icon: '<path d="m3 10 9-7 9 7v11H3Z"/><path d="M9 21v-8h6v8"/>',
  },
};
let managerSequence = 0;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function svg(paths) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
}
function isSize(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function formatBytes(bytes) {
  if (!isSize(bytes)) return '占用待确认';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
function errorMessage(error, fallback) {
  const message = typeof error === 'string' ? error : error?.message;
  return typeof message === 'string' && message.trim() ? message.trim() : fallback;
}
function normalizeOverview(value) {
  const overview = {};
  for (const scope of ['gallery', 'study']) {
    const data = value?.[scope];
    overview[scope] = data && !data.error && isSize(data.bytes)
      ? data
      : { ...data, error: errorMessage(data?.error, '暂时无法读取本机数据。') };
  }
  overview.totalBytes = !overview.gallery.error && !overview.study.error
    ? (isSize(value?.totalBytes) ? value.totalBytes : overview.gallery.bytes + overview.study.bytes)
    : null;
  return overview;
}

/** Independent native dialog; storage is read and changed only through the supplied callbacks. */
export function initStorageManager({ trigger, getOverview, clearData, canClear = () => true, notify = () => {} }) {
  if (!(trigger instanceof HTMLElement) || typeof getOverview !== 'function' || typeof clearData !== 'function') {
    throw new Error('本机存储管理缺少入口或存储接口。');
  }
  const events = new AbortController();
  const originalAttributes = new Map(['aria-haspopup', 'aria-expanded', 'aria-controls'].map(name => [name, trigger.getAttribute(name)]));
  const id = `storageManager${++managerSequence}`;
  let dialog = null, refs = null, overview = null, selectedScope = null, previousFocus = null;
  let disposed = false, busy = false, reading = false, readVersion = 0;
  const on = (node, type, handler) => node.addEventListener(type, handler, { signal: events.signal });
  const report = message => { try { notify(message, 6000); } catch { /* The inline message remains available. */ } };

  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', id);
  trigger.setAttribute('aria-expanded', 'false');
  on(trigger, 'click', () => { void open(); });

  function ensureDialog() {
    if (dialog) return;
    dialog = element('dialog', 'sm-dialog'); dialog.id = id;
    dialog.setAttribute('aria-labelledby', `${id}Title`);
    dialog.setAttribute('aria-describedby', `${id}Intro`);
    dialog.innerHTML = `
      <header class="sm-header"><div><p class="sm-kicker">清理缓存与本地存档</p><h2 id="${id}Title">本机存储管理</h2></div><button type="button" class="sm-close icon-button" aria-label="关闭本机存储管理">${svg('<path d="m6 6 12 12M6 18 18 6"/>')}</button></header>
      <p id="${id}Intro" class="sm-intro">只管理当前浏览器保存的两间小屋。</p>
      <div class="sm-overview">
        <div class="sm-total"><div><span>本机数据估算</span><strong class="sm-total-value">正在读取…</strong></div><button type="button" class="sm-refresh secondary-button">${svg('<path d="M20 7a9 9 0 1 0 1 8M20 3v5h-5"/>')}<span>刷新统计</span></button></div>
        <div class="sm-read-errors" role="status" hidden><strong>部分占用暂时无法读取</strong><ul></ul><p>可重试读取，也可继续选择清理范围。</p></div>
        <div class="sm-result" role="status" aria-live="polite" tabindex="-1" hidden><strong></strong><p></p><ul></ul></div>
        <p class="sm-section-label">选择清理范围</p>
        <div class="sm-scopes">${Object.entries(SCOPES).map(([scope, info]) => `<button type="button" class="sm-scope" data-sm-scope="${scope}"><span class="sm-scope-icon">${svg(info.icon)}</span><span class="sm-scope-copy"><strong>${info.title}</strong><span class="sm-scope-detail"></span><small>${info.description}</small></span><span class="sm-scope-size"></span><span class="sm-scope-arrow" aria-hidden="true">›</span></button>`).join('')}</div>
        <p class="sm-overview-alert sm-inline-alert" role="alert" tabindex="-1" hidden></p>
        <p class="sm-footnote">大小为小屋数据的估算值，不代表浏览器的全部占用。</p>
        <p class="sm-local-note">电脑上的原文件不会删除。<br>书房 JSON 备份不包含照片墙素材。</p>
      </div>
      <div class="sm-confirm" hidden>
        <p class="sm-section-label">已选择清理范围</p><h3 class="sm-confirm-title"></h3><p class="sm-confirm-estimate"></p><p class="sm-confirm-description"></p>
        <div class="sm-warning">${svg('<path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3v.1"/>')}<div><strong>清理后无法撤销</strong><p>这些本机副本会被移除。电脑上的原文件不会删除，请先保留需要的素材和存档。</p></div></div>
        <p class="sm-backup-note">书房 JSON 备份不包含照片墙素材。</p>
        <div class="sm-clearing" role="status" aria-live="polite" hidden><progress aria-label="正在清理本机数据"></progress><p>正在清理，请不要关闭页面…</p></div>
        <p class="sm-confirm-alert sm-inline-alert" role="alert" hidden></p>
        <div class="sm-confirm-actions"><button type="button" class="sm-cancel secondary-button">取消</button><button type="button" class="sm-accept primary-button">确认清理</button></div>
      </div>`;
    document.body.append(dialog);
    const $ = selector => dialog.querySelector(selector);
    refs = {
      close: $('.sm-close'), refresh: $('.sm-refresh'), total: $('.sm-total-value'), overview: $('.sm-overview'),
      errors: $('.sm-read-errors'), result: $('.sm-result'), overviewAlert: $('.sm-overview-alert'),
      confirm: $('.sm-confirm'), confirmTitle: $('.sm-confirm-title'), estimate: $('.sm-confirm-estimate'),
      description: $('.sm-confirm-description'), backup: $('.sm-backup-note'), clearing: $('.sm-clearing'),
      confirmAlert: $('.sm-confirm-alert'), cancel: $('.sm-cancel'), accept: $('.sm-accept'),
      scopes: [...dialog.querySelectorAll('[data-sm-scope]')],
    };
    on(refs.close, 'click', close);
    on(refs.refresh, 'click', () => { void refresh(); });
    on(refs.cancel, 'click', cancelConfirmation);
    on(refs.accept, 'click', () => { void confirmClear(); });
    for (const button of refs.scopes) on(button, 'click', () => selectScope(button.dataset.smScope));
    on(dialog, 'cancel', event => {
      event.preventDefault();
      if (busy) return;
      if (selectedScope) cancelConfirmation(); else close();
    });
    on(dialog, 'click', event => {
      if (event.target !== dialog || busy) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
    });
    on(dialog, 'close', () => {
      trigger.setAttribute('aria-expanded', 'false');
      if (!disposed && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    });
  }

  function detailFor(scope) {
    if (reading) return '正在读取…';
    if (!overview || (scope === 'all' ? overview.gallery.error || overview.study.error : overview[scope].error)) return '占用暂时无法读取';
    if (scope === 'all') return '照片小屋 + 书房数据';
    const data = overview[scope];
    if (scope === 'gallery') {
      return Number.isInteger(data.count) && Number.isInteger(data.images) && Number.isInteger(data.videos)
        ? `${data.count} 项 · ${data.images} 张照片 · ${data.videos} 段视频` : '照片与视频数量待确认';
    }
    return [['相框', data.hasPhoto], ['笔记', data.hasNotes], ['设置', data.hasSettings]]
      .map(([name, exists]) => `${name}：${exists === true ? '有' : exists === false ? '无' : '待确认'}`).join(' · ');
  }
  function sizeFor(scope) {
    if (reading) return '—';
    if (!overview || (scope !== 'all' && overview[scope].error)) return '待确认';
    const bytes = scope === 'all' ? overview.totalBytes : overview[scope].bytes;
    return isSize(bytes) ? formatBytes(bytes) : '待确认';
  }
  function updateControls() {
    if (!refs || disposed) return;
    dialog.setAttribute('aria-busy', String(busy || reading));
    refs.close.disabled = busy; refs.cancel.disabled = busy;
    refs.accept.disabled = busy || reading;
    refs.accept.textContent = busy ? '正在清理…' : '确认清理';
    refs.refresh.disabled = busy || reading;
    refs.refresh.querySelector('span').textContent = reading ? '正在读取' : refs.errors.hidden ? '刷新统计' : '重试读取';
    refs.clearing.hidden = !busy;
    for (const button of refs.scopes) button.disabled = busy || reading;
  }
  function renderOverview() {
    if (!refs || disposed) return;
    refs.total.textContent = reading ? '正在读取…' : overview && isSize(overview.totalBytes) ? formatBytes(overview.totalBytes) : '占用待确认';
    const failures = reading ? [] : ['gallery', 'study'].filter(scope => overview?.[scope].error);
    refs.errors.hidden = !failures.length;
    refs.errors.querySelector('ul').replaceChildren(...failures.map(scope => element('li', '', `${SCOPES[scope].name}：${overview[scope].error}`)));
    for (const button of refs.scopes) {
      const scope = button.dataset.smScope;
      button.querySelector('.sm-scope-detail').textContent = detailFor(scope);
      button.querySelector('.sm-scope-size').textContent = sizeFor(scope);
    }
    if (selectedScope) refs.estimate.textContent = `${detailFor(selectedScope)} · ${sizeFor(selectedScope)}`;
    updateControls();
  }
  async function refresh() {
    if (disposed || busy) return false;
    const version = ++readVersion;
    reading = true; renderOverview();
    try {
      const value = await getOverview();
      if (disposed || version !== readVersion) return false;
      overview = normalizeOverview(value);
    } catch (error) {
      if (disposed || version !== readVersion) return false;
      const message = errorMessage(error, '暂时无法读取本机数据，请重试。');
      overview = normalizeOverview({ gallery: { error: message }, study: { error: message } });
    } finally {
      if (!disposed && version === readVersion) { reading = false; renderOverview(); }
    }
    return !overview.gallery.error && !overview.study.error;
  }
  function permitted(scope) {
    try { return canClear(scope) === true; } catch { return false; }
  }
  function blocked(target) {
    target.textContent = '小屋正在处理内容，完成后再清理。'; target.hidden = false;
    report(target.textContent);
  }
  function selectScope(scope) {
    if (disposed || busy || reading || !SCOPES[scope]) return;
    if (!permitted(scope)) { blocked(refs.overviewAlert); refs.overviewAlert.focus(); return; }
    selectedScope = scope;
    refs.overview.hidden = true; refs.confirm.hidden = false; refs.confirmAlert.hidden = true;
    refs.confirmTitle.textContent = SCOPES[scope].title;
    refs.description.textContent = SCOPES[scope].confirmation;
    refs.backup.hidden = scope === 'study';
    refs.estimate.textContent = `${detailFor(scope)} · ${sizeFor(scope)}`;
    dialog.scrollTop = 0; refs.cancel.focus({ preventScroll: true });
  }
  function cancelConfirmation() {
    if (busy || disposed) return;
    const scope = selectedScope; selectedScope = null;
    refs.confirm.hidden = true; refs.overview.hidden = false; refs.overviewAlert.hidden = true;
    refs.scopes.find(button => button.dataset.smScope === scope)?.focus({ preventScroll: true });
  }
  function renderResult(result, requested) {
    const scopes = requested === 'all' ? ['gallery', 'study'] : [requested];
    const cleared = new Set((Array.isArray(result?.cleared) ? result.cleared : []).filter(scope => scope === 'gallery' || scope === 'study'));
    const failed = new Map();
    for (const failure of Array.isArray(result?.failed) ? result.failed : []) {
      if (failure?.scope === 'gallery' || failure?.scope === 'study' || failure?.scope === 'all') {
        failed.set(failure.scope, errorMessage(failure.message, '未能完成清理，请重试。'));
        cleared.delete(failure.scope);
      }
    }
    for (const scope of scopes) if (!cleared.has(scope) && !failed.has(scope)) failed.set(scope, '清理结果未确认，请刷新统计后重试。');
    const names = [...cleared].map(scope => SCOPES[scope].name).join('、');
    const title = failed.size ? (cleared.size ? '部分数据已清理' : '未能完成清理') : '清理完成';
    const message = cleared.size ? `已清理：${names}。${isSize(result?.bytes) ? `已移除的数据约 ${formatBytes(result.bytes)}，磁盘空间由浏览器回收。` : ''}` : '请查看原因，刷新统计后可以重新尝试。';
    refs.result.hidden = false; refs.result.classList.toggle('sm-result-error', failed.size > 0);
    refs.result.querySelector('strong').textContent = title;
    refs.result.querySelector('p').textContent = message;
    refs.result.querySelector('ul').replaceChildren(...[...failed].map(([scope, reason]) => element('li', '', `${SCOPES[scope].name}未完成：${reason}`)));
    report(`${title}。${message}`);
  }
  async function confirmClear() {
    if (disposed || busy || reading || !selectedScope) return;
    if (!permitted(selectedScope)) { blocked(refs.confirmAlert); refs.cancel.focus(); return; }
    const scope = selectedScope;
    busy = true; refs.confirmAlert.hidden = true; updateControls();
    let result;
    try {
      result = await clearData(scope);
    } catch (error) {
      result = { cleared: [], failed: (scope === 'all' ? ['gallery', 'study'] : [scope]).map(name => ({ scope: name, message: errorMessage(error, '清理未能完成，请重试。') })) };
    } finally { busy = false; }
    if (disposed) return;
    selectedScope = null; refs.confirm.hidden = true; refs.overview.hidden = false; refs.overviewAlert.hidden = true;
    renderResult(result, scope); updateControls();
    dialog.scrollTop = 0; refs.result.focus({ preventScroll: true });
    await refresh();
  }
  function close() {
    if (!busy && dialog?.open) dialog.close();
  }
  async function open() {
    if (disposed) return false;
    ensureDialog();
    if (busy) return false;
    if (!dialog.open) {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : trigger;
      selectedScope = null; refs.overview.hidden = false; refs.confirm.hidden = true;
      refs.result.hidden = true; refs.overviewAlert.hidden = true;
      dialog.showModal(); trigger.setAttribute('aria-expanded', 'true');
      refs.close.focus({ preventScroll: true });
    }
    return refresh();
  }
  function dispose() {
    if (disposed) return;
    disposed = true; ++readVersion; events.abort();
    if (dialog?.open) dialog.close();
    dialog?.remove();
    for (const [name, value] of originalAttributes) {
      if (value === null) trigger.removeAttribute(name); else trigger.setAttribute(name, value);
    }
  }
  return { open, refresh, dispose };
}
