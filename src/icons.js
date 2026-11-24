// Small hand-made SVG icon set (stroke icons, 24x24).
(function () {
  const p = (d, extra = '') =>
    `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;

  window.ICONS = {
    sun: p('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>'),
    star: p('<path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>'),
    starFilled: p('<path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="currentColor"/>'),
    calendar: p('<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>'),
    infinity: p('<path d="M7 9c-2.2 0-4 1.3-4 3s1.8 3 4 3c3.5 0 6.5-6 10-6 2.2 0 4 1.3 4 3s-1.8 3-4 3c-3.5 0-6.5-6-10-6z"/>'),
    checkCircle: p('<circle cx="12" cy="12" r="8.5"/><path d="M8.2 12.3l2.5 2.5 5-5.2"/>'),
    home: p('<path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>'),
    list: p('<path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11"/><circle cx="4.5" cy="6.5" r=".9" fill="currentColor"/><circle cx="4.5" cy="12" r=".9" fill="currentColor"/><circle cx="4.5" cy="17.5" r=".9" fill="currentColor"/>'),
    plus: p('<path d="M12 5v14M5 12h14"/>'),
    menu: p('<path d="M4 6.5h16M4 12h16M4 17.5h16"/>'),
    search: p('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>'),
    close: p('<path d="M6 6l12 12M18 6L6 18"/>'),
    more: p('<circle cx="5.5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor"/>'),
    bell: p('<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
    repeat: p('<path d="M17 3.5l3 3-3 3"/><path d="M4 11.5v-1a4 4 0 0 1 4-4h12M7 20.5l-3-3 3-3"/><path d="M20 12.5v1a4 4 0 0 1-4 4H4"/>'),
    trash: p('<path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13.5h9l1-13.5M10 10.5v6M14 10.5v6"/>'),
    note: p('<path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4M8 12h8M8 16h5"/>'),
    tag: p('<path d="M3.5 12.5V4.5h8l9 9-8 8z"/><circle cx="8" cy="9" r="1.3"/>'),
    sort: p('<path d="M7 4v16M3.5 16.5L7 20l3.5-3.5M17 20V4M13.5 7.5L17 4l3.5 3.5"/>'),
    palette: p('<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 1.8-.9 1.4-1.9-.5-1.2.3-2.4 1.6-2.4h1.7a3.8 3.8 0 0 0 3.8-3.8C20.5 7.4 16.7 3.5 12 3.5z"/><circle cx="7.5" cy="11" r="1" fill="currentColor"/><circle cx="10" cy="7.5" r="1" fill="currentColor"/><circle cx="14.5" cy="7.5" r="1" fill="currentColor"/>'),
    edit: p('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
    group: p('<rect x="3.5" y="4" width="17" height="6" rx="1.5"/><rect x="3.5" y="14" width="17" height="6" rx="1.5"/>'),
    chevronRight: p('<path d="M9.5 6l6 6-6 6"/>'),
    chevronDown: p('<path d="M6 9.5l6 6 6-6"/>'),
    arrowUp: p('<path d="M12 19V5M6 11l6-6 6 6"/>'),
    settings: p('<circle cx="12" cy="12" r="3"/><path d="M19.4 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1h-.2a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h0a1.6 1.6 0 0 0 1-1.5v-.2a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v0a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'),
    bulb: p('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>'),
    move: p('<path d="M4 12h12M12 8l4 4-4 4"/><path d="M20 4v16"/>'),
    print: p('<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="8" rx="1.5"/><path d="M7 14h10v6.5H7z"/>'),
    check: p('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    clock: p('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    undo: p('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
    download: p('<path d="M12 4v11M7 10.5l5 5 5-5M4.5 20h15"/>'),
    upload: p('<path d="M12 15.5V4.5M7 9l5-5 5 5M4.5 20h15"/>'),
    logo: `<svg viewBox="0 0 64 64" width="28" height="28" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f8bff"/><stop offset="1" stop-color="#2346b8"/></linearGradient></defs><rect x="4" y="4" width="56" height="56" rx="16" fill="url(#lg)"/><path d="M19 33.5l9 9 18-20" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  };
})();
