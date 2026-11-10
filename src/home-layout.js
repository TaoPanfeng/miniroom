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
