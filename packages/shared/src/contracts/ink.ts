import { z } from 'zod';

import { annotationBaseSchema } from './annotations';
/** Coordinates and pressure are normalized to the rendered page. t is milliseconds. */
export const inkPointSchema = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().nonnegative()]);
export const inkStrokeSchema = annotationBaseSchema.extend({ kind: z.literal('ink'), page: z.number().int().positive(), tool: z.enum(['pen', 'highlighter', 'eraser']), color: z.string().min(1), width: z.number().positive(), points: z.array(inkPointSchema) });
export type InkStroke = z.infer<typeof inkStrokeSchema>;
