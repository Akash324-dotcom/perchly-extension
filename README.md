# Perchly

**A little robot that reads the job posting for you.** A free, private Chrome side panel that turns a job posting into notes, a keyword match, a gap plan, a tailored resume and a tracker, without leaving the page.

Version 1.0.0. No server, no account, no analytics. Everything is stored in your browser.

## What it does

- **Reads a posting into notes.** A small robot highlights the words on the page while sticky notes appear: pay, level, place, dates, every requirement, duty and preferred line, required and nice-to-have skills, and flags (no pay listed, deadline passed).
- **Fit check.** Warns about what no resume wording can fix: years asked, senior titles, leading people, required licences.
- **Keyword match.** Counts the posting's skills that are written on your resume, and shows separately what only your LinkedIn text or GitHub repos prove. It is a keyword match, not an "ATS score".
- **Gap plan.** Each gap gets a rough time in hours. "Related" skills (you did the work, the word is missing) are separated from real gaps.
- **You stay in control.** Remove any wrong note with its x button. Click a gap to say "I have this" and name the project that proves it.
- **Tailoring window.** Auto-tailor reorders your own lines for the job and can add a GitHub project from its README, with a fill-in spot for the result. Live score, page-fit meter, cover letter (250 words, built from one real bullet), export to PDF or Word.
- **Optional AI.** Chrome's on-device model can reword one bullet, with a truth check that rejects new numbers and names. Or send a full brief to the chat AI you already use (10 supported). Perchly never presses Send.
- **Tracker.** Save or mark a job as applied. Perchly checks the tracker first when you open a posting, and warns about similar roles. Status, follow-up date, CSV export and import.

## What it will never do

- Submit an application, or press Apply for you.
- Add a skill to your resume without your own words behind it.
- Send your data anywhere. The only network calls are GitHub's public API (if you enter a username) and whatever AI you choose to use yourself.

## Install (developer mode)

1. Download or clone this folder.
2. Open `chrome://extensions`, switch on **Developer mode**, press **Load unpacked** and pick the folder.
3. Agree to the Terms and Privacy Policy on the welcome page.
4. Open a job posting and click the Perchly icon.

Needs Chrome 116 or newer. The on-device AI helper needs Chrome 138 or newer and a capable computer; everything else works without it.

## How it is built

| Part | File | Job |
|---|---|---|
| Content script | `content/content.js` | The only part that touches the page. Reads the visible text and highlights words. |
| Side panel | `sidepanel.html`, `js/sidepanel.js` | Notes board, robot, score, settings. |
| Matcher | `js/matcher.js` | Compares posting skills with resume, LinkedIn text and GitHub. |
| Fit check | `js/fit.js` | Years, seniority, people-leading, licences. |
| Tracker | `js/tracker.js` | Duplicate check, statuses, CSV. |
| Tailoring window | `resume/` | Auto-tailor, AI helpers, cover letter, export. |
| Skill list | `data/skills.json` | About 230 skills with aliases. |

Reading is pattern matching, not AI, so it can miss or misread things. Page text is treated as untrusted and is only ever shown with `textContent`. No code is loaded from the internet; PDF reading uses a bundled copy of pdf.js (Apache 2.0 licence).

## Privacy

See `docs/privacy.html` and `docs/terms.html`. Short version: your resume, notes and tracker never leave your browser unless you press a button that says so.

## Licence

Not chosen yet. Until a licence file is added, all rights are reserved by the author.
