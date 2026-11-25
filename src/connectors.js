// Klaar — "Koppelingen": pulls tasks from any system that offers a Klaar-feed
// (for example Zijlstra CRM via klaar-api.php) and writes changes back.
// Feed format: see docs/KOPPELINGEN.md.
(function () {
  const { Store, todayKey, uid } = window.Klaar;
  const S = () => Store.data.settings;
  const state = { syncing: {}, listeners: [] };
  const changed = () => state.listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

  const feeds = () => (S().feeds = Array.isArray(S().feeds) ? S().feeds : []);
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const isDateKey = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const isIso = (v) => typeof v === 'string' && !isNaN(Date.parse(v));

  function validUrl(u) {
    try {
      const x = new URL(u);
      if (x.protocol === 'https:') return true;
      // plain http only for testing on this computer
      return x.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(x.hostname);
    } catch {
      return false;
    }
  }

  function cleanItem(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
    return {
      id: raw.id.slice(0, 200),
      title: str(raw.title, 1000) || '…',
      note: str(raw.note, 20000),
      due: isDateKey(raw.due) ? raw.due : null,
      reminder: isIso(raw.reminder) ? new Date(raw.reminder).toISOString() : null,
      important: !!raw.important,
      done: !!raw.done,
      steps: (Array.isArray(raw.steps) ? raw.steps : [])
        .filter((s) => s && typeof s.key === 'string' && typeof s.title === 'string')
        .slice(0, 30)
        .map((s) => ({ key: s.key.slice(0, 100), title: s.title.slice(0, 300), done: !!s.done })),
      url: typeof raw.url === 'string' && /^https?:\/\//i.test(raw.url) ? raw.url.slice(0, 2000) : null
    };
  }

  // what the feed said last time vs. what the task looks like now
  const snapFromItem = (item) => ({ done: item.done, steps: Object.fromEntries(item.steps.map((s) => [s.key, s.done])) });
  function snapFromTask(t, item) {
    const steps = {};
    item.steps.forEach((s) => {
      const local = (t.steps || []).find((x) => x.title === s.title);
      steps[s.key] = local ? !!local.done : s.done;
    });
    return { done: !!t.done, steps };
  }
  const sameSnap = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  async function request(feed, method, body) {
    const headers = { Authorization: `Bearer ${feed.token}`, 'X-Klaar-Token': feed.token, Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(feed.url, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    } catch {
      throw new Error('offline');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
    return data;
  }

  function ensureList(feed, info) {
    let list = feed.listId && Store.list(feed.listId);
    if (!list) {
      const name = str(info && info.name, 100) || feed.name || 'Koppeling';
      list = Store.addList(name);
      list.emoji = str(info && info.emoji, 8);
      feed.listId = list.id;
    }
    return list;
  }

  async function syncFeed(feed) {
    if (state.syncing[feed.id]) return;
    state.syncing[feed.id] = true;
    changed();
    try {
      const data = await request(feed, 'GET');
      if (!data || !Array.isArray(data.items)) throw new Error('Geen geldige Klaar-feed');
      if (!feed.name && data.name) feed.name = str(data.name, 100);
      const list = ensureList(feed, data.list);
      const today = todayKey();
      const seen = new Set();
      let pushed = 0;

      for (const raw of data.items.slice(0, 2000)) {
        let item = cleanItem(raw);
        if (!item) continue;
        seen.add(item.id);
        let t = Store.data.tasks.find((x) => x.ext && x.ext.feed === feed.id && x.ext.id === item.id);

        if (!t) {
          if (item.done) continue; // nothing to do for things that are already finished
          t = Store.addTask({
            title: item.title,
            note: item.note,
            due: item.due,
            reminder: item.reminder && Date.parse(item.reminder) > Date.now() ? item.reminder : null,
            important: item.important,
            listId: list.id,
            steps: item.steps.map((s) => ({ id: uid(), title: s.title, done: s.done })),
            myDay: feed.myDayToday && item.due === today ? today : null,
            ext: { feed: feed.id, id: item.id, url: item.url, snap: snapFromItem(item) }
          });
          continue;
        }

        // changed here (or on the phone via Microsoft To Do) since the last sync → send it back
        const local = snapFromTask(t, item);
        if (data.canUpdate && !sameSnap(local, t.ext.snap)) {
          try {
            const r = await request(feed, 'POST', { id: item.id, done: local.done, steps: Object.entries(local.steps).map(([key, done]) => ({ key, done })) });
            const back = cleanItem(r && r.item);
            if (back) item = back;
            pushed++;
          } catch (e) {
            console.warn('Feed update failed', item.id, e);
            continue; // keep the local change, try again next time
          }
        }

        // apply what the feed says now
        const patch = {};
        if (t.title !== item.title) patch.title = item.title;
        if ((t.note || '') !== item.note) patch.note = item.note;
        if (t.due !== item.due) patch.due = item.due;
        if (t.important !== item.important) patch.important = item.important;
        if (item.reminder !== (t.ext.reminder || null)) {
          patch.reminder = item.reminder && Date.parse(item.reminder) > Date.now() ? item.reminder : t.reminder;
          t.ext.reminder = item.reminder;
        }
        if (t.done !== item.done) {
          patch.done = item.done;
          patch.doneAt = item.done ? new Date().toISOString() : null;
        }
        const steps = mergeSteps(t.steps || [], item.steps);
        if (JSON.stringify(steps.map((s) => [s.title, s.done])) !== JSON.stringify((t.steps || []).map((s) => [s.title, s.done]))) patch.steps = steps;
        if (feed.myDayToday && item.due === today && !item.done && t.myDay !== today) patch.myDay = today;
        if (t.listId !== list.id && !Store.list(t.listId)) patch.listId = list.id;
        t.ext.snap = snapFromItem(item);
        t.ext.url = item.url;
        if (Object.keys(patch).length) Store.updateTask(t.id, patch, true);
      }

      // gone from the feed while still open → removed or cancelled at the source
      Store.data.tasks
        .filter((x) => x.ext && x.ext.feed === feed.id && !seen.has(x.ext.id) && !x.done)
        .forEach((x) => {
          if (x.msId && x.msListId) Store.queueDelete({ type: 'task', msListId: x.msListId, msId: x.msId });
          Store.data.tasks = Store.data.tasks.filter((y) => y !== x);
        });

      feed.lastSync = new Date().toISOString();
      feed.error = null;
      feed.count = seen.size;
      if (pushed) feed.lastPush = new Date().toISOString();
    } catch (e) {
      feed.error = e.message === 'offline' ? 'Niet bereikbaar' : e.message;
    } finally {
      state.syncing[feed.id] = false;
      Store.emit('feed');
      changed();
    }
  }

  function mergeSteps(localSteps, itemSteps) {
    const out = itemSteps.map((s) => {
      const existing = localSteps.find((x) => x.title === s.title);
      return existing ? { ...existing, done: s.done } : { id: uid(), title: s.title, done: s.done };
    });
    // keep steps the user added in Klaar
    localSteps.forEach((x) => { if (!itemSteps.some((s) => s.title === x.title)) out.push(x); });
    return out;
  }

  async function syncAll() {
    for (const f of feeds()) await syncFeed(f);
  }

  async function test(url, token) {
    if (!validUrl(url)) throw new Error('url');
    const data = await request({ url, token }, 'GET');
    if (!data || !Array.isArray(data.items)) throw new Error('Geen geldige Klaar-feed');
    return { name: data.name || '', list: data.list || null, open: data.items.filter((x) => x && !x.done).length };
  }

  function add({ name, url, token, myDayToday }) {
    if (!validUrl(url)) throw new Error('url');
    const f = { id: uid(), name: str(name, 100), url, token: str(token, 500), myDayToday: myDayToday !== false, listId: null, lastSync: null, error: null };
    feeds().push(f);
    Store.save();
    syncFeed(f);
    return f;
  }

  function remove(id, removeTasks) {
    const f = feeds().find((x) => x.id === id);
    S().feeds = feeds().filter((x) => x.id !== id);
    Store.data.tasks.forEach((t) => { if (t.ext && t.ext.feed === id) delete t.ext; });
    if (removeTasks && f && f.listId) Store.deleteList(f.listId);
    Store.emit('settings');
    changed();
  }

  const feedOf = (task) => task && task.ext && feeds().find((f) => f.id === task.ext.feed);

  let timer = null;
  function init() {
    Store.onLocalChange(() => {
      if (!feeds().length) return;
      clearTimeout(timer);
      timer = setTimeout(syncAll, 5000);
    });
    // Microsoft To Do sync can bring in changes made on the phone: pass them on
    Store.subscribe((what) => {
      if (what !== 'sync' || !feeds().length || Object.values(state.syncing).some(Boolean)) return;
      clearTimeout(timer);
      timer = setTimeout(syncAll, 3000);
    });
    setInterval(syncAll, 2 * 60 * 1000);
    window.addEventListener('focus', () => { clearTimeout(timer); timer = setTimeout(syncAll, 1000); });
    if (feeds().length) setTimeout(syncAll, 1500);
  }

  window.Connectors = { state, feeds, add, remove, test, syncFeed, syncAll, feedOf, validUrl, init, onChange: (fn) => state.listeners.push(fn) };
})();
