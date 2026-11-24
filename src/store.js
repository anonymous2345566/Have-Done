// Klaar — data model, persistence and date logic.
(function () {
  const LS_KEY = 'klaar-data-v1';
  const native = window.klaarNative || null;

  // ---------- helpers ----------
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const pad = (n) => String(n).padStart(2, '0');
  const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromKey = (k) => {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const todayKey = () => toKey(new Date());
  const addDays = (k, n) => {
    const d = fromKey(k);
    d.setDate(d.getDate() + n);
    return toKey(d);
  };
  const addMonths = (k, n) => {
    const d = fromKey(k);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return toKey(d);
  };
  const diffDays = (a, b) => Math.round((fromKey(a) - fromKey(b)) / 86400000);

  const THEMES = ['blue', 'purple', 'pink', 'red', 'orange', 'green', 'teal', 'gray'];
  const CATEGORIES = [
    { id: 'blue', color: '#3a7bd5' },
    { id: 'green', color: '#2e9e5b' },
    { id: 'orange', color: '#e07b1a' },
    { id: 'purple', color: '#8a52d4' },
    { id: 'red', color: '#d64545' },
    { id: 'yellow', color: '#d1a400' }
  ];

  function defaultData() {
    const now = new Date().toISOString();
    return {
      version: 1,
      settings: {
        theme: 'system',
        lang: (navigator.language || 'nl').toLowerCase().startsWith('nl') ? 'nl' : 'en',
        confirmDelete: true,
        playSound: true,
        newOnTop: false,
        moveStarredToTop: true,
        smartLists: { important: true, planned: true, all: true, completed: true },
        lastDay: todayKey(),
        sidebarOpen: true,
        categoryNames: {}
      },
      smart: {
        myday: { theme: 'blue', sort: null, showCompleted: true },
        important: { theme: 'pink', sort: null, showCompleted: true },
        planned: { theme: 'teal', sort: null, showCompleted: true },
        all: { theme: 'gray', sort: null, showCompleted: true },
        completed: { theme: 'green', sort: null, showCompleted: true },
        search: { theme: 'gray', sort: null, showCompleted: true }
      },
      groups: [],
      lists: [
        { id: 'inbox', name: null, emoji: '', theme: 'blue', groupId: null, order: 0, sort: null, showCompleted: true, createdAt: now }
      ],
      tasks: []
    };
  }

  function normalize(d) {
    const base = defaultData();
    if (!d || typeof d !== 'object') return base;
    d.settings = Object.assign({}, base.settings, d.settings || {});
    d.settings.smartLists = Object.assign({}, base.settings.smartLists, d.settings.smartLists || {});
    d.smart = Object.assign({}, base.smart, d.smart || {});
    d.groups = Array.isArray(d.groups) ? d.groups : [];
    d.lists = Array.isArray(d.lists) ? d.lists : base.lists;
    if (!d.lists.find((l) => l.id === 'inbox')) d.lists.unshift(base.lists[0]);
    d.tasks = Array.isArray(d.tasks) ? d.tasks : [];
    const str = (v, max = 5000) => (typeof v === 'string' ? v.slice(0, max) : '');
    const dateKey = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const iso = (v) => (typeof v === 'string' && !isNaN(Date.parse(v)) ? v : null);
    const catIds = CATEGORIES.map((c) => c.id);
    const okTheme = (v) => (THEMES.includes(v) ? v : 'blue');
    const okSort = (v) => (v && typeof v === 'object' && ['importance', 'due', 'alpha', 'created', 'myday'].includes(v.by)
      ? { by: v.by, dir: v.dir === 'desc' ? 'desc' : 'asc' } : null);

    d.groups = d.groups.filter((g) => g && typeof g === 'object' && typeof g.id === 'string')
      .map((g) => ({ id: g.id, name: str(g.name, 200) || '…', collapsed: !!g.collapsed }));
    d.lists = d.lists.filter((l) => l && typeof l === 'object' && typeof l.id === 'string').map((l, i) => ({
      id: l.id,
      name: l.id === 'inbox' ? null : str(l.name, 200),
      emoji: str(l.emoji, 8),
      theme: okTheme(l.theme),
      groupId: typeof l.groupId === 'string' ? l.groupId : null,
      order: Number.isFinite(l.order) ? l.order : i,
      sort: okSort(l.sort),
      showCompleted: l.showCompleted !== false,
      createdAt: iso(l.createdAt) || new Date().toISOString()
    }));
    if (!d.lists.find((l) => l.id === 'inbox')) d.lists.unshift(base.lists[0]);
    Object.keys(base.smart).forEach((k) => {
      const v = d.smart[k] && typeof d.smart[k] === 'object' ? d.smart[k] : base.smart[k];
      d.smart[k] = { theme: THEMES.includes(v.theme) ? v.theme : base.smart[k].theme, sort: okSort(v.sort), showCompleted: v.showCompleted !== false };
    });
    d.tasks = d.tasks.filter((t) => t && typeof t === 'object' && typeof t.id === 'string').map((t, i) => {
      const rep = t.repeat && typeof t.repeat === 'object' && ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'].includes(t.repeat.freq)
        ? {
            freq: t.repeat.freq,
            interval: Math.min(99, Math.max(1, parseInt(t.repeat.interval, 10) || 1)),
            days: Array.isArray(t.repeat.days) ? t.repeat.days.filter((x) => Number.isInteger(x) && x >= 0 && x <= 6) : undefined
          }
        : null;
      return {
        id: t.id,
        listId: d.lists.find((l) => l.id === t.listId) ? t.listId : 'inbox',
        title: str(t.title, 1000) || '…',
        done: !!t.done,
        doneAt: iso(t.doneAt),
        important: !!t.important,
        myDay: dateKey(t.myDay),
        lastMyDay: dateKey(t.lastMyDay),
        due: dateKey(t.due),
        reminder: iso(t.reminder),
        reminded: !!t.reminded,
        repeat: rep,
        steps: (Array.isArray(t.steps) ? t.steps : [])
          .filter((s) => s && typeof s === 'object')
          .map((s) => ({ id: typeof s.id === 'string' ? s.id : uid(), title: str(s.title, 1000) || '…', done: !!s.done })),
        note: str(t.note, 100000),
        categories: (Array.isArray(t.categories) ? t.categories : []).filter((c) => catIds.includes(c)),
        createdAt: iso(t.createdAt) || new Date().toISOString(),
        order: Number.isFinite(t.order) ? t.order : i
      };
    });
    const s = d.settings;
    if (!['system', 'light', 'dark'].includes(s.theme)) s.theme = 'system';
    if (!['nl', 'en'].includes(s.lang)) s.lang = 'nl';
    s.categoryNames = s.categoryNames && typeof s.categoryNames === 'object' ? Object.fromEntries(
      Object.entries(s.categoryNames).filter(([k, v]) => catIds.includes(k) && typeof v === 'string').map(([k, v]) => [k, v.slice(0, 100)])) : {};
    return d;
  }

  // ---------- store ----------
  const Store = {
    data: defaultData(),
    listeners: [],
    saveTimer: null,
    undoStack: [],

    async load() {
      let raw = null;
      try {
        if (native) raw = await native.load();
        else raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      } catch (e) {
        console.error('Load failed', e);
      }
      this.data = normalize(raw);
      this.rollDay();
    },

    save() {
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.flush(), 250);
    },

    flush() {
      clearTimeout(this.saveTimer);
      const snapshot = JSON.parse(JSON.stringify(this.data));
      try {
        if (native) native.save(snapshot);
        else localStorage.setItem(LS_KEY, JSON.stringify(snapshot));
      } catch (e) {
        console.error('Save failed', e);
      }
    },

    subscribe(fn) { this.listeners.push(fn); },
    emit(what) {
      this.save();
      this.listeners.forEach((fn) => fn(what));
    },

    snapshot() {
      this.undoStack.push(JSON.stringify(this.data));
      if (this.undoStack.length > 20) this.undoStack.shift();
    },
    undo() {
      const s = this.undoStack.pop();
      if (!s) return false;
      this.data = normalize(JSON.parse(s));
      this.emit('all');
      return true;
    },

    // My Day resets every day: unfinished tasks drop out of My Day
    rollDay() {
      const today = todayKey();
      if (this.data.settings.lastDay !== today) {
        this.data.tasks.forEach((t) => {
          if (t.myDay && t.myDay !== today) {
            if (!t.done) t.lastMyDay = t.myDay;
            t.myDay = null;
          }
        });
        this.data.settings.lastDay = today;
        this.save();
        return true;
      }
      return false;
    },

    // ----- lists -----
    list(id) { return this.data.lists.find((l) => l.id === id); },
    sortedLists() { return [...this.data.lists].sort((a, b) => a.order - b.order); },
    addList(name, groupId = null) {
      const order = Math.max(0, ...this.data.lists.map((l) => l.order)) + 1;
      const theme = THEMES[this.data.lists.length % THEMES.length];
      const l = { id: uid(), name, emoji: '', theme, groupId, order, sort: null, showCompleted: true, createdAt: new Date().toISOString() };
      this.data.lists.push(l);
      this.emit('lists');
      return l;
    },
    updateList(id, patch) {
      const l = this.list(id);
      if (!l) return;
      Object.assign(l, patch);
      this.emit('lists');
    },
    deleteList(id) {
      if (id === 'inbox') return;
      this.snapshot();
      this.data.lists = this.data.lists.filter((l) => l.id !== id);
      this.data.tasks = this.data.tasks.filter((t) => t.listId !== id);
      this.emit('all');
    },
    duplicateList(id, suffix) {
      const src = this.list(id);
      if (!src) return null;
      const copy = this.addList(`${src.name || ''} ${suffix}`.trim(), src.groupId);
      Object.assign(copy, { emoji: src.emoji, theme: src.theme });
      this.data.tasks
        .filter((t) => t.listId === id)
        .forEach((t) => {
          this.data.tasks.push({
            ...JSON.parse(JSON.stringify(t)),
            id: uid(),
            listId: copy.id,
            createdAt: new Date().toISOString()
          });
        });
      this.emit('all');
      return copy;
    },
    reorderList(id, beforeId, groupId) {
      const lists = this.sortedLists().filter((l) => l.id !== id);
      const moving = this.list(id);
      if (!moving) return;
      moving.groupId = groupId === undefined ? moving.groupId : groupId;
      let idx = beforeId ? lists.findIndex((l) => l.id === beforeId) : lists.length;
      if (idx < 0) idx = lists.length;
      lists.splice(idx, 0, moving);
      lists.forEach((l, i) => (l.order = i));
      this.emit('lists');
    },

    // ----- groups -----
    addGroup(name) {
      const g = { id: uid(), name, collapsed: false };
      this.data.groups.push(g);
      this.emit('lists');
      return g;
    },
    updateGroup(id, patch) {
      const g = this.data.groups.find((x) => x.id === id);
      if (g) Object.assign(g, patch);
      this.emit('lists');
    },
    ungroup(id) {
      this.data.lists.forEach((l) => { if (l.groupId === id) l.groupId = null; });
      this.data.groups = this.data.groups.filter((g) => g.id !== id);
      this.emit('lists');
    },

    // ----- tasks -----
    task(id) { return this.data.tasks.find((t) => t.id === id); },
    addTask(fields) {
      const listTasks = this.data.tasks.filter((t) => t.listId === (fields.listId || 'inbox'));
      const orders = listTasks.map((t) => t.order || 0);
      const top = this.data.settings.newOnTop;
      const t = {
        id: uid(),
        listId: 'inbox',
        title: '',
        done: false,
        doneAt: null,
        important: false,
        myDay: null,
        due: null,
        reminder: null,
        reminded: false,
        repeat: null,
        steps: [],
        note: '',
        categories: [],
        createdAt: new Date().toISOString(),
        order: top ? Math.min(0, ...orders) - 1 : Math.max(0, ...orders) + 1,
        ...fields
      };
      if (t.repeat && !t.due) t.due = todayKey();
      this.data.tasks.push(t);
      this.emit('tasks');
      return t;
    },
    updateTask(id, patch, silent = false) {
      const t = this.task(id);
      if (!t) return;
      if ('reminder' in patch && patch.reminder !== t.reminder) patch.reminded = false;
      Object.assign(t, patch);
      if (t.repeat && !t.due) t.due = todayKey();
      if (silent) this.save();
      else this.emit('tasks');
    },
    deleteTask(id) {
      this.snapshot();
      this.data.tasks = this.data.tasks.filter((t) => t.id !== id);
      this.emit('tasks');
    },
    toggleDone(id) {
      const t = this.task(id);
      if (!t) return null;
      let spawned = null;
      if (!t.done) {
        t.done = true;
        t.doneAt = new Date().toISOString();
        if (t.repeat) spawned = this.spawnRepeat(t);
      } else {
        t.done = false;
        t.doneAt = null;
      }
      this.emit('tasks');
      return spawned;
    },
    spawnRepeat(t) {
      const base = t.due || todayKey();
      const next = nextOccurrence(base, t.repeat);
      let reminder = null;
      if (t.reminder) {
        const r = new Date(t.reminder);
        r.setDate(r.getDate() + diffDays(next, base));
        reminder = r.toISOString();
      }
      const copy = {
        ...JSON.parse(JSON.stringify(t)),
        id: uid(),
        done: false,
        doneAt: null,
        due: next,
        reminder,
        reminded: false,
        myDay: null,
        steps: t.steps.map((s) => ({ ...s, id: uid(), done: false })),
        createdAt: new Date().toISOString()
      };
      // the finished occurrence no longer repeats; the new one carries it on
      t.repeat = null;
      this.data.tasks.push(copy);
      return copy;
    },
    reorderTask(id, beforeId) {
      const t = this.task(id);
      if (!t) return;
      const siblings = this.data.tasks
        .filter((x) => x.listId === t.listId && x.id !== id)
        .sort((a, b) => (a.order || 0) - (b.order || 0));
      let idx = beforeId ? siblings.findIndex((x) => x.id === beforeId) : siblings.length;
      if (idx < 0) idx = siblings.length;
      siblings.splice(idx, 0, t);
      siblings.forEach((x, i) => (x.order = i));
      this.emit('tasks');
    },

    // ----- import / export -----
    exportJSON() { return JSON.stringify(this.data, null, 2); },
    importJSON(text) {
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.lists)) throw new Error('invalid');
      this.snapshot();
      this.data = normalize(parsed);
      this.emit('all');
    }
  };

  // ---------- repeat logic ----------
  function nextOccurrence(base, rep) {
    const n = Math.max(1, Number(rep.interval) || 1);
    switch (rep.freq) {
      case 'daily':
        return addDays(base, n);
      case 'weekdays': {
        let k = addDays(base, 1);
        while ([0, 6].includes(fromKey(k).getDay())) k = addDays(k, 1);
        return k;
      }
      case 'weekly': {
        // weeks start on monday for the "same week" check
        const rank = (d) => (d + 6) % 7;
        const days = (rep.days && rep.days.length ? rep.days : [fromKey(base).getDay()])
          .slice()
          .sort((a, b) => rank(a) - rank(b));
        const dow = fromKey(base).getDay();
        const later = days.filter((d) => rank(d) > rank(dow));
        if (later.length) return addDays(base, rank(later[0]) - rank(dow));
        // jump to the first selected day, n weeks after this week's monday
        const monday = addDays(base, -rank(dow));
        return addDays(monday, 7 * n + rank(days[0]));
      }
      case 'monthly':
        return addMonths(base, n);
      case 'yearly':
        return addMonths(base, 12 * n);
      default:
        return addDays(base, 1);
    }
  }

  window.Klaar = {
    Store, uid, toKey, fromKey, todayKey, addDays, addMonths, diffDays,
    nextOccurrence, THEMES, CATEGORIES, native
  };
})();
