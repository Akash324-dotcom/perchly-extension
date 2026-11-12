// Side panel brain. Flow: check consent -> inject the content script into the job tab ->
// ask it for notes -> play the "robot reads and writes" show, highlighting each source on the page ->
// compare the skills with the user's own resume / GitHub / LinkedIn text and show a match score.

const board = document.getElementById('board');
const locked = document.getElementById('locked');
const stage = document.getElementById('stage');
const readBtn = document.getElementById('read');
const skipBtn = document.getElementById('skip');
const footer = document.getElementById('footer');
const allowRow = document.getElementById('allow-row');
const matchBox = document.getElementById('match');
const gapsBox = document.getElementById('gaps');
const profileBox = document.getElementById('profile-box');

let runId = 0;
let skipping = false;
let targetTabId = null;
let lastNotes = [];
let skillCfg = null;
let pageUrl = '';
let lastScore = null;
let lastFit = null;
let pageTitle = '';
let shownScore = 0;
let confettiFor = '';
let settings = { autoRead: true, speed: 'relaxed' };
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Auto-read only touches pages that look like job postings (address or tab title).
const JOBISH = /(\bjobs?\b|career|position|vacanc|opening|requisition|posting|recruit|hiring|greenhouse|lever\.co|workday|ashbyhq|smartrecruiters|icims|taleo|bamboohr|indeed|glassdoor|ziprecruiter|wellfound|jobright)/i;
const looksLikeJob = (url, title) => JOBISH.test(url || '') || JOBISH.test(title || '');

// Waits ms, but returns at once if the user pressed Skip.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, skipping ? 0 : ms));

let lastAddAt = 0, burst = 0;
function addNote(note) {
  const t = performance.now();
  burst = t - lastAddAt < 100 ? Math.min(burst + 1, 12) : 0;
  lastAddAt = t;
  const el = document.createElement('div');
  el.style.setProperty('--d', burst);
  el.className = 'note ' + note.color;
  el.dataset.id = note.id;
  if (note.line) { el.classList.add('wide'); el.title = note.full; }
  const label = document.createElement('small');
  label.textContent = note.label;           // page-derived text: textContent only
  const text = document.createElement('div');
  text.textContent = note.text;
  const x = document.createElement('button');
  x.className = 'note-x';
  x.title = 'Remove this note (Perchly got it wrong, or it does not matter)';
  x.setAttribute('aria-label', 'Remove note: ' + note.label);
  x.textContent = '\u00d7';
  x.addEventListener('click', () => removeNote(note.id));
  el.append(label, text, x);
  board.appendChild(el);
}

// The user is always in control of the notes: removing one updates the score, the fit check and what the tailoring window sees.
async function removeNote(id) {
  lastNotes = lastNotes.filter((n) => n.id !== id);
  const el = board.querySelector('.note[data-id="' + id + '"]');
  if (el) el.remove();
  lastFit = fitCheck(lastNotes, await store.getProfile());
  renderFit(lastFit);
  const has = await renderMatch();
  if (has) await saveLast();
}

async function saveLast() {
  const role = (lastNotes.find((n) => n.label === 'Role') || {}).text || pageTitle || '';
  await chrome.storage.local.set({ dibs_last: { url: pageUrl, role, company: guessCompany(pageUrl, pageTitle), at: Date.now(), fit: lastFit,
    lines: lastNotes.filter((n) => n.line).map((n) => n.label + ': ' + n.full),
    notes: lastNotes.filter((n) => n.label === 'Required skill' || n.label === 'Nice to have').map((n) => ({ id: n.id, label: n.label, text: n.text, tag: n.tag })) } });
}

// Which tab are we reading? The one the user is looking at.
async function getTargetTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function loadSkillConfig() {
  if (!skillCfg) skillCfg = await (await fetch(chrome.runtime.getURL('data/skills.json'))).json();
  return skillCfg;
}

const send = (msg) => chrome.tabs.sendMessage(targetTabId, msg).catch(() => null);

