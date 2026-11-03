import test from 'node:test';import assert from 'node:assert/strict';
import {accessPayload,accountKind} from '../accounts.mjs';import {navigationGroups,visiblePages} from '../access.mjs';
test('account assignments scope stores and never offer owner promotion',()=>{const a={user_id:'test',role:'employee',permission_revision:0};assert.throws(()=>accessPayload(a,'owner',[],true));assert.throws(()=>accessPayload(a,'manager',[],true));assert.deepEqual(accessPayload(a,'general_manager',['midland'],true).store_keys,[]);assert.deepEqual(accessPayload(a,'midland_owner',['finch'],true).store_keys,['midland']);assert.deepEqual(accessPayload(a,'factory_manager',['finch'],true).store_keys,[]);assert.throws(()=>accessPayload({...a,role:'owner'},'employee',['finch'],false));assert.equal(accountKind({role:'manager',general_manager:true}),'general_manager');assert.equal(accountKind({role:'factory',factory_manager:true}),'factory_manager');});
test('account administration is visible exclusively to owner',()=>{const pages=[['accounts'],['overview']];assert.ok(navigationGroups(pages,'owner').flatMap(g=>g.pages).some(p=>p[0]==='accounts'));for(const r of ['employee','factory_staff','factory_manager','midland_owner'])assert.ok(!visiblePages(r).includes('accounts'));});
import {renderAccounts,clearAccountState,hasAccountEdits} from '../accounts.mjs';
test('owner assignment form sends scoped revisioned RPC, supports cancellation, and stays hidden for managers',async()=>{
 clearAccountState();const nodes=new Map(),node=s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',textContent:'',isConnected:true,querySelector:k=>node(k),querySelectorAll:()=>[],scrollIntoView(){}});return nodes.get(s);};const host=node('host'),calls=[];const account={user_id:'pending',email:'staff@example.invalid',display_name:'Pending',role:'employee',active:false,store_ids:[],permission_revision:0};
 const db={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='kream_list_accounts'?[account]:null,error:null};}};const c={profile:{role:'owner',active:true},preview:false,t:(ko)=>ko,esc:v=>String(v??''),db,act:async f=>f(),say(){},stores:[{id:'finch',name:'Finch'}],lang:'ko'};
 const previous=globalThis.confirm;globalThis.confirm=()=>true;
 try{renderAccounts(host,c);await new Promise(resolve=>setImmediate(resolve));assert.match(host.innerHTML,/staff@example.invalid/);
 // Open through the same handler binding used by the browser.
 const edit={dataset:{editAccount:'pending'}};host.querySelectorAll=s=>s==='[data-edit-account]'?[edit]:[];renderAccounts(host,c);edit.onclick();assert.match(node('#accountEditor').innerHTML,/id="accessForm"/);
 node('#accessKind').onchange({target:{value:'general_manager'}});assert.ok(hasAccountEdits());node('#accessEnabled').onchange({target:{checked:true}});
 await node('#accessForm').onsubmit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls.find(x=>x.name==='kream_assign_access').args,{target_user:'pending',access_kind:'general_manager',store_keys:[],enabled:true,expected_revision:0});assert.equal(hasAccountEdits(),false);
 renderAccounts(host,{...c,profile:{role:'employee',active:true}});assert.equal(host.innerHTML,'');
 }finally{globalThis.confirm=previous;clearAccountState();}
});
test('store manager can approve a requested location and remove access without role editing',async()=>{
 clearAccountState();const nodes=new Map();const node=s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',textContent:'',isConnected:true,querySelector:k=>node(k),querySelectorAll:()=>[],scrollIntoView(){}});return nodes.get(s);};const host=node('host'),approve={dataset:{approveRequest:'request-finch'}},block={dataset:{blockAccount:'employee'}},calls=[];
 const account={user_id:'employee',email:'employee@example.invalid',display_name:'Employee',role:'employee',email_confirmed:true,active:true,store_ids:['finch'],permission_revision:3,requests:[{id:'request-finch',location_key:'finch',status:'pending'}]};
 host.querySelectorAll=s=>s==='[data-approve-request]'?[approve]:s==='[data-block-account]'?[block]:[];
 const c={profile:{role:'manager',active:true},preview:false,t:ko=>ko,esc:v=>String(v??''),db:{rpc:async(name,args)=>{calls.push({name,args});return {data:name==='kream_list_accounts'?[account]:null,error:null};}},act:f=>f(),say(){},stores:[{id:'finch',name:'Finch'}],lang:'ko'};
 const oldConfirm=globalThis.confirm;globalThis.confirm=()=>true;
 try{renderAccounts(host,c);await new Promise(r=>setImmediate(r));assert.match(host.innerHTML,/data-approve-request="request-finch"/);assert.doesNotMatch(host.innerHTML,/data-edit-account=/);assert.match(host.innerHTML,/담당 매장 접근 해제/);
 await approve.onclick();await new Promise(r=>setImmediate(r));assert.deepEqual(calls.find(c=>c.name==='kream_review_workplace').args,{request_key:'request-finch',approve:true});
 renderAccounts(host,c);await new Promise(r=>setImmediate(r));await block.onclick();await new Promise(r=>setImmediate(r));assert.deepEqual(calls.find(c=>c.name==='kream_block_access').args,{target_user:'employee',expected_revision:3});
 }finally{globalThis.confirm=oldConfirm;clearAccountState();}
});
