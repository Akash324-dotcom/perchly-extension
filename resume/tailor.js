// Auto-tailor: rebuilds your resume text for one job WITHOUT inventing anything.
// It only (1) moves whole lines you already wrote, (2) optionally drops bullets that match nothing in the posting,
// and (3) adds a GitHub project made from that repo's own README or description, with a fill-in spot for the result.
const BULLET = /^[•▪●\-–*]\s*/;
const SEC = /^(SUMMARY|PROFILE|OBJECTIVE|TECHNICAL SKILLS|SKILLS|EXPERIENCE|WORK EXPERIENCE|PROJECTS|EDUCATION|CERTIFICATIONS|ACHIEVEMENTS|PUBLICATIONS|AWARDS|VOLUNTEERING)$/;

function parseSections(lines) {
  const secs = [{ head: null, lines: [] }];
  for (const l of lines) {
    if (SEC.test(l.trim())) secs.push({ head: l, lines: [] });
    else secs[secs.length - 1].lines.push(l);
  }
  return secs;
}

// A section of entries (a project or a job) = header lines + bullets. PDF text wraps bullets over several lines.
function parseEntries(lines) {
  const entries = []; let cur = null;
  for (const l of lines) {
    const t = l.trim();
    if (!t) continue;
    if (BULLET.test(t)) { if (!cur) { cur = { header: [], bullets: [] }; entries.push(cur); } cur.bullets.push([l]); continue; }
    if (cur && cur.bullets.length) {
      const lastB = cur.bullets[cur.bullets.length - 1];
      const prev = lastB[lastB.length - 1].trim();
      if (/^[a-z0-9(]/.test(t) || !/[.!?)\]]$/.test(prev)) { lastB.push(l); continue; }   // wrapped line of the same bullet
    }
    if (cur && !cur.bullets.length && cur.header.length < 3) { cur.header.push(l); continue; }
    cur = { header: [l], bullets: [] }; entries.push(cur);
  }
  return entries;
}
const entryText = (e) => e.header.concat(...e.bullets).join(' ');
const entryLines = (e) => e.header.concat(...e.bullets);
const shortHead = (e) => (e.header[0] || '').replace(/\s+/g, ' ').replace(/\s*\(.*$/, '').trim().slice(0, 60);

function splitTop(s) {
  const out = []; let d = 0, cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') d++; else if (ch === ')' || ch === ']') d = Math.max(0, d - 1);
    if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function tailorSkills(lines, weight, log) {
  const logical = [];
  for (const l of lines) {
    const t = l.trim();
    if (!t) continue;
    if (!logical.length || /^[A-Za-z][A-Za-z &\/-]{2,40}:/.test(t)) logical.push(t); else logical[logical.length - 1] += ' ' + t;
  }
  let moved = false;
  const out = logical.map((t) => {
    const i = t.indexOf(':');
    if (i < 0) return t;
    const items = splitTop(t.slice(i + 1));
    const w = items.map((x) => weight(x));
    const idx = items.map((_, k) => k).sort((a, b) => w[b] - w[a] || a - b);
    if (idx.some((k, pos) => k !== pos)) moved = true;
    return t.slice(0, i + 1) + ' ' + idx.map((k) => items[k]).join(', ');
  });
  if (moved) log.push('Moved the skills that match this job to the front of each skills line.');
  return out;
}

function autoTailor(text, ctx) {
  const log = [];
  const secs = parseSections(text.split(/\r?\n/));
  const out = [];
  let addedGh = 0;
  for (const s of secs) {
    if (s.head !== null) out.push(s.head);
    const name = (s.head || '').trim();
    if (ctx.opts.reorder && /SKILLS$/.test(name)) { out.push(...tailorSkills(s.lines, ctx.weight, log)); continue; }
    const isProj = name === 'PROJECTS', isExp = /^(WORK )?EXPERIENCE$/.test(name);
    if (!isProj && !isExp) { out.push(...s.lines); continue; }
    let entries = parseEntries(s.lines);
    if (!entries.length) { out.push(...s.lines); continue; }
    if (isProj && ctx.opts.github) {
      for (const g of ctx.ghEntries) { entries.push({ header: [g.header], bullets: [[g.bullet]], gh: true }); addedGh++; log.push('Added your GitHub project "' + g.title + '" (it shows ' + g.skills.join(', ') + '). Fill in its result.'); }
    }
    if (ctx.opts.trim) {
      let dropped = 0;
      for (const e of entries) {
        if (e.bullets.length <= 2) continue;
        const keep = e.bullets.map((b, i) => ({ b, i, w: ctx.weight(b.join(' ')) }));
        const zero = keep.filter((k) => k.w === 0).map((k) => k.i);
        const room = e.bullets.length - 2;
        const drop = new Set(zero.slice(-room));
        if (drop.size) { e.bullets = e.bullets.filter((_, i) => !drop.has(i)); dropped += drop.size; }
      }
      if (dropped) log.push('Dropped ' + dropped + ' bullet' + (dropped === 1 ? '' : 's') + ' that match nothing in the posting (every entry keeps at least 2).');
    }
    if (isProj && ctx.opts.reorder) {
      const before = entries.map((e) => shortHead(e));
      entries = entries.map((e, i) => ({ e, i, w: ctx.weight(entryText(e)) })).sort((a, b) => b.w - a.w || a.i - b.i).map((x) => x.e);
      const after = entries.map((e) => shortHead(e));
      if (before.join('|') !== after.join('|')) log.push('Reordered Projects, most relevant first. Now leading: "' + after[0] + '".');
    }
    if (isProj && addedGh && entries.length > 6) {
      const ws = entries.map((e) => (e.gh ? 99 : ctx.weight(entryText(e))));
      while (entries.length > 6) { const k = ws.indexOf(Math.min(...ws)); log.push('Removed the least relevant project "' + shortHead(entries[k]) + '" to keep the page short.'); entries.splice(k, 1); ws.splice(k, 1); }
    }
    for (const e of entries) out.push(...entryLines(e));
  }
  if (ctx.opts.github && !addedGh && ctx.ghEntries.length) log.push('I did not add a GitHub project: no PROJECTS heading was found in your text.');
  return { text: out.join('\n'), log };
}
