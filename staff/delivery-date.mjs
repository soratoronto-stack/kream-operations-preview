export function validDeliveryDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;}
export function fullDeliveryDate(value,lang='ko'){return new Intl.DateTimeFormat(lang==='en'?'en-CA':'ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'long',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));}
export function confirmDeliveryDate(value,{lang='ko',doc=document,actionLabel}={}){
 if(!validDeliveryDate(value))return Promise.resolve(false);
 const text=(ko,en)=>lang==='en'?en:ko,dialog=doc.createElement('dialog');dialog.className='install-dialog delivery-date-dialog';dialog.setAttribute('aria-labelledby','deliveryDateTitle');
 const symbol=doc.createElement('div');symbol.className='delivery-confirm-symbol';symbol.textContent='📅';symbol.setAttribute('aria-hidden','true');
 const title=doc.createElement('h2');title.id='deliveryDateTitle';title.textContent=text('입고희망일을 확인해 주세요','Confirm your delivery date');
 const date=doc.createElement('p');date.dataset.deliveryDate=value;date.className='delivery-confirm-value';date.textContent=new Intl.DateTimeFormat(lang==='en'?'en-CA':'ko-KR',{month:'long',day:'numeric',weekday:'short',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
 const help=doc.createElement('p');help.className='delivery-confirm-help';help.textContent=text('위 날짜로 입고 요청합니다.','Requesting delivery on this date.');
 const actions=doc.createElement('div');actions.className='actions';const yes=doc.createElement('button'),change=doc.createElement('button');yes.className='primary';yes.type=change.type='button';yes.textContent=actionLabel||text('입고희망일 확인 · 공장으로 발주 보내기','Confirm date · send order to factory');change.textContent=text('돌아가서 수정하기','Go back and edit');actions.append(yes,change);dialog.append(symbol,title,date,help,actions);doc.body.append(dialog);
 return new Promise(resolve=>{let accepted=false;yes.onclick=()=>{accepted=true;dialog.close();};change.onclick=()=>dialog.close();dialog.onclose=()=>{dialog.remove();resolve(accepted);};dialog.showModal();change.focus();});
}

export function defaultReceiptDate(now=new Date()){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
 return new Date(Date.UTC(+p.year,+p.month-1,+p.day+(+p.hour<3?0:1))).toISOString().slice(0,10);
}
export function receiptRequestLabel(value,lang='ko'){return fullDeliveryDate(value,lang)+(lang==='en'?' — requested receipt date':' 입고 요청입니다.');}

export function restoredReceiptDate(saved,now=new Date()){
 const minimum=defaultReceiptDate(now),value=saved?.delivery_date;
 if(!validDeliveryDate(value))return minimum;
 const empty=!(saved?.items||[]).length&&!saved?.note?.trim();
 return empty&&value<minimum?minimum:value;
}
export function selectableReceiptDate(value,now=new Date()){return validDeliveryDate(value)&&value>=defaultReceiptDate(now);}
