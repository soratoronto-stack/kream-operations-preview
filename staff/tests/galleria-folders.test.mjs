import test from 'node:test';
import assert from 'node:assert/strict';
import {navigationGroups,visiblePages} from '../access.mjs';
import {renderGalleriaWorkspace} from '../galleria-workspace.mjs';
const ids=['galleria','galleriaHistory','galleriaSop'];
test('separate Galleria destinations remain grouped and available to existing roles',()=>{
 const pages=ids.map(id=>[id,'','label','label']);
 for(const role of ['owner','manager_factory'])assert.deepEqual(navigationGroups(pages,role).find(g=>g.key==='galleria').pages.map(p=>p[0]),ids);
 for(const role of ['employee','manager','factory_staff','factory_manager'])for(const id of ids)assert.ok(visiblePages(role).includes(id));
});
test('each destination renders its own content and preserves stored shelf life and shipment records',async()=>{
 const product={barcode:'123',name_ko:'테스트 제품',category:'디저트',subgroup:'쿠키',price_cents:500,shelf_life_days:7,name_label_sop:'앞면 부착',barcode_label_sop:'뒷면 부착'};
 const shipment={id:'saved',dispatch_date:'2026-11-06',items:[{name_ko:'테스트 제품',quantity:2,price_cents:500}],recorded_name:'담당자',created_at:'2026-11-06T12:00:00Z'};
 const db={from(table){const q={select(){return q},eq(){return q},order(){return q},limit(){return q},then(resolve){return Promise.resolve({data:table==='kream_galleria_products'?[product]:[shipment],error:null}).then(resolve)}};return q}};
 for(const section of ['dispatch','history','sop']){
 const host={innerHTML:'',isConnected:true,querySelectorAll:()=>[],querySelector:()=>null};
 await renderGalleriaWorkspace(host,{section,db,profile:{active:true,role:'factory'},preview:false,t:ko=>ko,esc:v=>String(v??'')});
 assert.doesNotMatch(host.innerHTML,/data-tab=/);
 if(section==='dispatch'){assert.match(host.innerHTML,/data-gal-confirm/);assert.doesNotMatch(host.innerHTML,/앞면 부착/)}
 if(section==='history'){assert.match(host.innerHTML,/담당자/);assert.doesNotMatch(host.innerHTML,/data-gal-confirm/)}
 if(section==='sop'){assert.match(host.innerHTML,/7일/);assert.match(host.innerHTML,/앞면 부착/);assert.match(host.innerHTML,/뒷면 부착/);assert.doesNotMatch(host.innerHTML,/data-gal-confirm/)}
 }
});
