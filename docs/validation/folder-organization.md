# Folder organization validation

Validated on 2026-10-22. This release changes source organization and development commands; the public site contains the same 28 tools and 40 generated pages.

- Compared all 872 public files with the previous release, normalizing text line endings: no missing files, additional files or changed content.
- Ran the generator from the actual Windows checkout, including its Chinese path, and built into an empty output directory with `scripts/verify-structure.py`. Confirmed tool routes, assets, workers, WASM, models and fonts are copied, with no internal source or private configuration in the output.
- Passed all 6 unit suites and all 5 database suites. SQL migrations retain their existing names and contents; no online database migration is required.
- Passed all 24 browser suites, covering the tools, responsive layouts, downloads, account/profile flows, scoring, saved records, synchronization and media lifecycle. One existing pagination test initially asserted before the asynchronous page load completed; it now waits for the expected rows and passed on rerun.
- Preserved public `/tool-scripts/`, `/vendor/` and `/assets/` URLs, local storage keys, IndexedDB stores and Supabase interfaces.
- Preserved the independent `projects/3A3D` checkout, local environment file and Vercel link metadata. Removed only generated Python cache and an empty obsolete hosting directory.

The local `dist/` output remains available for preview. It is ignored by Git and rebuilt from `src/` and `data/` during the existing Vercel deployment.
