import { hc } from "hono/client";
import type { AppType } from "../worker";
import { trailFetch } from "./trail";

/** Every call goes on the trail (ticket SAB-55). */
export const api = hc<AppType>("/", { fetch: trailFetch });
