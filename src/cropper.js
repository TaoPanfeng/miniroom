const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
let activeEditor = null;

/** Cancel an open editor when its underlying local media has been cleared. */
export function closeImageCrop() {
  activeEditor?.(null);
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Pure crop geometry, shared by pointer controls and the final image export. */
export function cropRectForView({ width, height, ratio, zoom = 1, centerX = .5, centerY = .5 }) {
  if (![width, height, ratio].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('照片尺寸无法读取。');
  }
  const level = clamp(Number.isFinite(zoom) ? zoom : 1, MIN_ZOOM, MAX_ZOOM);
  const baseWidth = Math.min(width, height * ratio);
  const baseHeight = baseWidth / ratio;
  const cropWidth = Math.min(1, baseWidth / level / width);
  const cropHeight = Math.min(1, baseHeight / level / height);
  const x = clamp(Number.isFinite(centerX) ? centerX : .5, cropWidth / 2, 1 - cropWidth / 2);
  const y = clamp(Number.isFinite(centerY) ? centerY : .5, cropHeight / 2, 1 - cropHeight / 2);
  return {
    crop: { x: x - cropWidth / 2, y: y - cropHeight / 2, width: cropWidth, height: cropHeight },
    zoom: level, centerX: x, centerY: y,
  };
}

function validSavedCrop(crop) {
  return crop && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(crop[key]))
    && crop.x >= 0 && crop.y >= 0 && crop.width > 0 && crop.height > 0
    && crop.x + crop.width <= 1.000001 && crop.y + crop.height <= 1.000001;
}

