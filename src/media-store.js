/** 照片墙的独立本地存档。列表只读取小缩略图，原片和视频另存为 Blob。 */
export const MAX_BATCH_FILES = 100;
export const MAX_ITEMS = 500;

const DB_NAME = 'miniroom-gallery-v1';
const IMAGE_LIMIT = 30 * 1024 * 1024;
const VIDEO_LIMIT = 250 * 1024 * 1024;
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg']);
const EXTENSION_MIMES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', avif: 'image/avif', mp4: 'video/mp4', m4v: 'video/mp4',
  webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg', ogg: 'video/ogg',
};
let databasePromise;
let writeQueue = Promise.resolve();

function storageError(error, fallback = '照片墙存档暂时不可用，请检查浏览器的存储设置。') {
  if (error?.name === 'QuotaExceededError') return new Error('本浏览器的存储空间不足。请删除不需要的素材，或减少本次添加的文件。');
  if (error?.name === 'SecurityError' || error?.name === 'NotAllowedError') return new Error('浏览器没有允许本地存储，请检查站点存储权限后重试。');
  return error instanceof Error && error.name === 'Error' ? error : new Error(fallback);
}

function openDatabase() {
  if (databasePromise) return databasePromise;
  const opening = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('这个浏览器不支持照片墙本地存档，请使用新版 Chrome、Edge、Firefox 或 Safari。')); return; }
    let request;
    let settled = false;
    const fail = error => { if (settled) return; settled = true; reject(storageError(error)); };
    try { request = indexedDB.open(DB_NAME, 1); } catch (error) { fail(error); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: ['mediaId', 'variant'] });
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) { db.close(); return; }
      settled = true;
      db.onversionchange = () => { db.close(); if (databasePromise === opening) databasePromise = undefined; };
      db.onclose = () => { if (databasePromise === opening) databasePromise = undefined; };
      resolve(db);
    };
    request.onerror = () => fail(request.error);
    request.onblocked = () => fail(new Error('照片墙存档被其他页面占用，请关闭其他小屋页面后重试。'));
  });
  databasePromise = opening;
  opening.catch(() => { if (databasePromise === opening) databasePromise = undefined; });
  return opening;
}

function serializeWrite(action) {
  const pending = writeQueue.then(action, action);
  writeQueue = pending.catch(() => {});
  return pending;
}

