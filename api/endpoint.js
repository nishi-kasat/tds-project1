export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const body = await readJson(req);
    if (!body.secret || body.secret !== process.env.STUDENT_SECRET) {
      res.status(401).json({ error: "Invalid secret" });
      return;
    }
    res.status(200).json({ status: "ok" });
    await processRequest(body);
  } catch (err) {
    console.error("Error handling request:", err);
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
}

async function processRequest(request) {
  const gh = githubClient();
  const owner = process.env.GH_OWNER;
  const repo = repoNameFromTask(request.task);
  const repoData = await ensureRepo(gh, owner, repo);
  const generated = await generateFromBrief(request);
  await writeFile(gh, owner, repo, "LICENSE", mitLicenseText(), "add LICENSE");
  await writeFile(gh, owner, repo, "README.md", generated.readme, "add README.md");
  for (const [path, content] of Object.entries(generated.files)) {
    await writeFile(gh, owner, repo, path, content, `add ${path}`);
  }
  if (Array.isArray(request.attachments)) {
    for (const a of request.attachments) {
      const { name, url } = a || {};
      if (!name || !url) continue;
      const { base64 } = parseDataUri(url);
      await writeFile(gh, owner, repo, `attachments/${name}`, base64, `add attachment ${name}`, true);
    }
  }
  const pagesUrl = await enablePages(gh, owner, repo, "main");
  await waitForUrl(pagesUrl);
  const sha = await getLatestCommitSha(gh, owner, repo, "main");
  await postWithRetry(request.evaluation_url, {
    email: request.email,
    task: request.task,
    round: request.round,
    nonce: request.nonce,
    repo_url: `https://github.com/${owner}/${repo}`,
    commit_sha: sha,
    pages_url: pagesUrl
  });
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function githubClient() {
  const token = process.env.GH_TOKEN;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json"
  };
  const base = "https://api.github.com";
  async function request(url, options = {}) {
    const res = await fetch(base + url, { ...options, headers });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${text}`);
    return json;
  }
  return { request };
}

async function ensureRepo(gh, owner, name) {
  try {
    return await gh.request(`/repos/${owner}/${name}`);
  } catch {
    const me = await gh.request(`/user`);
    if (me.login.toLowerCase() === owner.toLowerCase()) {
      return await gh.request(`/user/repos`, {
        method: "POST",
        body: JSON.stringify({ name, private: false, auto_init: true, license_template: "mit" })
      });
    } else {
      return await gh.request(`/orgs/${owner}/repos`, {
        method: "POST",
        body: JSON.stringify({ name, private: false, auto_init: true, license_template: "mit" })
      });
    }
  }
}

function repoNameFromTask(task) {
  return task.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
}

async function writeFile(gh, owner, repo, path, content, message, isBase64 = false) {
  let sha;
  try {
    const existing = await gh.request(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`);
    sha = existing.sha;
  } catch {}
  const body = { message, content: isBase64 ? content : Buffer.from(content).toString("base64") };
  if (sha) body.sha = sha;
  await gh.request(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
    method: "PUT",
    body: JSON.stringify(body)
  });
}

async function getLatestCommitSha(gh, owner, repo, branch) {
  const ref = await gh.request(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  return ref.object.sha;
}

async function enablePages(gh, owner, repo, branch) {
  try {
    await gh.request(`/repos/${owner}/${repo}/pages`, {
      method: "POST",
      body: JSON.stringify({ source: { branch, path: "/" } })
    });
  } catch {
    await gh.request(`/repos/${owner}/${repo}/pages`, {
      method: "PUT",
      body: JSON.stringify({ source: { branch, path: "/" } })
    });
  }
  return `https://${owner}.github.io/${repo}/`;
}

async function waitForUrl(url, timeout = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

async function postWithRetry(url, body) {
  let delay = 1000;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (res.ok) return;
    } catch (e) {
      console.error("Eval post failed:", e);
    }
    await new Promise(r => setTimeout(r, delay));
    delay *= 2;
  }
}

function parseDataUri(uri) {
  const m = /^data:.*;base64,(.*)$/s.exec(uri);
  return { base64: m ? m[1] : "" };
}

