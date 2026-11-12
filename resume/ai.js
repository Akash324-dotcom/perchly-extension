// AI helpers for the live resume window.
// 1) PROVIDERS: chat sites you can paste the brief into (uses YOUR own login there; Perchly never calls them).
// 2) On-device AI: Chrome's built-in Gemini Nano via the LanguageModel API. Free, no key, text stays on this computer.
const PROVIDERS = [
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/new' },
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { id: 'gemini', name: 'Google Gemini', url: 'https://gemini.google.com/app' },
  { id: 'copilot', name: 'Microsoft Copilot', url: 'https://copilot.microsoft.com/' },
  { id: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai/' },
  { id: 'grok', name: 'Grok', url: 'https://grok.com/' },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/' },
  { id: 'mistral', name: 'Mistral Le Chat', url: 'https://chat.mistral.ai/chat' },
  { id: 'meta', name: 'Meta AI', url: 'https://www.meta.ai/' },
  { id: 'poe', name: 'Poe', url: 'https://poe.com/' },
];

const AI_OPTS = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
const AI_SYSTEM = 'You reword ONE resume bullet so it reads better for a job posting. Rules: keep every fact, number, name and result exactly as written. ' +
  'Never add a new fact, tool, number, employer or result. Keep it to one sentence of similar length. Use the job keyword only if it is already true of the bullet. ' +
  'Reply with the reworded bullet only, no quotes, no explanation.';
let aiSession = null;

async function aiAvailability() {
  if (typeof LanguageModel === 'undefined') return 'missing';
  try { return await LanguageModel.availability(AI_OPTS); }
  catch (e) { try { return await LanguageModel.availability(); } catch (e2) { return 'unavailable'; } }
}

async function aiStart(onProgress) {
  if (aiSession) return aiSession;
  const make = (extra) => LanguageModel.create(Object.assign({
    monitor(m) { m.addEventListener('downloadprogress', (e) => { if (onProgress) onProgress(Math.round((e.loaded <= 1 ? e.loaded * 100 : e.loaded))); }); },
    initialPrompts: [{ role: 'system', content: AI_SYSTEM }],
  }, extra));
  try { aiSession = await make(AI_OPTS); } catch (e) { aiSession = await make({}); }
  return aiSession;
}

function aiPrompt(bullet, keywords) {
  return 'Bullet: ' + bullet + '\nJob keywords that may be used only if true: ' + keywords + '\nReworded bullet:';
}

function aiClean(raw) {
  return String(raw || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] || '';
}

// The truth guard: a rewrite is rejected if it brings in any number or capitalised name that is not already in the original bullet.
function truthGuard(orig, next, allowedText) {
  const probs = [];
  const o = orig.toLowerCase().replace(/\s+/g, ' ');
  const a = (allowedText || '').toLowerCase();
  const n = next.replace(/^[•▪\-–*\s]+/, '').trim();
  if (!n) return { ok: false, problems: ['The AI returned nothing.'] };
  for (const num of (n.match(/\d[\d,.]*%?/g) || [])) {
    const c = num.replace(/[.,]+$/, '').toLowerCase();
    if (c && !o.includes(c)) probs.push('new number "' + c + '"');
  }
  const words = n.match(/[A-Za-z][A-Za-z0-9+#.\-]*/g) || [];
  words.forEach((w, i) => {
    if (i === 0 || !/^[A-Z]/.test(w)) return;
    const lw = w.toLowerCase().replace(/[.\-]+$/, '');
    if (!o.includes(lw) && !a.includes(lw)) probs.push('new name "' + w + '"');
  });
  if (n.length > orig.length * 1.4 + 30) probs.push('much longer than the original');
  return { ok: probs.length === 0, problems: [...new Set(probs)] };
}

// ---- Fill the chat box of the AI site you picked (you still press Enter yourself; Perchly never sends) ----
// This function runs INSIDE the AI site's page. It waits for the chat box, then types the brief into it.
function fillPromptBox(text) {
  return new Promise((resolve) => {
    const started = Date.now();
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 150 && r.height > 18 && getComputedStyle(el).visibility !== 'hidden'; };
    const tick = () => {
      const cands = [...document.querySelectorAll('div[contenteditable="true"], div[contenteditable=""], textarea, [role="textbox"]')].filter(visible)
        .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
      const el = cands[0];
      if (el) {
        el.focus();
        let ok = false;
        if (el.tagName === 'TEXTAREA') {
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, text);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          ok = el.value.length > 0;
        } else {
          document.execCommand('selectAll', false);
          ok = document.execCommand('insertText', false, text);
        }
        if (ok) return resolve({ filled: true });
      }
      if (Date.now() - started > 25000) return resolve({ filled: false, why: 'no chat box found (you may need to sign in first)' });
      setTimeout(tick, 400);
    };
    tick();
  });
}

function providerOrigin(url) { const u = new URL(url); return u.protocol + '//' + u.hostname + '/*'; }

async function openAndFill(pv, text, allowed) {
  const tab = await chrome.tabs.create({ url: pv.url, active: true });
  if (!allowed) return { filled: false, why: 'permission not given' };
  try {
    await new Promise((resolve) => {
      let done = false;
      const fin = () => { if (!done) { done = true; chrome.tabs.onUpdated.removeListener(onUp); resolve(); } };
      const onUp = (id, info) => { if (id === tab.id && info.status === 'complete') fin(); };
      chrome.tabs.onUpdated.addListener(onUp);
      chrome.tabs.get(tab.id).then((t) => { if (t.status === 'complete') fin(); }).catch(() => {});
      setTimeout(fin, 20000);
    });
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fillPromptBox, args: [text] });
    return (r && r.result) || { filled: false, why: 'no answer from the page' };
  } catch (e) { return { filled: false, why: e && e.message ? e.message : String(e) }; }
}