// manual = the user pressed Read this page. Automatic reads skip jobs you already applied to.
async function readPage(manual) {
  const myRun = ++runId;
  skipping = false;
  board.textContent = '';
  allowRow.hidden = true;
  matchBox.hidden = true;
  gapsBox.hidden = true;
  trackerHide();
  document.getElementById('fit').hidden = true;
  lastFit = null;
  document.getElementById('open-resume').hidden = true;
  lastNotes = [];
  setRobotMood('reading');
  setBubble('Looking at the page...');

  // 1. Get into the page (works only after Chrome has given Perchly access to this tab).
  let result;
  try {
    const tab = await getTargetTab();
    if (!tab) throw new Error('no tab');
    targetTabId = tab.id;
    pageUrl = tab.url || '';
    pageTitle = tab.title || '';
    // Check the tracker FIRST, before reading anything: the address alone says whether you already applied.
    const hit = pageUrl ? tracker.find(await tracker.all(), { url: pageUrl, role: '' }) : null;
    if (hit && hit.how === 'exact' && hasApplied(hit.app)) {
      await trackerShow({ url: pageUrl, role: hit.app.role });
      if (myRun !== runId) return;
      if (!manual) {
        setRobotMood('idle');
        setBubble('You already applied to this job on ' + (hit.app.appliedAt || hit.app.savedAt) + '. Press Read this page if you want to read it again.');
        return;
      }
    }
    await chrome.scripting.insertCSS({ target: { tabId: targetTabId }, files: ['content/page.css'] });
    await chrome.scripting.executeScript({ target: { tabId: targetTabId }, files: ['content/content.js'] });
    await send({ type: 'dibs-clear', badge: false });
    result = await send({ type: 'dibs-extract', cfg: await loadSkillConfig() });
  } catch (err) {
    console.error('Perchly read error:', err);
    allowRow.hidden = false;
    return fail("I can't read this tab yet. Click the Perchly icon in your toolbar while on the job posting, or use the button below.");
  }
  if (!result || result.error || !result.notes || result.notes.length === 0) {
    await send({ type: 'dibs-clear', badge: true });
    return fail("I couldn't find a job posting here. Open one and press Read this page.");
  }

  // 2. The show: robot reads, writes a note, the same words light up on the page.
  const notes = result.notes;
  lastNotes = notes;
  // Speed is the user's choice (Settings). Relaxed is slow enough to read along; Skip is always there.
  if (settings.speed === 'instant' || reducedMotion) skipping = true;
  const quick = settings.speed === 'quick';
  const step = quick ? (notes.length > 45 ? 130 : 220) : (notes.length > 45 ? 380 : 650);
  skipBtn.hidden = false;
  readBtn.disabled = true;
  setBubble(result.title ? 'Reading: ' + result.title : 'Reading...');
  await send({ type: 'dibs-badge', text: 'Reading...' });
  await wait(600);

  for (const note of notes) {
    if (myRun !== runId) return;
    setRobotMood('writing');
    setBubble('noted ' + note.label.toLowerCase() + ': ' + note.text);
    if (note.hasSource) {
      await send({ type: 'dibs-highlight', id: note.id, scroll: !skipping, instant: skipping });
    }
    await send({ type: 'dibs-badge', text: note.label + ': ' + note.text });
    const dur = note.line ? (quick ? 140 : 420) : step;
    await wait(dur * 0.55);
    addNote(note);
    setRobotMood('reading');
    await wait(dur * 0.45);
  }

  // 3. Finish.
  if (myRun !== runId) return;
  const flags = notes.filter((n) => n.label === 'Flag');
  skipBtn.hidden = true;
  readBtn.disabled = false;
  lastFit = fitCheck(notes, await store.getProfile());
  renderFit(lastFit);
  const hasProfile = await renderMatch();
  const roleNote = notes.find((n) => n.label === 'Role');
  if (hasProfile) {
    await saveLast();
    document.getElementById('open-resume').hidden = false;
  }
  await trackerShow({ url: pageUrl, role: roleNote ? roleNote.text : (result.title || ''), company: guessCompany(pageUrl, pageTitle), score: hasProfile ? lastScore : null, fit: lastFit.verdict });
  const tail = hasProfile ? '' : ' Add your resume below to see your match.';
  if (lastFit.verdict === 'mismatch') {
    setRobotMood('redflag');
    setBubble('Done! ' + notes.length + ' notes. Likely mismatch: see the fit check.' + tail);
  } else if (flags.length) {
    setRobotMood('redflag');
    setBubble('Done! ' + notes.length + ' notes. ' + flags.length + (flags.length === 1 ? ' flag' : ' flags') + ' to check.' + tail);
  } else {
    setRobotMood('celebrate');
    setBubble('Done! ' + notes.length + ' notes.' + tail);
  }
  if (!hasProfile) profileBox.open = true;
  await send({ type: 'dibs-badge', text: 'Done! ' + notes.length + ' notes' });
}

