// GitHub import: reads the user's PUBLIC repos and each repo's public README. Nothing is sent but the username.
async function fetchReadme(user, repo) {
  const res = await fetch('https://api.github.com/repos/' + encodeURIComponent(user) + '/' + encodeURIComponent(repo) + '/readme', { headers: { Accept: 'application/vnd.github.raw+json' } });
  if (res.status === 403 || res.status === 429) { const e = new Error('rate'); e.rate = true; throw e; }
  if (!res.ok) return '';
  const raw = await res.text();
  return raw.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/<[^>]+>/g, ' ').replace(/```[\s\S]*?```/g, ' ').replace(/[#*_`>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000);
}

async function fetchGithub(user, onProgress) {
  const url = 'https://api.github.com/users/' + encodeURIComponent(user) + '/repos?per_page=100&sort=pushed';
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (res.status === 404) throw new Error('GitHub user not found');
  if (!res.ok) throw new Error('GitHub said ' + res.status + '. Try again in a minute.');
  const repos = (await res.json()).filter((r) => !r.fork).map((r) => ({
    name: r.name, desc: r.description || '', lang: r.language || '', topics: r.topics || [],
    url: r.html_url, stars: r.stargazers_count || 0, pushed: (r.pushed_at || '').slice(0, 10), readme: '',
  }));
  // README text lets Perchly see what a project really contains. Small batches keep us under GitHub's anonymous limit.
  let done = 0, limited = false;
  for (let i = 0; i < repos.length && !limited; i += 4) {
    await Promise.all(repos.slice(i, i + 4).map(async (r) => {
      try { r.readme = await fetchReadme(user, r.name); } catch (e) { if (e.rate) limited = true; }
      done++; if (onProgress) onProgress(done, repos.length);
    }));
  }
  return { user, fetchedAt: new Date().toISOString(), readmeLimited: limited, repos };
}

function repoText(r) {
  return [r.name.replace(/[-_]/g, ' '), r.desc, r.lang].concat(r.topics, [r.readme || '']).join(' ');
}
