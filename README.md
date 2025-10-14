# LLM Code Deployment Project

This API automates the **Build → Deploy → Evaluate → Revise** workflow.

## Deploy on Vercel

1. Go to [https://vercel.com/new](https://vercel.com/new)
2. Import this GitHub repo.
3. Add the following environment variables:

| Key | Value |
|-----|--------|
| STUDENT_SECRET | same as what you gave in the Google Form |
| GH_TOKEN | GitHub Personal Access Token with `repo`, `pages` scopes |
| GH_OWNER | your GitHub username |

4. Deploy.  
5. Your endpoint will be:  
   `https://<your-vercel-app>.vercel.app/api-endpoint`

Submit that URL to your instructor’s Google Form.

## What happens
- Instructor POSTs JSON → your endpoint verifies → 200 OK  
- Repo is created, files generated, deployed via GitHub Pages  
- Then, it POSTs results (repo URL, commit, pages URL) back to `evaluation_url`.

Supports multiple rounds (round 1 → round 2 revisions).

## License
MIT
