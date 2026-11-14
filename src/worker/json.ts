import { validator } from "hono/validator";
import type * as z from "zod";

/** JSON body checked by a zod schema; anything else is a 400. */
export function json<T extends z.ZodType>(schema: T) {
  return validator("json", (value, c) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) return c.json({ error: "bad_request" as const }, 400);
    return parsed.data as z.output<T>;
  });
}
