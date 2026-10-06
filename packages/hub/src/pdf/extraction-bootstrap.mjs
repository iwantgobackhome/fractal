// Development worker entry. Packaged builds bundle extraction-worker.ts separately.
import { tsImport } from 'tsx/esm/api';
await tsImport('./extraction-worker.ts', import.meta.url);
