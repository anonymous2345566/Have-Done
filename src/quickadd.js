// Klaar — quick add window (opened with the global hotkey or from the tray)
(function () {
  const input = document.getElementById('q');
  const chips = document.getElementById('chips');
  const hint = document.getElementById('hint');
  const en = !(navigator.language || 'nl').toLowerCase().startsWith('nl');
  if (en) {
    input.placeholder = 'Add a task…  e.g. tomorrow 9am send quote !';
    hint.textContent = 'Enter = save · Esc = close';
  }
  const fmt = (iso, withTime) => new Date(iso).toLocaleString(en ? 'en-GB' : 'nl-NL', withTime
    ? { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { weekday: 'short', day: 'numeric', month: 'short' });
  const REP = { daily: en ? 'daily' : 'dagelijks', weekdays: en ? 'weekdays' : 'werkdagen', weekly: en ? 'weekly' : 'wekelijks', monthly: en ? 'monthly' : 'maandelijks', yearly: en ? 'yearly' : 'jaarlijks' };

  function render() {
    const r = window.KlaarNLP.parse(input.value || '');
    chips.replaceChildren();
    r.tokens.forEach((tk) => {
      const c = document.createElement('span');
      c.className = 'chip';
      c.textContent = {
        due: () => '📅 ' + fmt(tk.value + 'T12:00:00'),
        reminder: () => '⏰ ' + fmt(tk.value, true),
        repeat: () => '🔁 ' + REP[tk.value.freq] + (tk.value.interval > 1 ? ` ×${tk.value.interval}` : ''),
        important: () => '⭐',
        myday: () => en ? '☀️ My Day' : '☀️ Mijn dag',
        category: () => '🏷️ ' + tk.value,
        list: () => '📋 ' + (tk.label || '')
      }[tk.type]();
      chips.append(c);
    });
    chips.append(hint);
  }
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) window.klaarNative.quickAdd.submit(input.value);
    if (e.key === 'Escape') window.klaarNative.quickAdd.close();
  });
  window.addEventListener('focus', () => input.focus());
})();
