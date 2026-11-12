// Dibs content script. Injected into the job page only after the user clicks Dibs (activeTab).
// It does three things: (1) reads the visible text, (2) turns it into notes, (3) paints
// marker-pen highlights and a little robot badge on the page. It never changes the page's
// own text and never sends anything anywhere: results go back to the side panel only.
(() => {
  if (window.__dibsLoaded) return;
  window.__dibsLoaded = true;

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION']);
  const MONTHS = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';

  const MONEY_RE = /\$\s?\d[\d,]*(?:\.\d+)?\s?[kK]?(?:\s?(?:-|–|—|to)\s?\$?\s?\d[\d,]*(?:\.\d+)?\s?[kK]?)?(?:\s?(?:\/|per|a)\s?(?:hour|hr|year|yr|annum|month))?/g;
  const YEARS_RE = /\b(\d{1,2})\s?(?:(?:-|–|—|to)\s?(\d{1,2})\s?)?(\+)?\s*(?:years?|yrs?)\b/i;
  const LEVEL_WORD_RE = /\b(entry[- ]level|new grad(?:uate)?|junior|intern(?:ship)?|co-?op|senior|staff|principal|lead|manager|director)\b/i;
  const MODE_RE = /\b(remote|hybrid|on-?site|in[- ]office)\b/i;
  const LOC_LABEL_RE = /^\s*(?:job location|work location|office location|location|city)\s*[:\-–]\s*(.{2,60}?)\s*$/i;
  const CITY_RE = /\b([A-Z][A-Za-z.\- ]{2,24}),\s?(ON|BC|AB|QC|NS|NB|MB|SK|NL|PE|NY|CA|TX|WA|MA|IL|FL|CO|GA|VA|NC|NJ|PA|OH|MI|AZ|OR|DC)\b/;
  const CLOSE_RE = new RegExp('(?:clos(?:e|es|ing)|apply (?:by|before)|deadline|applications? due)[^.\\n]{0,40}?\\b(' + MONTHS + ')\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?', 'i');
  const CLOSE_ISO_RE = /(?:deadline|clos(?:e|es|ing)|apply (?:by|before)|due)[^\d\n]{0,40}(\d{4})-(\d{2})-(\d{2})/i;
  const CLOSE_DAYFIRST_RE = new RegExp('(?:deadline|clos(?:e|es|ing)|apply (?:by|before)|due)[^\\d\\n]{0,40}(\\d{1,2})(?:st|nd|rd|th)?\\s+(' + MONTHS + ')\\.?,?\\s+\\d{4}', 'i');
  const PLACES = 'Ontario|British Columbia|Alberta|Quebec|Nova Scotia|New Brunswick|Manitoba|Saskatchewan|Newfoundland and Labrador|Newfoundland|Prince Edward Island|Yukon|California|New York|Texas|Washington|Massachusetts|Illinois|Florida|Colorado|Georgia|Virginia|North Carolina|New Jersey|Pennsylvania|Ohio|Michigan|Arizona|Oregon';
  const CITY_FULL_RE = new RegExp('\\b([A-Za-z][A-Za-z.\'\\- ]{2,24}),\\s*(' + PLACES + ')\\b', 'i');
  const TYPE_RE = /\b(full[- ]time|part[- ]time|permanent|contract|temporary|internship|co-?op|casual)\b/i;
  const EDU_RE = /\b(bachelor(?:'s|’s)?|master(?:'s|’s)?|ph\.?d|doctorate|diploma|post-?secondary|university degree|college degree|degree)\b/i;
  const AUTH_RE = /(sponsor(?:ship)?|work permit|work authori[sz]ation|authori[sz]ed to work|eligible to work|legally (?:entitled|eligible|authori[sz]ed)|citizen(?:ship)?|permanent resident|security clearance|clearance)/i;
  const NO_SPONSOR_RE = /(?:\bno\b|\bnot\b|unable to|cannot|can't|won't|will not|without|do not|does not|don't)\b[^.]{0,50}sponsor|sponsor[^.]{0,30}not (?:available|offered|provided)/i;
  const BUZZ_RE = /\b(rock ?star|ninja|guru|wear many hats|work hard,? play hard|thick skin)\b/i;
  const UNPAID_RE = /\b(unpaid|commission[- ]only|100% commission|no base salary)\b/i;

  const NICE_H = /(nice[- ]to[- ]have|preferred|bonus|assets?\b|good to have|would be a plus|desirable|an advantage|optional)/i;
  const SKIP_H = /(benefits|perks|about us|about the company|who we are|why join|what we offer|equal opportunity|diversity|compensation|our values|our culture|additional job details|our employment|talent community|similar jobs|find your next|share via|what.s in it for you)/i;
  const REQ_H = /(requirements?|qualifications?|must[- ]haves?|what you.{0,3}ll need|what we.{0,3}re looking for|who you are|you bring|about you|skills|responsibilities|what you.{0,3}ll do|the role|duties|your role)/i;
  const NICE_CUE = /(nice[- ]to[- ]have|preferred|bonus|an? (?:asset|plus)|is a plus|are a plus|would be an? (?:asset|plus|advantage)|desirable|an advantage)/i;

  let ranges = new Map();   // note id -> { range, color, label, hlOf }
  let marks = new Map();    // note id -> <mark> element
  let currentMark = null;

  // ---------- reading the page ----------
  function isVisible(el) {
    try {
      return el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : el.getClientRects().length > 0;
    } catch (e) { return true; }
  }

  function collectUnits() {
    const units = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p || SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (p.closest('[data-dibs]')) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue.trim()) return NodeFilter.FILTER_SKIP;
        if (!isVisible(p)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n;
    while ((n = walker.nextNode()) && units.length < 6000) {
      units.push({ node: n, text: n.nodeValue, tag: n.parentElement.tagName });
    }
    return units;
  }

  function isHeadingLike(u) {
    const t = u.text.trim();
    if (/^(H[1-6]|STRONG|B|DT|TH|SUMMARY|LEGEND)$/.test(u.tag)) return t.length <= 80;
    if (/[:]$/.test(t) && t.length <= 60) return true;
    return t.length <= 40 && !/[.,;]/.test(t) && !/^(LI|A)$/.test(u.tag);
  }

  function buildSkillDefs(cfg) {
    const cs = new Set(cfg.caseSensitive || []);
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
    const defs = [];
    for (const name of cfg.skills || []) {
      let tail = '(?![A-Za-z0-9_+#&])';
      let head = '(?<![A-Za-z0-9_+#.])';
      if (name.length <= 2) { tail = "(?![A-Za-z0-9_+#&\\-\u2019'])(?!\\.\\d)"; head = '(?<![A-Za-z0-9_+#.\\-/])'; }
      if (name === 'Testing') head += '(?<!(?:hypothesis|statistical|significance|a\\/b|split)[\\s-])';
      if (name === 'Go') tail += '(?!\\s+(?:to|ahead|for|the|after|live|with)\\b)(?!-)';
      const res = [new RegExp(head + '(?:' + esc(name) + ')' + tail, cs.has(name) ? '' : 'i')];
      const aliases = (cfg.aliases && cfg.aliases[name]) || [];
      const long = aliases.filter((a) => a.length >= 5);
      const short = aliases.filter((a) => a.length < 5);
      if (long.length) res.push(new RegExp(head + '(?:' + long.map(esc).join('|') + ')' + tail, 'i'));
      if (short.length) res.push(new RegExp(head + '(?:' + short.map(esc).join('|') + ')' + tail));
      defs.push({ name, res });
    }
    return defs;
  }

  function numbersIn(text) {
    const out = [];
    const re = /(\d[\d,]*(?:\.\d+)?)\s?([kK])?/g;
    let m;
    while ((m = re.exec(text))) {
      let v = parseFloat(m[1].replace(/,/g, ''));
      if (m[2]) v *= 1000;
      out.push(v);
    }
    return out;
  }

  function extract(cfg) {
    clearMarks();
    ranges = new Map();
    const units = collectUnits();
    const MON3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const cands = [];
    let seq = 0;

    const addNote = (label, text, color, unitIdx, start, end, extra) => {
      const c = { label, text, color, pos: unitIdx == null ? 1e12 + seq : unitIdx * 1e5 + start, extra: extra || {} };
      seq++;
      if (unitIdx != null) {
        const r = document.createRange();
        r.setStart(units[unitIdx].node, start);
        r.setEnd(units[unitIdx].node, end);
        c.range = r;
      }
      cands.push(c);
      return c;
    };

    // Job title
    const h1 = document.querySelector('h1');
    for (let i = 0; i < Math.min(units.length, 80); i++) {
      if (units[i].tag === 'H1' && units[i].text.trim().length >= 4) {
        const t = units[i].text.trim();
        addNote('Role', t.length > 60 ? t.slice(0, 57) + '...' : t, 'blue', i, units[i].text.indexOf(t), units[i].text.indexOf(t) + t.length);
        break;
      }
    }

    // "Label: value" facts (value may be in the same text box or the next one)
    const labelValue = (labelRe) => {
      for (let i = 0; i < units.length; i++) {
        const t = units[i].text.trim();
        const m = labelRe.exec(t);
        if (!m) continue;
        const after = t.slice(m.index + m[0].length).replace(/^[\s:\-–]+/, '').trim();
        if (after && after.length <= 40) { const st = units[i].text.indexOf(after); return { v: after, i, start: st, end: st + after.length }; }
        if (!after && i + 1 < units.length && units[i + 1].text.trim().length <= 40) {
          const nt = units[i + 1].text.trim();
          const st = units[i + 1].text.indexOf(nt);
          return { v: nt, i: i + 1, start: st, end: st + nt.length };
        }
      }
      return null;
    };
    const hrs = labelValue(/^work hours\s*\/\s*week\s*:?/i);
    if (hrs && /\d/.test(hrs.v)) addNote('Hours', hrs.v.replace(/\s+/g, ' ') + ' per week', 'gray', hrs.i, hrs.start, hrs.end);
    const payType = labelValue(/^pay type\s*:?/i);
    if (payType) addNote('Pay type', payType.v, 'green', payType.i, payType.start, payType.end);
    const posted = labelValue(/^posted(?: date)?\s*:?/i);
    if (posted && /\d{4}-\d{2}-\d{2}/.test(posted.v)) {
      const pm = /(\d{4})-(\d{2})-(\d{2})/.exec(posted.v);
      addNote('Posted', MON3[+pm[2] - 1] + ' ' + +pm[3], 'gray', posted.i, posted.start + pm.index, posted.start + pm.index + pm[0].length);
    }

    // Money
    let moneyNote = null;
    for (let i = 0; i < units.length && !moneyNote; i++) {
      MONEY_RE.lastIndex = 0;
      let m;
      while ((m = MONEY_RE.exec(units[i].text))) {
        const nums = numbersIn(m[0]);
        const big = Math.max(...nums);
        const hourly = /hour|hr/i.test(m[0]);
        if (big >= 1000 || (hourly && big >= 10)) {
          const clean = m[0].replace(/\s+/g, ' ').trim().replace(/[.,;]$/, '');
          moneyNote = addNote('Money', clean, 'green', i, m.index, m.index + m[0].length);
          if (nums.length >= 2 && Math.max(...nums) / Math.min(...nums.filter((x) => x > 0)) >= 1.8) {
            addNote('Flag', 'Pay range is very wide', 'amber', null, 0, 0, { hlOf: moneyNote });
          }
          break;
        }
      }
    }

    // Level
    let levelDone = false;
    for (let i = 0; i < units.length && !levelDone; i++) {
      if (!/experience/i.test(units[i].text)) continue;
      const m = YEARS_RE.exec(units[i].text);
      if (m && +m[1] <= 20) {
        const before = units[i].text.slice(Math.max(0, m.index - 14), m.index);
        const pre = /up to\s*$/i.test(before) ? 'Up to ' : /(at least|minimum(?: of)?)\s*$/i.test(before) ? 'At least ' : '';
        const text = pre + (m[2] ? m[1] + ' to ' + m[2] + ' years' : m[3] ? m[1] + '+ years' : m[1] + ' years');
        addNote('Level', text, 'blue', i, m.index, m.index + m[0].length);
        levelDone = true;
      }
    }
    if (!levelDone) {
      for (let i = 0; i < Math.min(units.length, 60); i++) {
        if (!/^H[1-3]$/.test(units[i].tag) && i > 6) continue;
        if (units[i].text.length > 90) continue;
        const m = LEVEL_WORD_RE.exec(units[i].text);
        if (m) {
          const w = m[1].replace(/-/g, ' ');
          addNote('Level', w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(), 'blue', i, m.index, m.index + m[0].length);
          break;
        }
      }
    }

    // Place
    let loc = null, mode = null, locUnit = null, modeUnit = null;
    for (let i = 0; i < units.length; i++) {
      if (!loc && i > 0 && /^\s*(?:job location|work location|office location|location|city)\s*:?\s*$/i.test(units[i - 1].text) && units[i].text.trim().length <= 50) {
        loc = units[i].text.trim().replace(/\s+/g, ' ');
        locUnit = { i, start: units[i].text.indexOf(units[i].text.trim()), end: units[i].text.indexOf(units[i].text.trim()) + units[i].text.trim().length };
      }
      if (!loc) {
        const lm = LOC_LABEL_RE.exec(units[i].text);
        if (lm) { loc = lm[1].replace(/\s+/g, ' '); locUnit = { i, start: units[i].text.indexOf(lm[1]), end: units[i].text.indexOf(lm[1]) + lm[1].length }; }
        else if (i < 120) {
          const cf = CITY_FULL_RE.exec(units[i].text);
          const cm = cf ? null : CITY_RE.exec(units[i].text);
          if (cf) {
            const title = (x) => x.trim().toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
            loc = title(cf[1]) + ', ' + title(cf[2]);
            locUnit = { i, start: cf.index, end: cf.index + cf[0].length };
          } else if (cm) { loc = cm[0]; locUnit = { i, start: cm.index, end: cm.index + cm[0].length }; }
        }
      }
      if (!mode) {
        const mm = MODE_RE.exec(units[i].text);
        if (mm) {
          const w = mm[1].toLowerCase();
          mode = w === 'remote' ? 'Remote' : w === 'hybrid' ? 'Hybrid' : 'On-site';
          modeUnit = { i, start: mm.index, end: mm.index + mm[0].length };
        }
      }
      if (loc && mode) break;
    }
    if (loc || mode) {
      const src = modeUnit || locUnit;
      addNote('Place', [loc, mode].filter(Boolean).join(', '), 'gray', src.i, src.start, src.end);
    }

    // Closing date
    for (let i = 0; i < units.length; i++) {
      if (i > 0 && /(deadline|clos(?:e|es|ing)|apply by|due)/i.test(units[i - 1].text) && units[i - 1].text.length < 60 && !/\d{4}/.test(units[i - 1].text)) {
        const t = units[i].text;
        const a = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
        const b = new RegExp('(' + MONTHS + ')\\.?\\s+(\\d{1,2})', 'i').exec(t);
        if (a && +a[2] >= 1 && +a[2] <= 12) { addNote('Dates', 'Closes ' + MON3[+a[2] - 1] + ' ' + +a[3], 'gray', i, a.index, a.index + a[0].length); break; }
        if (b) { const mon = b[1].slice(0, 3); addNote('Dates', 'Closes ' + mon.charAt(0).toUpperCase() + mon.slice(1).toLowerCase() + ' ' + b[2], 'gray', i, b.index, b.index + b[0].length); break; }
      }
      const iso = CLOSE_ISO_RE.exec(units[i].text);
      if (iso && +iso[2] >= 1 && +iso[2] <= 12) {
        addNote('Dates', 'Closes ' + MON3[+iso[2] - 1] + ' ' + +iso[3], 'gray', i, iso.index, iso.index + iso[0].length);
        break;
      }
      const dm = CLOSE_DAYFIRST_RE.exec(units[i].text);
      if (dm) {
        const mon = dm[2].slice(0, 3);
        addNote('Dates', 'Closes ' + mon.charAt(0).toUpperCase() + mon.slice(1).toLowerCase() + ' ' + dm[1], 'gray', i, dm.index, dm.index + dm[0].length);
        break;
      }
      const m = CLOSE_RE.exec(units[i].text);
      if (m) {
        const mon = m[1].slice(0, 3);
        addNote('Dates', 'Closes ' + mon.charAt(0).toUpperCase() + mon.slice(1).toLowerCase() + ' ' + m[2], 'gray', i, m.index, m.index + m[0].length);
        break;
      }
    }

    // Job type
    for (let i = 0; i < Math.min(units.length, 150); i++) {
      const m = TYPE_RE.exec(units[i].text);
      if (m) {
        const w = m[1].toLowerCase().replace(/-/g, ' ');
        addNote('Type', w.charAt(0).toUpperCase() + w.slice(1), 'gray', i, m.index, m.index + m[0].length);
        break;
      }
    }

    // Education
    for (let i = 0; i < units.length; i++) {
      const m = EDU_RE.exec(units[i].text);
      if (!m || units[i].text.length < 12) continue;
      const w = m[1].toLowerCase();
      const full = units[i].text.toLowerCase();
      const hasB = /bachelor|university|\bb\.?\s?(?:s|a|sc|eng)\b\.?/.test(full), hasM = /master|\bm\.?\s?(?:s|sc|eng)\b\.?/.test(full), hasP = /ph\.?d|doctorate/.test(full);
      const nice = /ph\.?d|doctorate/.test(full) && hasM;
      const text = (hasB && (hasM || hasP)) ? "Bachelor's or higher" : nice ? "Ph.D. or Master's degree" : (hasB && hasM) ? "Bachelor's or Master's degree" : /bachelor/.test(w) ? "Bachelor's degree" : hasM ? "Master's degree" : hasP ? 'PhD' : /diploma/.test(w) ? 'Diploma' : 'Degree or diploma';
      addNote('Education', text, 'blue', i, m.index, m.index + m[0].length);
      break;
    }

    // Several deadlines on one page (this really happens): flag it, and flag a deadline already in the past
    const dl = [];
    for (let i = 0; i < units.length; i++) {
      const t = units[i].text;
      const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
      if (!iso) continue;
      const cue = /(deadline|closing|closes|apply by)/i.test(t) || (i > 0 && /(deadline|closing|closes|apply by)/i.test(units[i - 1].text) && units[i - 1].text.length < 60);
      if (!cue) continue;
      const date = new Date(+iso[1], +iso[2] - 1, +iso[3]);
      if (!dl.some((x) => x.date.getTime() === date.getTime())) dl.push({ date, i, start: iso.index, end: iso.index + iso[0].length, label: MON3[+iso[2] - 1] + ' ' + +iso[3] });
    }
    if (dl.length) {
      dl.sort((a, b) => a.date - b.date);
      const first = dl[0];
      const today = new Date(); today.setHours(0, 0, 0, 0);
      if (first.date < today) addNote('Flag', 'Deadline already passed: ' + first.label, 'red', first.i, first.start, first.end);
      else if (dl.length > 1) addNote('Flag', 'Two deadlines: ' + dl.map((x) => x.label).join(' and '), 'amber', first.i, first.start, first.end);
    }

    // Work authorization
    for (let i = 0; i < units.length; i++) {
      const m = AUTH_RE.exec(units[i].text);
      if (!m) continue;
      const t = units[i].text;
      let text = 'Work authorization mentioned', color = 'blue';
      if (NO_SPONSOR_RE.test(t)) { text = 'No sponsorship'; color = 'amber'; }
      else if (/clearance/i.test(t)) { text = 'Security clearance'; color = 'amber'; }
      else if (/citizen|permanent resident/i.test(t)) { text = 'Citizen or PR mentioned'; color = 'amber'; }
      addNote('Work auth', text, color, i, m.index, m.index + m[0].length);
      break;
    }

    // Red flags
    for (let i = 0; i < units.length; i++) {
      const m = UNPAID_RE.exec(units[i].text);
      if (m) { addNote('Flag', 'Unpaid or commission only', 'red', i, m.index, m.index + m[0].length); break; }
    }
    for (let i = 0; i < units.length; i++) {
      const m = BUZZ_RE.exec(units[i].text);
      if (m) { addNote('Flag', 'Buzzword: ' + m[1].toLowerCase(), 'amber', i, m.index, m.index + m[0].length); break; }
    }

    // Skills
    const defs = buildSkillDefs(cfg);
    const dictSet = new Set();
    for (const n of cfg.skills || []) { dictSet.add(n.toLowerCase()); for (const a of (cfg.aliases && cfg.aliases[n]) || []) dictSet.add(a.toLowerCase()); }
    const best = new Map();
    let secMode = 'req';
    let inSkillsList = false;
    const pretty = (x) => (x === x.toLowerCase() ? x.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : x);
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const headingLike = isHeadingLike(u);
      const strongHeading = headingLike && (/^(H[1-6]|STRONG|B|U|DT|TH)$/.test(u.tag) || /:\s*$/.test(u.text.trim()) || /additional|details|about|benefits|apply|employment|equal|join/i.test(u.text));
      // A short plain line inside a skills list is one of the list's items, not a new heading.
      const listItemLike = inSkillsList && headingLike && !strongHeading && !NICE_H.test(u.text) && !SKIP_H.test(u.text) && !REQ_H.test(u.text);
      if (headingLike && !listItemLike) {
        if (NICE_H.test(u.text)) secMode = 'nice';
        else if (SKIP_H.test(u.text)) secMode = 'skip';
        else if (REQ_H.test(u.text)) secMode = 'req';
        inSkillsList = /^\s*(?:job |key |core |required |preferred |technical |essential |top |nice[- ]to[- ]have |must[- ]have )?(?:skills?|competenc(?:y|ies)|qualifications?)\b[^.]{0,20}:?\s*$/i.test(u.text);
      } else if (inSkillsList && secMode !== 'skip' && u.text.length <= 500) {
        const t = u.text;
        // A long sentence under a 'Qualifications' heading is prose, not a list of skills, so don't split it at commas
        const proseLike = t.trim().split(/\s+/).length >= 9 && /\b(?:experience|familiarity|exposure|knowledge|proficiency|ability|demonstrated|understanding|with|of|in)\b/i.test(t);
        if (!proseLike && (listItemLike || /[,;]/.test(t) || u.tag === 'LI' || t.trim().length <= 40)) {
          const re = /[^,;•|\n]+/g;
          let mm;
          while ((mm = re.exec(t))) {
            const raw = mm[0];
            const cleaned = raw.replace(/\s*\([^)]*\)\s*/g, ' ');
            const item = cleaned.trim().replace(/^[-–•\s]+|[.\s]+$/g, '').replace(/^(?:or|and|including|such as)\s+/i, '');
            if (item.length < 3 || item.length > 40 || item.split(/\s+/).length > 5) continue;
            const key = item.toLowerCase();
            if (best.has(key)) continue;
            const start = Math.max(0, mm.index + raw.indexOf(item.split(' ')[0]));
            best.set(key, { name: pretty(item), mode: secMode, i, start, end: Math.min(t.length, start + item.length), tag: !dictSet.has(key) });
          }
        }
      }
      if (secMode === 'skip') continue;
      const umode = u.text.length > 40 && NICE_CUE.test(u.text) ? 'nice' : secMode;
      if (/\b(degree|diploma|field of study|bachelor|master)\b/i.test(u.text)) continue;
      const hits = [];
      for (const d of defs) {
        let m = null;
        for (const re of d.res) {
          const x = re.exec(u.text);
          if (x && (!m || x.index < m.index)) m = x;
        }
        if (m) hits.push({ name: d.name, start: m.index, end: m.index + m[0].length });
      }
      // a short match sitting inside a longer one ("Risk Management" inside "Model Risk Management") is dropped
      const kept = hits.filter((h) => !hits.some((o) => o !== h && o.start <= h.start && o.end >= h.end && (o.end - o.start) > (h.end - h.start)));
      for (const h of kept) {
        const key = h.name.toLowerCase();
        const prev = best.get(key);
        if (!prev || (prev.mode === 'nice' && umode === 'req')) {
          best.set(key, { name: h.name, mode: umode, i, start: h.start, end: h.end });
        }
      }
    }
    // drop "Big Data" when "Big Data Management" came from the same text box
    for (const [k, a] of [...best.entries()]) {
      for (const b of best.values()) {
        if (b !== a && b.i === a.i && b.name.toLowerCase().includes(a.name.toLowerCase()) && b.name.length > a.name.length) { best.delete(k); break; }
      }
    }
    const sorted = [...best.values()].sort((a, b) => a.i * 1e5 + a.start - (b.i * 1e5 + b.start));
    let nReq = 0, nNice = 0;
    for (const v of sorted) {
      const name = v.name;
      if (v.mode === 'req' && nReq < 30) { addNote('Required skill', name, 'yellow', v.i, v.start, v.end, { tag: v.tag }); nReq++; }
      else if (v.mode === 'nice' && nNice < 15) { addNote('Nice to have', name, 'purple', v.i, v.start, v.end, { tag: v.tag }); nNice++; }
    }

    // Whole requirement / preferred / duty lines, so nothing is silently missed even when Dibs doesn't know the words
    const DUTY_H = /(responsibilit|what (?:will )?you.{0,3}(?:ll )?do|your role|duties|day[- ]to[- ]day|accountabilities)/i;
    const QUAL_H = /(requirement|qualification|must[- ]have|what (?:do )?you(?:.{0,3}ll)? need|about you|who you are|what you bring|you bring|you have|skills (?:and|&) experience|looking for)/i;
    let lm = null;
    const usedEl = new Set();
    const counts = { req: 0, nice: 0, duty: 0 };
    const caps = { req: 14, nice: 8, duty: 10 };
    const LINE_LABEL = { req: 'Requirement', nice: 'Preferred', duty: 'Duty' };
    const LINE_COLOR = { req: 'blue', nice: 'purple', duty: 'gray' };
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const t = u.text.trim();
      if (isHeadingLike(u)) {
        if (NICE_H.test(t)) lm = 'nice';
        else if (SKIP_H.test(t)) lm = 'skip';
        else if (DUTY_H.test(t)) lm = 'duty';
        else if (QUAL_H.test(t)) lm = 'req';
        else if (/^\s*(?:job |key |core |required |preferred |technical )?skills?\b/i.test(t)) lm = null;
        continue;
      }
      if (!lm || lm === 'skip' || counts[lm] >= caps[lm]) continue;
      const el = u.node.parentElement.closest('li,p');
      if (!el || usedEl.has(el) || el.closest('[data-dibs]')) continue;
      const full = el.textContent.replace(/\s+/g, ' ').trim();
      if (full.length < 30 || full.length > 400) continue;
      if (/(benefits|compensation|accepting applications|equal opportunity|accommodat|backfill|vacanc(?:y|ies)|salary range|pay range|starting (?:pay|salary)|medical\/dental)/i.test(full)) continue;
      usedEl.add(el);
      counts[lm]++;
      const short = full.length > 110 ? full.slice(0, full.lastIndexOf(' ', 108)).replace(/[,;:\-–\s]+$/, '') + '…' : full;
      const c = addNote(LINE_LABEL[lm], short, LINE_COLOR[lm], null, 0, 0, { lineEl: el, full });
      c.pos = i * 1e5;
    }

    if (cands.length >= 3 && !moneyNote) addNote('Flag', 'No pay listed', 'amber', null, 0, 0);

    cands.sort((a, b) => a.pos - b.pos);
    const notes = cands.map((c, k) => {
      const id = 'n' + (k + 1);
      ranges.set(id, { range: c.range || null, color: c.color, label: c.label, hlOf: null, _c: c });
      return { id, label: c.label, text: c.text, color: c.color, hasSource: Boolean(c.range || c.extra.hlOf || c.extra.lineEl), tag: Boolean(c.extra.tag), line: Boolean(c.extra.lineEl), full: c.extra.full || '' };
    });
    for (const [id, r] of ranges) {
      if (r._c.extra.hlOf) {
        for (const [oid, o] of ranges) if (o._c === r._c.extra.hlOf) r.hlOf = oid;
      }
    }
    const title = ((h1 && h1.textContent) || document.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    return { title, notes };
  }

  // ---------- painting highlights ----------
  function paint(id, color) {
    let mark = marks.get(id);
    if (!mark) {
      const entry = ranges.get(id);
      if (!entry || !entry.range) return null;
      mark = document.createElement('mark');
      mark.setAttribute('data-dibs', 'mark');
      try { entry.range.surroundContents(mark); } catch (e) { return null; }
      marks.set(id, mark);
    }
    mark.className = 'dibs-mark dibs-' + color;
    return mark;
  }

  let lineEls = new Set();
  let currentLine = null;
  function highlight(msg) {
    const entry = ranges.get(msg.id);
    if (!entry) return false;
    const lineEl = entry._c && entry._c.extra && entry._c.extra.lineEl;
    if (lineEl) {
      if (currentLine && currentLine !== lineEl) currentLine.classList.remove('dibs-current-line');
      lineEl.classList.add('dibs-line', 'dibs-' + entry.color, 'dibs-current-line');
      lineEls.add(lineEl);
      currentLine = lineEl;
      if (msg.scroll) lineEl.scrollIntoView({ behavior: msg.instant ? 'auto' : 'smooth', block: 'center', inline: 'nearest' });
      return true;
    }
    const targetId = entry.hlOf || msg.id;
    const mark = paint(targetId, entry.color);
    if (!mark) return false;
    if (currentMark && currentMark !== mark) currentMark.classList.remove('dibs-current');
    mark.classList.add('dibs-current');
    currentMark = mark;
    if (msg.scroll) mark.scrollIntoView({ behavior: msg.instant ? 'auto' : 'smooth', block: 'center', inline: 'nearest' });
    return true;
  }

  function clearMarks() {
    const parents = new Set();
    for (const mark of marks.values()) {
      const p = mark.parentNode;
      if (!p) continue;
      while (mark.firstChild) p.insertBefore(mark.firstChild, mark);
      p.removeChild(mark);
      parents.add(p);
    }
    parents.forEach((p) => p.normalize());
    lineEls.forEach((el) => el.classList.remove('dibs-line', 'dibs-current-line', 'dibs-blue', 'dibs-purple', 'dibs-gray', 'dibs-green', 'dibs-amber', 'dibs-yellow', 'dibs-red'));
    lineEls = new Set();
    currentLine = null;
    marks = new Map();
    currentMark = null;
  }

  // ---------- the little robot badge (in a shadow root so the page's CSS can't touch it) ----------
  const BADGE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 112" width="48" height="56">' +
    '<line x1="43" y1="6" x2="43" y2="16" stroke="#5b6475" stroke-width="2.5"/>' +
    '<circle class="antenna" cx="43" cy="5" r="4.5" fill="#4f46e5"/>' +
    '<rect x="14" y="16" width="58" height="46" rx="14" fill="#e9ecff" stroke="#1b1f2a" stroke-width="2.5"/>' +
    '<rect x="20" y="24" width="46" height="20" rx="10" fill="#fff" stroke="#1b1f2a" stroke-width="1.5"/>' +
    '<circle cx="33" cy="34" r="6" fill="#fff" stroke="#1b1f2a" stroke-width="1.5"/>' +
    '<circle cx="53" cy="34" r="6" fill="#fff" stroke="#1b1f2a" stroke-width="1.5"/>' +
    '<circle class="pupil" cx="33" cy="34" r="3" fill="#1b1f2a"/><circle class="pupil" cx="53" cy="34" r="3" fill="#1b1f2a"/>' +
    '<path d="M35 54 H51" stroke="#1b1f2a" stroke-width="2.2" fill="none" stroke-linecap="round"/>' +
    '<rect x="20" y="66" width="46" height="34" rx="10" fill="#a9b0ff" stroke="#1b1f2a" stroke-width="2.5"/>' +
    '<rect x="9" y="72" width="9" height="22" rx="4.5" fill="#8b93ff"/><rect x="68" y="72" width="9" height="22" rx="4.5" fill="#8b93ff"/>' +
    '<rect x="26" y="100" width="12" height="8" rx="3" fill="#5b6475"/><rect x="48" y="100" width="12" height="8" rx="3" fill="#5b6475"/></svg>';

  const BADGE_CSS = ':host{all:initial}' +
    '.wrap{display:flex;flex-direction:column;align-items:center;gap:4px;font-family:system-ui,Segoe UI,Arial,sans-serif;animation:bob 1.6s ease-in-out infinite}' +
    '.bubble{background:#fff;color:#1b1f2a;border:1px solid #cfd5e3;border-radius:10px;padding:3px 9px;font-size:12px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,.18);white-space:nowrap}' +
    '.pupil{animation:scan 1.1s ease-in-out infinite}.antenna{animation:glow 1.6s ease-in-out infinite}' +
    '@keyframes bob{50%{transform:translateY(-4px)}}@keyframes scan{0%,100%{transform:translateX(-3px)}50%{transform:translateX(3px)}}@keyframes glow{50%{opacity:.4}}' +
    '@media (prefers-reduced-motion:reduce){.wrap,.pupil,.antenna{animation:none}}';

  function ensureBadge() {
    let host = document.querySelector('[data-dibs="badge"]');
    if (host) return host;
    host = document.createElement('div');
    host.setAttribute('data-dibs', 'badge');
    host.style.cssText = 'position:fixed;right:14px;top:50%;transform:translateY(-50%);z-index:2147483647;pointer-events:none;';
    const root = host.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(BADGE_CSS);
    root.adoptedStyleSheets = [sheet];
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const svg = document.importNode(new DOMParser().parseFromString(BADGE_SVG, 'image/svg+xml').documentElement, true);
    wrap.append(bubble, svg);
    root.append(wrap);
    document.documentElement.appendChild(host);
    return host;
  }

  function showBadge(text) {
    const host = ensureBadge();
    host.shadowRoot.querySelector('.bubble').textContent = text;
  }

  function removeBadge() {
    const host = document.querySelector('[data-dibs="badge"]');
    if (host) host.remove();
  }

  // ---------- messages from the side panel ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (msg.type === 'dibs-extract') sendResponse(extract(msg.cfg || {}));
      else if (msg.type === 'dibs-highlight') sendResponse({ ok: highlight(msg) });
      else if (msg.type === 'dibs-badge') { showBadge(msg.text || ''); sendResponse({ ok: true }); }
      else if (msg.type === 'dibs-clear') { clearMarks(); if (msg.badge) removeBadge(); sendResponse({ ok: true }); }
    } catch (e) {
      sendResponse({ error: String(e && e.message || e) });
    }
    return false;
  });
})();
