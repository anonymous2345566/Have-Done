// Klaar — Microsoft account (MSAL Node) + Microsoft Graph proxy for the Electron main process.
// The access token never leaves the main process; the renderer can only call a
// whitelisted set of Graph endpoints through IPC.
const { PublicClientApplication, InteractionRequiredAuthError } = require('@azure/msal-node');
const { shell, safeStorage, net } = require('electron');
const fs = require('fs');
const path = require('path');

const SCOPES = ['User.Read', 'Tasks.ReadWrite', 'Calendars.ReadWrite', 'Files.ReadWrite.AppFolder'];
const AUTHORITY = 'https://login.microsoftonline.com/common';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Paths the renderer may call (relative to /v1.0)
const ALLOWED = [
  /^\/me(\?|$)/,
  /^\/me\/todo\/lists(\/|\?|$)/,
  /^\/me\/calendarView(\?|$)/,
  /^\/me\/events(\/|\?|$)/,
  /^\/me\/drive\/special\/approot(:|\/|\?|$)/,
  /^\/me\/planner\/tasks(\?|$)/,
  /^\/planner\/tasks\/[A-Za-z0-9_-]+$/,
  /^\/planner\/plans\/[A-Za-z0-9_-]+(\?|$)/
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class MicrosoftAccount {
  constructor(userDataDir) {
    this.cacheFile = path.join(userDataDir, 'ms-token-cache.bin');
    this.cfgFile = path.join(userDataDir, 'ms-config.json');
    this.clientId = null;
    this.pca = null;
    try {
      const cfg = JSON.parse(fs.readFileSync(this.cfgFile, 'utf8'));
      if (GUID.test(cfg.clientId || '')) this.setClientId(cfg.clientId);
    } catch { /* not configured yet */ }
  }

  // ---------- encrypted token cache ----------
  cachePlugin() {
    const file = this.cacheFile;
    const canEncrypt = () => {
      try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
    };
    return {
      beforeCacheAccess: async (ctx) => {
        try {
          const raw = fs.readFileSync(file);
          const text = raw.subarray(0, 4).toString() === 'ENC1'
            ? safeStorage.decryptString(raw.subarray(4))
            : raw.toString('utf8');
          ctx.tokenCache.deserialize(text);
        } catch { /* empty cache */ }
      },
      afterCacheAccess: async (ctx) => {
        if (!ctx.cacheHasChanged) return;
        const text = ctx.tokenCache.serialize();
        const data = canEncrypt()
          ? Buffer.concat([Buffer.from('ENC1'), safeStorage.encryptString(text)])
          : Buffer.from(text, 'utf8');
        fs.writeFileSync(file, data, { mode: 0o600 });
      }
    };
  }

  setClientId(id) {
    if (!GUID.test(id || '')) throw new Error('invalid-client-id');
    if (id === this.clientId && this.pca) return;
    this.clientId = id;
    this.pca = new PublicClientApplication({
      auth: { clientId: id, authority: AUTHORITY },
      cache: { cachePlugin: this.cachePlugin() }
    });
    try { fs.writeFileSync(this.cfgFile, JSON.stringify({ clientId: id })); } catch { /* ignore */ }
  }

  async account() {
    if (!this.pca) return null;
    const accounts = await this.pca.getTokenCache().getAllAccounts();
    return accounts[0] || null;
  }

  describe(acc) {
    if (!acc) return null;
    return {
      name: acc.name || acc.username,
      username: acc.username,
      tenantId: acc.tenantId,
      personal: acc.tenantId === CONSUMER_TENANT
    };
  }

  async login(clientId) {
    this.setClientId(clientId);
    const res = await this.pca.acquireTokenInteractive({
      scopes: SCOPES,
      prompt: 'select_account',
      openBrowser: async (url) => {
        if (!url.startsWith('https://login.microsoftonline.com/')) throw new Error('unexpected-login-url');
        await shell.openExternal(url);
      },
      successTemplate: page('✅', 'Je bent ingelogd bij Klaar', 'Je kunt dit tabblad sluiten en teruggaan naar Klaar.'),
      errorTemplate: page('⚠️', 'Inloggen mislukt', 'Ga terug naar Klaar en probeer het opnieuw.')
    });
    return this.describe(res.account);
  }

  async logout() {
    if (!this.pca) return;
    const cache = this.pca.getTokenCache();
    for (const acc of await cache.getAllAccounts()) await cache.removeAccount(acc);
    try { fs.unlinkSync(this.cacheFile); } catch { /* ignore */ }
  }

  async token() {
    const acc = await this.account();
    if (!acc) throw Object.assign(new Error('not-signed-in'), { code: 'login' });
    try {
      const res = await this.pca.acquireTokenSilent({ account: acc, scopes: SCOPES });
      return res.accessToken;
    } catch (e) {
      if (e instanceof InteractionRequiredAuthError) throw Object.assign(new Error('login-required'), { code: 'login' });
      throw e;
    }
  }

  // ---------- Graph proxy ----------
  async graph({ method = 'GET', url, body, headers = {} }) {
    method = String(method).toUpperCase();
    if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return { ok: false, status: 400, error: 'method' };
    let rel = String(url || '');
    if (rel.startsWith(GRAPH)) rel = rel.slice(GRAPH.length);
    if (!rel.startsWith('/') || rel.includes('..') || !ALLOWED.some((re) => re.test(rel))) {
      return { ok: false, status: 403, error: 'path-not-allowed' };
    }
    let token;
    try {
      token = await this.token();
    } catch (e) {
      return { ok: false, status: 401, error: e.code === 'login' ? 'login' : String(e.message || e) };
    }
    const h = { Authorization: `Bearer ${token}` };
    for (const [k, v] of Object.entries(headers || {})) {
      if (['if-match', 'prefer'].includes(k.toLowerCase()) && typeof v === 'string') h[k] = v;
    }
    let payload;
    if (body !== undefined && body !== null) {
      if (typeof body === 'string') {
        payload = body;
        h['Content-Type'] = 'application/octet-stream';
        if (rel.includes('.json:/content')) h['Content-Type'] = 'application/json';
      } else {
        payload = JSON.stringify(body);
        h['Content-Type'] = 'application/json';
      }
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      let res;
      try {
        res = await net.fetch(GRAPH + rel, { method, headers: h, body: payload });
      } catch (e) {
        if (attempt < 2) { await sleep(1000 * (attempt + 1)); continue; }
        return { ok: false, status: 0, error: 'offline' };
      }
      if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < 3) {
        const wait = Math.min(30, Number(res.headers.get('retry-after')) || 2 ** attempt);
        await sleep(wait * 1000);
        continue;
      }
      const type = res.headers.get('content-type') || '';
      let data = null;
      if (res.status !== 204) {
        const text = await res.text();
        if (type.includes('json')) {
          try { data = JSON.parse(text); } catch { data = text; }
        } else data = text;
      }
      return { ok: res.ok, status: res.status, data, etag: res.headers.get('etag') };
    }
    return { ok: false, status: 429, error: 'throttled' };
  }
}

function page(icon, title, text) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:Segoe UI,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:90vh;background:#eef2fb;color:#252423">
<div style="text-align:center"><div style="font-size:56px">${icon}</div><h1 style="color:#2f5fd0">${title}</h1><p>${text}</p></div></body>`;
}

module.exports = { MicrosoftAccount, SCOPES };
