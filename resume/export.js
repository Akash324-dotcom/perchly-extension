// Turns the plain resume text into a clean one-page layout for PDF (print) and Word, and measures how full the page is.
// Everything is built with createElement and textContent, so text from the resume can never run as code.
// PDF text has odd spacing; tidy it: extra spaces, space before punctuation, and hyphens split by a line wrap ("vessel- trajectory", "Transformer -based").
const squash = (s) => s.replace(/\s+/g, ' ').replace(/\s+([,.;:)])/g, '$1').replace(/\(\s+/g, '(').replace(/(\w)- (?=[a-z])/g, '$1-').replace(/(\w) -(?=[a-z])/g, '$1-').trim();
const BUL = /^[•▪●\-–*]\s*/;

function resumeToSheet(text) {
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; sheet.append(e); return e; };
  const secs = parseSections(text.split(/\r?\n/));
  // top block: name, then contact lines
  const top = secs[0].lines.map((l) => l.trim()).filter(Boolean);
  if (top.length) el('h1', '', squash(top[0]));
  if (top.length > 1) el('p', 'contact', top.slice(1).map(squash).join('  |  ').replace(/\s*\|\s*(\|\s*)+/g, '  |  '));
  for (const s of secs.slice(1)) {
    const name = s.head.trim();
    el('h2', '', name);
    if (name === 'PROJECTS' || /^(WORK )?EXPERIENCE$/.test(name)) {
      for (const e of parseEntries(s.lines)) {
        e.header.forEach((h, i) => {
          const m = /^(.*?)\s{2,}([^ ].{2,30})$/.exec(h.trim());      // "Title      2026 – Present" -> title left, date right
          const row = el('p', i === 0 ? 'eh' : 'es');
          if (m && i === 0 && /\d{4}|present/i.test(m[2])) { const a = document.createElement('span'); a.textContent = squash(m[1]); const b = document.createElement('span'); b.className = 'dt'; b.textContent = squash(m[2]); row.append(a, b); }
          else row.textContent = squash(h);
        });
        if (e.bullets.length) { const ul = document.createElement('ul'); for (const b of e.bullets) { const li = document.createElement('li'); li.textContent = squash(b.join(' ').replace(BUL, '')); ul.append(li); } sheet.append(ul); }
      }
    } else if (/SKILLS$/.test(name)) {
      const logical = [];
      for (const l of s.lines) { const t = l.trim(); if (!t) continue; if (!logical.length || /^[A-Za-z][A-Za-z &\/-]{2,40}:/.test(t)) logical.push(t); else logical[logical.length - 1] += ' ' + t; }
      for (const t of logical) { const i = t.indexOf(':'); const p = el('p', 'sk'); if (i > 0) { const b = document.createElement('b'); b.textContent = squash(t.slice(0, i + 1)) + ' '; p.append(b, squash(t.slice(i + 1))); } else p.textContent = squash(t); }
    } else {
      // summary, education and anything else: join wrapped lines into paragraphs
      const paras = [];
      for (const l of s.lines) { const t = l.trim(); if (!t) { paras.push(''); continue; } if (paras.length && paras[paras.length - 1] && !BUL.test(t)) paras[paras.length - 1] += ' ' + t; else paras.push(t); }
      for (const p of paras.filter(Boolean)) el('p', '', squash(p.replace(BUL, '')));
    }
  }
  return sheet;
}

function letterToSheet(text) {
  const sheet = document.createElement('div');
  sheet.className = 'sheet letter';
  for (const para of text.split(/\n\s*\n/)) { const p = document.createElement('p'); p.textContent = para.trim(); sheet.append(p); }
  return sheet;
}

// Sizes inside the sheet are relative (em), so one number, the base font size, scales the whole page.
const SHEET_CSS = '.sheet{font:10.5pt/1.25 Calibri,Arial,sans-serif;color:#000}.sheet h1{font-size:1.7em;text-align:center;margin:0 0 .15em}' +
  '.sheet .contact{text-align:center;font-size:.92em;margin:0 0 .5em}.sheet h2{font-size:1em;letter-spacing:.06em;border-bottom:1px solid #000;margin:.7em 0 .3em;padding-bottom:.1em}' +
  '.sheet p{margin:0 0 .2em}.sheet .eh{font-weight:bold;display:flex;justify-content:space-between;gap:1em;margin-top:.35em}.sheet .es{font-style:italic}.sheet .dt{font-weight:normal;white-space:nowrap}' +
  '.sheet ul{margin:.1em 0 .3em;padding-left:1.3em}.sheet li{margin:0 0 .12em}.sheet.letter{font-size:11pt;line-height:1.45}.sheet.letter p{margin:0 0 .9em;white-space:pre-line}';

// How full is one US Letter page (7.5in x 10in inside 0.5in margins)? Measured off-screen; an estimate, since Word and PDF fonts differ a little.
function pageFill(sheet) {
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;left:-9999px;top:0;width:7.5in;visibility:hidden';
  box.append(sheet.cloneNode(true)); document.body.append(box);
  const pct = Math.round((box.getBoundingClientRect().height / (10 * 96)) * 100);
  box.remove();
  return pct;
}

// Picks the largest text size from 10.5pt down to 8.5pt at which the resume fits one page.
function fitResume(text) {
  const sheet = resumeToSheet(text);
  let fs = 10.5, pct = 0;
  for (; fs >= 8.5; fs -= 0.5) { sheet.style.fontSize = fs + 'pt'; pct = pageFill(sheet); if (pct <= 100) break; }
  if (fs < 8.5) fs = 8.5;
  sheet.style.fontSize = fs + 'pt';
  return { sheet, fs, pct };
}

function printSheet(sheet) {
  let host = document.getElementById('print-sheet');
  if (!host) { host = document.createElement('div'); host.id = 'print-sheet'; document.body.append(host); }
  host.textContent = ''; host.append(sheet);
  window.print();
}

// Word opens an HTML file saved as .doc. Simple, needs no library, and the text stays editable.
function wordBlob(sheet, title) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>' + esc(title) + '</title>' +
    '<style>@page{size:8.5in 11in;margin:0.5in}' + SHEET_CSS.replace(/display:flex;justify-content:space-between;gap:10pt;/, '') + '.sheet .dt{float:right}</style></head><body>' + sheet.outerHTML + '</body></html>';
  return new Blob(['﻿', html], { type: 'application/msword' });
}
