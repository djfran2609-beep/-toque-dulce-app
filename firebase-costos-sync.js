// Toque Dulce - cargador de sincronización + corrección segura del cierre semanal
(() => {
  "use strict";

  const CLAVE_GESTION = "toque_dulce_pwa_v1";
  const bridge = window.toqueDulceCostosSync;
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const numero = value => Number(value) || 0;

  function precioPublico(app, productId) {
    const product = (app?.products || []).find(item => item.id === productId);
    return numero(product?.publicPrice ?? app?.settings?.publicPrice);
  }

  function prepararCierre(event) {
    const button = event.target?.closest?.("#guardarCierre");
    if (!button || !bridge?.getGestionState) return;

    const original = bridge.getGestionState();
    const weekId = document.getElementById("semanaCierre")?.value;
    const week = original?.weeks?.find(item => item.id === weekId);
    if (!week) return;

    const temporal = clone(original);
    const temporalWeek = temporal.weeks.find(item => item.id === weekId);
    let corregido = false;

    document.querySelectorAll(".sobrante-input").forEach(input => {
      const productId = input.dataset.pid;
      const available = Math.max(0, numero(input.dataset.disponible));
      const remaining = Math.max(0, Math.min(available, numero(input.value)));
      const sold = Math.max(0, available - remaining);
      const records = (temporalWeek.publicSales || []).filter(sale => sale.productId === productId);
      const registered = records.reduce((sum, sale) => sum + numero(sale.qty), 0);

      if (registered <= sold) return;

      const fallbackPrice = precioPublico(temporal, productId);
      const registeredIncome = records.reduce(
        (sum, sale) => sum + numero(sale.qty) * numero(sale.unitPrice ?? fallbackPrice),
        0
      );
      const averagePrice = registered > 0 ? registeredIncome / registered : fallbackPrice;

      // Solo para calcular el cierre: si hay registros duplicados o viejos,
      // se usa como verdad el stock físico informado en "Me quedaron".
      temporalWeek.publicSales = (temporalWeek.publicSales || []).filter(
        sale => sale.productId !== productId
      );
      if (sold > 0) {
        temporalWeek.publicSales.push({
          id: `cierre-temporal-${productId}`,
          productId,
          qty: sold,
          unitPrice: averagePrice,
          date: new Date().toISOString(),
          source: "cierreTemporal"
        });
      }
      corregido = true;
    });

    if (!corregido) return;

    // El guardado original relee este estado al comenzar. No tocamos el historial
    // real de ventas: lo restauramos inmediatamente después del cierre.
    localStorage.setItem(CLAVE_GESTION, JSON.stringify(temporal));

    setTimeout(() => {
      try {
        const after = JSON.parse(localStorage.getItem(CLAVE_GESTION) || "null");
        const restored = clone(original);
        const restoredWeek = restored?.weeks?.find(item => item.id === weekId);
        const afterWeek = after?.weeks?.find(item => item.id === weekId);

        if (restoredWeek && afterWeek) {
          restoredWeek.status = afterWeek.status;
          if (afterWeek.closingStock) restoredWeek.closingStock = clone(afterWeek.closingStock);
          if (afterWeek.closingStockUpdatedAt) restoredWeek.closingStockUpdatedAt = afterWeek.closingStockUpdatedAt;
        }

        if (restored) {
          localStorage.setItem(CLAVE_GESTION, JSON.stringify(restored));
          bridge.applyGestionState?.(restored);
        }
      } catch (error) {
        console.error("No se pudo restaurar el historial de ventas después del cierre:", error);
      }
    }, 0);
  }

  function ajustarInputs() {
    document.querySelectorAll(".sobrante-input").forEach(input => {
      input.max = String(Math.max(0, numero(input.dataset.disponible)));
    });
  }

  document.addEventListener("click", prepararCierre, true);
  ajustarInputs();
  new MutationObserver(ajustarInputs).observe(document.body, { childList: true, subtree: true });

  // Conserva toda la sincronización que ya funcionaba, movida sin cambios a
  // firebase-costos-sync-original.js.
  const originalScript = document.createElement("script");
  originalScript.src = "firebase-costos-sync-original.js?v=3";
  document.head.appendChild(originalScript);
})();
