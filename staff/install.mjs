const button=document.querySelector('#installApp');
let installPrompt=null;
const isInstalled=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const ko=()=>document.documentElement.lang!=='en';
const t=(a,b)=>ko()?a:b;
function update(){button.hidden=isInstalled();button.textContent=t('앱 추가','Get the app');}
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;update();});
window.addEventListener('appinstalled',()=>{installPrompt=null;update();});
window.matchMedia('(display-mode: standalone)').addEventListener('change',update);
new MutationObserver(update).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
function showHelp(){
 document.querySelector('#installDialog')?.remove();
 const dialog=document.createElement('dialog');dialog.id='installDialog';dialog.className='install-dialog';
 const ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const inside=/KAKAOTALK|Instagram|FBAN|FBAV/i.test(navigator.userAgent);
 const instructions=inside?t('카카오톡 등 앱 안에서는 설치가 제한될 수 있어요. 이 주소를 Safari 또는 Chrome에서 열어 주세요.','Open this address in Safari or Chrome outside this messaging app to install.'):ios?t('Safari의 공유 버튼 → 홈 화면에 추가 → 추가를 눌러 주세요.','In Safari, tap Share → Add to Home Screen → Add.'):t('Chrome·Edge의 주소창 설치 아이콘 또는 메뉴에서 “앱 설치”를 선택해 주세요. Mac Safari에서는 파일 → Dock에 추가를 선택해 주세요.','Use the install icon or Install app in Chrome or Edge. In Mac Safari, choose File → Add to Dock.');
 dialog.innerHTML=`<img src="assets/icon-192.png" width="104" height="104" alt="Kream Operations"><h2>${t('크림 운영앱 추가','Get Kream Operations')}</h2><p>${instructions}</p><p class="muted">${t('설치 후에도 기존 계정으로 로그인해 주세요. 인터넷 연결이 필요합니다.','Sign in with your existing account. Internet access is required.')}</p><form method="dialog"><button class="primary">${t('확인','Got it')}</button></form>`;
 document.body.append(dialog);dialog.showModal();dialog.addEventListener('close',()=>button.focus(),{once:true});
}
button.addEventListener('click',async()=>{
 if(!installPrompt){showHelp();return;}
 const prompt=installPrompt;installPrompt=null;
 try{await prompt.prompt();await prompt.userChoice;}catch{showHelp();}finally{update();}
});
if('serviceWorker' in navigator&&window.isSecureContext)navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(()=>{});
update();
