# Setaside · v0.1 build backlog

Ordered list of build issues for the **v0.1** milestone. Rules: [spec.md](spec.md). Tables: [data-model.md](data-model.md). Words: [GLOSSARY.md](../GLOSSARY.md).

**How it is cut.** Each item is one small end-to-end feature: it adds one thing that can be tried in the app, is one pull request, and fits about one session. Each item brings its own money-rule tests (written first), server tests (the "second user is refused" test covers every new route) and, where listed, a browser journey. Each becomes one GitHub Issue when the repo is created; the number below is the order, not the issue number.

**Order.** Foundations, then the daily loop in one currency, then salary day, then two currencies, then debts, then history, offline, reminders and the account extras, then going public. Later items assume earlier ones; items in the same group with no stated need can be swapped.

## A. Foundations

1. **Empty app live, with CI and release.** Create `BimsaraGamage/setaside` (private, MIT), copy in `GLOSSARY.md`, `docs/adr/`, `docs/data-model.md`, `docs/spec.md`, this backlog (remove links to the private planning tickets). One project: Vite + React + TypeScript, Hono API on one Worker with static assets, D1 + Drizzle with a first migration, empty money-rules module, `wrangler dev` with local D1. CI workflow: part 1, part 2 (one placeholder Playwright test, Chromium + WebKit), `all good` gate, PR-title check. release-please with the release GitHub App; release run with Time Travel bookmark, migrations, deploy. First-time setup done (workers.dev name, D1, preview URLs off, token, variables) and written as the self-host guide. Done when a "Hello, Setaside" page is live at `setaside.<account-name>.workers.dev` from a release. _(spec 15, 17, 18)_
2. **Login.** Better Auth with Google sign-in and passkeys, allowed-email list as a Worker secret, 30-day sessions renewed on use, Sign out and Sign out everywhere, local-only Sign in as demo user. The one shared user check on every route, and the shared "second user is refused" server test. Measure CPU per sign-in. Journey: demo sign-in. _(spec 13)_

## B. Daily loop, one currency

3. **First use and Today with free money.** Settings row and first-use steps in one currency: currencies (same for now), home time zone, usual pay day, money held now, expected salary day. Makes the first cycle (opening income). Today shows free money, days left and the daily allowance, rounded down. Bottom tabs in place (empty pages allowed). _(spec 2, 7, 10)_
4. **Add a spend.** The + sheet: date, number pad, live "left today" line, note, Save, Undo toast. Allowance fixed for the day, spent-today bar, "Over by X", following days recalculated. Edit and delete a spend; dated back within the cycle only. Journey: add a spend. _(spec 7, 10)_
5. **Commitments and Next up.** Plan tab: add, edit, delete commitments (name, amount, due date). Today's Next up list with totals, "in N days", and "Salary expected". Free money and today's allowance change at once. Due after the expected salary day shows as coming up only. _(spec 3, 10)_
6. **Pay a commitment.** Pay in full or in parts, paid more or less than planned, still to pay, Mark finished. Journey: pay a commitment. _(spec 3)_
7. **Pots.** Starter pots, new pot, edit, archive; pot amount this cycle; spend sheet's pot choice; pot left with bar; used up → further spends from free money. _(spec 4)_
8. **Spending speed and verdict.** One-off toggle on spends; speed from finished days; first-3-days rule ("Too early to tell" on the first cycle); On track / Tight / Runs out on date; pot verdicts and "Used up"; speed and tomorrow's amount line on Today. _(spec 7)_
9. **Underspend question.** Morning card on Today: spread or add to today; skipped days added together; not on the last day; answer stored. _(spec 7)_
10. **Savings and extra income.** Savings set-aside as a commitment kind; savings total; Money tab with Savings (Take out, Put in, movements) and Add income (extra income split to savings and free money); new allowance shown before saving. _(spec 5)_

## C. Salary day