function validId(id) { return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(id); }
function assertId(id) { if (!validId(id)) throw new Error('这项素材的编号无效，请重新打开照片墙。'); }
function makeId() {
  return globalThis.crypto?.randomUUID?.() || `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export async function listMedia() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let records = [];
    const tx = db.transaction('items', 'readonly');
    const request = tx.objectStore('items').getAll();
    request.onsuccess = () => { records = request.result; };
    tx.oncomplete = () => resolve(records.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)));
    tx.onerror = event => reject(storageError(event.target?.error || tx.error));
    tx.onabort = () => reject(storageError(tx.error, '照片墙读取被中断，请重试。'));
  });
}

export async function getMediaBlob(id, variant = 'original') {
  assertId(id);
  if (!['original', 'display'].includes(variant)) throw new Error('请求的素材版本无效。');
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let blob;
    const tx = db.transaction('assets', 'readonly');
    const store = tx.objectStore('assets');
    const request = store.get([id, variant]);
    request.onsuccess = () => {
      blob = request.result?.blob;
      if (!blob && variant === 'display') {
        const original = store.get([id, 'original']);
        original.onsuccess = () => { blob = original.result?.blob; };
      }
    };
    tx.oncomplete = () => blob instanceof Blob ? resolve(blob) : reject(new Error('这项素材已被移除，或原文件暂时无法读取。'));
    tx.onerror = event => reject(storageError(event.target?.error || tx.error));
    tx.onabort = () => reject(storageError(tx.error, '素材读取被中断，请重试。'));
  });
}

function classifyFile(file) {
  if (!(file instanceof Blob) || file.size === 0) throw new Error('文件为空或无法读取。');
  const name = String(file.name || '未命名素材');
  const extension = name.split('.').pop().toLowerCase();
  let mime = file.type.toLowerCase().split(';')[0];
  if (mime === 'image/jpg') mime = 'image/jpeg';
  if (['heic', 'heif'].includes(extension) || /^image\/hei[cf]/.test(mime)) throw new Error('暂不支持 HEIC / HEIF，请先转换为 JPG 或 PNG。');
  if (extension === 'svg' || mime === 'image/svg+xml') throw new Error('暂不支持 SVG，请选择 JPG、PNG、WebP、GIF 或 AVIF 照片。');
  if (!mime || mime === 'application/octet-stream') mime = EXTENSION_MIMES[extension] || '';
  const type = IMAGE_MIMES.has(mime) ? 'image' : VIDEO_MIMES.has(mime) ? 'video' : null;
  if (!type) throw new Error('文件格式不支持。照片可用 JPG / PNG / WebP / GIF / AVIF，视频可用 MP4 / WebM / MOV / OGG。');
  if (type === 'image' && file.size > IMAGE_LIMIT) throw new Error('单张照片最大 30 MB，请先缩小文件。');
  if (type === 'video' && file.size > VIDEO_LIMIT) throw new Error('单个视频最大 250 MB，请先压缩或缩短视频。');
  return { type, mime, name: name.slice(0, 240), blob: file.slice(0, file.size, mime) };
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(blob);
    const cleanup = () => { clearTimeout(timer); image.onload = null; image.onerror = null; URL.revokeObjectURL(url); };
    const timer = setTimeout(() => { cleanup(); image.src = ''; reject(new Error('这张照片读取超时，请缩小文件或转换为 JPG 后重试。')); }, 20000);
    image.onload = () => {
      cleanup();
      if (!image.naturalWidth || !image.naturalHeight) { reject(new Error('照片尺寸无效，请换一个文件。')); return; }
      if (image.naturalWidth * image.naturalHeight > 100000000) { image.src = ''; reject(new Error('照片像素超过 1 亿，请先缩小图片后添加。')); return; }
      resolve(image);
    };
    image.onerror = () => { cleanup(); reject(new Error('浏览器无法解码这张照片，请转换为 JPG、PNG 或 WebP 后重试。')); };
    image.src = url;
  });
}

function canvasBlob(source, width, height, longest, quality = .86) {
  return new Promise((resolve, reject) => {
    const ratio = Math.min(1, longest / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const ctx = canvas.getContext('2d');
    if (!ctx) { reject(new Error('浏览器暂时无法处理图片，请重新打开页面后再试。')); return; }
    let timer;
    const clear = () => { clearTimeout(timer); canvas.width = 1; canvas.height = 1; };
    try {
      ctx.fillStyle = '#f4efe3'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      timer = setTimeout(() => { clear(); reject(new Error('图片处理超时，请缩小图片后重试。')); }, 15000);
      canvas.toBlob(blob => { clear(); blob ? resolve(blob) : reject(new Error('图片处理失败，请换一张照片。')); }, 'image/jpeg', quality);
    } catch (error) { clear(); reject(new Error('图片或视频画面无法读取，请转换文件格式后重试。')); }
  });
}

function videoEvent(video, event, milliseconds = 20000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); video.removeEventListener(event, ready); video.removeEventListener('error', fail); };
    const ready = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('视频无法读取或播放，可能是文件损坏或编码不支持。请换一个文件，或转换为 H.264 MP4 / WebM 后重试。')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('视频读取超时，请压缩视频或转换为 H.264 编码的 MP4 后重试。')); }, milliseconds);
    video.addEventListener(event, ready, { once: true });
    video.addEventListener('error', fail, { once: true });
  });
}

async function prepareFile(classified) {
  const { type, mime, name, blob } = classified;
  let width, height, duration, display = null, thumb;
  if (type === 'image') {
    const image = await loadImage(blob);
    try {
      width = image.naturalWidth; height = image.naturalHeight;
      display = await canvasBlob(image, width, height, 1600, .88);
      thumb = await canvasBlob(image, width, height, 512, .8);
    } finally { image.src = ''; }
  } else {
    const video = document.createElement('video');
    const url = URL.createObjectURL(blob);
    video.muted = true; video.preload = 'auto'; video.playsInline = true;
    try {
      const metadata = videoEvent(video, 'loadedmetadata');
      video.src = url; video.load();
      await metadata;
      width = video.videoWidth; height = video.videoHeight; duration = video.duration;
      if (!width || !height || !Number.isFinite(duration) || duration <= 0) throw new Error('没有找到可播放的视频画面，请选择普通视频文件。');
      if (video.readyState < 2) await videoEvent(video, 'loadeddata');
      if (duration > .3) {
        const seeked = videoEvent(video, 'seeked', 15000);
        video.currentTime = Math.min(.25, duration / 2);
        await seeked;
      }
      thumb = await canvasBlob(video, width, height, 512, .8);
    } finally {
      video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
    }
  }
  const now = Date.now();
  return {
    metadata: { id: makeId(), type, name, mime, size: blob.size, width, height,
      ...(type === 'video' ? { duration } : {}), createdAt: now, updatedAt: now, crop: null, thumb,
      storageBytes: blob.size + (display?.size || 0) + thumb.size },
    original: blob, display,
  };
}

async function saveNewMedia(prepared) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let reason;
    const tx = db.transaction(['items', 'assets'], 'readwrite');
    const items = tx.objectStore('items');
    const assets = tx.objectStore('assets');
    const count = items.count();
    count.onsuccess = () => {
      if (count.result >= MAX_ITEMS) { reason = new Error(`照片墙最多保存 ${MAX_ITEMS} 项素材，请先整理一些素材。`); tx.abort(); return; }
      const id = prepared.metadata.id;
      items.add(prepared.metadata);
      assets.add({ mediaId: id, variant: 'original', blob: prepared.original });
      if (prepared.display) assets.add({ mediaId: id, variant: 'display', blob: prepared.display });
    };
    tx.oncomplete = () => resolve(prepared.metadata);
    tx.onerror = event => reject(reason || storageError(event.target?.error || tx.error, '素材保存失败，请检查本地存储空间。'));
    tx.onabort = () => reject(reason || storageError(tx.error, '素材没有保存，请检查本地存储空间。'));
  });
}

export async function addMediaFiles(files, { onProgress } = {}) {
  const selected = Array.from(files || []);
  return serializeWrite(async () => {
    const added = [], failed = [];
    let db, unavailable;
    for (let index = 0; index < selected.length; index++) {
      const file = selected[index];
      const name = String(file?.name || '未命名素材').slice(0, 240);
      try { onProgress?.({ current: index + 1, total: selected.length, name }); } catch { /* UI 回调不影响存档。 */ }
      try {
        if (index >= MAX_BATCH_FILES) throw new Error(`每次最多添加 ${MAX_BATCH_FILES} 个文件，请把其余文件分批添加。`);
        const classified = classifyFile(file);
        if (unavailable) throw unavailable;
        if (!db) {
          try { db = await openDatabase(); }
          catch (error) { unavailable = storageError(error); throw unavailable; }
        }
        // 在解码大视频前检查是否已满；真正提交时仍在写事务里再次检查。
        const count = await new Promise((resolve, reject) => {
          const tx = db.transaction('items', 'readonly');
          const request = tx.objectStore('items').count();
          let value = 0;
          request.onsuccess = () => { value = request.result; };
          tx.oncomplete = () => resolve(value);
          tx.onerror = event => reject(storageError(event.target?.error || tx.error));
          tx.onabort = () => reject(storageError(tx.error));
        });
        if (count >= MAX_ITEMS) throw new Error(`照片墙最多保存 ${MAX_ITEMS} 项素材，请先整理一些素材。`);
        const prepared = await prepareFile(classified);
        added.push(await saveNewMedia(prepared));
      } catch (error) { failed.push({ name, message: storageError(error).message }); }
    }
    return { added, failed };
  });
}

function normalizedCrop(crop) {
  if (crop === null) return null;
  if (!crop || typeof crop !== 'object' || Array.isArray(crop)) throw new Error('裁剪区域无效，请重新裁剪。');
  const { x, y, width, height } = crop;
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0
    || x >= 1 || y >= 1 || x + width > 1.000001 || y + height > 1.000001) throw new Error('裁剪区域超出了原图，请重新裁剪。');
  return { x, y, width: Math.min(width, 1 - x), height: Math.min(height, 1 - y) };
}

function validateDerivative(blob, limit) {
  if (!(blob instanceof Blob) || !['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)
    || blob.size === 0 || blob.size > limit) throw new Error('裁剪后的图片格式或大小不正确，请重新裁剪。');
}

export async function updateMediaCrop(id, { crop, display, thumb } = {}) {
  assertId(id);
  const normalized = normalizedCrop(crop);
  validateDerivative(display, 12 * 1024 * 1024);
  validateDerivative(thumb, 2 * 1024 * 1024);
  return serializeWrite(async () => {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      let updated, reason;
      const tx = db.transaction(['items', 'assets'], 'readwrite');
      const items = tx.objectStore('items');
      const request = items.get(id);
      request.onsuccess = () => {
        const item = request.result;
        if (!item || item.type !== 'image') { reason = new Error('这张照片已被移除，或这项素材不是照片。'); tx.abort(); return; }
        if (normalized && (normalized.width * item.width < 1 || normalized.height * item.height < 1)) {
          reason = new Error('裁剪区域太小，请稍微缩小放大倍数后重试。'); tx.abort(); return;
        }
        updated = { ...item, crop: normalized, thumb, updatedAt: Date.now(), storageBytes: item.size + display.size + thumb.size };
        items.put(updated);
        tx.objectStore('assets').put({ mediaId: id, variant: 'display', blob: display });
      };
      tx.oncomplete = () => resolve(updated);
      tx.onerror = event => reject(reason || storageError(event.target?.error || tx.error, '裁剪结果没有保存，请检查本地存储空间。'));
      tx.onabort = () => reject(reason || storageError(tx.error, '裁剪结果没有保存，原照片保持不变。'));
    });
  });
}

export async function deleteMedia(ids) {
  const unique = [...new Set(Array.from(ids || []))];
  unique.forEach(assertId);
  if (!unique.length) return;
  return serializeWrite(async () => {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['items', 'assets'], 'readwrite');
      const items = tx.objectStore('items'), assets = tx.objectStore('assets');
      for (const id of unique) { items.delete(id); assets.delete([id, 'original']); assets.delete([id, 'display']); }
      tx.oncomplete = () => resolve();
      tx.onerror = event => reject(storageError(event.target?.error || tx.error, '素材没有删除，请稍后重试。'));
      tx.onabort = () => reject(storageError(tx.error, '删除已中断，原素材保持不变。'));
    });
  });
}

export async function getMediaStats() {
  const db = await openDatabase();
  const result = await new Promise((resolve, reject) => {
    const stats = { count: 0, images: 0, videos: 0, bytes: 0 };
    const tx = db.transaction('items', 'readonly');
    const request = tx.objectStore('items').openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const item = cursor.value;
      stats.count++; stats[item.type === 'video' ? 'videos' : 'images']++;
      stats.bytes += Number.isFinite(item.storageBytes) ? item.storageBytes : item.size;
      cursor.continue();
    };
    tx.oncomplete = () => resolve(stats);
    tx.onerror = event => reject(storageError(event.target?.error || tx.error));
    tx.onabort = () => reject(storageError(tx.error));
  });
  try {
    const estimate = await globalThis.navigator?.storage?.estimate?.();
    if (Number.isFinite(estimate?.usage)) result.usage = estimate.usage;
    if (Number.isFinite(estimate?.quota)) result.quota = estimate.quota;
  } catch { /* 不支持空间估算时，素材统计依然可用。 */ }
  return result;
}
