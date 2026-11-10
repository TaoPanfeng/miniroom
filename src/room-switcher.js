import { createHomeView } from './home-room-ui.js';

/** 三间小屋共享切换器。默认进入「我的家」，旧书房和照片墙保持独立。 */
export function initRoomSwitcher({ getStudyName, onChange, notify, onRequestStorage = () => {} }) {
  const button=document.getElementById('roomSwitcherBtn');
  const picker=document.getElementById('roomPickerDialog');
  const study=document.getElementById('studyRoomView');
  const galleryHost=document.getElementById('galleryRoomView');
  const homeHost=document.getElementById('homeRoomView');
  const choices=[...picker.querySelectorAll('[data-room-choice]')];
  const key='miniroom-current-room-v1';
  const names={home:'我的家',study:'书房',gallery:'照片小屋'};
  let current='home',gallery=null,switching=false,disposed=false;
  const home=createHomeView({container:homeHost,notify});

  function paint(){
    document.body.dataset.room=current;
    document.getElementById('currentRoomLabel').textContent=names[current];
    button.setAttribute('aria-label','切换小屋，当前在'+names[current]);
    document.getElementById('studyChoiceName').textContent=getStudyName();
    for(const choice of choices){
      const selected=choice.dataset.roomChoice===current;
      choice.setAttribute('aria-pressed',String(selected));
      choice.querySelector('.room-choice-status').textContent=selected?'当前小屋':'进入小屋';
    }
    document.getElementById('helpBtn').hidden=current!=='study';
    document.getElementById('settingsBtn').hidden=current!=='study';
    document.getElementById('storageManagerBtn').hidden=current==='home';
    document.title=(current==='study'?getStudyName():names[current])+' · 栖间 miniroom';
  }
  async function enter(next,{restore=false}={}){
    if(disposed||switching||!Object.hasOwn(names,next))return false;
    if(next===current){if(picker.open)picker.close();return true;}
    if(gallery?.busy){notify('照片墙正在保存素材，请完成后再切换小屋。');return false;}
    switching=true;
    button.disabled=true;
    choices.forEach(choice=>{choice.disabled=true;});
    if(picker.open)picker.close();
    const prior=current;
    try{
      if(next==='home'){
        if(!await home.open())throw new Error('我的家暂时无法打开。');
      }else if(next==='gallery'){
        if(!gallery){
          const {createGallery}=await import('./gallery.js');
          if(disposed)return false;
          gallery=createGallery({
            container:galleryHost,notify,
            onRequestStudy:()=>{void enter('study');},
            onRequestStorage
          });
        }
        if(!await gallery.open())throw new Error('照片小屋暂时无法打开。');
      }
      if(prior==='gallery'&&gallery&&!gallery.close()){
        if(next==='home')home.close();
        return false;
      }
      if(prior==='home')home.close();
      current=next;
      study.hidden=next!=='study';
      galleryHost.hidden=next!=='gallery';
      homeHost.hidden=next!=='home';
      paint();
      onChange(current);
      try{localStorage.setItem(key,current);}catch{/* 切换无需可写存储。 */}
      if(!restore)window.scrollTo({top:0,behavior:'instant'});
      button.focus({preventScroll:true});
      return true;
    }catch(error){
      if(next==='home')home.close();
      if(next==='gallery')gallery?.close();
      study.hidden=prior!=='study';
      galleryHost.hidden=prior!=='gallery';
      homeHost.hidden=prior!=='home';
      paint();
      notify(error.message||'这间小屋暂时无法打开，请刷新后重试。',5500);
      return false;
    }finally{
      switching=false;
      button.disabled=false;
      choices.forEach(choice=>{choice.disabled=false;});
    }
  }
  const openPicker=()=>{paint();if(!picker.open)picker.showModal();};
  button.addEventListener('click',openPicker);
  const handlers=choices.map(choice=>{
    const handler=()=>{void enter(choice.dataset.roomChoice);};
    choice.addEventListener('click',handler);
    return [choice,handler];
  });

  // 明确以「我的家」为每次访问的默认首页；不覆盖旧书房及照片素材。
  study.hidden=true;
  galleryHost.hidden=true;
  homeHost.hidden=false;
  paint();
  onChange(current);
  void home.open();
  return {
    get current(){return current;},
    get busy(){return switching||Boolean(gallery?.busy);},
    async refreshStorage(cleared=[]){
      if(disposed)return;
      if(gallery&&cleared.includes('gallery'))await gallery.refreshStorage();
      if(!disposed)paint();
    },
    dispose(){
      disposed=true;
      home.dispose();gallery?.dispose();
      button.removeEventListener('click',openPicker);
      handlers.forEach(([choice,handler])=>choice.removeEventListener('click',handler));
    }
  };
}
