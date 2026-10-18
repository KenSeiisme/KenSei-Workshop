# Secondary projects

`3A3D/` contains the independent automotive website, including its original `.git` history and deployment configuration.

- Main tools platform: workspace root. Build with `python build.py`; publish only root `dist/`.
- Automotive project: `projects/3A3D/`. Open this folder separately to work with its GitHub repository, or deploy it using this folder as its root. Development dependencies were recreated from the local pnpm cache using the existing lockfile. The broken old node_modules fragments remain in a temporary backup outside the workspace.
- The main platform's generated `dist/projects/` pages are portfolio descriptions, not copies of the car application.
- `3A3D/` is ignored by the main repository. It retains its own Git history and remote.

Existing website URLs and external navigation links are unchanged by this local reorganization.
