import { z } from "zod";

export const normalizeEmail = (value: string) => value.trim().toLowerCase();
export const emailSchema = z.string().transform(normalizeEmail).pipe(z.email());