function renderFit(f) {
  const box = document.getElementById('fit');
  box.textContent = '';
  box.className = 'fit-' + f.verdict;
  const h = document.createElement('strong');
  h.textContent = f.verdict === 'mismatch' ? 'Fit check: likely mismatch' : f.verdict === 'stretch' ? 'Fit check: a stretch' : 'Fit check: no hard blockers found';
  box.append(h);
  if (f.reasons.length) {
    const ul = document.createElement('ul');
    for (const r of f.reasons) { const li = document.createElement('li'); li.textContent = r; ul.append(li); }
    box.append(ul);
  }
  const note = document.createElement('p');
  note.className = 'fine';
  note.textContent = f.verdict === 'ok'
    ? 'Perchly checked years, title, team-leading and required qualifications.' + (f.assumed ? ' It assumed 0 years of experience. You can set yours in My profile.' : '')
    : 'No resume wording fixes this. Perchly only warns, you decide.' + (f.assumed ? ' It assumed 0 years of experience (set yours in My profile).' : '');
  box.append(note);
  box.hidden = false;
}

function fail(message) {
  skipBtn.hidden = true;
  readBtn.disabled = false;
  setRobotMood('confused');
  setBubble(message);
}

// ---------- match score ----------
function ringSvg(score) {
  const c = 2 * Math.PI * 28;
  const color = score >= 70 ? '#16a34a' : score >= 40 ? '#f59e0b' : '#ef4444';
  const n = Number(score);
  return '<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">' +
    '<circle class="ring-track" cx="32" cy="32" r="28" fill="none" stroke="#e8ebf1" stroke-width="7"/>' +
    '<circle cx="32" cy="32" r="28" fill="none" stroke="' + color + '" stroke-width="7" stroke-linecap="round" ' +
    'stroke-dasharray="' + ((n / 100) * c).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 32 32)"/>' +
    '<text class="ring-num" x="32" y="37" text-anchor="middle" font-size="16" font-weight="700" fill="#1b1f2a" font-family="system-ui, sans-serif">' + n + '</text></svg>';
}

// Ring sweeps from the old value to the new one while the number counts up (500 ms).
let ringTimer = null;
function animateRing(to) {
  const ring = document.getElementById('ring');
  const from = shownScore;
  cancelAnimationFrame(ringTimer);
  if (reducedMotion || from === to) { ring.innerHTML = ringSvg(to); shownScore = to; return; }   // numbers only, computed here
  const t0 = performance.now();
  const tick = (now) => {
    const k = Math.min(1, (now - t0) / 500), e = 1 - Math.pow(1 - k, 3);
    const v = Math.round(from + (to - from) * e);
    ring.innerHTML = ringSvg(v);
    shownScore = v;
    if (k < 1) ringTimer = requestAnimationFrame(tick);
  };
  ringTimer = requestAnimationFrame(tick);
}

