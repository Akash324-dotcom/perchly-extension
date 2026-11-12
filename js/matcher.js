// Matcher: for each skill the posting asks for, is there evidence (resume, LinkedIn text, GitHub)?
// This is a keyword match, not a real ATS score. Required skills weigh 2, nice-to-have weigh 1.
const SOFT_SKILLS = new Set(['experimentation', 'communication', 'teamwork', 'problem solving', 'attention to detail', 'time management', 'leadership', 'analytical skills',
  'customer service', 'critical thinking', 'interpersonal relationship management', 'stakeholder management', 'multitasking', 'presentation skills',
  'documentation', 'research', 'decision making', 'results-oriented', 'industry knowledge', 'collaboration', 'adaptability', 'creativity', 'commercial acumen', 'writing', 'negotiation', 'mentoring', 'customer support', 'process improvement', 'process improvements', 'operational delivery']);
const QUICK_SKILLS = new Set(['git', 'github', 'jira', 'agile', 'scrum', 'excel', 'power bi', 'tableau', 'looker', 'figma', 'microsoft office', 'word',
  'powerpoint', 'outlook', 'sharepoint', 'visio', 'bloomberg', 'statistics', 'data visualization', 'a/b testing', 'html', 'css', 'power automate', 'quickbooks', 'reconciliation', 'financial analysis', 'financial reporting', 'compliance', 'auditing', 'accounting',
  'budgeting', 'forecasting', 'risk management', 'sales', 'marketing', 'seo', 'copywriting', 'quality assurance', 'troubleshooting', 'project management']);

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&').replace(/ /g, '\\s+'); }

function regexesFor(name, cfg) {
  const key = name.toLowerCase();
  const dict = (cfg.skills || []).find((x) => x.toLowerCase() === key);
  const base = dict || name;
  const cs = new Set(cfg.caseSensitive || []);
  let head = '(?<![A-Za-z0-9_+#.])';
  let tail = '(?![A-Za-z0-9_+#&])';
  if (base.length <= 2) { tail = "(?![A-Za-z0-9_+#&\\-’'])(?!\\.\\d)"; head = '(?<![A-Za-z0-9_+#.\\-/])'; }
  if (base === 'Testing') head += '(?<!(?:hypothesis|statistical|significance|a\\/b|split)[\\s-])';
  const names = [base];
  if (!dict && /s$/i.test(base)) names.push(base.replace(/s$/i, ''));
  const out = [new RegExp(head + '(?:' + names.map(escapeRe).join('|') + ')' + tail, cs.has(base) ? '' : 'i')];
  const aliases = (cfg.aliases && cfg.aliases[base]) || [];
  const long = aliases.filter((a) => a.length >= 5), short = aliases.filter((a) => a.length < 5);
  if (long.length) out.push(new RegExp(head + '(?:' + long.map(escapeRe).join('|') + ')' + tail, 'i'));
  if (short.length) out.push(new RegExp(head + '(?:' + short.map(escapeRe).join('|') + ')' + tail));
  return out;
}

// Related evidence: no exact word on the resume, but real neighbouring work.
// kind 'word' = you did the thing, the posting's word is just missing (reword one line, only if true).
// kind 'swap' = you know a neighbouring tool, the exact tool is different (a short project closes it).
const RELATED = {
  'deep learning': { kind: 'word', terms: [/\bGRU\b/, /\bLSTM\b/, /neural network/i, /multilayer perceptron/i, /\bMLP\b/, /\bTransformers?\b/i, /\bCNN\b/, /\bBART\b/, /\bBERT\b/, /\bPPO\b/, /\bDQN\b/] },
  'llm evaluation': { kind: 'word', terms: [/hallucination/i, /\bNLI\b/, /faithfulness/i, /evaluation framework/i, /offline evaluation/i, /failure cases?/i] },
  'natural language processing': { kind: 'word', terms: [/\bNLI\b/, /\bTransformers?\b/i, /text extraction/i, /sentence-transformers/i, /Hugging Face/i, /\bRAG\b/] },
  'model evaluation': { kind: 'word', terms: [/ROC-AUC/i, /precision/i, /calibration/i, /evaluation metrics/i] },
  'experimentation': { kind: 'word', terms: [/baseline/i, /ablation/i, /compared/i, /retrieval depth/i] },
  'data pipelines': { kind: 'word', terms: [/\bpipeline\b/i, /\bingestor\b/i, /\bparser\b/i] },
  'mlops': { kind: 'word', terms: [/GitHub Actions/i, /\bCI\/CD\b/i, /Docker/i] },
  'xgboost': { kind: 'swap', terms: [/HistGradientBoosting/i, /HistGBM/i, /gradient boosting/i, /LightGBM/i, /random forest/i] },
  'tensorflow': { kind: 'swap', terms: [/\bPyTorch\b/, /\bKeras\b/i] },
  'pytorch': { kind: 'swap', terms: [/\bTensorFlow\b/, /\bKeras\b/i] },
  'kubernetes': { kind: 'swap', terms: [/Docker/i, /Azure Container Apps/i] },
  'aws': { kind: 'swap', terms: [/\bAzure\b/, /Google Cloud/i, /\bGCP\b/] },
  'azure': { kind: 'swap', terms: [/\bAWS\b/, /Google Cloud/i, /\bGCP\b/] },
  'spark': { kind: 'swap', terms: [/\bpandas\b/i, /data pipeline/i] },
  'learning to rank': { kind: 'swap', terms: [/\branking\b/i, /FAISS/i, /information retrieval/i, /retrieval/i] },
  'react': { kind: 'swap', terms: [/React Native/i] },
  'tableau': { kind: 'swap', terms: [/Power BI/i, /Looker/i, /\bQlik/i] },
  'power bi': { kind: 'swap', terms: [/Tableau/i, /Looker/i, /\bQlik/i] },
  'communication': { kind: 'word', terms: [/\bpresent(?:ed|ations?)\b/i, /non-technical/i, /stakeholders?/i] },
  'sql': { kind: 'swap', terms: [/PostgreSQL/i, /MySQL/i, /SQLite/i] },
};

