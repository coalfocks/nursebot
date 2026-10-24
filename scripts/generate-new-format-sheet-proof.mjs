import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = resolve(new URL('..', import.meta.url).pathname);
const artifacts = join(root, 'artifacts');
const temp = await mkdtemp(join(tmpdir(), 'new-format-sheet-proof-'));
const entry = join(temp, 'entry.ts');
const bundle = join(temp, 'entry.mjs');
await writeFile(entry, `import { buildEvaluationSheetHtml } from ${JSON.stringify(join(root, 'supabase/functions/_shared/faculty-study-contract.ts'))};\nimport { SYNTHETIC_NEW_FORMAT_SHEET_RESULT } from ${JSON.stringify(join(root, 'supabase/functions/_shared/new-format-sheet-fixture.ts'))};\nprocess.stdout.write(buildEvaluationSheetHtml(SYNTHETIC_NEW_FORMAT_SHEET_RESULT));\n`);
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'silent' });
const { stdout } = await exec(process.execPath, [bundle]);
const html = stdout;
const htmlPath = join(artifacts, 'new-format-sheet-proof.html');
const pdfPath = join(artifacts, 'new-format-sheet-proof.pdf');
await writeFile(htmlPath, html);
await exec('/snap/bin/chromium', ['--headless', '--no-sandbox', '--disable-gpu', `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`], { maxBuffer: 1024 * 1024 * 10 });
const pdf = await readFile(pdfPath);
const pageCount = (pdf.toString('latin1').match(/\/Type\s*\/Page(?:\s|\/|>)/g) ?? []).length;
const metadata = {
  artifact: 'new-format-sheet-proof.pdf',
  html_artifact: 'new-format-sheet-proof.html',
  renderer: 'Chromium headless print-to-pdf',
  synthetic_only: true,
  html_sha256: createHash('sha256').update(html).digest('hex'),
  pdf_sha256: createHash('sha256').update(pdf).digest('hex'),
  pdf_byte_size: pdf.byteLength,
  page_count: pageCount,
  model_calls: 0,
  database_writes: 0,
  learner_writes: 0,
};
await writeFile(join(artifacts, 'new-format-sheet-proof.json'), `${JSON.stringify(metadata, null, 2)}\n`);
await rm(temp, { recursive: true, force: true });
console.log(JSON.stringify(metadata));
