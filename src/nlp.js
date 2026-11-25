// Klaar — smart input: turns "morgen 9:00 accu laden ! #werk elke week" into task fields.
// Works for Dutch and English. Pure function, no DOM — also used by the quick-add window and tests.
(function (root) {
  const pad = (n) => String(n).padStart(2, '0');
  const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  const WEEKDAYS = {
    zondag: 0, maandag: 1, dinsdag: 2, woensdag: 3, donderdag: 4, vrijdag: 5, zaterdag: 6,
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
    sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6,
    zo: 0, ma: 1, di: 2, wo: 3, do: 4, vr: 5, za: 6
  };
  const LONG_DAYS = 'zondag|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|sunday|monday|tuesday|wednesday|thursday|friday|saturday';
  const SHORT_DAYS = 'zo|ma|di|wo|do|vr|za|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat';
  const MONTHS = {
    jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mrt: 3, maart: 3, mar: 3, march: 3,
    apr: 4, april: 4, mei: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, aug: 8, augustus: 8, august: 8,
    sep: 9, sept: 9, september: 9, okt: 10, oct: 10, oktober: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
  };
  const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
  const CATS = {
    blauw: 'blue', blue: 'blue', groen: 'green', green: 'green', oranje: 'orange', orange: 'orange',
    paars: 'purple', purple: 'purple', rood: 'red', red: 'red', geel: 'yellow', yellow: 'yellow'
  };

  // word boundary that understands accented letters
  const B = '(?<![\\p{L}\\p{N}])';
  const E = '(?![\\p{L}\\p{N}])';
  const rx = (src) => new RegExp(`${B}(?:${src})${E}`, 'iu');

  function nextWeekday(from, dow, forceNext) {
    let diff = (dow - from.getDay() + 7) % 7;
    if (diff === 0 && forceNext) diff = 7;
    if (diff === 0) diff = 7; // "maandag" on a monday means next week's monday
    return addDays(from, diff);
  }

  /**
   * @param {string} text
   * @param {{now?: Date, lists?: {id:string,name:string}[], categoryNames?: Object}} opts
   */
  function parse(text, opts = {}) {
    const now = opts.now ? new Date(opts.now) : new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let s = ` ${text} `;
    const out = { tokens: [] };
    const take = (re, fn) => {
      const m = re.exec(s);
      if (!m) return false;
      if (fn(m) === false) return false;
      s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
      return true;
    };

    // ---------- repeat ----------
    const everyN = rx('(?:elke|iedere|every)\\s+(\\d{1,2})\\s+(dagen|weken|maanden|jaar|days|weeks|months|years)');
    take(everyN, (m) => {
      const unit = m[2].toLowerCase();
      const freq = /^(dagen|days)$/.test(unit) ? 'daily' : /^(weken|weeks)$/.test(unit) ? 'weekly' : /^(maanden|months)$/.test(unit) ? 'monthly' : 'yearly';
      out.repeat = { freq, interval: Math.max(1, Number(m[1])) };
    });
    if (!out.repeat) {
      const everyDay = rx(`(?:elke|iedere|every)\\s+((?:${LONG_DAYS}|${SHORT_DAYS})(?:\\s*(?:,|en|and|&)\\s*(?:${LONG_DAYS}|${SHORT_DAYS}))*)`);
      take(everyDay, (m) => {
        const days = m[1].toLowerCase().split(/\s*(?:,|en|and|&)\s*/).map((d) => WEEKDAYS[d]).filter((d) => d !== undefined);
        if (!days.length) return false;
        out.repeat = { freq: 'weekly', interval: 1, days };
        const first = days.includes(today.getDay())
          ? today
          : days.map((d) => nextWeekday(today, d, false)).sort((a, b) => a - b)[0];
        out.due = key(first);
      });
    }
    if (!out.repeat) {
      const simple = [
        ['(?:elke|iedere)\\s+werkdag|werkdagen|every\\s+weekday|weekdays', { freq: 'weekdays', interval: 1 }],
        ['(?:elke|iedere)\\s+dag|dagelijks|every\\s+day|daily', { freq: 'daily', interval: 1 }],
        ['(?:elke|iedere)\\s+week|wekelijks|every\\s+week|weekly', { freq: 'weekly', interval: 1 }],
        ['(?:elke|iedere)\\s+maand|maandelijks|every\\s+month|monthly', { freq: 'monthly', interval: 1 }],
        ['(?:elk|ieder)\\s+jaar|jaarlijks|every\\s+year|yearly|annually', { freq: 'yearly', interval: 1 }]
      ];
      for (const [src, rep] of simple) {
        if (take(rx(src), () => { out.repeat = { ...rep }; })) break;
      }
    }
    if (out.repeat) out.tokens.push({ type: 'repeat', value: out.repeat });

    // ---------- time (becomes a reminder) ----------
    let time = null;
    const timeRes = [
      rx('(?:om|at|@)\\s*(\\d{1,2})(?:[:.](\\d{2}))?\\s*(am|pm|u|uur)?'),
      rx('(\\d{1,2})[:.](\\d{2})\\s*(am|pm|u|uur)?'),
      rx('(\\d{1,2})\\s*(am|pm|u|uur)')
    ];
    for (const re of timeRes) {
      if (take(re, (m) => {
        let h = Number(m[1]);
        const min = m[2] ? Number(m[2]) : 0;
        const suf = (m[3] || '').toLowerCase();
        if (suf === 'pm' && h < 12) h += 12;
        if (suf === 'am' && h === 12) h = 0;
        if (h > 23 || min > 59) return false;
        time = { h, min };
      })) break;
    }

    // ---------- date ----------
    const dateRules = [
      [rx('overmorgen|day\\s+after\\s+tomorrow'), () => addDays(today, 2)],
      [rx('vandaag|today|vanavond|tonight'), () => today],
      [rx('morgen|tomorrow|tmrw'), () => addDays(today, 1)],
      [rx('volgende\\s+week|next\\s+week'), () => nextWeekday(today, 1, true)],
      [rx('volgende\\s+maand|next\\s+month'), () => new Date(today.getFullYear(), today.getMonth() + 1, 1)],
      [rx('(?:over|in)\\s+(\\d{1,3})\\s+(dag|dagen|day|days|week|weken|weeks)'), (m) => addDays(today, Number(m[1]) * (/^w/i.test(m[2]) ? 7 : 1))],
      [rx(`(?:volgende|next)\\s+(${LONG_DAYS}|${SHORT_DAYS})`), (m) => nextWeekday(today, WEEKDAYS[m[1].toLowerCase()], true)],
      [rx(`(?:op\\s+|on\\s+)?(${LONG_DAYS})`), (m) => nextWeekday(today, WEEKDAYS[m[1].toLowerCase()], false)],
      [rx(`(?:op|on)\\s+(${SHORT_DAYS})`), (m) => nextWeekday(today, WEEKDAYS[m[1].toLowerCase()], false)],
      [rx(`(\\d{1,2})(?:e|ste|de|st|nd|rd|th)?\\s+(${MONTH_RE})\\.?(?:\\s+(\\d{4}))?`), (m) => dateOf(Number(m[1]), MONTHS[m[2].toLowerCase()], m[3])],
      [rx(`(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`), (m) => dateOf(Number(m[2]), MONTHS[m[1].toLowerCase()], m[3])],
      [rx('(\\d{1,2})[-/](\\d{1,2})(?:[-/](\\d{2,4}))?'), (m) => dateOf(Number(m[1]), Number(m[2]), m[3])]
    ];
    function dateOf(day, month, year) {
      if (!month || month > 12 || day < 1 || day > 31) return null;
      let y = year ? Number(year.length === 2 ? '20' + year : year) : today.getFullYear();
      let d = new Date(y, month - 1, day);
      if (d.getMonth() !== month - 1) return null;
      if (!year && d < today) d = new Date(y + 1, month - 1, day);
      return d;
    }
    let date = null;
    if (!out.repeat || !out.due) {
      for (const [re, fn] of dateRules) {
        if (take(re, (m) => { const d = fn(m); if (!d) return false; date = d; })) break;
      }
    }
    if (date) out.due = key(date);
    if (out.repeat && !out.due) out.due = key(today);
    if (out.due) out.tokens.push({ type: 'due', value: out.due });

    if (time) {
      let base = out.due ? new Date(out.due + 'T00:00:00') : new Date(today);
      base.setHours(time.h, time.min, 0, 0);
      if (!out.due && base <= now) base = addDays(base, 1);
      out.reminder = base.toISOString();
      out.tokens.push({ type: 'reminder', value: out.reminder });
    }

    // ---------- importance, My Day ----------
    if (take(/(^|\s)!{1,3}(?=\s|$)/, () => {}) || take(/(?<=\S)!{2,3}(?=\s|$)/, () => {})) {
      out.important = true;
      out.tokens.push({ type: 'important' });
    }
    if (take(/(^|\s)\*(?=\s|$)/, () => {}) || take(rx('#(?:mijndag|myday)'), () => {})) {
      out.myDay = true;
      out.tokens.push({ type: 'myday' });
    }

    // ---------- #categories and @list ----------
    const custom = opts.categoryNames || {};
    let m;
    const hashRe = /(^|\s)#([\p{L}\p{N}_-]+)/u;
    while ((m = hashRe.exec(s))) {
      const word = m[2].toLowerCase();
      let cat = CATS[word];
      if (!cat) cat = Object.keys(custom).find((id) => (custom[id] || '').toLowerCase().replace(/\s+/g, '') === word);
      if (!cat) break;
      out.categories = [...new Set([...(out.categories || []), cat])];
      out.tokens.push({ type: 'category', value: cat });
      s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
    }
    if (opts.lists && opts.lists.length) {
      const atRe = /(^|\s)@([\p{L}\p{N}_-]+)/u;
      const am = atRe.exec(s);
      if (am) {
        const want = am[2].toLowerCase();
        const norm = (n) => (n || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        const hit = opts.lists.find((l) => norm(l.name) === want) || opts.lists.find((l) => norm(l.name).startsWith(want));
        if (hit) {
          out.listId = hit.id;
          out.tokens.push({ type: 'list', value: hit.id, label: hit.name });
          s = s.slice(0, am.index) + ' ' + s.slice(am.index + am[0].length);
        }
      }
    }

    out.title = s.replace(/\s{2,}/g, ' ').trim();
    if (!out.title) out.title = text.trim();
    return out;
  }

  const api = { parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KlaarNLP = api;
})(typeof window !== 'undefined' ? window : globalThis);
