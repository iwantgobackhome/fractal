import { z } from 'zod';
import type { Region } from './library';

export interface Highlight { highlightId:string; paperKey:string; page:number; rects:Region[]; text:string; color:'yellow'|'green'|'blue'|'pink'; note:string|null; createdAt:string; updatedAt:string }

// TODO(annotations): add schemas for annotation mutations when their sync format is owned.
export const annotationPlaceholderSchema = z.object({});
