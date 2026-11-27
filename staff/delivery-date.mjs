export function validDeliveryDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;}
export function fullDeliveryDate(value,lang='ko'){return new Intl.DateTimeFormat(lang==='en'?'en-CA':'ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'long',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));}
export function confirmDeliveryDate(value,{lang='ko',doc=document,actionLabel}={}){
 if(!validDeliveryDate(value))return Promise.resolve(false);
 const text=(ko,en)=>lang==='en'?en:ko,dialog=doc.createElement('dialog');dialog.className='install-dialog delivery-date-dialog';dialog.setAttribute('aria-labelledby','deliveryDateTitle');
 const symbol=doc.createElement('div');symbol.className='delivery-confirm-symbol';symbol.textContent='📅';symbol.setAttribute('aria-hidden','true');
 const title=doc.createElement('h2');title.id='deliveryDateTitle';title.textContent=text('물건 받는 날이','Will you receive your items on');
 const date=doc.createElement('span');date.dataset.deliveryDate=value;date.className='delivery-confirm-value';date.textContent=new Intl.DateTimeFormat(lang==='en'?'en-CA':'ko-KR',{month:'long',day:'numeric',weekday:'long',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
 const question=doc.createElement('span');question.className='delivery-confirm-question';question.textContent=text('이 맞나요?','?');title.append(date,question);
 const help=doc.createElement('p');help.className='delivery-confirm-help';help.textContent=text('날짜를 한번 더 확인 !','Double-check the date!');
 const actions=doc.createElement('div');actions.className='actions';const yes=doc.createElement('button'),change=doc.createElement('button');yes.className='primary';yes.type=change.type='button';yes.textContent=actionLabel||text('네. 맞아요!',"Yes, that’s right!");change.textContent=text('날짜 바꾸기','Change date');actions.append(yes,change);dialog.append(symbol,title,help,actions);doc.body.append(dialog);
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
