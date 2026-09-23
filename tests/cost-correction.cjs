// Run with Node and jsdom installed: node tests/cost-correction.cjs
const {JSDOM}=require('jsdom');
const fs=require('fs');
const path=require('path');
const assert=require('assert/strict');
const appKey='toque_dulce_pwa_v1',costKey='toqueDulce_calculadoraCostos_v1';
const app={settings:{businessPrice:5000,publicPrice:7000},ingredients:[{id:'dulce',name:'Dulce de leche',purchasePrice:53000,purchaseQty:10,unit:'kg'},{id:'crema',name:'Crema',purchasePrice:8000,purchaseQty:1000,unit:'g'}],products:[{id:'oreo',name:'Oreo',recipe:[{ingredientId:'dulce',qty:100}]},{id:'otro',name:'Otro',recipe:[{ingredientId:'crema',qty:100}]}],weeks:[{id:'old',startDate:'2026-09-09',label:'Semana anterior',orders:[{items:[{productId:'oreo',qty:2,unitPrice:5000}]}],ownProduction:{},publicSales:[],status:'closed'},{id:'target',startDate:'2026-09-16',label:'Semana 16 de septiembre',orders:[{items:[{productId:'oreo',qty:6,unitPrice:5000},{productId:'otro',qty:1,unitPrice:5000}]}],ownProduction:{oreo:{qty:4}},publicSales:[],status:'closed',closingStock:{oreo:1}}]};
const close=(weekId,unitCost,qty)=>({weekId,startDate:weekId==='old'?'2026-09-09':'2026-09-16',label:weekId,restantes:{oreo:1},ventasPublico:{oreo:qty},preciosPublico:{oreo:7000},nombres:{oreo:'Oreo',otro:'Otro'},costosUnitarios:{oreo:unitCost,otro:1000},costosCongeladosEn:'old-date',guardadoEn:'old-date'});
const costs={catalogoUnificadoV1:true,ingredientes:[],recetas:[],egresos:[],mesActivo:'2026-09',semanaCierreId:'target',cierres:{old:close('old',2000,0),target:close('target',2000,4)}};

