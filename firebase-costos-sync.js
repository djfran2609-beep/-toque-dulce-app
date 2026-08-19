// Toque Dulce - sincronización de costos, recetas, cierres y ganancias
(async function toqueDulceCostosCloudSync() {
  "use strict";
  const FIREBASE_VERSION = "12.17.1";
  const BASE_KEY = "toqueDulce_calculadoraCostos_syncBase_v1";
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
  const bridge = window.toqueDulceCostosSync;
  if (!bridge) return;

  let auth, db, currentUser, cloudRef, unsubscribeSnapshot, firebaseFns;
  let cloudReady = false;
  let applyingRemote = false;
  let saveTimer = null;
  let lastSyncedState = readBase();

  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const same = (a, b) => {
    try { return JSON.stringify(a) === JSON.stringify(b); }
    catch (_) { return false; }
  };
  const isObject = value => value && typeof value === "object" && !Array.isArray(value);

  function normalize(value) {
    const data = isObject(value) ? clone(value) : {};
    if (!Array.isArray(data.ingredientes)) data.ingredientes = [];
    if (!Array.isArray(data.recetas)) data.recetas = [];
    if (!Array.isArray(data.egresos)) data.egresos = [];
    if (!isObject(data.cierres)) data.cierres = {};
    return data;
  }

  function readBase() {
    try {
      const saved = JSON.parse(localStorage.getItem(BASE_KEY));
      return saved && typeof saved === "object" ? saved : null;
    } catch (_) {
      return null;
    }
  }

  function saveBase(value) {
    lastSyncedState = normalize(value);
    localStorage.setItem(BASE_KEY, JSON.stringify(lastSyncedState));
  }

  function mergeArrays(base, local, remote) {
    const keyFor = item => item?.id ?? item?.productId ?? item?.ingredientId ?? null;
    const allObjects = [base, local, remote].every(list =>
      Array.isArray(list) && list.every(item => isObject(item))
    );
    const keyable = allObjects && [...base, ...local, ...remote].every(item => keyFor(item) != null);
    if (!keyable) return same(local, base) ? clone(remote) : clone(local);

    const baseMap = new Map(base.map(item => [String(keyFor(item)), item]));
    const localMap = new Map(local.map(item => [String(keyFor(item)), item]));
    const remoteMap = new Map(remote.map(item => [String(keyFor(item)), item]));
    const order = [];
    [...remote, ...local].forEach(item => {
      const key = String(keyFor(item));
      if (!order.includes(key)) order.push(key);
    });

    const output = [];
    for (const key of order) {
      const before = baseMap.get(key);
      const here = localMap.get(key);
      const there = remoteMap.get(key);
      if (before && !here) {
        if (!there || same(there, before)) continue;
        output.push(clone(there));
        continue;
      }
      if (!before && here && !there) { output.push(clone(here)); continue; }
      if (!before && !here && there) { output.push(clone(there)); continue; }
      if (!before && here && there) { output.push(merge3(undefined, here, there)); continue; }
      if (before && here && !there) {
        if (same(here, before)) continue;
        output.push(clone(here));
        continue;
      }
      if (before && here && there) output.push(merge3(before, here, there));
    }
    return output;
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
    if (isObject(local) && isObject(remote)) {
      const before = isObject(base) ? base : {};
      const keys = new Set([...Object.keys(before), ...Object.keys(local), ...Object.keys(remote)]);
      const output = {};
      for (const key of keys) {
        if (!(key in local) && key in before && same(remote[key], before[key])) continue;
        if (!(key in remote) && key in before && same(local[key], before[key])) continue;
        output[key] = merge3(before[key], local[key], remote[key]);
      }
      return output;
    }
    return clone(local);
  }

  function mergeFresh(localValue, remoteValue) {
    const local = normalize(localValue);
    const remote = normalize(remoteValue);
    const union = (localList, remoteList) => {
      const map = new Map();
      localList.forEach(item => map.set(String(item.id), clone(item)));
      remoteList.forEach(item => map.set(String(item.id), clone(item)));
      const ordered = [];
      [...remoteList, ...localList].forEach(item => {
        const key = String(item.id);
        if (!ordered.includes(key)) ordered.push(key);
      });
      return ordered.map(key => map.get(key));
    };
    return normalize({
      ...local,
      ...remote,
      ingredientes: union(local.ingredientes, remote.ingredientes),
      recetas: union(local.recetas, remote.recetas),
      egresos: union(local.egresos, remote.egresos),
      cierres: { ...local.cierres, ...remote.cierres }
    });
  }

  function installStyles() {
    if (document.getElementById("td-costos-cloud-style")) return;
    const style = document.createElement("style");
    style.id = "td-costos-cloud-style";
    style.textContent = [
      "#td-costos-auth{position:fixed;inset:0;z-index:10000;background:linear-gradient(180deg,#fff4f8,#fffafb 55%,#fff7fa);display:flex;align-items:center;justify-content:center;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#261d22}",
      "#td-costos-auth-card{width:100%;max-width:430px;background:#fff;border:1px solid #f1dfe7;border-radius:28px;padding:24px;box-shadow:0 18px 50px rgba(83,39,58,.12)}",
      "#td-costos-auth-card h1{font-size:27px;margin:0 0 7px}#td-costos-auth-card p{margin:0 0 18px;color:#7a6b73;line-height:1.45;font-size:14px}",
      ".td-costos-field{margin-bottom:12px}.td-costos-field label{display:block;font-size:12px;font-weight:800;margin-bottom:6px}.td-costos-field input{width:100%;border:1px solid #f1dfe7;border-radius:14px;padding:13px;outline:none}",
      "#td-costos-auth-btn{width:100%;border:0;border-radius:14px;padding:13px 14px;font-weight:850;color:#fff;background:linear-gradient(135deg,#f05b92,#ff8db5)}#td-costos-auth-error{min-height:18px;color:#d94b63;font-size:12px;margin-top:10px}",
      "#td-costos-sync-badge{position:fixed;z-index:9000;right:14px;top:calc(13px + env(safe-area-inset-top));background:rgba(255,255,255,.94);border:1px solid #f1dfe7;border-radius:999px;padding:6px 9px;font:700 10px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#7a6b73;box-shadow:0 3px 12px rgba(83,39,58,.06);display:none;max-width:145px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      "#td-costos-sync-badge.ok{color:#257f57}#td-costos-sync-badge.warn{color:#9d6510}#td-costos-sync-badge.error{color:#d94b63}"
    ].join("");
    document.head.appendChild(style);
  }

  function badge(text, kind) {
    let element = document.getElementById("td-costos-sync-badge");
    if (!element) {
      element = document.createElement("div");
      element.id = "td-costos-sync-badge";
      document.body.appendChild(element);
    }
    element.textContent = text;
    element.className = kind || "";
    element.style.display = currentUser ? "block" : "none";
  }

  function removeOverlay() {
    document.getElementById("td-costos-auth")?.remove();
  }

  function showSyncing() {
    removeOverlay();
    const overlay = document.createElement("div");
    overlay.id = "td-costos-auth";
    overlay.innerHTML = "<div id='td-costos-auth-card'><h1>🍰 Toque Dulce</h1><p>Sincronizando ingredientes, recetas y ganancias…</p></div>";
    document.body.appendChild(overlay);
  }

  function authMessage(code) {
    const messages = {
      "auth/invalid-credential": "Correo o contraseña incorrectos.",
      "auth/user-disabled": "Esta cuenta está deshabilitada.",
      "auth/too-many-requests": "Hubo demasiados intentos. Esperá un momento.",
      "auth/network-request-failed": "No hay conexión a Internet."
    };
    return messages[code] || "No se pudo iniciar sesión.";
  }

  function showLogin(message) {
    currentUser = null;
    cloudReady = false;
    badge("", "");
    removeOverlay();
    const overlay = document.createElement("div");
    overlay.id = "td-costos-auth";
    overlay.innerHTML = "<div id='td-costos-auth-card'><h1>🍰 Toque Dulce</h1><p>Ingresá para sincronizar costos y ganancias entre los dos celulares.</p><form id='td-costos-auth-form'><div class='td-costos-field'><label>Correo</label><input id='td-costos-auth-email' type='email' autocomplete='username' required></div><div class='td-costos-field'><label>Contraseña</label><input id='td-costos-auth-password' type='password' autocomplete='current-password' required></div><button id='td-costos-auth-btn' type='submit'>Entrar</button><div id='td-costos-auth-error'></div></form></div>";
    document.body.appendChild(overlay);
    document.getElementById("td-costos-auth-error").textContent = message || "";
    document.getElementById("td-costos-auth-form").addEventListener("submit", async event => {
      event.preventDefault();
      const button = document.getElementById("td-costos-auth-btn");
      const errorBox = document.getElementById("td-costos-auth-error");
      button.disabled = true;
      button.textContent = "Entrando…";
      errorBox.textContent = "";
      try {
        await firebaseFns.setPersistence(auth, firebaseFns.browserLocalPersistence);
        await firebaseFns.signInWithEmailAndPassword(
          auth,
          document.getElementById("td-costos-auth-email").value.trim(),
          document.getElementById("td-costos-auth-password").value
        );
      } catch (error) {
        errorBox.textContent = authMessage(error?.code);
        button.disabled = false;
        button.textContent = "Entrar";
      }
    });
  }

  function applyState(value) {
    applyingRemote = true;
    bridge.applyState(normalize(value));
    applyingRemote = false;
  }

  async function writeCostsNow() {
    if (!cloudReady || applyingRemote || !currentUser || !cloudRef) return;
    badge("☁️ Guardando…", "warn");
    try {
      let finalState = normalize(bridge.getState());
      await firebaseFns.runTransaction(db, async transaction => {
        const snapshot = await transaction.get(cloudRef);
        const remote = normalize(snapshot.data()?.costosState);
        const local = normalize(bridge.getState());
        finalState = lastSyncedState ? merge3(lastSyncedState, local, remote) : mergeFresh(local, remote);
        transaction.set(cloudRef, {
          costosState: clone(finalState),
          costosUpdatedAt: firebaseFns.serverTimestamp(),
          costosUpdatedBy: currentUser.uid
        }, { merge: true });
      });
      applyState(finalState);
      saveBase(finalState);
      badge("☁️ Sincronizado", "ok");
    } catch (error) {
      console.error("Error sincronizando costos:", error);
      badge("☁️ Sin conexión", "error");
    }
  }

  function queueWrite() {
    if (!cloudReady || applyingRemote) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeCostsNow, 180);
  }

  async function finishWeekInCloud(weekId) {
    if (!cloudReady || !weekId) return;
    try {
      await firebaseFns.runTransaction(db, async transaction => {
        const snapshot = await transaction.get(cloudRef);
        const appState = snapshot.data()?.state;
        if (!appState?.weeks) return;
        const week = appState.weeks.find(item => item.id === weekId);
        if (!week) return;
        week.status = "closed";
        transaction.set(cloudRef, {
          state: clone(appState),
          updatedAt: firebaseFns.serverTimestamp(),
          updatedBy: currentUser.uid
        }, { merge: true });
      });
    } catch (error) {
      console.error("No se pudo finalizar la semana en la nube:", error);
      badge("Cierre local · sin conexión", "error");
    }
  }

  async function connect(user) {
    if (!ALLOWED_UIDS.has(user.uid)) {
      await firebaseFns.signOut(auth);
      showLogin("Esta cuenta no tiene permiso para usar Toque Dulce.");
      return;
    }
    currentUser = user;
    showSyncing();
    badge("☁️ Conectando…", "warn");
    cloudRef = firebaseFns.doc(db, "toqueDulce", "appState");
    try {
      const first = await firebaseFns.getDoc(cloudRef);
      const remoteRaw = first.data()?.costosState;
      const local = normalize(bridge.getState());
      let merged = local;
      if (remoteRaw) {
        const remote = normalize(remoteRaw);
        merged = lastSyncedState ? merge3(lastSyncedState, local, remote) : mergeFresh(local, remote);
      }
      applyState(merged);
      saveBase(merged);
      if (!remoteRaw || !same(merged, normalize(remoteRaw))) {
        await firebaseFns.setDoc(cloudRef, {
          costosState: clone(merged),
          costosUpdatedAt: firebaseFns.serverTimestamp(),
          costosUpdatedBy: user.uid
        }, { merge: true });
      }
      cloudReady = true;
      unsubscribeSnapshot?.();
      unsubscribeSnapshot = firebaseFns.onSnapshot(cloudRef, snapshot => {
        const remoteRawNow = snapshot.data()?.costosState;
        if (!remoteRawNow) return;
        const remote = normalize(remoteRawNow);
        const localNow = normalize(bridge.getState());
        if (same(localNow, lastSyncedState)) {
          applyState(remote);
          saveBase(remote);
        } else {
          const combined = lastSyncedState ? merge3(lastSyncedState, localNow, remote) : mergeFresh(localNow, remote);
          applyState(combined);
          saveBase(remote);
          if (!same(combined, remote)) queueWrite();
        }
        badge("☁️ Sincronizado", "ok");
      }, error => {
        console.error("Firestore costos:", error);
        badge("☁️ Sin conexión", "error");
      });
      removeOverlay();
      badge("☁️ Sincronizado", "ok");
    } catch (error) {
      console.error("No se pudo conectar la calculadora:", error);
      showLogin("No se pudo conectar. Revisá Internet y probá otra vez.");
    }
  }

  window.addEventListener("toqueDulceCostosChanged", queueWrite);
  window.addEventListener("toqueDulceSemanaFinalizada", event => finishWeekInCloud(event.detail?.weekId));
  window.toqueDulceCerrarSesion = async () => {
    if (auth) await firebaseFns.signOut(auth);
  };

  try {
    installStyles();
    showSyncing();
    const modules = await Promise.all([
      import("https://www.gstatic.com/firebasejs/" + FIREBASE_VERSION + "/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/" + FIREBASE_VERSION + "/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/" + FIREBASE_VERSION + "/firebase-firestore.js")
    ]);
    const appMod = modules[0], authMod = modules[1], fsMod = modules[2];
    firebaseFns = { ...authMod, ...fsMod };
    const app = appMod.initializeApp(firebaseConfig);
    auth = authMod.getAuth(app);
    db = fsMod.getFirestore(app);
    authMod.onAuthStateChanged(auth, user => user ? connect(user) : showLogin());
  } catch (error) {
    console.error("Error cargando Firebase para costos:", error);
    showLogin("No se pudo cargar la sincronización. Revisá Internet.");
  }
})();
