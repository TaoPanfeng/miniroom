import { listMedia, addMediaFiles, getMediaBlob, updateMediaCrop, deleteMedia, getMediaStats, MAX_BATCH_FILES, MAX_ITEMS } from './media-store.js';
import { openImageCrop } from './cropper.js';

const PATHS = {
  plus: '<path d="M12 4v16M4 12h16"/>',
  photo: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
  video: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 8 6 4-6 4Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  select: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/>',
  crop: '<path d="M7 2v15h15M2 7h15v15M17 7l4-4"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  zoom: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 10h6m-3-3v6"/>',
  home: '<path d="m3 10 9-7 9 7v11H3Z"/><path d="M9 21v-8h6v8"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
};
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = PATHS[name] || PATHS.photo;
  return svg;
}
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function button(label, className, symbol) {
  const element = node('button', className); element.type = 'button';
  if (symbol) element.append(icon(symbol));
  element.append(node('span', '', label));
  return element;
}
function formatBytes(bytes = 0) {
  if (bytes < 1024 * 1024) return `${Math.max(0, bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
function formatDuration(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
function bindBackdrop(dialog, close) {
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close();
  });
}

/** 照片小屋是独立视图，不写入书房的设置、笔记或单张相框。 */
export function createGallery({ container, notify = () => {}, onRequestStudy = () => {} }) {
  if (!(container instanceof HTMLElement)) throw new Error('照片小屋缺少容器。');
  let items = [], filter = 'all', sort = 'newest', selecting = false, selected = new Set();
  let active = false, busy = false, disposed = false, loadVersion = 0, dragDepth = 0;
  const thumbnailURLs = new Map();
  let noticeTimer = 0, currentViewer = null, viewerVersion = 0, viewerURL = null;
  let viewerItems = [], viewerIndex = -1, viewerImage = null, viewerVideo = null;
  let zoom = 1, panX = 0, panY = 0, imageWidth = 0, imageHeight = 0, pointer = null;
  let confirmResolve = null;

  container.classList.add('gallery-room');
  container.setAttribute('aria-label', '照片小屋');
  container.innerHTML = `
    <div class="gw-shell">
      <header class="gw-heading">
        <div><p class="gw-eyebrow">ROOM 02 <span></span> MOMENTS TO KEEP</p><h1>照片小屋<span class="gw-title-flower" aria-hidden="true">✳</span></h1><p class="gw-description">把喜欢的瞬间，挂满这一面墙。</p></div>
        <div class="gw-heading-actions"><button type="button" class="gw-add primary-button"><span>添加照片 / 视频</span></button><p class="gw-import-help">可多选，也可以把文件拖进来</p></div>
      </header>
      <input class="gw-file-input" type="file" accept="image/*,video/*" multiple hidden>
      <div class="gw-toolbar">
        <div class="gw-filters" role="group" aria-label="照片墙内容筛选"><button type="button" data-filter="all" aria-pressed="true">全部<span class="gw-all-count">0</span></button><button type="button" data-filter="image" aria-pressed="false">照片<span class="gw-image-count">0</span></button><button type="button" data-filter="video" aria-pressed="false">视频<span class="gw-video-count">0</span></button></div>
        <div class="gw-toolbar-right"><label class="gw-sort-label"><span class="gw-sr-only">照片墙排序</span><select class="gw-sort" aria-label="照片墙排序"><option value="newest">最近添加</option><option value="oldest">最早添加</option><option value="name">按文件名</option></select></label><button type="button" class="gw-select-toggle gw-text-button" aria-pressed="false">多选</button></div>
      </div>
      <div class="gw-selection-bar" hidden><div class="gw-selection-summary" aria-live="polite">已选 0 项</div><div class="gw-selection-actions"><button type="button" class="gw-select-all gw-text-button">全选当前列表</button><button type="button" class="gw-crop-selection gw-small-button">逐张裁剪</button><button type="button" class="gw-delete-selection gw-small-button gw-danger">移除所选</button><button type="button" class="gw-cancel-selection gw-text-button">取消多选</button></div></div>
      <div class="gw-progress" role="status" aria-live="polite" hidden><div><strong class="gw-progress-title">正在整理回忆</strong><span class="gw-progress-count"></span></div><progress max="1" value="0"></progress><p class="gw-progress-file"></p></div>
      <div class="gw-notice" role="status" aria-live="polite" hidden></div>
      <details class="gw-report" hidden><summary></summary><ul></ul></details>
      <div class="gw-load-error" hidden><h2>照片墙暂时没有打开</h2><p></p><button type="button" class="gw-retry secondary-button">重试读取</button><button type="button" class="gw-back-study gw-text-button">回到书房</button></div>
      <div class="gw-wall" aria-label="照片与视频列表">
        <div class="gw-loading" role="status">正在打开照片小屋…</div>
        <div class="gw-empty" hidden>
          <div class="gw-empty-art" aria-hidden="true"><div class="gw-art-frame gw-art-left"><span class="gw-art-mountain"></span><span class="gw-art-sun"></span></div><div class="gw-art-frame gw-art-center"><span class="gw-art-flower">✳</span><span class="gw-art-caption">a little memory</span></div><div class="gw-art-frame gw-art-right"><span class="gw-art-play"></span></div><div class="gw-art-shelf"></div></div>
          <p class="gw-empty-kicker">YOUR WALL, YOUR STORIES</p><h2>第一段回忆，从这里开始。</h2><p>旅行的风景、日常的小事，或一段会动的时光。<br>照片和视频，都可以一起放进来。</p><button type="button" class="gw-empty-add primary-button">选择照片和视频</button><small>一次最多 ${MAX_BATCH_FILES} 项 · 照片 ≤ 30 MB · 视频 ≤ 250 MB</small>
        </div>
        <div class="gw-filter-empty" hidden><span aria-hidden="true">⌁</span><p>这里还没有这类回忆。</p><button type="button" class="gw-show-all gw-text-button">查看全部</button></div>
        <div class="gw-grid"></div>
      </div>
      <footer class="gw-footer"><p class="gw-local-note"></p><span class="gw-storage-stat">本机保存 · 最多 ${MAX_ITEMS} 项</span></footer>
      <p class="gw-storage-detail">照片小屋独立保存在当前浏览器，书房的 JSON 存档不包含这里的素材。原文件保留，裁剪后还能重新调整。</p>
    </div>
    <div class="gw-drop-overlay" hidden><div><span aria-hidden="true">＋</span><h2>把回忆放在这里</h2><p>松开鼠标，添加照片和视频</p></div></div>`;

  const $ = selector => container.querySelector(selector);
  const addButton = $('.gw-add'), input = $('.gw-file-input'), grid = $('.gw-grid');
  const selectToggle = $('.gw-select-toggle'), selectAll = $('.gw-select-all');
  const cropSelection = $('.gw-crop-selection'), deleteSelection = $('.gw-delete-selection');
  const notice = $('.gw-notice'), progress = $('.gw-progress'), report = $('.gw-report');
  addButton.prepend(icon('plus')); selectToggle.prepend(icon('select'));
  cropSelection.prepend(icon('crop')); deleteSelection.prepend(icon('trash'));
  $('.gw-empty-add').prepend(icon('plus'));
  $('.gw-local-note').append(icon('lock'), document.createTextNode('只保存在本机，让回忆留在自己手里。'));

  const viewer = node('dialog', 'gw-viewer');
  viewer.setAttribute('aria-labelledby', 'galleryViewerTitle');
  viewer.innerHTML = `<header class="gw-viewer-header"><div><p class="gw-viewer-kind"></p><h2 id="galleryViewerTitle"></h2></div><button type="button" class="gw-viewer-close gw-round-button" aria-label="关闭大图与视频"></button></header><div class="gw-media-stage"><p class="gw-viewer-message" role="status">正在打开…</p></div><footer class="gw-viewer-footer"><div class="gw-viewer-nav"><button type="button" class="gw-previous gw-round-button" aria-label="上一项"></button><span class="gw-viewer-position"></span><button type="button" class="gw-next gw-round-button" aria-label="下一项"></button></div><p class="gw-viewer-info"></p><div class="gw-viewer-actions"><button type="button" class="gw-viewer-zoom gw-small-button">放大查看</button><button type="button" class="gw-viewer-crop gw-small-button">裁剪这张</button><button type="button" class="gw-viewer-download gw-small-button">下载原文件</button></div></footer>`;
  document.body.append(viewer);
  const v$ = selector => viewer.querySelector(selector), stage = v$('.gw-media-stage');
  v$('.gw-viewer-close').append(icon('close')); v$('.gw-previous').append(icon('left')); v$('.gw-next').append(icon('right'));
  v$('.gw-viewer-zoom').prepend(icon('zoom')); v$('.gw-viewer-crop').prepend(icon('crop')); v$('.gw-viewer-download').prepend(icon('download'));
  const confirmDialog = node('dialog', 'gw-confirm');
  confirmDialog.setAttribute('aria-labelledby', 'galleryConfirmTitle');
  confirmDialog.innerHTML = '<p class="gw-eyebrow">MAKE ROOM FOR MEMORIES</p><h2 id="galleryConfirmTitle">移除所选回忆？</h2><p class="gw-confirm-message"></p><div><button type="button" class="gw-confirm-cancel secondary-button">保留</button><button type="button" class="gw-confirm-accept primary-button">确认移除</button></div>';
  document.body.append(confirmDialog);

  function announce(message, duration = 5000) {
    if (disposed) return;
    clearTimeout(noticeTimer); notice.textContent = message; notice.hidden = false;
    noticeTimer = setTimeout(() => { notice.hidden = true; }, duration);
    if (!active) notify(message, duration);
  }
  function setBusy(value) {
    busy = value;
    if (disposed) return;
    container.setAttribute('aria-busy', String(value));
    addButton.disabled = value; $('.gw-empty-add').disabled = value;
    selectToggle.disabled = value; $('.gw-sort').disabled = value;
    container.querySelectorAll('[data-filter],.gw-cancel-selection,.gw-select-all,.gw-card-open,.gw-check input').forEach(control => { control.disabled = value; });
    updateSelection();
  }
  function filteredItems() {
    const visible = items.filter(item => filter === 'all' || item.type === filter);
    return visible.sort((a, b) => sort === 'name'
      ? a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
      : (Number(a.createdAt) - Number(b.createdAt)) * (sort === 'oldest' ? 1 : -1));
  }
  function cleanupThumbnails() {
    for (const url of thumbnailURLs.values()) URL.revokeObjectURL(url);
    thumbnailURLs.clear();
  }
  function updateSelection() {
    selectToggle.setAttribute('aria-pressed', String(selecting));
    $('.gw-selection-bar').hidden = !selecting;
    container.classList.toggle('gw-selecting', selecting);
    const imageCount = items.filter(item => selected.has(item.id) && item.type === 'image').length;
    $('.gw-selection-summary').textContent = `已选 ${selected.size} 项${imageCount ? ` · ${imageCount} 张照片可裁剪` : ''}`;
    cropSelection.disabled = busy || !imageCount; deleteSelection.disabled = busy || !selected.size;
    selectAll.disabled = busy || !filteredItems().length;
    selectAll.textContent = filteredItems().length && filteredItems().every(item => selected.has(item.id)) ? '取消当前列表选择' : '全选当前列表';
    grid.querySelectorAll('.gw-item').forEach(card => {
      const checked = selected.has(card.dataset.id);
      card.classList.toggle('is-selected', checked);
      const checkbox = card.querySelector('input'); checkbox.checked = checked;
      card.querySelector('.gw-card-open').setAttribute('aria-label', `${selecting ? (checked ? '取消选择' : '选择') : '打开'} ${card.dataset.name}`);
    });
  }
  function toggleSelection(id) {
    if (busy) return;
    selecting = true;
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    updateSelection();
  }
  function renderGrid() {
    cleanupThumbnails(); grid.replaceChildren();
    const visible = filteredItems();
    $('.gw-all-count').textContent = items.length;
    $('.gw-image-count').textContent = items.filter(item => item.type === 'image').length;
    $('.gw-video-count').textContent = items.filter(item => item.type === 'video').length;
    $('.gw-empty').hidden = items.length > 0;
    $('.gw-filter-empty').hidden = !items.length || !!visible.length;
    selectToggle.hidden = !items.length;
    for (const item of visible) {
      const card = node('article', 'gw-item'); card.dataset.id = item.id; card.dataset.name = item.name;
      const opener = button('', 'gw-card-open'); opener.replaceChildren();
      const visual = node('div', 'gw-card-visual');
      const aspect = item.crop ? (item.width * item.crop.width) / (item.height * item.crop.height) : item.width / item.height;
      visual.style.aspectRatio = String(Math.max(.45, Math.min(2.2, aspect || 1.3)));
      if (item.thumb instanceof Blob) {
        const url = URL.createObjectURL(item.thumb); thumbnailURLs.set(item.id, url);
        const image = node('img'); image.src = url; image.alt = item.name; image.loading = 'lazy'; image.decoding = 'async';
        visual.append(image);
      } else { visual.classList.add('gw-card-placeholder'); visual.append(icon(item.type)); }
      if (item.type === 'video') {
        const play = node('span', 'gw-card-play'); play.append(icon('video')); visual.append(play);
        visual.append(node('span', 'gw-video-duration', formatDuration(item.duration)));
      }
      const caption = node('div', 'gw-card-caption');
      caption.append(node('span', 'gw-card-name', item.name));
      const detail = node('span', 'gw-card-type', item.type === 'video' ? 'VIDEO' : item.crop ? 'CROPPED' : 'PHOTO'); caption.append(detail);
      opener.append(visual, caption); opener.addEventListener('click', () => selecting ? toggleSelection(item.id) : openViewer(item.id));
      const label = node('label', 'gw-check');
      const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.setAttribute('aria-label', `选择 ${item.name}`);
      checkbox.addEventListener('change', () => toggleSelection(item.id));
      const mark = node('span', 'gw-check-mark'); mark.append(icon('check'));
      label.append(checkbox, mark); card.append(opener, label); grid.append(card);
    }
    updateSelection();
  }
  async function refreshStats() {
    try {
      const stats = await getMediaStats();
      if (disposed) return;
      $('.gw-storage-stat').textContent = `${stats.count} / ${MAX_ITEMS} 项 · 本机占用 ${formatBytes(stats.bytes)}`;
    } catch { if (!disposed) $('.gw-storage-stat').textContent = `本机保存 · ${items.length} / ${MAX_ITEMS} 项`; }
  }
  async function refresh() {
    const version = ++loadVersion;
    $('.gw-load-error').hidden = true; $('.gw-loading').hidden = false;
    try {
      const loaded = await listMedia();
      if (disposed || version !== loadVersion) return;
      items = loaded; selected = new Set([...selected].filter(id => items.some(item => item.id === id)));
      renderGrid(); await refreshStats();
    } catch (error) {
      if (disposed || version !== loadVersion) return;
      $('.gw-load-error').hidden = false;
      $('.gw-load-error p').textContent = error.message || '浏览器暂时无法读取本地照片，请重试或回到书房。';
      $('.gw-empty').hidden = true; $('.gw-filter-empty').hidden = true;
    } finally { if (!disposed && version === loadVersion) $('.gw-loading').hidden = true; }
  }
  function showImportReport(added, failures) {
    report.hidden = !failures.length;
    if (!failures.length) return;
    report.open = true;
    report.querySelector('summary').textContent = `${added} 项已添加，${failures.length} 项未添加 · 查看原因`;
    const list = report.querySelector('ul'); list.replaceChildren();
    failures.forEach(failure => {
      const row = node('li'); row.append(node('strong', '', failure.name), node('span', '', failure.message)); list.append(row);
    });
  }
  async function importFiles(files) {
    if (busy || !active || disposed || !files.length) return;
    report.hidden = true; notice.hidden = true; setBusy(true); progress.hidden = false;
    $('.gw-progress-title').textContent = '正在把回忆挂上墙';
    const meter = progress.querySelector('progress'); meter.max = files.length; meter.value = 0;
    try {
      const result = await addMediaFiles(files, { onProgress({ current, total, name }) {
        meter.max = total || files.length; meter.value = current;
        $('.gw-progress-count').textContent = `${current} / ${total}`;
        $('.gw-progress-file').textContent = name;
      } });
      await refresh();
      showImportReport(result.added.length, result.failed);
      announce(result.added.length ? `已添加 ${result.added.length} 段回忆。点击可以放大查看或播放，多选后可逐张裁剪。` : '这次没有添加素材，请查看下方原因。', 6500);
    } catch (error) { announce(error.message || '素材没有添加成功，请稍后再试。', 7000); await refresh(); }
    finally { progress.hidden = true; setBusy(false); input.value = ''; }
  }
  async function cropItems(ids) {
    if (busy || disposed) return;
    const photos = ids.map(id => items.find(item => item.id === id)).filter(item => item?.type === 'image');
    if (!photos.length) { announce('选择一张或多张照片后，就可以逐张裁剪。'); return; }
    closeViewer(); setBusy(true); let saved = 0;
    try {
      for (let index = 0; index < photos.length; index++) {
        const item = photos[index], blob = await getMediaBlob(item.id, 'original');
        const result = await openImageCrop({ blob, name: item.name, crop: item.crop, queue: photos.length > 1 ? { index, total: photos.length } : null });
        if (!result) break;
        if (result.action === 'skip') continue;
        const updated = await updateMediaCrop(item.id, { crop: result.crop, display: result.display, thumb: result.thumb });
        items = items.map(existing => existing.id === item.id ? updated : existing); saved++;
      }
      if (saved) announce(`已保存 ${saved} 张照片的裁剪。原图保留，可以随时重新调整。`);
    } catch (error) { announce(`${saved ? `已有 ${saved} 张裁剪保存成功。` : ''}${error.message || '这张照片暂时无法裁剪，请重试。'}`, 7000); }
    finally { setBusy(false); if (active) renderGrid(); await refreshStats(); }
  }
  function askDelete(count) {
    confirmDialog.querySelector('.gw-confirm-message').textContent = `将从这间照片小屋移除 ${count} 项。电脑中的原文件不会改变；小屋中的裁剪记录会一起移除。`;
    return new Promise(resolve => { confirmResolve = resolve; confirmDialog.showModal(); confirmDialog.querySelector('.gw-confirm-cancel').focus(); });
  }
  function finishDeleteConfirmation(result) {
    const resolve = confirmResolve; confirmResolve = null;
    if (confirmDialog.open) confirmDialog.close(); resolve?.(result);
  }
  async function removeSelected() {
    if (busy || !selected.size) return;
    const ids = [...selected]; setBusy(true);
    try {
      if (!await askDelete(ids.length)) return;
      await deleteMedia(ids);
      items = items.filter(item => !ids.includes(item.id)); selected.clear(); selecting = false;
      renderGrid(); await refreshStats(); announce(`已从照片墙移除 ${ids.length} 项。`);
    } catch (error) { announce(error.message || '未能移除，请重试。'); }
    finally { setBusy(false); }
  }

  function cleanupMedia() {
    viewerVersion++; viewerImage = null; pointer = null;
    if (viewerVideo) { viewerVideo.pause(); viewerVideo.removeAttribute('src'); viewerVideo.load(); viewerVideo = null; }
    if (viewerURL) { URL.revokeObjectURL(viewerURL); viewerURL = null; }
    stage.querySelectorAll('img,video').forEach(element => element.remove());
  }
  function closeViewer() {
    currentViewer = null; cleanupMedia();
    if (viewer.open) viewer.close();
  }
  function applyZoom() {
    if (!viewerImage) return;
    const maxX = Math.max(0, (imageWidth * zoom - stage.clientWidth) / 2);
    const maxY = Math.max(0, (imageHeight * zoom - stage.clientHeight) / 2);
    panX = Math.max(-maxX, Math.min(maxX, panX)); panY = Math.max(-maxY, Math.min(maxY, panY));
    viewerImage.style.transform = `translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px)) scale(${zoom})`;
    stage.classList.toggle('is-zoomed', zoom > 1.01);
    v$('.gw-viewer-zoom span')?.remove();
    v$('.gw-viewer-zoom').replaceChildren(icon('zoom'), document.createTextNode(zoom > 1.01 ? '适应窗口' : '放大查看'));
  }
  function fitViewerImage() {
    if (!viewerImage?.naturalWidth) return;
    const factor = Math.min(stage.clientWidth / viewerImage.naturalWidth, stage.clientHeight / viewerImage.naturalHeight, 1);
    imageWidth = viewerImage.naturalWidth * factor; imageHeight = viewerImage.naturalHeight * factor;
    viewerImage.style.width = `${imageWidth}px`; viewerImage.style.height = `${imageHeight}px`; applyZoom();
  }
  async function showViewerItem(item) {
    cleanupMedia(); const version = viewerVersion; currentViewer = item.id;
    zoom = 1; panX = panY = 0; stage.classList.remove('is-zoomed');
    v$('#galleryViewerTitle').textContent = item.name;
    v$('.gw-viewer-kind').textContent = item.type === 'video' ? 'A MOVING MEMORY · 视频' : 'A MOMENT TO KEEP · 照片';
    v$('.gw-viewer-position').textContent = `${viewerIndex + 1} / ${viewerItems.length}`;
    v$('.gw-previous').disabled = viewerIndex <= 0; v$('.gw-next').disabled = viewerIndex >= viewerItems.length - 1;
    v$('.gw-viewer-crop').hidden = item.type !== 'image'; v$('.gw-viewer-zoom').hidden = item.type !== 'image';
    v$('.gw-viewer-crop').disabled = true; v$('.gw-viewer-download').disabled = true;
    v$('.gw-viewer-info').textContent = item.type === 'video' ? `${formatDuration(item.duration)} · 点击播放按钮播放` : '点击图片放大 · 放大后拖动查看';
    const message = v$('.gw-viewer-message'); message.textContent = '正在打开…'; message.hidden = false;
    try {
      const blob = await getMediaBlob(item.id, item.type === 'video' ? 'original' : 'display');
      if (!viewer.open || currentViewer !== item.id || version !== viewerVersion || disposed) return;
      viewerURL = URL.createObjectURL(blob);
      if (item.type === 'video') {
        const video = node('video', 'gw-video'); viewerVideo = video;
        video.controls = true; video.playsInline = true; video.preload = 'metadata';
        video.addEventListener('loadedmetadata', () => { if (video === viewerVideo) message.hidden = true; }, { once: true });
        video.addEventListener('error', () => { if (video === viewerVideo) { message.hidden = false; message.textContent = '当前浏览器无法播放这段视频，可下载原文件后在本机播放器查看。'; } });
        video.src = viewerURL; stage.append(video);
      } else {
        const image = node('img', 'gw-full-image'); viewerImage = image; image.alt = item.name; image.draggable = false;
        image.addEventListener('load', () => { if (image === viewerImage) { message.hidden = true; fitViewerImage(); } }, { once: true });
        image.addEventListener('error', () => { if (image === viewerImage) { message.hidden = false; message.textContent = '照片暂时无法显示，可以下载原文件或关闭后重试。'; } }, { once: true });
        image.src = viewerURL; stage.append(image);
      }
      v$('.gw-viewer-crop').disabled = false; v$('.gw-viewer-download').disabled = false;
    } catch (error) { if (version === viewerVersion) message.textContent = error.message || '素材暂时无法读取，请关闭后重试。'; }
  }
  function openViewer(id) {
    if (busy || !active) return;
    viewerItems = filteredItems(); viewerIndex = viewerItems.findIndex(item => item.id === id);
    if (viewerIndex < 0) return;
    if (!viewer.open) viewer.showModal();
    showViewerItem(viewerItems[viewerIndex]);
  }
  function stepViewer(step) {
    const next = viewerIndex + step;
    if (next < 0 || next >= viewerItems.length) return;
    viewerIndex = next; showViewerItem(viewerItems[viewerIndex]);
  }
  async function downloadOriginal() {
    const id = currentViewer, item = items.find(entry => entry.id === id);
    if (!item) return;
    v$('.gw-viewer-download').disabled = true;
    try {
      const blob = await getMediaBlob(id, 'original');
      if (currentViewer !== id || disposed) return;
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = item.name.replace(/[\\/\u0000-\u001f]/g, '_');
      document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (error) { v$('.gw-viewer-message').hidden = false; v$('.gw-viewer-message').textContent = error.message || '原文件暂时无法下载。'; }
    finally { if (currentViewer === id) v$('.gw-viewer-download').disabled = false; }
  }
  const viewerResize = new ResizeObserver(fitViewerImage); viewerResize.observe(stage);
  stage.addEventListener('pointerdown', event => {
    if (!viewerImage || event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, panX, panY, moved: false };
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    if (Math.hypot(dx, dy) > 5) pointer.moved = true;
    if (zoom > 1 && pointer.moved) { panX = pointer.panX + dx; panY = pointer.panY + dy; applyZoom(); }
  });
  stage.addEventListener('pointerup', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    if (!pointer.moved) { zoom = zoom > 1.01 ? 1 : 2; panX = panY = 0; applyZoom(); }
    pointer = null;
  });
  stage.addEventListener('pointercancel', () => { pointer = null; });
  stage.addEventListener('wheel', event => {
    if (!viewerImage) return;
    event.preventDefault(); zoom = Math.max(1, Math.min(4, zoom * Math.exp(-event.deltaY * .001))); applyZoom();
  }, { passive: false });
  v$('.gw-viewer-close').addEventListener('click', closeViewer);
  viewer.addEventListener('close', closeViewer); bindBackdrop(viewer, closeViewer);
  v$('.gw-previous').addEventListener('click', () => stepViewer(-1)); v$('.gw-next').addEventListener('click', () => stepViewer(1));
  v$('.gw-viewer-zoom').addEventListener('click', () => { zoom = zoom > 1.01 ? 1 : 2; panX = panY = 0; applyZoom(); });
  v$('.gw-viewer-crop').addEventListener('click', () => cropItems([currentViewer]));
  v$('.gw-viewer-download').addEventListener('click', downloadOriginal);
  viewer.addEventListener('keydown', event => {
    if (event.target instanceof HTMLVideoElement) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); stepViewer(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); stepViewer(1); }
  });
  confirmDialog.querySelector('.gw-confirm-accept').addEventListener('click', () => finishDeleteConfirmation(true));
  confirmDialog.querySelector('.gw-confirm-cancel').addEventListener('click', () => finishDeleteConfirmation(false));
  confirmDialog.addEventListener('close', () => finishDeleteConfirmation(false)); bindBackdrop(confirmDialog, () => finishDeleteConfirmation(false));

  addButton.addEventListener('click', () => input.click()); $('.gw-empty-add').addEventListener('click', () => input.click());
  input.addEventListener('change', () => importFiles(Array.from(input.files || [])));
  selectToggle.addEventListener('click', () => { if (busy) return; selecting = !selecting; if (!selecting) selected.clear(); updateSelection(); });
  $('.gw-cancel-selection').addEventListener('click', () => { selecting = false; selected.clear(); updateSelection(); });
  selectAll.addEventListener('click', () => {
    const visible = filteredItems(), allSelected = visible.every(item => selected.has(item.id));
    visible.forEach(item => allSelected ? selected.delete(item.id) : selected.add(item.id)); updateSelection();
  });
  cropSelection.addEventListener('click', () => cropItems([...selected])); deleteSelection.addEventListener('click', removeSelected);
  container.querySelectorAll('[data-filter]').forEach(control => control.addEventListener('click', () => {
    filter = control.dataset.filter;
    container.querySelectorAll('[data-filter]').forEach(option => option.setAttribute('aria-pressed', String(option.dataset.filter === filter)));
    renderGrid();
  }));
  $('.gw-show-all').addEventListener('click', () => container.querySelector('[data-filter="all"]').click());
  $('.gw-sort').addEventListener('change', event => { sort = event.target.value; renderGrid(); });
  $('.gw-retry').addEventListener('click', refresh); $('.gw-back-study').addEventListener('click', onRequestStudy);
  container.addEventListener('dragenter', event => {
    if (!active || !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault(); dragDepth++; if (!busy) $('.gw-drop-overlay').hidden = false;
  });
  container.addEventListener('dragover', event => {
    if (!active || !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
  });
  container.addEventListener('dragleave', event => { event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('.gw-drop-overlay').hidden = true; });
  container.addEventListener('drop', event => {
    event.preventDefault(); dragDepth = 0; $('.gw-drop-overlay').hidden = true;
    if (!busy && active) importFiles(Array.from(event.dataTransfer?.files || []));
  });

  return {
    async open() {
      if (disposed) return false;
      active = true; container.hidden = false; await refresh(); return !disposed;
    },
    close() {
      if (busy) { announce('正在整理照片，请等这一步完成后再切换小屋。'); notify('正在整理照片，请等这一步完成后再切换小屋。'); return false; }
      active = false; loadVersion++; closeViewer(); finishDeleteConfirmation(false); cleanupThumbnails();
      container.hidden = true; dragDepth = 0; $('.gw-drop-overlay').hidden = true; return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true; active = false; loadVersion++; clearTimeout(noticeTimer); closeViewer();
      finishDeleteConfirmation(false); cleanupThumbnails(); viewerResize.disconnect(); viewer.remove(); confirmDialog.remove();
      container.replaceChildren(); container.hidden = true;
    },
  };
}
