import { writeFileSync } from 'node:fs';
import { generatedBook } from '../packages/hub/test/generated-book';

const path = process.argv[2];
if (!path) throw new Error('Usage: tsx scripts/generate-book-pdf.ts <temporary PDF path> [--images]');
writeFileSync(path, generatedBook(1232, process.argv.includes('--images')));
