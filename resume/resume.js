// Live resume: your resume text beside the posting you last read. Everything updates as you type.
// Dibs highlights and suggests. It never writes a claim for you, and it never changes your saved base resume.
(async () => {
  const $ = (id) => document.getElementById(id);
  const got = await chrome.storage.local.get(['dibs_last', 'profile', 'dibs_resumes', 'dibs_proofs', 'dibs_letters']);
  const proofs = got.dibs_proofs || {};
  const last = got.dibs_last, profile = got.profile || {};
  const base = profile.resume || '';
  if (!last || !base.trim()) { $('empty').hidden = false; return; }
  $('cols').hidden = false;
  { const st = document.createElement('style'); st.textContent = SHEET_CSS; document.head.append(st); }
  if (last.fit && last.fit.verdict !== 'ok') {
    const f = $('fit'); f.className = 'fit-' + last.fit.verdict;
    const b = document.createElement('b'); b.textContent = last.fit.verdict === 'mismatch' ? 'Fit check: likely mismatch. ' : 'Fit check: a stretch. ';
    f.append(b, last.fit.reasons.join(' ') + ' Tailoring improves the wording, not these. You decide.');
    f.hidden = false;
  }

  const cfg = await (await fetch(chrome.runtime.getURL('data/skills.json'))).json();
  const notes = last.notes || [];
  const keyOf = (u) => { try { const x = new URL(u); return x.hostname + x.pathname; } catch (e) { return u || ''; } };
  const jobKey = keyOf(last.url);
  const saved = (got.dibs_resumes || {})[jobKey];
  $('job').textContent = (last.role || last.url) + ' · ' + keyOf(last.url);

  const textEl = $('text');
  textEl.value = saved ? saved.text : base;
  if (saved) $('msg').textContent = 'Loaded your saved tailored version from ' + saved.savedAt + '.';

  // The score here counts ONLY the words written on the resume, so editing the text moves it.
  // (The side panel score is more generous: it also counts GitHub and LinkedIn text.)
  // GitHub is shown separately: it tells you what you could add, not what a recruiter can already see.
  const evidence = (text) => ({ resume: text, linkedin: '', github: null });
  const evidenceGh = (text) => ({ resume: text, linkedin: '', github: profile.github || null });
  const baseScore = matchSkills(notes, evidence(base), cfg).score;

  function ringSvg(score) {
    const c = 2 * Math.PI * 28, n = Number(score);
    const color = n >= 70 ? '#16a34a' : n >= 40 ? '#f59e0b' : '#ef4444';
    return '<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true"><circle cx="32" cy="32" r="28" fill="none" stroke="#e8ebf1" stroke-width="7"/>' +
      '<circle cx="32" cy="32" r="28" fill="none" stroke="' + color + '" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + ((n / 100) * c).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 32 32)"/>' +
      '<text x="32" y="37" text-anchor="middle" font-size="16" font-weight="700" fill="#888" font-family="system-ui,sans-serif">' + n + '</text></svg>';
  }
  const g = (re) => new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');

  // Where do an item's words appear in one line? Returns [start, end, cssClass] pieces.
  function spansFor(line, items) {
    const spans = [];
    for (const it of items) {
      if (it.status === 'gap') continue;
      const cls = it.status === 'related' ? 'hl-rel' : it.mode === 'nice' ? 'hl-nice' : 'hl-req';
      const res = it.status === 'related' ? ((RELATED[it.name.toLowerCase()] || {}).terms || []) : regexesFor(it.name, cfg);
      for (const r of res) {
        const re = g(r); let m;
        while ((m = re.exec(line))) { if (!m[0]) { re.lastIndex++; continue; } spans.push([m.index, m.index + m[0].length, cls]); }
      }
    }
    spans.sort((a, b) => a[0] - b[0] || (b[1] - b[0]) - (a[1] - a[0]));
    const out = []; let end = -1;
    for (const s of spans) if (s[0] >= end) { out.push(s); end = s[1]; }
    return out;
  }
  function lineWeight(line, items) {
    let w = 0;
    for (const it of items) {
      if (it.status === 'gap' || it.status === 'related') continue;
      if (regexesFor(it.name, cfg).some((r) => r.test(line))) w += it.mode === 'req' ? 2 : it.mode === 'nice' ? 1 : 0.5;
    }
    return w;
  }
  // PDF text wraps one bullet over several lines, so judge whole bullets, not single lines.
  function blocksOf(lines) {
    const blocks = [], map = []; let cur = null;
    lines.forEach((l, i) => {
      const t = l.trim();
      if (!t) { cur = null; map.push(-1); return; }
      if (/^[\u2022\u25aa\-\u2013*]/.test(t)) { cur = { bullet: true, text: t, n: 1, idxs: [i] }; blocks.push(cur); }
      else if (cur && cur.bullet && cur.n < 4 && /^[a-z0-9(]/.test(t)) { cur.text += ' ' + t; cur.n++; cur.idxs.push(i); }
      else { cur = { bullet: false, text: t, n: 1, idxs: [i] }; blocks.push(cur); }
      map.push(blocks.length - 1);
    });
    return { blocks, map };
  }
  const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  let mode = 'order';
  let lastM = null;
  function rankRepos(items) {
    const repos = (profile.github && profile.github.repos) || [];
    return repos.map((r) => {
      const txt = repoText(r);
      const hit = items.filter((it) => it.mode !== 'tag' && regexesFor(it.name, cfg).some((re) => re.test(txt)));
      const fresh = hit.filter((it) => it.ghOnly);
      const w = (it) => (it.mode === 'req' ? 2 : 1);
      return { r, hit, fresh, score: hit.reduce((a, it) => a + w(it), 0) + 1.5 * fresh.reduce((a, it) => a + w(it), 0) };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  }
  function render() {
    const text = textEl.value;
    const m = matchSkills(notes, evidence(text), cfg);
    const mg = matchSkills(notes, evidenceGh(text), cfg);
    lastM = m;
    // Why can the side panel read higher? Find the skills it counts that the resume text does not.
    const mFull = matchSkills(notes, { resume: text, linkedin: profile.linkedin || '', github: profile.github || null }, cfg);
    const viaLi = matchSkills(notes, { resume: text, linkedin: profile.linkedin || '', github: null }, cfg).items.filter((it, k) => it.status === 'resume' && m.items[k].status !== 'resume').map((it) => it.name);
    const ghMap = new Map(mg.items.filter((i) => i.status === 'github').map((i) => [i.name, i.repos]));
    for (const it of m.items) if (it.status !== 'resume' && ghMap.has(it.name)) { it.ghOnly = true; it.repos = ghMap.get(it.name); }
    $('ring').innerHTML = ringSvg(m.score == null ? 0 : m.score);
    $('score-title').textContent = 'Keyword match ' + (m.score == null ? '-' : m.score + '%');
    const extra = [viaLi.length ? 'your LinkedIn text (' + viaLi.join(', ') + ')' : '', mFull.items.some((it, k) => it.status === 'github' && m.items[k].status !== 'resume') ? 'your GitHub repos' : ''].filter(Boolean).join(' and ');
    $('score-sub').textContent = m.covered + ' of ' + m.items.length + ' skills are written on your resume' + (m.related ? ', ' + m.related + ' related' : '') + '. ' + (extra && mFull.score !== m.score ? 'If you also count ' + extra + ', it would be ' + mFull.score + '%. Add those to the resume to earn that. ' : '') + 'The side panel shows this same number. Not a real ATS score.';
    const d = $('delta');
    if (m.score != null && baseScore != null) {
      const diff = m.score - baseScore;
      d.textContent = diff === 0 ? 'Same as your base resume (' + baseScore + '%)' : (diff > 0 ? '+' : '') + diff + ' points vs your base resume (' + baseScore + '%)';
      d.className = diff > 0 ? 'up' : diff < 0 ? 'down' : '';
    }

    // chips
    const chips = $('chips'); chips.textContent = '';
    const order = { req: 0, nice: 1, tag: 2 };
    for (const it of m.items.slice().sort((a, b) => order[a.mode] - order[b.mode])) {
      const c = document.createElement('span');
      c.className = 'chip ' + (it.ghOnly ? 'github' : it.status) + (it.mode === 'tag' ? ' tag' : '');
      c.textContent = it.name + (it.ghOnly ? ' (GitHub only)' : it.status === 'related' ? ' (related)' : it.status === 'gap' ? ' (gap)' : '');
      chips.append(c);
    }

    // suggestions
    const lines = text.split(/\r?\n/);
    const bl = blocksOf(lines);
    const bw = bl.blocks.map((b) => lineWeight(b.text, m.items));
    const sugg = $('sugg'); sugg.textContent = '';
    const add = (strong, rest, quote, action) => {
      const li = document.createElement('li');
      const b = document.createElement('b'); b.textContent = strong;
      li.append(b, ' ' + rest);
      if (quote) { const q = document.createElement('q'); q.textContent = quote; li.append(' ', q); }
      if (action && aiState !== 'missing' && aiState !== 'unavailable') { const bt = document.createElement('button'); bt.className = 'sugg-btn'; bt.textContent = 'Reword with on-device AI'; bt.addEventListener('click', action); li.append(bt); }
      sugg.append(li);
    };
    for (const it of m.items.filter((i) => i.status !== 'resume' && proofs[i.name.toLowerCase()])) {
      it.proofed = true;
      add(it.name + ':', 'you told Dibs you have this ("' + proofs[it.name.toLowerCase()] + '"), but it is not written on the resume. Add one truthful bullet about it.');
    }
    for (const it of m.items.filter((i) => i.status === 'related' && !i.ghOnly && !i.proofed)) {
      const terms = (RELATED[it.name.toLowerCase()] || {}).terms || [];
      // Best bullet to reword = the one with the most related evidence, and real bullets beat the summary.
      let best = null, bestN = 0;
      bl.blocks.forEach((b) => { if (!b.bullet || b.text.length < 40) return; const n = terms.filter((r) => r.test(b.text)).length; if (n > bestN) { bestN = n; best = b; } });
      const ln = best ? best.text : '';
      add(it.name + ':', it.related.kind === 'word'
        ? 'your resume shows related work (' + it.related.hits.join(', ') + '), but not the posting’s word. If it is true, reword this line to use it:'
        : 'you know a neighbour (' + it.related.hits.join(', ') + '). The exact tool is missing. Only add it after you have really used it. Nearest line:', ln ? short(ln.trim(), 150) : '',
        it.related.kind === 'word' && best ? () => aiRewordFlow(best, it.name) : null);
    }
    for (const it of m.items.filter((i) => i.ghOnly && i.mode !== 'tag')) {
      add(it.name + ':', 'proven on GitHub (' + it.repos.join(', ') + ') but not on your resume text. If that project deserves the space, add a bullet about it. See the project list below.');
    }
    for (const it of m.items.filter((i) => i.status === 'gap' && !i.ghOnly && !i.proofed && i.mode !== 'tag')) {
      add(it.name + ':', 'not on your resume (' + it.plan.hours + '). Do not add it unless you have really done it.');
    }
    if (m.covered + m.related > 0) {
      const weak = bl.blocks.filter((b) => b.bullet && b.text.length > 60 && lineWeight(b.text, m.items) === 0).map((b) => b.text).slice(0, 4);
      for (const w of weak) add('No posting keyword in this bullet:', 'it may still be worth keeping. Trim these first if you run out of space.', short(w, 120));
    }
    if (!sugg.children.length) add('Nothing to fix.', 'Every keyword in this posting has proof on your resume.');

    // GitHub projects ranked for this job
    const box = $('projects'); box.textContent = '';
    const repos = (profile.github && profile.github.repos) || [];
    if (!repos.length) {
      const p = document.createElement('p'); p.className = 'fine';
      p.textContent = 'No GitHub projects saved yet. In the Dibs panel, open My profile, type your GitHub username and press Fetch.'; box.append(p);
    } else {
      const noReadme = repos.every((r) => !r.readme);
      const ranked = rankRepos(m.items).slice(0, 6);
      if (noReadme) {
        const p = document.createElement('p'); p.className = 'fine';
        p.textContent = 'Dibs only has repo names and short descriptions. Press Fetch again in your profile to read each README for better matching.'; box.append(p);
      }
      if (!ranked.length) { const p = document.createElement('p'); p.className = 'fine'; p.textContent = 'None of your public repos mention this posting’s skills.'; box.append(p); }
      for (const x of ranked) {
        const d = document.createElement('div'); d.className = 'proj';
        const top = document.createElement('div'); top.className = 'top';
        const a = document.createElement('a'); a.href = x.r.url || '#'; a.target = '_blank'; a.rel = 'noopener'; a.textContent = x.r.name;
        const sc = document.createElement('span'); sc.className = 'fine'; sc.textContent = [x.r.lang, x.r.pushed ? 'pushed ' + x.r.pushed : ''].filter(Boolean).join(' · ');
        top.append(a, sc);
        const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = x.r.desc || '(no description on GitHub)';
        const chs = document.createElement('div'); chs.className = 'chips';
        for (const it of x.hit) { const c = document.createElement('span'); c.className = 'chip ' + (it.ghOnly ? 'github' : 'resume'); c.textContent = it.name; chs.append(c); }
        d.append(top, meta, chs);
        if (x.fresh.length) { const n = document.createElement('div'); n.className = 'new'; n.textContent = 'Adds proof your resume text lacks: ' + x.fresh.map((it) => it.name).join(', '); d.append(n); }
        const btn = document.createElement('button'); btn.textContent = 'Add a bullet starter to my text'; btn.style.marginTop = '6px';
        btn.addEventListener('click', () => {
          const starter = '• ' + x.r.name.replace(/[-_]/g, ' ') + ': ' + (x.r.desc || '[what it does]') + ' (' + [...new Set([x.r.lang].concat(x.hit.slice(0, 4).map((it) => it.name)).filter(Boolean))].join(', ') + '). Result: [your real number or outcome].';
          textEl.value = textEl.value.replace(/\s+$/, '') + '\n' + starter;
          $('msg').textContent = 'Added a starter at the bottom of your text. Fill in the [brackets] with real facts, then move it under the right heading.';
          render();
          textEl.scrollTop = textEl.scrollHeight;
        });
        d.append(btn);
        box.append(d);
      }
    }

    // page-fit meter
    const fit = fitResume(text);
    const fill = $('fitfill');
    fill.style.width = Math.min(100, fit.pct) + '%';
    fill.className = fit.pct > 100 ? 'red' : fit.fs < 9.5 || fit.pct > 92 ? 'amber' : '';
    $('fitlabel').textContent = fit.pct > 100 ? 'Over one page even at the smallest text size (about ' + fit.pct + '%). Trim the bullets marked "no posting keyword" first.'
      : 'Fits on 1 page at ' + fit.fs + 'pt text (about ' + fit.pct + '% full, estimate).' + (fit.fs < 9.5 ? ' That is small print: trimming a bullet or two would let it breathe.' : '');

    // preview
    const prev = $('preview'); prev.textContent = '';
    let rows = lines.map((l, i) => ({ l, i, w: bl.map[i] >= 0 ? bw[bl.map[i]] : 0 }));
    if (mode === 'rel') rows = rows.filter((r) => r.l.trim().length > 20).sort((a, b) => b.w - a.w || a.i - b.i).slice(0, 14);
    for (const r of rows) {
      const row = document.createElement('div');
      if (!r.l.trim()) { row.className = 'pl blank'; prev.append(row); continue; }
      row.className = 'pl';
      const bar = document.createElement('div'); bar.className = 'rel'; bar.style.setProperty('--w', Math.min(100, r.w * 25) + '%'); bar.title = 'relevance to this posting';
      const t = document.createElement('div'); t.className = 't';
      let pos = 0;
      for (const [s, e, cls] of spansFor(r.l, m.items)) {
        if (s > pos) t.append(document.createTextNode(r.l.slice(pos, s)));
        const sp = document.createElement('span'); sp.className = 'hl ' + cls; sp.textContent = r.l.slice(s, e); t.append(sp); pos = e;
      }
      if (pos < r.l.length) t.append(document.createTextNode(r.l.slice(pos)));
      row.append(bar, t); prev.append(row);
    }
  }

  let timer = null;
  textEl.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 150); });
  $('m-order').addEventListener('click', () => { mode = 'order'; $('m-order').classList.add('on'); $('m-rel').classList.remove('on'); render(); });
  $('m-rel').addEventListener('click', () => { mode = 'rel'; $('m-rel').classList.add('on'); $('m-order').classList.remove('on'); render(); });
  $('reset').addEventListener('click', () => { textEl.value = base; $('msg').textContent = 'Back to your base resume text.'; render(); });
  $('copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(textEl.value); $('msg').textContent = 'Copied.'; } catch (e) { $('msg').textContent = 'Could not copy. Select the text and press Ctrl+C.'; }
  });
  $('dl').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([textEl.value], { type: 'text/plain' }));
    a.download = 'resume_tailored.txt'; a.click(); URL.revokeObjectURL(a.href);
  });
  $('save-v').addEventListener('click', async () => {
    const all = (await chrome.storage.local.get('dibs_resumes')).dibs_resumes || {};
    const m = matchSkills(notes, evidence(textEl.value), cfg);
    all[jobKey] = { text: textEl.value, role: last.role || '', savedAt: new Date().toISOString().slice(0, 10), score: m.score };
    await chrome.storage.local.set({ dibs_resumes: all });
    $('msg').textContent = 'Saved a tailored version for this job (' + m.score + '%). Your base resume is unchanged.';
  });
  // ---------- export ----------
  const fileBase = () => {
    const nm = (textEl.value.split(/\r?\n/).find((l) => l.trim()) || 'resume').trim().replace(/[^A-Za-z ]+/g, '').trim().replace(/\s+/g, '_');
    const co = (last.company || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return (nm || 'resume') + (co ? '_' + co : '');
  };
  const saveBlob = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  const leftovers = () => (textEl.value.match(/\[[^\]\n]+\]/g) || []).length;
  const warnLeft = (what) => { const n = leftovers(); $('msg').textContent = (n ? 'Careful: ' + n + ' fill-in spot' + (n === 1 ? '' : 's') + ' in [brackets] are still in the text. ' : '') + what; };
  $('pdf').addEventListener('click', () => { warnLeft('In the print window choose "Save as PDF".'); printSheet(fitResume(textEl.value).sheet); });
  $('word').addEventListener('click', () => { saveBlob(wordBlob(fitResume(textEl.value).sheet, 'Resume'), fileBase() + '_Resume.doc'); warnLeft('Downloaded a Word file. Open it and check the layout.'); });

  // ---------- cover letter (slots: company, role, ONE real achievement, one line tying it to the posting) ----------
  const letterEl = $('letter');
  const lowerFirst = (t) => (/^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t);
  const listWords = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
  function buildLetter() {
    const lines = textEl.value.split(/\r?\n/);
    let name = squash(lines.find((l) => l.trim()) || '');
    if (name === name.toUpperCase()) name = name.toLowerCase().replace(/\b[a-z]/g, (ch) => ch.toUpperCase());   // AKASH MAITY -> Akash Maity
    const role = squash((last.role || 'the role').replace(/\s*\((?:hybrid|remote|on-?site)[^)]*\)/ig, '').replace(/\s+[-\u2013|]\s+[^-\u2013|]*$/, ''));
    const company = last.company || '';
    const items = lastM.items;
    const have = items.filter((i) => i.status === 'resume' && i.mode === 'req').map((i) => i.name).slice(0, 3);
    const bullets = blocksOf(lines).blocks.filter((b) => b.bullet && b.text.length > 50);
    let best = null, bw = -1;
    for (const b of bullets) { const w = lineWeight(b.text, items); if (w > bw) { bw = w; best = b; } }
    const ach = best ? squash(best.text.replace(BUL, '')).replace(/[.;]?$/, '.') : '[one real achievement from your resume]';
    return 'Dear ' + (company ? company + ' hiring team' : 'hiring team') + ',\n\n' +
      'I am applying for the ' + role + ' role' + (company ? ' at ' + company : '') + '.' + (have.length ? ' The posting asks for ' + listWords(have) + ', which is the work I have been doing.' : '') + '\n\n' +
      'One example: I ' + lowerFirst(ach) + '\n\n' +
      'I would welcome the chance to talk about how I can help the team.\n\nSincerely,\n' + name;
  }
  function countWords() {
    const n = (letterEl.value.trim().match(/\S+/g) || []).length;
    $('words').textContent = n + ' / 250 words';
    $('words').className = 'fine' + (n > 250 ? ' over' : '');
  }
  letterEl.addEventListener('input', countWords);
  $('letter-new').addEventListener('click', () => { letterEl.value = buildLetter(); countWords(); $('msg').textContent = 'Wrote the letter again from your current resume text. Read it: it must sound like you and be true.'; });
  $('letter-save').addEventListener('click', async () => {
    const all = (await chrome.storage.local.get('dibs_letters')).dibs_letters || {};
    all[jobKey] = { text: letterEl.value, savedAt: new Date().toISOString().slice(0, 10) };
    await chrome.storage.local.set({ dibs_letters: all }); $('msg').textContent = 'Saved the cover letter for this job.';
  });
  $('letter-pdf').addEventListener('click', () => { $('msg').textContent = 'In the print window choose "Save as PDF".'; printSheet(letterToSheet(letterEl.value)); });
  $('letter-word').addEventListener('click', () => saveBlob(wordBlob(letterToSheet(letterEl.value), 'Cover letter'), fileBase() + '_Cover_Letter.doc'));
  $('letter-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(letterEl.value); $('msg').textContent = 'Copied the cover letter.'; } catch (e) { letterEl.select(); $('msg').textContent = 'Press Ctrl+C to copy.'; } });

  // ---------- AI helpers ----------
  let aiState = 'missing';
  const aiStatus = $('ai-status'), aiEnable = $('ai-enable'), aiOut = $('ai-result');
  async function refreshAi() {
    aiState = await aiAvailability();
    aiEnable.hidden = true;
    if (aiState === 'available') aiStatus.textContent = 'Ready. Runs on this computer, nothing is sent anywhere.';
    else if (aiState === 'downloadable' || aiState === 'downloading') { aiStatus.textContent = 'Chrome can run a small AI on this computer. It needs a one-time download.'; aiEnable.hidden = false; }
    else if (aiState === 'unavailable') aiStatus.textContent = 'This computer cannot run it (Chrome needs about 22 GB free disk and a strong GPU or 16 GB RAM). The buttons above still work.';
    else aiStatus.textContent = 'Not available in this Chrome (needs Chrome 138 or newer on Windows, Mac or Linux). The buttons above still work.';
    render();
  }
  aiEnable.addEventListener('click', async () => {
    aiEnable.disabled = true; aiStatus.textContent = 'Downloading... this can take a few minutes.';
    try { await aiStart((pct) => { aiStatus.textContent = 'Downloading... ' + pct + '%'; }); await refreshAi(); }
    catch (e) { aiStatus.textContent = 'Could not start it: ' + (e && e.message ? e.message : e); }
    aiEnable.disabled = false;
  });
  const stripBullet = (t) => t.replace(/^[•▪\-–*]\s*/, '').replace(/\s+/g, ' ').trim();
  async function aiRewordFlow(block, keyword) {
    aiOut.textContent = '';
    if (!block) return;
    const note = (t) => { aiOut.textContent = t; };
    note('Thinking on this computer...');
    const orig = stripBullet(block.text);
    let next;
    try {
      const sess = await aiStart((pct) => note('Downloading the model... ' + pct + '%'));
      next = aiClean(await sess.prompt(aiPrompt(orig, keyword)));
    } catch (e) { note('The on-device AI could not answer: ' + (e && e.message ? e.message : e)); return; }
    const g = truthGuard(orig, next, keyword);
    aiOut.textContent = '';
    const mk = (cls, t) => { const d = document.createElement('div'); d.className = cls; d.textContent = t; aiOut.append(d); return d; };
    mk('fine', 'Original'); mk('cmp', orig);
    mk('fine', 'Suggested'); mk('cmp', next || '(nothing)');
    if (!g.ok) { mk('bad', 'Rejected by the truth check: ' + g.problems.join(', ') + '. Dibs will not let you accept this one.'); return; }
    mk('ok', 'Passed the truth check: no new numbers or names. Read it and make sure it is still true.');
    const row = document.createElement('div'); row.className = 'bar';
    const yes = document.createElement('button'); yes.className = 'primary'; yes.textContent = 'Accept (replace this bullet)';
    const no = document.createElement('button'); no.textContent = 'Dismiss';
    yes.addEventListener('click', () => {
      const arr = textEl.value.split(/\r?\n/);
      const found = blocksOf(arr).blocks.find((b) => b.text === block.text);
      if (!found) { note('Your text changed since, so I did not touch it. Press the button again.'); return; }
      const lead = (/^(\s*[•▪\-–*]\s*)/.exec(arr[found.idxs[0]]) || ['', ''])[1].replace(/\s+/g, ' ');
      arr[found.idxs[0]] = lead + next.replace(/^[•▪\-–*\s]+/, '');
      for (const k of found.idxs.slice(1).reverse()) arr.splice(k, 1);
      textEl.value = arr.join('\n'); aiOut.textContent = ''; $('msg').textContent = 'Replaced one bullet. Press Save tailored version when you are happy.'; render();
    });
    no.addEventListener('click', () => { aiOut.textContent = ''; });
    row.append(yes, no); aiOut.append(row);
  }

  // ---------- Auto-tailor ----------
  let preTailor = null;
  const titleCase = (n) => n.replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
  const firstSentence = (r) => {
    const src = (r.readme || '').trim() || r.desc || '';
    if (!src) return '';
    const m1 = /^(.{20,170}?[.!?])(\s|$)/.exec(src);
    return (m1 ? m1[1] : src.slice(0, 150).replace(/\s+\S*$/, '')).trim();
  };
  $('auto').addEventListener('click', () => {
    const items = lastM.items;
    const ghEntries = rankRepos(items).filter((x) => x.fresh.length).map((x) => ({ x, sent: firstSentence(x.r) })).filter((y) => y.sent).slice(0, 2).map(({ x, sent }) => ({
      title: titleCase(x.r.name), skills: x.fresh.slice(0, 4).map((it) => it.name),
      header: titleCase(x.r.name) + (x.r.lang ? ' (' + x.r.lang + ')' : '') + '  [GitHub]  ' + (x.r.pushed || '').slice(0, 4),
      bullet: '• ' + sent.replace(/\.$/, '') + ' (' + x.fresh.slice(0, 4).map((it) => it.name).join(', ') + '). Result: [add your real result]',
    }));
    const res = autoTailor(textEl.value, { weight: (t) => lineWeight(t, items), ghEntries,
      opts: { reorder: $('o-reorder').checked, github: $('o-gh').checked, trim: $('o-trim').checked } });
    preTailor = textEl.value;
    textEl.value = res.text;
    $('undo').disabled = false;
    const ph = (res.text.match(/\[[^\]\n]+\]/g) || []).length;
    const ul = $('tailor-log'); ul.textContent = '';
    for (const l of res.log.concat(ph ? [ph + ' fill-in spot' + (ph === 1 ? '' : 's') + ' left in [brackets]. Replace each with a real fact, or delete the line, before you send it.'] : [])) { const li = document.createElement('li'); li.textContent = l; ul.append(li); }
    if (!res.log.length) { const li = document.createElement('li'); li.textContent = 'Nothing to change: your resume is already ordered for this job.'; ul.append(li); }
    $('msg').textContent = 'Auto-tailored. Read every line, then press Save tailored version.';
    render();
  });
  $('undo').addEventListener('click', () => { if (preTailor !== null) { textEl.value = preTailor; preTailor = null; $('undo').disabled = true; $('tailor-log').textContent = ''; $('msg').textContent = 'Undone.'; render(); } });

  // A ready-made brief for a proper rewrite in a chat AI: your facts only, with the truth rules built in.
  // Email addresses anywhere, and phone numbers in the top lines, are swapped for a marker before the text leaves Dibs.
  const redactContact = (t) => t.split(/\r?\n/).map((l, i) => { let o = l.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email removed]'); if (i < 8) o = o.replace(/\+?\d[\d\s().-]{8,}\d/g, '[phone removed]'); return o; }).join('\n');
  const sel = $('ai-provider');
  for (const pv of PROVIDERS) { const o = document.createElement('option'); o.value = pv.id; o.textContent = pv.name; sel.append(o); }
  try { const pref = (await chrome.storage.local.get('dibs_ai_provider')).dibs_ai_provider; if (pref) sel.value = pref; } catch (e) {}
  sel.addEventListener('change', () => chrome.storage.local.set({ dibs_ai_provider: sel.value }));
  $('ask').addEventListener('click', async () => {
    const pv = PROVIDERS.find((x) => x.id === sel.value) || PROVIDERS[0];
    const items = lastM.items;
    const req = items.filter((i) => i.mode === 'req').map((i) => i.name), nice = items.filter((i) => i.mode === 'nice').map((i) => i.name);
    const gh = rankRepos(items).slice(0, 8).map((x) => '- ' + x.r.name + (x.r.lang ? ' (' + x.r.lang + ')' : '') + ': ' + (x.r.desc || '') + ' | README: ' + (x.r.readme || '').slice(0, 300) + ' | ' + x.r.url).join('\n');
    const brief = 'Tailor my resume for this job and give me a ready-to-send version.\n\n' +
      'RULES (do not break any):\n- Use only facts that are already in my resume or in the GitHub facts below. Never invent a metric, tool, title, employer or date.\n' +
      '- If the job asks for something I have not done, list it under "Gaps" for me to decide. Do not put it on the resume.\n' +
      '- Keep it to one page. Start bullets with strong action verbs. Use a number only if it is already in my resume or README.\n- Use the job’s exact words only where they are true for me. Put my most relevant projects first.\n- For GitHub projects I have not listed on the resume, you may add one only if the README gives enough facts, and mark any missing result as [ask me].\n\n' +
      'JOB: ' + (last.role || '') + '\n' + last.url + '\nRequired skills: ' + req.join(', ') + '\nNice to have: ' + nice.join(', ') + '\n' + ((last.lines || []).length ? '\nPosting lines:\n' + last.lines.map((l) => '- ' + l).join('\n') + '\n' : '') +
      '\nMY RESUME (current text' + ($('o-redact').checked ? ', email and phone removed' : '') + '):\n' + ($('o-redact').checked ? redactContact(textEl.value) : textEl.value) + '\n\nMY PUBLIC GITHUB PROJECTS (most relevant first):\n' + (gh || '(none loaded)') + '\n\nReturn: 1) the tailored resume, 2) a "Gaps" list, 3) what you changed and why.';
    // 1) permission to type into that site's chat box (Chrome asks once per site; this needs the click, so it goes first)
    let allowed = false;
    try { const origin = providerOrigin(pv.url); allowed = (await chrome.permissions.contains({ origins: [origin] })) || (await chrome.permissions.request({ origins: [origin] })); } catch (e) {}
    // 2) clipboard copy is the backup in every case
    let copied = true;
    try { await navigator.clipboard.writeText(brief); } catch (e) { copied = false; }
    // 3) open the site and type the brief into its chat box (never presses Enter)
    $('msg').textContent = 'Opening ' + pv.name + '...';
    const r = await openAndFill(pv, brief, allowed);
    if (r.filled) $('msg').textContent = 'Filled the chat box in the ' + pv.name + ' tab. Read it, then press Enter there yourself.' + (copied ? ' (A copy is also on your clipboard.)' : '');
    else if (copied) $('msg').textContent = 'I could not fill the chat box (' + r.why + '). The brief is on your clipboard: click the chat box in the ' + pv.name + ' tab and press Ctrl+V.';
    else {
      $('msg').textContent = 'I could not fill the chat box or copy (' + r.why + '). Copy the brief below by hand.';
      aiOut.textContent = '';
      const ta = document.createElement('textarea'); ta.readOnly = true; ta.value = brief; ta.style.minHeight = '140px'; aiOut.append(ta); ta.select();
    }
  });
  render();
  letterEl.value = (got.dibs_letters || {})[jobKey] ? got.dibs_letters[jobKey].text : buildLetter();
  countWords();
  refreshAi();
})();
