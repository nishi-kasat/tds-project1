# LLM Code Deployment — Automated App Builder

This project implements an **LLM-assisted application builder and deployer** that automatically builds, deploys, and updates applications based on JSON task requests.

It is built and hosted on **Vercel**, uses **GitHub API integration**, and follows the complete workflow defined in the *LLM Code Deployment* project brief.

---

##  Student Information

- **Name:** Nishi Kasat  
- **Email:** 23f3002823@ds.study.iitm.ac.in  
- **GitHub Owner:** `nishi-kasat`  
- **Vercel Endpoint:** [https://tds-project1-nishi-kasats-projects.vercel.app/api-endpoint](https://tds-project1-nishi-kasats-projects.vercel.app/api-endpoint)

---

##  Project Overview

This API endpoint receives JSON task requests describing applications to be generated, verifies a shared secret, and automatically:

1. Creates or updates a public GitHub repository.
2. Generates minimal working code based on the `brief` (e.g. Markdown converter, Captcha solver, Sales summarizer, GitHub user viewer).
3. Commits generated files (`index.html`, `script.js`, `README.md`, `LICENSE`) to the repo.
4. Enables GitHub Pages for live preview.
5. Posts the repo metadata to an `evaluation_url`.

It supports multi-round revisions (`round: 1` / `round: 2`) as specified in the project brief.

---

##  Tech Stack

| Component | Technology Used |
|------------|-----------------|
| Hosting / API Runtime | Vercel (Node.js 18+) |
| Programming Language | JavaScript (ES Modules) |
| Version Control | GitHub |
| Deployment Automation | GitHub API + Vercel Functions |
| App Generation | Dynamic templates per task brief |
| Authentication | Secret verification via Environment Variable |
| License | MIT |

---

##  Environment Variables (Vercel)

Set these in your Vercel project settings → **Environment Variables**:

| Key | Value |
|-----|--------|
| `SECRET_KEY` | `nishi-kasat` |
| `GITHUB_OWNER` | `nishi-kasat` |
| `GITHUB_TOKEN` | `nishi-kasat` |

---

##  How It Works

###  Request Format

A JSON `POST` request is sent to the endpoint:

```json
{
  "email": "23f3002823@ds.study.iitm.ac.in",
  "secret": "nishi-kasat",
  "task": "markdown-to-html-001",
  "round": 1,
  "nonce": "abc-123",
  "brief": "Publish a static page that converts input.md to HTML with marked.js and highlight.js.",
  "evaluation_url": "https://example.com/notify",
  "attachments": [
    { "name": "input.md", "url": "data:text/markdown;base64,IyBIZWxsbyBXb3JsZA==" }
  ]
}