function ensureStyles() {
  if (document.querySelector('link[data-miniroom-cropper]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../assets/cropper.css', import.meta.url).href;
  link.dataset.miniroomCropper = '';
  document.head.append(link);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, label) {
  const node = element('button', className, text);
  node.type = 'button';
  if (label) node.setAttribute('aria-label', label);
  return node;
}

/**
 * Open one non-destructive crop editor.
 * queue.index is zero-based. null cancels; { action: 'skip' } advances a batch.
 */
export async function openImageCrop({ blob, name = '这张照片', crop = null, queue = null }) {
  if (!(blob instanceof Blob) || blob.size === 0) throw new Error('照片文件无法读取。');
  activeEditor?.(null);
  ensureStyles();

  const previousFocus = document.activeElement;
  const batch = queue && Number.isInteger(queue.index) && Number.isInteger(queue.total)
    && queue.total > 1 && queue.index >= 0 && queue.index < queue.total;
  const dialog = element('dialog', 'crop-dialog');
  dialog.setAttribute('aria-labelledby', 'miniroomCropTitle');
  dialog.setAttribute('aria-describedby', 'miniroomCropIntro');
  const header = element('header', 'crop-header');
  const heading = element('div', 'crop-heading');
  const kicker = element('p', 'crop-kicker', batch ? `逐张裁剪 · ${queue.index + 1} / ${queue.total}` : '留住喜欢的部分');
  const title = element('h2', '', '把这一刻，放进画框。');
  title.id = 'miniroomCropTitle';
  const filename = element('p', 'crop-filename', String(name));
  filename.title = String(name);
  heading.append(kicker, title, filename);
  const close = button('crop-close', '×', '关闭照片裁剪');
  header.append(heading, close);

  const intro = element('p', 'crop-intro', '拖动照片调整位置，放大一点，或留住完整的风景。');
  intro.id = 'miniroomCropIntro';
  const content = element('div', 'crop-content');
  const preview = element('div', 'crop-preview');
  const canvas = element('canvas', 'crop-canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '裁剪预览。拖动照片调整位置，滚轮或双指缩放。方向键移动照片，加减键缩放。');
  const loading = element('div', 'crop-loading', '正在打开原图…');
  const frameHint = element('span', 'crop-frame-hint', '框内就是裁剪后的画面');
  preview.append(canvas, loading, frameHint);

  const controls = element('section', 'crop-controls');
  controls.setAttribute('aria-label', '照片裁剪设置');
  const aspectLabel = element('h3', 'crop-control-title', '画框比例');
  const aspects = element('div', 'crop-aspects');
  aspects.setAttribute('role', 'group');
  aspects.setAttribute('aria-label', '选择裁剪比例');
  const options = [
    { key: 'original', label: '原图', ratio: null },
    { key: 'square', label: '1:1', ratio: 1 },
    { key: 'landscape', label: '4:3', ratio: 4 / 3 },
    { key: 'portrait', label: '3:4', ratio: 3 / 4 },
    { key: 'wide', label: '16:9', ratio: 16 / 9 },
    { key: 'tall', label: '9:16', ratio: 9 / 16 },
  ];
  const aspectButtons = options.map(option => {
    const control = button('crop-aspect', option.label, option.key === 'original' ? '使用原图比例' : `裁剪为 ${option.label}`);
    control.dataset.ratio = option.key;
    control.setAttribute('aria-pressed', 'false');
    aspects.append(control);
    return control;
  });
  const customRatio = element('p', 'crop-custom-ratio', '保留上次裁剪比例');
  customRatio.hidden = true;
  const zoomHeader = element('div', 'crop-zoom-heading');
  const zoomLabel = element('label', 'crop-control-title', '照片缩放');
  zoomLabel.htmlFor = 'miniroomCropZoom';
  const zoomOutput = element('output', 'crop-zoom-output', '100%');
  zoomOutput.setAttribute('for', 'miniroomCropZoom');
  zoomHeader.append(zoomLabel, zoomOutput);
  const zoomRow = element('div', 'crop-zoom-row');
  const zoomOut = button('crop-zoom-step', '−', '缩小照片');
  const zoomInput = element('input', 'crop-zoom-slider');
  zoomInput.id = 'miniroomCropZoom';
  zoomInput.type = 'range';
  zoomInput.min = String(MIN_ZOOM * 100);
  zoomInput.max = String(MAX_ZOOM * 100);
  zoomInput.step = '1';
  zoomInput.value = '100';
  const zoomIn = button('crop-zoom-step', '+', '放大照片');
  zoomRow.append(zoomOut, zoomInput, zoomIn);
  const zoomNote = element('p', 'crop-control-note', '滚轮 / 双指也可以缩放');
  const reset = button('crop-reset', '↺  恢复完整原图');
  const preserve = element('div', 'crop-preserve');
  preserve.append(element('span', 'crop-preserve-mark', '✧'), element('p', '', '原图始终保留。以后想换一个角度，还能重新裁剪。'));
  controls.append(aspectLabel, aspects, customRatio, zoomHeader, zoomRow, zoomNote, reset, preserve);
  content.append(preview, controls);

  const status = element('p', 'crop-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const footer = element('footer', 'crop-footer');
  const cancel = button('crop-cancel', batch ? '结束逐张裁剪' : '先不改');
  const actionGroup = element('div', 'crop-footer-actions');
  const skip = button('crop-skip', '跳过这张');
  skip.hidden = !batch;
  const saveLabel = batch && queue.index + 1 < queue.total ? '保存并下一张' : '保存裁剪';
  const save = button('crop-save', saveLabel);
  actionGroup.append(skip, save);
  footer.append(cancel, actionGroup);
  dialog.append(header, intro, content, status, footer);
  document.body.append(dialog);

  return new Promise((resolve, reject) => {
    const events = new AbortController();
    const listen = (node, type, listener, options = {}) => node.addEventListener(type, listener, { ...options, signal: events.signal });
    const pointers = new Map();
    const image = new Image();
    const sourceURL = URL.createObjectURL(blob);
    let disposed = false, ready = false, saving = false;
    let sourceWidth = 1, sourceHeight = 1;
    let ratio = 1, zoom = 1, centerX = .5, centerY = .5;
    let stageWidth = 1, stageHeight = 1, pixelRatio = 1;
    let frame = { x: 0, y: 0, width: 1, height: 1 };
    let renderFrame = 0, imageTimeout = 0;
    const context = canvas.getContext('2d');
    if (!context) {
      URL.revokeObjectURL(sourceURL);
      dialog.remove();
      reject(new Error('当前浏览器无法打开裁剪画布。'));
      return;
    }

    const observer = new ResizeObserver(resize);
    observer.observe(preview);

    function cleanup() {
      events.abort();
      observer.disconnect();
      cancelAnimationFrame(renderFrame);
      clearTimeout(imageTimeout);
      pointers.clear();
      image.onload = null;
      image.onerror = null;
      image.removeAttribute('src');
      URL.revokeObjectURL(sourceURL);
      if (dialog.open) dialog.close();
      dialog.remove();
      if (activeEditor === finish) activeEditor = null;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    }

    function finish(result, error) {
      if (disposed) return;
      disposed = true;
      cleanup();
      if (error) reject(error); else resolve(result);
    }
    activeEditor = finish;

    function currentCrop() {
      const view = cropRectForView({ width: sourceWidth, height: sourceHeight, ratio, zoom, centerX, centerY });
      zoom = view.zoom;
      centerX = view.centerX;
      centerY = view.centerY;
      return view.crop;
    }

    function updateControls() {
      zoomInput.value = String(Math.round(zoom * 100));
      zoomOutput.value = `${Math.round(zoom * 100)}%`;
      zoomInput.setAttribute('aria-valuetext', `${Math.round(zoom * 100)}%`);
      zoomOut.disabled = !ready || saving || zoom <= MIN_ZOOM + .0001;
      zoomIn.disabled = !ready || saving || zoom >= MAX_ZOOM - .0001;
      let selected = false;
      options.forEach((option, index) => {
        const optionRatio = option.ratio || sourceWidth / sourceHeight;
        const match = !selected && Math.abs(ratio - optionRatio) / optionRatio < .0001;
        aspectButtons[index].setAttribute('aria-pressed', String(match));
        if (match) selected = true;
      });
      customRatio.hidden = selected;
    }

    function resize() {
      if (disposed) return;
      const bounds = preview.getBoundingClientRect();
      if (bounds.width < 1 || bounds.height < 1) return;
      stageWidth = bounds.width;
      stageHeight = bounds.height;
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(stageWidth * pixelRatio));
      canvas.height = Math.max(1, Math.round(stageHeight * pixelRatio));
      updateFrame();
      scheduleDraw();
    }

    function updateFrame() {
      const margin = stageWidth < 400 ? 24 : 32;
      const availableWidth = Math.max(20, stageWidth - margin * 2);
      const availableHeight = Math.max(20, stageHeight - margin * 2 - 8);
      const width = Math.min(availableWidth, availableHeight * ratio);
      const height = width / ratio;
      frame = { x: (stageWidth - width) / 2, y: (stageHeight - height) / 2, width, height };
    }

    function scheduleDraw() {
      if (disposed || renderFrame) return;
      renderFrame = requestAnimationFrame(() => { renderFrame = 0; draw(); });
    }

    function draw() {
      if (!ready || disposed) return;
      const rect = currentCrop();
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, stageWidth, stageHeight);
      context.fillStyle = '#dedfd5';
      context.fillRect(0, 0, stageWidth, stageHeight);
      const scale = frame.width / (rect.width * sourceWidth);
      const left = frame.x - rect.x * sourceWidth * scale;
      const top = frame.y - rect.y * sourceHeight * scale;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.fillStyle = '#fffcf5';
      context.fillRect(left, top, sourceWidth * scale, sourceHeight * scale);
      context.drawImage(image, left, top, sourceWidth * scale, sourceHeight * scale);
      context.fillStyle = 'rgba(30, 39, 31, .57)';
      context.fillRect(0, 0, stageWidth, frame.y);
      context.fillRect(0, frame.y + frame.height, stageWidth, stageHeight - frame.y - frame.height);
      context.fillRect(0, frame.y, frame.x, frame.height);
      context.fillRect(frame.x + frame.width, frame.y, stageWidth - frame.x - frame.width, frame.height);
      context.strokeStyle = 'rgba(255, 252, 240, .52)';
      context.lineWidth = 1;
      context.beginPath();
      for (let position = 1; position <= 2; position++) {
        context.moveTo(frame.x + frame.width * position / 3, frame.y);
        context.lineTo(frame.x + frame.width * position / 3, frame.y + frame.height);
        context.moveTo(frame.x, frame.y + frame.height * position / 3);
        context.lineTo(frame.x + frame.width, frame.y + frame.height * position / 3);
      }
      context.stroke();
      context.strokeStyle = '#fffdf2';
      context.lineWidth = 1.5;
      context.strokeRect(frame.x, frame.y, frame.width, frame.height);
      context.lineWidth = 3;
      const corner = Math.min(20, frame.width * .15, frame.height * .15);
      for (const [x, y, dx, dy] of [
        [frame.x, frame.y, 1, 1],
        [frame.x + frame.width, frame.y, -1, 1],
        [frame.x, frame.y + frame.height, 1, -1],
        [frame.x + frame.width, frame.y + frame.height, -1, -1],
      ]) {
        context.beginPath();
        context.moveTo(x + dx * corner, y);
        context.lineTo(x, y);
        context.lineTo(x, y + dy * corner);
        context.stroke();
      }
      updateControls();
    }

    function point(event) {
      const bounds = canvas.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    }

    function setZoom(value, oldAnchor, newAnchor = oldAnchor) {
      const rect = currentCrop();
      const previous = oldAnchor || { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
      const next = newAnchor || previous;
      const originalX = rect.x + (previous.x - frame.x) / frame.width * rect.width;
      const originalY = rect.y + (previous.y - frame.y) / frame.height * rect.height;
      zoom = clamp(value, MIN_ZOOM, MAX_ZOOM);
      const dimensions = cropRectForView({ width: sourceWidth, height: sourceHeight, ratio, zoom }).crop;
      centerX = originalX + (.5 - (next.x - frame.x) / frame.width) * dimensions.width;
      centerY = originalY + (.5 - (next.y - frame.y) / frame.height) * dimensions.height;
      currentCrop();
      scheduleDraw();
    }

    function pan(dx, dy) {
      const rect = currentCrop();
      centerX -= dx / frame.width * rect.width;
      centerY -= dy / frame.height * rect.height;
      currentCrop();
      scheduleDraw();
    }

    function setBusy(value) {
      saving = value;
      dialog.querySelectorAll('button, input').forEach(control => { control.disabled = value || !ready; });
      close.disabled = value;
      cancel.disabled = value;
      skip.disabled = value;
      save.textContent = value ? '正在生成裁剪…' : saveLabel;
      updateControls();
    }

    function makeOutput(rect, longestSide) {
      const sourceCropWidth = rect.width * sourceWidth;
      const sourceCropHeight = rect.height * sourceHeight;
      const factor = Math.min(1, longestSide / Math.max(sourceCropWidth, sourceCropHeight));
      const target = document.createElement('canvas');
      target.width = Math.max(1, Math.round(sourceCropWidth * factor));
      target.height = Math.max(1, Math.round(sourceCropHeight * factor));
      const targetContext = target.getContext('2d');
      if (!targetContext) throw new Error('浏览器暂时无法生成裁剪图片。');
      targetContext.fillStyle = '#fffcf5';
      targetContext.fillRect(0, 0, target.width, target.height);
      targetContext.imageSmoothingEnabled = true;
      targetContext.imageSmoothingQuality = 'high';
      targetContext.drawImage(image, rect.x * sourceWidth, rect.y * sourceHeight, sourceCropWidth, sourceCropHeight, 0, 0, target.width, target.height);
      return new Promise((resolveBlob, rejectBlob) => {
        target.toBlob(result => {
          target.width = 1; target.height = 1;
          if (result) resolveBlob(result); else rejectBlob(new Error('裁剪没有生成，请稍后重试。'));
        }, 'image/jpeg', longestSide > 512 ? .9 : .84);
      });
    }

    listen(close, 'click', () => finish(null));
    listen(cancel, 'click', () => finish(null));
    listen(skip, 'click', () => finish({ action: 'skip' }));
    listen(dialog, 'cancel', event => { event.preventDefault(); finish(null); });
    listen(dialog, 'close', () => finish(null));
    listen(dialog, 'click', event => {
      if (event.target !== dialog || saving) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) finish(null);
    });

    options.forEach((option, index) => listen(aspectButtons[index], 'click', () => {
      ratio = option.ratio || sourceWidth / sourceHeight;
      updateFrame();
      currentCrop();
      scheduleDraw();
    }));
    listen(zoomInput, 'input', () => setZoom(Number(zoomInput.value) / 100));
    listen(zoomOut, 'click', () => setZoom(zoom / 1.18));
    listen(zoomIn, 'click', () => setZoom(zoom * 1.18));
    listen(reset, 'click', () => {
      ratio = sourceWidth / sourceHeight;
      zoom = 1;
      centerX = .5;
      centerY = .5;
      updateFrame();
      scheduleDraw();
    });
    listen(canvas, 'pointerdown', event => {
      if (!ready || saving || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault();
      canvas.focus({ preventScroll: true });
      pointers.set(event.pointerId, point(event));
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('is-dragging');
    });
    listen(canvas, 'pointermove', event => {
      if (!pointers.has(event.pointerId) || saving) return;
      const before = [...pointers.values()].map(value => ({ ...value }));
      const previous = pointers.get(event.pointerId);
      const current = point(event);
      pointers.set(event.pointerId, current);
      if (pointers.size === 1) {
        pan(current.x - previous.x, current.y - previous.y);
      } else if (pointers.size === 2) {
        const after = [...pointers.values()];
        const oldDistance = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y);
        const nextDistance = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
        if (oldDistance < 2 || nextDistance < 2) return;
        const oldMiddle = { x: (before[0].x + before[1].x) / 2, y: (before[0].y + before[1].y) / 2 };
        const nextMiddle = { x: (after[0].x + after[1].x) / 2, y: (after[0].y + after[1].y) / 2 };
        setZoom(zoom * nextDistance / oldDistance, oldMiddle, nextMiddle);
      }
    });
    function releasePointer(event) {
      pointers.delete(event.pointerId);
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (!pointers.size) canvas.classList.remove('is-dragging');
    }
    listen(canvas, 'pointerup', releasePointer);
    listen(canvas, 'pointercancel', releasePointer);
    listen(canvas, 'lostpointercapture', releasePointer);
    listen(canvas, 'wheel', event => {
      if (!ready || saving) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stageHeight : 1);
      setZoom(zoom * Math.exp(-delta * .0015), point(event));
    }, { passive: false });
    listen(canvas, 'keydown', event => {
      if (!ready || saving) return;
      const step = event.shiftKey ? 36 : 12;
      const actions = {
        ArrowLeft: () => pan(-step, 0), ArrowRight: () => pan(step, 0),
        ArrowUp: () => pan(0, -step), ArrowDown: () => pan(0, step),
        '+': () => setZoom(zoom * 1.12), '=': () => setZoom(zoom * 1.12),
        '-': () => setZoom(zoom / 1.12),
      };
      if (actions[event.key]) { event.preventDefault(); actions[event.key](); }
    });
    listen(save, 'click', async () => {
      if (!ready || saving) return;
      setBusy(true);
      status.textContent = '';
      try {
        const nextCrop = currentCrop();
        const [display, thumb] = await Promise.all([makeOutput(nextCrop, 1600), makeOutput(nextCrop, 512)]);
        if (!disposed) finish({ action: 'save', crop: nextCrop, display, thumb });
      } catch (error) {
        if (disposed) return;
        status.textContent = error.message || '裁剪没有完成，请稍后重试。';
        setBusy(false);
      }
    });

    setBusy(false);
    try { dialog.showModal(); }
    catch (error) { finish(null, error); return; }
    image.onload = () => {
      clearTimeout(imageTimeout);
      if (disposed) return;
      sourceWidth = image.naturalWidth;
      sourceHeight = image.naturalHeight;
      if (!sourceWidth || !sourceHeight) { finish(null, new Error('照片尺寸无法读取。')); return; }
      ratio = sourceWidth / sourceHeight;
      if (validSavedCrop(crop)) {
        ratio = crop.width * sourceWidth / (crop.height * sourceHeight);
        const baseWidth = Math.min(sourceWidth, sourceHeight * ratio);
        zoom = clamp(baseWidth / (crop.width * sourceWidth), MIN_ZOOM, MAX_ZOOM);
        centerX = crop.x + crop.width / 2;
        centerY = crop.y + crop.height / 2;
      }
      ready = true;
      loading.hidden = true;
      setBusy(false);
      resize();
      canvas.focus({ preventScroll: true });
    };
    image.onerror = () => finish(null, new Error('原图无法打开，请重新添加这张照片。'));
    imageTimeout = setTimeout(() => finish(null, new Error('原图打开超时，请换一张较小的照片。')), 20000);
    image.src = sourceURL;
  });
}
