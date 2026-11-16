import type { Current } from "./data";

/**
 * The copy of the current cycle kept on the phone (item 23, spec 11), shown when the server can't be reached.
 * One copy: the last signed-in user's, from GET /api/current. It is for that user and this build only, and is
 * removed on sign out.
 */
export interface OfflineCopy {
  userId: string;
  /** When it was saved (ms since 1970). */
  savedAt: number;
  data: Current;
}

const KEY = "setaside.copy";

interface Stored extends OfflineCopy {
  build: string;
}

export function saveCopy(userId: string, data: Current, now = Date.now()): void {
  const stored: Stored = { userId, savedAt: now, data, build: __BUILD_ID__ };
  try {
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Storage full or blocked: the app still works online.
  }
}

/** The saved copy, if there is one from this build (and for this user, when given). */
export function readCopy(userId?: string): OfflineCopy | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Stored;
    if (stored.build !== __BUILD_ID__) return null;
    if (userId !== undefined && stored.userId !== userId) return null;
    return { userId: stored.userId, savedAt: stored.savedAt, data: stored.data };
  } catch {
    return null;
  }
}

export function clearCopy(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to remove.
  }
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function agoLabel(savedAt: number, now = Date.now()): string {
  const min = Math.floor((now - savedAt) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