// About 30 small pieces, once per posting, when the match first reaches 75%.
function confetti() {
  if (reducedMotion) return;
  const box = document.getElementById('match');
  const cv = document.createElement('canvas');
  cv.className = 'confetti'; cv.width = box.clientWidth; cv.height = 150;
  box.append(cv);
  const g = cv.getContext('2d'), cols = ['#4f46e5', '#16a34a', '#f59e0b', '#ef4444', '#0ea5e9'];
  const ps = Array.from({ length: 30 }, () => ({ x: 40, y: 40, vx: 1 + Math.random() * 5, vy: -4 + Math.random() * 3, c: cols[Math.floor(Math.random() * cols.length)], r: Math.random() * 6 }));
  const t0 = performance.now();
  const tick = (now) => {
    const age = now - t0;
    g.clearRect(0, 0, cv.width, cv.height);
    for (const q of ps) { q.x += q.vx; q.y += q.vy; q.vy += 0.25; q.r += 0.2; g.fillStyle = q.c; g.globalAlpha = Math.max(0, 1 - age / 1200); g.save(); g.translate(q.x, q.y); g.rotate(q.r); g.fillRect(-3, -2, 6, 4); g.restore(); }
    if (age < 1200) requestAnimationFrame(tick); else cv.remove();
  };
  requestAnimationFrame(tick);
}

async function renderMatch() {
  const profile = await store.getProfile();
  const hasEvidence = profile.resume.trim() || profile.linkedin.trim() || (profile.github && profile.github.repos.length);
  if (!hasEvidence || lastNotes.length === 0) { matchBox.hidden = true; gapsBox.hidden = true; return false; }
  const cfg = await loadSkillConfig();
  const m = matchSkills(lastNotes, profile, cfg);   // counts resume + LinkedIn + GitHub
  if (m.score === null) { matchBox.hidden = true; gapsBox.hidden = true; return true; }
  // Headline = only what is WRITTEN on the resume (what a recruiter or filter reads). If there is no resume text, fall back to everything.
  const mr = profile.resume.trim() ? matchSkills(lastNotes, { resume: profile.resume, linkedin: '', github: null }, cfg) : null;
  const base = mr && mr.score !== null ? mr : m;
  const mrById = new Map((mr ? mr.items : []).map((i) => [i.id, i]));
  const proofs = (await chrome.storage.local.get('dibs_proofs')).dibs_proofs || {};
  for (const it of m.items) {
    const pf = proofs[it.name.toLowerCase()];
    if (pf && (it.status === 'gap' || it.status === 'related')) { it.proof = pf; it.plan = { hours: 'under 1 hour', tip: 'You said: "' + pf + '". Add one truthful bullet about it to your resume.' }; }
  }
  lastScore = base.score;
  animateRing(base.score);
  if (base.score >= 75 && confettiFor !== pageUrl && !(lastFit && lastFit.verdict === 'mismatch')) { confettiFor = pageUrl; confetti(); }
  document.getElementById('match-title').textContent = 'Keyword match ' + base.score + '%' + (lastFit && lastFit.verdict === 'mismatch' ? ' (but see the fit check)' : '');
  document.getElementById('match-sub').textContent = base.covered + ' of ' + base.items.length + (base === mr ? ' skills are written on your resume' : ' skills have proof (resume, GitHub, LinkedIn)') + (m.related ? ', ' + m.related + ' more are related' : '') + '.' + (base === mr && m.score !== base.score ? ' ' + (m.covered - base.covered) + ' more are only on LinkedIn or GitHub (' + m.score + '% if you count them). Add them to the resume to earn it.' : '') + ' Not a real ATS score.';
  matchBox.hidden = false;

  // badges on the skill notes
  for (const it of m.items) {
    const el = board.querySelector('.note[data-id="' + it.id + '"]');
    if (!el) continue;
    el.querySelectorAll('.badge').forEach((b) => b.remove());
    el.querySelectorAll('.proof-form').forEach((f) => f.remove());
    const wrote = mrById.get(it.id);
    const liOnly = it.status === 'resume' && wrote && wrote.status !== 'resume';
    const open = it.status === 'gap' || it.status === 'related';
    const b = document.createElement(open ? 'button' : 'span');
    b.className = 'badge' + (it.proof ? ' related' : it.status === 'gap' ? ' gap' : it.status === 'related' || liOnly ? ' related' : '');
    b.textContent = it.proof ? 'you have it (your note), not on resume yet' : liOnly ? 'LinkedIn only, not on resume' : it.status === 'resume' ? 'on your resume' : it.status === 'github' ? 'GitHub: ' + it.repos.join(', ') : it.status === 'related' ? 'related: ' + it.related.hits.join(', ') : 'gap';
    if (open) {
      b.title = 'Click if you really have this skill. Perchly will ask which project or job shows it.';
      b.addEventListener('click', () => proofForm(el, it));
    }
    el.appendChild(b);
  }

  // gap plan
  const list = document.getElementById('gap-list');
  list.textContent = '';
  const gaps = m.items.filter((i) => i.status === 'gap');
  const relItems = m.items.filter((i) => i.status === 'related');
  for (const g of gaps.concat(relItems)) {
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = g.name + (g.mode === 'req' ? ' (required)' : g.mode === 'tag' ? ' (generic tag)' : ' (nice to have)') + (g.proof ? ' [you have it]' : g.status === 'related' ? ' [related]' : '') + ' - ' + g.plan.hours;
    const s = document.createElement('span');
    s.textContent = g.plan.tip;
    li.append(b, s);
    list.appendChild(li);
  }
  const liOnlyItems = m.items.filter((i) => i.status === 'resume' && mrById.get(i.id) && mrById.get(i.id).status !== 'resume');
  if (liOnlyItems.length) {
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = 'On LinkedIn but not written on your resume: ' + liOnlyItems.map((g) => g.name).join(', ');
    const sp = document.createElement('span');
    sp.textContent = 'A recruiter reading the resume will not see these. Add a bullet for each only if it is true.';
    li.append(b, sp);
    list.appendChild(li);
  }
  const gh = m.items.filter((i) => i.status === 'github');
  if (gh.length) {
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = 'On GitHub but not on your resume: ' + gh.map((g) => g.name).join(', ');
    const s = document.createElement('span');
    s.textContent = 'Add a resume bullet for each, and only if the project really shows it.';
    li.append(b, s);
    list.appendChild(li);
  }
  document.getElementById('checks').textContent = m.checks.length ? 'Check yourself (no project fixes these): ' + m.checks.join(' | ') : '';
  gapsBox.hidden = list.children.length === 0 && m.checks.length === 0;
  gapsBox.querySelector('summary').textContent = 'Gap plan (' + gaps.length + (gaps.length === 1 ? ' gap' : ' gaps') + (relItems.length ? ', ' + relItems.length + ' to reword)' : ')');
  return true;
}

