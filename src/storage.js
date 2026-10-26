const STORAGE_KEY = 'miniroom-state-v1';
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
  databasePromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('这个浏览器暂不支持照片存档，请使用 Chrome 或 Edge。'));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('media')) request.result.createObjectStore('media');
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => { database.close(); databasePromise = undefined; };
      resolve(database);
    };
    request.onerror = () => reject(new Error('照片存档不可用，请检查浏览器的存储设置。'));
    request.onblocked = () => reject(new Error('照片存档正在被其他页面使用，请关闭其他小屋页面后重试。'));
  }).catch(error => { databasePromise = undefined; throw error; });
  return databasePromise;
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

export async function savePhoto(dataURL) {
  if (!validPhoto(dataURL)) throw new Error('请使用压缩后的 JPG、PNG 或 WebP 图片，照片须小于 2 MB。');
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('media', 'readwrite');
    const store = transaction.objectStore('media');
    if (dataURL === null) store.delete('photo');
    else store.put(dataURL, 'photo');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error('照片保存失败，浏览器存储空间可能不足。'));
    transaction.onabort = () => reject(new Error('照片没有保存，请检查浏览器存储权限后重试。'));
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
