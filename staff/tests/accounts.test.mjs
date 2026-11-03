import test from 'node:test';import assert from 'node:assert/strict';
import {accessPayload,accountKind} from '../accounts.mjs';import {navigationGroups,visiblePages} from '../access.mjs';
test('account assignments scope stores and never offer owner promotion',()=>{const a={user_id:'test',role:'employee',permission_revision:0};assert.throws(()=>accessPayload(a,'owner',[],true));assert.throws(()=>accessPayload(a,'manager',[],true));assert.deepEqual(accessPayload(a,'general_manager',['midland'],true).store_keys,[]);assert.deepEqual(accessPayload(a,'midland_owner',['finch'],true).store_keys,['midland']);assert.deepEqual(accessPayload(a,'factory_manager',['finch'],true).store_keys,[]);assert.throws(()=>accessPayload({...a,role:'owner'},'employee',['finch'],false));assert.equal(accountKind({role:'manager',general_manager:true}),'general_manager');assert.equal(accountKind({role:'factory',factory_manager:true}),'factory_manager');});
test('account administration is visible exclusively to owner',()=>{const pages=[['accounts'],['overview']];assert.ok(navigationGroups(pages,'owner').flatMap(g=>g.pages).some(p=>p[0]==='accounts'));for(const r of ['employee','manager','general_manager','factory_staff','factory_manager','midland_owner'])assert.ok(!visiblePages(r).includes('accounts'));});
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
 renderAccounts(host,{...c,profile:{role:'manager',active:true}});assert.equal(host.innerHTML,'');
 }finally{globalThis.confirm=previous;clearAccountState();}
});