// ---------- profile box ----------
// The truth check from the guide: a skill only moves to "I have it" with a source the user names.
function proofForm(noteEl, it) {
  if (noteEl.querySelector('.proof-form')) return;
  const f = document.createElement('div');
  f.className = 'proof-form';
  const lab = document.createElement('label');
  lab.textContent = 'Which project or job shows ' + it.name + '?';
  const inp = document.createElement('input');
  inp.type = 'text'; inp.maxLength = 140; inp.value = it.proof || ''; inp.placeholder = 'e.g. my capstone API, 2025';
  const ok = document.createElement('button'); ok.textContent = 'Save';
  const no = document.createElement('button'); no.textContent = it.proof ? 'Remove my note' : 'Cancel';
  const save = async (val) => {
    const all = (await chrome.storage.local.get('dibs_proofs')).dibs_proofs || {};
    if (val) all[it.name.toLowerCase()] = val; else delete all[it.name.toLowerCase()];
    await chrome.storage.local.set({ dibs_proofs: all });
    await renderMatch();
  };
  ok.addEventListener('click', () => { const v = inp.value.trim(); if (v) save(v); else inp.focus(); });
  no.addEventListener('click', () => (it.proof ? save('') : f.remove()));
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.click(); });
  lab.append(inp); f.append(lab, ok, no); noteEl.append(f); inp.focus();
}

