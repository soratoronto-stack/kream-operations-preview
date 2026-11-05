export function confirmDispatchSummary({storeName,date,items,t,name,quantityLabel,lang='ko',doc=document}){
 const dialog=doc.createElement('dialog');dialog.className='install-dialog dispatch-confirm-dialog';dialog.style.maxWidth='560px';dialog.setAttribute('aria-labelledby','dispatchConfirmTitle');
 const heading=doc.createElement('h2');heading.id='dispatchConfirmTitle';heading.textContent=t('출고 내용을 최종 확인해 주세요','Review dispatch quantities');
 const context=doc.createElement('p');context.textContent=storeName+' · '+date;
 const list=doc.createElement('div');list.style.cssText='max-height:45vh;overflow:auto';for(const i of items){const row=doc.createElement('p');row.style.cssText='display:flex;justify-content:space-between;gap:16px';const label=doc.createElement('span'),amount=doc.createElement('strong');label.textContent=name(i);amount.textContent=quantityLabel(i,i.actual,lang);row.append(label,amount);list.append(row);}
 const note=doc.createElement('p');note.textContent=t('확정하면 실제 출고량이 저장되고 매장에서 입고 확인할 수 있어요. 보내지 않은 수량은 미출고 기록으로 남습니다.','Confirm to save actual quantities and make them available for receiving. Unsent quantities remain in Unshipped records.');
 const actions=doc.createElement('div');actions.className='actions';const back=doc.createElement('button'),yes=doc.createElement('button');back.type=yes.type='button';back.textContent=t('돌아가서 수정','Back to edit');yes.textContent=t('출고 확정','Confirm dispatch');yes.className='primary';actions.append(back,yes);dialog.append(heading,context,list,note,actions);doc.body.append(dialog);
 return new Promise(resolve=>{let accepted=false;yes.onclick=()=>{accepted=true;dialog.close();};back.onclick=()=>dialog.close();dialog.onclose=()=>{dialog.remove();resolve(accepted);};dialog.showModal();back.focus();});
}
