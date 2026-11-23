/**
 * 「外滩时光」独立于原照片小屋的 IndexedDB。
 * 仅在当前浏览器保存压缩的照片副本，不保存原文件也不上传服务器。
 */
export const BUND_DB_NAME='miniroom-bund-memories-v1';
export const BUND_MAX_PHOTOS=100;
const STORE='photos';
let connection=null;
function request(req){
  return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('数据库操作失败'));});
}
export function openBundDatabase(){
  if(!('indexedDB' in window))return Promise.reject(new Error('当前浏览器不支持本机照片数据库。'));
  if(connection)return connection;
  connection=new Promise((resolve,reject)=>{
    const open=indexedDB.open(BUND_DB_NAME,1);
    open.onupgradeneeded=()=>{const db=open.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'id'});};
    open.onsuccess=()=>{const db=open.result;db.onversionchange=()=>{db.close();connection=null;};resolve(db);};
    open.onerror=()=>{connection=null;reject(open.error||new Error('无法打开外滩相册数据库。'));};
    open.onblocked=()=>{connection=null;reject(new Error('其他标签页正在占用照片数据库，请关闭后重试。'));};
  });
  return connection;
}
export async function bundList(){
  const db=await openBundDatabase();
  const rows=await request(db.transaction(STORE,'readonly').objectStore(STORE).getAll());
  return rows.sort((a,b)=>a.year-b.year||a.createdAt-b.createdAt||String(a.id).localeCompare(String(b.id)));
}
export async function bundCount(){
  const db=await openBundDatabase();
  return request(db.transaction(STORE,'readonly').objectStore(STORE).count());
}
function transactionChange(operation){
  return openBundDatabase().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);
    let result;
    tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>reject(tx.error||new Error('保存失败，请检查浏览器剩余空间。'));
    tx.onabort=()=>reject(tx.error||new Error('数据库操作已取消。'));
    try{operation(store,value=>{result=value;},tx);}catch(error){tx.abort();reject(error);}
  }));
}
export async function bundAdd(row){
  return transactionChange((store,done,tx)=>{
    const count=store.count();
    count.onsuccess=()=>{
      if(count.result>=BUND_MAX_PHOTOS){tx.abort();return;}
      const put=store.add(row);
      put.onsuccess=()=>done(row.id);
    };
  }).catch(error=>{
    if(error?.name==='AbortError')throw new Error('照片墙最多保存100张，请先删除不需要的照片。');
    throw error;
  });
}
export async function bundUpdateYear(id,year){
  const safeYear=validateBundYear(year);
  return transactionChange((store,done)=>{
    const req=store.get(id);
    req.onsuccess=()=>{
      const row=req.result;
      if(!row)return done(false);
      row.year=safeYear;
      const put=store.put(row);
      put.onsuccess=()=>done(true);
    };
  });
}
export async function bundRemove(id){
  return transactionChange((store,done)=>{
    const req=store.delete(id);
    req.onsuccess=()=>done(true);
  });
}
export async function bundClear(){
  return transactionChange((store,done)=>{
    const req=store.clear();
    req.onsuccess=()=>done(true);
  });
}
export function validateBundYear(value){
  const year=Number(value);
  const max=new Date().getFullYear()+1;
  if(!Number.isInteger(year)||year<1990||year>max)throw new Error('请选择1990年至'+max+'年之间的年份。');
  return year;
}
function readImageFile(file){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file);
    const image=new Image();
    image.onload=()=>{URL.revokeObjectURL(url);resolve(image);};
    image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('无法解码「'+file.name+'」。iPhone HEIC 可先导出为 JPEG。'));};
    image.src=url;
  });
}
function toBlob(canvas,type,quality){
  return new Promise(resolve=>canvas.toBlob(resolve,type,quality));
}
/** Compress a preview-sized copy to reduce local disk use and browsing memory. */
export async function prepareBundPhoto(file,year){
  if(!(file instanceof File))throw new Error('请选择一张本机图片。');
  if(!/^image\/(jpeg|png|webp|heic|heif|avif)$/i.test(file.type)
    && !/\.(jpe?g|png|webp|heic|heif|avif)$/i.test(file.name))
    throw new Error('仅支持照片文件：JPEG、PNG、WebP，以及浏览器可识别的 HEIC/AVIF。');
  if(file.size>40*1024*1024)throw new Error('单张照片请控制在40MB以内。');
  const safeYear=validateBundYear(year);
  const image=await readImageFile(file);
  const width=image.naturalWidth,height=image.naturalHeight;
  if(!width||!height)throw new Error('照片尺寸无效。');
  const scale=Math.min(1,2000/Math.max(width,height));
  const targetW=Math.max(1,Math.round(width*scale)),targetH=Math.max(1,Math.round(height*scale));
  const canvas=document.createElement('canvas');
  canvas.width=targetW;canvas.height=targetH;
  const ctx=canvas.getContext('2d',{alpha:false});
  if(!ctx)throw new Error('当前浏览器无法处理图片。');
  ctx.fillStyle='#f9f7f1';ctx.fillRect(0,0,targetW,targetH);
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(image,0,0,targetW,targetH);
  let blob=await toBlob(canvas,'image/webp',.84);
  if(!blob||blob.type!=='image/webp')blob=await toBlob(canvas,'image/jpeg',.86);
  if(!blob)throw new Error('照片压缩失败，请换一张 JPEG/PNG 重试。');
  canvas.width=0;canvas.height=0;
  return {
    id:(globalThis.crypto?.randomUUID?.()||('bund-'+Date.now()+'-'+Math.random().toString(36).slice(2))),
    name:String(file.name).slice(0,180),year:safeYear,
    width:targetW,height:targetH,bytes:blob.size,
    createdAt:Date.now(),imageBlob:blob,
  };
}
export function bundGridFor(count){
  if(!Number.isInteger(count)||count<0||count>BUND_MAX_PHOTOS)
    throw new Error('照片数量必须介于0到100之间。');
  if(count<=1)return {columns:1,rows:count||1};
  const columns=Math.min(10,Math.ceil(Math.sqrt(count)));
  return {columns,rows:Math.ceil(count/columns)};
}


/** Estimated bytes of optimized images; actual IndexedDB overhead can differ. */
export async function bundStats(){
  const photos=await bundList();
  return {
    count:photos.length,
    bytes:photos.reduce((total,photo)=>total+(Number(photo.bytes)||photo.imageBlob?.size||0),0)
  };
}
