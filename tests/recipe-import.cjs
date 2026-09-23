const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(require('path').join(__dirname,'../recipe-import.js'),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
const initial={ingredients:[{id:'cream',name:'Cream',unit:'g'},{id:'prepared',name:'Prepared',unit:'g'},{id:'cake',name:'Cake',unit:'g'}],products:[{id:'a',recipe:[{ingredientId:'prepared',qty:70},{ingredientId:'cake',qty:32}]},{id:'b',recipe:[{ingredientId:'cake',qty:10}]}],weeks:[{sales:123}]};
const patch={format:'toque-dulce-recetas-v1',ingredients:[{id:'paste',name:'Paste',unit:'g',purchasePrice:100,purchaseQty:250}],products:[{id:'a',name:'A',replaceIngredientIds:['prepared'],items:[{ingredientId:'cream',qty:60,unit:'g'},{ingredientId:'paste',qty:10,unit:'g'}]}],retireIngredientIds:['prepared']};
function context(){const errors={};const c={state:clone(initial),window:{},document:{getElementById:()=>errors},localStorage:{setItem(){}},currentView:'settings',STORAGE_KEY:'test',baseUnit:x=>x,nameKey:x=>x.toLowerCase(),esc:x=>x,modal(){},showToast(){},closeModal(){},saveState(){},render(){},URLSearchParams,location:{hash:'#recetas='+encodeURIComponent(JSON.stringify(patch))}};vm.createContext(c);vm.runInContext(source,c);return {c,errors};}
(async()=>{
 const {c,errors}=context();await c.window.importRecipeFile({text:async()=>JSON.stringify(patch)});
 c.state.weeks.push({sales:456});c.window.applyRecipeImport();assert.equal(errors.textContent,undefined);
 assert.deepEqual(clone(c.state.products[0].recipe),[{ingredientId:'cake',qty:32},{ingredientId:'cream',qty:60},{ingredientId:'paste',qty:10}]);
 assert.equal(c.state.ingredients.some(i=>i.id==='prepared'),false);assert.deepEqual(clone(c.state.products[1]),initial.products[1]);assert.equal(c.state.weeks.length,2);
 const saved=JSON.stringify(c.state);await c.window.importRecipeFile({text:async()=>JSON.stringify(patch)});c.window.applyRecipeImport();assert.equal(JSON.stringify(c.state),saved);
 const d=context();await d.c.window.importRecipeFile({text:async()=>JSON.stringify(patch)});d.c.state.products[0].recipe[0].qty=80;d.c.window.applyRecipeImport();assert.ok(d.errors.textContent.includes('cambió'));assert.equal(d.c.state.ingredients.some(i=>i.id==='paste'),false);
 const e=context();e.c.state.products[1].recipe.push({ingredientId:'prepared',qty:5});await e.c.window.importRecipeFile({text:async()=>JSON.stringify(patch)});const before=JSON.stringify(e.c.state);e.c.window.applyRecipeImport();assert.ok(e.errors.textContent.includes('todavía'));assert.equal(JSON.stringify(e.c.state),before);
 console.log('PASS: targeted replacement, latest sales preserved, repeated import, stale recipe and referenced ingredient guards.');
})();
