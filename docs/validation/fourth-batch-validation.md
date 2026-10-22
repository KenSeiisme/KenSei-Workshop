# Fourth batch: visual Network Test and four local tools

## Scope and reproducibility

The shared catalog contains 21 tools. Time Studio, File Renamer, Audio Studio and Data Studio use the existing static build, local scripts and favorites. There is no database migration or manual Vercel deployment. Push the existing KenSei-Workshop GitHub branch after validation.

Build with Python. For browser checks, serve dist using scripts/serve.py and set TEST_BASE_URL. Tests require Edge, Playwright and the pinned development dependencies. Browser reports are written to ignored _qa/; no test credentials or user files are committed.

## Verification

- fourth-core.mjs: real Temporal DST gaps/repeated times, leap dates, rename conflict rules, network quantiles/jitter/deltas and IP-free serialization.
- fourth-tools.cjs: catalog/favorites, mobile/tablet/desktop overflow, countdown reload, real renamed ZIP content, Unicode names, CSV leading zeros/quoted newlines/formula escaping, safe text previews, invalid inputs, actual stereo WAV duration/rate/gain, MP3 export and browser decoding, damaged-audio recovery, playback and cancellation. It asserts no file upload requests or browser exceptions.
- fourth-boundaries.cjs: CSV row/column limits and malformed input, JSON byte limit, UTF-8/BOM, property-name safety, pagination, worker cancel/retry, reserved filenames, file-count limit/reselection, reorder preserving overrides, clock focus across ticks, saved format, invalid audio selection, failed encoder load, WAV retry, mono output and clipping feedback.
- network-dashboard.cjs: actual pinned Cloudflare engine with controlled HTTP timings and payloads. Verifies valid sample curves, P90/peak distinction, latency counts, units, masked IP, IP-free local history/PNG/CSV/JSON/text, legacy history, comparisons, charts, restricted-canvas fallback and responsive widths.
- network-guards.cjs: isolated request guard blocks unexpected endpoints, foreign hosts, excess request sizes and attempts beyond 500 MB; timeout and actual pinned-engine HTTP 429 handling never save incomplete tests.
- Existing verify, image-studio, tools, limits, OCR lifecycle, daily tools, ZIP guards, authentication, second-batch, profile and PostgreSQL suites cover previous behavior.

Network measurement tests replace only the HTTP boundary. They exercise the actual engine, but their speeds are controlled fixtures and are not measurements of a real ISP. Production smoke checks use a small, explicitly invoked Cloudflare probe; a production visit must produce no automatic Cloudflare traffic. Full high-bandwidth tests remain user initiated.

Google consent is not automated. Authentication/Profile integration uses mocked authentication and local PostgreSQL; anonymous production API permissions and page availability can be checked independently. No claim is made that these checks reproduce a human Google consent session or every browser's audio decoding support.

## Data and result definitions

Final bandwidth is P90 of usable request samples (positive bandwidth and at least 10 ms duration); displayed peak is their maximum. Latency statistics are computed from finite, nonnegative samples. Jitter is the mean absolute difference of consecutive available samples. A missing metric is unavailable, not zero. Loaded-latency arrays are the last 20 samples exposed by the pinned engine, so sample count is shown and charts use sample indices.

The engine's configured adaptive payload is 488.9 MB and every measurement attempt is charged against a 500 MB guard. Protocol overhead and a single optional metadata response are additional. Failed/retried attempts remain charged. No packet loss, ISP grade, game-server latency or strong quality score is inferred.

The /meta response may contain the current IP, organization, ASN and approximate region. Only organization/ASN/country/city/edge/protocol are permitted in persisted and exported reports. IP is held in page memory, masked unless explicitly shown, and removed from the display when leaving. Reports never include precise coordinates, postal code or full IP. Extra Cloudflare measurement/result logging remains disabled.

## Release evidence

The release verification records in ignored _qa/ include local test results, responsive captures, deployment asset hashes and production checks. Verify the canonical Vercel URL after the GitHub push rather than treating a successful push as proof of deployment.