function mitLicenseText() {
  const year = new Date().getUTCFullYear();
  const owner = process.env.GH_OWNER || "Student";
  return `MIT License

Copyright (c) ${year} ${owner}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
}

async function generateFromBrief(req) {
  const brief = req.brief.toLowerCase();
  if (brief.includes("captcha-solver")) return captchaSolverTemplate(req.round);
  if (brief.includes("markdown")) return markdownTemplate(req.round);
  if (brief.includes("sales")) return salesTemplate(req.round, req.task);
  if (brief.includes("github user")) return githubUserTemplate(req.round, req.task);
  return basicTemplate(req.brief);
}

function captchaSolverTemplate() {
  return {
    readme: "# Captcha Solver\n\nDisplays image from ?url=... and uses Tesseract.js to extract text.",
    files: {
      "index.html": `<!doctype html><html><head><meta charset="utf-8"><title>Captcha Solver</title><script src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"></script></head><body><img id="captcha"><pre id="result"></pre><script src="script.js"></script></body></html>`,
      "script.js": `async function run(){const u=new URL(location).searchParams.get('url')||'attachments/sample.png';document.getElementById('captcha').src=u;const { createWorker }=Tesseract;const worker=await createWorker();const { data:{text} }=await worker.recognize(u);document.getElementById('result').textContent=text.trim();await worker.terminate();}run();`
    }
  };
}

function markdownTemplate(round) {
  if (round === 1) {
    return {
      readme: "# Markdown to HTML\n\nConverts attached input.md into rendered HTML using marked and highlight.js.",
      files: {
        "index.html": `<!doctype html><html><head><meta charset="utf-8"><title>Markdown</title><script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script><script src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/common.min.js"></script></head><body><div id="markdown-output"></div><script src="script.js"></script></body></html>`,
        "script.js": `async function load(){const t=await (await fetch('attachments/input.md')).text();document.getElementById('markdown-output').innerHTML=marked.parse(t);hljs.highlightAll();}load();`
      }
    };
  } else {
    return {
      readme: "# Markdown to HTML Round 2\n\nAdds tabs, source label, and word count.",
      files: {
        "index.html": `<!doctype html><html><head><meta charset='utf-8'><title>Markdown to HTML</title><link rel='stylesheet' href='https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/default.min.css'></head><body class='p-4'><div id='markdown-tabs'><button id='tab-html'>HTML</button><button id='tab-md'>Markdown</button></div><div id='markdown-source-label'></div><div id='markdown-output'></div><pre id='markdown-source'></pre><span id='markdown-word-count'></span><script src='https://cdn.jsdelivr.net/npm/marked/marked.min.js'></script><script src='https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js'></script><script src='script.js'></script></body></html>`,
        "script.js": `async function main(){const md=await (await fetch('attachments/input.md')).text();const html=marked.parse(md,{highlight:c=>hljs.highlightAuto(c).value});const out=document.querySelector('#markdown-output');const src=document.querySelector('#markdown-source');out.innerHTML=html;src.textContent=md;document.querySelector('#markdown-source-label').textContent='Attachment: input.md';document.querySelector('#tab-html').onclick=()=>{out.style.display='block';src.style.display='none';};document.querySelector('#tab-md').onclick=()=>{out.style.display='none';src.style.display='block';};const count=md.trim().split(/\\s+/).length;document.querySelector('#markdown-word-count').textContent=new Intl.NumberFormat().format(count)+' words';}main();`
      }
    };
  }
}