function relatedFor(name, text) {
  const r = RELATED[name.toLowerCase()];
  if (!r) return null;
  const hits = [];
  for (const re of r.terms) { const m = re.exec(text); if (m && !hits.includes(m[0])) hits.push(m[0]); }
  return hits.length ? { kind: r.kind, hits: hits.slice(0, 3) } : null;
}

function gapPlan(name, cfg) {
  const key = name.toLowerCase();
  const known = (cfg.skills || []).some((x) => x.toLowerCase() === key);
  if (SOFT_SKILLS.has(key)) return { hours: 'under 1 hour', tip: 'If you have really done this, add one real example bullet. If not, skip it.' };
  if (QUICK_SKILLS.has(key) || !known) return { hours: '4 to 12 hours', tip: 'A small project or short course can cover this.' };
  return { hours: '20 to 60 hours', tip: 'Needs a real project to prove it. Plan it for after this application.' };
}

function matchSkills(notes, profile, cfg) {
  const resumeText = (profile.resume || '') + '\n' + (profile.linkedin || '');
  const repos = (profile.github && profile.github.repos) || [];
  const items = [];
  let got = 0, total = 0;
  for (const n of notes) {
    if (n.label !== 'Required skill' && n.label !== 'Nice to have') continue;
    const weight = n.tag ? 0.5 : n.label === 'Required skill' ? 2 : 1;
    const res = regexesFor(n.text, cfg);
    const inResume = res.some((r) => r.test(resumeText));
    // A repo that merely contains the word 'communication' proves nothing, so soft skills never use GitHub as proof.
    const gh = inResume || SOFT_SKILLS.has(n.text.toLowerCase()) ? [] : repos.filter((r) => res.some((x) => x.test(repoText(r)))).map((r) => r.name);
    const rel = inResume || gh.length ? null : relatedFor(n.text, resumeText);
    const status = inResume ? 'resume' : gh.length ? 'github' : rel ? 'related' : 'gap';
    total += weight;
    if (status === 'related') got += weight * 0.5;
    else if (status !== 'gap') got += weight;
    items.push({ id: n.id, name: n.text, mode: n.tag ? 'tag' : n.label === 'Required skill' ? 'req' : 'nice', status, repos: gh.slice(0, 3), related: rel, plan: status === 'related' ? (rel.kind === 'word' ? { hours: 'under 1 hour', tip: 'You have related work (' + rel.hits.join(', ') + '). If it is true, reword one line to use the posting\'s exact words.' } : { hours: '4 to 12 hours', tip: 'You know a neighbour (' + rel.hits.join(', ') + '). A small project in the exact tool would close it.' }) : status === 'gap' ? (n.tag ? { hours: 'not worth chasing', tip: 'A generic company tag. Skip it unless you can give a real example.' } : gapPlan(n.text, cfg)) : null });
  }
  const checks = notes.filter((n) => ['Level', 'Education', 'Work auth'].includes(n.label)).map((n) => n.label + ': ' + n.text);
  return { score: total ? Math.round((got / total) * 100) : null, items, checks, covered: items.filter((i) => i.status === 'resume' || i.status === 'github').length, related: items.filter((i) => i.status === 'related').length };
}
