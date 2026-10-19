# Network speed test: research only

No speed-test page, measurement traffic or speed-test dependency is included in this release.

The MIT [Cloudflare Speedtest engine](https://github.com/cloudflare/speedtest) is a plausible later option. It measures a connection to Cloudflare's edge, rather than guaranteeing an ISP-wide speed. Its normal browser engine downloads and uploads test data; this is not a purely local tool and consumes user bandwidth. The payload schedule must be measured and capped before selecting a mobile-friendly preset. Do not promise a fixed traffic cost before configuring and measuring that schedule.

The engine's default download/upload endpoints are Cloudflare's `__down` and `__up`. Its default behaviour also reports measurements to Cloudflare's `__results` endpoint. A future integration must disclose both measurement traffic and result reporting before an explicit Start action. Review pinned-version logging options and inspect real requests rather than assuming reporting is disabled. Set `autoStart: false` so a visit does not start transferring data.

Compatibility needs explicit checks for Chromium, Firefox and Safari, mobile/background tabs, CORS and Resource Timing availability, browser privacy extensions, caching, proxies and VPNs. Latency and throughput are path-dependent; packet loss tests require additional WebRTC infrastructure and should be omitted initially.

Recommendation: defer this feature until a bounded-traffic prototype, cancellation behaviour and a clear data-use notice are verified. Keep it separate from Device Check. The four tools in this release do not run network measurements or send measurement reports.

Sources reviewed: [engine README and options](https://github.com/cloudflare/speedtest), [Cloudflare speed test](https://speed.cloudflare.com/). Review again before implementation because defaults may change.
