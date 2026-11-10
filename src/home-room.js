import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { HOME_PLAN, HOME_ROOMS, roomAt } from './home-layout.js';

/**
 * 我的家 · 约 50㎡ 的手绘户型 Three.js 剖面模型。
 * x 向右、z 向下（对应用户俯视图）；局部尺寸是估算，不冒充测绘。
 * 原书房和照片小屋完全不调用这里的渲染器或存储。
 */
export function createHomeRoom({ canvas, onPick = () => {}, onReady = () => {} }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  const scene = new THREE.Scene();
  const model = new THREE.Group();
  scene.add(model);
  const background = new THREE.Group();
  scene.add(background);
  const camera = new THREE.OrthographicCamera(-9, 9, 6, -6, 0.1, 100);
  const target = new THREE.Vector3(-0.57, 0.35, 0.12);
  const initial = new THREE.Vector3(10.8, 10.9, 12.8);
  camera.position.copy(initial);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enablePan = false;
  controls.minPolarAngle = 0.08;
  controls.maxPolarAngle = Math.PI / 2.12;
  controls.minDistance = 3;
  controls.maxDistance = 30;
  controls.minZoom = 0.65;
  controls.maxZoom = 2.5;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.7;
  controls.update();

  scene.add(new THREE.AmbientLight('#ffffff', .95));
  const hemi = new THREE.HemisphereLight('#f7f1de', '#8eaa95', 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff4dd', 2.5);
  sun.position.set(-5, 12, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -12; sun.shadow.camera.right = 12;
  sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
  sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 40;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  let disposed = false;
  let paused = false;
  let cutaway = true;
  let animationFrame = 0;
  let activeUntil = 0;
  let moved = false;
  let startX = 0, startY = 0;
  const meshResources = new Set();
  const usedMaterials = new Map();
  const customMaterials = new Set();
  const openable = [];
  const cuttable = [];
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  function material(color, opts = {}) {
    const id = color + '|' + (opts.metal ? 'm' : '') + '|' + (opts.transparent ? 't' : '') + '|' + (opts.opacity ?? 1) + '|' + (opts.roughness ?? 0.86);
    if (!usedMaterials.has(id)) {
      usedMaterials.set(id, new THREE.MeshStandardMaterial({
        color, roughness: opts.roughness ?? (opts.metal ? 0.34 : 0.86),
        metalness: opts.metal ? 0.48 : 0, transparent: !!opts.transparent,
        opacity: opts.opacity ?? 1, depthWrite: !opts.transparent, side: THREE.DoubleSide
      }));
    }
    return usedMaterials.get(id);
  }
  function cube(parent, w, h, d, x, y, z, color, opts = {}) {
    const geometry = new THREE.BoxGeometry(w, h, d);
    meshResources.add(geometry);
    const mesh = new THREE.Mesh(geometry, material(color, opts));
    mesh.position.set(x, y, z);
    mesh.castShadow = opts.cast !== false && !opts.transparent;
    mesh.receiveShadow = opts.receive !== false;
    parent.add(mesh);
    return mesh;
  }
  function rounded(parent, r1, r2, h, x, y, z, color, opts = {}) {
    const geometry = new THREE.CylinderGeometry(r1, r2, h, opts.segments || 16);
    meshResources.add(geometry);
    const mesh = new THREE.Mesh(geometry, material(color, opts));
    mesh.position.set(x, y, z);
    mesh.castShadow = !opts.transparent;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function ball(parent, r, x, y, z, color) {
    const geo = new THREE.SphereGeometry(r, 12, 9);
    meshResources.add(geo);
    const o = new THREE.Mesh(geo, material(color));
    o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o;
  }
  function group(name, explanation) {
    const g = new THREE.Group();
    g.userData.homeInfo = name + ' · ' + explanation;
    model.add(g);
    return g;
  }
  function decorateFloor(key, color) {
    const r = HOME_PLAN[key];
    const g = group(r.name, '点击家具可以了解摆放细节');
    cube(g, r.x2-r.x1, 0.14, r.z2-r.z1, (r.x1+r.x2)/2, -0.045, (r.z1+r.z2)/2, '#C5AE90');
    cube(g, r.x2-r.x1-.06, .03, r.z2-r.z1-.06, (r.x1+r.x2)/2, .036, (r.z1+r.z2)/2, color);
    if (['master','child','living','passage'].includes(key)) {
      const n = Math.round((r.x2-r.x1)/.32);
      for (let i=1;i<n;i++) {
        cube(g, .009, .004, r.z2-r.z1-.08, r.x1+i*(r.x2-r.x1)/n, .056, (r.z1+r.z2)/2, '#D5BD97');
      }
    } else if (key === 'bathroom' || key === 'kitchen') {
      for(let x=r.x1+.44;x<r.x2-.1;x+=.48) cube(g,.009,.004,r.z2-r.z1-.06,x,.056,(r.z1+r.z2)/2,'#CBD6D0');
      for(let z=r.z1+.44;z<r.z2-.1;z+=.48) cube(g,r.x2-r.x1-.06,.004,.009,(r.x1+r.x2)/2,.057,z,'#CBD6D0');
    }
  }
  const floors = {
    master:'#E9D9BD', balcony:'#E8DFC8', child:'#DDE6CF',
    living:'#EEDFC8', bathroom:'#D8E8E6', passage:'#E9DCC7', kitchen:'#E1EAD9'
  };
  for(const key of HOME_ROOMS) decorateFloor(key, floors[key]);
  // 独立剖面地基轮廓，房屋不是简单的长方形。
  for(const key of HOME_ROOMS){
    const r=HOME_PLAN[key];
    cube(background,r.x2-r.x1+.10,.16,r.z2-r.z1+.10,
      (r.x1+r.x2)/2,-.175,(r.z1+r.z2)/2,'#E5DCCA',{cast:false});
  }
  const shadowMat = new THREE.MeshBasicMaterial({color:'#A9B0A2',transparent:true,opacity:.085,depthWrite:false});
  customMaterials.add(shadowMat);
  const shadowGeo = new THREE.CircleGeometry(7.2,64); meshResources.add(shadowGeo);
  const shadow = new THREE.Mesh(shadowGeo,shadowMat);
  shadow.rotation.x=-Math.PI/2;shadow.scale.set(1.05,.76,1);
  shadow.position.set(-.45,-.39,.5);background.add(shadow);

  function wallX(z, x1, x2, height=2.58, opts={}) {
    const h = opts.cut ? .48 : height;
    const wall = cube(model, x2-x1,h,.105,(x1+x2)/2,h/2+.07,z,opts.color || '#F3F0E6');
    if(opts.cut) cuttable.push({ wall, full:height, low:h });
    if(!opts.cut && height>1.75) cube(model,x2-x1,.045,.13,(x1+x2)/2,.13,z,'#BDAA8A',{cast:false});
    return wall;
  }
  function wallZ(x,z1,z2,height=2.58,opts={}) {
    const h=opts.cut?.48:height;
    const wall=cube(model,.105,h,z2-z1,x,h/2+.07,(z1+z2)/2,opts.color || '#F1EEE4');
    if(opts.cut) cuttable.push({ wall,full:height,low:h });
    return wall;
  }
  // 窗口在实体墙中真正留空，下方窗台+上方窗楣+玻璃。
  function windowX(z,x1,x2) {
    wallX(z,x1,x2,.79);
    cube(model,x2-x1,.58,.105,(x1+x2)/2,2.34,z,'#F4F0E5');
    cube(model,x2-x1-.08,1.05,.018,(x1+x2)/2,1.365,z,'#ADD2D4',{transparent:true,opacity:.39});
    cube(model,x2-x1,.055,.18,(x1+x2)/2,.86,z,'#FDFBF3');
    cube(model,x2-x1,.065,.18,(x1+x2)/2,1.9,z,'#FAF5E9');
    cube(model,.045,1.04,.14,(x1+x2)/2,1.37,z,'#FCF8ED');
  }
  function windowZ(x,z1,z2) {
    wallZ(x,z1,z2,.79);
    cube(model,.105,.58,z2-z1,x,2.34,(z1+z2)/2,'#F2EEE4');
    cube(model,.025,1.05,z2-z1-.07,x,1.365,(z1+z2)/2,'#AFCDD1',{transparent:true,opacity:.45});
    cube(model,.18,.065,z2-z1,x,.85,(z1+z2)/2,'#FAF6EC');
    cube(model,.18,.065,z2-z1,x,1.9,(z1+z2)/2,'#FAF6EC');
    cube(model,.12,1.05,.044,x,1.37,(z1+z2)/2,'#FAF6EC');
  }
  // 绿色门板延续手绘标记；门框为柔和胡桃木色，可点击开合。
  function doorX(z,left,width,label,flip=1) {
    const g=group('门',label);
    const right=left+width, hinge=flip>0?left:right;
    cube(g,.075,2.43,.15,left,1.28,z,'#C7A17C');
    cube(g,.075,2.43,.15,right,1.28,z,'#C7A17C');
    cube(g,width+.12,.12,.17,(left+right)/2,2.52,z,'#C7A17C');
    const leaf=new THREE.Group(); leaf.position.set(hinge,.08,z);g.add(leaf);
    cube(leaf,width-.07,2.10,.055,flip*(width-.07)/2,1.08,0,'#8EA990',{cast:true});
    cube(leaf,width-.25,.12,.063,flip*(width-.07)/2,1.7,.01,'#6F927E');
    ball(leaf,.035,flip*(width-.2),1.03,.061,'#D6AD66');
    leaf.rotation.y=flip*.33;
    openable.push({group:g,leaf,angle:flip*.33,goal:flip*.33,flip});
  }
  function doorZ(x,top,width,label,flip=1) {
    const g=group('门',label);
    const end=top+width,hinge=flip>0?top:end;
    cube(g,.15,2.43,.075,x,1.28,top,'#C7A17C');
    cube(g,.15,2.43,.075,x,1.28,end,'#C7A17C');
    cube(g,.17,.12,width+.12,x,2.52,(top+end)/2,'#C7A17C');
    const leaf=new THREE.Group();leaf.position.set(x,.08,hinge);g.add(leaf);
    cube(leaf,.055,2.10,width-.07,0,1.08,flip*(width-.07)/2,'#8EA990');
    cube(leaf,.064,.12,width-.25,.01,1.75,flip*(width-.07)/2,'#6F927E');
    ball(leaf,.035,.065,1.06,flip*(width-.19),'#D6AD66');
    leaf.rotation.y=flip*.36;
    openable.push({group:g,leaf,angle:flip*.36,goal:flip*.36,flip});
  }

  // 左上阳台和主卧。左边、北侧为高墙，朝镜头的墙为剖切。
  wallZ(-4.30,-3.90,2.25,2.59,{color:'#CED8C5'});
  wallX(-3.90,-4.30,0,.85,{color:'#D6C2A5'});
  wallZ(0,-3.90,-2.90,.88);
  wallX(-2.90,-4.30,-3.42);windowX(-2.90,-3.42,-2.69);
  wallX(-2.90,-2.69,-1.96);windowX(-2.90,-1.96,-1.21);
  wallX(-2.90,-1.21,-.86);doorX(-2.90,-.86,.79,'通往阳台',1);
  wallX(2.25,-4.30,-2.15,2.59,{cut:true});

  // 主卧 / 次卧 / 客厅：两个独立房门。
  wallZ(0,-2.90,-1.06,2.57,{color:'#DED8CA'});
  doorZ(0,-1.06,.78,'主卧与次卧之间',1);
  wallZ(0,-.28,1.33,2.57,{cut:true});
  doorZ(0,1.33,.79,'主卧与客厅之间',-1);
  wallZ(0,2.12,2.25,2.55);
  wallX(-2.90,0,1.25);windowX(-2.90,1.25,2.35);wallX(-2.90,2.35,3.15);
  wallZ(3.15,-2.9,-2.52,2.54);windowZ(3.15,-2.52,-1.54);
  wallZ(3.15,-1.54,4.05,2.56,{cut:true});
  wallX(-.45,0,.36,2.18);doorX(-.45,.36,.77,'次卧到客厅',1);
  wallX(-.45,1.13,3.15,2.17,{cut:true});

  // 卫生间、厨房及中间入户走廊。
  wallZ(-2.15,2.25,4.05,2.60,{cut:true});
  wallX(4.05,-2.15,0,2.60,{cut:true});
  wallZ(0,2.25,2.9,2.56);
  doorZ(0,2.90,.80,'卫生间门',1);
  wallZ(0,3.70,4.05,2.56);
  wallZ(1.05,2.25,2.91,2.56,{cut:true});
  doorZ(1.05,2.91,.79,'厨房门',-1);
  wallZ(1.05,3.70,4.05,2.56,{cut:true});
  wallX(2.25,1.05,3.15,2.56,{cut:true});
  wallX(4.05,1.05,3.15,2.56,{cut:true});
  doorX(4.05,.07,.9,'入户主门',1);
  wallX(4.05,0,.07,2.56);

  function bed(cx,cz,w,d,color,description) {
    const g=group('床',description);
    cube(g,w+.15,.25,d+.14,cx,.27,cz,'#AB805D');
    cube(g,w,.21,d,cx,.49,cz,'#F9F3E7');
    cube(g,w,.085,d*.53,cx,.615,cz+d*.19,color);
    cube(g,w+.15,.67,.11,cx,.62,cz-d/2-.04,'#AC8C73');
    for(const px of [-w*.23,w*.23]) {
      cube(g,w*.37,.10,.37,cx+px,.64,cz-d*.34,'#FFFEF5');
      cube(g,w*.31,.038,.30,cx+px,.707,cz-d*.34,'#F0E8D9');
    }
    for(const x of [-w/2+.1,w/2-.1])for(const z of [-d/2+.1,d/2-.1])cube(g,.09,.22,.09,cx+x,.13,cz+z,'#8E654C');
  }
  bed(-2.56,-1.35,2.05,2.16,'#D8B59D','主卧双人床，床头靠北、上方有空调');
  bed(2.28,-1.60,1.24,1.63,'#ACC5B0','儿子的床，靠近次卧南侧和书柜');

  function wardrobe(x,z,w=1.2,h=1.95,d=.54,name='衣柜') {
    const g=group(name,'衣物收纳柜');
    cube(g,w,h,d,x,h/2+.05,z,'#D5BE9C');
    cube(g,w-.09,h-.14,.045,x,h/2+.07,z+d/2+.025,'#EFE0BF');
    cube(g,.018,h-.17,.055,x,h/2+.07,z+d/2+.05,'#B6996F');
    for(const dx of [-.09,.09])cube(g,.025,.20,.05,x+dx,h*.52,z+d/2+.09,'#B3946C',{metal:true});
  }
  wardrobe(-3.21,1.88,1.8,2.15,.57,'主卧大衣柜');
  wardrobe(-1.45,1.88,1.05,2.0,.50,'主卧小衣柜');

  function desk(x,z,w,d,title) {
    const g=group(title,'桌面、椅子与常用物品');
    cube(g,w,.085,d,x,.78,z,'#DBBC91');
    for(const dx of [-w*.42,w*.42])for(const dz of [-d*.40,d*.40])cube(g,.075,.7,.075,x+dx,.42,z+dz,'#A58A6B');
    return g;
  }
  const writing=desk(.68,-2.36,1.05,.50,'儿子写字桌');
  cube(writing,.36,.34,.035,.68,1.0,-2.42,'#9DAEA9');
  cube(writing,.32,.27,.025,.68,1.0,-2.396,'#D9E4DB');
  cube(writing,.25,.024,.25,.68,.85,-2.16,'#B8A47D');
  const chair=group('椅子','写字桌前的小椅子');
  cube(chair,.46,.1,.44,.64,.43,-1.72,'#BAA88A');
  cube(chair,.46,.52,.08,.64,.70,-1.95,'#8DAB97');
  for(const dx of [-.17,.17])for(const dz of [-.16,.16])cube(chair,.05,.40,.05,.64+dx,.23,-1.72+dz,'#A98F72');

  // 墙边电子琴：黑白琴键，旁边小搁板。
  const piano=group('电子琴','靠次卧西侧墙摆放');
  cube(piano,1.10,.12,.34,.77,.78,-1.25,'#6A7068');
  cube(piano,1.00,.014,.25,.77,.865,-1.23,'#FDFBF2');
  for(let i=0;i<16;i++)cube(piano,.009,.018,.22,.28+i*.061,.879,-1.23,'#4F5A54',{cast:false});
  for(let i=0;i<11;i++)cube(piano,.038,.02,.11,.32+i*.091,.895,-1.31,'#414A46');
  for(const dx of [-.42,.42])cube(piano,.06,.68,.065,.77+dx,.4,-1.25,'#8F8E7B');

  function bookshelf(x,z,w,h,title) {
    const g=group(title,'多层开放式书柜');
    cube(g,w,h,.34,x,h/2+.06,z,'#C9AB82');
    cube(g,w-.13,h-.14,.35,x,h/2+.06,z+.025,'#E8D5AF');
    for(let level=0;level<5;level++){
      const y=.25+level*(h-.32)/5;
      cube(g,w-.04,.045,.43,x,y,z+.045,'#A88966');
      const count=Math.max(3,Math.floor((w-.19)/.115));
      for(let b=0;b<count;b++){
        const height=.16+((b*7+level*3)%5)*.045;
        const palette=['#879E8D','#D5A88A','#EADBC1','#869DA5','#BFC6A4','#B68E73'];
        cube(g,.077,height,.23,x-w/2+.13+b*.108,y+height/2+.023,z+.054,palette[(b+level)%palette.length]);
      }
    }
  }
  bookshelf(2.87,-.72,.49,1.80,'次卧床头书柜');
  bookshelf(2.88,.35,.50,2.0,'客厅五层书柜');
  const outlet=group('插座','次卧墙边的电脑与充电器');
  cube(outlet,.16,.18,.05,3.025,1.06,-2.05,'#FDFBF5');

  // 主卧吊灯、阳台晾衣杆和空调外机。
  const lamp=group('吊灯','主卧正上方');
  rounded(lamp,.025,.025,.43,-2.17,2.43,.45,'#B7A47E');
  rounded(lamp,.25,.33,.19,-2.17,2.18,.45,'#F8DD91');
  ball(lamp,.14,-2.17,2.06,.45,'#FFEFBE');
  const clothes=group('阳台','上方晾衣杆与空调外机');
  cube(clothes,3.45,.055,.055,-2.35,2.20,-3.53,'#9B9E95',{metal:true});
  for(const x of [-3.85,-3.08,-2.24,-1.46]) {
    cube(clothes,.43,.52,.025,x,1.90,-3.52,['#FDF9EF','#A7C5C7','#DFB8A4','#E4E1D3'][Math.floor((x+4)*2)],{cast:false});
    cube(clothes,.03,.14,.032,x,2.21,-3.52,'#C8B490');
  }
  const condenser=group('空调外机','位于阳台靠外侧');
  cube(condenser,.76,.52,.45,-3.60,.37,-3.58,'#E7E5DD');
  rounded(condenser,.22,.22,.023,-3.60,.40,-3.345,'#C3CDD0',{segments:28});
  for(let i=0;i<4;i++){
    const blade=cube(condenser,.055,.31,.023,-3.60,.40,-3.33,'#8F9B9B');blade.rotation.z=i*Math.PI/4;
  }
  const acChild=group('空调外机','次卧墙外的空调设备示意');
  cube(acChild,.61,.42,.38,.65,.34,-3.15,'#DEDFD6');

  // 客厅餐桌、椅子与地毯。
  const rug=group('地毯','客厅中间的休息区');
  cube(rug,1.83,.014,1.46,1.52,.075,1.16,'#DDD2BB',{cast:false});
  const table=desk(1.55,1.16,1.05,.68,'客厅桌子');
  rounded(table,.25,.25,.045,1.55,.845,1.16,'#DBC29D',{segments:32});
  for(const z of [.49,1.85]){
    const c=group('椅子','客厅桌子旁');
    cube(c,.48,.10,.50,1.55,.47,z,'#C4A57D');
    cube(c,.48,.45,.075,1.55,.71,z+(z<1?.21:-.21),'#95AA93');
    for(const x of [1.39,1.71])cube(c,.055,.47,.055,x,.26,z,'#A68865');
  }
  const plant=group('盆栽','客厅的一点绿色');
  rounded(plant,.17,.13,.26,.48,.20,.64,'#C68664');
  rounded(plant,.1,.1,.52,.48,.56,.64,'#61785A');
  for(let i=0;i<6;i++){
    const a=i*Math.PI/3;
    const b=ball(plant,.17,.48+Math.cos(a)*.20,.78+Math.sin(i)*.06,.64+Math.sin(a)*.20,'#799875');
    b.scale.set(.65,1.45,.7);
  }

  // 冰箱顶放 Wi-Fi 路由器：设备和两根天线都能看到。
  const fridge=group('冰箱 / Wi-Fi 路由器','客厅东侧，路由器放在冰箱顶部');
  cube(fridge,.65,1.66,.63,2.78,.88,1.62,'#F0F0EA');
  cube(fridge,.60,.025,.035,2.78,1.11,1.957,'#C8CFC9');
  cube(fridge,.038,.23,.042,3.045,1.21,1.955,'#AEBBB7');
  const router=cube(fridge,.35,.075,.24,2.76,1.75,1.60,'#57655F',{roughness:.45});
  for(const dx of [-.12,.12]){
    const ant=cube(fridge,.018,.23,.018,2.76+dx,1.89,1.51,'#4E5B54');
    ant.rotation.z=dx>0?.18:-.18;
  }
  for(const dx of [-.09,.01,.10])ball(fridge,.009,2.76+dx,1.802,1.728,'#B5D29B');

  // 厨房：L 型橱柜、灶台、油烟机、洗菜池与锅。
  const cooking=group('厨房','L 型操作台、灶台、油烟机与水槽');
  cube(cooking,1.92,.84,.53,2.14,.46,2.66,'#DBD6C2');
  cube(cooking,1.95,.075,.59,2.14,.91,2.66,'#F8F6ED');
  cube(cooking,.53,.84,1.13,2.88,.46,3.43,'#DBD6C2');
  cube(cooking,.60,.07,1.13,2.88,.91,3.43,'#F7F4E9');
  cube(cooking,.78,.025,.40,1.76,.96,2.67,'#686D64');
  for(const x of [1.54,1.96]){
    rounded(cooking,.12,.12,.023,x,.986,2.69,'#313935',{segments:24});
    rounded(cooking,.09,.09,.037,x,1.013,2.69,'#868D86',{metal:true});
  }
  cube(cooking,.62,.10,.42,2.88,.965,3.43,'#99AFB0');
  cube(cooking,.52,.08,.33,2.88,1.02,3.43,'#4F7476');
  cube(cooking,.025,.30,.027,3.05,1.16,3.29,'#A2ABA8',{metal:true});
  const hood=cube(cooking,.94,.23,.47,1.76,2.20,2.63,'#E4E5DD');
  cube(cooking,.41,.48,.25,1.76,2.49,2.63,'#E4E5DD');
  rounded(cooking,.19,.18,.14,1.54,1.06,2.68,'#BA9B70',{metal:true,segments:24});
  for(const x of [1.47,2.76])cube(cooking,.02,.2,.02,x,.46,2.961,'#B6AA94');

  // 卫生间：洗衣机 / 马桶 / 洗手池 / 花洒，颜色区分湿区。
  const bath=group('卫生间','洗衣机、马桶、洗手池和淋浴区');
  cube(bath,.64,.86,.57,-1.73,.49,3.60,'#F9FBF7');
  rounded(bath,.24,.24,.017,-1.73,.54,3.89,'#BBC7C9',{segments:28});
  rounded(bath,.17,.17,.02,-1.73,.54,3.91,'#E9EFF0',{segments:28});
  cube(bath,.50,.70,.48,-.54,.41,3.48,'#E5E0D2');
  rounded(bath,.23,.24,.18,-.54,.83,3.48,'#F9FAF4',{segments:32});
  rounded(bath,.19,.20,.09,-.54,.87,3.48,'#E8F0EC',{segments:32});
  rounded(bath,.25,.25,.33,-1.38,.28,2.78,'#FAFAF5',{segments:26});
  rounded(bath,.25,.25,.055,-1.38,.47,2.78,'#E5ECE9',{segments:26});
  cube(bath,.025,2.0,.025,-1.96,1.13,2.60,'#A1BAB8',{metal:true});
  rounded(bath,.12,.12,.045,-1.96,2.08,2.60,'#E6E9E5',{segments:24});
  cube(bath,.028,.95,.71,-1.22,.55,2.44,'#BAD5D2',{transparent:true,opacity:.43});

  // 门口引体向上架及上方镂空储物空间。
  // 储物夹层由两侧板、顶板和朝入户门的后挡板围成，面向架子的口完全敞开。
  const pull=group('引体向上架 / 夹层储物口','从主门延伸过来的高处储物夹层；引体向上时头顶正对敞开的抽屉式开口');
  for(const x of [.09,.96]){
    cube(pull,.075,2.15,.085,x,1.15,2.35,'#516763',{metal:true});
    cube(pull,.085,.37,1.55,x,2.45,3.25,'#C7AD87');
    cube(pull,.08,.13,1.56,x,2.30,3.25,'#E0C6A2');
  }
  cube(pull,1.09,.09,1.60,.525,2.69,3.25,'#D4B78E');
  cube(pull,1.09,.20,.075,.525,2.53,4.03,'#BD9B72');
  cube(pull,.92,.045,.07,.525,2.13,2.39,'#394C4B',{metal:true});
  for(const x of [.22,.82])cube(pull,.10,.10,.21,x,2.12,2.40,'#6F8380',{metal:true});
  // 夹层只展示前缘开口和上层板，不封死引体架至天花板的开口。
  // 水平上方有空洞：视觉上可从前方看到空间内侧。

  const light=group('客厅灯','暖色照明');
  rounded(light,.38,.42,.09,1.48,2.43,.87,'#F8DEAB',{segments:32});
  ball(light,.14,1.48,2.34,.87,'#FFEBC0');

  function updateCutaway() {
    for(const {wall,full,low} of cuttable) {
      const h=cutaway?low:full;
      // create cube geometry retains original low height: scale along y to requested length.
      wall.scale.y=h/low;
      wall.position.y=h/2+.07;
    }
    kick(300);
  }
  function activate(group) {
    const door=openable.find(item=>item.group===group);
    if(door) {
      door.goal=Math.abs(door.goal)<.12?door.flip*.98:0;
      kick(900);
    }
    onPick(group.userData.homeInfo || '我的家');
  }
  function pointerDown(event) {
    moved=false;startX=event.clientX;startY=event.clientY;kick(850);
  }
  function pointerMove(event) {
    if(Math.hypot(event.clientX-startX,event.clientY-startY)>6)moved=true;
    kick(500);
  }
  function pointerUp(event) {
    if(moved || event.button!==0)return;
    const rect=canvas.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    mouse.set(((event.clientX-rect.left)/rect.width)*2-1,-((event.clientY-rect.top)/rect.height)*2+1);
    raycaster.setFromCamera(mouse,camera);
    for(const hit of raycaster.intersectObjects(model.children,true)) {
      let node=hit.object;
      while(node && node!==model && !node.userData.homeInfo)node=node.parent;
      if(node?.userData?.homeInfo){activate(node);break;}
    }
  }
  function render() {
    if(disposed||paused)return;
    controls.update();
    renderer.render(scene,camera);
  }
  function tick(now) {
    animationFrame=0;
    if(disposed||paused)return;
    let animating=false;
    for(const door of openable) {
      const delta=door.goal-door.leaf.rotation.y;
      if(Math.abs(delta)>.008) {
        door.leaf.rotation.y+=delta*.16;
        animating=true;
      } else door.leaf.rotation.y=door.goal;
    }
    render();
    if(now<activeUntil||animating)animationFrame=requestAnimationFrame(tick);
  }
  function kick(duration=350) {
    if(disposed||paused)return;
    activeUntil=Math.max(activeUntil,performance.now()+duration);
    if(!animationFrame)animationFrame=requestAnimationFrame(tick);
  }
  function resize() {
    if(disposed)return;
    const parent=canvas.parentElement;
    const w=Math.max(parent?.clientWidth||0,100),h=Math.max(parent?.clientHeight||0,240);
    const aspect=w/h, halfHeight=Math.max(4.6,5.4/aspect);
    camera.left=-halfHeight*aspect;camera.right=halfHeight*aspect;
    camera.top=halfHeight;camera.bottom=-halfHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(w,h,false);
    kick(300);
  }
  const observer=new ResizeObserver(resize);
  observer.observe(canvas.parentElement);
  controls.addEventListener('change',()=>kick(260));
  canvas.addEventListener('pointerdown',pointerDown);
  canvas.addEventListener('pointermove',pointerMove);
  canvas.addEventListener('pointerup',pointerUp);
  canvas.addEventListener('wheel',()=>kick(600),{passive:true});
  document.addEventListener('visibilitychange',visibility);
  function visibility(){if(!document.hidden)kick(300);}
  resize();
  updateCutaway();
  onReady();
  return {
    resetView(){camera.position.copy(initial);controls.target.copy(target);controls.update();kick(850);},
    topView(){camera.position.set(target.x+.03,17.1,target.z+.03);controls.target.copy(target);controls.update();kick(850);},
    toggleWalls(){cutaway=!cutaway;updateCutaway();return cutaway;},
    setPaused(next){paused=Boolean(next);if(paused){cancelAnimationFrame(animationFrame);animationFrame=0;}else{resize();kick(600);}},
    dispose(){
      if(disposed)return;
      disposed=true;cancelAnimationFrame(animationFrame);
      observer.disconnect();controls.dispose();
      canvas.removeEventListener('pointerdown',pointerDown);
      canvas.removeEventListener('pointermove',pointerMove);
      canvas.removeEventListener('pointerup',pointerUp);
      document.removeEventListener('visibilitychange',visibility);
      model.clear();background.clear();scene.clear();
      for(const geo of meshResources)geo.dispose();
      for(const mat of usedMaterials.values())mat.dispose();
      for(const mat of customMaterials)mat.dispose();
      renderer.dispose();
    }
  };
}
