import { clearGalleryStorage, getMediaStats } from './media-store.js';
import { clearStudyStorage, getStudyStorageStats } from './storage.js';

const ROOM_KEY = 'miniroom-current-room-v1';
const NOTICE_KEY = 'miniroom-storage-cleanup-v1';
const CHANNEL_NAME = 'miniroom-storage-cleanup-v1';
const scopes = new Set(['gallery', 'study']);
const subscribers = new Set();
const seen = new Set();
let channel;
let listening = false;
let cleanupQueue = Promise.resolve();

function receiveNotice(value) {
  if (!value || typeof value.id !== 'string' || !value.id || value.id.length > 128 || !Array.isArray(value.cleared)) return;
  const cleared = [...new Set(value.cleared.filter(scope => scopes.has(scope)))];
  if (!cleared.length || seen.has(value.id)) return;
  seen.add(value.id);
  if (seen.size > 100) seen.delete(seen.values().next().value);
  const notice = Object.freeze({ id: value.id, cleared: Object.freeze(cleared) });
  for (const callback of [...subscribers]) {
    try { Promise.resolve(callback(notice)).catch(() => {}); } catch { /* 一个界面订阅者异常不影响清理结果或其他订阅者。 */ }
  }
}

function onStorage(event) {
  if (event.key !== NOTICE_KEY || !event.newValue) return;
  try { receiveNotice(JSON.parse(event.newValue)); } catch { /* 忽略其他页面写入的无效通知。 */ }
}

function onPageShow(event) {
  if (!event.persisted) return;
  try {
    const saved = localStorage.getItem(NOTICE_KEY);
    if (saved) receiveNotice(JSON.parse(saved));
  } catch { /* 返回缓存恢复时尽力补收通知，不影响页面恢复。 */ }
}

function startListening() {
  if (listening) return;
  listening = true;
  globalThis.addEventListener?.('storage', onStorage);
  globalThis.addEventListener?.('pageshow', onPageShow);
  try {
    if (typeof BroadcastChannel === 'function') {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = event => receiveNotice(event.data);
    }
  } catch { /* 不支持广播的浏览器仍通过专用 storage 事件同步。 */ }
}

/** 同页直接通知；其他标签页通过 BroadcastChannel 或专用 storage 键接收。 */
export function subscribeStorageCleanup(callback) {
  if (typeof callback !== 'function') throw new TypeError('清理通知需要一个回调函数。');
  startListening();
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export function notifyStorageCleanup(cleared) {
  const validScopes = [...new Set(Array.from(cleared || []).filter(scope => scopes.has(scope)))];
  if (!validScopes.length) return;
  startListening();
  const notice = {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    cleared: validScopes,
  };
  receiveNotice(notice);
  try { channel?.postMessage(notice); } catch { /* storage 通知仍可工作。 */ }
  try { localStorage.setItem(NOTICE_KEY, JSON.stringify(notice)); } catch { /* 本页与广播通知不依赖可写 localStorage。 */ }
}

/** 字节数为本小屋保存内容的估算，不包含同域其他应用或浏览器数据库开销。 */
export async function getStorageOverview() {
  const results = await Promise.allSettled([
    getMediaStats({ includeOriginEstimate: false }),
    getStudyStorageStats(),
  ]);
  const gallery = { count: 0, images: 0, videos: 0, bytes: 0 };
  const study = { bytes: 0, hasPhoto: false, hasNotes: false, hasSettings: false };
  if (results[0].status === 'fulfilled') {
    const value = results[0].value;
    Object.assign(gallery, { count: value.count, images: value.images, videos: value.videos, bytes: value.bytes });
  } else gallery.error = results[0].reason?.message || '照片墙存储暂时无法读取。';
  if (results[1].status === 'fulfilled') Object.assign(study, results[1].value);
  else study.error = results[1].reason?.message || '书房存储暂时无法读取。';
  return { gallery, study, totalBytes: gallery.bytes + study.bytes };
}

/** 仅操作 miniroom 的两个数据库和限定键，绝不清空整个 origin。 */
export async function clearRoomData(scope) {
  if (!['gallery', 'study', 'all'].includes(scope)) throw new Error('请选择清理照片墙、书房，或全部小屋数据。');
  const operation = async () => {
    const targets = scope === 'all' ? ['gallery', 'study'] : [scope];
    const results = await Promise.allSettled(targets.map(target => target === 'gallery' ? clearGalleryStorage() : clearStudyStorage()));
    const cleared = [], failed = [], changed = [];
    let bytes = 0;
    results.forEach((result, index) => {
      const target = targets[index];
      if (result.status === 'fulfilled') {
        cleared.push(target); changed.push(target); bytes += result.value.bytes;
      } else {
        const error = result.reason;
        failed.push({ scope: target, message: error?.message || '清理未完成，请稍后重试。' });
        if (error?.changed) { changed.push(target); bytes += Number.isFinite(error.bytes) ? error.bytes : 0; }
      }
    });
    if (scope === 'all') {
      try { localStorage.removeItem(ROOM_KEY); }
      catch { failed.push({ scope: 'all', message: '上次打开的小屋记录未能移除，请检查浏览器存储权限后重试。' }); }
    }
    // 即使某房间只清理了一部分，也要使其旧异步任务失效；结果中仍如实列为失败。
    if (changed.length) notifyStorageCleanup(changed);
    return { cleared, failed, bytes };
  };
  const pending = cleanupQueue.then(operation, operation);
  cleanupQueue = pending.catch(() => {});
  return pending;
}