11. **Salary day: new cycle.** Salary arrived → steps 1, 4, 5, 6, 7: salary, commitments filled from recurring ones, pots, expected salary day, summary with gap warning, Start new cycle. Every cycle page (usual commitments and pots, paused switch); "Every cycle" switch on a commitment. Ended cycle locked. Journey: salary-day steps. _(spec 2, 3, 6)_
12. **Salary day: closing the old cycle.** Steps 2 and 3: leftover (free money, unused pots, dropped commitments) with correction and split; overspend choice; unpaid commitments Paid it / Carry / Drop (carried row points back). _(spec 6)_
13. **Undo salary day and late salary.** Undo until anything new is entered; salary amount editable in the current cycle; salary-late message and new expected day, days re-counted. _(spec 2)_
14. **Prepayment from savings.** Take out of savings "for a prepayment" → payback commitment each cycle; payback progress on Savings. _(spec 5)_

## D. Two currencies

15. **Salary and spending currency.** Settings and first use allow two currencies; money held per currency; savings totals per currency plus combined; counting rate set by hand; free dollars counted into free money (round down); commitments and pots get a currency; dollar set-asides come from dollars. _(spec 8)_
16. **Change dollars.** Conversion entry with live rate, last conversion becomes the counting rate, reserve rate kept on salary day, bills first, rate gain to savings and loss from free money, this cycle's conversions; leftover split per currency on salary day. _(spec 8, 6)_
17. **Paid in the other currency.** Pay sheet takes another currency; reserved money goes back; payment from free money in its own currency. _(spec 8, 3)_

## E. Cards, plans, people

18. **Cards and card balance.** Add a card; Card toggle on the spend sheet; running card balance; card bill commitment filled from the balance; part payment keeps the rest held; held money not leftover. _(spec 9)_
19. **Instalment plans.** New loan or instalments; a payment commitment each cycle; progress page (N of M, paid, still to pay, interest, last date); Pay extra and Pay it all off from free money or savings; normal monthly price and prepayment saving. _(spec 9)_
20. **People.** I lent money, I borrowed; Got it back split like extra income; borrowed money via Add income; payback commitment with a date; Settled. _(spec 9)_

## F. History, offline, reminders, account

21. **Past cycles.** Past tab list and one ended cycle, read only. _(spec 10)_
22. **Home time zone switch.** Ask once when the phone's zone differs; the answer becomes the new home zone. Midnight test cases. _(spec 10, 15)_
23. **Installable app.** Web app manifest (`display: standalone`), service worker keeping the app files, current cycle copy kept on the phone; opens offline. _(spec 11)_
24. **Offline spends and payments.** Unsent queue on the phone, sent oldest first with retries, resend saved once; only unsent items editable offline; "Offline · N not sent", unsent marks, "last updated"; spend moved to the current cycle with a note; needs a look list for payments. _(spec 11)_
25. **Reminders in the app.** The six reminder rules worked out daily; list at the top of Today with the turn-on banner; Settings → Reminders (switches, times, days ahead). _(spec 12)_
26. **Phone notifications.** Web Push keys as Worker secrets; Turn on reminders per device; push subscriptions stored and cleaned on 404/410; Cron Trigger every 15 minutes; morning summary and spend nudge at local times; reminder-sent record for "once" and "on change". Measure CPU per push. _(spec 12)_
27. **Download my data.** JSON of every record; CSV of spends. _(spec 14)_
28. **Delete account.** Warning, download first, type DELETE; removes every row of the user and signs out every device. _(spec 14)_

## G. Release v0.1

29. **Go public.** Community files and issue forms; history checked for secrets; repo public; ruleset on `main` (PR + `all good`, not strict, no force push); Dependabot, CodeQL, secret scanning with push protection, private vulnerability reporting; Cloudflare token moved into the `production` environment; self-host guide checked from scratch; confirm the "to confirm at setup" facts (spec 18). Merge the Release PR for v0.1.0. _(spec 17, 18)_
