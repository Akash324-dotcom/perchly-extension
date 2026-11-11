// Welcome page: nothing is read or stored until the box is ticked and the button pressed.
const box = document.getElementById('agree-box');
const agreeBtn = document.getElementById('agree-btn');
const declineBtn = document.getElementById('decline-btn');
const message = document.getElementById('message');
document.getElementById('ver').textContent = TERMS_VERSION;

// If the user agreed to an older version, say what changed.
chrome.storage.local.get('consent').then(({ consent }) => {
  if (consent && consent.termsVersion && consent.termsVersion !== TERMS_VERSION) {
    const c = document.getElementById('changed');
    c.textContent = 'The Terms and Privacy Policy were updated (you agreed to version ' + consent.termsVersion + ').' + (TERMS_CHANGES ? ' What changed: ' + TERMS_CHANGES : ' Please read them again.');
    c.hidden = false;
  } else if (consent && consent.termsVersion === TERMS_VERSION) {
    message.textContent = 'You already agreed to this version on ' + String(consent.acceptedAt).slice(0, 10) + '. Click the Dibs icon in your toolbar to start.';
  }
});

box.addEventListener('change', () => { agreeBtn.disabled = !box.checked; });

agreeBtn.addEventListener('click', async () => {
  await chrome.storage.local.set({ consent: { termsVersion: TERMS_VERSION, acceptedAt: new Date().toISOString() } });
  message.textContent = 'All set. Click the Dibs icon in your toolbar to start.';
  agreeBtn.disabled = true;
  declineBtn.disabled = true;
  box.disabled = true;
});

declineBtn.addEventListener('click', () => {
  message.textContent = "Dibs can't run without agreeing. Nothing was stored. You can remove it any time from chrome://extensions.";
});
