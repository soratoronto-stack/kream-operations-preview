export function validDeliveryDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;}
export function fullDeliveryDate(value,lang='ko'){return new Intl.DateTimeFormat(lang==='en'?'en-CA':'ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'long',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));}
export function confirmDeliveryDate(value,{lang='ko',doc=document}={}){
 if(!validDeliveryDate(value))return Promise.resolve(false);
 const text=(ko,en)=>lang==='en'?en:ko,dialog=doc.createElement('dialog');dialog.className='install-dialog delivery-date-dialog';dialog.setAttribute('aria-labelledby','deliveryDateTitle');
 const title=doc.createElement('h2');title.id='deliveryDateTitle';title.textContent=text('납품 희망일을 확인해 주세요','Confirm your delivery date');
 const date=doc.createElement('p');date.dataset.deliveryDate=value;date.style.cssText='font-size:26px;font-weight:750;line-height:1.5';date.textContent=fullDeliveryDate(value,lang);
 const actions=doc.createElement('div');actions.className='actions';const yes=doc.createElement('button'),change=doc.createElement('button');yes.className='primary';yes.type=change.type='button';yes.textContent=text('확인','Confirm');change.textContent=text('날짜 바꾸기','Change date');actions.append(yes,change);dialog.append(title,date,actions);doc.body.append(dialog);
 return new Promise(resolve=>{let accepted=false;yes.onclick=()=>{accepted=true;dialog.close();};change.onclick=()=>dialog.close();dialog.onclose=()=>{dialog.remove();resolve(accepted);};dialog.showModal();change.focus();});
}