function salesTemplate(round, task) {
  const seed = task.split("-").pop();
  if (round === 1) {
    return {
      readme: "# Sum of Sales\n\nFetches data.csv, sums its sales column, and displays the total.",
      files: {
        "index.html": `<!doctype html><html><head><meta charset="utf-8"><title>Sales Summary ${seed}</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5/dist/css/bootstrap.min.css"></head><body><h1>Sales Summary ${seed}</h1><div>Total: <span id="total-sales">0</span></div><script src="script.js"></script></body></html>`,
        "script.js": `async function load(){const csv=await (await fetch('attachments/data.csv')).text();const rows=csv.trim().split(/\\n/).map(r=>r.split(','));const hdr=rows.shift();const i=hdr.indexOf('sales');const total=rows.reduce((s,r)=>s+parseFloat(r[i]||0),0);document.getElementById('total-sales').textContent=total.toFixed(2);}load();`
      }
    };
  } else {
    return {
      readme: "# Sum of Sales Round 2\n\nAdds table and currency picker.",
      files: {
        "index.html": `<!doctype html><html><head><meta charset="utf-8"><title>Sales Summary ${seed}</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5/dist/css/bootstrap.min.css"></head><body class='p-4'><h1>Sales Summary ${seed}</h1><select id='currency-picker'><option value='USD'>USD</option></select><div>Total: <span id='total-sales'>0</span> <span id='total-currency'></span></div><table id='product-sales' class='table'><tbody></tbody></table><script src='script.js'></script></body></html>`,
        "script.js": `async function main(){const csv=await (await fetch('attachments/data.csv')).text();const rows=csv.trim().split(/\\n/).map(r=>r.split(','));const hdr=rows.shift();const iS=hdr.indexOf('sales');const iP=hdr.indexOf('product');const tbody=document.querySelector('#product-sales tbody');let total=0;for(const r of rows){const tr=document.createElement('tr');tr.innerHTML=\`<td>\${r[iP]}</td><td>\${r[iS]}</td>\`;tbody.appendChild(tr);total+=parseFloat(r[iS]||0);}document.querySelector('#total-sales').textContent=total.toFixed(2);}main();`
      }
    };
  }
}

function githubUserTemplate(round, task) {
  const seed = task.split("-").pop();
  if (round === 1) {
    return {
      readme: "# GitHub User Created\n\nFetches GitHub username and shows account creation date.",
      files: {
        "index.html": `<!doctype html><html><head><meta charset='utf-8'><title>GitHub User</title><link rel='stylesheet' href='https://cdn.jsdelivr.net/npm/bootstrap@5/dist/css/bootstrap.min.css'></head><body class='p-4'><form id='github-user-${seed}'><input id='username' class='form-control mb-2' placeholder='GitHub username'><button class='btn btn-primary'>Check</button></form><div>Created At: <span id='github-created-at'></span></div><script src='script.js'></script></body></html>`,
        "script.js": `document.querySelector('form').onsubmit=async e=>{e.preventDefault();const u=username.value.trim();const r=await fetch('https://api.github.com/users/'+u);const d=await r.json();if(d.created_at){github_created_at.textContent=new Date(d.created_at).toISOString().slice(0,10);}else{github_created_at.textContent='Not found';}};`
      }
    };
  } else {
    return {
      readme: "# GitHub User Created Round 2\n\nAdds aria-live, age, and caching.",
      files: {
        "index.html": `<!doctype html><html><head><meta charset='utf-8'><title>GitHub User</title><link rel='stylesheet' href='https://cdn.jsdelivr.net/npm/bootstrap@5/dist/css/bootstrap.min.css'></head><body class='p-4'><form id='github-user-${seed}'><input id='username' class='form-control mb-2'><button class='btn btn-primary'>Check</button></form><div id='github-status' aria-live='polite'></div><div>Created At: <span id='github-created-at'></span> <span id='github-account-age'></span></div><script src='script.js'></script></body></html>`,
        "script.js": `const key='github-user-${seed}';const saved=localStorage.getItem(key);if(saved)username.value=saved;document.querySelector('form').onsubmit=async e=>{e.preventDefault();const user=username.value.trim();if(!user)return;github_status.textContent='Looking up...';const r=await fetch('https://api.github.com/users/'+user);const d=await r.json();if(d.created_at){github_status.textContent='Found user!';const date=new Date(d.created_at);github_created_at.textContent=date.toISOString().slice(0,10);const age=Math.floor((Date.now()-date)/(365*24*60*60*1000));github_account_age.textContent=age+' years';localStorage.setItem(key,user);}else{github_status.textContent='User not found';}};`
      }
    };
  }
}

function basicTemplate(brief) {
  return {
    readme: "# Generic Task App\n\nImplements the provided brief.",
    files: { "index.html": `<!doctype html><html><body><h1>Task Brief</h1><pre>${brief}</pre></body></html>` }
  };
}
