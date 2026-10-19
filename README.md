# KenSei Workshop

This workspace root is the main KenSei tools platform. The secondary car website lives in projects/3A3D/ as an independent Git repository. Legacy personal-homepage source is no longer kept in this workspace; About Me still links to the existing online homepage.

## Build and preview

```powershell
python build.py
python -m http.server 8768 --bind 127.0.0.1 --directory dist
```

Open http://127.0.0.1:8768. This workspace root is the main project root. Deploy only `dist/`, or select this root folder for the main Vercel project. The car website has its own deployment root: `projects/3A3D/`. The included Vercel build needs Python 3; alternatively build locally and deploy the generated `dist` directly.

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
