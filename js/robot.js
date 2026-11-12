// The Perchly robot: one SVG, many moods. The CSS in css/sidepanel.css animates it
// based on the data-mood attribute on #robot.
const ROBOT_SVG = `
<svg viewBox="0 0 96 112" width="72" height="84" aria-hidden="true">
  <line x1="43" y1="6" x2="43" y2="16" stroke="#5b6475" stroke-width="2.5"/>
  <circle class="antenna" cx="43" cy="5" r="4.5"/>
  <rect x="14" y="16" width="58" height="46" rx="14" fill="#e9ecff" stroke="#1b1f2a" stroke-width="2.5"/>
  <rect x="20" y="24" width="46" height="20" rx="10" fill="#fff" stroke="#1b1f2a" stroke-width="1.5"/>
  <circle cx="33" cy="34" r="6" fill="#fff" stroke="#1b1f2a" stroke-width="1.5"/>
  <circle cx="53" cy="34" r="6" fill="#fff" stroke="#1b1f2a" stroke-width="1.5"/>
  <circle class="pupil" cx="33" cy="34" r="3" fill="#1b1f2a"/>
  <circle class="pupil" cx="53" cy="34" r="3" fill="#1b1f2a"/>
  <path class="mouth" d="M33 52 Q43 59 53 52" stroke="#1b1f2a" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  <rect x="20" y="66" width="46" height="34" rx="10" fill="#a9b0ff" stroke="#1b1f2a" stroke-width="2.5"/>
  <rect x="30" y="74" width="26" height="14" rx="3" fill="#fff" stroke="#1b1f2a" stroke-width="1.2"/>
  <circle cx="36" cy="81" r="2" fill="#0ea5a4"/><circle cx="43" cy="81" r="2" fill="#f59e0b"/><circle cx="50" cy="81" r="2" fill="#ef4444"/>
  <rect x="9" y="72" width="9" height="22" rx="4.5" fill="#8b93ff"/>
  <g class="arm-r">
    <rect x="68" y="72" width="9" height="22" rx="4.5" fill="#8b93ff"/>
    <line x1="74" y1="94" x2="74" y2="104" stroke="#f59e0b" stroke-width="3" stroke-linecap="round"/>
  </g>
  <rect x="26" y="100" width="12" height="8" rx="3" fill="#5b6475"/>
  <rect x="48" y="100" width="12" height="8" rx="3" fill="#5b6475"/>
  <g class="fx fx-flag"><line x1="80" y1="30" x2="80" y2="8" stroke="#5b6475" stroke-width="2"/><path d="M80 8 L94 13 L80 19 Z" fill="#ef4444"/></g>
  <g class="fx fx-q"><text x="76" y="26" font-size="22" font-weight="700" fill="#4f46e5" font-family="system-ui, sans-serif">?</text></g>
  <g class="fx fx-party">
    <circle cx="8" cy="22" r="3" fill="#f59e0b"/><circle cx="84" cy="18" r="3" fill="#0ea5a4"/>
    <circle cx="90" cy="46" r="2.5" fill="#ef4444"/><circle cx="4" cy="48" r="2.5" fill="#4f46e5"/>
  </g>
</svg>`;

const MOUTHS = {
  idle:      'M33 52 Q43 59 53 52',
  reading:   'M35 54 H51',
  writing:   'M33 52 Q43 59 53 52',
  celebrate: 'M30 50 Q43 66 56 50',
  redflag:   'M34 57 Q43 50 52 57',
  confused:  'M33 55 Q38 51 43 55 T53 55',
};

const robotBox = document.getElementById('robot');
robotBox.innerHTML = ROBOT_SVG; // fixed constant above, never page text

function setRobotMood(mood) {
  robotBox.dataset.mood = mood;
  robotBox.querySelector('.mouth').setAttribute('d', MOUTHS[mood] || MOUTHS.idle);
}

function setBubble(text) {
  const b = document.getElementById('bubble');
  if (b.textContent === text) return;
  b.textContent = text;
  b.classList.remove('talk'); void b.offsetWidth; b.classList.add('talk');
}

// Click the robot for a little hop and wave.
robotBox.addEventListener('click', () => {
  robotBox.classList.remove('boop'); void robotBox.offsetWidth; robotBox.classList.add('boop');
  setTimeout(() => robotBox.classList.remove('boop'), 700);
});
