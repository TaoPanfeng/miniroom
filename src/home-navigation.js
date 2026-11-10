import { HOME_PLAN, roomAt } from './home-layout.js';

/**
 * 以门口为起点的室内站位。方向：yaw=0 朝户型图上方（-Z），
 * pitch>0 抬头；尺寸为手绘图估算，仅供浏览体验，不是测量/施工数据。
 */
export const HOME_STOPS = Object.freeze({
  entrance: { label: '主门', room: 'passage', x: .53, z: 3.83, yaw: 0, pitch: .06 },
  passage:  { label: '入户过道', room: 'passage', x: .53, z: 3.23, yaw: 0, pitch: .02 },
  living:   { label: '客厅', room: 'living', x: .45, z: 1.91, yaw: .72, pitch: -.19 },
  master:   { label: '主卧', room: 'master', x: -1.05, z: .45, yaw: -.62, pitch: -.18 },
  child:    { label: '次卧', room: 'child', x: .82, z: -.78, yaw: 1.05, pitch: -.17 },
  bathroom: { label: '卫生间', room: 'bathroom', x: -1.04, z: 3.85, yaw: -.31, pitch: -.24 },
  kitchen:  { label: '厨房', room: 'kitchen', x: 1.51, z: 3.51, yaw: .51, pitch: -.19 },
  balcony:  { label: '阳台', room: 'balcony', x: -1.75, z: -3.34, yaw: Math.PI, pitch: -.16 },
  loft:     { label: '引体架与夹层', room: 'passage', x: .52, z: 2.98, yaw: 0, pitch: .83 },
});

/** 两房间交界处的有效门洞，走路时不允许从实墙穿过去。 */
export const HOME_PASSAGES = Object.freeze([
  { from: 'passage', to: 'living', axis: 'z', at: 2.25, min: .10, max: .96 },
  { from: 'passage', to: 'bathroom', axis: 'x', at: 0, min: 2.91, max: 3.69 },
  { from: 'passage', to: 'kitchen', axis: 'x', at: 1.05, min: 2.92, max: 3.69 },
  { from: 'master', to: 'living', axis: 'x', at: 0, min: 1.34, max: 2.11 },
  { from: 'child', to: 'living', axis: 'z', at: -.45, min: .37, max: 1.12 },
  { from: 'master', to: 'balcony', axis: 'z', at: -2.9, min: -.84, max: -.09 },
]);

/** 低成本碰撞代理，仅避免行走穿墙及大型家具；不作为实测净空依据。 */
const OBSTACLES = Object.freeze([
  ['master', -3.74, -1.41, -2.63, -.15],
  ['master', -4.29, -2.13, 1.58, 2.22],
  ['child', 1.51, 3.07, -2.53, -.72],
  ['child', .12, 1.25, -2.73, -2.04],
  ['living', 1.02, 2.09, .70, 1.58],
  ['living', 2.39, 3.14, 1.24, 2.11],
  ['bathroom', -2.11, -1.40, 3.27, 4.02],
  ['bathroom', -.80, -.25, 3.20, 3.74],
  ['kitchen', 1.16, 3.14, 2.38, 2.99],
  ['kitchen', 2.57, 3.15, 2.90, 4.02],
]);

export function canStand(x, z, radius = .10) {
  const room = roomAt(x, z);
  if (!room) return false;
  const r = HOME_PLAN[room];
  // 外轮廓边缘留出一点空间。
  if (x < r.x1 + .015 || x > r.x2 - .015 || z < r.z1 + .015 || z > r.z2 - .015) return false;
  for (const [key,x1,x2,z1,z2] of OBSTACLES) {
    if (key !== room) continue;
    if (x > x1 - radius && x < x2 + radius && z > z1 - radius && z < z2 + radius) return false;
  }
  return true;
}

export function canWalk(fromX, fromZ, toX, toZ) {
  const source = roomAt(fromX,fromZ), destination = roomAt(toX,toZ);
  if (!source || !destination || !canStand(toX,toZ,.08)) return false;
  if (source === destination) return true;
  return HOME_PASSAGES.some(door => {
    if (!((door.from === source && door.to === destination)
      || (door.from === destination && door.to === source))) return false;
    // 跨门洞时检查交点，而不只检查下一帧坐标。
    const a = door.axis === 'x' ? fromX : fromZ;
    const b = door.axis === 'x' ? toX : toZ;
    if (Math.abs(b-a) < 1e-6) return false;
    const t = (door.at-a)/(b-a);
    if (t < 0 || t > 1) return false;
    const other = door.axis === 'x'
      ? fromZ+(toZ-fromZ)*t : fromX+(toX-fromX)*t;
    return other > door.min+.07 && other < door.max-.07;
  });
}
