(() => {
  if (window.claude && window.claude.use) return;
  const downloads = {
    async save({ filename, data: text }) {
      const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: filename });
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { status: "saved" };
    },
  };
  const seed = window.STOKVEL_SEED || { members: [], payments: [] };

  if (window.FIREBASE_CONFIG && window.firebase) {
    firebase.initializeApp(window.FIREBASE_CONFIG);
    const auth = firebase.auth();
    const fs = firebase.firestore();
    const admins = (window.STOKVEL_ADMINS || []).map((e) => e.toLowerCase());
    const isAdmin = (u) => !!u && admins.includes((u.email || "").toLowerCase());
    let first = true;
    const ready = new Promise((resolve) => auth.onAuthStateChanged((u) => {
      if (first) { first = false; resolve(u); } else location.reload();
    }));
    const seedIfEmpty = async () => {
      if (!(await fs.collection("members").limit(1).get()).empty) return;
      const b = fs.batch();
      for (const { id, ...d } of seed.members) b.set(fs.doc("members/" + id), { role: null, withdrawn: null, ...d });
      for (const { id, ...d } of seed.payments) b.set(fs.doc("payments/" + id), d);
      await b.commit();
    };
    // Anyone can view without signing in; only the admins listed in firebase-config.js can edit
    window.STOKVEL_BACKEND = "Firestore";
    window.stokvelAuth = {
      ready,
      signIn: () => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()),
      signOut: () => auth.signOut(),
    };
    window.claude = {
      use: async (name) => {
        const u = await ready;
        if (name === "db") { if (isAdmin(u)) await seedIfEmpty().catch(() => {}); return fs; }
        if (name === "user") return { email: u?.email, can: async () => isAdmin(u) };
        if (name === "downloads") return downloads;
        return null;
      },
    };
    return;
  }
  // Firebase is configured but its SDK failed to load: never fall back to browser storage
  if (window.FIREBASE_CONFIG) {
    window.claude = { use: async (name) => (name === "downloads" ? downloads : null) };
    return;
  }

  const KEY = "as-majita-stokvel-v2";
  const listeners = {};
  let data;
  try { data = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { data = null; }
  if (!data) {
    data = { members: {}, payments: {}, settings: {} };
    for (const m of seed.members) { const { id, ...d } = m; data.members[id] = { role: null, withdrawn: null, ...d }; }
    for (const p of seed.payments) { const { id, ...d } = p; data.payments[id] = d; }
  }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {} };
  save();
  const snap = (col) => ({ docs: Object.entries(data[col] || {}).map(([id, d]) => ({ id, exists: true, data: () => ({ ...d }) })) });
  const emit = (col) => { save(); (listeners[col] || []).forEach((cb) => cb(snap(col))); };
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const doc = (path) => {
    const [col, id] = path.split("/");
    data[col] ||= {};
    return {
      id, path,
      async get() { const d = data[col][id]; return { id, exists: !!d, data: () => d && { ...d } }; },
      async set(v) { data[col][id] = { ...v }; emit(col); },
      async update(v) { data[col][id] = { ...(data[col][id] || {}), ...v }; emit(col); },
      async delete() { delete data[col][id]; emit(col); },
    };
  };
  const db = {
    doc,
    collection: (col) => ({
      path: col,
      doc: (id = newId()) => doc(col + "/" + id),
      async add(v) { const id = newId(); data[col] ||= {}; data[col][id] = { ...v }; emit(col); return doc(col + "/" + id); },
      onSnapshot(cb) { (listeners[col] ||= []).push(cb); setTimeout(() => cb(snap(col)), 0); return () => { listeners[col] = listeners[col].filter((f) => f !== cb); }; },
    }),
  };
  const user = { can: async () => true };
  window.claude = { use: async (name) => ({ db, downloads, user })[name] || null };
})();
