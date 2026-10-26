import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';

/** 小屋的几何、贴图和动画全部在本机生成，无外部资源请求。 */
export function createRoom({ canvas, onSelect = () => {}, onHover = () => {}, onReady = () => {} }) {
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  const compactTouchScreen = window.matchMedia('(pointer: coarse) and (max-width: 820px)');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compactTouchScreen.matches ? 1.5 : 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const camera = new THREE.OrthographicCamera(-5, 5, 4, -4, 0.1, 80);
  const homePosition = new THREE.Vector3(9, 8.1, 11);
  const homeTarget = new THREE.Vector3(0, 1.25, 0);
  camera.position.copy(homePosition);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(homeTarget);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.enablePan = false;
  controls.minPolarAngle = Math.PI / 5;
  controls.maxPolarAngle = Math.PI / 2.35;
  controls.minAzimuthAngle = -0.12;
  controls.maxAzimuthAngle = Math.PI / 2 + 0.12;
  controls.minZoom = 0.72;
  controls.maxZoom = 2.1;
  controls.zoomSpeed = 0.7;
  controls.rotateSpeed = 0.65;
  controls.update();

  const geometryCache = new Map();
  const materialCache = new Map();
  const textures = new Set();
  const interactive = new Map();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let disposed = false;
  let lampOn = true;
  let rainOn = false;
  let mode = 'day';
  let hovered = null;
  let frame = 0;
  let hasRendered = false;
  let photoVersion = 0;
  let cameraTween = null;
  let previousTick = 0;

  function material(color, options = {}) {
    const key = `${color}:${JSON.stringify(options)}`;
    if (!materialCache.has(key)) materialCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...options }));
    return materialCache.get(key);
  }
  const cream = material('#f3ead9');
  const wallCream = material('#e9e2d4');
  const sage = material('#b0bca6');
  const oak = material('#b78a59');
  const oakLight = material('#d6b788');
  const oakDark = material('#775540');
  const dark = material('#343d37');
  const brass = material('#b48d4e', { metalness: 0.35, roughness: 0.45 });
  const paper = material('#f5edda');
  const terracotta = material('#bf7353');
  const accent = new THREE.MeshStandardMaterial({ color: '#bc785b', roughness: 0.94 });
  const accentLight = new THREE.MeshStandardMaterial({ color: '#d99c79', roughness: 0.98 });
  const leaves = [material('#516b48'), material('#6f8757'), material('#819864')];
  const room = new THREE.Group();
  scene.add(room);

  function box(parent, w, h, d, mat, x = 0, y = 0, z = 0, radius = 0.035) {
    const r = Math.min(radius, w / 2.1, h / 2.1, d / 2.1);
    const key = `box:${w}:${h}:${d}:${r}`;
    if (!geometryCache.has(key)) geometryCache.set(key, new RoundedBoxGeometry(w, h, d, 2, r));
    const object = new THREE.Mesh(geometryCache.get(key), mat);
    object.position.set(x, y, z);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  function sphere(parent, mat, x, y, z, sx, sy = sx, sz = sx) {
    if (!geometryCache.has('sphere')) geometryCache.set('sphere', new THREE.SphereGeometry(1, 24, 16));
    const object = new THREE.Mesh(geometryCache.get('sphere'), mat);
    object.position.set(x, y, z);
    object.scale.set(sx, sy, sz);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  function cylinder(parent, top, bottom, height, mat, x, y, z, segments = 32) {
    const key = `cylinder:${top}:${bottom}:${height}:${segments}`;
    if (!geometryCache.has(key)) geometryCache.set(key, new THREE.CylinderGeometry(top, bottom, height, segments));
    const object = new THREE.Mesh(geometryCache.get(key), mat);
    object.position.set(x, y, z);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  function tube(parent, points, radius, mat) {
    const geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), 24, radius, 8, false);
    geometryCache.set(`tube:${geometryCache.size}`, geometry);
    const object = new THREE.Mesh(geometry, mat);
    object.castShadow = true;
    parent.add(object);
    return object;
  }
  function interact(id, group, position) {
    group.userData.objectId = id;
    group.traverse(child => { if (child.isMesh) child.userData.objectId = id; });
    if (!interactive.has(id)) interactive.set(id, { group, position: new THREE.Vector3(...position) });
  }
  function canvasTexture(width, height, paint) {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    paint(c.getContext('2d'), width, height);
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    textures.add(texture);
    return texture;
  }

  const hemisphere = new THREE.HemisphereLight('#fff4df', '#a7a99a', 2.2);
  scene.add(hemisphere);
  const sunlight = new THREE.DirectionalLight('#fff0d4', 3.6);
  sunlight.position.set(-3, 9, 6);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunlight.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 0.5, far: 24 });
  sunlight.shadow.normalBias = 0.025;
  sunlight.shadow.bias = -0.00015;
  sunlight.shadow.radius = 3;
  scene.add(sunlight);
  const fill = new THREE.DirectionalLight('#e5f0ef', 1.05);
  fill.position.set(6, 5, -4);
  scene.add(fill);

  const groundGeometry = new THREE.PlaneGeometry(30, 30);
  geometryCache.set('ground', groundGeometry);
  const groundMaterial = new THREE.ShadowMaterial({ opacity: 0.14 });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.43;
  ground.receiveShadow = true;
  scene.add(ground);

  // 双层底座让房间像一件放在桌上的建筑模型。
  box(room, 6.65, 0.22, 5.95, material('#d5c1a3'), 0, -0.27, 0, 0.14);
  box(room, 6.62, 0.18, 5.92, oakLight, 0, -0.08, 0, 0.11);
  const woodTexture = canvasTexture(256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#c6a476'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const x = (i * 41.173) % w;
      ctx.strokeStyle = i % 3 ? 'rgba(117,78,40,.09)' : 'rgba(255,246,207,.18)';
      ctx.lineWidth = i % 5 ? 1 : 2;
      ctx.beginPath(); ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + Math.sin(i) * 12, h / 3, x - Math.cos(i) * 9, h * 2 / 3, x + Math.sin(i * 2) * 9, h);
      ctx.stroke();
    }
  });
  const floorMat = new THREE.MeshStandardMaterial({ map: woodTexture, roughness: 0.88, color: '#fff4e4' });
  for (let i = 0; i < 13; i++) {
    const x = -3 + i * 0.5;
    box(room, 0.488, 0.035, 5.62, floorMat, x, 0.028, 0, 0.008);
    for (let j = 0; j < 2; j++) box(room, 0.484, 0.003, 0.013, material('#af895e'), x, 0.047, -1.8 + j * 2.7 + (i % 3) * 0.48, 0.002);
  }
  box(room, 6.58, 3.66, 0.17, wallCream, 0, 1.85, -2.82, 0.04);
  box(room, 0.17, 3.66, 5.72, sage, -3.23, 1.85, 0, 0.04);
  box(room, 6.38, 0.14, 0.075, cream, 0, 0.14, -2.695, 0.018);
  box(room, 0.075, 0.14, 5.55, material('#cdd3bf'), -3.1, 0.14, 0, 0.018);
  box(room, 6.6, 0.095, 0.23, cream, 0, 3.69, -2.82, 0.025);
  box(room, 0.23, 0.095, 5.85, material('#bfc9b4'), -3.23, 3.69, 0, 0.025);

  // 窗景使用原创程序绘图，白天和夜晚都有独立的天空与山影。
  const windowGroup = new THREE.Group();
  windowGroup.position.set(1.27, 1.38, -2.69);
  room.add(windowGroup);
  function archShape(width, height) {
    const r = width / 2;
    const shape = new THREE.Shape();
    shape.moveTo(-r, 0); shape.lineTo(r, 0); shape.lineTo(r, height - r);
    shape.absarc(0, height - r, r, 0, Math.PI, false); shape.lineTo(-r, 0);
    return shape;
  }
  function arch(parent, width, height, depth, mat, z) {
    const geometry = new THREE.ExtrudeGeometry(archShape(width, height), { depth, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.012, bevelThickness: 0.012, curveSegments: 24 });
    geometryCache.set(`arch:${width}`, geometry);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.z = z;
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }
  arch(windowGroup, 1.95, 2.02, 0.1, oakLight, 0);
  const windowTextures = {};
  for (const setting of ['day', 'night']) {
    windowTextures[setting] = canvasTexture(512, 512, (ctx, w, h) => {
      const night = setting === 'night';
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, night ? '#233b59' : '#b5d6d1');
      sky.addColorStop(1, night ? '#84939a' : '#e6ead1');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = night ? '#fff1c5' : '#f9eed1';
      ctx.beginPath(); ctx.arc(w * 0.7, h * 0.24, night ? 31 : 49, 0, Math.PI * 2); ctx.fill();
      if (night) {
        ctx.fillStyle = '#fff1cf';
        for (let i = 0; i < 25; i++) { ctx.beginPath(); ctx.arc((i * 163.1) % w, (i * 79.5) % (h * 0.7), i % 3 ? 1.8 : 2.8, 0, 7); ctx.fill(); }
      } else {
        ctx.fillStyle = 'rgba(255,255,240,.5)';
        for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(85 + i * 19, 91 + Math.sin(i) * 7, 28, 12, 0, 0, 7); ctx.fill(); }
      }
      ctx.fillStyle = night ? '#4c6971' : '#9cb8a1';
      ctx.beginPath(); ctx.moveTo(0, h * 0.73); ctx.bezierCurveTo(w * .2, h * .48, w * .5, h * .89, w, h * .6); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
      ctx.fillStyle = night ? '#355453' : '#789f83';
      ctx.beginPath(); ctx.moveTo(0, h * .9); ctx.bezierCurveTo(w * .3, h * .66, w * .7, h * .75, w, h * .86); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
      ctx.fillStyle = night ? '#2d4542' : '#6c8e69';
      ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(w, h); ctx.lineTo(w, h * .9); ctx.bezierCurveTo(w * .6, h * .9, w * .2, h * .86, 0, h * .98); ctx.fill();
    });
  }
  const skyMaterial = new THREE.MeshBasicMaterial({ map: windowTextures.day });
  const skyGeometry = new THREE.ShapeGeometry(archShape(1.72, 1.83), 32);
  // ShapeGeometry 的默认 UV 是世界坐标，这里归一化为窗景图片坐标。
  const uv = skyGeometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + .86) / 1.72, uv.getY(i) / 1.83);
  geometryCache.set('sky', skyGeometry);
  const skyMesh = new THREE.Mesh(skyGeometry, skyMaterial);
  skyMesh.position.set(0, .09, .115); windowGroup.add(skyMesh);
  box(windowGroup, 0.055, 1.78, 0.07, oakLight, 0, 0.98, 0.16, 0.009);
  box(windowGroup, 1.74, 0.055, 0.07, oakLight, 0, 0.93, 0.16, 0.009);
  box(windowGroup, 2.1, .12, .32, cream, 0, -.015, .15, .035);
  interact('window', windowGroup, [1.27, 2.35, -2.5]);

  const rainPositions = new Float32Array(48 * 2 * 3);
  const rainSpeeds = [];
  for (let i = 0; i < 48; i++) {
    const x = Math.sin(i * 14.13) * .74;
    const y = ((i * .173) % 1.22) + .23;
    rainPositions.set([x, y, .18, x - .035, y - .13, .18], i * 6);
    rainSpeeds.push(.38 + (i % 7) * .13);
  }
  const rainGeometry = new THREE.BufferGeometry();
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
  geometryCache.set('rain', rainGeometry);
  const rainMaterial = new THREE.LineBasicMaterial({ color: '#d8e9ee', transparent: true, opacity: .62, depthWrite: false });
  const rain = new THREE.LineSegments(rainGeometry, rainMaterial);
  rain.raycast = () => {}; // 装饰雨线不抢占窗户的鼠标或触屏点击。
  rain.visible = false; windowGroup.add(rain);

  // 书架与书籍；有厚度的书脊和纸页比贴一张图片更有微缩模型感。
  const bookGroup = new THREE.Group(); room.add(bookGroup);
  box(bookGroup, 1.43, 2.72, .08, oakLight, -2.05, 1.4, -2.61, .025);
  box(bookGroup, 1.26, 2.48, .025, material('#ae8d65'), -2.05, 1.4, -2.555, .006);
  for (const x of [-2.72, -1.38]) box(bookGroup, .075, 2.72, .61, oakLight, x, 1.4, -2.31, .015);
  const bookColors = ['#698975', '#d7bd8b', '#b27560', '#e6d9ba', '#495b61', '#b2bf9c', '#d7a375'];
  for (let shelf = 0; shelf < 4; shelf++) {
    const y = .35 + shelf * .63;
    box(bookGroup, 1.38, .075, .65, oakLight, -2.05, y, -2.3, .015);
    let x = -2.57;
    const count = shelf === 2 ? 4 : 7;
    for (let b = 0; b < count; b++) {
      const height = .34 + ((b * 13 + shelf * 7) % 6) * .025;
      const width = .105 + (b % 3) * .024;
      const color = bookColors[(b + shelf * 2) % bookColors.length];
      const book = new THREE.Group(); book.position.set(x, y + .045, -2.17);
      box(book, width, height, .32, material(color), 0, height / 2, 0, .012);
      box(book, width * .73, height * .88, .012, paper, 0, height / 2, -.166, .002);
      box(book, width * .58, .012, .007, paper, 0, height * .78, .164, .001);
      if (b % 2 === 0) box(book, width * .58, .007, .007, paper, 0, height * .67, .164, .001);
      if (b === 6) book.rotation.z = -.13;
      bookGroup.add(book); x += width + .025;
    }
  }
  sphere(bookGroup, cream, -1.65, 1.77, -2.18, .12, .15, .12);
  cylinder(bookGroup, .08, .06, .13, cream, -1.65, 1.9, -2.18);
  interact('books', bookGroup, [-2.05, 1.6, -2.1]);

  // 沙发沿左侧墙摆放；圆润坐垫、靠枕与细腿。
  const sofa = new THREE.Group(); sofa.position.set(-2.29, 0, .38); sofa.rotation.y = Math.PI / 2; room.add(sofa);
  for (const x of [-.84, .84]) for (const z of [-.38, .38]) cylinder(sofa, .055, .04, .25, oakDark, x, .16, z, 12);
  box(sofa, 2.18, .31, 1.14, accent, 0, .42, 0, .13);
  box(sofa, 2.19, .95, .24, accent, 0, .91, -.48, .1);
  for (const x of [-1.01, 1.01]) box(sofa, .25, .57, 1.13, accent, x, .78, 0, .1);
  for (const x of [-.48, .48]) box(sofa, .91, .21, .9, accentLight, x, .66, .065, .09);
  const pillow1 = box(sofa, .54, .51, .16, material('#eadbc0'), -.59, 1.01, -.24, .075); pillow1.rotation.set(-.15, -.05, .18);
  const pillow2 = box(sofa, .45, .44, .18, material('#8f9e7e'), .57, .96, -.22, .075); pillow2.rotation.set(-.13, .02, -.12);
  const blanket = box(sofa, .47, .07, .74, material('#d1b17f'), .5, .8, .24, .028);
  blanket.rotation.z = -.06;
  box(sofa, .47, .29, .07, material('#d1b17f'), .5, .64, .64, .02);
  for (let i = 0; i < 5; i++) box(sofa, .018, .07, .02, paper, .32 + i * .09, .475, .66, .003);

  const rugTexture = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#e8dbbd'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#bba881'; ctx.lineWidth = 5;
    ctx.strokeRect(25, 25, w - 50, h - 50);
    ctx.strokeStyle = 'rgba(150,126,84,.15)'; ctx.lineWidth = 1;
    for (let i = 0; i < h; i += 4) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }
    ctx.strokeStyle = '#b9bca0'; ctx.lineWidth = 4;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(w / 2, h / 2, 70 + i * 36, 110 + i * 30, -.45, 0, Math.PI * 2); ctx.stroke(); }
  });
  const rugMat = new THREE.MeshStandardMaterial({ map: rugTexture, roughness: 1 });
  const rug = box(room, 3.9, .035, 2.47, rugMat, -.15, .075, .92, .12);
  // 用水平平面显示织物图案，避免圆角盒顶面的 UV 拉伸。
  const rugPlaneGeo = new THREE.PlaneGeometry(3.66, 2.25);
  geometryCache.set('rugPlane', rugPlaneGeo);
  const rugPlane = new THREE.Mesh(rugPlaneGeo, rugMat); rugPlane.rotation.x = -Math.PI / 2; rugPlane.position.set(-.15, .097, .92); rugPlane.receiveShadow = true; room.add(rugPlane);
  for (let i = 0; i < 23; i++) {
    const x = -1.9 + i * .16;
    box(room, .025, .017, .1, paper, x, .079, 2.2, .004);
    box(room, .025, .017, .1, paper, x, .079, -.36, .004);
  }

  // 桌面和抽屉。
  const desk = new THREE.Group(); desk.position.set(1.5, 0, -1.72); room.add(desk);
  box(desk, 2.48, .14, 1.12, oakLight, 0, 1.32, 0, .06);
  for (const x of [-1.04, 1.04]) for (const z of [-.38, .38]) box(desk, .085, 1.21, .085, oak, x, .66, z, .018);
  box(desk, .69, .28, .88, cream, .65, 1.1, 0, .025);
  box(desk, .55, .024, .025, oak, .65, 1.13, .45, .007);
  box(desk, 1.47, .022, .68, material('#92a190'), -.2, 1.405, .06, .045);

  const laptop = new THREE.Group(); laptop.position.set(1.18, 1.43, -1.78); room.add(laptop);
  box(laptop, .91, .045, .62, material('#c1c6c0', { metalness: .3, roughness: .45 }), 0, 0, .14, .027);
  const screenGroup = new THREE.Group(); screenGroup.position.set(0, .035, -.14); screenGroup.rotation.x = -.12; laptop.add(screenGroup);
  box(screenGroup, .9, .58, .045, dark, 0, .29, 0, .025);
  const screenTexture = canvasTexture(512, 320, (ctx, w, h) => {
    ctx.fillStyle = '#e8e2d4'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#a8b49e'; ctx.fillRect(0, 0, w * .25, h);
    ctx.fillStyle = '#f6f1e8'; ctx.fillRect(w * .32, h * .16, w * .6, h * .62);
    ctx.fillStyle = '#a8b49e'; ctx.beginPath(); ctx.arc(w * .62, h * .43, 43, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f6f1e8'; ctx.fillRect(w * .616, h * .32, 5, 34); ctx.fillRect(w * .62, h * .42, 23, 5);
    ctx.fillStyle = '#8e9e87'; ctx.fillRect(w * .47, h * .65, w * .29, 6);
    ctx.fillStyle = '#d4deca'; for (let i = 0; i < 5; i++) ctx.fillRect(22, 42 + i * 34, 71 - (i % 2) * 16, 9);
  });
  const screenMat = new THREE.MeshBasicMaterial({ map: screenTexture });
  box(screenGroup, .81, .48, .007, screenMat, 0, .29, .027, .006);
  for (let row = 0; row < 4; row++) for (let col = 0; col < 10; col++) box(laptop, .061, .006, .043, dark, -.34 + col * .076, .027, -.04 + row * .06, .004);
  box(laptop, .23, .006, .12, material('#9ba69d'), 0, .028, .32, .01);
  interact('laptop', laptop, [1.18, 1.68, -1.6]);

  const lamp = new THREE.Group(); lamp.position.set(2.37, 1.42, -1.92); room.add(lamp);
  cylinder(lamp, .18, .2, .045, dark, 0, 0, 0);
  cylinder(lamp, .024, .024, .43, brass, 0, .23, 0, 16);
  const shadeMat = new THREE.MeshStandardMaterial({ color: '#d9b960', roughness: .55, emissive: '#efb757', emissiveIntensity: .1 });
  const shade = cylinder(lamp, .12, .25, .25, shadeMat, 0, .51, 0);
  const bulbMat = new THREE.MeshStandardMaterial({ color: '#fff5cd', emissive: '#ffc96b', emissiveIntensity: 1.8 });
  const bulb = sphere(lamp, bulbMat, 0, .4, 0, .09, .025, .09);
  const lampLight = new THREE.PointLight('#ffd394', 1.8, 4, 2); lampLight.position.set(0, .38, .03); lamp.add(lampLight);
  interact('lamp', lamp, [2.37, 1.78, -1.92]);

  const mug = new THREE.Group(); mug.position.set(.51, 1.46, -1.42); room.add(mug);
  cylinder(mug, .102, .092, .19, cream, 0, .065, 0);
  cylinder(mug, .087, .087, .006, material('#654b35'), 0, .163, 0);
  tube(mug, [[.085,.14,0],[.18,.14,0],[.18,.025,0],[.085,.02,0]], .02, cream);
  box(desk, .2, .017, .29, material('#b8725b'), -.91, 1.42, -.23, .008);
  box(desk, .16, .01, .25, paper, -.91, 1.434, -.23, .003);

  const chair = new THREE.Group(); chair.position.set(1.45, 0, -.37); chair.rotation.y = -.1; room.add(chair);
  for (const x of [-.33, .33]) for (const z of [-.29, .29]) {
    const leg = cylinder(chair, .035, .025, .68, oak, x, .37, z, 12);
    leg.rotation.z = x > 0 ? -.08 : .08;
  }
  box(chair, .92, .16, .82, material('#8f9f83'), 0, .75, 0, .12);
  box(chair, .9, .61, .13, material('#9ca98e'), 0, 1.1, .35, .09);
  for (const x of [-.43, .43]) {
    cylinder(chair, .025, .025, .36, oak, x, .92, .19, 12);
    box(chair, .09, .07, .6, oakLight, x, 1.08, .02, .035);
  }

  // 低圆茶几与打开的书。
  const coffee = new THREE.Group(); coffee.position.set(-.75, 0, 1.04); room.add(coffee);
  for (let i = 0; i < 3; i++) { const angle = i * Math.PI * 2 / 3; cylinder(coffee, .045, .03, .47, oak, Math.cos(angle) * .36, .3, Math.sin(angle) * .36, 12); }
  cylinder(coffee, .68, .68, .09, oakLight, 0, .57, 0, 64);
  const openBook = new THREE.Group(); openBook.position.set(-.1, .635, .04); openBook.rotation.y = -.35; coffee.add(openBook);
  box(openBook, .51, .025, .34, material('#77917b'), 0, 0, 0, .008);
  const leftPage = box(openBook, .23, .04, .31, paper, -.12, .02, 0, .004); leftPage.rotation.z = .05;
  const rightPage = box(openBook, .23, .04, .31, paper, .12, .02, 0, .004); rightPage.rotation.z = -.05;
  for (let i = 0; i < 6; i++) {
    box(openBook, .16, .002, .004, material('#c2b898'), -.12, .044, -.11 + i * .034, .001);
    box(openBook, .16, .002, .004, material('#c2b898'), .12, .044, -.11 + i * .034, .001);
  }
  interact('books', coffee, [-.75, .65, 1.04]);

  const plant = new THREE.Group(); plant.position.set(2.59, 0, 1.71); room.add(plant);
  cylinder(plant, .29, .21, .49, terracotta, 0, .33, 0);
  cylinder(plant, .31, .3, .07, material('#cd8a68'), 0, .58, 0);
  cylinder(plant, .255, .255, .012, material('#67513d'), 0, .618, 0);
  const leafMeshes = [];
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI * .765;
    const end = [Math.cos(angle) * (.3 + i % 2 * .12), 1.15 + i % 3 * .23, Math.sin(angle) * (.3 + i % 2 * .12)];
    tube(plant, [[0,.6,0],[end[0] * .25,.95,end[2] * .25],end], .014, leaves[0]);
    const leaf = sphere(plant, leaves[i % 3], ...end, .17, .36, .035);
    leaf.rotation.set(.4 + Math.sin(angle) * .35, -angle, -.4 + Math.cos(angle) * .55);
    leaf.userData.baseRotation = leaf.rotation.z; leafMeshes.push(leaf);
  }
  interact('plant', plant, [2.59, 1.1, 1.71]);

  const littlePlant = new THREE.Group(); littlePlant.position.set(-2.03, 2.89, -2.29); room.add(littlePlant);
  cylinder(littlePlant, .13, .1, .18, cream, 0, 0, 0);
  for (let i = 0; i < 5; i++) {
    const angle = i * 1.4; const leaf = sphere(littlePlant, leaves[i % 3], Math.cos(angle) * .12, .19, Math.sin(angle) * .1, .065, .2, .04); leaf.rotation.z = Math.cos(angle) * .5;
  }

  // 相框默认画作是原创山景；用户照片只作为本地纹理交给场景。
  const frameGroup = new THREE.Group(); frameGroup.position.set(-3.098, 2.25, .72); frameGroup.rotation.y = Math.PI / 2; room.add(frameGroup);
  box(frameGroup, 1.1, 1.34, .075, oakLight, 0, 0, 0, .025);
  box(frameGroup, .97, 1.21, .012, paper, 0, 0, .046, .003);
  const artTexture = canvasTexture(400, 500, (ctx, w, h) => {
    ctx.fillStyle = '#e7d8bb'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#c98b5a'; ctx.beginPath(); ctx.arc(w * .65, h * .28, 57, 0, 7); ctx.fill();
    ctx.fillStyle = '#9eae8b'; ctx.beginPath(); ctx.moveTo(0, h * .7); ctx.lineTo(w * .44, h * .32); ctx.lineTo(w, h * .81); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
    ctx.fillStyle = '#687f6d'; ctx.beginPath(); ctx.moveTo(0, h * .88); ctx.lineTo(w * .32, h * .64); ctx.lineTo(w * .72, h * .77); ctx.lineTo(w, h * .58); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
    ctx.fillStyle = '#50665c'; ctx.beginPath(); ctx.moveTo(0, h * .95); ctx.lineTo(w * .57, h * .88); ctx.lineTo(w, h * .96); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
  });
  const photoMaterial = new THREE.MeshBasicMaterial({ map: artTexture });
  const photoGeo = new THREE.PlaneGeometry(.79, 1.01); geometryCache.set('photo', photoGeo);
  const photo = new THREE.Mesh(photoGeo, photoMaterial); photo.position.z = .055; frameGroup.add(photo);
  interact('photo', frameGroup, [-2.97, 2.25, .72]);

  // 一只蜷在坐垫上的小猫，尾巴和四肢都有独立轮廓。
  const cushion = cylinder(room, .49, .5, .12, material('#b9c1a8'), .65, .17, 1.85, 48);
  const cat = new THREE.Group(); cat.position.set(.65, .24, 1.85); cat.rotation.y = -.42; room.add(cat);
  const fur = material('#d4a66d');
  const furLight = material('#f1ddba');
  const body = sphere(cat, fur, .02, .16, 0, .34, .2, .24);
  const head = sphere(cat, fur, -.24, .26, .08, .18, .17, .16);
  sphere(cat, furLight, -.28, .205, .185, .105, .065, .055);
  sphere(cat, furLight, -.15, .07, .2, .14, .055, .06);
  for (const x of [-.36, -.14]) {
    const ear = cylinder(cat, .006, .075, .17, fur, x, .42, .08, 3); ear.rotation.z = x < -.2 ? .22 : -.22;
    sphere(cat, material('#c4897c'), x, .43, .107, .029, .04, .009);
  }
  for (const x of [-.32, -.2]) {
    tube(cat, [[x - .025,.28,.224],[x,.265,.232],[x + .025,.28,.224]], .008, oakDark);
  }
  sphere(cat, material('#a86d60'), -.265, .225, .241, .012, .009, .007);
  tube(cat, [[.27,.13,-.1],[.4,.1,.05],[.31,.075,.25],[.05,.06,.28],[-.02,.075,.24]], .055, fur);
  for (let i = 0; i < 3; i++) { const stripe = sphere(cat, material('#bd8954'), .05 + i * .09, .325 - i * .018, -.02, .022, .012, .11); stripe.rotation.y = -.15; }
  interact('cat', cat, [.65, .48, 1.85]);

  // 墙上小钟和一盏吊灯，补足房间的生活细节。
  const wallClock = cylinder(room, .25, .25, .045, cream, -.45, 2.96, -2.68, 48); wallClock.rotation.x = Math.PI / 2;
  const clockFace = cylinder(room, .218, .218, .048, paper, -.45, 2.96, -2.651, 48); clockFace.rotation.x = Math.PI / 2;
  box(room, .018, .15, .012, dark, -.45, 3.017, -2.619, .003);
  const hourHand = box(room, .115, .018, .013, dark, -.404, 2.95, -2.615, .003); hourHand.rotation.z = -.35;
  sphere(room, brass, -.45, 2.96, -2.606, .022);
  const basket = new THREE.Group(); basket.position.set(-2.53, 0, 2.1); room.add(basket);
  cylinder(basket, .28, .22, .39, material('#c5aa80'), 0, .25, 0);
  for (let i = 0; i < 4; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.233 + i * .014, .008, 6, 32), oak);
    geometryCache.set(`basketRing${i}`, ring.geometry); ring.rotation.x = Math.PI / 2; ring.position.y = .1 + i * .1; basket.add(ring);
  }
  box(basket, .27, .32, .06, material('#b6c0a3'), -.03, .5, .03, .025).rotation.z = -.15;

  // 家具和投影光源位置固定，阴影只烘绘一次；昼夜切换只改变光色和强度。
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  function pick(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    // 用最近可见表面决定点击目标，让墙壁和家具正常遮挡背后的物品。
    const hit = raycaster.intersectObjects(room.children, true).find(({ object }) => {
      if (!object.isMesh) return false;
      for (let ancestor = object; ancestor; ancestor = ancestor.parent) {
        if (!ancestor.visible) return false;
      }
      return true;
    });
    return hit?.object.userData.objectId || null;
  }
  let downPoint = null;
  const activePointers = new Set();
  let multipleTouches = false;
  function pointerDown(event) {
    if (event.pointerType !== 'touch' && event.button !== 0) return;
    cameraTween = null;
    activePointers.add(event.pointerId);
    if (activePointers.size > 1) multipleTouches = true;
    downPoint = { x: event.clientX, y: event.clientY, id: event.pointerId, at: performance.now() };
  }
  function pointerMove(event) {
    if (event.buttons || event.pointerType === 'touch') return;
    const id = pick(event);
    if (id !== hovered) {
      hovered = id;
      canvas.style.cursor = id ? 'pointer' : 'grab';
    }
    onHover(id, { x: event.clientX, y: event.clientY });
  }
  function pointerUp(event) {
    activePointers.delete(event.pointerId);
    if (!downPoint || downPoint.id !== event.pointerId) {
      if (!activePointers.size) multipleTouches = false;
      return;
    }
    const distance = Math.hypot(event.clientX - downPoint.x, event.clientY - downPoint.y);
    if (!multipleTouches && distance < 7 && performance.now() - downPoint.at < 700) {
      const id = pick(event);
      if (id) onSelect(id);
    }
    downPoint = null;
    if (!activePointers.size) multipleTouches = false;
  }
  function pointerLeave() { hovered = null; onHover(null, { x: 0, y: 0 }); }
  function pointerCancel(event) { activePointers.delete(event.pointerId); downPoint = null; if (!activePointers.size) multipleTouches = false; pointerLeave(); }
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointerleave', pointerLeave);
  canvas.addEventListener('pointercancel', pointerCancel);
  canvas.style.cursor = 'grab';

  function resize() {
    if (disposed) return;
    const { width, height } = canvas.parentElement.getBoundingClientRect();
    if (!width || !height) return;
    const aspect = width / height;
    const span = Math.max(7.65, 9.1 / aspect);
    camera.left = -span * aspect / 2;
    camera.right = span * aspect / 2;
    camera.top = span / 2;
    camera.bottom = -span / 2;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compactTouchScreen.matches ? 1.5 : 2));
    renderer.setSize(width, height, false);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas.parentElement);
  resize();

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function applyLighting() {
    const night = mode === 'night';
    hemisphere.intensity = night ? .95 : 2.2;
    hemisphere.color.set(night ? '#8da9cc' : '#fff4df');
    hemisphere.groundColor.set(night ? '#666776' : '#a7a99a');
    sunlight.color.set(night ? '#a9bddb' : '#fff0d4');
    sunlight.intensity = night ? .7 : 3.6;
    fill.intensity = night ? .45 : 1.05;
    renderer.toneMappingExposure = night ? 1.1 : 1.25;
    skyMaterial.map = windowTextures[mode];
    skyMaterial.needsUpdate = true;
    lampLight.intensity = lampOn ? (night ? 3.5 : 1.8) : 0;
    shadeMat.emissiveIntensity = lampOn ? (night ? .32 : .1) : 0;
    bulbMat.emissiveIntensity = lampOn ? 1.8 : 0;
    screenMat.color.set(night ? '#c0cfb1' : '#ffffff');
  }
  function animate(now) {
    if (disposed) return;
    frame = requestAnimationFrame(animate);
    if (document.hidden) { previousTick = now; return; }
    if (now - previousTick < (reducedMotion.matches ? 32 : 16)) return;
    const dt = Math.min((now - previousTick) / 1000, .05);
    previousTick = now;
    const t = now / 1000;
    if (cameraTween) {
      const progress = Math.min((now - cameraTween.start) / 900, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      camera.position.lerpVectors(cameraTween.fromPosition, cameraTween.position, eased);
      controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.target, eased);
      camera.zoom = THREE.MathUtils.lerp(cameraTween.fromZoom, cameraTween.zoom, eased);
      camera.updateProjectionMatrix();
      if (progress >= 1) cameraTween = null;
    }
    if (!reducedMotion.matches) {
      body.scale.y = .2 + Math.sin(t * 1.7) * .004;
      leafMeshes.forEach((leaf, i) => { leaf.rotation.z = leaf.userData.baseRotation + Math.sin(t * .6 + i) * .018; });
      if (rainOn) {
        for (let i = 0; i < rainSpeeds.length; i++) {
          const p = i * 6;
          rainPositions[p + 1] -= dt * rainSpeeds[i];
          if (rainPositions[p + 1] < .23) rainPositions[p + 1] = 1.45;
          rainPositions[p + 4] = rainPositions[p + 1] - .13;
        }
        rainGeometry.attributes.position.needsUpdate = true;
      }
    }
    controls.update();
    renderer.render(scene, camera);
    if (!hasRendered) { hasRendered = true; onReady(); }
  }
  frame = requestAnimationFrame(animate);

  function tweenCamera(position, target, zoom) {
    cameraTween = { fromPosition: camera.position.clone(), fromTarget: controls.target.clone(), fromZoom: camera.zoom, position, target, zoom, start: performance.now() };
  }

  return {
    setMode(value) { mode = value === 'night' ? 'night' : 'day'; applyLighting(); },
    setLamp(value) { lampOn = Boolean(value); applyLighting(); },
    setRain(value) { rainOn = Boolean(value); rain.visible = rainOn; },
    setAccent(hex) {
      if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
      accent.color.set(hex);
      accentLight.color.set(hex).lerp(new THREE.Color('#f1e3c5'), .25);
    },
    async setPhoto(url) {
      const version = ++photoVersion;
      let texture = artTexture;
      if (url) {
        const image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('照片无法读取，请换一张 JPG、PNG 或 WebP 图片。')); img.src = url; });
        if (disposed || version !== photoVersion) return;
        texture = canvasTexture(512, 650, (ctx, w, h) => {
          const scale = Math.max(w / image.width, h / image.height);
          ctx.drawImage(image, (w - image.width * scale) / 2, (h - image.height * scale) / 2, image.width * scale, image.height * scale);
        });
      }
      if (disposed || version !== photoVersion) return;
      const previous = photoMaterial.map;
      photoMaterial.map = texture; photoMaterial.needsUpdate = true;
      if (previous !== artTexture && previous !== texture) { previous.dispose(); textures.delete(previous); }
    },
    focusObject(id) {
      const object = interactive.get(id);
      if (!object) return;
      const target = homeTarget.clone().lerp(object.position, .55);
      const offset = homePosition.clone().sub(homeTarget);
      tweenCamera(target.clone().add(offset), target, 1.28);
    },
    resetView() { tweenCamera(homePosition.clone(), homeTarget.clone(), 1); },
    snapshot() { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); },
    dispose() {
      if (disposed) return;
      disposed = true; photoVersion++;
      cancelAnimationFrame(frame); observer.disconnect(); controls.dispose();
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointerleave', pointerLeave); canvas.removeEventListener('pointercancel', pointerCancel);
      const allMaterials = new Set();
      scene.traverse(object => { if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => allMaterials.add(m)); });
      allMaterials.forEach(m => m.dispose()); geometryCache.forEach(g => g.dispose()); textures.forEach(t => t.dispose());
      renderer.dispose(); scene.clear();
    },
  };
}
