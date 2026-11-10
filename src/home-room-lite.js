import { HOME_PLAN, HOME_ROOMS, HOME_FOCUS } from './home-layout.js';

/** 浏览器无法创建 WebGL 时，使用同一户型数据绘制可缩放的等轴测轻量模型。 */
export function createHomeRoomLite({ canvas, onPick = () => {}, onReady = () => {} }) {
  const ctx=canvas.getContext('2d',{alpha:true});
  if(!ctx)throw new Error('当前浏览器无法绘制我的家，请换用新版浏览器。');
  let width=1,height=1,scale=1,zoom=1,raf=0,disposed=false,paused=false,fullWalls=false;
  let drag=null, isTop=false, highlighted=null;
  function p(x,y,z) {
    if (isTop) return {x:width*.51+(x+.57)*scale,y:height*.50+(z-.05)*scale-y*scale*.025};
    return {x:width*.51+(x-z)*scale,y:height*.50+(x+z)*scale*.44-y*scale*.85};
  }
  function polygon(points,fill,stroke,line=1) {
    ctx.beginPath();points.forEach((v,i)=>i?ctx.lineTo(v.x,v.y):ctx.moveTo(v.x,v.y));
    ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill();}
    if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=line;ctx.stroke();}
  }
  function isoBox(x,y,z,w,h,d,top='#e8d6b8') {
    const a=p(x-w/2,y+h/2,z-d/2), b=p(x+w/2,y+h/2,z-d/2);
    const c=p(x+w/2,y+h/2,z+d/2), e=p(x-w/2,y+h/2,z+d/2);
    const bb=p(x+w/2,y-h/2,z-d/2),cc=p(x+w/2,y-h/2,z+d/2),ee=p(x-w/2,y-h/2,z+d/2);
    polygon([e,c,cc,ee],'#ae9b80','#b7a28b',.7);
    polygon([b,c,cc,bb],'#bda98b','#b7a28b',.7);
    polygon([a,b,c,e],top,'#c7b49a',.7);
  }
  function segment(x1,z1,x2,z2,wallH=2.4,color='#f0e8d8'){
    const a=p(x1,.06,z1),b=p(x2,.06,z2),c=p(x2,wallH,z2),d=p(x1,wallH,z1);
    polygon([a,b,c,d],color,'#b9ab98',.8);
  }
  function textLabel(label,x,z){
    const q=p(x,.08,z);
    ctx.save();ctx.font='600 '+Math.max(10,Math.min(14,scale*.21))+'px sans-serif';
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle='#53665b';ctx.shadowColor='#fffdf5';ctx.shadowBlur=5;
    ctx.fillText(label,q.x,q.y);ctx.restore();
  }
  function furniture(){
    // 主卧的大床、床头、衣柜和吊灯。
    isoBox(-2.55,.33,-1.38,2.02,.47,2.16,'#fff3de');
    isoBox(-2.55,.56,-2.39,2.10,.46,.16,'#b58f76');
    isoBox(-2.55,.65,-.87,1.92,.05,.78,'#d8bba9');
    isoBox(-2.52,2.22,-2.70,.88,.29,.22,'#F4F6F2');
    isoBox(-3.06,1.1,1.78,2.0,2.1,.50,'#dcc4a0');
    isoBox(-1.30,1.04,1.78,.95,1.98,.48,'#d4b48e');
    // 次卧的小床、写字桌、电子琴和书柜。
    isoBox(2.26,.32,-1.57,1.22,.45,1.65,'#b7d1b7');
    isoBox(.67,.81,-2.30,1.05,.09,.48,'#d5b28c');
    isoBox(.80,.80,-1.29,1.0,.11,.31,'#69756f');
    isoBox(2.85,.93,-.62,.45,1.78,.40,'#d5b890');
    // 客厅桌子、椅子、五层书柜。
    isoBox(1.52,.79,1.13,1.06,.09,.68,'#ddc299');
    isoBox(1.52,.43,.47,.42,.09,.4,'#afc1a2');
    isoBox(1.52,.43,1.84,.42,.09,.4,'#afc1a2');
    isoBox(2.86,1.03,.39,.47,1.94,.36,'#c7aa80');
    // 冰箱及顶部路由器与两根天线。
    isoBox(2.76,.90,1.68,.61,1.67,.61,'#f1f2eb');
    isoBox(2.75,1.78,1.69,.32,.08,.20,'#61716b');
    const wifiA=p(2.65,1.79,1.63),wifiB=p(2.65,2.0,1.63);
    ctx.beginPath();ctx.moveTo(wifiA.x,wifiA.y);ctx.lineTo(wifiB.x,wifiB.y);ctx.strokeStyle='#6c8178';ctx.lineWidth=2;ctx.stroke();
    // 厨房灶台及洗菜池。
    isoBox(2.10,.48,2.68,1.85,.86,.55,'#efede3');
    isoBox(2.89,.47,3.49,.50,.86,1.03,'#efede3');
    isoBox(1.74,.96,2.67,.68,.025,.34,'#68756f');
    isoBox(2.88,.95,3.47,.41,.035,.38,'#8fb2b7');
    isoBox(1.78,2.24,2.62,.77,.22,.41,'#e3e5de');
    // 卫生间洗衣机、马桶、淋浴角与洗手池。
    isoBox(-1.74,.49,3.56,.61,.85,.53,'#fcfaf3');
    isoBox(-1.38,.29,2.74,.48,.39,.51,'#f9fbf6');
    isoBox(-.56,.50,3.42,.51,.77,.43,'#eeeadd');
    isoBox(-.09,1.55,3.48,.04,.59,.51,'#BBD9D9');
    segment(-1.96,2.65,-1.96,2.65,2.09,'#9fbdc0');
    // 阳台晾衣杆和外机。
    isoBox(-3.48,.39,-3.53,.66,.49,.43,'#dbdcd8');
    const rackA=p(-3.91,2.19,-3.54),rackB=p(-.75,2.19,-3.54);
    ctx.beginPath();ctx.moveTo(rackA.x,rackA.y);ctx.lineTo(rackB.x,rackB.y);ctx.strokeStyle='#a9ae9b';ctx.lineWidth=2;ctx.stroke();
    // 引体向上杆，两侧立柱、顶部储物夹层，朝客厅这一侧开口。
    isoBox(.525,2.69,3.24,1.09,.09,1.59,'#d6b68c');
    isoBox(.10,2.45,3.25,.09,.38,1.55,'#bfa17d');
    isoBox(.96,2.45,3.25,.09,.38,1.55,'#bfa17d');
    isoBox(.525,2.13,2.38,.91,.045,.07,'#495e59');
    segment(.10,2.38,.10,2.38,2.2,'#596e68');
    segment(.96,2.38,.96,2.38,2.2,'#596e68');
  }
  function draw(){
    if(disposed||paused)return;
    const ratio=Math.min(window.devicePixelRatio||1,1.8);
    const w=canvas.parentElement.clientWidth||800,h=canvas.parentElement.clientHeight||630;
    if(width!==w||height!==h){width=w;height=h;canvas.width=Math.floor(w*ratio);canvas.height=Math.floor(h*ratio);}
    ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);
    scale=Math.min(w/(isTop?9.7:13.3),h/(isTop?9.8:10.5))*zoom;
    // 真实轮廓：左上阳台，右上次卧，下方独立卫浴、过道、厨房。
    for(const key of HOME_ROOMS){
      const r=HOME_PLAN[key];
      polygon([p(r.x1,.02,r.z1),p(r.x2,.02,r.z1),p(r.x2,.02,r.z2),p(r.x1,.02,r.z2)],r.color,'#b2aa95',1.2);
      if(key==='master'||key==='child'||key==='living'){
        for(let x=r.x1+.38;x<r.x2-.2;x+=.45){
          const a=p(x,.026,r.z1+.07),b=p(x,.026,r.z2-.07);
          ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle='#d8c4a9';ctx.lineWidth=.55;ctx.stroke();
        }
      }
    }
    const wallHeight=fullWalls?2.35:.70;
    segment(-4.3,-3.9,-4.3,2.25,2.45,'#ced5c6');
    segment(-4.3,-3.9,0,-3.9,.9,'#e1d2ae');
    segment(-4.3,-2.9,0,-2.9,2.35,'#e7e5d8');
    segment(0,-2.9,3.15,-2.9,2.35,'#e8e8db');
    segment(3.15,-2.9,3.15,4.05,wallHeight,'#eee7d9');
    segment(-4.3,2.25,-2.15,2.25,wallHeight,'#f1eada');
    segment(-2.15,2.25,-2.15,4.05,wallHeight,'#f1eada');
    segment(-2.15,4.05,0,4.05,wallHeight,'#efebe2');
    segment(0,-2.90,0,-1.06,2.15,'#e0dbcc');
    segment(0,-.28,0,1.33,wallHeight,'#e0dbcc');
    segment(0,-.45,.36,-.45,1.65,'#e0dbcc');
    segment(1.13,-.45,3.15,-.45,wallHeight,'#e0dbcc');
    segment(0,2.25,0,2.9,1.75,'#e7e2d5');
    segment(0,3.70,0,4.05,1.75,'#e7e2d5');
    segment(1.05,2.25,1.05,2.9,wallHeight,'#e7e2d5');
    segment(1.05,3.70,1.05,4.05,wallHeight,'#e7e2d5');
    segment(1.05,2.25,3.15,2.25,wallHeight,'#e7e2d5');
    segment(1.05,4.05,3.15,4.05,wallHeight,'#e7e2d5');
    furniture();
    if (highlighted && HOME_FOCUS[highlighted]) {
      const spot=HOME_FOCUS[highlighted], r=HOME_PLAN[spot.room];
      polygon([p(r.x1,.09,r.z1),p(r.x2,.09,r.z1),p(r.x2,.09,r.z2),p(r.x1,.09,r.z2)],
        'rgba(218,159,96,.14)','#BF7850',Math.max(2,scale*.045));
      if (highlighted==='loft') textLabel('夹层开口',.53,2.46);
    }
    // 重要出入口依照手绘位置画成青绿色。
    for(const [x1,z1,x2,z2] of [[-.86,-2.9,-.07,-2.9],[0,-1.06,0,-.28],[0,1.33,0,2.12],[.36,-.45,1.13,-.45],[0,2.9,0,3.7],[1.05,2.91,1.05,3.7],[.07,4.05,.97,4.05]]){
      const a=p(x1,.08,z1),b=p(x2,.08,z2);
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
      ctx.strokeStyle='#4AAB83';ctx.lineWidth=Math.max(3,scale*.055);ctx.stroke();
    }
    const labels=[
      ['主卧',-1.55,.59],['阳台',-2.28,-3.43],['次卧',1.55,-1.55],
      ['客厅',1.30,.26],['卫生间',-1.05,3.24],
      ['厨房',1.89,3.45],['入户',.52,3.91]
    ];
    for(const [label,x,z] of labels)textLabel(label,x,z);
  }
  function schedule(){if(disposed||paused||raf)return;raf=requestAnimationFrame(()=>{raf=0;draw();});}
  function resize(){width=-1;schedule();}
  const observer=new ResizeObserver(resize);observer.observe(canvas.parentElement);
  function wheel(e){e.preventDefault();zoom=Math.max(.65,Math.min(1.6,zoom*Math.exp(-e.deltaY*.001)));schedule();}
  function down(e){drag={x:e.clientX,y:e.clientY,zoom};}
  function up(e){if(drag&&Math.abs(drag.x-e.clientX)<7&&Math.abs(drag.y-e.clientY)<7)onPick('我的家 · 约 50㎡ 手绘户型，点击右下角按钮切换视角');drag=null;}
  canvas.addEventListener('wheel',wheel,{passive:false});
  canvas.addEventListener('pointerdown',down);
  canvas.addEventListener('pointerup',up);
  draw();onReady();
  return {
    resetView(){zoom=1;isTop=false;highlighted=null;schedule();},
    topView(){zoom=1;isTop=true;schedule();},
    focusRoom(key) {
      if (!HOME_FOCUS[key]) return false;
      highlighted=key;isTop=true;zoom=1;schedule();return true;
    },
    toggleWalls(){fullWalls=!fullWalls;schedule();return !fullWalls;},
    setPaused(next){paused=!!next;if(paused){cancelAnimationFrame(raf);raf=0;}else schedule();},
    dispose(){if(disposed)return;disposed=true;cancelAnimationFrame(raf);observer.disconnect();canvas.removeEventListener('wheel',wheel);canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointerup',up);}
  };
}
