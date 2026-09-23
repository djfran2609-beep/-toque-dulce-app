// Importación de recetas: modifica el catálogo, conserva ventas y cierres.
(() => {
  'use strict';
  let pending=null;
  const copy=value=>JSON.parse(JSON.stringify(value));
  const signature=p=>JSON.stringify((p?.recipe||[]).map(i=>[i.ingredientId,Number(i.qty)]).sort((a,b)=>a[0].localeCompare(b[0])));
  window.importRecipeFile=async file=>{
    if(!file)return;
    try{
      const patch=JSON.parse(await file.text());
      if(patch.format!=='toque-dulce-recetas-v1'||!Array.isArray(patch.products)||!patch.products.length||!Array.isArray(patch.ingredients))throw Error('El archivo no es una carga de recetas válida.');
      if(new Set(patch.products.map(p=>p.id)).size!==patch.products.length)throw Error('Hay postres duplicados en el archivo.');
      const before={};
      for(const p of patch.products){const current=state.products.find(x=>x.id===p.id);if(!current)throw Error('No se encontró el postre '+p.name);before[p.id]=signature(current);}
      pending={patch,before};
      const choices=(patch.choices||[]).map((c,index)=>`<div class="field"><label>${esc(c.label)}</label><select class="select" id="recipeChoice${index}"><option value="">Elegir…</option>${c.options.map((o,i)=>`<option value="${i}">${esc(o.label)}</option>`).join('')}</select></div>`).join('');
      modal('Cargar recetas',`<p>Se cargarán las recetas de ${patch.products.map(p=>esc(p.name)).join(', ')}.</p>${patch.products.map(p=>`<div class="note" style="margin:10px 0"><strong>${esc(p.name)}</strong><br>${esc(p.summary||'')}</div>`).join('')}${choices}<p class="note">Los pedidos, las ventas y los costos de semanas cerradas se conservan. Los precios nuevos del archivo se aplican a los ingredientes indicados.</p><div id="recipeImportError" role="alert"></div><div class="grid grid-2 section"><button class="btn primary" onclick="applyRecipeImport()">Cargar las recetas</button><button class="btn ghost" onclick="closeModal()">Cancelar</button></div>`);
    }catch(error){showToast(error.message);}
    finally{const input=document.getElementById('recipeImportFile');if(input)input.value='';}
  };
  window.applyRecipeImport=()=>{
    try{
      if(!pending)throw Error('Volvé a seleccionar el archivo.');
      const {patch,before}=pending,choices={};
      (patch.choices||[]).forEach((c,index)=>{const value=document.getElementById('recipeChoice'+index).value;if(value==='')throw Error('Elegí '+c.label.toLowerCase());choices[c.id]=c.options[Number(value)].value;});
      for(const p of patch.products)if(signature(state.products.find(x=>x.id===p.id))!==before[p.id])throw Error('Una receta cambió mientras abrías el archivo. Volvé a seleccionarlo para usar la última versión.');
      const next=copy(state),mapping={};
      for(const incoming of patch.ingredients){
        const item=copy(incoming);delete item.priceFromIngredientId;
        if(incoming.priceFromIngredientId){
          const source=next.ingredients.find(i=>i.id===incoming.priceFromIngredientId);
          if(!source||baseUnit(source.unit)!=='u')throw Error('Revisá el ingrediente usado para el precio de '+item.name);
          item.purchasePrice=source.purchasePrice;item.purchaseQty=source.purchaseQty;item.unit='unit';
        }
        if(!item.id||!item.name||!Number.isFinite(item.purchasePrice)||item.purchasePrice<0||!Number.isFinite(item.purchaseQty)||item.purchaseQty<=0||!['g','kg','ml','l','unit'].includes(item.unit))throw Error('Hay un ingrediente con precio o cantidad inválidos.');
        const target=next.ingredients.find(i=>i.id===item.id)||next.ingredients.find(i=>nameKey(i.name)===nameKey(item.name));
        if(target){mapping[item.id]=target.id;Object.assign(target,item,{id:target.id,active:true});}
        else{mapping[item.id]=item.id;next.ingredients.push({...item,active:true});}
      }
      for(const p of patch.products){
        const target=next.products.find(x=>x.id===p.id);
        const recipe=p.items.map(item=>{
          const ingredientId=mapping[item.ingredientId]||item.ingredientId,ingredient=next.ingredients.find(i=>i.id===ingredientId);
          const qty=item.choiceId?choices[item.choiceId]:item.qty;
          if(!ingredient)throw Error('Falta un ingrediente de '+p.name+'. No se guardó ningún cambio.');
          if(baseUnit(ingredient.unit)!==item.unit)throw Error('La unidad de '+ingredient.name+' no coincide con la receta.');
          if(!Number.isFinite(qty)||qty<=0)throw Error('Revisá las cantidades de '+p.name);
          return {ingredientId,qty};
        });
        if(!recipe.length)throw Error('La receta está vacía.');
        target.recipe=recipe;target.notes=p.notes||target.notes;
      }
      // Respaldo local previo y guardado habitual para sincronizar entre teléfonos.
      localStorage.setItem('toqueDulce_antes_importar_recetas_v1',JSON.stringify(state));
      localStorage.setItem(STORAGE_KEY,JSON.stringify(next));state=next;
      pending=null;saveState(false);closeModal();currentView='products';render();showToast('Recetas cargadas. Esperá a que figure Sincronizado.');
    }catch(error){const box=document.getElementById('recipeImportError');if(box)box.textContent=error.message;}
  };
})();
