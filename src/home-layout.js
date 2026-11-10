/** 约 50㎡ 户型的示意尺寸，按用户手绘的墙、门、房间关系建模；非测绘数据。 */
export const HOME_PLAN = Object.freeze({
  unit: '米', approximateArea: 50, wallHeight: 2.65,
  master: { name: '主卧', x1: -4.3, x2: 0, z1: -2.9, z2: 2.25, color: '#E9D3AE' },
  balcony: { name: '阳台', x1: -4.3, x2: 0, z1: -3.9, z2: -2.9, color: '#E5DDBD' },
  child: { name: '次卧', x1: 0, x2: 3.15, z1: -2.9, z2: -0.45, color: '#DBE9DB' },
  living: { name: '客厅', x1: 0, x2: 3.15, z1: -0.45, z2: 2.25, color: '#EDE0C9' },
  bathroom: { name: '卫生间', x1: -2.15, x2: 0, z1: 2.25, z2: 4.05, color: '#D4E7E6' },
  passage: { name: '入户过道', x1: 0, x2: 1.05, z1: 2.25, z2: 4.05, color: '#EAD9C0' },
  kitchen: { name: '厨房', x1: 1.05, x2: 3.15, z1: 2.25, z2: 4.05, color: '#E2E8D8' },
});
export const HOME_ROOMS = ['master','balcony','child','living','bathroom','passage','kitchen'];
export function homeArea(room) {
  const r = HOME_PLAN[room];
  return r && Number.isFinite(r.x1) ? (r.x2 - r.x1) * (r.z2 - r.z1) : 0;
}
export function roomAt(x, z) {
  return HOME_ROOMS.find(key => {
    const r = HOME_PLAN[key];
    return x >= r.x1 && x <= r.x2 && z >= r.z1 && z <= r.z2;
  }) || null;
}


/**
 * 逐房间观察视点（米）。
 * 仅用于查看和人工校对，不改变房屋实际建模尺寸或既有存档。
 */
export const HOME_FOCUS = Object.freeze({
  master: { label: '主卧', x: -2.58, y: .75, z: -.85, zoom: 1.50, room: 'master' },
  balcony: { label: '阳台', x: -2.10, y: .80, z: -3.39, zoom: 1.65, room: 'balcony' },
  child: { label: '次卧', x: 1.64, y: .73, z: -1.52, zoom: 1.77, room: 'child' },
  living: { label: '客厅', x: 1.46, y: .72, z: .91, zoom: 1.72, room: 'living' },
  bathroom: { label: '卫生间', x: -1.12, y: .80, z: 3.22, zoom: 2.0, room: 'bathroom' },
  passage: { label: '入户过道', x: .50, y: .80, z: 3.18, zoom: 2.03, room: 'passage' },
  kitchen: { label: '厨房', x: 2.18, y: .80, z: 3.25, zoom: 1.93, room: 'kitchen' },
  loft: { label: '引体架与夹层', x: .52, y: 2.17, z: 2.95, zoom: 1.96, room: 'passage' },
});
