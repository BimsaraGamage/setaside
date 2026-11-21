import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import * as z from "zod";
import { feedback } from "./db/schema";
import { json } from "./json";
import type { SignedIn } from "./user-check";

/** One picture, as bytes (spec 14 "Feedback"). */
export const PICTURE_MAX_BYTES = 300 * 1024;
/** Steps kept on the phone and taken here (`src/client/trail.ts`). */
export const TRAIL_MAX = 100;

const KB = 1024;
/** The parts besides the pictures, as JSON text. */
const LIMITS = { text: 4000, context: 4 * KB, trail: 64 * KB, today: 256 * KB } as const;

/** `data:image/webp;base64,…` of at most `PICTURE_MAX_BYTES`. */
const picture = z
  .string()
  .regex(/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+=*$/)
  .refine((d) => Math.floor(((d.length - d.indexOf(",") - 1) * 3) / 4) <= PICTURE_MAX_BYTES);

/** One step of the trail, as `src/client/trail.ts` makes them; anything else is refused. */
const at = z.number().int().nonnegative();
const step = z.discriminatedUnion("kind", [
  z.strictObject({ at, kind: z.literal("screen"), name: z.string().max(200) }),
  z.strictObject({ at, kind: z.literal("tap"), label: z.string().max(60) }),
  z.strictObject({
    at,
    kind: z.literal("api"),
    method: z.string().regex(/^[A-Z]{1,10}$/),
    path: z.string().regex(/^\/[A-Za-z0-9/_.%-]{0,199}$/),
    status: z.number().int().min(0).max(999).nullable(),
    ms: z.number().int().nonnegative(),
  }),
  z.strictObject({
    at,
    kind: z.literal("error"),
    message: z.string().max(300),
    stack: z.string().max(1500).optional(),
  }),
  z.strictObject({ at, kind: z.literal("online"), online: z.boolean() }),
]);

/** No longer than `max` as JSON text. */
const fits = (max: number) => (v: unknown) => JSON.stringify(v ?? null).length <= max;

const newFeedback = z.object({
  id: z.uuid(),
  kind: z.enum(["problem", "idea"]),
  text: z
    .string()
    .refine((t) => t.trim().length > 0)
    .refine((t) => t.trim().length <= LIMITS.text),
  context: z
    .record(z.string().max(40), z.union([z.string().max(400), z.number(), z.boolean(), z.null()]))
    .refine(fits(LIMITS.context)),
  trail: z.array(step).max(TRAIL_MAX).refine(fits(LIMITS.trail)),
  /** Today's data as the phone held it (`/api/current`), or none before it loaded. */
  today: z.unknown().refine(fits(LIMITS.today)).optional(),
  screenshot: picture.optional(),
  picture: picture.optional(),
});

/** Room for two pictures as base64 and the rest. */
const BODY_MAX = Math.ceil((PICTURE_MAX_BYTES * 2 * 4) / 3) + LIMITS.trail + LIMITS.today + 16 * KB;

/**
 * Send feedback (ticket SAB-55, spec 14 "Feedback"): one insert, the user's own row. Sent again
 * with the same id (a retry) it is saved once. Read by `npm run feedback`, never by the app.
 */
export const feedbackRoutes = new Hono<SignedIn>().post(
  "/feedback",
  bodyLimit({ maxSize: BODY_MAX, onError: (c) => c.json({ error: "too_big" as const }, 413) }),
  json(newFeedback),
  async (c) => {
    const { db, userId } = c.var;
    const b = c.req.valid("json");
    await db
      .insert(feedback)
      .values({
        id: b.id,
        userId,
        kind: b.kind,
        text: b.text.trim(),
        context: JSON.stringify(b.context),
        trail: JSON.stringify(b.trail),
        today: b.today == null ? null : JSON.stringify(b.today),
        screenshot: b.screenshot ?? null,
        picture: b.picture ?? null,
      })
      .onConflictDoNothing();
    return c.json({ ok: true as const }, 201);
  },
);
