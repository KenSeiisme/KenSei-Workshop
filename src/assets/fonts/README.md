# Self-hosted interface fonts

These are the existing DM Sans and Space Grotesk interface families from Google Fonts, served locally instead of through an external CSS import. The variable normal faces cover weights 400–700. Unicode ranges keep extra Latin/Vietnamese subsets conditional; Traditional Chinese uses the operating system CJK fallback.

- `manifest.json` records exact versioned `fonts.gstatic.com` URLs, byte counts, SHA-256 hashes and upstream license commits.
- `fonts.css` uses `font-display: swap`. Load it before the main stylesheet and remove the old `fonts.googleapis.com` import.
- The two `preload` entries in the manifest are the Latin faces (59,220 bytes combined). Do not preload every subset.
- OFL 1.1 notices are included here and at `/vendor/licenses/DM-Sans.txt` and `/vendor/licenses/Space-Grotesk.txt`.
- Add credits: `DM-Sans` / `Google Fonts v17` / `OFL-1.1`; `Space-Grotesk` / `Google Fonts v22` / `OFL-1.1`.

Changing font bytes requires updating the content hash in the filename and manifest. The production build only copies these files and does not contact Google Fonts.
