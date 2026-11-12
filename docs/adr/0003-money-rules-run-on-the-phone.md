# Shared money rules run on the phone, checked by the server

Decided in ticket 07, 2026-11-12. Free money, the daily allowance and the run-out verdict are computed by one pure TypeScript rules module. The browser runs it on the stored entries (salary, conversions, commitments, pots, spends). The server stores those entries and uses the same module to validate writes. This keeps Worker CPU near zero under the 10 ms limit, makes numbers update instantly, and leaves the door open to offline use. The server does not store computed totals as the truth; they are always derived from the entries.

## Consequences

- The rules module must not depend on browser or Worker APIs, so both sides can import it.
- "Today" for these rules comes from the home time zone (see the glossary), not from server UTC.
