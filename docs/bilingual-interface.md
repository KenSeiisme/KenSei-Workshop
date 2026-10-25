# Bilingual interface architecture

English routes retain their existing URLs. Traditional Chinese routes have a `/zh-hant/` prefix. The URL selects the interface language; a manually selected preference only redirects a later visit to `/`. User content and output-language settings remain independent.

## Source ownership

- `src/i18n/catalog/{shared,tools,games,site}.json`: English source messages and Traditional Chinese counterparts. Build validation rejects missing values and mismatched positional placeholders.
- `src/i18n/content.json`: localized public names, descriptions and search aliases for 28 tools, 12 games and three projects.
- `src/i18n/usage.json`: source ownership of the original template messages. New explicit message strings are also discovered from the route's source dependencies.
- `src/views/localization.py`: static annotation, route styles, page metadata, dependency selection and language-pack emission.
- `src/site/i18n.js`: `t(key, params)`, `setLocale(locale)`, locale paths and the `locale-change` event. Language packs load on demand. Only the latest requested locale can take effect.
- `src/site/ui.js`: small adapters for owned text, attributes, markup and dates. No browser prototype changes or blanket translation of arbitrary DOM text.
- `src/site/shell.js`: navigation drawer and public catalog search. It initializes before account services.

## Adding or editing interface text

Use `uiMsg('English source', [parameter])`, then `uiText(node, message)` for visible owned labels. `uiHtml` annotates owned literal markup and explicitly marked message arguments. Add the normalized English source and Traditional Chinese counterpart to the appropriate catalog, using `m_` followed by the first 12 hex characters of SHA-256 of the whitespace-normalized English source. Namespace keys are also available for the shared shell.

Keep user values as raw parameters. Never call `uiFrom` on filenames, nicknames, record names, card contents, QR payloads or editable values. Editable text, rendered Markdown, comparison text and typing passages are protected. Lazy `uiDate` values change display formatting without changing stored ISO timestamps.

Messages retain canonical source text separately from their display. Compatibility state adapters read that canonical representation; translated text must never control business state. Do not translate enum values, routes, identifiers, stored keys, rules or server payloads.

Switching language updates existing bindings and history. It does not dispatch input/change events, restart tools, remount games or resume pending work. Excalidraw receives a new language prop with the same root and key. Audio/video tracks, workers and network-test frames are retained.

## Build and checks

```text
python build.py
python tests/unit/localization.py
python scripts/verify-structure.py
pnpm test:bilingual
```

`--pages-only` is a development shortcut for generating pages and packs after copying changed static assets. Production uses the full build. Vercel continues to require only the Python standard library.

Public pages have localized canonical, English/Traditional Chinese/x-default alternates, social metadata and committed 1200×630 PNGs. Account, callback and error pages are crawlable with `noindex, follow`. The public sitemap contains 98 URLs.

Social cards are generated during development, after source formatting:

```text
node scripts/generate-social-cards.cjs --manifest dist/social-manifest.json
node scripts/generate-social-cards.cjs --manifest dist/social-manifest.json --check
```

Fonts are self-hosted under `src/assets/fonts`, with pinned source hashes and OFL licenses. No Google Fonts stylesheet is loaded at runtime. Hosting remains GitHub → Vercel; this feature does not change Supabase schema, rules or Edge Functions.
