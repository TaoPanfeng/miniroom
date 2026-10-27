const STORAGE_KEY = 'miniroom-state-v1';
const FOCUS_KEY = 'miniroom-focus-v1';
const DATABASE_NAME = 'miniroom-local-v1';
const MAX_PHOTO_LENGTH = 2 * 1024 * 1024;

export const DEFAULTS = Object.freeze({
  roomName: '我的小书房',
  mood: 'day',
  lamp: true,
  accent: '#bc785b',
  volume: 35,
  focusMinutes: 25,
  notes: '',
  bookTitle: '',
  catPats: 0,
  watering: 0,
});

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = value => Number.isInteger(value) && value >= 0 && value <= 1000000;
const validators = {
  roomName: value => typeof value === 'string' && value.trim().length > 0 && value.length <= 30,
  mood: value => ['day', 'night', 'rain'].includes(value),
  lamp: value => typeof value === 'boolean',
  accent: value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value),
  volume: value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100,
  focusMinutes: value => [15, 25, 45].includes(value),
  notes: value => typeof value === 'string' && value.length <= 8000,
  bookTitle: value => typeof value === 'string' && value.length <= 160,
  catPats: isCount,
  watering: isCount,
};

/** 从旧存档或损坏存档中只读取已知且有效的字段。 */
export function normalizeState(input) {
  const state = { ...DEFAULTS };
  if (!isRecord(input)) return state;
  for (const [key, validate] of Object.entries(validators)) {
    if (Object.hasOwn(input, key) && validate(input[key])) state[key] = input[key];
  }
  state.roomName = state.roomName.trim();
  return state;
}

export function loadState() {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(state)));
    return true;
  } catch {
    return false;
  }
}

function validPhoto(value) {
  return value === null || (typeof value === 'string'
    && value.length <= MAX_PHOTO_LENGTH
    && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
    && value.slice(value.indexOf(',') + 1).length % 4 === 0);
}

let databasePromise;
function openDatabase() {
  if (databasePromise) return databasePromise;
  const opening = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('这个浏览器暂不支持照片存档，请使用 Chrome 或 Edge。'));
      return;
    }
    let settled = false;
    const fail = error => { if (!settled) { settled = true; reject(error); } };
    const request = indexedDB.open(DATABASE_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('media')) request.result.createObjectStore('media');
      if (!request.result.objectStoreNames.contains('meta')) request.result.createObjectStore('meta');
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) { database.close(); return; }
      settled = true;
      database.onversionchange = () => { database.close(); if (databasePromise === opening) databasePromise = undefined; };
      database.onclose = () => { if (databasePromise === opening) databasePromise = undefined; };
      resolve(database);
    };
    request.onerror = () => fail(new Error('照片存档不可用，请检查浏览器的存储设置。'));
    request.onblocked = () => fail(new Error('照片存档正在被其他页面使用，请关闭其他小屋页面后重试。'));
  });
  databasePromise = opening;
  opening.catch(() => { if (databasePromise === opening) databasePromise = undefined; });
  return databasePromise;
}

const readRevision = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const textBytes = value => typeof value === 'string' ? new Blob([value]).size : 0;
function staleWriteError() {
  const error = new Error('书房存档已被清理，本次未完成的照片或存档导入已取消。请重新选择文件。');
  error.name = 'StaleWriteError';
  return error;
}

/** 在读取文件或缩放照片前调用，并传给 savePhoto 的 expectedRevision。 */
export async function getStudyRevision() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('meta', 'readonly');
    const request = tx.objectStore('meta').get('cleanup-revision');
    let revision = 0;
    request.onsuccess = () => { revision = readRevision(request.result); };
    tx.oncomplete = () => resolve(revision);
    tx.onerror = () => reject(new Error('书房存档版本暂时无法读取，请稍后重试。'));
    tx.onabort = () => reject(new Error('书房存档版本读取被中断，请重试。'));
  });
}

/** 仅计算本小屋已知内容的字节估算；不使用整个 origin 的占用。 */
export async function getStudyStorageStats() {
  const result = { bytes: 0, hasPhoto: false, hasNotes: false, hasSettings: false };
  const errors = [];
  for (const key of [STORAGE_KEY, FOCUS_KEY]) {
    try {
      const value = localStorage.getItem(key);
      result.bytes += textBytes(value);
      result.hasSettings ||= value !== null;
      if (key === STORAGE_KEY && value) {
        try {
          const stored = JSON.parse(value);
          result.hasNotes = Boolean(stored && ((typeof stored.notes === 'string' && stored.notes.length) || (typeof stored.bookTitle === 'string' && stored.bookTitle.length)));
        } catch { /* 损坏的设置仍计入已保存内容，可以由清理移除。 */ }
      }
    } catch { errors.push(key === STORAGE_KEY ? '书房设置与笔记暂时无法读取。' : '专注计时存档暂时无法读取。'); }
  }
  try {
    const database = await openDatabase();
    const photo = await new Promise((resolve, reject) => {
      const tx = database.transaction('media', 'readonly');
      const request = tx.objectStore('media').get('photo');
      let value;
      request.onsuccess = () => { value = request.result; };
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(new Error('相框照片暂时无法读取。'));
      tx.onabort = () => reject(new Error('相框照片读取被中断。'));
    });
    result.hasPhoto = photo !== undefined && photo !== null;
    result.bytes += textBytes(photo);
  } catch (error) { errors.push(error.message || '相框照片暂时无法读取。'); }
  if (errors.length) result.error = errors.join(' ');
  return result;
}

