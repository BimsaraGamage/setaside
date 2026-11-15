# Data model

Locked in 13 · Data model, 2026-11-12. Words: [GLOSSARY.md](../GLOSSARY.md). Stack: 07 (D1 via Drizzle), money as whole minor units ([ADR 0002](adr/0002-money-as-whole-minor-units.md)).

## Rules for every table

- `id`: text UUIDv7, **made on the phone** (lets the phone show a new row at once, and keeps offline sync open later).
- `user_id`: owner, references Better Auth's `user.id`; on every row; every query scoped by the one shared check (08). Delete-account deletes by `user_id` (cascade).
- `created_at`, `updated_at`: UTC instants.
- Money: `<x>_minor` integer + `currency` (ISO 4217 code). Rates: decimal text exactly as typed.
- Days: `*_on` columns are plain `YYYY-MM-DD` in the home time zone.
- Edits and deletes are real updates and deletes (no change history in v1).

## Login tables (owned by Better Auth)

`user`, `session`, `account`, `verification`, `passkey`. Note: Better Auth's `account` means "a linked sign-in method", **not** the glossary's Account; in code the glossary Account is the `user` row.

## Stored records

| Table                  | What one row is                                                                        | Key columns                                                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings`             | one per user                                                                           | salary_currency, spending_currency, home_time_zone, usual_pay_day; reminders (19): six on/off flags, morning_at, nudge_at (HH:MM, 15-min steps), due_soon_days (3), banner_dismissed  |
| `cycle`                | one pay cycle                                                                          | started_on, expected_salary_on (editable), reserve_rate (counting rate when salary day was confirmed)                                                                                 |
| `income`               | salary, extra income, opening money, loan cash, borrowed money, money paid back to you | cycle_id, kind, currency, amount_minor, received_on, to_savings_minor (rest to free money), person_debt_id?                                                                           |
| `conversion`           | dollars changed into rupees                                                            | cycle_id, given_minor (salary cur.), received_minor (spending cur.), rate, done_on                                                                                                    |
| `counting_rate`        | a rate the user typed                                                                  | rate, set_at                                                                                                                                                                          |
| `recurring_commitment` | the "every cycle" template                                                             | name, kind, currency, usual_amount_minor, usual_day, card_id?, active                                                                                                                 |
| `commitment`           | one commitment in one cycle                                                            | cycle_id, recurring_id?, name, kind, currency, planned_minor, due_on, state (open, finished, carried, dropped), carried_from_id?, card_id?, plan_id?, person_debt_id?, prepayment_id? |
| `commitment_payment`   | one payment (parts allowed)                                                            | commitment_id, currency (may differ), amount_minor, paid_on                                                                                                                           |
| `pot`                  | a user-made pot, lasts across cycles                                                   | name, currency, usual_amount_minor, archived                                                                                                                                          |
| `pot_allocation`       | money set aside for a pot in one cycle                                                 | pot_id, cycle_id, amount_minor                                                                                                                                                        |
| `spend`                | one purchase                                                                           | cycle_id, spent_on, amount_minor, currency, note?, pot_id?, card_id?, one_off                                                                                                         |
| `savings_movement`     | money moved straight into or out of savings                                            | currency, amount_minor (+/−), kind (opening, take_out, prepayment, plan_extra), moved_on                                                                                              |
| `cycle_close`          | the salary-day choices about the cycle that ended                                      | cycle_id (ended one), per currency: leftover_correction_minor, leftover_to_savings_minor; overspend_choice (take, ignore)                                                             |
| `day_choice`           | the morning underspend answer                                                          | cycle_id, day_on (one per user), choice (spread, today)                                                                                                                               |
| `card`                 | a credit card                                                                          | name, currency, archived                                                                                                                                                              |
| `instalment_plan`      | bank loan or card instalments                                                          | name, currency, price_minor, payment_count, payment_minor, first_payment_on, card_id?, normal_monthly_minor?, paid_off_on?                                                            |
| `plan_extra_payment`   | extra or early payoff                                                                  | plan_id, amount_minor, from (free, savings), paid_on                                                                                                                                  |
| `person_debt`          | lent to / borrowed from a person                                                       | person_name, direction (lent, borrowed), currency, amount_minor, on, settled                                                                                                          |
| `push_subscription`    | one device with alerts on (18)                                                         | endpoint (unique, secret), p256dh, auth, last_ok_at; deleted on a 404/410 reply                                                                                                       |
| `reminder_sent`        | one reminder sent                                                                      | kind, subject_id? (commitment, pot or cycle), sent_on; makes "send once" and "Tight only on change" work                                                                              |
| `prepayment`           | a long period paid up front from savings                                               | name, currency, total_minor, payback_minor per cycle, normal_monthly_minor?                                                                                                           |

Commitment `kind`: bill, savings, card_bill, plan_payment, person_payback, savings_payback.

## Only ever worked out (never stored)

Free money, daily allowance, days left, spending speed, run-out verdict, pot amount left and verdict, savings totals (per currency and combined), card balances, plan progress and interest, prepayment saving, leftover before correction, overspend, rate gain and loss, commitment "still to pay".

## How things link

- **Pay cycle id**: its own `cycle` row, made when the salary is entered. A cycle ends when the next one starts; the newest is the current one.
- **Recurring commitments**: on salary day each active `recurring_commitment` makes a `commitment` row in the new cycle, filled with the last amount and date, for the user to check.
- **Pots**: the `pot` lives across cycles; each cycle gets its own `pot_allocation` (at most one per pot and cycle). A spend's `pot_id` has no foreign key: a spend whose pot is gone counts as free money.
- **Carried over**: the old commitment is marked `carried`; a new row in the new cycle points back with `carried_from_id` (history kept).
- **Instalment plans, card bills, person paybacks, prepayment paybacks**: each makes a `commitment` per cycle, linked by its `*_id`.

## Rules that shape the data (decided in 13)

- **Bills first on conversion**: the rupees of a conversion first cover the spending-currency set-asides not yet covered (counted at the cycle's `reserve_rate`); the rate gain or loss is worked out on that part only; the rest is free money.
- **Ended cycles are locked**: rows with an ended `cycle_id` can't be added, changed or deleted. A forgotten spend is entered in the current cycle; salary-day leftover correction is the only fix.
- **Spends dated back** only within the current cycle.
- **Undo salary day**: allowed until any new row is entered in the new cycle; it deletes the new `cycle`, its `cycle_close`, its generated commitments and pot allocations, and restores the old commitments' state. The salary amount itself stays editable in the current cycle.
- **Delete** is a real delete; the "undo" is only on screen.
- **Offline** (17): the phone only adds `spend` and `commitment_payment` rows and changes its own unsent ones, so no delete markers are needed; a resent row with the same `id` is saved once.
