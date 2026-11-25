// Klaar — Microsoft integration: sign-in, Microsoft To Do sync, Outlook calendar,
// OneDrive backup and Planner ("Assigned to me"), all through Microsoft Graph.
(function () {
  const { Store, todayKey, toKey, uid, CATEGORIES } = window.Klaar;
  const nativeMs = window.klaarNative && window.klaarNative.ms ? window.klaarNative.ms : null;
  const GRAPH = 'https://graph.microsoft.com/v1.0';
  const LOGIN = 'https://login.microsoftonline.com/common/oauth2/v2.0';
  const SCOPES = 'openid profile offline_access User.Read Tasks.ReadWrite Calendars.ReadWrite Files.ReadWrite.AppFolder';
  const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';
  const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const BACKUP_PATH = '/me/drive/special/approot:/klaar-backup.json';

  const state = {
    account: null,
    needLogin: false,
    syncing: false,
    error: null,
    calendar: null, // array of today's events, or null when unavailable
    planner: null, // array of Planner tasks, or null when unavailable
    plans: {}
  };
  const listeners = [];
  const changed = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  const S = () => Store.data.settings;
  const enc = encodeURIComponent;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function clientId() {
    const own = (S().msClientId || '').trim();
    if (GUID.test(own)) return own;
    const def = (window.KLAAR_CONFIG && window.KLAAR_CONFIG.msClientId) || '';
    return GUID.test(def) ? def : '';
  }

  // Microsoft sign-in needs either the desktop app or an https/localhost page
  function supported() {
    return !!nativeMs || location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  }

  // =====================================================================
  //  Web sign-in (authorization code + PKCE, no secrets, no library)
  // =====================================================================
  const WEB_TOKENS = 'klaar-ms-tokens';
  const WEB_PKCE = 'klaar-ms-pkce';
  const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');
  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const randomString = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

  function decodeJwt(t) {
    try {
      const part = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(part))));
    } catch {
      return {};
    }
  }

  function webAccountFrom(tokens) {
    if (!tokens || !tokens.id_token) return null;
    const c = decodeJwt(tokens.id_token);
    return { name: c.name || c.preferred_username, username: c.preferred_username || c.email || '', tenantId: c.tid, personal: c.tid === CONSUMER_TENANT };
  }

  async function webLogin(id) {
    const verifier = randomString(48);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const st = randomString(16);
    sessionStorage.setItem(WEB_PKCE, JSON.stringify({ verifier, state: st, clientId: id }));
    const q = new URLSearchParams({
      client_id: id,
      response_type: 'code',
      redirect_uri: redirectUri(),
      response_mode: 'query',
      scope: SCOPES,
      state: st,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account'
    });
    Store.flush();
    location.assign(`${LOGIN}/authorize?${q}`);
    return new Promise(() => {}); // page navigates away
  }

  async function tokenRequest(params) {
    const res = await fetch(`${LOGIN}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error_description || data.error || 'token'), { code: data.error });
    return { ...data, expires_at: Date.now() + (data.expires_in || 3600) * 1000 };
  }

  async function webHandleRedirect() {
    if (nativeMs) return;
    const p = new URLSearchParams(location.search);
    if (!p.has('code') && !p.has('error')) return;
    const saved = JSON.parse(sessionStorage.getItem(WEB_PKCE) || 'null');
    sessionStorage.removeItem(WEB_PKCE);
    history.replaceState(null, '', redirectUri());
    if (p.has('error')) {
      state.error = p.get('error_description') || p.get('error');
      return;
    }
    if (!saved || saved.state !== p.get('state')) {
      state.error = 'state-mismatch';
      return;
    }
    try {
      const tokens = await tokenRequest({
        client_id: saved.clientId,
        grant_type: 'authorization_code',
        code: p.get('code'),
        redirect_uri: redirectUri(),
        code_verifier: saved.verifier,
        scope: SCOPES
      });
      tokens.client_id = saved.clientId;
      localStorage.setItem(WEB_TOKENS, JSON.stringify(tokens));
      state.justSignedIn = true;
    } catch (e) {
      state.error = e.message;
    }
  }

  async function webToken() {
    let tokens = JSON.parse(localStorage.getItem(WEB_TOKENS) || 'null');
    if (!tokens) throw Object.assign(new Error('login'), { code: 'login' });
    if (tokens.expires_at - 90000 > Date.now()) return tokens.access_token;
    if (!tokens.refresh_token) throw Object.assign(new Error('login'), { code: 'login' });
    try {
      const fresh = await tokenRequest({
        client_id: tokens.client_id,
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        scope: SCOPES
      });
      tokens = { ...tokens, ...fresh };
      localStorage.setItem(WEB_TOKENS, JSON.stringify(tokens));
      return tokens.access_token;
    } catch (e) {
      throw Object.assign(new Error('login'), { code: 'login' });
    }
  }

  // =====================================================================
  //  Graph client (desktop: via main process; web: direct fetch)
  // =====================================================================
  async function graph(method, url, body, headers = {}) {
    const h = { Prefer: `outlook.timezone="${TZ}"`, ...headers };
    let r;
    if (nativeMs) {
      r = await nativeMs.graph({ method, url, body, headers: h });
    } else {
      let token;
      try {
        token = await webToken();
      } catch {
        r = { ok: false, status: 401, error: 'login' };
      }
      if (!r) {
        const abs = url.startsWith('http') ? url : GRAPH + url;
        if (!abs.startsWith(GRAPH + '/')) return { ok: false, status: 403 };
        const fh = { ...h, Authorization: `Bearer ${token}` };
        let payload;
        if (body !== undefined && body !== null) {
          payload = typeof body === 'string' ? body : JSON.stringify(body);
          fh['Content-Type'] = 'application/json';
        }
        for (let attempt = 0; attempt < 4; attempt++) {
          let res;
          try {
            res = await fetch(abs, { method, headers: fh, body: payload });
          } catch {
            r = { ok: false, status: 0, error: 'offline' };
            break;
          }
          if ((res.status === 429 || res.status === 503) && attempt < 3) {
            await sleep(Math.min(30, Number(res.headers.get('retry-after')) || 2 ** attempt) * 1000);
            continue;
          }
          const type = res.headers.get('content-type') || '';
          let data = null;
          if (res.status !== 204) {
            const text = await res.text();
            data = type.includes('json') ? JSON.parse(text || 'null') : text;
          }
          r = { ok: res.ok, status: res.status, data, etag: res.headers.get('etag') };
          break;
        }
      }
    }
    if (r && r.status === 401 && r.error === 'login') {
      state.needLogin = true;
      changed();
    }
    return r || { ok: false, status: 0 };
  }

  async function g(method, url, body, headers) {
    const r = await graph(method, url, body, headers);
    if (!r.ok) {
      const msg = (r.data && r.data.error && r.data.error.message) || r.error || `HTTP ${r.status}`;
      throw Object.assign(new Error(msg), { status: r.status, data: r.data });
    }
    return r.data;
  }

  async function allPages(url) {
    const out = [];
    let next = url;
    while (next) {
      const d = await g('GET', next);
      out.push(...(d.value || []));
      next = d['@odata.nextLink'];
    }
    return out;
  }

  // =====================================================================
  //  Account
  // =====================================================================
  async function refreshStatus() {
    if (nativeMs) {
      const st = await nativeMs.status().catch(() => null);
      state.account = st && st.account ? st.account : null;
    } else {
      const tokens = JSON.parse(localStorage.getItem(WEB_TOKENS) || 'null');
      state.account = webAccountFrom(tokens);
    }
    Store.syncLinked = !!(state.account && S().msSync);
    changed();
    return state.account;
  }

  async function login() {
    const id = clientId();
    if (!id) throw new Error('no-client-id');
    if (!supported()) throw new Error('unsupported');
    state.error = null;
    if (nativeMs) {
      const r = await nativeMs.login(id);
      if (!r.ok) throw new Error(r.error || 'login');
      state.account = r.account;
    } else {
      await webLogin(id);
    }
    state.needLogin = false;
    Store.syncLinked = !!S().msSync;
    changed();
    afterSignIn();
    return state.account;
  }

  async function logout() {
    if (nativeMs) await nativeMs.logout();
    else localStorage.removeItem(WEB_TOKENS);
    state.account = null;
    state.calendar = null;
    state.planner = null;
    Store.syncLinked = false;
    changed();
  }

  // =====================================================================
  //  Mapping between Klaar and Microsoft To Do
  // =====================================================================
  const CAT_NAMES = {
    blue: ['Blue category', 'Blauwe categorie'],
    green: ['Green category', 'Groene categorie'],
    orange: ['Orange category', 'Oranje categorie'],
    purple: ['Purple category', 'Paarse categorie'],
    red: ['Red category', 'Rode categorie'],
    yellow: ['Yellow category', 'Gele categorie']
  };
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  function catFromName(name) {
    const learned = S().msCatNames || {};
    for (const id of Object.keys(CAT_NAMES)) {
      if (learned[id] === name || CAT_NAMES[id].includes(name) || (S().categoryNames || {})[id] === name) return id;
    }
    return null;
  }
  function catToName(id) {
    const learned = S().msCatNames || {};
    return learned[id] || CAT_NAMES[id][S().lang === 'nl' ? 1 : 0];
  }

  const pad = (n) => String(n).padStart(2, '0');
  const localDateTime = (d) => `${toKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

  // Graph dateTimeTimeZone → JS Date
  function fromDTZ(v) {
    if (!v || !v.dateTime) return null;
    const s = v.dateTime.replace(/\.\d+$/, '');
    const utc = !v.timeZone || /^(UTC|Etc\/UTC|tzone:\/\/Microsoft\/Utc)$/i.test(v.timeZone);
    const d = utc ? new Date(s + 'Z') : new Date(s);
    return isNaN(d) ? null : d;
  }

  function toRecurrence(rep, due) {
    const d = new Date(due + 'T12:00:00');
    const pattern = { interval: Math.max(1, Number(rep.interval) || 1), firstDayOfWeek: 'monday' };
    switch (rep.freq) {
      case 'daily': pattern.type = 'daily'; break;
      case 'weekdays': Object.assign(pattern, { type: 'weekly', interval: 1, daysOfWeek: DAYS.slice(1, 6) }); break;
      case 'weekly':
        pattern.type = 'weekly';
        pattern.daysOfWeek = (rep.days && rep.days.length ? rep.days : [d.getDay()]).map((x) => DAYS[x]);
        break;
      case 'monthly': Object.assign(pattern, { type: 'absoluteMonthly', dayOfMonth: d.getDate() }); break;
      case 'yearly': Object.assign(pattern, { type: 'absoluteYearly', dayOfMonth: d.getDate(), month: d.getMonth() + 1 }); break;
      default: return null;
    }
    return { pattern, range: { type: 'noEnd', startDate: due } };
  }

  function fromRecurrence(rec) {
    if (!rec || !rec.pattern) return null;
    const p = rec.pattern;
    const interval = Math.max(1, p.interval || 1);
    switch (p.type) {
      case 'daily': return { freq: 'daily', interval };
      case 'weekly': {
        const days = (p.daysOfWeek || []).map((x) => DAYS.indexOf(String(x).toLowerCase())).filter((x) => x >= 0);
        if (interval === 1 && days.length === 5 && [1, 2, 3, 4, 5].every((x) => days.includes(x))) return { freq: 'weekdays', interval: 1 };
        return days.length > 1 ? { freq: 'weekly', interval, days } : { freq: 'weekly', interval };
      }
      case 'absoluteMonthly':
      case 'relativeMonthly': return { freq: 'monthly', interval };
      case 'absoluteYearly':
      case 'relativeYearly': return { freq: 'yearly', interval };
      default: return null;
    }
  }

  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
    doc.querySelectorAll('p, div, li').forEach((b) => b.append('\n'));
    return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  function toGraphTask(t) {
    const cats = t.categories.map(catToName).concat(t.extraCats || []);
    const body = {
      title: t.title,
      importance: t.important ? 'high' : 'normal',
      status: t.done ? 'completed' : 'notStarted',
      body: { content: t.note || '', contentType: 'text' },
      categories: cats,
      dueDateTime: t.due ? { dateTime: `${t.due}T00:00:00`, timeZone: TZ } : null,
      isReminderOn: !!t.reminder,
      reminderDateTime: t.reminder ? { dateTime: localDateTime(new Date(t.reminder)), timeZone: TZ } : null
    };
    body.recurrence = t.repeat && t.due ? toRecurrence(t.repeat, t.due) : null;
    return body;
  }

  function fromGraphTask(item) {
    const cats = [];
    const extra = [];
    (item.categories || []).forEach((name) => {
      const id = catFromName(name);
      if (id) {
        cats.push(id);
        const learned = (S().msCatNames = S().msCatNames || {});
        if (!learned[id] && CAT_NAMES[id].includes(name)) learned[id] = name;
      } else extra.push(name);
    });
    const due = fromDTZ(item.dueDateTime);
    const rem = item.isReminderOn ? fromDTZ(item.reminderDateTime) : null;
    const doneAt = fromDTZ(item.completedDateTime);
    let note = '';
    if (item.body && item.body.content) note = item.body.contentType === 'html' ? htmlToText(item.body.content) : item.body.content;
    return {
      title: (item.title || '').slice(0, 1000) || '…',
      done: item.status === 'completed',
      doneAt: item.status === 'completed' ? (doneAt ? doneAt.toISOString() : new Date().toISOString()) : null,
      important: item.importance === 'high',
      due: due ? toKey(due) : null,
      reminder: rem ? rem.toISOString() : null,
      repeat: fromRecurrence(item.recurrence),
      note: note.slice(0, 100000),
      categories: [...new Set(cats)],
      extraCats: extra,
      createdAt: item.createdDateTime || new Date().toISOString()
    };
  }

  // a leading emoji in a To Do list name is the list icon
  function splitEmoji(name) {
    const m = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*)\s*(.*)$/u.exec(name || '');
    return m ? { emoji: m[1], name: m[2] || name } : { emoji: '', name: name || '' };
  }
  const joinEmoji = (l) => `${l.emoji ? l.emoji + ' ' : ''}${l.name || ''}`.trim() || 'Klaar';

  // =====================================================================
  //  Microsoft To Do synchronisation
  // =====================================================================
  let syncTimer = null;
  let again = false;

  function canSync() {
    return !!(state.account && S().msSync && clientId() && !state.needLogin);
  }

  function scheduleSync(ms = 4000) {
    if (!canSync()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncNow(), ms);
  }

  async function syncNow() {
    if (!canSync()) return false;
    if (state.syncing) { again = true; return false; }
    state.syncing = true;
    state.error = null;
    Store.syncLinked = true;
    changed();
    let ok = true;
    try {
      await pushDeletes();
      const remoteLists = await allPages('/me/todo/lists');
      await reconcileLists(remoteLists);
      for (const l of Store.data.lists.filter((x) => x.msListId)) await pullTasks(l);
      const touched = await pushTasks();
      // pull once more where we pushed, e.g. to receive the next occurrence of a completed repeating task
      for (const l of Store.data.lists.filter((x) => x.msListId && touched.has(x.msListId))) await pullTasks(l);
      Store.data.sync.lastSync = new Date().toISOString();
    } catch (e) {
      ok = false;
      state.error = e.status === 401 ? 'login' : e.message || String(e);
      console.warn('Sync failed', e);
    } finally {
      state.syncing = false;
      Store.emit('sync');
      changed();
      if (again) { again = false; scheduleSync(1500); }
    }
    return ok;
  }

  async function pushDeletes() {
    const now = Date.now();
    // wait a few seconds so "undo" can still bring a task back
    const due = Store.data.sync.deletes.filter((d) => now - d.at > 8000);
    for (const d of due) {
      const url = d.type === 'list'
        ? `/me/todo/lists/${enc(d.msListId)}`
        : `/me/todo/lists/${enc(d.msListId)}/tasks/${enc(d.msId)}`;
      const r = await graph('DELETE', url);
      if (r.ok || r.status === 404) Store.data.sync.deletes = Store.data.sync.deletes.filter((x) => x !== d);
      else if (r.status === 401) throw Object.assign(new Error('login'), { status: 401 });
    }
  }

  async function reconcileLists(remote) {
    const lists = Store.data.lists;
    const seen = new Set();
    const pendingLists = new Set(Store.data.sync.deletes.filter((d) => d.type === 'list').map((d) => d.msListId));
    for (const r of remote) {
      seen.add(r.id);
      if (pendingLists.has(r.id)) continue; // deleted here, waiting to be deleted there
      const wk = r.wellknownListName && r.wellknownListName !== 'none' ? r.wellknownListName : null;
      let l = lists.find((x) => x.msListId === r.id);
      if (!l && wk === 'defaultList') {
        l = Store.list('inbox');
        if (l.msListId && l.msListId !== r.id) l = null;
      }
      const parts = splitEmoji(r.displayName);
      if (!l) {
        // link a local list with the same name instead of creating a duplicate
        l = lists.find((x) => !x.msListId && x.id !== 'inbox' && (x.name || '').toLowerCase() === parts.name.toLowerCase());
        if (l) {
          if (!l.emoji) l.emoji = parts.emoji;
          l.dirty = !!(parts.emoji !== l.emoji);
        }
      }
      if (!l) {
        l = {
          id: uid(),
          name: wk === 'flaggedEmails' ? null : parts.name,
          emoji: wk === 'flaggedEmails' ? '🚩' : parts.emoji,
          theme: 'blue',
          groupId: null,
          order: Math.max(0, ...lists.map((x) => x.order)) + 1,
          sort: null,
          showCompleted: true,
          createdAt: new Date().toISOString(),
          dirty: false,
          updatedAt: null
        };
        lists.push(l);
      } else if (!l.dirty && l.id !== 'inbox' && wk !== 'flaggedEmails') {
        l.name = parts.name;
        l.emoji = parts.emoji;
      }
      l.msListId = r.id;
      l.wellKnown = wk;
      if (wk === 'flaggedEmails' && !l.name) l.name = S().lang === 'nl' ? 'Gemarkeerde e-mail' : 'Flagged email';
    }
    // lists removed in Microsoft To Do
    for (const l of lists.filter((x) => x.msListId && !seen.has(x.msListId))) {
      delete Store.data.sync.tasksDelta[l.msListId];
      if (l.id === 'inbox') {
        l.msListId = null;
        continue;
      }
      Store.data.tasks = Store.data.tasks.filter((t) => t.listId !== l.id);
      Store.data.lists = Store.data.lists.filter((x) => x !== l);
    }
    // new local lists → create in To Do; renamed lists → rename
    for (const l of Store.data.lists) {
      if (l.id === 'inbox') continue;
      const stamp = l.updatedAt;
      if (!l.msListId) {
        const res = await g('POST', '/me/todo/lists', { displayName: joinEmoji(l) });
        l.msListId = res.id;
        l.dirty = l.updatedAt !== stamp;
      } else if (l.dirty && !l.wellKnown) {
        await g('PATCH', `/me/todo/lists/${enc(l.msListId)}`, { displayName: joinEmoji(l) });
        l.dirty = l.updatedAt !== stamp;
      }
    }
  }

  async function pullTasks(l) {
    const base = `/me/todo/lists/${enc(l.msListId)}/tasks/delta`;
    let url = Store.data.sync.tasksDelta[l.msListId] || base;
    let full = url === base;
    const items = [];
    const removed = [];
    while (url) {
      const r = await graph('GET', url);
      if (!r.ok && (r.status === 410 || (r.status === 400 && url !== base))) {
        // delta token expired → start over with a full pull
        url = base;
        full = true;
        items.length = 0;
        removed.length = 0;
        continue;
      }
      if (!r.ok) throw Object.assign(new Error((r.data && r.data.error && r.data.error.message) || `HTTP ${r.status}`), { status: r.status });
      for (const v of r.data.value || []) (v['@removed'] ? removed : items).push(v);
      url = r.data['@odata.nextLink'];
      if (!url && r.data['@odata.deltaLink']) Store.data.sync.tasksDelta[l.msListId] = r.data['@odata.deltaLink'];
    }

    const tasks = Store.data.tasks;
    const removeIds = new Set(removed.map((v) => v.id));
    if (full) {
      // anything we linked earlier that the server no longer has was deleted remotely
      const present = new Set(items.map((v) => v.id));
      tasks.filter((t) => t.listId === l.id && t.msId && t.msListId === l.msListId && !present.has(t.msId))
        .forEach((t) => removeIds.add(t.msId));
    }
    if (removeIds.size) {
      Store.data.tasks = tasks.filter((t) => !(t.msId && removeIds.has(t.msId) && t.msListId === l.msListId));
    }

    const pendingTasks = new Set(Store.data.sync.deletes.filter((d) => d.type === 'task').map((d) => d.msId));
    const needDetails = [];
    for (const item of items) {
      if (pendingTasks.has(item.id)) continue;
      let t = Store.data.tasks.find((x) => x.msId === item.id);
      const remoteTime = Date.parse(item.lastModifiedDateTime || 0);
      if (t && t.dirty && Date.parse(t.updatedAt) > remoteTime) continue; // our version is newer
      const fields = fromGraphTask(item);
      if (!t) {
        // first sync: link an identical local task instead of duplicating it
        t = Store.data.tasks.find((x) => !x.msId && x.listId === l.id && x.title === fields.title && !x.done);
      }
      if (t) {
        Object.assign(t, fields);
      } else {
        t = {
          id: uid(),
          myDay: null,
          reminded: fields.reminder ? Date.parse(fields.reminder) < Date.now() : false,
          steps: [],
          links: [],
          event: null,
          order: Math.max(0, ...Store.data.tasks.filter((x) => x.listId === l.id).map((x) => x.order || 0)) + 1,
          ...fields
        };
        Store.data.tasks.push(t);
      }
      t.listId = l.id;
      t.msId = item.id;
      t.msListId = l.msListId;
      t.dirty = false;
      t.updatedAt = item.lastModifiedDateTime || new Date().toISOString();
      if (item.checklistItems) applySteps(t, item.checklistItems);
      else needDetails.push(t);
    }

    if (!needDetails.length) return;
    const wantLinks = l.wellKnown === 'flaggedEmails';
    if (needDetails.length > 15) {
      const expand = wantLinks ? 'checklistItems,linkedResources' : 'checklistItems';
      const all = await allPages(`/me/todo/lists/${enc(l.msListId)}/tasks?$expand=${expand}&$top=100`);
      const byId = new Map(all.map((x) => [x.id, x]));
      needDetails.forEach((t) => {
        const x = byId.get(t.msId);
        if (!x) return;
        applySteps(t, x.checklistItems || []);
        if (wantLinks) applyLinks(t, x.linkedResources || []);
      });
    } else {
      for (const t of needDetails) {
        const base2 = `/me/todo/lists/${enc(l.msListId)}/tasks/${enc(t.msId)}`;
        const steps = await g('GET', `${base2}/checklistItems`).catch(() => null);
        if (steps) applySteps(t, steps.value || []);
        if (wantLinks) {
          const links = await g('GET', `${base2}/linkedResources`).catch(() => null);
          if (links) applyLinks(t, links.value || []);
        }
      }
    }
  }

  function applySteps(t, remoteItems) {
    const old = new Map((t.steps || []).filter((s) => s.msId).map((s) => [s.msId, s]));
    t.steps = remoteItems.map((ri) => ({
      id: (old.get(ri.id) || {}).id || uid(),
      msId: ri.id,
      title: (ri.displayName || '').slice(0, 1000) || '…',
      done: !!ri.isChecked
    }));
  }

  function applyLinks(t, resources) {
    t.links = resources
      .filter((r) => typeof r.webUrl === 'string' && /^https:\/\//i.test(r.webUrl))
      .map((r) => ({ url: r.webUrl, title: r.displayName || r.applicationName || 'Outlook' }));
  }

  async function pushTasks() {
    const touched = new Set();
    const todo = Store.data.tasks.filter((t) => t.dirty || !t.msId);
    for (const t of todo) {
      const l = Store.list(t.listId);
      if (!l || !l.msListId) continue;
      if (l.wellKnown === 'flaggedEmails' && !t.msId) continue; // To Do does not allow new tasks there
      const stamp = t.updatedAt;
      try {
        if (t.msId && t.msListId && t.msListId !== l.msListId) {
          // moved to another list: To Do has no "move", so recreate it there
          await graph('DELETE', `/me/todo/lists/${enc(t.msListId)}/tasks/${enc(t.msId)}`);
          t.msId = null;
          (t.steps || []).forEach((s) => { s.msId = null; });
        }
        const body = toGraphTask(t);
        if (t.msId) {
          const r = await graph('PATCH', `/me/todo/lists/${enc(l.msListId)}/tasks/${enc(t.msId)}`, body);
          if (r.status === 404) t.msId = null;
          else if (!r.ok) throw Object.assign(new Error((r.data && r.data.error && r.data.error.message) || `HTTP ${r.status}`), { status: r.status });
        }
        if (!t.msId) {
          const res = await g('POST', `/me/todo/lists/${enc(l.msListId)}/tasks`, body);
          t.msId = res.id;
          (t.steps || []).forEach((s) => { s.msId = null; });
        }
        t.msListId = l.msListId;
        touched.add(l.msListId);
        await pushSteps(t, l);
        t.dirty = t.updatedAt !== stamp;
        t.syncError = null;
      } catch (e) {
        if (e.status === 401) throw e;
        t.syncError = e.message;
        console.warn('Task sync failed', t.title, e);
      }
    }
    return touched;
  }

  async function pushSteps(t, l) {
    const base = `/me/todo/lists/${enc(l.msListId)}/tasks/${enc(t.msId)}/checklistItems`;
    const remote = (await g('GET', base)).value || [];
    const byId = new Map(remote.map((r) => [r.id, r]));
    for (const s of t.steps || []) {
      const r = s.msId && byId.get(s.msId);
      if (r) {
        byId.delete(s.msId);
        if (r.displayName !== s.title || !!r.isChecked !== !!s.done) {
          await g('PATCH', `${base}/${enc(s.msId)}`, { displayName: s.title, isChecked: !!s.done });
        }
      } else {
        const res = await g('POST', base, { displayName: s.title, isChecked: !!s.done });
        s.msId = res.id;
      }
    }
    for (const id of byId.keys()) await graph('DELETE', `${base}/${enc(id)}`);
  }

  // =====================================================================
  //  Outlook calendar
  // =====================================================================
  async function loadCalendar() {
    if (!state.account || !S().msCalendar) { state.calendar = null; changed(); return; }
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    try {
      const d = await g('GET', `/me/calendarView?startDateTime=${enc(start.toISOString())}&endDateTime=${enc(end.toISOString())}`
        + '&$orderby=start/dateTime&$top=50&$select=subject,start,end,isAllDay,location,webLink,isCancelled,showAs');
      state.calendar = (d.value || [])
        .filter((e) => !e.isCancelled)
        .map((e) => ({
          id: e.id,
          title: e.subject || '(zonder onderwerp)',
          start: fromDTZ(e.start),
          end: fromDTZ(e.end),
          allDay: !!e.isAllDay,
          location: e.location && e.location.displayName,
          link: typeof e.webLink === 'string' && /^https:\/\//.test(e.webLink) ? e.webLink : null,
          free: e.showAs === 'free'
        }));
    } catch (e) {
      state.calendar = null;
    }
    changed();
  }

  async function scheduleEvent(task, { date, time, minutes }) {
    const [h, m] = time.split(':').map(Number);
    const start = new Date(`${date}T00:00:00`);
    start.setHours(h, m, 0, 0);
    const end = new Date(start.getTime() + minutes * 60000);
    const res = await g('POST', '/me/events', {
      subject: task.title,
      body: { contentType: 'text', content: (task.note ? task.note + '\n\n' : '') + '— Ingepland vanuit Klaar' },
      start: { dateTime: localDateTime(start), timeZone: TZ },
      end: { dateTime: localDateTime(end), timeZone: TZ },
      isReminderOn: true,
      reminderMinutesBeforeStart: 15,
      categories: task.categories.map(catToName)
    });
    Store.updateTask(task.id, { event: { id: res.id, start: start.toISOString(), link: /^https:\/\//.test(res.webLink || '') ? res.webLink : null } });
    if (date === todayKey()) loadCalendar();
    return res;
  }

  async function removeEvent(task) {
    if (task.event) await graph('DELETE', `/me/events/${enc(task.event.id)}`);
    Store.updateTask(task.id, { event: null });
    loadCalendar();
  }

  // =====================================================================
  //  OneDrive backup (app folder, only Klaar can see it)
  // =====================================================================
  async function cloudBackup() {
    await g('PUT', `${BACKUP_PATH}:/content`, Store.exportJSON());
    S().lastCloudBackup = new Date().toISOString();
    Store.save();
    changed();
  }

  async function cloudBackupInfo() {
    const r = await graph('GET', `${BACKUP_PATH}?$select=lastModifiedDateTime,size`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.data;
  }

  async function cloudRestore() {
    let text;
    if (nativeMs) {
      text = await g('GET', `${BACKUP_PATH}:/content`);
    } else {
      // browsers cannot follow the /content redirect with a token; use the pre-signed URL
      const meta = await g('GET', `${BACKUP_PATH}?$select=id,@microsoft.graph.downloadUrl`);
      const url = meta['@microsoft.graph.downloadUrl'];
      text = await (await fetch(url)).text();
    }
    Store.importJSON(typeof text === 'string' ? text : JSON.stringify(text));
  }

  async function autoBackup() {
    if (!state.account || !S().msOneDrive) return;
    const last = S().lastCloudBackup ? Date.parse(S().lastCloudBackup) : 0;
    if (Date.now() - last < 20 * 3600 * 1000) return;
    try { await cloudBackup(); } catch (e) { console.warn('OneDrive backup failed', e); }
  }

  // =====================================================================
  //  Planner ("Assigned to me", work/school accounts)
  // =====================================================================
  async function loadPlanner() {
    if (!state.account || state.account.personal || !S().msPlanner) { state.planner = null; changed(); return; }
    try {
      const items = await allPages('/me/planner/tasks?$top=100');
      state.planner = items
        .filter((x) => x.percentComplete < 100)
        .map((x) => {
          const due = x.dueDateTime ? new Date(x.dueDateTime) : null;
          return { id: x.id, title: x.title, planId: x.planId, due: due ? toKey(due) : null, etag: x['@odata.etag'], progress: x.percentComplete, priority: x.priority };
        });
      const planIds = [...new Set(state.planner.map((x) => x.planId))].filter((id) => !state.plans[id]);
      for (const id of planIds) {
        const p = await g('GET', `/planner/plans/${enc(id)}?$select=title`).catch(() => null);
        state.plans[id] = (p && p.title) || 'Planner';
      }
    } catch {
      state.planner = null;
    }
    changed();
  }

  async function completePlanner(item) {
    await g('PATCH', `/planner/tasks/${enc(item.id)}`, { percentComplete: 100 }, { 'If-Match': item.etag });
    state.planner = (state.planner || []).filter((x) => x.id !== item.id);
    changed();
  }

  // =====================================================================
  //  Lifecycle
  // =====================================================================
  let started = false;
  function afterSignIn() {
    if (!state.account) return;
    Store.syncLinked = !!S().msSync;
    syncNow();
    loadCalendar();
    loadPlanner();
    autoBackup();
  }

  async function init() {
    await webHandleRedirect();
    await refreshStatus();
    if (started) return;
    started = true;
    Store.onLocalChange(() => scheduleSync());
    setInterval(() => { if (canSync()) syncNow(); }, 2 * 60 * 1000);
    setInterval(() => { loadCalendar(); loadPlanner(); autoBackup(); }, 10 * 60 * 1000);
    let lastFocus = 0;
    window.addEventListener('focus', () => {
      if (Date.now() - lastFocus < 30000) return;
      lastFocus = Date.now();
      if (canSync()) syncNow();
      loadCalendar();
    });
    window.addEventListener('online', () => { if (canSync()) syncNow(); });
    if (state.account) afterSignIn();
  }

  window.MS = {
    state,
    supported,
    clientId,
    init,
    login,
    logout,
    refreshStatus,
    onChange: (fn) => listeners.push(fn),
    syncNow,
    scheduleSync,
    loadCalendar,
    scheduleEvent,
    removeEvent,
    cloudBackup,
    cloudBackupInfo,
    cloudRestore,
    loadPlanner,
    completePlanner,
    // exposed for tests
    _map: { toGraphTask, fromGraphTask, toRecurrence, fromRecurrence, splitEmoji, fromDTZ },
    _graph: graph
  };
})();
