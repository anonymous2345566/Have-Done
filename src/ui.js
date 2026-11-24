// Klaar — tiny DOM + UI helpers (elements, popover menus, dialogs, toasts).
(function () {
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style' && typeof v === 'object') {
          for (const [sk, sv] of Object.entries(v)) {
            if (sk.startsWith('--')) el.style.setProperty(sk, sv);
            else el.style[sk] = sv;
          }
        }
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'value') el.value = v;
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const icon = (name, cls = '') => h('span', { class: `ic ${cls}`, html: window.ICONS[name] || '' });

  // ---------- popover menu ----------
  let openMenu = null;
  function closeMenu() {
    if (openMenu) {
      openMenu.remove();
      openMenu = null;
      document.removeEventListener('mousedown', outsideMenu, true);
    }
  }
  function outsideMenu(e) {
    if (openMenu && !openMenu.contains(e.target)) closeMenu();
  }

  /**
   * items: [{icon, label, hint, danger, checked, onClick, submenu}] | 'sep' | {node}
   * at: Element (anchor) or {x, y}
   */
  function menu(at, items, opts = {}) {
    closeMenu();
    const box = h('div', { class: 'menu', role: 'menu' });
    if (opts.title) box.append(h('div', { class: 'menu-title' }, opts.title));
    items.filter(Boolean).forEach((it) => {
      if (it === 'sep') return box.append(h('div', { class: 'menu-sep' }));
      if (it.node) return box.append(it.node);
      const b = h(
        'button',
        {
          class: `menu-item${it.danger ? ' danger' : ''}${it.checked ? ' checked' : ''}`,
          role: 'menuitem',
          onclick: (e) => {
            e.stopPropagation();
            if (it.submenu) {
              menu(b, it.submenu, { side: 'right', title: it.label });
              return;
            }
            if (!it.keepOpen) closeMenu();
            it.onClick && it.onClick(e);
          }
        },
        it.icon ? icon(it.icon) : h('span', { class: 'ic' }),
        h('span', { class: 'menu-label' }, it.label),
        it.hint ? h('span', { class: 'menu-hint' }, it.hint) : null,
        it.checked ? icon('check', 'menu-check') : null,
        it.submenu ? icon('chevronRight', 'menu-check') : null
      );
      box.append(b);
    });
    document.body.append(box);
    position(box, at, opts.side);
    openMenu = box;
    setTimeout(() => document.addEventListener('mousedown', outsideMenu, true));
    const first = box.querySelector('button, input, select');
    if (first && !opts.noFocus) first.focus({ preventScroll: true });
    return box;
  }

  function position(box, at, side) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const bw = box.offsetWidth;
    const bh = box.offsetHeight;
    let x;
    let y;
    if (at instanceof Element) {
      const r = at.getBoundingClientRect();
      if (side === 'right') {
        x = r.right + 4;
        y = r.top;
      } else {
        x = r.left;
        y = r.bottom + 4;
      }
      if (y + bh > vh - 8) y = Math.max(8, r.top - bh - 4);
    } else {
      x = at.x;
      y = at.y;
      if (y + bh > vh - 8) y = Math.max(8, vh - bh - 8);
    }
    if (x + bw > vw - 8) x = Math.max(8, vw - bw - 8);
    box.style.left = x + 'px';
    box.style.top = y + 'px';
  }

  // ---------- dialogs ----------
  function dialog({ title, body, buttons = [], onClose, wide }) {
    closeMenu();
    const root = document.getElementById('overlay-root');
    const close = () => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      onClose && onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        const primary = backdrop.querySelector('.btn.primary');
        if (primary && !e.target.classList.contains('btn')) {
          e.preventDefault();
          primary.click();
        }
      }
    };
    const box = h(
      'div',
      { class: `dialog${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true' },
      h('h2', { class: 'dialog-title' }, title),
      h('div', { class: 'dialog-body' }, body),
      buttons.length
        ? h(
            'div',
            { class: 'dialog-buttons' },
            buttons.map((b) =>
              h(
                'button',
                {
                  class: `btn${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}`,
                  onclick: () => {
                    const keep = b.onClick && b.onClick() === false;
                    if (!keep) close();
                  }
                },
                b.label
              )
            )
          )
        : null
    );
    const backdrop = h('div', {
      class: 'backdrop',
      onmousedown: (e) => { if (e.target === backdrop) close(); }
    }, box);
    root.append(backdrop);
    document.addEventListener('keydown', onKey, true);
    const f = box.querySelector('input, textarea, select') || box.querySelector('.btn.primary');
    if (f) setTimeout(() => { f.focus(); if (f.select) f.select(); });
    return { close, box };
  }

  function confirmDialog(title, text, okLabel, cancelLabel) {
    return new Promise((resolve) => {
      let result = false;
      dialog({
        title,
        body: h('p', { class: 'muted' }, text),
        buttons: [
          { label: cancelLabel },
          { label: okLabel, primary: true, danger: true, onClick: () => { result = true; } }
        ],
        onClose: () => resolve(result)
      });
    });
  }

  function promptDialog(title, value, okLabel, cancelLabel, placeholder = '') {
    return new Promise((resolve) => {
      let result = null;
      const input = h('input', { class: 'field', value: value || '', placeholder });
      dialog({
        title,
        body: input,
        buttons: [
          { label: cancelLabel },
          { label: okLabel, primary: true, onClick: () => { result = input.value.trim(); } }
        ],
        onClose: () => resolve(result)
      });
    });
  }

  // ---------- toasts ----------
  function toast(text, action) {
    const root = document.getElementById('toast-root');
    const t = h(
      'div',
      { class: 'toast' },
      h('span', null, text),
      action
        ? h('button', { class: 'toast-action', onclick: () => { action.onClick(); t.remove(); } }, action.label)
        : null
    );
    root.append(t);
    setTimeout(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, action ? 6000 : 3500);
  }

  // ---------- little "ding" when completing a task ----------
  let audioCtx = null;
  function ding() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;
      [880, 1318.5].forEach((f, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, now + i * 0.08);
        g.gain.exponentialRampToValueAtTime(0.12, now + i * 0.08 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.08 + 0.35);
        o.connect(g).connect(audioCtx.destination);
        o.start(now + i * 0.08);
        o.stop(now + i * 0.08 + 0.4);
      });
    } catch { /* audio not available */ }
  }

  window.UI = { h, icon, menu, closeMenu, dialog, confirmDialog, promptDialog, toast, ding, position };
})();
