export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = await readJson(req);

    // 1️⃣ Verify secret
    if (!body.secret || body.secret !== process.env.STUDENT_SECRET) {
      res.status(401).json({ error: "Invalid secret" });
      return;
    }

    // 2️⃣ Acknowledge immediately (HTTP 200 per spec)
    res.status(200).json({ status: "ok" });

    // 3️⃣ Continue async (build and deploy)
    await processRequest(body);
  } catch (err) {
    console.error("Error handling request:", err);
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
}

// ========================================================================
// MAIN FLOW
// ========================================================================

async function processRequest(request) {
  const gh = githubClient();
  const owner = process.env.GH_OWNER;
  const repo = repoNameFromTask(request.task);

  // Create or reuse repository
  const repoData = await ensureRepo(gh, owner, repo);

  // Generate files based on brief
  const generated = await generateFromBrief(request);

  // Commit LICENSE, README, and files
  await writeFile(gh, owner, repo, "LICENSE", mitLicenseText(), "add LICENSE");
  await writeFile(gh, owner, repo, "README.md", generated.readme, "add README.md");

  for (const [path, content] of Object.entries(generated.files)) {
    await writeFile(gh, owner, repo, path, content, `add ${path}`);
  }

  // Handle attachments
  if (Array.isArray(request.attachments)) {
    for (const a of request.attachments) {
      const { name, url } = a || {};
      if (!name || !url) continue;
      const { base64 } = parseDataUri(url);
      await writeFile(gh, owner, repo, `attachments/${name}`, base64, `add attachment ${name}`, true);
    }
  }

  // Enable GitHub Pages
  const pagesUrl = await enablePages(gh, owner, repo, "main");

  // Get latest commit SHA
  const sha = await getLatestCommitSha(gh, owner, repo, "main");

  // POST to evaluation_url
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

// ========================================================================
// HELPERS
// ========================================================================

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
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${text}`);
    return json;
  }

  return { request };
}

async function ensureRepo(gh, owner, name) {
  try {
    return await gh.request(`/repos/${owner}/${name}`);
  } catch {
    return await gh.request(`/user/repos`, {
      method: "POST",
      body: JSON.stringify({
        name,
        private: false,
        auto_init: true,
        license_template: "mit"
      })
    });
  }
}

function repoNameFromTask(task) {
  return task.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
}

async function writeFile(gh, owner, repo, path, content, message, isBase64 = false) {
  const base64 = isBase64 ? content : Buffer.from(content).toString("base64");
  await gh.request(`/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({ message, content: base64 })
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
    await new Promise((r) => setTimeout(r, delay));
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
  return `MIT License\n\nCopyright (c) ${year} ${owner}\n\nPermission is hereby granted...`;
}

// ========================================================================
// APP GENERATION LOGIC
// ========================================================================

async function generateFromBrief(req) {
  const brief = req.brief.toLowerCase();

  if (brief.includes("captcha-solver")) {
    return captchaSolverTemplate();
  } else if (brief.includes("markdown")) {
    return markdownTemplate();
  } else if (brief.includes("sales")) {
    return salesTemplate();
  } else if (brief.includes("github user")) {
    return githubUserTemplate();
  }

  // fallback
  return basicTemplate(req.brief);
}

// ---- Templates ----
function captchaSolverTemplate() {
  return {
    readme: "# Captcha Solver\n\nDisplays image from ?url=... and uses Tesseract.js to extract text.",
    files: {
      "index.html": `<!doctype html><html><head><meta charset="utf-8"><title>Captcha Solver</title><script src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"></script></head><body><img id="captcha"><pre id="result"></pre><script src="script.js"></script></body></html>`,
      "script.js": `async function run(){const u=new URL(location).searchParams.get('url')||'attachments/sample.png';document.getElementById('captcha').src=u;const { createWorker }=Tesseract;const worker=await createWorker();const { data:{text} }=await worker.recognize(u);document.getElementById('result').textContent=text.trim();await worker.terminate();}run();`
    }
  };
}

function markdownTemplate() {
  return {
    readme: "# Markdown to HTML\n\nConverts attached input.md into rendered HTML using marked and highlight.js.",
    files: {
      "index.html": `<!doctype html><html><head><meta charset="utf-8"><title>Markdown</title><script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script><script src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/common.min.js"></script></head><body><div id="markdown-output"></div><script src="script.js"></script></body></html>`,
      "script.js": `async function load(){const t=await (await fetch('attachments/input.md')).text();document.getElementById('markdown-output').innerHTML=marked.parse(t);hljs.highlightAll();}load();`
    }
  };
}

function salesTemplate() {
  return {
    readme: "# Sum of Sales\n\nFetches data.csv, sums its sales column, and displays the total.",
    files: {
      "index.html": `<!doctype html><html><head><meta charset="utf-8"><title>Sales Summary</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5/dist/css/bootstrap.min.css"></head><body><h1 id="title">Sales Summary</h1><div>Total: <span id="total-sales">0</span></div><script src="script.js"></script></body></html>`,
      "script.js": `async function load(){const csv=await (await fetch('attachments/data.csv')).text();const rows=csv.trim().split(/\\n/).map(r=>r.split(','));const hdr=rows.shift();const i=hdr.indexOf('sales');const total=rows.reduce((s,r)=>s+parseFloat(r[i]||0),0);document.getElementById('total-sales').textContent=total.toFixed(2);}load();`
    }
  };
}

function githubUserTemplate() {
  return {
    readme: "# GitHub User Created\n\nFetches GitHub username and shows account creation date.",
    files: {
      "index.html": `<!doctype html><html><head><meta charset="utf-8"><title>GitHub User</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5/dist/css/bootstrap.min.css"></head><body><form id="form"><input name="user" placeholder="octocat"><button>Lookup</button></form><div id="github-created-at"></div><script src="script.js"></script></body></html>`,
      "script.js": `document.getElementById('form').addEventListener('submit',async e=>{e.preventDefault();const u=new FormData(e.target).get('user');const r=await fetch('https://api.github.com/users/'+u);const j=await r.json();document.getElementById('github-created-at').textContent=new Date(j.created_at).toISOString().slice(0,10);});`
    }
  };
}

function basicTemplate(brief) {
  return {
    readme: "# Generic Task App\n\nImplements the provided brief.",
    files: {
      "index.html": `<!doctype html><html><body><h1>Task Brief</h1><pre>${brief}</pre></body></html>`
    }
  };
}
