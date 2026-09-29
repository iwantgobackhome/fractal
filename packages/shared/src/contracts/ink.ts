import { z } from 'zod';

import { annotationBaseSchema } from './annotations';
/** Coordinates and pressure are normalized to the rendered page. t is milliseconds. */
export const inkPointSchema = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().nonnegative()]);
export const inkStrokeSchema = annotationBaseSchema
  .extend({
    kind: z.literal('ink'),
    page: z.number().int().positive(),
    tool: z.enum(['pen', 'highlighter', 'eraser']),
    brush: z.enum(['ballpoint', 'fountain', 'pencil', 'highlighter', 'shape']).optional(),
    shape: z.object({ type: z.string(), snapped: z.boolean() }).optional(),
    color: z.string().min(1),
    width: z.number().positive(),
    points: z.array(inkPointSchema),
    tilt: z.array(z.number()).optional(),
  })
  .refine((stroke) => stroke.tilt === undefined || stroke.tilt.length === stroke.points.length, {
    message: 'Tilt values must align with points',
    path: ['tilt'],
  });
export type InkStroke = z.infer<typeof inkStrokeSchema>;
