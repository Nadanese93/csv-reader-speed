// main.ts — driver for the csv-reader-speed entry.
//
// Reads every case from $MAKEFUN_INPUT_DIR/cases.json (default /input),
// answers each one with run() from solve.js, and writes the answers in
// order to $MAKEFUN_OUTPUT_DIR/answers.json (default /output).
// Paths never come from process.cwd(): the grader's working directory is
// not the repository. V8's incremental marking is switched off before
// solve.js is imported, the same tuning the house baseline runs with.

import { setFlagsFromString } from 'node:v8';
setFlagsFromString('--no-incremental-marking');

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const { run } = await import('./solve.js');

const inputDir = process.env.MAKEFUN_INPUT_DIR || '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

const cases = JSON.parse(readFileSync(`${inputDir}/cases.json`, 'utf8'));
const answers = cases.map((c) => run(c.input));

mkdirSync(outputDir, { recursive: true });
writeFileSync(`${outputDir}/answers.json`, JSON.stringify(answers));
