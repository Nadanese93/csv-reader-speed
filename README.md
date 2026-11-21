[![make.fun bounty](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Nadanese93/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Nadanese93/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

# Slice-scanner drop-in for csv-reader 1.0.0

A faster drop-in for make.fun's own csv-reader 1.0.0, written for the
[make.fun bounty "Read broken CSV files faster, 21 November 2026"](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
($100 USDC, top 10 × $10). It answers exactly as csv-reader 1.0.0 does on
every case — same `{columns, rows, errors}`, including the broken-input
edge cases (BOM, stray CRs, unterminated quotes, quote junk, short/long
rows) — and ranks by CPU time, least first.

## How it is fast

A single-pass slice scanner, written from the contest's prose specification:

- A record whose whole line holds no quote and no CR is split with one
  C++ `split(',')` call.
- Otherwise fields are parsed against a cached copy of the current line,
  so every delimiter search is bounded by the line length instead of the
  rest of the file.
- A quote state machine runs only when a quote opens a field: the fast
  path for a quote-free line never pays for one.
- No per-field allocation beyond the result strings themselves.

## Layout

- `solve.js` — ES module exporting `run(input)`, the parser.
- `main.ts` — driver: reads `$MAKEFUN_INPUT_DIR/cases.json`, answers each
  case with `run()`, writes `$MAKEFUN_OUTPUT_DIR/answers.json`. It switches
  V8's incremental marking off before importing `solve.js`, the same tuning
  the house baseline runs with. Paths never come from `process.cwd()`.

## Verification

- All 6 practice cases byte-identical (canonical JSON) to the reference
  expected output.
- 11,432 randomized fuzz cases (quotes, `""`, CRLF inside quotes, lone
  CRs, BOM, empty lines, short/long rows, unicode, empty fields) compared
  against the house baseline run as a black box: 0 mismatches.
- Median end-to-end time on the practice set, same machine, same day:
  ~0.93 s vs ~2.24 s for the baseline (about 2.4× faster).

## License

MIT — see [LICENSE](LICENSE).
