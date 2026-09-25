# ECLIPSE: Sales Page Premortem

Deploy to Vercel:
1. Push this folder to a GitHub repo and import it in Vercel (no framework preset, no build command).
2. In Project Settings > Environment Variables, add ANTHROPIC_API_KEY.
3. Deploy. The page lives at / and the analysis runs through /api/premortem.

Files:
- public/index.html: the tool (front end)
- api/premortem.js: fetches URLs, extracts the copy, calls Claude, returns the report JSON
- api/_prompt.js: the diagnostic prompt built from the Buyer Psychology and Sales Page System (edit here to change the criteria; keep public/index.html's copy in sync if you use the preview mode)
