(() => {
  const snap = value => ({val: () => value, exists: () => value !== null && value !== undefined});
  class Ref {
    constructor(path = '') { this.path = path; }
    child(key) { return new Ref(`${this.path}/${key}`); }
    orderByChild() { return this; }
    equalTo() { return this; }
    once() { return Promise.resolve(snap(null)); }
    on(_event, callback) { setTimeout(() => callback(snap(null)), 0); }
    off() {}
  }
  const auth = {
    currentUser: null,
    setPersistence: () => Promise.resolve(),
    onAuthStateChanged(callback) { setTimeout(() => callback(null), 0); return () => {}; },
    signInWithEmailAndPassword: () => Promise.reject(new Error('mock')),
    createUserWithEmailAndPassword: () => Promise.reject(new Error('mock')),
    signOut: () => Promise.resolve(),
  };
  function authFn() { return auth; }
  authFn.Auth = {Persistence: {LOCAL: 'local'}};
  const db = {ref: path => new Ref(path)};
  window.firebase = {apps: [], initializeApp() { this.apps.push({}); return {}; }, app() { return this.apps[0]; }, auth: authFn, database: () => db};
  window.CROWNDRIVE_FIREBASE_CONFIG = {projectId: 'mock'};
})();
