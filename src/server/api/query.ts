import { z } from "zod";

/**
 * Helpers for query-string schemas. HTML GET forms send an untouched field as an empty string
 * (e.g. ?category=&maxBalance=), which must be read as "no value", not as an invalid enum member
 * or as the number 0. Wrap every optional filter field with optionalFilter().
 */
export const blankToUndefined = (v: unknown): unknown => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const optionalFilter = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(blankToUndefined, schema.optional());
