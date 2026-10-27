# Professional studios — stage 2

Data Analyze uses a self-hosted, single-thread DuckDB EH engine in a dedicated worker. PapaParse/flat JSON input is imported through explicitly typed Arrow Utf8 vectors, preserving leading zeros and nulls. Visual builder covers projections, filters, Inner/Left Join, aggregation and conditional-aggregation pivots; editable custom SQL remains separate. Recipe restore requires explicit source/column slot confirmation.

SQL is tokenized by DuckDB itself, restricted to one SELECT/WITH statement, parsed as a derived SELECT, and executed in a read-only transaction. External access, extension autoload/autoinstall are disabled and configuration locked. Results are bounded by 50,000 rows, 200 columns and 25 MB. Timeout/cancel destroys the owned engine; input Files remain in memory for reimport. No external extension parser is used.

Markdown adds bounded non-trusted KaTeX, footnotes and strict Mermaid flow/sequence/class/ER diagrams. Interactive links, HTML labels/directives and external resources are rejected. HTML exports inline math fonts/styles and generated SVG; print uses the same preview content.

## Verification

`tests/browser/studios-stage2.cjs`: real join/leading-zero/typed arithmetic, grouped query, visual pivot, forbidden external read/multiple statements/write statements, output row cap, cancellation followed by reimport, four diagram types, math/footnote preview, standalone HTML font embedding, printed PDF, unsafe image/link restrictions; 320/360/768/1440px and no external requests.

Stage 1 production browser/download checks passed against https://kensei-workshop.vercel.app/ at commit 10fc170. No database migration or ranked-game interface changed.
