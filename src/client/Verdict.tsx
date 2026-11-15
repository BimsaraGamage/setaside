import type { Verdict } from "../money";
import { verdictLabel } from "./data";

/** The verdict chip (spec 7, 10): green when on track, red when it runs out or is over. */
export function VerdictChip({ verdict, currency }: { verdict: Verdict; currency: string }) {
  const tone =
    verdict.kind === "on_track"
      ? " ok"
      : verdict.kind === "runs_out" || verdict.kind === "over" || verdict.kind === "used_up"
        ? " bad"
        : "";
  return (
    <span className={`verdict${tone}`} data-testid="verdict">
      {verdictLabel(verdict, currency)}
    </span>
  );
}