// ---------- settings and my data ----------
const setAuto = document.getElementById('set-auto');
const setSpeed = document.getElementById('set-speed');
const setStatus = document.getElementById('settings-status');
async function loadSettings() {
  settings = Object.assign({ autoRead: true, speed: 'relaxed' }, (await chrome.storage.local.get('dibs_settings')).dibs_settings || {});
  setAuto.checked = settings.autoRead;
  setSpeed.value = settings.speed;
  const { consent } = await chrome.storage.local.get('consent');
  document.getElementById('consent-info').textContent = consent ? 'You agreed to the Terms and Privacy Policy version ' + consent.termsVersion + ' on ' + String(consent.acceptedAt).slice(0, 10) + '.' : '';
}
const saveSettings = () => chrome.storage.local.set({ dibs_settings: settings });
setAuto.addEventListener('change', () => { settings.autoRead = setAuto.checked; saveSettings(); });
setSpeed.addEventListener('change', () => { settings.speed = setSpeed.value; saveSettings(); });

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
document.getElementById('export-all').addEventListener('click', async () => {
  const all = await chrome.storage.local.get(null);
  download('perchly-my-data-' + todayStr() + '.json', JSON.stringify({ exportedAt: new Date().toISOString(), app: 'Perchly', data: all }, null, 2), 'application/json');
  setStatus.textContent = 'Downloaded everything Perchly has stored, as one file.';
});
document.getElementById('export-csv').addEventListener('click', async () => {
  const list = await tracker.all();
  if (!list.length) { setStatus.textContent = 'Your tracker is empty.'; return; }
  download('perchly-tracker-' + todayStr() + '.csv', '\uFEFF' + trackerToCsv(list), 'text/csv');
  setStatus.textContent = 'Downloaded ' + list.length + ' application' + (list.length === 1 ? '' : 's') + '. It opens in Excel or Google Sheets.';
});
document.getElementById('import-btn').addEventListener('click', () => document.getElementById('import-csv').click());
document.getElementById('import-csv').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const r = await importTrackerCsv(await file.text());
    setStatus.textContent = r.error ? r.error : 'Imported ' + r.added + ' row' + (r.added === 1 ? '' : 's') + (r.skipped ? ', skipped ' + r.skipped + ' (empty or already in the tracker)' : '') + '.';
    await trackerRender();
  } catch (err) { setStatus.textContent = 'Could not read that file: ' + (err && err.message ? err.message : err); }
  e.target.value = '';
});

const resumeEl = document.getElementById('resume');
const linkedinEl = document.getElementById('linkedin');
const ghUserEl = document.getElementById('gh-user');
const yearsEl = document.getElementById('years');
const statusEl = document.getElementById('profile-status');

async function loadProfileFields() {
  const p = await store.getProfile();
  resumeEl.value = p.resume;
  linkedinEl.value = p.linkedin;
  ghUserEl.value = p.githubUser;
  yearsEl.value = p.years || '';
  if (p.github) statusEl.textContent = 'GitHub: ' + p.github.repos.length + ' public repos loaded.';
}

async function saveProfile(extra) {
  const p = await store.getProfile();
  const next = Object.assign(p, { resume: resumeEl.value, linkedin: linkedinEl.value, githubUser: ghUserEl.value.trim(), years: yearsEl.value }, extra || {});
  await store.saveProfile(next);
  return next;
}

document.getElementById('resume-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  statusEl.textContent = 'Reading ' + file.name + '...';
  try {
    resumeEl.value = await importResumeFile(file);
    statusEl.textContent = 'Read ' + file.name + ' (' + resumeEl.value.length + ' characters). Press Save profile.';
  } catch (err) {
    statusEl.textContent = 'Could not read that file: ' + (err && err.message ? err.message : err);
  }
});

document.getElementById('gh-fetch').addEventListener('click', async () => {
  const user = ghUserEl.value.trim();
  if (!user) { statusEl.textContent = 'Type your GitHub username first.'; return; }
  statusEl.textContent = 'Fetching public repos...';
  try {
    const github = await fetchGithub(user, (n, total) => { statusEl.textContent = 'Reading project READMEs... ' + n + ' of ' + total; });
    await saveProfile({ github });
    statusEl.textContent = 'GitHub: ' + github.repos.length + ' public repos loaded' + (github.readmeLimited ? ' (GitHub paused README reading, try Fetch again in an hour for the rest)' : ' with their READMEs') + '.';
    await renderMatch();
  } catch (err) {
    statusEl.textContent = err && err.message ? err.message : 'Could not reach GitHub.';
  }
});

