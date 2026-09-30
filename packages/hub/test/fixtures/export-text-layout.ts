/** Reproduce the backend geometry used by the independent renderer verification. */
import { readFileSync, writeFileSync } from 'node:fs';
import { extractTextPage } from '../../src/pdf/text-layout';

const destination = process.argv[2];
if (!destination) throw new Error('Usage: npx tsx export-text-layout.ts output.json');
const bytes = readFileSync(new URL('./text-layout.pdf', import.meta.url));
const pages = [];
for (let page = 1; page <= 5; page++) pages.push(await extractTextPage(bytes, page));
writeFileSync(destination, JSON.stringify(pages, null, 2) + '\n');
