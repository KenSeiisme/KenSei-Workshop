# Professional studios — stage 3

OCR Review links recognized line boxes to the original image using inverse crop/rotation coordinates. Corrections update the text without recognition. Searchable PDF export adds an invisible Unicode text layer; original PDF documents retain all pages and order. Existing native text is preserved unless explicit re-OCR rasterizes that page. Recipes contain languages and preprocessing only, never text, source images or PDF bytes. Original manual drafts remain available.

Audio Mix supports ten source slots and up to 60 timeline clips across ten tracks: move/trim/duplicate, volume/mute/solo/pan, low/mid/high EQ, clip fades, 0.5-second equal-power crossfades and optional peak normalization. OfflineAudioContext renders one buffer used unchanged by playback and MP3/WAV encoding. Source and rendered PCM are budgeted before rendering; files remain in memory. Recipe restore requires explicit file-slot confirmation and valid trim ranges.

## Verification

- `tests/browser/studios-stage3.cjs`: real stereo WAV pan/mute, crossfade duration, normalized peak and MP3; media-free recipe JSON; real English, Simplified Chinese, Traditional Chinese and Malay OCR; corrected Chinese/Latin/digit extraction from exported PDF; full PDF page order/native text preservation; explicit re-OCR avoids duplicate original text.
- `tests/unit/studios-core.mjs`: recipe whitelists, no media passthrough, invalid ranges, source mapping/PCM budgets and physical inverse-rotation coordinates.
- `tests/database/studios-presets.mjs`: six preset tools and old image payloads on the existing schema; anonymous and cross-account denial. No new production schema, RPC or Edge changes.
- Media regression preserves old audio joining/fading/MP3/WAV, subtitles and recording download; stage 2 production SQL/Markdown downloads passed at commit 84679dd.
- Common manual recipe controls, public Workspace preset links, EN/zh-Hant help and privacy updated. Files, form values, annotation text/signatures and audio never enter recipes.

Use `pnpm test:studios` with TEST_BASE_URL for local or live checks. Vendor rebuild remains an explicit development step; deployment only requires Python standard library.

Final checks also cover actual EQ attenuation and equal-power midpoint amplitude; stale in-flight SQL, failed import recovery; image reprocessing failures retaining separately labeled previous downloads; rotated-page signature ink coordinates; signed-in avatar/menu across 48 route/locale/viewport cases. All four earlier tool-batch regression families passed.
