# Workshop visual polish

- Local build and localization covered 120 localized pages, 110 public sitemap URLs, and zero missing explicit UI messages.
- Chromium, Firefox, and WebKit checked 59 routes in both languages at 320px and representative views at 390, 768, 1366, and 1440px, in landscape, and at the reflow width of a zoomed desktop. The account suite separately covers both themes at four widths. Chromium also used actual 200% browser zoom on ten representative pages.
- Browser workflows covered image compression, collapsed recipe errors, PDF page export, CSV editing, Send to, draft saves, media recording and downloads, Whiteboard exports, game setup and invitations, and populated and empty public profiles. Account and permission flows used isolated fixtures.
- Firefox's intercepted CSV request timed out and WebKit's rapid intercepted navigation reported aborted module loads. The corresponding checks passed against the repository's loopback HTTP server.
- Physical Android device permissions and hardware capture remain pending. The simulated mobile layouts and automated media tests have their own results.
