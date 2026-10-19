# Third-batch implementation and validation

Seventeen tools share the catalog. Answer Book and Decision Studio are Utilities; future Games will use independent routes, data and scripts. No empty Games navigation is published.

## Network Test

@cloudflare/speedtest 1.14.2 is pinned, vendored with its MIT license and loaded only on explicit Start. An isolated iframe limits fetch to Cloudflare __down/__up. Its adaptive schedule totals 488.9 MB; every attempt, including retries, is charged against a 500 MB test-payload limit, with protocol overhead additional. autoStart is false, both logging URLs are null and credentials are omitted. No packet-loss, TURN, extra loaders or AIM scoring. Stop aborts the engine and destroys the frame on cancel, hidden page, navigation or 120-second timeout. Only tests with usable download/upload measurements enter device-only history.

The privacy notice identifies Cloudflare's access to the connection IP. No test payload or history is proxied through Vercel or Supabase. Report blocking is enforced independently of logging configuration. Controlled HTTP browser tests run the actual vendored engine; separate tests deliberately exceed the request budget and simulate HTTP 429. Controlled responses are not a real ISP speed measurement. The separate small live probe verifies endpoint availability and cross-origin Resource Timing.

## Local tools

ZIP runs in a terminable worker, checks central/local headers and safe filenames, then streams decompression to verify actual bytes, declared sizes and CRC. Limits: 100 files / 100 MB for packs; 100 MB input / 2,000 entries / 500 MB expanded for reads. Encryption, multi-volume, ZIP64 and unsupported methods are rejected. Tests include Chinese paths, duplicate names, empty files, corrupt checksums, false size metadata, actual output exceeding a false declaration, huge metadata and cancellation.

Colors use pure sRGB/HSL conversions and WCAG contrast with unrounded pass/fail decisions. Storage conversions distinguish powers of 1000 and 1024; volume labels distinguish US and Imperial measures; temperatures below absolute zero are rejected. Passwords use unbiased cryptographic samples, include all selected categories and are never persisted or uploaded. Clipboard failure selects the output for manual copying.

## Verification commands

Run test:daily against a preview, then the existing verify, image-studio, tools, limits, ocr-lifecycle, second-batch, auth and profiles browser suites. Run database.mjs and profiles-database.mjs for existing data/security regressions. Production verification must fetch the actual canonical assets and open every new tool. Push the existing GitHub deployment branch; no manual Vercel deployment or database migration.
