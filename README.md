# KenSei Workshop

This workspace root is the main KenSei tools platform. The secondary car website lives in projects/3A3D/ as an independent Git repository. Legacy personal-homepage source is no longer kept in this workspace; About Me still links to the existing online homepage.

## Build and preview

```powershell
python build.py
python -m http.server 8768 --bind 127.0.0.1 --directory dist
```

Open [http://127.0.0.1:8768](https://kensei-workshop.vercel.app/). This workspace root is the main project root. Deploy only `dist/`, or select this root folder for the main Vercel project. The car website has its own deployment root: `projects/3A3D/`. The included Vercel build needs Python 3; alternatively build locally and deploy the generated `dist` directly.

## Pages and assets

- `build.py`: content, shared layout and page generation.
- `styles.css`: responsive visual system.
- `app.js`: image tool, text editor, focus timer, workspace and optional cloud integration.
- `config.js`: independent homepage/project links and optional Supabase public configuration.
- `assets/mazda.png`: a copied vehicle illustration from 3A3D. Original assets are unchanged.

Project covers are graphic compositions, labeled on detail pages; they are not claimed to be app screenshots. Salon functionality is described conservatively because its source repository has not been audited in this checkout.

## Google login and cloud sync

Local tools, favorites, drafts, image presets and focus history work without credentials. Cloud login is deliberately disabled until the following setup is complete; there is no fake login or simulated cloud save.

1. Create a separate Supabase project for this new site and run `supabase/schema.sql`.
2. Create a Google OAuth web client. Use Supabase's displayed callback URL as Google's authorized redirect URI, then enter the client ID and secret in Supabase's Google provider settings. Never put the Google secret or Supabase service-role key in this repository.
3. Set the site's actual origin as Supabase Site URL and allow `https://YOUR-ORIGIN/auth/callback/` as a redirect URL. Add a separate localhost callback for development if needed.
4. Put the Supabase project URL and **publishable / anon key** in `config.js`, then rebuild. That public key is safe only with the included row-level policies enabled.
5. Test real Google login, logout, cross-device saves and two-account isolation before announcing cloud support. Configure the Google OAuth audience for the intended users.

Cloud items: favorites, manually saved text drafts, image presets, timer settings and completed sessions. Images are never uploaded. Local guest text is never automatically uploaded on login. The active timer is device/tab-local; completed records can sync. Workspace data can be exported as JSON.

Draft updates detect previously saved remote changes and create a conflict copy. The first version does not support simultaneous collaborative editing. Settings use last successful save. Keep a local export before clearing browser storage.

## Secondary project and external links

The default About Me URL comes from the link already present in 3A3D. Edit `personalUrl` in this new project's `config.js` if a different homepage address is intended. It does not modify the destination. The old homepage files were moved out of this workspace. The complete car source remains in `projects/3A3D/`, excluded from main-site commits and build output. Use the car folder's own Git repository for car changes.

## Production deployment

The primary production URL is https://kensei-workshop.vercel.app/. Publish future updates to the existing Vercel project, not the earlier Sites copy. Supabase must allow this origin and `/auth/callback/`. The checked-in `dist/` includes the current public Supabase configuration. `.vercelignore` excludes the separate car project, QA artifacts, repository metadata and tests from CLI uploads. Vercel local project linking is excluded from Git.


## Browser tool collection

Eight tools share `tools.json`: Image Studio (batch), QR Studio, PDF Toolkit, Text Toolkit, Markdown Studio, Text Compare, Image to Text, and Focus Timer. Page interfaces are in `tool_views.py`; processing is split into lazy-loaded `tool-scripts/` modules.

All file processing runs in the browser. Only explicit workspace saves use Supabase. QR presets exclude content, credentials and logos. Existing untyped drafts and presets stay compatible. No database migration is required.

`vendor/` contains the pinned browser libraries, workers, WASM and four OCR models, so production builds need only `python3 build.py`. To regenerate dependencies, run `pnpm install --frozen-lockfile --ignore-scripts` and `node scripts/vendor.mjs`. `model-lock.json` pins the OCR model commit and SHA-256 hashes. Licenses are included and linked from `/credits/`.

Limits: image batches 20 files / 100 MB, 20 MB and 40 MP per image; PDFs 50 MB / 200 pages; OCR one image, with selected English, Simplified Chinese, Traditional Chinese and Malay models. PDF splitting accepts `1-3;4-5` groups, or creates one PDF per selected page when blank. PDF arrangement and extraction use the current displayed page order.

Validation: run `python scripts/serve.py 8769`, then run `node tests/verify.cjs`, `node tests/tools.cjs` and `node tests/auth.cjs`. New tool tests use real PDF/QR/image outputs and actual local OCR models.

Publish by pushing branch `KenSei-Workshop` to GitHub. The existing Vercel GitHub integration deploys it automatically; no manual Vercel deployment is needed.