const html=fs.readFileSync(path.join(__dirname,'../Costos.html'),'utf8').replace(/<script src="firebase-costos-sync.js[^>]*><\/script>/,'');
let savedApp=JSON.stringify(app),savedCosts=JSON.stringify(costs),dom;
const errors=[];
function load(){
 dom=new JSDOM(html,{url:'http://toque.test/Costos.html?vista=ganancias',runScripts:'dangerously',beforeParse(w){
  w.localStorage.setItem(appKey,savedApp);w.localStorage.setItem(costKey,savedCosts);
  w.HTMLElement.prototype.scrollIntoView=function(){};w.scrollTo=()=>{};w.alert=msg=>{throw Error(msg)};
  w.addEventListener('error',e=>errors.push(e.message));
 }});
}
load();
const el=id=>dom.window.document.getElementById(id);
const click=id=>el(id).click();
const fill=(id,value)=>{el(id).value=String(value);el(id).dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
const state=()=>JSON.parse(dom.window.localStorage.getItem(costKey));
const before=state(),gestionBefore=dom.window.localStorage.getItem(appKey),monthBefore=el('gananciaBrutaMes').textContent;
click('abrirCorreccion');
assert.equal(el('corregirNuevo').value,'53000');assert.equal(el('corregirCantidad').value,'10');assert.equal(el('corregirUnidad').value,'kg');
fill('corregirAnterior',27500);click('preverCorreccion');
assert.match(el('vistaCorreccion').textContent,/2\.550/);click('aplicarCorreccion');
const after=state();
assert.equal(after.cierres.target.costosUnitarios.oreo,2255);
assert.equal(after.cierres.target.costosUnitarios.otro,1000);
assert.deepEqual(after.cierres.old,before.cierres.old);
for(const key of ['ventasPublico','preciosPublico','restantes','nombres','costosCongeladosEn'])assert.deepEqual(after.cierres.target[key],before.cierres.target[key]);
assert.equal(dom.window.localStorage.getItem(appKey),gestionBefore);
assert.equal(after.cierres.target.correccionesCostos.length,1);
assert.notEqual(el('gananciaBrutaMes').textContent,monthBefore);
assert.match(el('semanaGanancia').textContent,/39\.450/);
// Ordinary close updates preserve costs and correction history.
click('guardarCierre');assert.equal(state().cierres.target.costosUnitarios.oreo,2255);assert.equal(state().cierres.target.correccionesCostos.length,1);
savedApp=dom.window.localStorage.getItem(appKey);savedCosts=dom.window.localStorage.getItem(costKey);dom.window.close();load();
assert.match(el('semanaGanancia').textContent,/39\.450/);
// Prevent applying the same original difference twice.
click('abrirCorreccion');assert.equal(el('corregirAnterior').value,'53000');
fill('corregirAnterior',27500);click('preverCorreccion');assert.match(el('vistaCorreccion').textContent,/ya fue corregido/);assert(el('aplicarCorreccion').disabled);
// A second correction applies only the new difference.
fill('corregirAnterior',53000);fill('corregirNuevo',53500);click('preverCorreccion');click('aplicarCorreccion');assert.equal(state().cierres.target.costosUnitarios.oreo,2260);
const stable=state();
click('abrirCorreccion');fill('corregirNuevo',53000);click('preverCorreccion');assert.match(el('vistaCorreccion').textContent,/sube/);
fill('corregirCantidad',0);assert(el('aplicarCorreccion').disabled);click('preverCorreccion');assert(el('aplicarCorreccion').disabled);
click('cancelarCorreccion');assert.deepEqual(state(),stable);
// Cloud updates while editing block stale submissions.
click('abrirCorreccion');fill('corregirNuevo',54000);click('preverCorreccion');
const remote=dom.window.toqueDulceCostosSync.getState();remote.cierres.target.costosUnitarios.otro=1001;dom.window.toqueDulceCostosSync.applyState(remote);
click('aplicarCorreccion');assert.match(el('vistaCorreccion').textContent,/Cambiaron ventas/);assert.equal(state().cierres.target.costosUnitarios.oreo,2260);click('cancelarCorreccion');
// Grams and kg are equivalent; zero old price is valid, negative costs are not.
click('abrirCorreccion');fill('corregirNuevo',54000);fill('corregirCantidad',10000);el('corregirUnidad').value='g';click('preverCorreccion');assert(!el('aplicarCorreccion').disabled);click('cancelarCorreccion');
// Recipe quantities can be reviewed for historic recipes without editing the catalog.
click('abrirCorreccion');fill('corregirNuevo',54000);fill('corr_oreo',200);click('preverCorreccion');assert.match(el('vistaCorreccion').textContent,/100/);click('cancelarCorreccion');
// Firestore key order and nonfinancial metadata must not block the form.
function reverseKeys(value){return Array.isArray(value)?value.map(reverseKeys):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).reverse().map(key=>[key,reverseKeys(value[key])])):value;}
click('abrirCorreccion');fill('corregirNuevo',54000);
const syncedApp=reverseKeys(dom.window.toqueDulceCostosSync.getGestionState());syncedApp.weeks.find(w=>w.id==='target').closingStockUpdatedAt='sync-only';
dom.window.toqueDulceCostosSync.applyGestionState(syncedApp);
const synced=reverseKeys(dom.window.toqueDulceCostosSync.getState());synced.cierres.target.guardadoEn='sync-only';dom.window.toqueDulceCostosSync.applyState(synced);
click('preverCorreccion');assert(!el('aplicarCorreccion').disabled,el('vistaCorreccion').textContent);
// A second sync after preview must also permit saving.
const syncedAgain=reverseKeys(dom.window.toqueDulceCostosSync.getState());syncedAgain.cierres.target.guardadoEn='sync-only-again';syncedAgain.semanaCierreId='old';dom.window.toqueDulceCostosSync.applyState(syncedAgain);
click('aplicarCorreccion');assert.equal(state().cierres.target.costosUnitarios.oreo,2265);assert.equal(state().semanaCierreId,'target');assert(el('correccionCosto').classList.contains('oculto'));
// A real sale edit still blocks a stale correction.
click('abrirCorreccion');fill('corregirNuevo',55000);click('preverCorreccion');
const changedApp=dom.window.toqueDulceCostosSync.getGestionState();changedApp.weeks.find(w=>w.id==='target').orders[0].items[0].qty+=1;dom.window.toqueDulceCostosSync.applyGestionState(changedApp);
click('aplicarCorreccion');assert.match(el('vistaCorreccion').textContent,/Cambiaron ventas/);assert.equal(state().cierres.target.costosUnitarios.oreo,2265);
assert.deepEqual(errors,[]);dom.window.close();
console.log('PASS: correction amount, unchanged sales/stock/catalog/other weeks, monthly and weekly profit, duplicate guard, second correction, cancellation, stale sync, persistence, unit conversion, historical quantities.');
