/** 无 WebGL 时使用的本地 Canvas 2D 小屋；与三维场景保持相同的交互接口。 */
export function createRoomLite({ canvas, onSelect = () => {}, onHover = () => {}, onReady = () => {} }) {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) throw new Error('当前浏览器无法创建画布，请换用现代浏览器。');
  const state = { mode: 'day', lamp: true, rain: false, accent: '#bc785b', yaw: Math.PI / 4, zoom: 1, focus: null };
  const pointers = new Map();
  let width = 1, height = 1, ratio = 1, scale = 1, originX = 0, originY = 0;
  let cos = Math.cos(state.yaw), sin = Math.sin(state.yaw);
  let regions = [], frame = 0, rainTimer = 0, disposed = false, ready = false, hovered = null;
  let photo = null, photoVersion = 0, gestureMoved = false, startPoint = null, pinchDistance = 0, paused = false;
  let focusTimer = 0;
  const art = document.createElement('canvas'); art.width = 400; art.height = 500;
  const artCtx = art.getContext('2d');
  artCtx.fillStyle = '#e7d8bb'; artCtx.fillRect(0, 0, 400, 500);
  artCtx.fillStyle = '#c98b5a'; artCtx.beginPath(); artCtx.arc(265, 135, 57, 0, 7); artCtx.fill();
  for (const [color, points] of [
    ['#a3b191', [[0,350],[170,160],[400,405],[400,500],[0,500]]],
    ['#6c816f', [[0,440],[128,320],[288,385],[400,290],[400,500],[0,500]]],
    ['#50665c', [[0,475],[230,440],[400,480],[400,500],[0,500]]],
  ]) {
    artCtx.fillStyle = color; artCtx.beginPath(); points.forEach(([x,y], i) => i ? artCtx.lineTo(x,y) : artCtx.moveTo(x,y)); artCtx.closePath(); artCtx.fill();
  }
  const palette = { wood: '#cfac7d', woodDark: '#9c754e', cream: '#f1e6ce', sage: '#acbaa3', green: '#688164', ink: '#39473d', white: '#fbf4e5' };
  const bookColors = ['#78917b', '#d8bd89', '#b9765f', '#e2d5b7', '#52666b', '#aab992', '#ca9f70'];
  const objectNames = { lamp: '台灯', books: '书架', plant: '绿植', photo: '相框', laptop: '电脑', cat: '小猫', window: '窗户' };

  function mix(a, b, amount) {
    const first = a.replace('#',''), second = b.replace('#','');
    const result = [0,2,4].map(i => Math.round(parseInt(first.slice(i,i+2),16) * (1-amount) + parseInt(second.slice(i,i+2),16) * amount));
    return `rgb(${result.join(',')})`;
  }
  function tint(color) { return state.mode === 'night' ? mix(color, '#34475c', .26) : color; }
  function project(x, y, z) { return { x: originX + (x * cos - z * sin) * scale, y: originY + ((x * sin + z * cos) * .48 - y) * scale }; }
  function path(points, round = 0) {
    ctx.beginPath();
    if (!round) { points.forEach((p,i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y)); ctx.closePath(); return; }
    for (let i = 0; i < points.length; i++) {
      const previous = points[(i+points.length-1)%points.length], point = points[i], next = points[(i+1)%points.length];
      const before = Math.min(round, Math.hypot(point.x-previous.x,point.y-previous.y)/2);
      const after = Math.min(round, Math.hypot(point.x-next.x,point.y-next.y)/2);
      const a = Math.atan2(previous.y-point.y,previous.x-point.x), b = Math.atan2(next.y-point.y,next.x-point.x);
      const entry = { x:point.x+Math.cos(a)*before, y:point.y+Math.sin(a)*before };
      if (!i) ctx.moveTo(entry.x,entry.y); else ctx.lineTo(entry.x,entry.y);
      ctx.quadraticCurveTo(point.x,point.y,point.x+Math.cos(b)*after,point.y+Math.sin(b)*after);
    }
    ctx.closePath();
  }
  function poly(points, color, round = 0, stroke = null) {
    path(points, round); ctx.fillStyle = color; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = .7; ctx.stroke(); }
  }
  function line(points, color, thickness = 1) {
    ctx.beginPath(); points.forEach((p,i)=> i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y));
    ctx.strokeStyle=color; ctx.lineWidth=thickness; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.stroke();
  }
  function worldLine(points, color, thickness = .02) { line(points.map(p=>project(...p)),tint(color),Math.max(.65,thickness*scale)); }
  function cube(x,y,z,w,h,d,color,round=.02) {
    const x0=x-w/2,x1=x+w/2,y0=y-h/2,y1=y+h/2,z0=z-d/2,z1=z+d/2;
    poly([project(x1,y0,z0),project(x1,y0,z1),project(x1,y1,z1),project(x1,y1,z0)],tint(mixHex(color,'#675341',.16)),round*scale);
    poly([project(x0,y0,z1),project(x1,y0,z1),project(x1,y1,z1),project(x0,y1,z1)],tint(mixHex(color,'#5d5445',.08)),round*scale);
    poly([project(x0,y1,z0),project(x1,y1,z0),project(x1,y1,z1),project(x0,y1,z1)],tint(mixHex(color,'#fff9ea',.16)),round*scale);
  }
  // 返回 hex 以便后续统一进行昼夜调色。
  function mixHex(a,b,t) {
    return '#'+[0,2,4].map(i=>Math.round(parseInt(a.slice(i+1,i+3),16)*(1-t)+parseInt(b.slice(i+1,i+3),16)*t).toString(16).padStart(2,'0')).join('');
  }
  function ellipse(x,y,z,rx,ry,color,rotation=0) {
    const p=project(x,y,z); ctx.beginPath(); ctx.ellipse(p.x,p.y,rx*scale,ry*scale,rotation,0,Math.PI*2); ctx.fillStyle=tint(color); ctx.fill();
  }
  function ball(x,y,z,rx,ry,color,rotation=0) {
    const p=project(x,y,z), gradient=ctx.createRadialGradient(p.x-rx*scale*.35,p.y-ry*scale*.45,1,p.x,p.y,Math.max(rx,ry)*scale*1.2);
    gradient.addColorStop(0,tint(mixHex(color,'#fff7e0',.28))); gradient.addColorStop(1,tint(mixHex(color,'#57483b',.15)));
    ctx.beginPath();ctx.ellipse(p.x,p.y,rx*scale,ry*scale,rotation,0,Math.PI*2);ctx.fillStyle=gradient;ctx.fill();
  }
  function cylinder(x,y,z,r,h,color,topColor=null) {
    const top=project(x,y+h/2,z),bottom=project(x,y-h/2,z),rx=r*scale,ry=r*.48*scale;
    const gradient=ctx.createLinearGradient(top.x-rx,0,top.x+rx,0);
    gradient.addColorStop(0,tint(mixHex(color,'#ffffff',.13)));gradient.addColorStop(.6,tint(color));gradient.addColorStop(1,tint(mixHex(color,'#604a36',.2)));
    ctx.beginPath();ctx.moveTo(top.x-rx,top.y);ctx.lineTo(bottom.x-rx,bottom.y);ctx.ellipse(bottom.x,bottom.y,rx,ry,0,Math.PI,0,true);ctx.lineTo(top.x+rx,top.y);ctx.ellipse(top.x,top.y,rx,ry,0,0,Math.PI,true);ctx.closePath();ctx.fillStyle=gradient;ctx.fill();
    ellipse(x,y+h/2,z,r,r*.48,topColor||mixHex(color,'#fff9df',.18));
  }
  function shadow(x,z,rx,rz,opacity=.12,y=.055) {
    const p=project(x,y,z);ctx.save();ctx.translate(p.x,p.y);ctx.scale(1,.48);ctx.rotate(-state.yaw+Math.PI/4);
    const gradient=ctx.createRadialGradient(0,0,1,0,0,rx*scale);gradient.addColorStop(0,`rgba(74,56,38,${opacity})`);gradient.addColorStop(1,'rgba(74,56,38,0)');
    ctx.scale(1,rz/rx);ctx.fillStyle=gradient;ctx.beginPath();ctx.arc(0,0,rx*scale,0,7);ctx.fill();ctx.restore();
  }
  function face(x,y,z,w,h,axis,paint) {
    const a=axis==='back'?project(x-w/2,y+h/2,z):project(x,y+h/2,z+w/2);
    const b=axis==='back'?project(x+w/2,y+h/2,z):project(x,y+h/2,z-w/2);
    const c=axis==='back'?project(x-w/2,y-h/2,z):project(x,y-h/2,z+w/2);
    ctx.save();ctx.transform((b.x-a.x)/w,(b.y-a.y)/w,(c.x-a.x)/h,(c.y-a.y)/h,a.x,a.y);paint(w,h);ctx.restore();
  }
  function register(id,x,y,z,w,h,d) {
    const points=[];for(const xx of [x-w/2,x+w/2])for(const yy of [y-h/2,y+h/2])for(const zz of [z-d/2,z+d/2])points.push(project(xx,yy,zz));
    points.sort((a,b)=>a.x-b.x||a.y-b.y);
    const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
    const lower=[];for(const p of points){while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop();lower.push(p);}
    const upper=[];for(const p of [...points].reverse()){while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop();upper.push(p);}
    regions.push({id,points:lower.slice(0,-1).concat(upper.slice(0,-1)),center:project(x,y,z)});
  }
  function roundRect(x,y,w,h,r) { ctx.beginPath();ctx.roundRect(x,y,w,h,r); }

  function drawWalls() {
    cube(0,-.26,0,6.65,.22,5.95,'#d4b98f',.12);
    cube(0,-.07,0,6.62,.18,5.92,palette.wood,.10);
    for(let i=0;i<13;i++) {
      const x=-3+i*.5;
      poly([project(x-.245,.032,-2.8),project(x+.245,.032,-2.8),project(x+.245,.032,2.8),project(x-.245,.032,2.8)],tint(i%3===0?'#d3b58a':i%3===1?'#cfad7f':'#c9a778'));
      for(let k=0;k<5;k++){const gx=x-.19+k*.08;worldLine([[gx,.034,-2.75],[gx+.016,.034,-1.35],[gx-.013,.034,.35],[gx+.025,.034,2.75]],k%2?'#d9bd94':'#c3a076',.008);}
      for(let j=0;j<2;j++)worldLine([[x-.242,.035,-1.9+j*2.7+(i%3)*.46],[x+.242,.035,-1.9+j*2.7+(i%3)*.46]],'#b99468',.01);
    }
    cube(0,1.85,-2.82,6.58,3.66,.17,'#e9e2d4',.035);
    cube(-3.23,1.85,0,.17,3.66,5.72,palette.sage,.035);
    cube(0,.14,-2.69,6.38,.14,.075,palette.cream,.015);
    cube(-3.1,.14,0,.075,.14,5.55,'#c8d0bc',.015);
    cube(0,3.69,-2.82,6.6,.095,.23,'#f0e9dc',.015);
    cube(-3.23,3.69,0,.23,.095,5.85,'#c0cbb6',.015);
  }
  function drawWindow(time) {
    const night=state.mode==='night';
    face(1.27,2.38,-2.7,1.95,2.02,'back',(w,h)=>{
      const arch=(inset=0)=>{const r=(w-inset*2)/2;ctx.beginPath();ctx.moveTo(inset,h-inset);ctx.lineTo(w-inset,h-inset);ctx.lineTo(w-inset,r+inset);ctx.arc(w/2,r+inset,r,0,Math.PI,true);ctx.closePath();};
      arch();ctx.fillStyle=tint('#c9aa7f');ctx.fill();
      ctx.save();arch(.11);ctx.clip();
      const gradient=ctx.createLinearGradient(0,0,0,h);gradient.addColorStop(0,night?'#314860':'#b9d8d2');gradient.addColorStop(1,night?'#809397':'#e7e9cf');ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);
      ctx.fillStyle=night?'#fff1c8':'#fcf0cc';ctx.beginPath();ctx.arc(w*.67,h*.28,night?.13:.21,0,7);ctx.fill();
      if(night){ctx.fillStyle='#f4e7c7';for(let i=0;i<22;i++){ctx.beginPath();ctx.arc(.15+(i*.317)%(w-.3),.14+(i*.239)%(h*.65),i%3?.008:.014,0,7);ctx.fill();}}
      else{ctx.fillStyle='rgba(255,255,242,.54)';for(let i=0;i<4;i++){ctx.beginPath();ctx.ellipse(.34+i*.08,.44+Math.sin(i)*.02,.12,.05,0,0,7);ctx.fill();}}
      for(const [color,y,curve] of [[night?'#526b70':'#99b59c',1.37,.25],[night?'#3c5957':'#7e9e7f',1.69,-.18],[night?'#324c4a':'#66876a',1.95,.16]]){
        ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(0,y);ctx.bezierCurveTo(w*.35,y-curve,w*.55,y+curve,w,y-.09);ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.fill();
      }
      if(state.rain){ctx.strokeStyle='rgba(230,244,247,.72)';ctx.lineWidth=.008;for(let i=0;i<35;i++){const x=.16+(i*.113)%(w-.32),y=.1+((i*.137+time*.0004)%1.9);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-.025,y+.10);ctx.stroke();}}
      ctx.restore();
      ctx.fillStyle=tint('#d4b78a');ctx.fillRect(w/2-.028,.15,.056,h-.25);ctx.fillRect(.10,1.05,w-.2,.05);
      ctx.strokeStyle=night?'rgba(221,233,235,.16)':'rgba(255,255,246,.24)';ctx.lineWidth=.10;ctx.beginPath();ctx.moveTo(.27,.55);ctx.lineTo(.62,1.02);ctx.moveTo(1.31,.68);ctx.lineTo(1.61,1.08);ctx.stroke();
    });
    cube(1.27,1.35,-2.54,2.1,.12,.35,palette.cream,.03);
    register('window',1.27,2.38,-2.55,1.9,2.05,.18);
    if(!night)poly([project(.64,.058,-1.6),project(2.18,.058,-1.08),project(1.25,.058,.98),project(-.45,.058,.38)],'rgba(255,239,188,.16)');
  }
  function drawPhoto() {
    face(-3.126,2.25,.72,1.1,1.34,'left',(w,h)=>{
      ctx.fillStyle=tint(palette.wood);roundRect(0,0,w,h,.025);ctx.fill();ctx.fillStyle=tint('#f4ebd6');ctx.fillRect(.07,.07,w-.14,h-.14);
      const image=photo||art,tx=.155,ty=.165,tw=.79,th=1.01;
      ctx.save();ctx.beginPath();ctx.rect(tx,ty,tw,th);ctx.clip();
      const factor=Math.max(tw/image.width,th/image.height);ctx.drawImage(image,tx+(tw-image.width*factor)/2,ty+(th-image.height*factor)/2,image.width*factor,image.height*factor);
      if(state.mode==='night'){ctx.fillStyle='rgba(35,51,70,.22)';ctx.fillRect(tx,ty,tw,th);}ctx.restore();
    });
    register('photo',-3.08,2.25,.72,.10,1.34,1.1);
  }
  function drawClock() {
    face(-.4,2.97,-2.695,.55,.55,'back',(w,h)=>{
      ctx.fillStyle=tint('#cab38c');ctx.beginPath();ctx.arc(w/2,h/2,w/2,0,7);ctx.fill();ctx.fillStyle=tint('#f5ecd8');ctx.beginPath();ctx.arc(w/2,h/2,w*.44,0,7);ctx.fill();
      ctx.strokeStyle=tint('#687364');ctx.lineWidth=.012;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(w/2,h*.18);ctx.lineTo(w/2,h/2);ctx.lineTo(w*.72,h*.56);ctx.stroke();
      ctx.fillStyle=tint('#b18c55');ctx.beginPath();ctx.arc(w/2,h/2,.022,0,7);ctx.fill();
    });
  }
  function drawBookcase() {
    shadow(-2.05,-2.15,.9,.5,.12);
    cube(-2.05,1.4,-2.6,1.43,2.72,.08,'#ad8b62',.02);
    for(const x of [-2.72,-1.38])cube(x,1.4,-2.31,.075,2.72,.61,palette.wood,.012);
    for(let shelf=0;shelf<4;shelf++){
      const y=.35+shelf*.63;cube(-2.05,y,-2.3,1.4,.075,.65,palette.wood,.012);
      let x=-2.57;const count=shelf===2?4:7;
      for(let b=0;b<count;b++){
        const h=.34+((b*13+shelf*7)%6)*.025,w=.105+(b%3)*.024,color=bookColors[(b+shelf*2)%bookColors.length];
        cube(x,y+.045+h/2,-2.17,w,h,.32,color,.007);
        worldLine([[x-w*.27,y+.045+h*.78,-2.003],[x+w*.27,y+.045+h*.78,-2.003]],'#ede2c5',.009);
        if(b%2===0)worldLine([[x-w*.27,y+.045+h*.66,-2.003],[x+w*.27,y+.045+h*.66,-2.003]],'#ede2c5',.007);
        x+=w+.025;
      }
    }
    cylinder(-1.65,1.78,-2.12,.12,.20,palette.cream);cylinder(-1.65,1.93,-2.12,.065,.12,palette.cream);
    cube(-2.05,2.8,-2.3,1.46,.09,.68,palette.wood,.02);
    cylinder(-2.05,2.92,-2.3,.12,.18,palette.cream);
    for(let i=0;i<6;i++){const angle=i*1.3;leaf(-2.05,3.02,-2.3,-2.05+Math.cos(angle)*.17,3.23+Math.sin(i)*.08,-2.3+Math.sin(angle)*.13,.08,bookColors[i%3===0?0:5]);}
    register('books',-2.05,1.45,-2.27,1.5,2.8,.7);
  }
  function drawSofa() {
    const light=mixHex(state.accent,'#f1dfbd',.25);
    shadow(-2.25,.4,.85,1.3,.16);
    for(const x of [-2.62,-1.88])for(const z of [-.43,1.23])cylinder(x,.16,z,.045,.26,palette.woodDark);
    cube(-2.26,.45,.4,1.12,.35,2.2,state.accent,.09);
    cube(-2.74,.93,.4,.23,.97,2.2,state.accent,.09);
    for(const z of [-.62,1.42])cube(-2.24,.8,z,1.13,.6,.25,state.accent,.075);
    for(const z of [-.1,.9])cube(-2.19,.7,z,.9,.2,.91,light,.085);
    // 靠枕以柔软的椭圆和高光表现，避免家具退化成硬方块。
    ball(-2.57,1.04,-.14,.23,.28,'#eee0c4',-.2);ball(-2.55,.99,.92,.21,.25,'#9ca889',-.18);
    cube(-2.12,.825,.87,.75,.055,.45,'#cfb17d',.02);
    cube(-1.72,.67,.87,.065,.31,.45,'#cfb17d',.01);
    for(let i=0;i<5;i++)worldLine([[-1.68,.51,.71+i*.08],[-1.68,.45,.71+i*.08]],'#efe0bd',.013);
    register(null,-2.25,.65,.4,1.17,1.3,2.23);
  }
  function drawRug() {
    const corners=[[-2.05,.063,-.34],[1.79,.063,-.34],[1.79,.063,2.16],[-2.05,.063,2.16]];
    poly(corners.map(p=>project(...p)),tint('#e6d8b8'),.1*scale);
    for(let i=0;i<40;i++)worldLine([[-1.98,.064,-.28+i*.06],[1.73,.064,-.28+i*.06]],i%2?'#e9ddc3':'#daccac',.006);
    worldLine([[-1.88,.065,-.18],[1.62,.065,-.18],[1.62,.065,2],[-1.88,.065,2],[-1.88,.065,-.18]],'#bdad89',.018);
    for(let k=0;k<3;k++){
      const pts=[];for(let j=0;j<=48;j++){const a=j*Math.PI*2/48;pts.push(project(-.13+Math.cos(a)*(.44+k*.18),.067,.91+Math.sin(a)*(.75+k*.13)));}line(pts,tint('#b2b99a'),.018*scale);
    }
    for(let i=0;i<22;i++)for(const z of [-.37,2.18])worldLine([[-1.91+i*.166,.063,z],[-1.91+i*.166,.063,z+(z<0?-.08:.08)]],'#ebdebf',.018);
  }
  function drawDesk() {
    shadow(1.5,-1.45,1.4,.8,.16);
    for(const x of [.46,2.54])for(const z of [-2.1,-1.34])cube(x,.68,z,.09,1.23,.09,palette.woodDark,.012);
    cube(2.15,1.11,-1.72,.69,.28,.9,'#e9dec7',.025);
    worldLine([[1.9,1.12,-1.255],[2.4,1.12,-1.255]],'#ad8758',.027);
    cube(1.5,1.32,-1.72,2.48,.14,1.12,palette.wood,.04);
    cube(1.3,1.402,-1.66,1.5,.018,.69,'#90a08d',.025);
    // 笔记本的屏幕、键盘和触控板都保留可辨认的细节。
    cube(1.18,1.435,-1.64,.91,.035,.61,'#bac4ba',.015);
    cube(1.18,1.75,-1.94,.9,.6,.045,palette.ink,.02);
    face(1.18,1.75,-1.913,.81,.49,'back',(w,h)=>{
      ctx.fillStyle=state.mode==='night'?'#c5d3b8':'#e8e1d1';ctx.fillRect(0,0,w,h);
      ctx.fillStyle='#a6b398';ctx.fillRect(0,0,w*.24,h);ctx.fillStyle='#f3eee0';ctx.fillRect(w*.32,h*.15,w*.6,h*.64);
      ctx.fillStyle='#95a486';ctx.beginPath();ctx.arc(w*.62,h*.44,h*.15,0,7);ctx.fill();ctx.strokeStyle='#f7f0df';ctx.lineWidth=.009;ctx.beginPath();ctx.moveTo(w*.62,h*.33);ctx.lineTo(w*.62,h*.44);ctx.lineTo(w*.69,h*.44);ctx.stroke();
      for(let i=0;i<5;i++){ctx.fillStyle='#c5cfb8';ctx.fillRect(.035,.07+i*.05,.12-(i%2)*.025,.014);}ctx.fillStyle='#8da082';ctx.fillRect(w*.47,h*.68,w*.28,.012);
    });
    for(let row=0;row<4;row++)for(let col=0;col<10;col++)poly([[.83+col*.076,1.46,-1.83+row*.06],[.89+col*.076,1.46,-1.83+row*.06],[.89+col*.076,1.46,-1.789+row*.06],[.83+col*.076,1.46,-1.789+row*.06]].map(p=>project(...p)),tint('#667469'),.003*scale);
    cube(1.18,1.46,-1.37,.23,.005,.11,'#98a99b',.008);
    register('laptop',1.18,1.72,-1.73,1,.67,.74);
    cylinder(.52,1.54,-1.43,.10,.19,palette.cream,'#73543b');
    const handle=project(.66,1.55,-1.43);ctx.strokeStyle=tint(palette.cream);ctx.lineWidth=.027*scale;ctx.beginPath();ctx.ellipse(handle.x,handle.y,.07*scale,.064*scale,-.3,0,7);ctx.stroke();
    cube(.59,1.42,-1.98,.23,.025,.32,'#c4876c',.008);cube(.59,1.437,-1.98,.19,.01,.28,'#f3e9cf',.003);
    cylinder(2.37,1.435,-1.92,.18,.04,palette.ink);
    worldLine([[2.37,1.46,-1.92],[2.37,1.87,-1.92]],'#ac8b51',.035);
    const top=project(2.37,2.03,-1.92),bottom=project(2.37,1.79,-1.92);
    const shadeColor=state.lamp?'#d9b96a':'#b9a575';
    const gradient=ctx.createLinearGradient(top.x-.25*scale,0,top.x+.25*scale,0);gradient.addColorStop(0,tint(mixHex(shadeColor,'#fff7df',.3)));gradient.addColorStop(1,tint(shadeColor));
    ctx.beginPath();ctx.moveTo(top.x-.12*scale,top.y);ctx.quadraticCurveTo(top.x,top.y-.09*scale,top.x+.12*scale,top.y);ctx.lineTo(bottom.x+.25*scale,bottom.y);ctx.ellipse(bottom.x,bottom.y,.25*scale,.09*scale,0,0,Math.PI);ctx.closePath();ctx.fillStyle=gradient;ctx.fill();
    ellipse(2.37,1.79,-1.92,.21,.075,state.lamp?'#fff1b8':'#c7b793');
    if(state.lamp){const p=project(2.37,1.42,-1.85),light=ctx.createRadialGradient(p.x,p.y,1,p.x,p.y,scale*.65);light.addColorStop(0,'rgba(255,219,139,.25)');light.addColorStop(1,'rgba(255,219,139,0)');ctx.fillStyle=light;ctx.beginPath();ctx.ellipse(p.x,p.y,scale*.65,scale*.32,0,0,7);ctx.fill();}
    register('lamp',2.37,1.8,-1.92,.57,.75,.51);
  }
  function drawChair() {
    shadow(1.45,-.36,.65,.56,.15);
    for(const x of [1.12,1.78])for(const z of [-.66,-.08])worldLine([[x,.1,z],[x,.76,z]],'#9b7955',.055);
    cube(1.45,.76,-.37,.93,.16,.84,'#8e9e81',.1);
    for(const x of [1.02,1.88]){worldLine([[x,.76,-.17],[x,1.08,-.17]],'#a9875c',.04);cube(x,1.08,-.35,.09,.07,.61,palette.wood,.03);}
    cube(1.45,1.13,-.02,.92,.64,.15,'#9fac91',.065);
    register(null,1.45,.8,-.37,1.05,1.25,.95);
  }
  function drawCoffee() {
    shadow(-.75,1.04,.74,.68,.13);
    for(let i=0;i<3;i++){const a=i*Math.PI*2/3;worldLine([[-.75+Math.cos(a)*.36,.1,1.04+Math.sin(a)*.36],[-.75+Math.cos(a)*.3,.58,1.04+Math.sin(a)*.3]],'#a48053',.065);}
    cylinder(-.75,.59,1.04,.68,.09,palette.wood);
    cube(-.85,.65,1.08,.54,.02,.36,'#7c947d',.008);
    cube(-.986,.68,1.08,.25,.04,.32,'#f4ebd6',.008);cube(-.714,.68,1.08,.25,.04,.32,'#eee3cc',.008);
    for(let i=0;i<6;i++)for(const x of [-.986,-.714])worldLine([[x-.08,.706,.97+i*.036],[x+.08,.706,.97+i*.036]],'#c9bda0',.006);
    register('books',-.75,.48,1.04,1.4,.85,1.4);
  }
  function leaf(x0,y0,z0,x1,y1,z1,w,color) {
    worldLine([[x0,y0,z0],[(x0+x1)/2,(y0+y1)/2+.06,(z0+z1)/2],[x1,y1,z1]],'#6a8056',.014);
    const start=project(x0+(x1-x0)*.5,y0+(y1-y0)*.5,z0+(z1-z0)*.5),end=project(x1,y1,z1),dx=end.x-start.x,dy=end.y-start.y,len=Math.max(1,Math.hypot(dx,dy)),nx=-dy/len,ny=dx/len;
    ctx.beginPath();ctx.moveTo(start.x,start.y);ctx.bezierCurveTo(start.x+dx*.2+nx*w*scale,start.y+dy*.2+ny*w*scale,end.x+nx*w*scale,end.y+ny*w*scale,end.x,end.y);ctx.bezierCurveTo(end.x-nx*w*scale,end.y-ny*w*scale,start.x+dx*.2-nx*w*scale,start.y+dy*.2-ny*w*scale,start.x,start.y);ctx.fillStyle=tint(color);ctx.fill();line([start,end],tint(mixHex(color,'#d5dcb0',.25)),.008*scale);
  }
  function drawPlant() {
    shadow(2.6,1.71,.54,.48,.15);
    cylinder(2.59,.34,1.71,.27,.48,'#bf7d5d');cylinder(2.59,.59,1.71,.30,.07,'#cb8967','#67513e');
    for(let i=0;i<9;i++){const a=i*2.35;leaf(2.59,.61,1.71,2.59+Math.cos(a)*(.38+i%2*.13),1.25+i%3*.24,1.71+Math.sin(a)*(.35+i%2*.11),.13,['#526e49','#6d8654','#819964'][i%3]);}
    register('plant',2.59,1,1.71,1.15,1.9,1.15);
  }
  function drawCat() {
    shadow(.65,1.85,.58,.52,.13);
    cylinder(.65,.16,1.85,.5,.1,'#b4c09f');
    const center=project(.65,.36,1.85);
    ball(.7,.36,1.84,.34,.18,'#d7af7c',-.08);
    const tailStart=project(.94,.32,1.82),tailEnd=project(.52,.26,2.06);
    ctx.beginPath();ctx.moveTo(tailStart.x,tailStart.y);ctx.bezierCurveTo(center.x+scale*.49,center.y+scale*.2,center.x+scale*.17,center.y+scale*.3,tailEnd.x,tailEnd.y);ctx.strokeStyle=tint('#ce9c65');ctx.lineWidth=.105*scale;ctx.lineCap='round';ctx.stroke();
    const head=project(.43,.44,1.94);
    ball(.43,.44,1.94,.17,.15,'#deb886',-.1);
    for(const side of [-1,1])poly([{x:head.x+side*.13*scale,y:head.y-.075*scale},{x:head.x+side*.135*scale,y:head.y-.225*scale},{x:head.x+side*.025*scale,y:head.y-.125*scale}],tint('#d9ad77'),.012*scale);
    for(const side of [-1,1])poly([{x:head.x+side*.115*scale,y:head.y-.105*scale},{x:head.x+side*.12*scale,y:head.y-.18*scale},{x:head.x+side*.065*scale,y:head.y-.126*scale}],tint('#c98b7b'),.005*scale);
    ctx.strokeStyle=tint('#785c43');ctx.lineWidth=.011*scale;ctx.lineCap='round';
    for(const side of [-1,1]){ctx.beginPath();ctx.moveTo(head.x+side*.055*scale-.025*scale,head.y+.008*scale);ctx.quadraticCurveTo(head.x+side*.055*scale,head.y+.025*scale,head.x+side*.055*scale+.025*scale,head.y+.005*scale);ctx.stroke();}
    ctx.fillStyle=tint('#b27a68');ctx.beginPath();ctx.ellipse(head.x,head.y+.055*scale,.014*scale,.009*scale,0,0,7);ctx.fill();
    ball(.53,.25,2.01,.11,.045,'#ead0a4',-.1);
    for(let i=0;i<3;i++){const p=project(.66+i*.095,.49,1.86);line([{x:p.x-.014*scale,y:p.y-.01*scale},{x:p.x+.015*scale,y:p.y+.065*scale}],tint('#c39560'),.023*scale);}
    register('cat',.65,.37,1.85,1,.65,.85);
  }
  function drawBasket() {
    shadow(-2.53,2.1,.4,.35,.11);
    cylinder(-2.53,.27,2.1,.27,.38,'#c2a77b');
    for(let i=0;i<4;i++){const p=project(-2.53,.12+i*.09,2.1);ctx.beginPath();ctx.ellipse(p.x,p.y,.265*scale,.12*scale,0,0,Math.PI);ctx.strokeStyle=tint('#ab8d61');ctx.lineWidth=.013*scale;ctx.stroke();}
    cube(-2.56,.51,2.1,.27,.28,.11,'#b3bea0',.03);
  }
  function drawFocus() {
    if(!state.focus)return;
    const region=[...regions].reverse().find(r=>r.id===state.focus);if(!region)return;
    const p=region.center;
    ctx.save();ctx.strokeStyle=state.mode==='night'?'rgba(242,213,153,.7)':'rgba(122,139,97,.62)';ctx.lineWidth=1.5;ctx.setLineDash([4,5]);path(region.points,8);ctx.stroke();ctx.restore();
    const label=objectNames[state.focus]||'';ctx.font='500 12px system-ui, sans-serif';const tw=ctx.measureText(label).width+24;
    const top=Math.min(...region.points.map(q=>q.y))-14;
    ctx.fillStyle='rgba(255,251,241,.94)';roundRect(p.x-tw/2,top-14,tw,25,12);ctx.fill();ctx.fillStyle='#576549';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,p.x,top-1);
  }
  function draw(time) {
    frame=0;if(disposed)return;
    if(document.hidden||paused)return;
    ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
    cos=Math.cos(state.yaw);sin=Math.sin(state.yaw);
    const raw=[];
    for(const x of [-3.4,3.4])for(const z of [-3.05,3.05])raw.push({x:x*cos-z*sin,y:(x*sin+z*cos)*.48+.45});
    for(const x of [-3.4,3.4])raw.push({x:x*cos+2.85*sin,y:(x*sin-2.85*cos)*.48-3.8});
    for(const z of [-2.85,2.85])raw.push({x:-3.3*cos-z*sin,y:(-3.3*sin+z*cos)*.48-3.8});
    const minX=Math.min(...raw.map(p=>p.x)),maxX=Math.max(...raw.map(p=>p.x)),minY=Math.min(...raw.map(p=>p.y)),maxY=Math.max(...raw.map(p=>p.y));
    scale=Math.min(width/(maxX-minX+1.2),height/(maxY-minY+.8))*state.zoom;
    originX=width*.5-(minX+maxX)*scale/2;originY=height*.52-(minY+maxY)*scale/2;
    regions=[];
    const floor=project(0,-.43,0);ctx.save();ctx.translate(floor.x,floor.y+scale*.12);ctx.scale(1,.38);const under=ctx.createRadialGradient(0,0,scale,0,0,scale*4.4);under.addColorStop(0,'rgba(91,72,48,.13)');under.addColorStop(1,'rgba(91,72,48,0)');ctx.fillStyle=under;ctx.beginPath();ctx.ellipse(0,0,scale*4.8,scale*3.3,0,0,7);ctx.fill();ctx.restore();
    drawWalls();drawWindow(time);drawPhoto();drawClock();drawRug();
    const furniture=[
      {x:-2.05,z:-2.3,draw:drawBookcase},{x:-2.26,z:.4,draw:drawSofa},{x:1.5,z:-1.72,draw:drawDesk},
      {x:1.45,z:-.37,draw:drawChair},{x:-.75,z:1.04,draw:drawCoffee},{x:2.59,z:1.71,draw:drawPlant},
      {x:.65,z:1.85,draw:drawCat},{x:-2.53,z:2.1,draw:drawBasket},
    ];
    furniture.sort((a,b)=>(a.x*sin+a.z*cos)-(b.x*sin+b.z*cos));furniture.forEach(item=>item.draw());drawFocus();
    if(!ready){ready=true;onReady();}
    if(state.rain&&!rainTimer)rainTimer=window.setTimeout(()=>{rainTimer=0;schedule();},75);
  }
  function schedule() { if(!disposed&&!paused&&!frame)frame=requestAnimationFrame(draw); }
  function resize() {
    if(disposed)return;const rect=canvas.parentElement.getBoundingClientRect();if(!rect.width||!rect.height)return;
    width=rect.width;height=rect.height;ratio=Math.min(window.devicePixelRatio||1,1.5);canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);schedule();
  }
  const observer=new ResizeObserver(resize);observer.observe(canvas.parentElement);
  function hit(event) {
    const rect=canvas.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
    for(let k=regions.length-1;k>=0;k--){const r=regions[k];let inside=false;for(let i=0,j=r.points.length-1;i<r.points.length;j=i++){
      const a=r.points[i],b=r.points[j];if(((a.y>y)!==(b.y>y))&&(x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x))inside=!inside;
    }if(inside)return r.id;}return null;
  }
  function pointerDown(event) {
    if(event.pointerType!=='touch'&&event.button!==0)return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pointers.size===1){gestureMoved=false;startPoint={x:event.clientX,y:event.clientY,at:performance.now()};}
    else{gestureMoved=true;const [a,b]=[...pointers.values()];pinchDistance=Math.hypot(a.x-b.x,a.y-b.y);}
    try{canvas.setPointerCapture(event.pointerId);}catch{}
    canvas.style.cursor='grabbing';
  }
  function pointerMove(event) {
    const previous=pointers.get(event.pointerId);
    if(previous){
      pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if(pointers.size>1){const [a,b]=[...pointers.values()],distance=Math.hypot(a.x-b.x,a.y-b.y);if(pinchDistance>0)state.zoom=Math.max(.74,Math.min(1.65,state.zoom*distance/pinchDistance));pinchDistance=distance;}
      else{state.yaw=Math.max(.40,Math.min(1.16,state.yaw+(event.clientX-previous.x)*.004));}
      if(startPoint&&Math.hypot(event.clientX-startPoint.x,event.clientY-startPoint.y)>5)gestureMoved=true;
      state.focus=null;onHover(null,{x:0,y:0});schedule();return;
    }
    hovered=hit(event);canvas.style.cursor=hovered?'pointer':'grab';onHover(hovered,{x:event.clientX,y:event.clientY});
  }
  function pointerUp(event) {
    if(!pointers.has(event.pointerId))return;
    if(pointers.size===1&&!gestureMoved&&startPoint&&performance.now()-startPoint.at<800){const id=hit(event);if(id)onSelect(id);}
    pointers.delete(event.pointerId);if(!pointers.size){startPoint=null;pinchDistance=0;canvas.style.cursor='grab';}
  }
  function pointerCancel(event){pointers.delete(event.pointerId);gestureMoved=true;onHover(null,{x:0,y:0});}
  function pointerLeave(){if(!pointers.size){hovered=null;onHover(null,{x:0,y:0});}}
  function wheel(event){event.preventDefault();state.zoom=Math.max(.74,Math.min(1.65,state.zoom*Math.exp(-event.deltaY*.001)));state.focus=null;schedule();}
  function visibility(){if(document.hidden){clearTimeout(rainTimer);rainTimer=0;}else schedule();}
  canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerCancel);canvas.addEventListener('pointerleave',pointerLeave);canvas.addEventListener('wheel',wheel,{passive:false});document.addEventListener('visibilitychange',visibility);
  canvas.style.touchAction='none';canvas.style.cursor='grab';resize();

  return {
    setPaused(value){paused=Boolean(value);if(paused){cancelAnimationFrame(frame);frame=0;clearTimeout(rainTimer);rainTimer=0;pointers.clear();}else resize();},
    setMode(value){state.mode=value==='night'?'night':'day';schedule();},
    setLamp(value){state.lamp=Boolean(value);schedule();},
    setRain(value){state.rain=Boolean(value);if(!state.rain){clearTimeout(rainTimer);rainTimer=0;}schedule();},
    setAccent(value){if(/^#[0-9a-f]{6}$/i.test(value)){state.accent=value;schedule();}},
    async setPhoto(url){const version=++photoVersion;if(!url){photo=null;schedule();return;}const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('照片无法读取，请换一张 JPG、PNG 或 WebP 图片。'));img.src=url;});if(!disposed&&version===photoVersion){photo=image;schedule();}},
    focusObject(id){if(!objectNames[id])return;state.focus=id;state.zoom=1.06;clearTimeout(focusTimer);focusTimer=window.setTimeout(()=>{state.focus=null;schedule();},3500);schedule();},
    resetView(){state.yaw=Math.PI/4;state.zoom=1;state.focus=null;schedule();},
    snapshot(){if(frame){cancelAnimationFrame(frame);frame=0;}draw(performance.now());return canvas.toDataURL('image/png');},
    dispose(){if(disposed)return;disposed=true;photoVersion++;cancelAnimationFrame(frame);clearTimeout(rainTimer);clearTimeout(focusTimer);observer.disconnect();canvas.removeEventListener('pointerdown',pointerDown);canvas.removeEventListener('pointermove',pointerMove);canvas.removeEventListener('pointerup',pointerUp);canvas.removeEventListener('pointercancel',pointerCancel);canvas.removeEventListener('pointerleave',pointerLeave);canvas.removeEventListener('wheel',wheel);document.removeEventListener('visibilitychange',visibility);pointers.clear();regions=[];photo=null;},
  };
}
