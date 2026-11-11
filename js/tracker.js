// Tracker: remembers jobs you saved or applied to, so Dibs can warn you before you apply twice.
// Dibs never submits anything. "I applied" only records what YOU did. Everything stays in chrome.storage.local.
const TRACK_KEY = 'dibs_apps';
const KEEP_PARAMS = ['jobid', 'job_id', 'gh_jid', 'jk', 'currentjobid', 'reqid', 'req_id', 'requisitionid', 'id', 'jid', 'posting'];
const STATUSES = [['saved', 'Saved'], ['applied', 'Applied'], ['interview', 'Interview'], ['offer', 'Offer'], ['rejected', 'Rejected'], ['withdrawn', 'Withdrawn']];
const FOLLOW_UP_DAYS = 7;

function normUrl(u) {
  try {
    const x = new URL(u);
    const keep = [...x.searchParams.entries()].filter(([k]) => KEEP_PARAMS.includes(k.toLowerCase()))
      .map(([k, v]) => k.toLowerCase() + '=' + v).sort().join('&');
    return x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + (keep ? '?' + keep : '');
  } catch (e) { return ''; }
}
function roleKey(r) { return (r || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
const todayStr = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const nice = (s) => s.replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());

// Best guess at the employer from the address or the tab title. Always editable in the tracker.
function guessCompany(url, title) {
  let u; try { u = new URL(url); } catch (e) { return ''; }
  const host = u.hostname.replace(/^www\./, ''), seg = u.pathname.split('/').filter(Boolean);
  if (/greenhouse\.io$/.test(host) && seg[0] && seg[0] !== 'embed') return nice(seg[0]);
  if (/(^|\.)lever\.co$/.test(host) && seg[0]) return nice(seg[0]);
  if (/ashbyhq\.com$/.test(host) && seg[0]) return nice(seg[0]);
  if (/smartrecruiters\.com$/.test(host) && seg[0]) return nice(seg[0]);
  if (/myworkdayjobs\.com$/.test(host)) return nice(host.split('.')[0]);
  const t = title || '';
  let m = /^(.{2,60}?) hiring /.exec(t);                       // "Company hiring Role in City | LinkedIn"
  if (m) return m[1].trim();
  if (/(linkedin|indeed|glassdoor|ziprecruiter|wellfound|jobright)\./.test(host)) return '';
  const parts = host.split('.');
  const core = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return ['co', 'com', 'org', 'gc'].includes(core) && parts.length >= 3 ? nice(parts[parts.length - 3]) : nice(core);
}

const tracker = {
  async all() { const o = await chrome.storage.local.get(TRACK_KEY); return o[TRACK_KEY] || []; },
  async saveAll(list) { await chrome.storage.local.set({ [TRACK_KEY]: list }); },
  // exact = same page; similar = same role text seen on another page (e.g. LinkedIn vs the company site)
  find(list, page) {
    const nu = normUrl(page.url);
    const exact = nu ? list.find((a) => a.nurl && a.nurl === nu) : null;
    if (exact) return { how: 'exact', app: exact };
    const rk = roleKey(page.role);
    if (rk.length >= 15) {
      const sim = list.find((a) => a.rkey === rk);
      if (sim) return { how: 'similar', app: sim };
    }
    return null;
  },
  async mark(page, status) {
    const list = await this.all();
    const hit = this.find(list, page);
    let app = hit && hit.how === 'exact' ? hit.app : null;
    if (!app) {
      app = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), nurl: normUrl(page.url), url: page.url, rkey: roleKey(page.role),
        role: page.role || page.url, company: page.company || '', host: hostOf(page.url), savedAt: todayStr() };
      list.unshift(app);
    }
    if (page.score != null) app.score = page.score;
    if (page.resume) app.resume = page.resume;
    this.setStatus(app, status);
    await this.saveAll(list);
    return app;
  },
  setStatus(app, status) {
    app.status = status;
    if (status !== 'saved' && !app.appliedAt) app.appliedAt = todayStr();
    if (status === 'applied' && !app.followUp) app.followUp = addDays(app.appliedAt, FOLLOW_UP_DAYS);
    if (status === 'saved') { delete app.appliedAt; delete app.followUp; }
  },
  async update(id, fn) { const list = await this.all(); const a = list.find((x) => x.id === id); if (a) { fn(a); await this.saveAll(list); } },
  async remove(id) { await this.saveAll((await this.all()).filter((a) => a.id !== id)); },
};
const hasApplied = (a) => a.status && a.status !== 'saved';

