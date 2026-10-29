# Canvas-first Whiteboard

Implemented against Excalidraw **0.18.1**. Tools remain 28 and games remain 12.

## Behavior

- The first screen has a compact title/status bar and a real empty preview. New and Continue are explicit actions; loading the ordinary route creates no record. Personal `?id=` and authenticated room links retain their behavior. Invitations show the existing Join flow in Boards.
- Opening a document enables page focus. Real fullscreen is a separate user gesture and includes dialogs. Focus, fullscreen, language and viewport changes retain the editor root, selection, history and shared connection. Unsupported fullscreen retains focus with an explanation.
- Boards holds Personal/Shared records and membership controls. More holds export, templates, help, language, Keep tool active and Snap to points. Both preferences are local and identity-scoped, with native tool locking. Selection, Hand and Escape retain their native behavior.
- Rectangles (including rounded), diamonds and ellipses have 12 scene-space ports. Arrows retain native target bindings plus versioned port indices; ordinary, curved and elbow arrows remain distinct. Existing arrows are unchanged until their endpoints are edited. Free edge binding is retained, and disabling snapping preserves existing fixed bindings.
- Paper is plain, ruled, grid, dots or graph paper, with 10/20/40 scene-unit spacing. Graph paper divides each main interval into five. Its independent layer follows scene pan/zoom and creates no selectable elements or history steps. Native grid rendering is disabled to avoid a second, mismatched grid.
- Full/selection PNG and SVG, prepared PNG and Send to use the same bounds and paper renderer. Pattern exclusion preserves the base color; editable files retain paper and connector extensions. PNG applies the dark color transform in bounded strips because WebKit does not consistently support Canvas 2D filters. The transform follows [CSS Filter Effects](https://www.w3.org/TR/filter-effects-1/).

## Persistence and compatibility

`appState.paper` accepts only `{version:1,type,spacing}`. Arrow `customData` accepts only `{kenseiPorts:{version:1,start,end}}`, with each index null or 0–11. Native bindings retain shape IDs. Other custom namespaces remain rejected.

The compatibility migration preserves existing RPC signatures, tables, ownership checks, shared editing leases, channel permissions and idempotent receipts. It accepts the controlled extensions, enforces the private 10,000-element limit, and rejects stale writes that would discard paper. Old records retain their base color and default to Plain in memory; simply opening one does not create a revision or conflict copy.

Two incidental issues were fixed during actual interaction checks: translating a dynamically constructed label could destroy its input, and opening the Shared browser prematurely closed Boards. The shared label helper now translates a child span, retaining the original input node and value.

## Executed checks

| Evidence                    | Environment / result                                                                                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure unit suites            | 27/27 passed, including shape contours, rotation, versioned extensions, transforms and legacy records.                                                                                                                                                                                            |
| Database suites             | 16/16 passed against local PGlite, applying the complete migration chain; includes strict fields, stale writers, four members, idempotence, nonce conflict rules, tombstones, ownership and removed/anonymous denial.                                                                             |
| Dedicated Whiteboard suites | 9/9 passed in Edge: entry, repeated drawing, sharp/round/elbow ports, transforms, native Undo/Redo, deletion restoration and duplicate target remapping; old imports, Chinese text and real downloads; private refresh, conflict copy and explicit guest import.                                  |
| Four-editor integration     | Four real native Excalidraw components with **local RPC and simulated WebSocket transport**, backed by local PostgreSQL rules: drawing convergence, paper/connector persistence, transformed endpoints, local Undo, no echo loops and member removal. This is not a new production Realtime test. |
| Browser engines             | Edge, Firefox and Playwright WebKit: canvas entry, focus/fullscreen or fallback, language/editor identity, actual PNG/SVG/editable export; independent PNG/SVG pixel/phase comparison for all five patterns at negative coordinates. Playwright WebKit is not a physical Safari/Android device.   |
| Layout                      | Simulated 320×640, 360×800, 768×1024, 1366×768, 1440×900 and 800×360. Desktop canvas begins within 180px; narrow portrait within 160px, with no page overflow. Screenshots inspected at 320px and desktop.                                                                                        |
| Shared helper regression    | All 56 English/Traditional tool page checks in Edge, including mobile Help focus and touch targets; localization/editor preservation, manual-save races, recipes/account switch, file checks, CSV editing and permission Help. No file-upload requests in local Whiteboard checks.                |
| Build                       | Clean source build: 28 tools, 12 games, 107 HTML files including the error alias, 98 sitemap URLs, complete pinned vendor assets and ownership verification tag.                                                                                                                                  |

Raw local artifacts are ignored under `_qa/whiteboard-canvas/`. Repeat with `pnpm test:whiteboard-canvas`. Existing live checks remain explicit opt-in and take approved disposable credentials over hidden stdin; credentials are never committed.

## Release gate and remaining manual checks

At report creation the Supabase plugin returned `Invalid or expired requestState` twice on migration application. Read-only schema/history checks confirmed no migration was applied. The local CLI is not authenticated. Source is ready; publishing must wait for the compatible migration, then push the existing branch to trigger Vercel. Do not publish a frontend that relies on uninstalled server validation.

Pending **physical Android** checks:

1. Open each language, create a board and draw several rectangles without reselecting the tool; choose Selection and Hand explicitly.
2. Pick each paper, pan/zoom and connect several shapes. Confirm the keyboard, tool panels and touch dragging remain usable in portrait and landscape.
3. Enter fullscreen, open Boards/Background/More and edit Chinese text. If the soft keyboard exits fullscreen, confirm content, focus layout and Undo remain intact.
4. Download/reopen PNG, SVG and `.excalidraw`; reopen the saved board and confirm paper, arrows and text.

Pending **new production four-account Realtime** checks: concurrent port-bound node edits, background updates, late join/reconnect, membership revocation and second-tab read-only behavior. Previously verified service permissions are preserved, but local fixtures do not replace this release's real-backend check.
