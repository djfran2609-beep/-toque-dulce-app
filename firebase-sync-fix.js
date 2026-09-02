// Toque Dulce - sincronización compartida con Firebase
// Este archivo se carga después de index.html y agrega:
// - Inicio de sesión por correo/contraseña
// - Sincronización en tiempo real entre los dos usuarios autorizados
// - Copia local como respaldo

(async function () {
  const FIREBASE_VERSION = "12.17.1";

  const firebaseConfig = {
    apiKey: "AIzaSyDeYzbvd_dixHu9bCPeOeSqf6P7z3aql7s",
    authDomain: "toque-dulce-2a753.firebaseapp.com",
    projectId: "toque-dulce-2a753",
    storageBucket: "toque-dulce-2a753.firebasestorage.app",
    messagingSenderId: "27701710080",
    appId: "1:27701710080:web:fd1354f41f66f2b4af37e5"
  };

  const ALLOWED_UIDS = new Set([
    "vggGa9yPWFUIOgdGwLPzC1sidQE3",
    "5iXOwHx666fXFpLMIsGOUxS7pvj1"
  ]);

  let auth, db, currentUser, cloudRef, unsubscribeSnapshot;
  let cloudReady = false;
  let applyingRemote = false;
  let firebaseFns = null;
  let saveTimer = null;
  let lastSyncedState = null;
  let latestRemoteState = null;

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const same = (a, b) => {
    try { return JSON.stringify(a) === JSON.stringify(b); }
    catch (_) { return false; }
  };

  function mergeArrays(base, local, remote) {
    const allObjects = [base, local, remote].every(arr =>
      Array.isArray(arr) && arr.every(x => x && typeof x === "object" && !Array.isArray(x))
    );
    if (!allObjects) return same(local, base) ? clone(remote) : clone(local);

    const keyFor = (x) => x.id ?? x.productId ?? x.ingredientId ?? null;
    const keyable = [...base, ...local, ...remote].every(x => keyFor(x) != null);
    if (!keyable) return same(local, base) ? clone(remote) : clone(local);

    const bMap = new Map(base.map(x => [String(keyFor(x)), x]));
    const lMap = new Map(local.map(x => [String(keyFor(x)), x]));
    const rMap = new Map(remote.map(x => [String(keyFor(x)), x]));
    const order = [];
    [...remote, ...local].forEach(x => {
      const k = String(keyFor(x));
      if (!order.includes(k)) order.push(k);
    });

    const out = [];
    for (const k of order) {
      const b = bMap.get(k);
      const l = lMap.get(k);
      const r = rMap.get(k);

      if (b && !l) {
        // Se eliminó localmente: la eliminación manda y no debe reaparecer.
        continue;
      }
      if (!b && l && !r) { out.push(clone(l)); continue; }
      if (!b && !l && r) { out.push(clone(r)); continue; }
      if (!b && l && r) { out.push(merge3(undefined, l, r)); continue; }
      if (b && l && !r) {
        if (same(l, b)) continue; // eliminado remotamente
        out.push(clone(l));       // cambiado localmente
        continue;
      }
      if (b && l && r) out.push(merge3(b, l, r));
    }
    return out;
  }

  function merge3(base, local, remote) {
    if (base === undefined) {
      if (local === undefined) return clone(remote);
      if (remote === undefined) return clone(local);
      if (same(local, remote)) return clone(local);
    }

    if (same(local, base)) return clone(remote);
    if (same(remote, base)) return clone(local);
    if (same(local, remote)) return clone(local);

    if (Array.isArray(local) && Array.isArray(remote)) {
      return mergeArrays(Array.isArray(base) ? base : [], local, remote);
    }

    const isObj = v => v && typeof v === "object" && !Array.isArray(v);
    if (isObj(local) && isObj(remote)) {
      const b = isObj(base) ? base : {};
      const keys = new Set([...Object.keys(b), ...Object.keys(local), ...Object.keys(remote)]);
      const out = {};
      for (const k of keys) {
        if (!(k in local) && (k in b) && same(remote[k], b[k])) continue;
        if (!(k in remote) && (k in b) && same(local[k], b[k])) continue;
        out[k] = merge3(b[k], local[k], remote[k]);
      }
      return out;
    }

    // Si ambos cambiaron exactamente el mismo dato, gana el cambio local más reciente.
    return clone(local);
  }

  function installStyles() {
    if (document.getElementById("td-cloud-style")) return;
    const style = document.createElement("style");
    style.id = "td-cloud-style";
    style.textContent = `
      #td-auth-overlay{
        position:fixed;inset:0;z-index:10000;
        background:linear-gradient(180deg,#fff4f8 0%,#fffafb 55%,#fff7fa 100%);
        display:flex;align-items:center;justify-content:center;padding:24px;
        font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",Roboto,Helvetica,Arial,sans-serif;
        color:#261d22
      }
      #td-auth-card{
        width:100%;max-width:430px;background:#fff;border:1px solid #f1dfe7;
        border-radius:28px;padding:24px;box-shadow:0 18px 50px rgba(83,39,58,.12)
      }
      #td-auth-brand{
        width:58px;height:58px;border-radius:18px;display:block;overflow:hidden;
        background:#fff;margin-bottom:16px
      }
      #td-auth-brand img{width:100%;height:100%;object-fit:cover;display:block}
      #td-auth-card h1{font-size:27px;line-height:1.05;margin:0 0 7px;letter-spacing:-.8px}
      #td-auth-card p{margin:0 0 18px;color:#7a6b73;line-height:1.45;font-size:14px}
      .td-auth-field{margin-bottom:12px}
      .td-auth-field label{display:block;font-size:12px;font-weight:800;margin-bottom:6px;color:#604d56}
      .td-auth-field input{
        width:100%;border:1px solid #f1dfe7;background:#fff;color:#261d22;
        border-radius:14px;padding:13px;outline:none;font:inherit
      }
      .td-auth-field input:focus{border-color:#f7a5c2;box-shadow:0 0 0 3px rgba(240,91,146,.10)}
      #td-auth-btn{
        width:100%;border:0;border-radius:14px;padding:13px 14px;font-weight:850;
        color:#fff;background:linear-gradient(135deg,#f05b92,#ff8db5);font:inherit
      }
      #td-auth-btn:disabled{opacity:.6}
      #td-auth-error{min-height:18px;color:#d94b63;font-size:12px;margin:10px 2px 0}
      #td-sync-badge{
        position:fixed;z-index:9000;right:66px;top:calc(13px + env(safe-area-inset-top));
        background:rgba(255,255,255,.92);border:1px solid #f1dfe7;border-radius:999px;
        padding:6px 9px;font:700 10px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        color:#7a6b73;box-shadow:0 3px 12px rgba(83,39,58,.06);backdrop-filter:blur(12px);
        display:none;max-width:145px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis
      }
      #td-sync-badge.ok{color:#257f57}
      #td-sync-badge.warn{color:#9d6510}
      #td-sync-badge.error{color:#d94b63}
      @media(max-width:390px){#td-sync-badge{right:62px;padding:5px 7px;max-width:118px}}
    `;
    document.head.appendChild(style);
  }

  function badgeEl() {
    let badge = document.getElementById("td-sync-badge");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "td-sync-badge";
      document.body.appendChild(badge);
    }
    return badge;
  }

  function setBadge(text, kind = "") {
    const badge = badgeEl();
    badge.textContent = text;
    badge.className = kind;
    badge.style.display = currentUser ? "block" : "none";
  }

  function removeOverlay() {
    document.getElementById("td-auth-overlay")?.remove();
  }

  function authErrorMessage(code) {
    const map = {
      "auth/invalid-credential": "Correo o contraseña incorrectos.",
      "auth/user-disabled": "Esta cuenta está deshabilitada.",
      "auth/too-many-requests": "Hubo demasiados intentos. Esperá un momento y probá de nuevo.",
      "auth/network-request-failed": "No hay conexión a Internet. Revisá la conexión y volvé a intentar."
    };
    return map[code] || "No se pudo iniciar sesión. Revisá el correo y la contraseña.";
  }

  function showLogin(message = "") {
    currentUser = null;
    cloudReady = false;
    setBadge("", "");
    removeOverlay();

    const overlay = document.createElement("div");
    overlay.id = "td-auth-overlay";
    overlay.innerHTML = `
      <div id="td-auth-card">
        <div id="td-auth-brand"><img src="icon-512.png.PNG?v=2" alt="Logo Toque Dulce"></div>
        <h1>Toque Dulce</h1>
        <p>Ingresá con tu cuenta para ver y editar los pedidos compartidos.</p>
        <form id="td-auth-form">
          <div class="td-auth-field">
            <label>Correo</label>
            <input id="td-auth-email" type="email" autocomplete="username" required>
          </div>
          <div class="td-auth-field">
            <label>Contraseña</label>
            <input id="td-auth-password" type="password" autocomplete="current-password" required>
          </div>
          <button id="td-auth-btn" type="submit">Entrar</button>
          <div id="td-auth-error">${message}</div>
        </form>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById("td-auth-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("td-auth-btn");
      const err = document.getElementById("td-auth-error");
      btn.disabled = true;
      btn.textContent = "Entrando…";
      err.textContent = "";

      try {
        await firebaseFns.setPersistence(auth, firebaseFns.browserLocalPersistence);
        await firebaseFns.signInWithEmailAndPassword(
          auth,
          document.getElementById("td-auth-email").value.trim(),
          document.getElementById("td-auth-password").value
        );
      } catch (error) {
        err.textContent = authErrorMessage(error?.code);
        btn.disabled = false;
        btn.textContent = "Entrar";
      }
    });
  }

  function showSyncing() {
    removeOverlay();
    const overlay = document.createElement("div");
    overlay.id = "td-auth-overlay";
    overlay.innerHTML = `
      <div id="td-auth-card">
        <div id="td-auth-brand"><img src="icon-512.png.PNG?v=2" alt="Logo Toque Dulce"></div>
        <h1>Toque Dulce</h1>
        <p>Sincronizando los datos compartidos…</p>
      </div>`;
    document.body.appendChild(overlay);
  }

  function applyState(next, doRender = true) {
    if (!next || !next.products || !next.weeks) return;
    applyingRemote = true;
    state = clone(next);
    // La nube puede traer una semana creada antes de que existiera openingStock.
    // Recuperamos los sobrantes guardados en el cierre local antes de mostrarla.
    if (typeof migrateOpeningStocks === "function") migrateOpeningStocks();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (doRender) render();
    applyingRemote = false;
  }

  async function saveMergedCloud() {
    if (!cloudReady || applyingRemote || !currentUser || !cloudRef) return;
    setBadge("☁️ Guardando…", "warn");

    try {
      await firebaseFns.runTransaction(db, async (tx) => {
        const snap = await tx.get(cloudRef);
        const remote = snap.exists() && snap.data()?.state ? snap.data().state : latestRemoteState || lastSyncedState || state;
        const merged = merge3(lastSyncedState || remote, state, remote);

        tx.set(cloudRef, {
          state: clone(merged),
          updatedAt: firebaseFns.serverTimestamp(),
          updatedBy: currentUser.uid
        }, { merge: true });

        latestRemoteState = clone(merged);
        lastSyncedState = clone(merged);
        if (!same(state, merged)) applyState(merged, true);
      });

      setBadge("☁️ Sincronizado", "ok");
    } catch (error) {
      console.error("Error al sincronizar Toque Dulce:", error);
      setBadge("☁️ Sin conexión", "error");
    }
  }

  function queueCloudWrite() {
    if (!cloudReady || applyingRemote) return;
    clearTimeout(saveTimer);
    
    saveTimer = setTimeout(() => firebaseFns.setDoc(cloudRef,{state:clone(state),updatedAt:firebaseFns.serverTimestamp(),updatedBy:currentUser.uid},{merge:true}).then(()=>setBadge("☁️ Sincronizado","ok")).catch(()=>setBadge("☁️ Sin conexión","error")),160);
  }

  async function connectCloud(user) {
    if (!ALLOWED_UIDS.has(user.uid)) {
      await firebaseFns.signOut(auth);
      showLogin("Esta cuenta no tiene permiso para usar Toque Dulce.");
      return;
    }

    currentUser = user;
    showSyncing();
    setBadge("☁️ Conectando…", "warn");
    cloudRef = firebaseFns.doc(db, "toqueDulce", "appState");

    try {
      const first = await firebaseFns.getDoc(cloudRef);

      if (first.exists() && first.data()?.state) {
        const remote = first.data().state;
        latestRemoteState = clone(remote);
        lastSyncedState = clone(remote);

        // Si ya existe una copia compartida, la nube manda al iniciar sesión.
        // Esto evita que un teléfono nuevo vuelva a subir datos de ejemplo.
        applyState(remote, true);
      } else {
        await firebaseFns.setDoc(cloudRef, {
          state: clone(state),
          updatedAt: firebaseFns.serverTimestamp(),
          updatedBy: user.uid
        }, { merge: true });
        latestRemoteState = clone(state);
        lastSyncedState = clone(state);
      }

      cloudReady = true;

      if (unsubscribeSnapshot) unsubscribeSnapshot();
      unsubscribeSnapshot = firebaseFns.onSnapshot(
        cloudRef,
        (snap) => {
          if (!snap.exists() || !snap.data()?.state) return;
          const remote = snap.data().state;
          latestRemoteState = clone(remote);

          if (same(state, lastSyncedState)) {
            applyState(remote, true);
            lastSyncedState = clone(remote);
          } else {
            // Hay cambios locales sin subir: se mezclan antes de reemplazar nada.
            const merged = merge3(lastSyncedState || remote, state, remote);
            applyState(merged, true);
            lastSyncedState = clone(remote);
            queueCloudWrite();
          }

          setBadge("☁️ Sincronizado", "ok");
        },
        (error) => {
          console.error("Firestore snapshot:", error);
          setBadge("☁️ Sin conexión", "error");
        }
      );

      removeOverlay();
      setBadge("☁️ Sincronizado", "ok");
      try { showToast("Datos compartidos sincronizados"); } catch (_) {}
    } catch (error) {
      console.error("No se pudo conectar Firestore:", error);
      cloudReady = false;
      showLogin("No se pudo conectar con los datos compartidos. Probá otra vez.");
    }
  }

  // Conserva el guardado local actual y agrega el guardado compartido.
  const originalSaveState = saveState;
  saveState = function (shouldRender = true) {
    originalSaveState(shouldRender);
    queueCloudWrite();
  };

  window.toqueDulceCerrarSesion = async function () {
    if (auth) await firebaseFns.signOut(auth);
  };

  try {
    installStyles();
    showSyncing();

    const [appMod, authMod, fsMod] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`)
    ]);

    firebaseFns = { ...authMod, ...fsMod };

    const firebaseApp = appMod.initializeApp(firebaseConfig);
    auth = authMod.getAuth(firebaseApp);
    db = fsMod.getFirestore(firebaseApp);

    authMod.onAuthStateChanged(auth, async (user) => {
      if (user) await connectCloud(user);
      else showLogin();
    });
  } catch (error) {
    console.error("Error cargando Firebase:", error);
    showLogin("No se pudo cargar la sincronización. Revisá tu conexión a Internet.");
  }
})();
