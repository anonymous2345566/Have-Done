// Klaar — main application (views, rendering, interactions).
(function () {
  const { Store, todayKey, addDays, fromKey, toKey, diffDays, THEMES, CATEGORIES, native } = window.Klaar;
  const { h, icon, menu, closeMenu, dialog, confirmDialog, promptDialog, toast, ding } = window.UI;
  const t = (...a) => window.I18N.t(...a);

  const SMART = [
    { id: 'myday', icon: 'sun' },
    { id: 'important', icon: 'star' },
    { id: 'planned', icon: 'calendar' },
    { id: 'assigned', icon: 'user' },
    { id: 'all', icon: 'infinity' },
    { id: 'completed', icon: 'checkCircle' }
  ];

  const ui = {
    view: { type: 'smart', id: 'myday' },
    selected: null,
    query: '',
    completedOpen: {},
    plannedOpen: {},
    suggestionsOpen: false,
    draft: {},
    focusAdd: false,
    focusStep: false,
    dragTask: null,
    dragList: null,
    renamingList: false,
    update: null
  };
  const MSX = () => window.MS;
  const msOn = () => !!(window.MS && MS.state.account);

  const $sidebar = document.getElementById('sidebar');
  const $main = document.getElementById('main');
  const $details = document.getElementById('details');
  const $app = document.getElementById('app');

  // =====================================================================
  //  Helpers
  // =====================================================================
  const S = () => Store.data.settings;
  const lang = () => S().lang;
  const locale = () => (lang() === 'nl' ? 'nl-NL' : 'en-GB');

  function listName(l) {
    if (!l) return '';
    if (l.id === 'inbox') return t('tasks');
    return l.name || t('untitledList');
  }

  function viewKey() { return `${ui.view.type}:${ui.view.id}`; }

  function viewPrefs() {
    if (ui.view.type === 'list') return Store.list(ui.view.id) || Store.list('inbox');
    if (ui.view.type === 'search') return Store.data.smart.search;
    return Store.data.smart[ui.view.id];
  }

  function viewTitle() {
    if (ui.view.type === 'list') return listName(Store.list(ui.view.id));
    if (ui.view.type === 'search') return t('searchingFor', { q: ui.query });
    return t(ui.view.id);
  }

  function viewTheme() {
    const p = viewPrefs();
    return (p && p.theme) || 'blue';
  }

  function fmtDate(key, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
    return fromKey(key).toLocaleDateString(locale(), opts);
  }

  const cap = (str) => str.charAt(0).toLocaleUpperCase() + str.slice(1);

  function relDate(key) {
    const d = diffDays(key, todayKey());
    if (d === 0) return t('today');
    if (d === 1) return t('tomorrow');
    if (d === -1) return t('yesterday');
    const sameYear = fromKey(key).getFullYear() === new Date().getFullYear();
    return fmtDate(key, sameYear
      ? { weekday: 'short', day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // lower-case "Vandaag"/"Morgen" when used inside a sentence
  function inline(str) {
    const words = [t('today'), t('tomorrow'), t('yesterday')];
    const hit = words.find((w) => str.startsWith(w));
    return hit ? hit.toLocaleLowerCase() + str.slice(hit.length) : str;
  }

  function fmtReminder(iso) {
    const d = new Date(iso);
    const time = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
    return `${relDate(toKey(d))}, ${time}`;
  }

  function repeatLabel(rep) {
    if (!rep) return '';
    const n = Number(rep.interval) || 1;
    if (rep.freq === 'weekdays') return t('weekdays');
    if (rep.freq === 'weekly' && rep.days && rep.days.length) {
      const names = rep.days
        .slice()
        .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
        .map((d) => dayName(d, 'short'))
        .join(', ');
      return n === 1 ? `${t('weekly')}: ${names}` : `${t('everyN', { n, unit: t('weeks') })}: ${names}`;
    }
    if (n === 1) return t(rep.freq);
    const unit = { daily: 'days', weekly: 'weeks', monthly: 'months', yearly: 'years' }[rep.freq];
    return t('everyN', { n, unit: t(unit) });
  }

  function dayName(dow, style = 'long') {
    // 2023-01-01 was a Sunday
    return new Date(2023, 0, 1 + dow).toLocaleDateString(locale(), { weekday: style });
  }

  function catName(id) {
    return (S().categoryNames && S().categoryNames[id]) || t('cat_' + id);
  }

  function isOverdue(task) {
    return task.due && !task.done && task.due < todayKey();
  }

  // ----- which tasks belong to the current view -----
  function tasksForView(view = ui.view) {
    const all = Store.data.tasks;
    const today = todayKey();
    switch (view.type) {
      case 'list':
        return all.filter((x) => x.listId === view.id);
      case 'search': {
        const q = ui.query.toLowerCase();
        return all.filter(
          (x) =>
            x.title.toLowerCase().includes(q) ||
            (x.note || '').toLowerCase().includes(q) ||
            x.steps.some((s) => s.title.toLowerCase().includes(q)) ||
            x.categories.some((c) => catName(c).toLowerCase().includes(q))
        );
      }
      default:
        switch (view.id) {
          case 'myday': return all.filter((x) => x.myDay === today);
          case 'important': return all.filter((x) => x.important);
          case 'planned': return all.filter((x) => x.due || x.reminder);
          case 'all': return all.slice();
          case 'completed': return all.filter((x) => x.done);
          case 'assigned': return [];
          default: return [];
        }
    }
  }

  function countOpen(view) {
    if (view.type === 'smart' && view.id === 'assigned') return (MS.state.planner || []).length;
    if (view.type === 'smart' && view.id === 'completed') return Store.data.tasks.filter((x) => x.done).length;
    return tasksForView(view).filter((x) => !x.done).length;
  }

  function sortTasks(tasks, sort) {
    const arr = tasks.slice();
    const byOrder = (a, b) => (a.order || 0) - (b.order || 0) || a.createdAt.localeCompare(b.createdAt);
    if (!sort || !sort.by) {
      arr.sort(byOrder);
      if (S().moveStarredToTop) arr.sort((a, b) => (b.important ? 1 : 0) - (a.important ? 1 : 0));
      return arr;
    }
    const dir = sort.dir === 'desc' ? -1 : 1;
    const cmp = {
      importance: (a, b) => (b.important ? 1 : 0) - (a.important ? 1 : 0),
      due: (a, b) => (a.due || '9999').localeCompare(b.due || '9999'),
      alpha: (a, b) => a.title.localeCompare(b.title, locale(), { sensitivity: 'base' }),
      created: (a, b) => b.createdAt.localeCompare(a.createdAt),
      myday: (a, b) => (b.myDay === todayKey() ? 1 : 0) - (a.myDay === todayKey() ? 1 : 0)
    }[sort.by];
    arr.sort((a, b) => (cmp(a, b) || byOrder(a, b)) * dir);
    return arr;
  }

  // =====================================================================
  //  Theme + settings application
  // =====================================================================
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    const pref = S().theme;
    const dark = pref === 'dark' || (pref === 'system' && mql.matches);
    document.documentElement.dataset.mode = dark ? 'dark' : 'light';
    document.documentElement.lang = lang();
  }
  mql.addEventListener && mql.addEventListener('change', applyTheme);

  // =====================================================================
  //  Render
  // =====================================================================
  function render() {
    applyTheme();
    $app.classList.toggle('sidebar-closed', !S().sidebarOpen);
    renderSidebar();
    renderMain();
    renderDetails();
  }

  // Re-render without disturbing what the user is typing (used for background sync)
  function softRender() {
    const ae = document.activeElement;
    const typing = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
    applyTheme();
    renderSidebar();
    if (!(typing && $main.contains(ae))) renderMain();
    if (!(typing && $details.contains(ae))) renderDetails();
  }

  // ---------------- Sidebar ----------------
  function renderSidebar() {
    const active = (v) => v.type === ui.view.type && v.id === ui.view.id;
    const nav = h('nav', { class: 'nav' });

    const item = (view, iconName, label, extra = {}) => {
      const count = countOpen(view);
      const el = h(
        'button',
        {
          class: `nav-item${active(view) ? ' active' : ''}`,
          dataset: { view: view.type, id: view.id },
          onclick: () => go(view),
          oncontextmenu: extra.oncontextmenu,
          draggable: extra.draggable ? 'true' : null,
          ondragstart: extra.ondragstart,
          ondragend: extra.ondragend,
          ondragover: (e) => onNavDragOver(e, view, el),
          ondragleave: () => el.classList.remove('drop', 'drop-before'),
          ondrop: (e) => onNavDrop(e, view, el),
          title: label
        },
        extra.emoji ? h('span', { class: 'ic emoji' }, extra.emoji) : icon(iconName, `theme-${extra.theme || ''}`),
        h('span', { class: 'nav-label' }, label),
        count ? h('span', { class: 'nav-count' }, count) : null
      );
      return el;
    };

    // smart lists
    SMART.forEach((s) => {
      if (s.id === 'assigned') {
        if (!(MS.state.planner && S().msPlanner)) return;
      } else if (s.id !== 'myday' && !S().smartLists[s.id]) return;
      nav.append(item({ type: 'smart', id: s.id }, s.icon, t(s.id), { theme: Store.data.smart[s.id].theme }));
    });
    const inbox = Store.list('inbox');
    nav.append(item({ type: 'list', id: 'inbox' }, 'home', t('tasks'), {
      theme: inbox.theme,
      oncontextmenu: (e) => { e.preventDefault(); listMenu({ x: e.clientX, y: e.clientY }, inbox); }
    }));
    nav.append(h('div', { class: 'nav-sep' }));

    // user lists
    const lists = Store.sortedLists().filter((l) => l.id !== 'inbox');
    const listItem = (l) =>
      item({ type: 'list', id: l.id }, 'list', listName(l), {
        emoji: l.emoji,
        theme: l.theme,
        draggable: true,
        ondragstart: (e) => {
          ui.dragList = l.id;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', l.id);
        },
        ondragend: () => { ui.dragList = null; clearDrops(); },
        oncontextmenu: (e) => { e.preventDefault(); listMenu({ x: e.clientX, y: e.clientY }, l); }
      });

    const userBox = h('div', {
      class: 'nav-lists',
      ondragover: (e) => {
        if (ui.dragList && e.target === userBox) { e.preventDefault(); }
      },
      ondrop: (e) => {
        if (ui.dragList && e.target === userBox) {
          e.preventDefault();
          Store.reorderList(ui.dragList, null, null);
        }
      }
    });
    lists.filter((l) => !l.groupId || !Store.data.groups.find((g) => g.id === l.groupId)).forEach((l) => userBox.append(listItem(l)));

    Store.data.groups.forEach((g) => {
      const members = lists.filter((l) => l.groupId === g.id);
      const head = h(
        'div',
        {
          class: 'group-head',
          onclick: () => Store.updateGroup(g.id, { collapsed: !g.collapsed }),
          oncontextmenu: (e) => { e.preventDefault(); groupMenu({ x: e.clientX, y: e.clientY }, g); },
          ondragover: (e) => { if (ui.dragList) { e.preventDefault(); head.classList.add('drop'); } },
          ondragleave: () => head.classList.remove('drop'),
          ondrop: (e) => {
            if (!ui.dragList) return;
            e.preventDefault();
            Store.reorderList(ui.dragList, null, g.id);
            Store.updateGroup(g.id, { collapsed: false });
          }
        },
        icon('group'),
        h('span', { class: 'nav-label' }, g.name),
        icon(g.collapsed ? 'chevronRight' : 'chevronDown', 'chev'),
        h('button', {
          class: 'icon-btn small',
          title: t('more'),
          html: window.ICONS.more,
          onclick: (e) => { e.stopPropagation(); groupMenu(e.currentTarget, g); }
        })
      );
      const box = h('div', { class: 'group' }, head);
      if (!g.collapsed) {
        const inner = h('div', { class: 'group-lists' });
        members.forEach((l) => inner.append(listItem(l)));
        if (!members.length) inner.append(h('div', { class: 'group-empty' }, t('dragListsHere')));
        box.append(inner);
      }
      userBox.append(box);
    });
    nav.append(userBox);

    // header
    const searchInput = h('input', {
      class: 'search-input',
      type: 'search',
      placeholder: t('search'),
      value: ui.query,
      'aria-label': t('search'),
      oninput: (e) => {
        ui.query = e.target.value;
        if (ui.query.trim()) {
          ui.view = { type: 'search', id: 'search' };
        } else if (ui.view.type === 'search') {
          ui.view = { type: 'smart', id: 'myday' };
        }
        renderMain();
        renderSidebarActive();
      },
      onkeydown: (e) => {
        if (e.key === 'Escape') {
          e.target.value = '';
          ui.query = '';
          if (ui.view.type === 'search') go({ type: 'smart', id: 'myday' });
        }
      }
    });

    const header = h(
      'div',
      { class: 'sidebar-head' },
      h('div', { class: 'brand' },
        h('span', { class: 'brand-logo', html: window.ICONS.logo }),
        h('span', { class: 'brand-name' }, 'Klaar'),
        h('button', {
          class: 'icon-btn',
          title: t('hideSidebar'),
          html: window.ICONS.menu,
          onclick: () => toggleSidebar(false)
        })
      ),
      h('label', { class: 'search' }, icon('search'), searchInput),
      ui.update ? h('button', { class: 'update-banner', onclick: () => native.updates.install() }, icon('download'), t('updateReady', { v: ui.update === 'new' ? '' : ui.update }), h('strong', null, t('restartNow'))) : null
    );

    const newListInput = h('input', {
      class: 'new-list-input',
      placeholder: t('newList'),
      onkeydown: (e) => {
        if (e.key === 'Enter' && e.target.value.trim()) {
          const l = Store.addList(e.target.value.trim());
          e.target.value = '';
          go({ type: 'list', id: l.id });
        }
        if (e.key === 'Escape') e.target.blur();
      }
    });
    const footer = h(
      'div',
      { class: 'sidebar-foot' },
      h('label', { class: 'new-list' }, icon('plus'), newListInput),
      msOn() ? syncButton() : null,
      h('button', {
        class: 'icon-btn',
        title: t('newGroup'),
        html: window.ICONS.group,
        onclick: async () => {
          const name = await promptDialog(t('newGroup'), t('untitledGroup'), t('create'), t('cancel'));
          if (name) Store.addGroup(name);
        }
      }),
      h('button', {
        class: 'icon-btn',
        title: t('settings'),
        html: window.ICONS.settings,
        onclick: openSettings
      })
    );

    // keep search focus while typing
    const hadFocus = document.activeElement && document.activeElement.classList.contains('search-input');
    const pos = hadFocus ? document.activeElement.selectionStart : 0;
    $sidebar.replaceChildren(header, nav, footer);
    if (hadFocus) {
      searchInput.focus();
      try { searchInput.setSelectionRange(pos, pos); } catch { /* ignore */ }
    }
  }

  function syncButton() {
    const st = MS.state;
    const err = st.needLogin || (st.error && S().msSync);
    const last = Store.data.sync.lastSync;
    const title = st.syncing ? t('syncing')
      : st.needLogin ? t('msLoginAgain')
      : st.error ? t('syncError', { msg: st.error })
      : last ? t('lastSynced', { when: new Date(last).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) })
      : t('msConnected');
    return h('button', {
      class: `icon-btn sync-btn${st.syncing ? ' spinning' : ''}${err ? ' err' : ''}`,
      title,
      'aria-label': title,
      html: window.ICONS.cloud,
      onclick: (e) => menu(e.currentTarget, [
        { node: h('div', { class: 'menu-note' }, h('strong', null, st.account.name), h('span', null, st.account.username), h('span', { class: err ? 'err-text' : '' }, title)) },
        'sep',
        st.needLogin && { icon: 'user', label: t('msLoginAgain'), onClick: () => msLogin() },
        S().msSync && !st.needLogin && { icon: 'refresh', label: t('syncNow'), onClick: () => MS.syncNow() },
        { icon: 'settings', label: t('msSettings'), onClick: () => openSettings('microsoft') }
      ])
    });
  }

  function renderSidebarActive() {
    $sidebar.querySelectorAll('.nav-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.view === ui.view.type && el.dataset.id === ui.view.id);
    });
  }

  function clearDrops() {
    document.querySelectorAll('.drop, .drop-before, .drop-after').forEach((el) => el.classList.remove('drop', 'drop-before', 'drop-after'));
  }

  function onNavDragOver(e, view, el) {
    if (ui.dragTask) {
      const ok = view.type === 'list' || ['myday', 'important', 'planned'].includes(view.id);
      if (ok) { e.preventDefault(); el.classList.add('drop'); }
    } else if (ui.dragList && view.type === 'list' && view.id !== 'inbox' && view.id !== ui.dragList) {
      e.preventDefault();
      el.classList.add('drop-before');
    }
  }

  function onNavDrop(e, view, el) {
    el.classList.remove('drop', 'drop-before');
    if (ui.dragTask) {
      e.preventDefault();
      const task = Store.task(ui.dragTask);
      if (!task) return;
      if (view.type === 'list') {
        Store.updateTask(task.id, { listId: view.id });
        toast(t('movedTo', { list: listName(Store.list(view.id)) }));
      } else if (view.id === 'myday') Store.updateTask(task.id, { myDay: todayKey() });
      else if (view.id === 'important') Store.updateTask(task.id, { important: true });
      else if (view.id === 'planned' && !task.due) Store.updateTask(task.id, { due: todayKey() });
      ui.dragTask = null;
    } else if (ui.dragList) {
      e.preventDefault();
      const target = Store.list(view.id);
      Store.reorderList(ui.dragList, view.id, target ? target.groupId : null);
      ui.dragList = null;
    }
  }

  function listMenu(at, l) {
    const isInbox = l.id === 'inbox' || l.wellKnown === 'flaggedEmails';
    menu(at, [
      !isInbox && { icon: 'edit', label: t('renameList'), onClick: () => { go({ type: 'list', id: l.id }); startRename(); } },
      { icon: 'palette', label: t('theme'), submenu: themeItems((theme) => Store.updateList(l.id, { theme }), l.theme) },
      !isInbox && Store.data.groups.length && {
        icon: 'group',
        label: t('moveToGroup'),
        submenu: [
          ...Store.data.groups.map((g) => ({
            label: g.name,
            checked: l.groupId === g.id,
            onClick: () => Store.updateList(l.id, { groupId: g.id })
          })),
          l.groupId && 'sep',
          l.groupId && { label: t('removeFromGroup'), onClick: () => Store.updateList(l.id, { groupId: null }) }
        ]
      },
      !isInbox && { icon: 'list', label: t('duplicateList'), onClick: () => {
        const c = Store.duplicateList(l.id, t('copySuffix'));
        if (c) go({ type: 'list', id: c.id });
      } },
      !isInbox && 'sep',
      !isInbox && { icon: 'trash', label: t('deleteList'), danger: true, onClick: () => deleteList(l) }
    ]);
  }

  function groupMenu(at, g) {
    menu(at, [
      { icon: 'edit', label: t('renameGroup'), onClick: async () => {
        const name = await promptDialog(t('renameGroup'), g.name, t('save'), t('cancel'));
        if (name) Store.updateGroup(g.id, { name });
      } },
      { icon: 'plus', label: t('newListInGroup'), onClick: async () => {
        const name = await promptDialog(t('newList'), '', t('create'), t('cancel'), t('untitledList'));
        if (name !== null) {
          const l = Store.addList(name || t('untitledList'), g.id);
          go({ type: 'list', id: l.id });
        }
      } },
      'sep',
      { icon: 'close', label: t('ungroup'), onClick: () => Store.ungroup(g.id) }
    ]);
  }

  function themeItems(onPick, current) {
    const row = h('div', { class: 'theme-row' },
      THEMES.map((th) =>
        h('button', {
          class: `swatch theme-bg-${th}${th === current ? ' current' : ''}`,
          title: t('theme_' + th),
          'aria-label': t('theme_' + th),
          onclick: () => { onPick(th); closeMenu(); }
        })
      )
    );
    return [{ node: row }];
  }

  async function deleteList(l) {
    const n = Store.data.tasks.filter((x) => x.listId === l.id).length;
    if (S().confirmDelete) {
      const ok = await confirmDialog(t('deleteListQ', { name: listName(l) }), n ? t('deleteListText', { n }) : t('cannotUndo'), t('delete'), t('cancel'));
      if (!ok) return;
    }
    Store.deleteList(l.id);
    if (ui.view.type === 'list' && ui.view.id === l.id) go({ type: 'smart', id: 'myday' });
    toast(t('listDeleted'), { label: t('undo'), onClick: () => Store.undo() });
  }

  // ---------------- Main ----------------
  function renderMain() {
    const prefs = viewPrefs();
    const theme = viewTheme();
    $main.className = `main theme-${theme}`;

    const isList = ui.view.type === 'list';
    const isMyDay = ui.view.type === 'smart' && ui.view.id === 'myday';
    const isCompletedView = ui.view.type === 'smart' && ui.view.id === 'completed';
    const isPlanned = ui.view.type === 'smart' && ui.view.id === 'planned';

    // ----- header -----
    const titleEl = isList && ui.view.id !== 'inbox' && ui.renamingList
      ? h('input', {
          class: 'title-input',
          value: listName(prefs),
          onkeydown: (e) => {
            if (e.key === 'Enter') e.target.blur();
            if (e.key === 'Escape') { ui.renamingList = false; renderMain(); }
          },
          onblur: (e) => {
            ui.renamingList = false;
            const v = e.target.value.trim();
            if (v) Store.updateList(prefs.id, { name: v });
            else renderMain();
          }
        })
      : h('h1', {
          class: 'title',
          ondblclick: () => { if (isList && ui.view.id !== 'inbox') startRename(); }
        },
        isList && prefs.emoji ? h('span', { class: 'title-emoji' }, prefs.emoji) : null,
        viewTitle());

    const tools = h('div', { class: 'tools' });
    if (isMyDay) {
      tools.append(h('button', {
        class: `tool-btn${ui.suggestionsOpen ? ' on' : ''}`,
        onclick: () => { ui.suggestionsOpen = !ui.suggestionsOpen; render(); }
      }, icon('bulb'), h('span', null, t('suggestions'))));
    }
    if (ui.view.type !== 'search' && !isCompletedView) {
      tools.append(h('button', {
        class: 'tool-btn',
        onclick: (e) => sortMenu(e.currentTarget)
      }, icon('sort'), h('span', null, t('sort'))));
    }
    if (ui.view.type !== 'search') {
      tools.append(h('button', {
        class: 'tool-btn icon-only',
        title: t('listOptions'),
        html: window.ICONS.more,
        onclick: (e) => viewMenu(e.currentTarget)
      }));
    }

    const header = h(
      'header',
      { class: 'main-head' },
      h('div', { class: 'title-row' },
        h('button', {
          class: 'icon-btn menu-toggle',
          title: t('showSidebar'),
          html: window.ICONS.menu,
          onclick: () => toggleSidebar(true)
        }),
        titleEl,
        tools
      ),
      isMyDay ? h('div', { class: 'subtitle' }, cap(fmtDate(todayKey(), { weekday: 'long', day: 'numeric', month: 'long' }))) : null
    );

    // sort chip
    let sortChip = null;
    if (prefs && prefs.sort && prefs.sort.by) {
      sortChip = h('div', { class: 'sort-chip' },
        h('button', {
          class: 'chip',
          title: t('reverseSort'),
          onclick: () => setSort({ by: prefs.sort.by, dir: prefs.sort.dir === 'desc' ? 'asc' : 'desc' })
        }, icon('arrowUp', prefs.sort.dir === 'desc' ? 'flip' : ''), t('sortedBy', { by: t('sort_' + prefs.sort.by) })),
        h('button', { class: 'chip-x', title: t('removeSort'), html: window.ICONS.close, onclick: () => setSort(null) })
      );
    }

    const isAssigned = ui.view.type === 'smart' && ui.view.id === 'assigned';
    if (isAssigned) {
      tools.querySelectorAll('.tool-btn').forEach((b) => b.remove());
      tools.append(h('button', { class: 'tool-btn', onclick: () => MS.loadPlanner() }, icon('refresh'), h('span', null, t('refresh'))));
    }

    // ----- add task -----
    const addBar = isCompletedView || isAssigned ? null : renderAddBar();

    // ----- tasks -----
    const tasks = tasksForView();
    const sorted = sortTasks(tasks, prefs && prefs.sort);
    const open = sorted.filter((x) => !x.done);
    const done = sorted.filter((x) => x.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
    const showCompleted = !prefs || prefs.showCompleted !== false;
    const listBox = h('div', { class: 'tasks', role: 'list' });

    if (isCompletedView) {
      done.forEach((x) => listBox.append(taskRow(x)));
    } else if (isPlanned && !(prefs.sort && prefs.sort.by)) {
      plannedBuckets(open).forEach(({ key, label, items }) => {
        if (!items.length) return;
        const isOpen = ui.plannedOpen[key] !== false;
        listBox.append(sectionHead(label, items.length, isOpen, () => { ui.plannedOpen[key] = !isOpen; renderMain(); }));
        if (isOpen) items.forEach((x) => listBox.append(taskRow(x)));
      });
    } else {
      open.forEach((x) => listBox.append(taskRow(x)));
    }

    if (!isCompletedView && showCompleted && done.length) {
      const key = viewKey();
      const isOpen = !!ui.completedOpen[key];
      listBox.append(sectionHead(t('completed'), done.length, isOpen, () => { ui.completedOpen[key] = !isOpen; renderMain(); }));
      if (isOpen) done.forEach((x) => listBox.append(taskRow(x)));
    }

    let empty = !tasks.length || (isCompletedView && !done.length) ? emptyState() : null;
    if (isAssigned) {
      const items = MS.state.planner || [];
      items.slice().sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')).forEach((x) => listBox.append(plannerRow(x)));
      empty = items.length ? null : emptyState();
    }
    const agenda = isMyDay ? renderAgenda() : null;

    const scroller = h('div', { class: 'main-scroll' }, sortChip, agenda, listBox, empty);
    const content = h('div', { class: 'main-content' }, header, scroller, addBar);
    const children = [content];
    if (isMyDay && ui.suggestionsOpen) children.push(renderSuggestions());
    $main.replaceChildren(...children);

    if (ui.focusAdd) {
      ui.focusAdd = false;
      const inp = $main.querySelector('.add-input');
      if (inp) inp.focus();
    }
    if (ui.renamingList) {
      const inp = $main.querySelector('.title-input');
      if (inp) { inp.focus(); inp.select(); }
    }
  }

  function renderAgenda() {
    const events = MS.state.calendar;
    if (!msOn() || !S().msCalendar || !events || !events.length) return null;
    const key = 'agenda';
    const isOpen = ui.completedOpen[key] !== false;
    const time = (d) => d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
    const now = Date.now();
    return h('div', { class: 'agenda' },
      sectionHead(t('agendaToday'), events.length, isOpen, () => { ui.completedOpen[key] = !isOpen; renderMain(); }),
      isOpen ? h('div', { class: 'agenda-list' }, events.map((ev) => h(ev.link ? 'a' : 'div', {
        class: `event${ev.end && ev.end.getTime() < now ? ' past' : ''}${ev.start && ev.start.getTime() <= now && ev.end && ev.end.getTime() > now ? ' now' : ''}${ev.free ? ' free' : ''}`,
        href: ev.link || null,
        target: ev.link ? '_blank' : null,
        rel: 'noopener',
        title: ev.link ? t('openInOutlook') : null
      },
      h('span', { class: 'event-time' }, ev.allDay ? t('allDay') : `${time(ev.start)} – ${time(ev.end)}`),
      h('span', { class: 'event-title' }, ev.title),
      ev.location ? h('span', { class: 'event-loc' }, ev.location) : null))) : null);
  }

  function plannerRow(x) {
    const overdue = x.due && x.due < todayKey();
    return h('div', { class: 'task planner-task', role: 'listitem' },
      h('button', {
        class: 'check',
        role: 'checkbox',
        'aria-checked': 'false',
        title: t('markDone'),
        onclick: async (e) => {
          e.currentTarget.closest('.task').classList.add('completing');
          if (S().playSound) ding();
          try { await MS.completePlanner(x); } catch (err) { toast(t('plannerFailed')); MS.loadPlanner(); }
        }
      }, icon('check')),
      h('div', { class: 'task-body' },
        h('div', { class: 'task-title' }, x.title),
        h('div', { class: 'task-meta' },
          h('span', { class: 'meta-item' }, icon('group'), MS.state.plans[x.planId] || 'Planner'),
          x.due ? h('span', { class: `meta-item${overdue ? ' overdue' : ''}` }, icon('calendar'), relDate(x.due)) : null,
          x.progress > 0 ? h('span', { class: 'meta-item' }, t('inProgress')) : null)));
  }

  function startRename() {
    ui.renamingList = true;
    renderMain();
  }

  function sectionHead(label, count, isOpen, onToggle) {
    return h('button', { class: 'section-head', onclick: onToggle, 'aria-expanded': String(isOpen) },
      icon(isOpen ? 'chevronDown' : 'chevronRight'),
      h('span', null, label),
      h('span', { class: 'section-count' }, count));
  }

  function plannedBuckets(tasks) {
    const today = todayKey();
    const keyOf = (x) => x.due || toKey(new Date(x.reminder));
    const endOfWeek = addDays(today, 7 - ((fromKey(today).getDay() + 6) % 7) - 1);
    const buckets = [
      { key: 'earlier', label: t('earlier'), test: (k) => k < today },
      { key: 'today', label: t('today'), test: (k) => k === today },
      { key: 'tomorrow', label: t('tomorrow'), test: (k) => k === addDays(today, 1) },
      { key: 'week', label: t('thisWeek'), test: (k) => k > addDays(today, 1) && k <= endOfWeek },
      { key: 'later', label: t('later'), test: (k) => k > addDays(today, 1) && k > endOfWeek }
    ];
    const sortedByDate = tasks.slice().sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
    return buckets.map((b) => ({ ...b, items: sortedByDate.filter((x) => b.test(keyOf(x))) }));
  }

  function emptyState() {
    const v = ui.view;
    let ic = 'checkCircle';
    let title = t('emptyList');
    let sub = t('emptyListSub');
    if (v.type === 'search') { ic = 'search'; title = t('noResults'); sub = t('noResultsSub'); }
    else if (v.id === 'myday') { ic = 'sun'; title = t('emptyMyDay'); sub = t('emptyMyDaySub'); }
    else if (v.id === 'important') { ic = 'star'; title = t('emptyImportant'); sub = t('emptyImportantSub'); }
    else if (v.id === 'planned') { ic = 'calendar'; title = t('emptyPlanned'); sub = t('emptyPlannedSub'); }
    else if (v.id === 'completed') { title = t('emptyCompleted'); sub = t('emptyCompletedSub'); }
    else if (v.id === 'assigned') { ic = 'user'; title = t('emptyAssigned'); sub = t('emptyAssignedSub'); }
    return h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, icon(ic)), h('h3', null, title), h('p', null, sub));
  }

  function renderAddBar() {
    const d = ui.draft;
    const input = h('input', {
      class: 'add-input',
      placeholder: t('addTask'),
      'aria-label': t('addTask'),
      value: d.title || '',
      oninput: (e) => { d.title = e.target.value; renderNlpPreview(); },
      onkeydown: (e) => {
        if (e.key === 'Enter') createFromDraft();
        if (e.key === 'Escape') { ui.draft = {}; e.target.value = ''; e.target.blur(); renderMain(); }
      }
    });
    const chip = (iconName, label, active, onClick) =>
      h('button', { class: `add-chip${active ? ' on' : ''}`, title: label, onmousedown: (e) => e.preventDefault(), onclick: onClick },
        icon(iconName), active ? h('span', null, label) : null);

    const opts = h('div', { class: 'add-opts' },
      chip('calendar', d.due ? relDate(d.due) : t('addDue'), !!d.due, (e) => dueMenu(e.currentTarget, d.due, (v) => { d.due = v; renderMain(); ui.focusAdd = true; })),
      chip('bell', d.reminder ? fmtReminder(d.reminder) : t('remindMe'), !!d.reminder, (e) => reminderMenu(e.currentTarget, d.reminder, (v) => { d.reminder = v; renderMain(); })),
      chip('repeat', d.repeat ? repeatLabel(d.repeat) : t('repeat'), !!d.repeat, (e) => repeatMenu(e.currentTarget, d.repeat, (v) => { d.repeat = v; if (v && !d.due) d.due = todayKey(); renderMain(); })),
      h('button', { class: 'add-btn', onclick: createFromDraft, onmousedown: (e) => e.preventDefault() }, t('add'))
    );

    const bar = h('div', { class: `add-bar${d.title || d.due || d.reminder || d.repeat ? ' active' : ''}` },
      h('div', { class: 'add-row' }, h('span', { class: 'add-plus', html: window.ICONS.plus }), input),
      h('div', { class: 'nlp-chips' }),
      opts);
    setTimeout(renderNlpPreview);
    return bar;
  }

  function parseSmart(text) {
    if (!S().smartInput || !window.KlaarNLP) return { title: text, tokens: [] };
    return window.KlaarNLP.parse(text, {
      lists: Store.sortedLists().map((l) => ({ id: l.id, name: listName(l) })),
      categoryNames: Object.fromEntries(CATEGORIES.map((c) => [c.id, catName(c.id)]))
    });
  }

  function tokenLabel(tk) {
    switch (tk.type) {
      case 'due': return [icon('calendar'), relDate(tk.value)];
      case 'reminder': return [icon('bell'), fmtReminder(tk.value)];
      case 'repeat': return [icon('repeat'), repeatLabel(tk.value)];
      case 'important': return [icon('starFilled'), t('important')];
      case 'myday': return [icon('sun'), t('myday')];
      case 'category': return [h('span', { class: 'cat-dot', style: { '--cat': (CATEGORIES.find((c) => c.id === tk.value) || {}).color } }), catName(tk.value)];
      case 'list': return [icon('list'), tk.label];
      default: return [];
    }
  }

  function renderNlpPreview() {
    const box = $main.querySelector('.nlp-chips');
    if (!box) return;
    const r = parseSmart(ui.draft.title || '');
    box.replaceChildren(...r.tokens.map((tk) => h('span', { class: 'nlp-chip' }, tokenLabel(tk))));
    box.classList.toggle('show', r.tokens.length > 0);
  }

  function createFromDraft() {
    const d = ui.draft;
    const raw = (d.title || '').trim();
    if (!raw) return;
    const parsed = parseSmart(raw);
    const title = parsed.title || raw;
    const fields = { title };
    if (parsed.due) fields.due = parsed.due;
    if (parsed.reminder) fields.reminder = parsed.reminder;
    if (parsed.repeat) fields.repeat = parsed.repeat;
    if (parsed.important) fields.important = true;
    if (parsed.myDay) fields.myDay = todayKey();
    if (parsed.categories) fields.categories = parsed.categories;
    if (parsed.listId) fields.listId = parsed.listId;
    if (d.due) fields.due = d.due;
    if (d.reminder) fields.reminder = d.reminder;
    if (d.repeat) fields.repeat = d.repeat;
    const v = ui.view;
    if (v.type === 'list' && !fields.listId) fields.listId = v.id;
    else if (v.id === 'myday') fields.myDay = todayKey();
    else if (v.id === 'important') fields.important = true;
    else if (v.id === 'planned' && !fields.due) fields.due = todayKey();
    ui.draft = {};
    ui.focusAdd = true;
    Store.addTask(fields);
  }

  // ----- task row -----
  function taskRow(task) {
    const prefs = viewPrefs();
    const sortable = ui.view.type === 'list' && !(prefs.sort && prefs.sort.by) && !task.done;
    const meta = [];
    if (ui.view.type !== 'list') meta.push(h('span', { class: 'meta-item' }, listName(Store.list(task.listId))));
    if (task.myDay === todayKey() && !(ui.view.type === 'smart' && ui.view.id === 'myday')) meta.push(h('span', { class: 'meta-item' }, icon('sun'), t('myday')));
    if (task.steps.length) meta.push(h('span', { class: 'meta-item' }, t('stepsOf', { a: task.steps.filter((s) => s.done).length, b: task.steps.length })));
    if (task.due) meta.push(h('span', { class: `meta-item${isOverdue(task) ? ' overdue' : ''}${task.due === todayKey() && !task.done ? ' due-today' : ''}` }, icon('calendar'), (isOverdue(task) ? t('overdue') + ', ' : '') + relDate(task.due), task.repeat ? icon('repeat') : null));
    if (task.reminder) meta.push(h('span', { class: 'meta-item' }, icon('bell'), fmtReminder(task.reminder)));
    if (task.note && task.note.trim()) meta.push(h('span', { class: 'meta-item' }, icon('note'), t('note')));
    task.categories.forEach((c) => {
      const cat = CATEGORIES.find((x) => x.id === c);
      if (cat) meta.push(h('span', { class: 'meta-item cat', style: { '--cat': cat.color } }, h('span', { class: 'cat-dot' }), catName(c)));
    });

    const row = h(
      'div',
      {
        class: `task${task.done ? ' done' : ''}${ui.selected === task.id ? ' selected' : ''}`,
        role: 'listitem',
        tabindex: '0',
        draggable: 'true',
        dataset: { id: task.id },
        onclick: () => select(task.id),
        onkeydown: (e) => {
          if (e.key === 'Enter') select(task.id);
          if (e.key === ' ') { e.preventDefault(); complete(task.id); }
          if (e.key === 'Delete') removeTask(task);
        },
        oncontextmenu: (e) => { e.preventDefault(); taskMenu({ x: e.clientX, y: e.clientY }, task); },
        ondragstart: (e) => {
          ui.dragTask = task.id;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', task.title);
          row.classList.add('dragging');
        },
        ondragend: () => { ui.dragTask = null; row.classList.remove('dragging'); clearDrops(); },
        ondragover: (e) => {
          if (!sortable || !ui.dragTask || ui.dragTask === task.id) return;
          const dragged = Store.task(ui.dragTask);
          if (!dragged || dragged.listId !== task.listId) return;
          e.preventDefault();
          const r = row.getBoundingClientRect();
          const after = e.clientY > r.top + r.height / 2;
          row.classList.toggle('drop-after', after);
          row.classList.toggle('drop-before', !after);
        },
        ondragleave: () => row.classList.remove('drop-before', 'drop-after'),
        ondrop: (e) => {
          if (!sortable || !ui.dragTask) return;
          e.preventDefault();
          const after = row.classList.contains('drop-after');
          clearDrops();
          let beforeId = task.id;
          if (after) {
            const next = row.nextElementSibling;
            beforeId = next && next.classList.contains('task') && !next.classList.contains('done') ? next.dataset.id : null;
          }
          if (beforeId !== ui.dragTask) Store.reorderTask(ui.dragTask, beforeId);
          ui.dragTask = null;
        }
      },
      h('button', {
        class: 'check',
        role: 'checkbox',
        'aria-checked': String(task.done),
        title: task.done ? t('markNotDone') : t('markDone'),
        onclick: (e) => { e.stopPropagation(); complete(task.id, e.currentTarget); }
      }, icon('check')),
      h('div', { class: 'task-body' },
        h('div', { class: 'task-title' }, task.title),
        meta.length ? h('div', { class: 'task-meta' }, meta) : null
      ),
      h('button', {
        class: `star${task.important ? ' on' : ''}`,
        role: 'switch',
        'aria-checked': String(task.important),
        title: task.important ? t('removeImportance') : t('markImportant'),
        html: task.important ? window.ICONS.starFilled : window.ICONS.star,
        onclick: (e) => { e.stopPropagation(); Store.updateTask(task.id, { important: !task.important }); }
      })
    );
    return row;
  }

  function complete(id, btn) {
    const task = Store.task(id);
    if (!task) return;
    const wasDone = task.done;
    if (!wasDone) {
      if (S().playSound) ding();
      if (btn) {
        const row = btn.closest('.task');
        if (row) row.classList.add('completing');
      }
    }
    const finish = () => {
      const spawned = Store.toggleDone(id);
      if (spawned) toast(t('repeatCreated', { date: relDate(spawned.due) }));
    };
    if (!wasDone && btn) setTimeout(finish, 280);
    else finish();
  }

  function select(id) {
    ui.selected = id;
    renderMainSelection();
    renderDetails();
  }

  function renderMainSelection() {
    $main.querySelectorAll('.task').forEach((el) => el.classList.toggle('selected', el.dataset.id === ui.selected));
  }

  async function removeTask(task) {
    if (S().confirmDelete) {
      const ok = await confirmDialog(t('deleteTaskQ', { name: task.title }), t('cannotUndo'), t('delete'), t('cancel'));
      if (!ok) return;
    }
    if (ui.selected === task.id) ui.selected = null;
    Store.deleteTask(task.id);
    toast(t('taskDeleted'), { label: t('undo'), onClick: () => Store.undo() });
  }

  function taskMenu(at, task) {
    const today = todayKey();
    const others = Store.sortedLists().filter((l) => l.id !== task.listId);
    menu(at, [
      { icon: 'sun', label: task.myDay === today ? t('removeFromMyDay') : t('addToMyDay'), onClick: () => Store.updateTask(task.id, { myDay: task.myDay === today ? null : today }) },
      { icon: task.important ? 'starFilled' : 'star', label: task.important ? t('removeImportance') : t('markImportant'), onClick: () => Store.updateTask(task.id, { important: !task.important }) },
      { icon: 'checkCircle', label: task.done ? t('markNotDone') : t('markDone'), onClick: () => complete(task.id) },
      'sep',
      { icon: 'calendar', label: t('dueToday'), onClick: () => Store.updateTask(task.id, { due: today }) },
      { icon: 'calendar', label: t('dueTomorrow'), onClick: () => Store.updateTask(task.id, { due: addDays(today, 1) }) },
      task.due && { icon: 'close', label: t('removeDue'), onClick: () => Store.updateTask(task.id, { due: null, repeat: null }) },
      'sep',
      others.length && { icon: 'move', label: t('moveTo'), submenu: others.map((l) => ({ label: listName(l), onClick: () => { Store.updateTask(task.id, { listId: l.id }); toast(t('movedTo', { list: listName(l) })); } })) },
      { icon: 'tag', label: t('categories'), submenu: CATEGORIES.map((c) => ({
        node: h('button', {
          class: `menu-item${task.categories.includes(c.id) ? ' checked' : ''}`,
          onclick: () => { toggleCategory(task, c.id); closeMenu(); }
        }, h('span', { class: 'ic' }, h('span', { class: 'cat-dot big', style: { background: c.color } })), h('span', { class: 'menu-label' }, catName(c.id)), task.categories.includes(c.id) ? icon('check', 'menu-check') : null)
      })) },
      'sep',
      { icon: 'trash', label: t('deleteTask'), danger: true, onClick: () => removeTask(task) }
    ]);
  }

  function toggleCategory(task, id) {
    const cats = task.categories.includes(id) ? task.categories.filter((c) => c !== id) : [...task.categories, id];
    Store.updateTask(task.id, { categories: cats });
  }

  function setSort(sort) {
    if (ui.view.type === 'list') Store.updateList(ui.view.id, { sort });
    else {
      Store.data.smart[ui.view.id].sort = sort;
      Store.emit('lists');
    }
  }

  function sortMenu(anchor) {
    const cur = (viewPrefs().sort || {}).by;
    const opts = ['importance', 'due', 'myday', 'alpha', 'created'].filter((o) => !(o === 'myday' && ui.view.id === 'myday'));
    const icons = { importance: 'star', due: 'calendar', myday: 'sun', alpha: 'sort', created: 'clock' };
    menu(anchor, opts.map((o) => ({
      icon: icons[o],
      label: t('sort_' + o),
      checked: cur === o,
      onClick: () => setSort({ by: o, dir: 'asc' })
    })), { title: t('sortBy') });
  }

  function viewMenu(anchor) {
    const prefs = viewPrefs();
    const isList = ui.view.type === 'list';
    const toggleCompleted = () => {
      if (isList) Store.updateList(prefs.id, { showCompleted: prefs.showCompleted === false });
      else { prefs.showCompleted = prefs.showCompleted === false; Store.emit('lists'); }
    };
    const setTheme = (theme) => {
      if (isList) Store.updateList(prefs.id, { theme });
      else { prefs.theme = theme; Store.emit('lists'); }
    };
    menu(anchor, [
      isList && prefs.id !== 'inbox' && { icon: 'edit', label: t('renameList'), onClick: startRename },
      isList && prefs.id !== 'inbox' && { icon: 'sun', label: t('setEmoji'), onClick: () => emojiPicker(prefs) },
      { icon: 'palette', label: t('theme'), submenu: themeItems(setTheme, prefs.theme) },
      ui.view.id !== 'completed' && { icon: 'checkCircle', label: prefs.showCompleted === false ? t('showCompleted') : t('hideCompleted'), onClick: toggleCompleted },
      { icon: 'print', label: t('printList'), onClick: () => window.print() },
      isList && prefs.id !== 'inbox' && { icon: 'list', label: t('duplicateList'), onClick: () => {
        const c = Store.duplicateList(prefs.id, t('copySuffix'));
        if (c) go({ type: 'list', id: c.id });
      } },
      isList && prefs.id !== 'inbox' && 'sep',
      isList && prefs.id !== 'inbox' && { icon: 'trash', label: t('deleteList'), danger: true, onClick: () => deleteList(prefs) }
    ], { title: t('listOptions') });
  }

  function emojiPicker(list) {
    const emojis = ['', '📋', '🏠', '💼', '🛒', '✈️', '📚', '🎯', '💡', '🎉', '🏋️', '🍳', '🎬', '🎵', '💰', '🚗', '🐶', '🌱', '🧹', '🎁', '📸', '🛠️', '❤️', '⭐', '🔥', '📅', '✅', '🧾', '🍕', '🎮'];
    const grid = h('div', { class: 'emoji-grid' },
      emojis.map((em) => h('button', {
        class: `emoji-btn${list.emoji === em ? ' current' : ''}`,
        title: em || t('none'),
        onclick: () => { Store.updateList(list.id, { emoji: em }); dlg.close(); }
      }, em || '∅')));
    const custom = h('input', { class: 'field', placeholder: t('customEmoji'), maxlength: '4' });
    const dlg = dialog({
      title: t('setEmoji'),
      body: h('div', null, grid, custom),
      buttons: [
        { label: t('cancel') },
        { label: t('save'), primary: true, onClick: () => { if (custom.value.trim()) Store.updateList(list.id, { emoji: custom.value.trim() }); } }
      ]
    });
  }

  // ----- My Day suggestions -----
  function renderSuggestions() {
    const today = todayKey();
    const pool = Store.data.tasks.filter((x) => !x.done && x.myDay !== today);
    const used = new Set();
    const take = (arr) => arr.filter((x) => !used.has(x.id) && used.add(x.id));
    const groups = [
      { label: t('sugOverdue'), items: take(pool.filter((x) => x.due && x.due < today)) },
      { label: t('sugToday'), items: take(pool.filter((x) => x.due === today || (x.reminder && toKey(new Date(x.reminder)) === today))) },
      { label: t('sugYesterday'), items: take(pool.filter((x) => x.lastMyDay)) },
      { label: t('sugUpcoming'), items: take(pool.filter((x) => x.due && x.due > today && diffDays(x.due, today) <= 7)) },
      { label: t('sugImportant'), items: take(pool.filter((x) => x.important)) },
      { label: t('sugRecent'), items: take(pool.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8)) }
    ];
    const body = h('div', { class: 'sug-body' });
    let any = false;
    groups.forEach((g) => {
      if (!g.items.length) return;
      any = true;
      body.append(h('h4', { class: 'sug-head' }, g.label));
      g.items.forEach((x) => body.append(h('div', { class: 'sug-item' },
        h('div', { class: 'task-body' },
          h('div', { class: 'task-title' }, x.title),
          h('div', { class: 'task-meta' },
            h('span', { class: 'meta-item' }, listName(Store.list(x.listId))),
            x.due ? h('span', { class: `meta-item${isOverdue(x) ? ' overdue' : ''}` }, icon('calendar'), relDate(x.due)) : null)),
        h('button', {
          class: 'icon-btn',
          title: t('addToMyDay'),
          html: window.ICONS.plus,
          onclick: () => Store.updateTask(x.id, { myDay: today, lastMyDay: null })
        }))));
    });
    if (!any) body.append(h('div', { class: 'empty small' }, h('div', { class: 'empty-icon' }, icon('bulb')), h('p', null, t('noSuggestions'))));
    return h('aside', { class: 'suggestions' },
      h('div', { class: 'sug-title' },
        h('h3', null, t('suggestions')),
        h('button', { class: 'icon-btn', title: t('close'), html: window.ICONS.close, onclick: () => { ui.suggestionsOpen = false; renderMain(); } })),
      body);
  }

  // ---------------- Details pane ----------------
  function renderDetails() {
    const task = ui.selected && Store.task(ui.selected);
    if (!task) {
      ui.selected = null;
      $details.hidden = true;
      $app.classList.remove('details-open');
      return;
    }
    $details.hidden = false;
    $details.className = `details theme-${viewTheme()}`;
    $app.classList.add('details-open');
    const today = todayKey();

    const autosize = (el) => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; };

    // title + steps card
    const titleArea = h('textarea', {
      class: 'd-title',
      rows: '1',
      value: task.title,
      'aria-label': t('title'),
      oninput: (e) => {
        autosize(e.target);
        const v = e.target.value.replace(/\n/g, ' ');
        if (!v.trim()) return;
        Store.updateTask(task.id, { title: v }, true);
        const rowTitle = $main.querySelector(`.task[data-id="${task.id}"] .task-title`);
        if (rowTitle) rowTitle.textContent = v;
      },
      onblur: (e) => {
        const v = e.target.value.trim();
        if (!v) { e.target.value = task.title || ''; return; }
        if (v !== task.title) Store.updateTask(task.id, { title: v }, true);
      },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }
    });
    titleArea.value = task.title;

    const steps = h('div', { class: 'steps' },
      task.steps.map((s) => h('div', { class: `step${s.done ? ' done' : ''}` },
        h('button', {
          class: 'check small',
          role: 'checkbox',
          'aria-checked': String(s.done),
          onclick: () => { s.done = !s.done; if (s.done && S().playSound) ding(); Store.updateTask(task.id, { steps: task.steps }); }
        }, icon('check')),
        h('input', {
          class: 'step-input',
          value: s.title,
          onchange: (e) => {
            const v = e.target.value.trim();
            if (v) {
              s.title = v;
              Store.updateTask(task.id, { steps: task.steps }, true);
            } else {
              task.steps = task.steps.filter((x) => x !== s);
              Store.updateTask(task.id, { steps: task.steps });
            }
          },
          onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); }
        }),
        h('button', {
          class: 'icon-btn small',
          title: t('more'),
          html: window.ICONS.more,
          onclick: (e) => menu(e.currentTarget, [
            { icon: 'checkCircle', label: s.done ? t('markNotDone') : t('markDone'), onClick: () => { s.done = !s.done; Store.updateTask(task.id, { steps: task.steps }); } },
            { icon: 'arrowUp', label: t('promoteStep'), onClick: () => {
              task.steps = task.steps.filter((x) => x !== s);
              Store.updateTask(task.id, { steps: task.steps });
              Store.addTask({ title: s.title, listId: task.listId, done: s.done });
              toast(t('stepPromoted'));
            } },
            'sep',
            { icon: 'trash', label: t('deleteStep'), danger: true, onClick: () => { task.steps = task.steps.filter((x) => x !== s); Store.updateTask(task.id, { steps: task.steps }); } }
          ])
        })
      )),
      h('label', { class: 'step add' },
        h('span', { class: 'add-plus', html: window.ICONS.plus }),
        h('input', {
          class: 'step-input new-step',
          placeholder: task.steps.length ? t('nextStep') : t('addStep'),
          onkeydown: (e) => {
            if (e.key === 'Enter' && e.target.value.trim()) {
              task.steps.push({ id: Klaar.uid(), title: e.target.value.trim(), done: false });
              ui.focusStep = true;
              Store.updateTask(task.id, { steps: task.steps });
            }
          }
        }))
    );

    const card1 = h('div', { class: 'card' },
      h('div', { class: 'd-head' },
        h('button', {
          class: 'check',
          role: 'checkbox',
          'aria-checked': String(task.done),
          title: task.done ? t('markNotDone') : t('markDone'),
          onclick: () => complete(task.id)
        }, icon('check')),
        titleArea,
        h('button', {
          class: `star${task.important ? ' on' : ''}`,
          title: task.important ? t('removeImportance') : t('markImportant'),
          html: task.important ? window.ICONS.starFilled : window.ICONS.star,
          onclick: () => Store.updateTask(task.id, { important: !task.important })
        })),
      steps);
    if (task.done) card1.classList.add('is-done');

    const rowBtn = (ic, label, active, onClick, onClear) =>
      h('div', { class: `d-row${active ? ' on' : ''}` },
        h('button', { class: 'd-row-main', onclick: onClick }, icon(ic), h('span', null, label)),
        active && onClear ? h('button', { class: 'icon-btn small', title: t('remove'), html: window.ICONS.close, onclick: onClear }) : null);

    const inMyDay = task.myDay === today;
    const card2 = h('div', { class: 'card' },
      rowBtn('sun', inMyDay ? t('addedToMyDay') : t('addToMyDay'), inMyDay,
        () => { if (!inMyDay) Store.updateTask(task.id, { myDay: today, lastMyDay: null }); },
        () => Store.updateTask(task.id, { myDay: null })));

    const card3 = h('div', { class: 'card' },
      rowBtn('bell', task.reminder ? t('remindAt', { when: inline(fmtReminder(task.reminder)) }) : t('remindMe'), !!task.reminder,
        (e) => reminderMenu(e.currentTarget, task.reminder, (v) => Store.updateTask(task.id, { reminder: v })),
        () => Store.updateTask(task.id, { reminder: null })),
      rowBtn('calendar', task.due ? t('dueOn', { when: inline(relDate(task.due)) }) : t('addDue'), !!task.due,
        (e) => dueMenu(e.currentTarget, task.due, (v) => Store.updateTask(task.id, { due: v })),
        () => Store.updateTask(task.id, { due: null, repeat: null })),
      rowBtn('repeat', task.repeat ? repeatLabel(task.repeat) : t('repeat'), !!task.repeat,
        (e) => repeatMenu(e.currentTarget, task.repeat, (v) => Store.updateTask(task.id, { repeat: v })),
        () => Store.updateTask(task.id, { repeat: null })));
    if (isOverdue(task)) card3.querySelectorAll('.d-row')[1].classList.add('overdue');

    let cardCal = null;
    if (msOn() && S().msCalendar) {
      if (task.event) {
        const st = task.event.start ? new Date(task.event.start) : null;
        cardCal = h('div', { class: 'card' }, h('div', { class: 'd-row on' },
          h(task.event.link ? 'a' : 'span', { class: 'd-row-main', href: task.event.link || null, target: '_blank', rel: 'noopener' },
            icon('calendar'), h('span', null, st ? t('inCalendar', { when: inline(relDate(toKey(st))) + ', ' + st.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) }) : t('inCalendarShort'))),
          h('button', { class: 'icon-btn small', title: t('removeFromCalendar'), html: window.ICONS.close, onclick: async () => {
            try { await MS.removeEvent(task); toast(t('removedFromCalendar')); } catch { toast(t('calendarFailed')); }
          } })));
      } else {
        cardCal = h('div', { class: 'card' }, rowBtn('clock', t('scheduleInCalendar'), false, () => scheduleDialog(task)));
      }
    }
    const cardLinks = task.links && task.links.length
      ? h('div', { class: 'card' }, task.links.map((ln) => h('div', { class: 'd-row on' },
        h('a', { class: 'd-row-main', href: ln.url, target: '_blank', rel: 'noopener' }, icon('mail'), h('span', null, ln.title || t('openInOutlook'))))))
      : null;
    const feed = window.Connectors && Connectors.feedOf(task);
    const cardFeed = task.ext && task.ext.url
      ? h('div', { class: 'card' }, h('div', { class: 'd-row on' },
        h('a', { class: 'd-row-main', href: task.ext.url, target: '_blank', rel: 'noopener' }, icon('link'), h('span', null, t('openIn', { name: (feed && feed.name) || t('source') })))),
        h('div', { class: 'd-hint muted small' }, t('linkedHint', { name: (feed && feed.name) || t('source') })))
      : null;
    const cardErr = task.syncError ? h('div', { class: 'card sync-err' }, h('div', { class: 'd-row' }, h('span', { class: 'd-row-main' }, icon('cloud'), h('span', null, t('taskSyncError', { msg: task.syncError }))))) : null;

    const cats = h('div', { class: 'cat-chips' },
      task.categories.map((c) => {
        const cat = CATEGORIES.find((x) => x.id === c);
        return cat ? h('span', { class: 'cat-chip', style: { '--cat': cat.color } }, catName(c),
          h('button', { class: 'chip-x', html: window.ICONS.close, title: t('remove'), onclick: () => toggleCategory(task, c) })) : null;
      }));
    const card4 = h('div', { class: 'card' },
      h('div', { class: `d-row${task.categories.length ? ' on' : ''}` },
        h('button', {
          class: 'd-row-main',
          onclick: (e) => menu(e.currentTarget, CATEGORIES.map((c) => ({
            node: h('button', {
              class: `menu-item${task.categories.includes(c.id) ? ' checked' : ''}`,
              onclick: () => { toggleCategory(task, c.id); closeMenu(); }
            }, h('span', { class: 'ic' }, h('span', { class: 'cat-dot big', style: { background: c.color } })), h('span', { class: 'menu-label' }, catName(c.id)), task.categories.includes(c.id) ? icon('check', 'menu-check') : null)
          })))
        }, icon('tag'), h('span', null, t('pickCategory')))),
      task.categories.length ? cats : null);

    const listSelect = h('select', {
      class: 'd-select',
      'aria-label': t('list'),
      onchange: (e) => { Store.updateTask(task.id, { listId: e.target.value }); toast(t('movedTo', { list: listName(Store.list(e.target.value)) })); }
    }, Store.sortedLists().map((l) => h('option', { value: l.id, selected: l.id === task.listId ? 'selected' : null }, (l.emoji ? l.emoji + ' ' : '') + listName(l))));
    const card5 = h('div', { class: 'card' }, h('div', { class: 'd-row' }, h('label', { class: 'd-row-main' }, icon('list'), listSelect)));

    const note = h('textarea', {
      class: 'd-note',
      placeholder: t('addNote'),
      oninput: (e) => { autosize(e.target); Store.updateTask(task.id, { note: e.target.value }, true); }
    });
    note.value = task.note || '';
    const card6 = h('div', { class: 'card note-card' }, note);

    const created = new Date(task.createdAt);
    const footer = h('div', { class: 'd-foot' },
      h('button', { class: 'icon-btn', title: t('hideDetails'), html: window.ICONS.chevronRight, onclick: () => { ui.selected = null; renderMainSelection(); renderDetails(); } }),
      h('span', { class: 'muted small' },
        task.done && task.doneAt
          ? t('completedOn', { when: new Date(task.doneAt).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'long' }) })
          : t('createdOn', { when: created.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'long' }) })),
      h('button', { class: 'icon-btn', title: t('deleteTask'), html: window.ICONS.trash, onclick: () => removeTask(task) }));

    const scrollTop = $details.querySelector('.d-scroll') ? $details.querySelector('.d-scroll').scrollTop : 0;
    const scroller = h('div', { class: 'd-scroll' }, cardErr, card1, cardFeed, card2, card3, cardCal, cardLinks, card4, card5, card6);
    $details.replaceChildren(
      h('div', { class: 'd-top' },
        h('button', { class: 'icon-btn', title: t('close'), html: window.ICONS.close, onclick: () => { ui.selected = null; renderMainSelection(); renderDetails(); } })),
      scroller, footer);
    scroller.scrollTop = scrollTop;
    requestAnimationFrame(() => { autosize(titleArea); autosize(note); });

    if (ui.focusStep) {
      ui.focusStep = false;
      const inp = $details.querySelector('.new-step');
      if (inp) inp.focus();
    }
  }

  // ---------------- date / reminder / repeat pickers ----------------
  function dueMenu(anchor, current, set) {
    const today = todayKey();
    const nextMonday = addDays(today, 7 - ((fromKey(today).getDay() + 6) % 7));
    const dateInput = h('input', { type: 'date', class: 'field', value: current || today });
    menu(anchor, [
      { icon: 'calendar', label: t('today'), hint: fmtDate(today, { weekday: 'short' }), onClick: () => set(today) },
      { icon: 'calendar', label: t('tomorrow'), hint: fmtDate(addDays(today, 1), { weekday: 'short' }), onClick: () => set(addDays(today, 1)) },
      { icon: 'calendar', label: t('nextWeek'), hint: fmtDate(nextMonday, { weekday: 'short' }), onClick: () => set(nextMonday) },
      'sep',
      { node: h('div', { class: 'menu-pick' }, h('span', { class: 'muted small' }, t('pickDate')), dateInput,
        h('button', { class: 'btn primary small', onclick: () => { if (dateInput.value) { set(dateInput.value); closeMenu(); } } }, t('save'))) },
      current && 'sep',
      current && { icon: 'trash', label: t('removeDue'), danger: true, onClick: () => set(null) }
    ], { title: t('due') });
  }

  function reminderMenu(anchor, current, set) {
    const now = new Date();
    const at = (daysAhead, hour) => {
      const d = new Date();
      d.setDate(d.getDate() + daysAhead);
      d.setHours(hour, 0, 0, 0);
      return d.toISOString();
    };
    const laterToday = new Date(now);
    laterToday.setHours(now.getHours() + 3, 0, 0, 0);
    const daysToMonday = 7 - ((now.getDay() + 6) % 7);
    const localValue = (iso) => {
      const d = iso ? new Date(iso) : new Date(Date.now() + 3600000);
      const pad = (n) => String(n).padStart(2, '0');
      return `${toKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    const dt = h('input', { type: 'datetime-local', class: 'field', value: localValue(current) });
    const timeFmt = (iso) => new Date(iso).toLocaleTimeString(locale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    const opts = [];
    if (laterToday.getDate() === now.getDate()) opts.push({ icon: 'clock', label: t('laterToday'), hint: timeFmt(laterToday.toISOString()), onClick: () => set(laterToday.toISOString()) });
    opts.push(
      { icon: 'clock', label: t('tomorrow'), hint: timeFmt(at(1, 9)), onClick: () => set(at(1, 9)) },
      { icon: 'clock', label: t('nextWeek'), hint: timeFmt(at(daysToMonday, 9)), onClick: () => set(at(daysToMonday, 9)) },
      'sep',
      { node: h('div', { class: 'menu-pick' }, h('span', { class: 'muted small' }, t('pickDateTime')), dt,
        h('button', { class: 'btn primary small', onclick: () => { if (dt.value) { set(new Date(dt.value).toISOString()); closeMenu(); } } }, t('save'))) },
      current && 'sep',
      current && { icon: 'trash', label: t('removeReminder'), danger: true, onClick: () => set(null) }
    );
    menu(anchor, opts, { title: t('reminder') });
    requestNotifyPermission();
  }

  function repeatMenu(anchor, current, set) {
    const f = current && current.freq;
    const simple = (freq) => current && f === freq && (Number(current.interval) || 1) === 1 && !(current.days && current.days.length > 1);
    menu(anchor, [
      { icon: 'repeat', label: t('daily'), checked: simple('daily'), onClick: () => set({ freq: 'daily', interval: 1 }) },
      { icon: 'repeat', label: t('weekdays'), checked: f === 'weekdays', onClick: () => set({ freq: 'weekdays', interval: 1 }) },
      { icon: 'repeat', label: t('weekly'), checked: simple('weekly'), onClick: () => set({ freq: 'weekly', interval: 1 }) },
      { icon: 'repeat', label: t('monthly'), checked: simple('monthly'), onClick: () => set({ freq: 'monthly', interval: 1 }) },
      { icon: 'repeat', label: t('yearly'), checked: simple('yearly'), onClick: () => set({ freq: 'yearly', interval: 1 }) },
      'sep',
      { icon: 'settings', label: t('custom'), onClick: () => customRepeat(current, set) },
      current && 'sep',
      current && { icon: 'trash', label: t('neverRepeat'), danger: true, onClick: () => set(null) }
    ], { title: t('repeat') });
  }

  function customRepeat(current, set) {
    const st = {
      interval: (current && current.interval) || 1,
      freq: current && current.freq !== 'weekdays' ? current.freq : 'weekly',
      days: (current && current.days) ? current.days.slice() : [new Date().getDay()]
    };
    const num = h('input', { type: 'number', min: '1', max: '99', class: 'field num', value: st.interval, oninput: (e) => { st.interval = Math.max(1, Number(e.target.value) || 1); } });
    const unit = h('select', { class: 'field', onchange: (e) => { st.freq = e.target.value; daysRow.hidden = st.freq !== 'weekly'; } },
      ['daily', 'weekly', 'monthly', 'yearly'].map((fq) => h('option', { value: fq, selected: st.freq === fq ? 'selected' : null }, t({ daily: 'days', weekly: 'weeks', monthly: 'months', yearly: 'years' }[fq]))));
    const daysRow = h('div', { class: 'days-row' }, [1, 2, 3, 4, 5, 6, 0].map((d) => {
      const b = h('button', {
        class: `day-btn${st.days.includes(d) ? ' on' : ''}`,
        title: dayName(d),
        onclick: () => {
          if (st.days.includes(d)) { if (st.days.length > 1) st.days = st.days.filter((x) => x !== d); }
          else st.days.push(d);
          b.classList.toggle('on', st.days.includes(d));
        }
      }, dayName(d, 'short').slice(0, 2));
      return b;
    }));
    daysRow.hidden = st.freq !== 'weekly';
    dialog({
      title: t('customRepeat'),
      body: h('div', { class: 'stack' }, h('div', { class: 'row' }, h('span', null, t('every')), num, unit), daysRow),
      buttons: [
        { label: t('cancel') },
        { label: t('save'), primary: true, onClick: () => set({ freq: st.freq, interval: st.interval, days: st.freq === 'weekly' ? st.days : undefined }) }
      ]
    });
  }

  // =====================================================================
  //  Settings
  // =====================================================================
  function openSettings(tab = 'general') {
    const s = S();
    const seg = (name, options, value, onPick) => h('div', { class: 'seg', role: 'radiogroup', 'aria-label': name },
      options.map(([v, label]) => h('button', {
        class: `seg-btn${value === v ? ' on' : ''}`,
        role: 'radio',
        'aria-checked': String(value === v),
        onclick: (e) => {
          onPick(v);
          e.currentTarget.parentElement.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('on'));
          e.currentTarget.classList.add('on');
        }
      }, label)));
    const toggle = (label, key, obj = s, after, opts = {}) => h('label', { class: `switch-row${opts.disabled ? ' disabled' : ''}` },
      h('span', null, label, opts.help ? h('small', { class: 'muted help' }, opts.help) : null),
      h('input', {
        type: 'checkbox',
        class: 'switch',
        checked: obj[key] ? 'checked' : null,
        disabled: opts.disabled ? 'disabled' : null,
        onchange: (e) => { obj[key] = e.target.checked; Store.emit('settings'); if (after) after(e.target.checked); }
      }));

    // ----- general -----
    const catInputs = h('div', { class: 'cat-names' }, CATEGORIES.map((c) => h('label', { class: 'cat-name-row' },
      h('span', { class: 'cat-dot big', style: { background: c.color } }),
      h('input', {
        class: 'field',
        value: catName(c.id),
        onchange: (e) => {
          s.categoryNames = s.categoryNames || {};
          const v = e.target.value.trim();
          if (v && v !== t('cat_' + c.id)) s.categoryNames[c.id] = v;
          else delete s.categoryNames[c.id];
          Store.emit('settings');
        }
      }))));
    const general = h('div', { class: 'settings' },
      h('div', { class: 'set-row' }, h('span', null, t('language')), seg(t('language'), [['nl', 'Nederlands'], ['en', 'English']], s.lang, (v) => { s.lang = v; Store.emit('settings'); dlg.close(); openSettings('general'); })),
      h('div', { class: 'set-row' }, h('span', null, t('appearance')), seg(t('appearance'), [['light', t('light')], ['dark', t('dark')], ['system', t('system')]], s.theme, (v) => { s.theme = v; Store.emit('settings'); })),
      toggle(t('smartInput'), 'smartInput', s, null, { help: t('smartInputHelp') }),
      toggle(t('confirmDelete'), 'confirmDelete'),
      toggle(t('playSound'), 'playSound'),
      toggle(t('newOnTop'), 'newOnTop'),
      toggle(t('starredTop'), 'moveStarredToTop'),
      h('h3', null, t('smartLists')),
      toggle(t('important'), 'important', s.smartLists),
      toggle(t('planned'), 'planned', s.smartLists),
      toggle(t('all'), 'all', s.smartLists),
      toggle(t('completed'), 'completed', s.smartLists),
      h('h3', null, t('categories')),
      catInputs);

    // ----- microsoft -----
    const microsoft = h('div', { class: 'settings' });
    const renderMs = () => {
      const st = MS.state;
      const parts = [];
      parts.push(h('div', { class: 'ms-head' },
        h('span', { class: 'ms-logo', html: window.ICONS.msLogo }),
        h('div', null, h('strong', null, t('msTitle')), h('p', { class: 'muted small' }, t('msIntro')))));
      if (!MS.supported()) {
        parts.push(h('p', { class: 'notice' }, t('msUnsupported')));
      } else if (!st.account) {
        parts.push(h('ul', { class: 'ms-features' },
          [t('msF1'), t('msF2'), t('msF3'), t('msF4')].map((x) => h('li', null, icon('check'), x))));
        parts.push(h('button', { class: 'btn primary big', onclick: msLogin, disabled: MS.clientId() ? null : 'disabled' }, h('span', { class: 'ms-logo small', html: window.ICONS.msLogo }), t('msSignIn')));
        if (!MS.clientId()) parts.push(h('p', { class: 'notice' }, t('msNoClientId')));
        parts.push(h('p', { class: 'muted small' }, t('msFirstSyncNote')));
      } else {
        const personal = st.account.personal;
        parts.push(h('div', { class: 'ms-account' },
          h('div', { class: 'avatar' }, (st.account.name || '?').trim().charAt(0).toUpperCase()),
          h('div', { class: 'grow' }, h('strong', null, st.account.name), h('div', { class: 'muted small' }, st.account.username)),
          h('button', { class: 'btn', onclick: async () => { await MS.logout(); toast(t('msSignedOut')); renderMs(); render(); } }, t('msSignOut'))));
        if (st.needLogin) parts.push(h('div', { class: 'notice' }, t('msLoginAgainText'), ' ', h('button', { class: 'btn small primary', onclick: msLogin }, t('msLoginAgain'))));
        const last = Store.data.sync.lastSync;
        parts.push(
          toggle(t('msSyncTodo'), 'msSync', s, (on) => { Store.syncLinked = on; if (on) MS.syncNow(); render(); }, { help: last ? t('lastSynced', { when: new Date(last).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }) : t('msSyncHelp') }),
          toggle(t('msCalendarToggle'), 'msCalendar', s, () => { MS.loadCalendar(); render(); }, { help: t('msCalendarHelp') }),
          toggle(t('msOneDriveToggle'), 'msOneDrive', s, null, { help: s.lastCloudBackup ? t('msLastBackup', { when: new Date(s.lastCloudBackup).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }) : t('msOneDriveHelp') }),
          toggle(t('msPlannerToggle'), 'msPlanner', s, () => { MS.loadPlanner(); render(); }, { help: personal ? t('msPlannerWorkOnly') : t('msPlannerHelp'), disabled: personal }),
          h('div', { class: 'row wrap gap-top' },
            s.msSync ? h('button', { class: 'btn', onclick: async (e) => { e.currentTarget.disabled = true; const ok = await MS.syncNow(); toast(ok ? t('syncDone') : t('syncError', { msg: MS.state.error || '' })); renderMs(); } }, icon('refresh'), t('syncNow')) : null,
            h('button', { class: 'btn', onclick: async () => { try { await MS.cloudBackup(); toast(t('msBackupDone')); renderMs(); } catch (err) { toast(t('msBackupFailed')); } } }, icon('upload'), t('msBackupNow')),
            h('button', { class: 'btn', onclick: msRestore }, icon('download'), t('msRestore'))));
      }
      // advanced: own app registration
      const idInput = h('input', { class: 'field', value: s.msClientId || '', placeholder: (window.KLAAR_CONFIG && window.KLAAR_CONFIG.msClientId) || '00000000-0000-0000-0000-000000000000', spellcheck: 'false' });
      parts.push(h('details', { class: 'advanced', open: MS.clientId() ? null : 'open' },
        h('summary', null, t('msAdvanced')),
        h('p', { class: 'muted small' }, t('msClientIdHelp')),
        h('div', { class: 'row' }, idInput, h('button', { class: 'btn', onclick: () => {
          const v = idInput.value.trim();
          if (v && !/^[0-9a-f-]{36}$/i.test(v)) { toast(t('msClientIdInvalid')); return; }
          s.msClientId = v;
          Store.emit('settings');
          toast(t('saved'));
          renderMs();
        } }, t('save'))),
        h('p', { class: 'muted small' }, t('msRedirectHelp'), ' ', h('code', null, native ? 'http://localhost' : location.origin + location.pathname.replace(/index\.html$/, '')))));
      microsoft.replaceChildren(...parts);
    };
    renderMs();

    // ----- desktop -----
    const desktop = native && native.desktop ? h('div', { class: 'settings' }, h('p', { class: 'muted' }, '…')) : null;
    if (desktop) {
      native.desktop.get().then((d) => {
        const set = async (patch) => {
          const r = await native.desktop.set(patch);
          if ('hotkey' in patch && patch.hotkey && r && !r.hotkeyOk) toast(t('dHotkeyFailed'));
        };
        const tg = (label, key, help, disabled) => h('label', { class: `switch-row${disabled ? ' disabled' : ''}` },
          h('span', null, label, help ? h('small', { class: 'muted help' }, help) : null),
          h('input', { type: 'checkbox', class: 'switch', checked: d[key] ? 'checked' : null, disabled: disabled ? 'disabled' : null, onchange: (e) => { d[key] = e.target.checked; set({ [key]: e.target.checked }); } }));
        const keyInput = h('input', {
          class: 'field hotkey',
          readonly: 'readonly',
          value: (d.hotkey || '').replace('CommandOrControl', d.platform === 'darwin' ? 'Cmd' : 'Ctrl'),
          placeholder: t('dHotkeyNone'),
          onkeydown: (e) => {
            e.preventDefault();
            if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
            if (e.key === 'Backspace' || e.key === 'Delete') { keyInput.value = ''; set({ hotkey: '' }); return; }
            const mods = [];
            if (e.ctrlKey || e.metaKey) mods.push('CommandOrControl');
            if (e.altKey) mods.push('Alt');
            if (e.shiftKey) mods.push('Shift');
            if (!mods.length) return;
            let k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
            if (k === ' ') k = 'Space';
            const acc = [...mods, k].join('+');
            keyInput.value = acc.replace('CommandOrControl', d.platform === 'darwin' ? 'Cmd' : 'Ctrl');
            set({ hotkey: acc });
          }
        });
        desktop.replaceChildren(
          tg(t('dTray'), 'tray', t('dTrayHelp')),
          tg(t('dCloseToTray'), 'closeToTray', t('dCloseToTrayHelp')),
          tg(t('dAutostart'), 'openAtLogin', d.canAutostart ? t('dAutostartHelp') : t('dNotAvailable'), !d.canAutostart),
          h('div', { class: 'set-row' }, h('span', null, t('dHotkey'), h('small', { class: 'muted help' }, t('dHotkeyHelp'))), keyInput),
          tg(t('dAutoUpdate'), 'autoUpdate', d.canUpdate ? t('dAutoUpdateHelp') : t('dNotAvailable'), !d.canUpdate));
      });
    }

    // ----- koppelingen -----
    const koppelingen = h('div', { class: 'settings' });
    const renderFeeds = () => {
      const list = Connectors.feeds();
      const rows = list.map((f) => {
        const busy = Connectors.state.syncing[f.id];
        const status = busy ? t('syncing')
          : f.error ? t('feedError', { msg: f.error })
          : f.lastSync ? t('feedOk', { n: f.count || 0, when: new Date(f.lastSync).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) })
          : t('feedNever');
        return h('div', { class: 'feed-row' },
          h('div', { class: 'feed-icon' }, icon('link')),
          h('div', { class: 'grow' },
            h('strong', null, f.name || new URL(f.url).hostname),
            h('div', { class: 'muted small ellipsis' }, f.url),
            h('div', { class: `small ${f.error ? 'err-text' : 'muted'}` }, status)),
          h('button', { class: 'icon-btn', title: t('syncNow'), html: window.ICONS.refresh, onclick: () => Connectors.syncFeed(f) }),
          h('button', { class: 'icon-btn', title: t('remove'), html: window.ICONS.trash, onclick: async () => {
            const withTasks = await confirmDialog(t('feedRemoveQ', { name: f.name || f.url }), t('feedRemoveText'), t('feedRemoveAll'), t('feedRemoveKeep'));
            Connectors.remove(f.id, withTasks);
            renderFeeds();
          } }));
      });

      const url = h('input', { class: 'field', placeholder: 'https://crm.jouwdomein.nl/klaar-api.php', spellcheck: 'false' });
      const token = h('input', { class: 'field', type: 'password', placeholder: t('feedTokenPh'), autocomplete: 'off' });
      const name = h('input', { class: 'field', placeholder: t('feedNamePh') });
      const myday = h('input', { type: 'checkbox', class: 'switch', checked: 'checked' });
      const result = h('p', { class: 'small muted' });
      const tryAdd = async (save) => {
        const u = url.value.trim();
        if (!Connectors.validUrl(u)) { result.className = 'small err-text'; result.textContent = t('feedBadUrl'); return; }
        result.className = 'small muted';
        result.textContent = t('feedTesting');
        try {
          const r = await Connectors.test(u, token.value.trim());
          if (!name.value.trim() && r.name) name.value = r.name;
          result.className = 'small ok-text';
          result.textContent = t('feedTestOk', { name: r.name || u, n: r.open });
          if (save) {
            Connectors.add({ name: name.value.trim() || r.name, url: u, token: token.value.trim(), myDayToday: myday.checked });
            toast(t('feedAdded'));
            renderFeeds();
          }
        } catch (e) {
          result.className = 'small err-text';
          result.textContent = t('feedTestFail', { msg: e.message === 'offline' ? t('feedUnreachable') : e.message });
        }
      };

      koppelingen.replaceChildren(
        h('p', { class: 'muted small' }, t('feedsIntro')),
        rows.length ? h('div', { class: 'feed-list' }, rows) : h('p', { class: 'notice' }, t('feedsNone')),
        h('h3', null, t('feedAdd')),
        h('div', { class: 'stack' },
          h('label', { class: 'field-label' }, t('feedUrl'), url),
          h('label', { class: 'field-label' }, t('feedToken'), token),
          h('label', { class: 'field-label' }, t('feedName'), name),
          h('label', { class: 'switch-row' }, h('span', null, t('feedMyDay')), myday),
          h('div', { class: 'row' },
            h('button', { class: 'btn', onclick: () => tryAdd(false) }, t('feedTest')),
            h('button', { class: 'btn primary', onclick: () => tryAdd(true) }, t('feedSave'))),
          result),
        h('p', { class: 'muted small' }, t('feedsPhone')));
    };
    renderFeeds();

    // ----- data -----
    const fileInput = h('input', {
      type: 'file',
      accept: 'application/json,.json',
      hidden: true,
      onchange: async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          Store.importJSON(await file.text());
          toast(t('imported'), { label: t('undo'), onClick: () => Store.undo() });
          dlg.close();
        } catch {
          toast(t('importFailed'));
        }
      }
    });
    const data = h('div', { class: 'settings' },
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', onclick: exportData }, icon('download'), t('export')),
        h('button', { class: 'btn', onclick: () => fileInput.click() }, icon('upload'), t('import')),
        h('button', { class: 'btn', onclick: exportIcs }, icon('calendar'), t('exportIcs')),
        fileInput),
      h('p', { class: 'muted small', id: 'data-path' }, native ? '' : t('browserStorage')),
      h('h3', null, t('shortcuts')),
      h('div', { class: 'shortcuts' },
        [['Ctrl/⌘ + N', t('scNew')], ['Ctrl/⌘ + F', t('scSearch')], ['Ctrl/⌘ + L', t('scList')], ['Ctrl/⌘ + 1…9', t('scLists')], ['Ctrl/⌘ + Z', t('undo')], [t('space'), t('scComplete')], ['Delete', t('deleteTask')], ['Esc', t('close')]]
          .map(([k, v]) => h('div', { class: 'sc' }, h('kbd', null, k), h('span', null, v)))),
      h('h3', null, t('smartInput')),
      h('div', { class: 'examples' }, [t('ex1'), t('ex2'), t('ex3'), t('ex4'), t('ex5')].map((x) => h('code', null, x))),
      h('p', { class: 'muted small about', id: 'about' }, 'Klaar · MIT · ', h('a', { href: 'https://github.com/anonymous2345566/Have-Done', target: '_blank', rel: 'noopener' }, 'GitHub')));

    // ----- tabs -----
    const tabs = [['general', t('tabGeneral'), general], ['microsoft', 'Microsoft', microsoft], ['koppelingen', t('tabLinks'), koppelingen], desktop && ['desktop', t('tabDesktop'), desktop], ['data', t('tabData'), data]].filter(Boolean);
    const panel = h('div', { class: 'tab-panel' });
    const tabBar = h('div', { class: 'tabs', role: 'tablist' });
    const show = (id) => {
      tabBar.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
      panel.replaceChildren(tabs.find((x) => x[0] === id)[2]);
    };
    tabs.forEach(([id, label]) => tabBar.append(h('button', { class: 'tab', role: 'tab', dataset: { tab: id }, onclick: () => show(id) }, label)));
    show(tabs.find((x) => x[0] === tab) ? tab : 'general');
    const unsub = () => { msSettingsRefresh = null; feedsSettingsRefresh = null; };
    msSettingsRefresh = renderMs;
    feedsSettingsRefresh = () => { if (koppelingen.isConnected && !koppelingen.contains(document.activeElement)) renderFeeds(); };
    const dlg = dialog({ title: t('settings'), body: h('div', null, tabBar, panel), wide: true, buttons: [{ label: t('done'), primary: true }], onClose: unsub });
    if (native) {
      native.dataPath().then((p) => { const el = document.getElementById('data-path'); if (el) el.textContent = t('dataLocation', { path: p }); });
      native.version().then((v) => { const el = document.getElementById('about'); if (el) el.firstChild.textContent = `Klaar ${v} · MIT · `; });
    }
  }
  let msSettingsRefresh = null;
  let feedsSettingsRefresh = null;

  async function msLogin() {
    if (!MS.clientId()) { openSettings('microsoft'); return; }
    if (!MS.supported()) { toast(t('msUnsupported')); return; }
    toast(t('msBrowserOpened'));
    try {
      await MS.login();
      toast(t('msSignedIn', { name: MS.state.account.name }));
      render();
      if (msSettingsRefresh) msSettingsRefresh();
    } catch (e) {
      toast(t('msLoginFailed', { msg: e.message }));
    }
  }

  async function msRestore() {
    let info = null;
    try { info = await MS.cloudBackupInfo(); } catch { toast(t('msBackupFailed')); return; }
    if (!info) { toast(t('msNoBackup')); return; }
    const when = new Date(info.lastModifiedDateTime).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    const ok = await confirmDialog(t('msRestoreQ'), t('msRestoreText', { when }), t('msRestore'), t('cancel'));
    if (!ok) return;
    try {
      await MS.cloudRestore();
      toast(t('msRestored'), { label: t('undo'), onClick: () => Store.undo() });
    } catch {
      toast(t('msBackupFailed'));
    }
  }

  function scheduleDialog(task) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const date = h('input', { type: 'date', class: 'field', value: task.due && task.due >= todayKey() ? task.due : todayKey() });
    const time = h('input', { type: 'time', class: 'field', value: `${pad(Math.min(23, now.getHours() + 1))}:00` });
    const dur = h('select', { class: 'field' }, [15, 30, 45, 60, 90, 120, 180, 240].map((m) =>
      h('option', { value: m, selected: m === 60 ? 'selected' : null }, m < 60 ? `${m} ${t('minutes')}` : `${m / 60} ${t(m === 60 ? 'hour' : 'hours')}`)));
    dialog({
      title: t('scheduleTitle'),
      body: h('div', { class: 'stack' },
        h('p', { class: 'muted' }, task.title),
        h('label', { class: 'field-label' }, t('date'), date),
        h('div', { class: 'row' }, h('label', { class: 'field-label grow' }, t('time'), time), h('label', { class: 'field-label grow' }, t('duration'), dur))),
      buttons: [
        { label: t('cancel') },
        { label: t('schedule'), primary: true, onClick: () => {
          if (!date.value || !time.value) return false;
          MS.scheduleEvent(task, { date: date.value, time: time.value, minutes: Number(dur.value) })
            .then(() => toast(t('scheduled')))
            .catch(() => toast(t('calendarFailed')));
        } }
      ]
    });
  }

  function exportIcs() {
    const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const fold = (line) => {
      const out = [];
      let rest = line;
      while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = ' ' + rest.slice(74); }
      out.push(rest);
      return out.join('\r\n');
    };
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const DAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    const rrule = (r) => {
      if (!r) return null;
      const n = Math.max(1, Number(r.interval) || 1);
      if (r.freq === 'weekdays') return 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
      const f = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' }[r.freq];
      return `RRULE:FREQ=${f};INTERVAL=${n}${r.freq === 'weekly' && r.days && r.days.length ? ';BYDAY=' + r.days.map((d) => DAY[d]).join(',') : ''}`;
    };
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Klaar//Takenapp//NL', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Klaar'];
    let n = 0;
    Store.data.tasks.filter((x) => x.due && !x.done).forEach((x) => {
      n++;
      const start = x.due.replace(/-/g, '');
      const end = addDays(x.due, 1).replace(/-/g, '');
      lines.push('BEGIN:VEVENT', `UID:${x.id}@klaar`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${end}`,
        `SUMMARY:${esc((x.important ? '⭐ ' : '') + x.title)}`);
      if (x.note) lines.push(`DESCRIPTION:${esc(x.note)}`);
      lines.push(`CATEGORIES:${esc(listName(Store.list(x.listId)))}`);
      const rr = rrule(x.repeat);
      if (rr) lines.push(rr);
      if (x.reminder) {
        const r = new Date(x.reminder).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
        lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(x.title)}`, `TRIGGER;VALUE=DATE-TIME:${r}`, 'END:VALARM');
      }
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.map(fold).join('\r\n') + '\r\n'], { type: 'text/calendar' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `klaar-${todayKey()}.ics` });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast(t('icsExported', { n }));
  }

  function exportData() {
    const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `klaar-backup-${todayKey()}.json` });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // =====================================================================
  //  Navigation, sidebar, reminders, keyboard
  // =====================================================================
  function go(view) {
    ui.view = view;
    ui.renamingList = false;
    if (view.type !== 'search') {
      ui.query = '';
      const si = $sidebar.querySelector('.search-input');
      if (si) si.value = '';
    }
    if (window.innerWidth < 720) S().sidebarOpen = false;
    render();
  }

  function toggleSidebar(open) {
    S().sidebarOpen = open;
    Store.save();
    $app.classList.toggle('sidebar-closed', !open);
  }

  function requestNotifyPermission() {
    if (!native && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }

  function checkReminders() {
    const now = Date.now();
    let changed = false;
    Store.data.tasks.forEach((task) => {
      if (task.reminder && !task.reminded && !task.done && new Date(task.reminder).getTime() <= now) {
        task.reminded = true;
        changed = true;
        // only fire for reminders that are not ancient (e.g. app was closed for a week)
        if (now - new Date(task.reminder).getTime() < 24 * 3600 * 1000) {
          if (S().playSound) ding();
          try {
            if ('Notification' in window && Notification.permission === 'granted') {
              const n = new Notification(t('reminder'), { body: task.title, icon: 'icon.png', tag: task.id });
              n.onclick = () => {
                if (native) native.focus(); else window.focus();
                ui.selected = task.id;
                render();
              };
            }
          } catch { /* ignore */ }
          toast(`🔔 ${task.title}`, { label: t('open'), onClick: () => { ui.selected = task.id; render(); } });
        }
      }
    });
    if (changed) Store.emit('tasks');
    if (Store.rollDay()) render();
  }

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (mod && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      if (ui.view.type === 'search' || ui.view.id === 'completed') go({ type: 'list', id: 'inbox' });
      const inp = $main.querySelector('.add-input');
      if (inp) inp.focus();
    } else if (mod && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      if (!S().sidebarOpen) toggleSidebar(true);
      $sidebar.querySelector('.search-input').focus();
    } else if (mod && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      if (!S().sidebarOpen) toggleSidebar(true);
      $sidebar.querySelector('.new-list-input').focus();
    } else if (mod && /^[1-9]$/.test(e.key) && !e.altKey) {
      e.preventDefault();
      const items = [...$sidebar.querySelectorAll('.nav-item')];
      const target = items[Number(e.key) - 1];
      if (target) target.click();
    } else if (mod && e.key.toLowerCase() === 'z' && !inField) {
      e.preventDefault();
      if (Store.undo()) toast(t('undone'));
    } else if (e.key === 'Escape' && !inField) {
      closeMenu();
      if (ui.selected) { ui.selected = null; renderMainSelection(); renderDetails(); }
    }
  });

  window.addEventListener('beforeunload', () => Store.flush());

  // on small screens the sidebar floats over the content: tap outside to close it
  $main.addEventListener('mousedown', () => {
    if (window.innerWidth < 720 && S().sidebarOpen) toggleSidebar(false);
  });

  // =====================================================================
  //  Boot
  // =====================================================================
  async function boot() {
    await Store.load();
    window.I18N.setLang(S().lang);
    if (window.innerWidth < 720) S().sidebarOpen = false;
    // first run: a few example tasks
    if (!Store.data.tasks.length && !S().seeded) {
      S().seeded = true;
      const today = todayKey();
      Store.addTask({ title: t('demo1'), myDay: today, important: true, steps: [{ id: Klaar.uid(), title: t('demo1s1'), done: true }, { id: Klaar.uid(), title: t('demo1s2'), done: false }] });
      Store.addTask({ title: t('demo2'), myDay: today, due: today });
      Store.addTask({ title: t('demo3'), due: addDays(today, 1), repeat: { freq: 'weekly', interval: 1 }, categories: ['green'] });
    }
    Store.subscribe((what) => {
      if (what === 'settings') window.I18N.setLang(S().lang);
      if (what === 'sync' || what === 'feed') softRender();
      else render();
    });

    // Microsoft account: re-render quietly when sync, calendar or Planner change
    let msTimer = null;
    MS.onChange(() => {
      clearTimeout(msTimer);
      msTimer = setTimeout(() => { softRender(); if (msSettingsRefresh) msSettingsRefresh(); }, 120);
    });
    await MS.init().catch((e) => console.warn('Microsoft init failed', e));
    if (MS.state.justSignedIn && MS.state.account) {
      MS.state.justSignedIn = false;
      setTimeout(() => toast(t('msSignedIn', { name: MS.state.account.name })), 300);
    } else if (MS.state.error && !MS.state.account) {
      setTimeout(() => toast(t('msLoginFailed', { msg: MS.state.error })), 300);
    }

    Connectors.init();
    Connectors.onChange(() => { if (feedsSettingsRefresh) feedsSettingsRefresh(); });

    if (native && native.quickAdd) {
      native.quickAdd.onTask((text) => {
        const parsed = parseSmart(text);
        const fields = { title: parsed.title || text, listId: parsed.listId || 'inbox' };
        ['due', 'reminder', 'repeat', 'categories'].forEach((k) => { if (parsed[k]) fields[k] = parsed[k]; });
        if (parsed.important) fields.important = true;
        if (parsed.myDay) fields.myDay = todayKey();
        Store.addTask(fields);
        toast(t('quickAdded', { title: fields.title, list: listName(Store.list(fields.listId)) }));
      });
    }
    if (native && native.updates) {
      native.updates.onStatus((st) => {
        if (st.status === 'ready') {
          ui.update = st.version || 'new';
          renderSidebar();
          toast(t('updateReady', { v: st.version || '' }), { label: t('restartNow'), onClick: () => native.updates.install() });
        }
      });
    }
    render();
    checkReminders();
    setInterval(checkReminders, 15000);
    document.body.classList.add('ready');
  }

  // expose a little for debugging/tests
  window.KlaarApp = { ui, render, go };
  boot();
})();