/** media 与修订号原子清理；localStorage 只移除两个明确属于书房的键。 */
export async function clearStudyStorage() {
  // 先检查设置访问权限，避免一开始就被浏览器阻止时清了一半。
  try { for (const key of [STORAGE_KEY, FOCUS_KEY]) localStorage.getItem(key); }
  catch { throw new Error('书房设置存储不可访问，没有开始清理，请检查浏览器权限。'); }
  const database = await openDatabase();
  let bytes = await new Promise((resolve, reject) => {
    let size = 0;
    const tx = database.transaction(['media', 'meta'], 'readwrite');
    const media = tx.objectStore('media'), meta = tx.objectStore('meta');
    const photo = media.get('photo');
    photo.onsuccess = () => { size = textBytes(photo.result); };
    const revision = meta.get('cleanup-revision');
    revision.onsuccess = () => meta.put(readRevision(revision.result) + 1, 'cleanup-revision');
    media.clear();
    tx.oncomplete = () => resolve(size);
    tx.onerror = () => reject(new Error('相框存档没有清理，书房设置保持不变，请稍后重试。'));
    tx.onabort = () => reject(new Error('书房清理已中断，原存档保持不变，请稍后重试。'));
  });
  const failed = [];
  for (const key of [STORAGE_KEY, FOCUS_KEY]) {
    try {
      const value = localStorage.getItem(key);
      localStorage.removeItem(key);
      bytes += textBytes(value);
    } catch { failed.push(key === STORAGE_KEY ? '设置与笔记' : '专注计时'); }
  }
  if (failed.length) {
    const error = new Error(`书房已部分清理：相框存档已移除，但${failed.join('、')}未能移除，请重试。`);
    error.changed = true;
    error.bytes = bytes;
    throw error;
  }
  return { bytes };
}

export async function loadPhoto() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('media', 'readonly');
    const request = transaction.objectStore('media').get('photo');
    request.onsuccess = () => {
      const photo = request.result ?? null;
      if (validPhoto(photo)) resolve(photo);
      else reject(new Error('已存照片无法读取，请重新选择一张照片。'));
    };
    request.onerror = () => reject(new Error('照片读取失败，请稍后重试。'));
    transaction.onabort = () => reject(new Error('照片读取已中断，请稍后重试。'));
  });
}

export async function savePhoto(dataURL, { expectedRevision } = {}) {
  if (!validPhoto(dataURL)) throw new Error('请使用压缩后的 JPG、PNG 或 WebP 图片，照片须小于 2 MB。');
  if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) throw new Error('书房存档版本无效，请重新选择文件。');
  const revision = expectedRevision === undefined ? await getStudyRevision() : expectedRevision;
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    let reason;
    const transaction = database.transaction(['media', 'meta'], 'readwrite');
    const store = transaction.objectStore('media');
    const request = transaction.objectStore('meta').get('cleanup-revision');
    request.onsuccess = () => {
      if (readRevision(request.result) !== revision) { reason = staleWriteError(); transaction.abort(); return; }
      if (dataURL === null) store.delete('photo');
      else store.put(dataURL, 'photo');
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(reason || new Error('照片保存失败，浏览器存储空间可能不足。'));
    transaction.onabort = () => reject(reason || new Error('照片没有保存，请检查浏览器存储权限后重试。'));
  });
}

/** 导入采用严格校验，先验证整个文件再修改当前存档。 */
export function validateBackup(input) {
  if (!isRecord(input) || input.format !== 'miniroom-backup' || input.version !== 1 || !isRecord(input.state)) {
    throw new Error('这不是可识别的小屋存档，请选择从“导出存档”保存的 JSON 文件。');
  }
  for (const [key, validate] of Object.entries(validators)) {
    if (!Object.hasOwn(input.state, key) || !validate(input.state[key])) {
      throw new Error('存档内容不完整或格式不正确，当前小屋没有更改。');
    }
  }
  if (!Object.hasOwn(input, 'photo') || !validPhoto(input.photo)) {
    throw new Error('存档中的照片格式或大小不符合要求，当前小屋没有更改。');
  }
  return { format: 'miniroom-backup', version: 1, state: normalizeState(input.state), photo: input.photo };
}

export async function createBackup(state) {
  return {
    format: 'miniroom-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    state: normalizeState(state),
    photo: await loadPhoto(),
  };
}