// ---------- CSV (so the tracker is never locked inside Dibs) ----------
const CSV_COLS = ['Company', 'Role', 'Link', 'Status', 'Saved', 'Applied', 'Follow up', 'Match %', 'Resume used'];
function csvCell(v) { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function trackerToCsv(list) {
  const rows = list.map((a) => [a.company, a.role, a.url, (STATUSES.find((s) => s[0] === a.status) || ['', a.status])[1], a.savedAt, a.appliedAt, a.followUp, a.score, a.resume]);
  return [CSV_COLS].concat(rows).map((r) => r.map(csvCell).join(',')).join('\r\n');
}
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((c) => c.trim())) rows.push(row); row = []; }
    else cur += ch;
  }
  row.push(cur); if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}
function toIsoDate(v) {
  const s = (v || '').trim(); if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s); return isNaN(d) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
// Accepts Dibs's own CSV and most hand-made sheets: it finds the columns by their header words.
async function importTrackerCsv(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (rows.length < 2) return { added: 0, skipped: 0, error: 'That file has no rows.' };
  const head = rows[0].map((h) => h.toLowerCase().trim());
  const col = (re) => head.findIndex((h) => re.test(h));
  const ci = { company: col(/company|employer|organi[sz]ation/), role: col(/role|title|position|job/), url: col(/link|url|posting/), status: col(/status|stage|outcome/),
    applied: col(/applied|date/), follow: col(/follow/), score: col(/match|score/), resume: col(/resume|cv/) };
  if (ci.role < 0 && ci.company < 0) return { added: 0, skipped: 0, error: 'I could not find a Role or Company column in the first row.' };
  const list = await tracker.all(); let added = 0, skipped = 0;
  for (const r of rows.slice(1)) {
    const g = (k) => (ci[k] >= 0 ? (r[ci[k]] || '').trim() : '');
    const role = g('role') || g('company'); if (!role) { skipped++; continue; }
    const url = /^https?:/.test(g('url')) ? g('url') : '';
    const sraw = g('status').toLowerCase();
    const status = /reject|declin|no\b/.test(sraw) ? 'rejected' : /interview|screen|assessment/.test(sraw) ? 'interview' : /offer/.test(sraw) ? 'offer' : /withdr/.test(sraw) ? 'withdrawn' : /sav|wish|todo|to apply/.test(sraw) ? 'saved' : 'applied';
    const nurl = normUrl(url), rk = roleKey(role), co = g('company');
    if (list.some((a) => (nurl && a.nurl === nurl) || (a.rkey === rk && (a.company || '').toLowerCase() === co.toLowerCase()))) { skipped++; continue; }
    const applied = toIsoDate(g('applied'));
    const app = { id: Date.now().toString(36) + added.toString(36) + Math.random().toString(36).slice(2, 5), nurl, url, rkey: rk, role, company: co, host: hostOf(url), savedAt: applied || todayStr(), status };
    if (status !== 'saved') { app.appliedAt = applied || todayStr(); const f = toIsoDate(g('follow')); if (f) app.followUp = f; else if (status === 'applied') app.followUp = addDays(app.appliedAt, FOLLOW_UP_DAYS); }
    const sc = parseInt(g('score'), 10); if (!isNaN(sc)) app.score = sc;
    if (g('resume')) app.resume = g('resume');
    list.push(app); added++;
  }
  await tracker.saveAll(list);
  return { added, skipped };
}

// ---------- panel UI ----------
let trackPage = null;
const trackBox = document.getElementById('track');
const trackMsg = document.getElementById('track-msg');
const trackSave = document.getElementById('track-save');
const trackApplied = document.getElementById('track-applied');
const trackFine = document.getElementById('track-fine');

function stampEl(text, slam) {
  const s = document.createElement('span');
  s.className = 'stamp' + (slam ? ' slam' : '');
  s.textContent = text;
  return s;
}
const statusWord = (a) => (STATUSES.find((s) => s[0] === a.status) || ['', 'Applied'])[1];

