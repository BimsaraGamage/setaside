/** What can be downloaded (item 27, spec 14): every record as JSON, or spends as CSV. */
export type Download = "data" | "spends";

const PATHS: Record<Download, string> = { data: "/api/export", spends: "/api/export/spends.csv" };

/**
 * Downloads one file and hands it to the phone to save. Fetched first, so an
 * error (offline, signed out) can be told instead of opening a broken page.
 * Item 28's "download first" uses it too.
 */
export async function download(what: Download): Promise<boolean> {
  const res = await fetch(PATHS[what], { credentials: "same-origin" }).catch(() => null);
  if (!res?.ok) return false;
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1];
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name ?? (what === "data" ? "setaside-data.json" : "setaside-spends.csv");
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