document.getElementById('profile-save').addEventListener('click', async () => {
  await saveProfile();
  statusEl.textContent = 'Saved on this computer.';
  statusEl.classList.remove('flash'); void statusEl.offsetWidth; statusEl.classList.add('flash');
  const had = await renderMatch();
  if (!had && lastNotes.length) statusEl.textContent += ' Add some text to compare.';
});

// ---------- buttons and consent gate ----------
document.getElementById('allow').addEventListener('click', async () => {
  try {
    const ok = await chrome.permissions.request({ origins: ['https://*/*', 'http://*/*'] });
    if (ok) readPage(true);
    else setBubble('Chrome did not grant access. Open chrome://extensions, click Details on Perchly, and set Site access to On all sites.');
  } catch (err) {
    setBubble('Could not ask Chrome (' + (err && err.message ? err.message : err) + '). Open chrome://extensions, click Details on Perchly, and set Site access to On all sites.');
  }
});
skipBtn.addEventListener('click', () => { skipping = true; });
document.getElementById('open-resume').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('resume/resume.html') }));
readBtn.addEventListener('click', () => readPage(true));

function hasAgreed(consent) {
  return Boolean(consent) && consent.termsVersion === TERMS_VERSION;
}

function showState(agreed, autoRead) {
  locked.hidden = agreed;
  stage.hidden = !agreed;
  board.hidden = !agreed;
  readBtn.hidden = !agreed;
  footer.hidden = !agreed;
  profileBox.hidden = !agreed;
  document.getElementById('tracker-box').hidden = !agreed;
  document.getElementById('settings-box').hidden = !agreed;
  document.getElementById('fit').hidden = document.getElementById('fit').hidden || !agreed;
  if (!agreed) { trackerHide(); document.getElementById('open-resume').hidden = true; }
  if (!agreed) {
    runId++;
    board.textContent = '';
    skipBtn.hidden = true;
    matchBox.hidden = true;
    gapsBox.hidden = true;
  } else {
    loadProfileFields();
    if (autoRead) loadSettings().then(() => readPage(false));
    else { loadSettings(); setRobotMood('idle'); setBubble('Open a job posting, then press Read this page.'); }
  }
}

document.getElementById('open-welcome').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('welcome/welcome.html') });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.consent) showState(hasAgreed(changes.consent.newValue), false);
});

document.getElementById('withdraw').addEventListener('click', async () => {
  if (confirm('This deletes everything Perchly saved on this computer (including your profile) and locks Perchly until you agree again. Continue?')) {
    await chrome.storage.local.clear();
    resumeEl.value = ''; linkedinEl.value = ''; ghUserEl.value = ''; statusEl.textContent = '';
    yearsEl.value = ''; board.textContent = ''; lastNotes = []; shownScore = 0;
    trackerHide(); trackerRender();
  }
});

// After the user has allowed Perchly once, read automatically when they open or switch to a job page.
let autoTimer = null;
async function maybeAutoRead() {
  const { consent } = await chrome.storage.local.get('consent');
  if (!hasAgreed(consent)) return;
  if (!(await chrome.permissions.contains({ origins: ['https://*/*'] }))) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/.test(tab.url || '')) return;
  await loadSettings();
  if (!settings.autoRead || !looksLikeJob(tab.url, tab.title)) return;   // only job-looking pages, and only if the user left this on
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => readPage(false), 900);
}
chrome.tabs.onActivated.addListener(maybeAutoRead);
chrome.tabs.onUpdated.addListener((id, info, tab) => { if (info.status === 'complete' && tab.active) maybeAutoRead(); });

chrome.storage.local.get('consent').then(({ consent }) => showState(hasAgreed(consent), true));