async function trackerShow(page, justApplied) {
  trackPage = page;
  if (!page || !page.url) { trackBox.hidden = true; return; }
  const hit = tracker.find(await tracker.all(), page);
  trackMsg.textContent = '';
  trackSave.hidden = false;
  trackApplied.hidden = false;
  trackFine.hidden = false;
  trackBox.classList.remove('dup');
  if (hit && hasApplied(hit.app)) {
    trackMsg.append(stampEl(hit.app.status === 'applied' ? 'APPLIED' : statusWord(hit.app).toUpperCase(), justApplied));
    const t = document.createElement('div');
    const when = hit.app.appliedAt || hit.app.savedAt;
    t.textContent = hit.how === 'exact'
      ? 'You applied to this job on ' + when + '. Status: ' + statusWord(hit.app) + '.' + (hit.app.status === 'applied' && hit.app.followUp ? ' Follow up on ' + hit.app.followUp + '.' : ' No need to apply again.')
      : 'You already applied to a very similar role on ' + when + ' (' + statusWord(hit.app) + '): ' + hit.app.role + '. Is this a different requisition?';
    trackMsg.append(t);
    if (!justApplied) trackBox.classList.add('dup');
    trackSave.hidden = true;
    trackApplied.hidden = hit.how === 'exact';
    trackFine.hidden = hit.how === 'exact';
  } else if (hit) {
    const t = document.createElement('div');
    t.textContent = hit.how === 'exact' ? 'Saved on ' + hit.app.savedAt + ', not applied yet.' : 'A similar role is saved (' + hit.app.role + ').';
    trackMsg.append(t);
    trackSave.hidden = hit.how === 'exact';
  } else {
    trackMsg.textContent = page.fit === 'mismatch' ? 'New job. Dibs flagged it as a likely mismatch, so think before you spend time on it.' : 'New job. Not in your tracker yet.';
  }
  trackBox.hidden = false;
}
function trackerHide() { trackBox.hidden = true; trackPage = null; }

async function trackerRender() {
  const list = await tracker.all();
  document.getElementById('tracker-count').textContent = list.length;
  const ul = document.getElementById('tracker-list');
  ul.textContent = '';
  const today = todayStr();
  for (const a of list) {
    const li = document.createElement('li');
    const top = document.createElement('div');
    if (a.url) { const t = document.createElement('a'); t.href = a.url; t.target = '_blank'; t.rel = 'noopener'; t.textContent = a.role; top.append(t); }
    else { const t = document.createElement('b'); t.textContent = a.role; top.append(t); }
    const row = document.createElement('div');
    row.className = 'track-actions';
    const co = document.createElement('input');
    co.type = 'text'; co.value = a.company || ''; co.placeholder = 'Company'; co.className = 'co'; co.setAttribute('aria-label', 'Company');
    co.addEventListener('change', () => tracker.update(a.id, (x) => { x.company = co.value.trim(); }));
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', 'Status');
    for (const [v, label] of STATUSES) { const o = document.createElement('option'); o.value = v; o.textContent = label; if (v === a.status) o.selected = true; sel.append(o); }
    sel.addEventListener('change', async () => { await tracker.update(a.id, (x) => tracker.setStatus(x, sel.value)); await trackerRender(); if (trackPage) trackerShow(trackPage); });
    const del = document.createElement('button');
    del.textContent = 'Remove';
    del.addEventListener('click', async () => { await tracker.remove(a.id); await trackerRender(); if (trackPage) trackerShow(trackPage); });
    row.append(co, sel, del);
    const sub = document.createElement('div');
    sub.className = 'fine';
    const due = a.status === 'applied' && a.followUp && a.followUp <= today;
    sub.textContent = [a.host, a.score != null ? 'match ' + a.score + '%' : '', hasApplied(a) ? 'applied ' + a.appliedAt : 'saved ' + a.savedAt,
      a.status === 'applied' && a.followUp ? (due ? 'FOLLOW UP NOW (due ' + a.followUp + ')' : 'follow up ' + a.followUp) : '', a.resume ? 'resume: ' + a.resume : ''].filter(Boolean).join(' · ');
    if (due) sub.classList.add('due');
    li.append(top, row, sub);
    ul.append(li);
  }
}

// Which resume went out? "tailored" if you saved a tailored version for this job in the tailoring window.
async function resumeUsedFor(url) {
  try { const x = new URL(url); const all = (await chrome.storage.local.get('dibs_resumes')).dibs_resumes || {}; const v = all[x.hostname + x.pathname]; return v ? 'tailored ' + v.savedAt : 'base'; }
  catch (e) { return 'base'; }
}
trackSave.addEventListener('click', async () => { if (trackPage) { await tracker.mark(trackPage, 'saved'); await trackerShow(trackPage); await trackerRender(); } });
trackApplied.addEventListener('click', async () => {
  if (!trackPage) return;
  await tracker.mark(Object.assign({}, trackPage, { resume: await resumeUsedFor(trackPage.url) }), 'applied');
  await trackerShow(trackPage, true); await trackerRender();
});
trackerRender();
