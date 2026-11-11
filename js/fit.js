// Fit check: the hard things no resume tweak can fix (years asked, seniority, leading people, required licences).
// It only WARNS. You decide whether to apply. Keyword match tells you about wording; this tells you about reality.
function fitCheck(notes, profile) {
  const yrs = parseFloat(profile && profile.years);
  const have = isNaN(yrs) ? 0 : yrs;
  const reasons = [];
  const add = (sev, text) => { if (!reasons.some((r) => r.text === text)) reasons.push({ sev, text }); };
  const role = ((notes.find((n) => n.label === 'Role') || {}).text) || '';
  const lines = notes.filter((n) => n.line).map((n) => ({ label: n.label, t: n.full || n.text }));
  const req = lines.filter((l) => l.label === 'Requirement' || l.label === 'Duty');

  // 1. Years asked (highest minimum found in the level note or requirement lines; "up to 2 years" is a ceiling, not a minimum)
  let min = 0, shown = '';
  const yearRe = /(\d{1,2})\s*(?:\+|plus)?\s*(?:years?|yrs)\b/gi;
  const pool = notes.filter((n) => n.label === 'Level').map((n) => n.text).concat(lines.filter((l) => l.label === 'Requirement').map((l) => l.t));
  for (const t of pool) {
    let m; yearRe.lastIndex = 0;
    while ((m = yearRe.exec(t))) {
      const before = t.slice(Math.max(0, m.index - 14), m.index).toLowerCase();
      if (/(up to|under|less than|maximum of|max\.?|\d\s*(?:to|-|–)\s*)$/.test(before)) continue;
      const n = +m[1];
      if (n > min && n <= 20) { min = n; shown = m[0].replace(/\s+/g, ''); }
    }
  }
  if (min - have >= 4) add(2, 'Asks for ' + min + '+ years of experience. You have ' + have + '.');
  else if (min - have >= 3) add(1, 'Asks for ' + min + '+ years of experience. You have ' + have + ' (a stretch).');

  // 2. Seniority in the job title
  if (/\b(director|vp|vice president|head of|chief|principal|staff|distinguished)\b/i.test(role)) add(2, 'Senior title: "' + role.replace(/\s+/g, ' ').slice(0, 60) + '".');
  else if (/\b(senior|sr\.?|lead|manager)\b/i.test(role) && !/\b(junior|jr|entry|new grad|associate)\b/i.test(role)) add(1, 'Title suggests a more senior role: "' + role.replace(/\s+/g, ' ').slice(0, 60) + '".');

  // 3. Leading people
  const strong = /team of \w+|direct reports|\d+\+?\s*years[^.]{0,50}(?:leading|managing)|manager of managers|people management|managing managers/i;
  const weak = /\b(?:lead(?:ing)?|manag(?:e|ing))\s+(?:a\s+|the\s+|and\s+\w+\s+)?(?:team|people|engineers|analysts)\b/i;
  const sHit = req.find((l) => strong.test(l.t));
  if (sHit) add(2, 'Expects you to lead people: "' + (strong.exec(sHit.t) || [''])[0] + '".');
  else if (req.find((l) => weak.test(l.t))) add(1, 'Mentions leading a team.');

  // 4. Professional qualification written as a requirement
  const qual = /\b(ACA|CPA|CMA|CFA|FRM|PMP|CISSP|P\.?Eng|licensed|bar admission|registered nurse)\b|\bCA\b(?=[ ,.)])/;
  const qHit = lines.filter((l) => l.label === 'Requirement').map((l) => qual.exec(l.t)).find(Boolean);
  if (qHit) add(2, 'Requires a professional qualification: ' + qHit[0] + '.');

  // 5. Degree level
  const ed = notes.find((n) => n.label === 'Education');
  if (ed && /^(?:PhD|Ph\.?D\.?|Doctorate)$/i.test(ed.text.trim())) add(1, 'Asks for a PhD.');

  const worst = reasons.reduce((a, r) => Math.max(a, r.sev), 0);
  const total = reasons.reduce((a, r) => a + r.sev, 0);
  const verdict = worst >= 2 || total >= 3 ? 'mismatch' : worst === 1 ? 'stretch' : 'ok';
  return { verdict, reasons: reasons.map((r) => r.text), years: have, assumed: isNaN(yrs) };
}
