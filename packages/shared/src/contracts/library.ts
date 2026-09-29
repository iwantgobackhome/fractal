import { z } from 'zod';
import type { Job, Translation } from './ai';

export interface Coverage { totalPages:number; textPages:number; unsupportedPages:number[] }
export interface Paper { paperKey:string; sourceKind?:'arxiv'|'publication'; arxivId:string|null; version:number|null; title:string|null; authors:string[]; sourceUrl:string; pdfSha256:string|null; pageCount:number|null; extractionVersion:string|null; status:'fetching'|'extracting'|'ready'|'partial'|'unsupported'|'failed'; coverage:Coverage|null; createdAt:string }
export interface Region { page:number; x:number; y:number; width:number; height:number }
export interface Block { blockId:string; paperKey:string; order:number; kind:'heading'|'paragraph'|'caption'|'equation'|'figure'|'table'|'reference'|'unsupported'; sourceText:string; sourceHash:string; regions:Region[]; alignment:'exact'|'uncertain'; translatable:boolean; fontFamily:'serif'|'sans'; fontWeight:'normal'|'bold'; fontSize:number; pageOrdinal:number }
export interface PaperListResult { papers: Paper[] }
export interface Snapshot { paper:Paper; blocks:Block[]; translations:Translation[]; job:Job|null }

export const regionSchema = z.object({ page: z.number().int().positive(), x: z.number().finite(), y: z.number().finite(), width: z.number().finite(), height: z.number().finite() });
/** Editable bibliography record. The legacy Paper remains the reader snapshot wire shape. */
export const authorSchema = z.object({ given: z.string().default(''), family: z.string().min(1), orcid: z.string().optional() });
export const readingStatusSchema = z.enum(['unread', 'reading', 'read']);
export const libraryRecordSchema = z.object({
  id: z.string().min(1), paperKey: z.string().min(1), title: z.string().nullable(),
  authors: z.array(authorSchema), year: z.number().int().min(0).nullable(), venue: z.string().nullable(),
  doi: z.string().nullable(), arxivId: z.string().nullable(), url: z.string().nullable(),
  abstract: z.string().nullable(), tags: z.array(z.string()), collections: z.array(z.string()),
  addedAt: z.string().datetime(), updatedAt: z.string().datetime(), status: readingStatusSchema,
  bibtexKey: z.string().min(1),
});
export type LibraryRecord = z.infer<typeof libraryRecordSchema>;
export const libraryPatchSchema = libraryRecordSchema.pick({ title: true, authors: true, year: true, venue: true, doi: true, arxivId: true, url: true, abstract: true, tags: true, collections: true, status: true, bibtexKey: true }).partial();
export type LibraryPatch = z.infer<typeof libraryPatchSchema>;
export const collectionSchema = z.object({ id: z.string().min(1), name: z.string().min(1) });
export type Collection = z.infer<typeof collectionSchema>;
export const tagSchema = z.object({ name: z.string().min(1).max(100) });
export type Tag = z.infer<typeof tagSchema>;
export const searchHitSchema = z.object({ paperKey: z.string(), page: z.number().int().nullable(), blockId: z.string().nullable(), snippet: z.string(), score: z.number() });
export type SearchHit = z.infer<typeof searchHitSchema>;
