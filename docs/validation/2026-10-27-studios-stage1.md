# Professional studios — stage 1

Image Studio retains Batch/Edit and canvas-restricted fallback. Added optional orientation, centered ratio crop and watermark in a fixed pipeline, per-file overrides, actual before/after previews and existing bounded target encoding.

PDF Fill & Annotate supports AcroForm fields, vector/text/signature annotations, move/resize/undo/delete and optional flattening. PDF.js viewport conversion handles rotated/cropped pages. Recipes use existing private preset records and exclude form values, annotations and signature strokes. Legacy image fields remain readable.

## Verification

- `tests/browser/studios-stage1.cjs`: two-image crop/resize download dimensions, settings-only recipe JSON; Chinese text fields, checkbox, radio, dropdown, 90-degree page and editable/flattened PDF outputs.
- Browser checks at 320/360/768/1440px and Traditional Chinese; no POST/PUT/PATCH file uploads.
- Font asset manifest documents actual glyph rendering and text extraction checks, including rejected subset behavior. Full font embedding is deliberate to preserve correctness.
- No database, RPC or Edge change.
