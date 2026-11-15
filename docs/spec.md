# Setaside · v0.1 spec

Setaside is an open-source, mobile-first web app. After every salary it sets aside the **commitments** of the **pay cycle** and shows the **free money** left, the **daily allowance** for non-essential spending and a **run-out verdict** from the current spending speed. The main view is a list of upcoming commitments plus the allowance, not a chart. It runs on Cloudflare's free plan and costs nothing to deploy or run.

Words in **bold** are defined in [GLOSSARY.md](../GLOSSARY.md). Tables: [data-model.md](data-model.md). Hard-to-reverse choices: [adr/](adr/). Build order: [backlog.md](backlog.md).

Spec written 2026-11-12. It is the source of truth for v0.1; once copied into the repo it is changed through pull requests like the code.

## Contents

1. [Scope of v0.1](#1-scope-of-v01)
2. [Pay cycle](#2-pay-cycle)
3. [Commitments](#3-commitments)
4. [Pots](#4-pots)
5. [Savings, extra income and prepayments](#5-savings-extra-income-and-prepayments)
6. [Cycle end and salary day](#6-cycle-end-and-salary-day)
7. [Daily allowance, spending speed and verdict](#7-daily-allowance-spending-speed-and-verdict)
8. [Two currencies](#8-two-currencies)
9. [Cards, instalment plans and people](#9-cards-instalment-plans-and-people)
10. [Screens](#10-screens)
11. [Offline use](#11-offline-use)
12. [Reminders](#12-reminders)
13. [Login and per-user data](#13-login-and-per-user-data)
14. [Data download and delete account](#14-data-download-and-delete-account)
15. [Stack and architecture](#15-stack-and-architecture)
16. [Testing](#16-testing)
17. [Repo, workflow and releases](#17-repo-workflow-and-releases)
18. [Deploy and self-hosting](#18-deploy-and-self-hosting)
19. [Not in v0.1](#19-not-in-v01)

---

## 1. Scope of v0.1

v0.1 is the version the maintainer uses every day and the version the repo goes public with. It contains everything in this spec:

- pay cycle, commitments, pots, savings, extra income, cycle end and salary day (sections 2–6);
- daily allowance, spending speed and run-out verdict (7);
- two currencies: salary in one, spending in another (8);
- card spends and card balances, instalment plans with their progress page, money lent to or borrowed from people (9);
- every screen in section 10, including past cycles;
- offline spend entry (11), reminders (12), login (13), data download and delete account (14).

**Users.** v0.1 serves one person, but is ready for many: real login and every record tied to one account from day one. Only addresses on the **allowed-email list** can make an account.

**Spend entry** is manual and phone first: an amount and an optional note, in a few seconds.

**Core model: set aside up front.** On salary day every commitment, pot and savings set-aside of the cycle is reserved; only free money is tracked day to day. There is no cash-flow or bank-balance view.

**Locale.** English only. Numbers in Sri Lanka style (`Rs 1,850`, `$1,200`). Dates and "today" follow the user's **home time zone**.

## 2. Pay cycle

- A **pay cycle** starts when a salary is entered and ends when the next salary is entered. No calendar dates are involved.
- The entered salary amount is the truth. A salary that differs from last time needs no special handling.
- **Expected salary day.** On salary day the app suggests the next one from the usual pay day; the user confirms it and can change it later. The daily allowance counts days up to it.
- **Salary early:** entering it ends the current cycle early.
- **Salary late:** when the expected salary day passes with no salary entered, the app says the salary is late and asks for a new expected day. What is left is spread over the extra days.
- **Set-asides larger than the salary:** if commitments + pots + savings set-aside are more than the salary (compared at the **counting rate** when currencies differ), the app shows the gap before the cycle starts; the user lowers something or takes money from savings.
- **Ended cycles are locked.** Nothing in an ended cycle can be added, changed or deleted. A forgotten spend from last cycle is entered in the current cycle; the leftover correction on salary day (section 6) is the only fix to an ended cycle.
- **Spends can be dated back** only within the current cycle.
- **Undo salary day:** allowed until anything new is entered in the new cycle. It removes the new cycle and everything salary day made (its cycle-end choices, generated commitments and pot amounts) and reopens the old cycle as it was. The salary amount itself stays editable during the current cycle.

### First use

The first cycle usually starts mid-cycle. The user enters:

1. salary currency, spending currency, home time zone (suggested from the phone) and usual pay day;
2. the money they hold now, per currency;
3. the expected salary day;
4. only the bills still unpaid before that day, and any pots.

This makes a short first cycle. The money held is stored as opening income. Screen: the salary-day steps (section 6) with step 1 asking "money you have now" per currency and steps 2–3 skipped.

### Editing

Spends, payments and commitments can be edited or deleted at any time within the current cycle; every number recalculates. Deletes are real deletes; the only undo is the on-screen Undo right after a change.

## 3. Commitments

A **commitment** is an essential expense with an amount, a currency and a due date. Kinds: bill, savings set-aside, card bill, instalment-plan payment, payback to a person, payback to savings.

- **Recurring commitments** ("Every cycle") are filled in on salary day with the last amount and day; the user changes or removes any, then confirms. A recurring commitment can be paused.
- A commitment can be **added or edited at any time**; free money and today's allowance change at once.
- **Paying.** The user marks it paid with the real amount and date (in the current cycle, up to today). Paid more than planned lowers free money by the gap at once; paid less raises it once the commitment is finished.
- **Part payments** are allowed. Each payment is recorded, the rest shows as "still to pay", and the commitment is done when marked finished. Pay has a "This finishes it" switch, on when the amount covers what is still to pay. A finished commitment can be reopened; it takes no payments until then. A payment on one due after the expected salary day comes out of free money at once.
- **Paid in the other currency:** see section 8.
- **Due after the expected salary day:** it belongs to the next cycle. This cycle shows it on the timeline as coming up only (after "Salary expected", outside the total, not set aside). One due **on** the expected salary day still belongs to this cycle.
- **Late:** an open commitment whose due day has passed stays set aside and shows at the top of Next up as "N days late".
- **Unpaid at cycle end:** salary day asks, for each one: Paid it · Carry to the new cycle (its set-aside money goes with it; shown as late) · Drop (its money joins the leftover). A carried commitment is a new commitment in the new cycle that points back to the old one.
- Card bills, instalment-plan payments and paybacks are made by their card, plan, person or prepayment (section 9), not from the Every cycle list.

## 4. Pots

A **pot** is an essential expense with no single due date, spent bit by bit (groceries, fuel).

- The user makes their own pots. Starter pots: Groceries, Fuel, Transport, Medicine; each can be renamed or deleted.
- Each pot has a currency and a usual amount, set aside again each cycle. A pot can be archived ("Stop using this pot").
- **Spend entry defaults to free money**; one tap switches a spend to a pot. That choice is what makes a spend essential.
- **Pot used up:** further spends in it come from free money and lower the allowance; the pot shows "Used up" and how far over.
- **Pot not used up at cycle end:** the rest joins the leftover.
- Pots have **no daily amount**. Each shows the amount left and its own verdict (section 7).

## 5. Savings, extra income and prepayments

**Savings set-aside.** Taken out on salary day like a commitment, filled in like a recurring one, done when marked as moved.

**Savings totals.** One running total per currency (salary and spending currency), plus a combined total in the spending currency at the counting rate. Savings grow from set-asides, saved leftover, saved extra income and rate gains. Money can be:

- **taken out** into free money (the new allowance is shown before saving);
- **put in** directly.

**Extra income** (bonus, refund) is entered in its own currency and split by the user: how much to savings, how much to free money. Today's allowance rises with the free part at once. The Add income screen also records loan money received as cash, money borrowed from a person and money paid back to the user (section 9), each split the same way.

**Prepayment from savings.** Example: a year of gym, 60,000, paid from savings for the discount. The savings total drops by 60,000; each cycle a "gym, 5,000" payback commitment is set aside and goes back into savings, so free money feels the same as paying monthly. Started from Take out of savings ("For a prepayment? Yes, pay back"). Savings shows each prepayment's payback progress.

**Prepayment by instalments:** section 9.

## 6. Cycle end and salary day

**Leftover** = unspent free money + unused pot money + money of dropped commitments. Money held for a card balance is not leftover; it carries over until paid.

**Overspend** = spending beyond free money at cycle end, in the spending currency.

On salary day the app shows the leftover per currency. The user can correct the amount (for spends never entered), then splits it: savings or the new cycle. Unconverted dollars go to dollar savings or carry over as unconverted dollars; rupees go to rupee savings or the new free money. If there is an overspend instead, the user chooses: take it from the new cycle's free money, or ignore it.

### Salary-day steps

Started from **Salary arrived** (Today header or Plan tab). Seven steps, one per screen, always in this order:

1. **Salary**: amount (salary currency) and date received.
2. **Last cycle's leftover**: free money left + unused pot money; "actually have in hand" correction; split into savings and the new cycle, or the overspend choice.
3. **Last cycle's unpaid commitments**: Paid it · Carry to new cycle · Drop.
4. **This cycle's commitments**, filled from the recurring ones and from cards, plans, people and prepayments; each editable; + Add.
5. **Pots** and their amounts; + New pot.
6. **Expected next salary day** (suggested from the usual pay day) and the **counting rate** (last conversion's by default).
7. **Summary**: free money, daily allowance, verdict, and the gap warning if set-asides exceed the salary; **Start new cycle**.

After starting, an **Undo salary day** button shows on Plan (and in the toast right after starting) for as long as undo is allowed (section 2).

## 7. Daily allowance, spending speed and verdict

### Daily allowance

- **Days left** counts today and runs to the day before the expected salary day. A late salary re-counts them.
- **Today's allowance** = free money at the start of the day ÷ days left, **rounded down** to a whole unit of the spending currency.
- **Fixed for the day.** Spends during the day do not change it; they show against it ("Spent Rs 1,850 · Rs 3,500 left today", or "Over by Rs 1,000"). The following days are recalculated from what is left, so an overspend lowers them.
- **Changes that are not spends** recalculate today's allowance at once: extra income, a commitment added, edited or paid more or less than planned, money taken out of savings, a new counting rate, a rate gain or loss.
- **Free money at zero or below:** today shows 0 and "Over by X" takes the place of the verdict.

### Underspend

The first time the app is opened on a new day, if yesterday's allowance was not all spent, a card asks: **Spread over the days left** · **Add to today**. Days the app was not opened are added together into one question. It does not ask on the last day of the cycle. The answer is stored (the numbers depend on it).

### Spending speed

- Average per day since salary day: spends that came out of free money (cash, card, and pot spends past an empty pot) ÷ finished days. Today's spends count from the next morning.
- Left out: **one-off** spends, commitment payments (including card bills and plan payments), and spends covered by a pot.
- **One-off** is a toggle on a spend: it still uses free money but is left out of the speed. It can be set or undone at any time.
- **First 3 days of a cycle:** last cycle's speed is used (one-offs left out). On the very first cycle: "Too early to tell".

### Run-out verdict

- **On track**: speed is at most 90% of today's allowance.
- **Tight**: speed is above 90% of today's allowance and free money still lasts to the expected salary day.
- **Runs out on <date>**: free money does not last; date = today + free money left ÷ speed.

### Pots

Each pot gets the same verdict from its own speed (spends in that pot ÷ finished days). A used-up pot shows "Used up".

## 8. Two currencies

- Each user sets a **salary currency** and a **spending currency** once (for example USD and LKR). They can be the same. At most two currencies per user. If they are the same, everything about conversions below is hidden.
- The salary is entered in the salary currency and starts the cycle.
- **Conversion** ("Change dollars"): recorded as dollars given, rupees received, and date. The rate is the one actually got. The app keeps no live rates and fetches none.
- **Counting rate:** dollars not yet converted count toward free money at this rate. It is the last conversion's rate, and the user can type another (for example their bank's rate today) at any time.
- **Free money and the daily allowance** are shown in the spending currency only, including the free dollars not yet converted at the counting rate.
- **Commitments, pots and savings set-asides** each have their own currency. Dollar ones are set aside from the dollars and never touch rupee free money. Rupee ones are reserved from the dollars at the counting rate on salary day (the cycle keeps that rate as its **reserve rate**).
- **Bills first.** The rupees from a conversion first cover the rupee set-asides not yet covered; the rest is free money.
- **Rate gain or loss** is worked out on the part that covered rupee set-asides only, against the reserve rate: a gain goes to rupee savings, a loss comes out of free money. Both are shown as a short line on the Change dollars screen and recalculate today's allowance.
- **Paid in the other currency** (a $20 bill charged Rs 6,100): the user enters what was actually paid. The reserved money goes back (to unconverted dollars, or to rupee free money) and the payment comes out of free money in its own currency.
- **Leftover, extra income and overspend:** as in sections 5 and 6, each part in its own currency.

### Rounding

Amounts are whole minor units. Rounding happens only where a rate is applied (counting dollars at the counting or reserve rate): **round down** to the minor unit, so free money is never overstated. The daily allowance is then rounded down to a whole unit (section 7).

## 9. Cards, instalment plans and people

### Card spends and card balance

- A **card spend** is a spend with the Card toggle on. It lowers free money (or a pot) the day it is made, like cash; its money is then held for the card bill. Card spends beyond free money count as overspend.
- Each card has a currency and a running **card balance**: card spends add to it, payments take it down. No statement dates, card limit or minimum-payment tracking.
- **Card bill**: a commitment with the due date the user enters, amount filled from the card balance. Paid in full or in part; the rest stays owed and its money stays held. Paying it does not lower free money again.
- Interest and late fees are entered as a spend from free money.

### Instalment plans

Bank loans and card instalment plans are one kind.

- Entered once: name, currency, total price, number of payments, payment amount, first payment date; optionally the card it is on and the normal monthly price.
- Each cycle gets a commitment for the next payment, so free money only feels the payment.
- **Progress page**: payments made of total (with a bar), amount paid and still to pay, interest so far and total, last payment date.
- **Interest** = all payments − price. No interest rate is entered.
- **Pay extra / pay it all off**: the money comes from free money or savings (user picks); the payments left drop.
- A loan that pays for something directly needs nothing else entered. Loan money received as cash is added on Add income.
- **Prepayment saving:** if the normal monthly price is typed, the plan shows what paying up front saved, after interest (for example "saved 8,400 vs paying monthly, after 1,200 interest").

### People (lent and borrowed)

- A list of who owes what, each in its own currency.
- **Lend**: lowers free money now. **Got it back**: the money is split between savings and free money, like extra income.
- **Borrow**: added like extra income. Paying back is a commitment with a date the user sets.
- **Settled** closes an entry.

## 10. Screens

Phone first. Visual style is build work; the layouts below are fixed. Throwaway drafts of every screen were made during planning.

### Getting around

**Bottom tabs**, always visible on tab screens: **Today · Plan · Money · Past · Settings**. A page opened from a tab covers the tab bar and has a ← back button. The **+** spend button is on Today only. Rows on Today are not links, except today's spends, which open the spend sheet to change or delete them.

### Today

Top to bottom:

- **Header**: app name, cycle dates ("Cycle 31 Oct → salary Mon 30 Nov"), **Salary arrived** button.
- **Offline line** when offline or with unsent items (section 11).
- **Reminders list and turn-on banner** when phone alerts are off (section 12).
- **Underspend card** when there is a question to answer (section 7).
- **Main card**: "You can spend today" and the daily allowance, large; the verdict chip; a bar of today's spends against the allowance; today's spends, each opening the spend sheet; free money and days to salary; a small line with spending speed per day and tomorrow's amount.
- **Next up · already set aside**: open commitments from today to the expected salary day, each with date, weekday, "in N days", a note (card balance, "7 of 12"), and amount; total at the top; ends with "Salary expected" on its day. This is the timeline; there is no chart.
- **Pots**: amount left, a bar, each pot's verdict.
- Floating **+** button.

### Spend sheet (the + button)

A bottom sheet: date chip (Today, changeable within the current cycle); amount on a number pad; live line "Rs X left today after this" (or "Over today by X", or "from <pot> pot"); optional note; one choice of Free money or a pot; Card toggle (with card choice when there are several); One-off toggle; Save. After saving, a toast with **Undo**. Opened from a spend, the same sheet changes it and has **Delete**; changes and deletes also get the toast with **Undo**.

### Plan

This cycle's commitments (+ Add) and pots (+ New pot), each opening its edit page; an **Every cycle** link; **Salary arrived**.

- **Commitment** (new or edit): name, currency and amount, due date, "Every cycle" switch; card bills and plan payments show what they are linked to. Payments list, still to pay, **Pay** (amount, currency, date; a note when paid more, less or in the other currency), **Mark finished**, Delete.
- **Pot** (new or edit): name, currency and amount this cycle, usual amount; spends from the pot; Stop using this pot.
- **Every cycle**: usual commitments with amount and day, each with an on/off (paused) switch; usual pots.

### Money

Rows for Spends, Savings, Change dollars, Add income, each card, each instalment plan, People.

- **Spends**: this cycle's spends by day, newest first, with each day's total; each opens the spend sheet to change or delete it.

- **Savings**: dollar and rupee totals, combined in the header; Take out, Put in; prepayments with payback progress; movements list.
- **Take out of savings**: currency, amount, new allowance shown; "For a prepayment? Yes, pay back".
- **Change dollars**: dollars given, rupees received, date; live rate; how much covers rupee bills and how much goes to free money; rate gain (→ savings) or loss (← free money). Counting rate field with Set. This cycle's conversions.
- **Add income**: kind (extra income, loan money, borrowed, paid back to me), currency and amount, split to savings and free money, new allowance shown.
- **Card**: balance, bill date with Pay the bill (opens the bill commitment), card spends, payments; + Add another card.
- **Instalment plan**: N of M with bar and last payment date, paid and still to pay, interest so far and total, Pay extra, Pay it all off (from free money or savings); + New loan or instalments.
- **People**: list with lent or borrowed, date, payback date; Got it back / Settled; I lent money, I borrowed.

### Past

- **Past cycles**: list, each with dates, salary, spent, how it ended.
- **One ended cycle**: locked badge, salary, spent, how it ended, average a day, commitments (planned vs paid, carried), pots, spends list. Read only.

### Settings

Salary and spending currency, counting rate, usual pay day, home time zone; **Reminders** (section 12); passkeys + Add, Google backup, Sign out, Sign out everywhere; **Download my data**; **Delete account**.

### Salary day and first use

Section 6 and section 2.

### Home time zone

Asked at first use, suggested from the phone. If the phone's time zone later differs, the app asks once whether to switch; the answer becomes the new home time zone. Due dates are plain calendar days with no time.

## 11. Offline use

- **Installable**: a web app manifest (`display: standalone`) and a service worker that keeps the app's files, so the app opens with no connection. Also needed for iPhone reminders.
- The phone keeps a copy of the current cycle's records to show offline.
- **Works offline: adding spends and paying commitments** (in full or in part). Pots, salary day, settings and every other change wait for a connection.
- **Only unsent items can be changed or removed offline.** Anything already saved on the server waits for a connection. So offline work never clashes with another device, and no delete markers are needed.
- **Unsent queue** is kept on the phone and survives closing the app. When the connection is back it is sent by itself, oldest first; the server checks each item with the shared money rules; the phone retries until each is confirmed. Ids are made on the phone, so a resent item is saved once. If the session has ended, the queue waits until the user signs in again.
- **When an unsent item no longer fits** (its cycle ended because salary day was entered on another device, or its commitment was removed or finished): a spend moves into the current cycle with a note to the user; a commitment payment goes to a **needs a look** list, where the user fixes or removes it.
- **On screen**: "Offline · N not sent", unsent items marked in lists, and "last updated <time> ago" by the allowance while offline. The allowance offline is worked out on the phone from the saved copy plus unsent items.

## 12. Reminders

- **Channel: phone notifications only** (standard Web Push from the Worker; no paid service). On iPhone the app must be added to the Home Screen (iOS 16.4 or later), then the user taps **Turn on reminders**. Alerts are turned on per device; a reminder goes to every device that has them on. Every push shows a visible notification.
- **Six reminders**, each with its own switch in Settings, all on at first:
  1. **Bill due soon**: an open commitment (card bills and plan payments included) is due in N days; N = 3, changeable. Sent once.
  2. **Bill due today / overdue**: repeats every morning until paid, carried or dropped.
  3. **Running out**: the free-money verdict or a pot's verdict is Tight or Runs out. Tight is sent only on the day it changes to Tight; Runs out repeats every morning while it holds.
  4. **Salary late**: from the morning after the expected salary day with no salary entered; repeats every morning.
  5. **Questions waiting**: an unanswered underspend choice, unpaid commitments at cycle end, or an overspend choice.
  6. **Spend nudge**: an evening reminder to log spends; skipped on a day with at least one spend.
- **Times** in the home time zone: **morning summary** at 08:00 and spend nudge at 21:00, each changeable in 15-minute steps.
- **Morning summary**: reminders 1–5 together in one notification (for example "Rent due today · Phone bill in 3 days · Groceries: runs out on 24 Nov"). Nothing due means no notification. Tapping it opens Today.
- **No alerts** (not on the Home Screen, blocked, or never turned on): the same reminders show as a list at the top of Today, with a dismissable banner explaining how to turn alerts on (including the Home Screen step on iPhone).
- No reminders before the first salary is entered.
- **Settings → Reminders**: six switches, the two times, the days-ahead number, this device's on/off and a Turn on reminders button.
- **How it runs**: one Cron Trigger every 15 minutes (UTC), within the free plan's limits (10 ms CPU and about 50 outgoing calls per run). Each run sends what is due for users whose local time matches. Push subscriptions are stored one per device and deleted when the push service answers 404 or 410. What was sent is recorded, so "send once" and "Tight only on change" work. Measure CPU per push early.

## 13. Login and per-user data

See [ADR 0004](adr/0004-passkey-and-google-login-no-email.md).

- **Passkey** (fingerprint or face) for everyday sign-in. **Google sign-in** as backup and for the first sign-in, after which the user adds a passkey. No email login, no passwords, no Cloudflare Access.
- Library: **Better Auth** in the Worker, with its Hono integration and Drizzle adapter on D1 (needs `nodejs_compat`). Measure CPU per sign-in early against the 10 ms limit.
- **Allowed-email list**: only Google accounts on it can create an account. It is a Worker secret, not in code; opening sign-up later means changing that setting.
- **Sessions**: 30 days, renewed on use. **Sign out everywhere** in Settings.
- **Per-user data**: one database for all users; every stored record carries its owning user. The API reads and writes only through one shared check that scopes every query to the signed-in user; no route touches data without it.
- **Local development**: a **Sign in as demo user** button that exists only in local development, never on the live site. Passkeys also work on `localhost`. No Google setup is needed to build the app.
- Account recovery depends on Google: losing both the passkey and the Google account means losing access.

## 14. Data download and delete account

- **Download my data**: one JSON file with every record of the account. A CSV of spends as a second choice.
- **Delete account**: a warning, a "download first" button, and typing DELETE to confirm. It deletes the account and all its data (every row with the user's id) and signs out every device.

## 15. Stack and architecture

See [ADR 0001](adr/0001-browser-app-thin-api-one-worker.md), [ADR 0002](adr/0002-money-as-whole-minor-units.md), [ADR 0003](adr/0003-money-rules-run-on-the-phone.md) and [data-model.md](data-model.md).

- **Single-page app**: React + TypeScript, served as static assets (free and unlimited) by **one Worker**, which also runs a **thin JSON API** in **Hono** that only reads and saves data. Hono RPC shares types with the screens. No server-rendered pages.
- **One project**: screens and server in one folder, one install, one dev command, one deploy.
- **D1** is the only store, through **Drizzle**. The schema lives in code; drizzle-kit generates plain SQL migrations applied with `wrangler d1 migrations`.
- Build: Vite with the Cloudflare Vite plugin; npm; current Node LTS.
- **Money rules** are one pure TypeScript module with no browser or Worker APIs. The phone runs it to show every number; the server runs it to check writes. Totals are always worked out from stored entries, never stored.
- **Money**: integers in minor units plus a currency code. **Rates**: kept exactly as typed (decimal text), never floats.
- **Ids**: UUIDv7, made on the phone.
- **Days**: "today" follows the home time zone, not server UTC; `*_on` dates are plain `YYYY-MM-DD`.
- **Local development**: `wrangler dev` with a local D1 and demo seed data. No Cloudflare account, card or online service needed.
- Everything used is free and open source; nothing adds cost.

### Free-plan limits that shape the build

- Workers: 100,000 requests a day per account, **10 ms CPU per request**, 5 Cron Triggers per account. At a limit requests fail until 00:00 UTC; the free plan never bills.
- D1: 5 million rows read and 100,000 rows written a day; 500 MB per database.

## 16. Testing

- Runner: **Vitest**.
- **Money rules**: written test-first. Worked examples from this spec become test cases (each names the rule it checks), including home-time-zone cases around midnight, bills first, locked cycles, undo salary day, offline resend saved once, a spend moved to the current cycle, and a payment to a removed commitment going to needs a look. **Random checks** (property-based, for example fast-check, with a fixed printed seed) run thousands of random spend orders and check that totals always add up.
- **Server**: Cloudflare's Workers Vitest pool with a local D1 and the real migrations applied; fresh data for each test. **One shared test calls every route as a second user and must be refused**, so a new route cannot be missed.
- **Browser journeys** (3–5): demo sign-in, add a spend, salary-day steps, pay a commitment. **Playwright**, Chromium and WebKit, phone viewports, seeded demo data.
- Server and browser tests sign in as the local demo user. Google sign-in and passkeys are not tested end to end.
- **Every pull request runs everything**; nothing merges until all pass. No coverage percentage target.

## 17. Repo, workflow and releases

- **Name** Setaside; repo `BimsaraGamage/setaside`; **MIT** licence from the first commit; no CLA or DCO.
- **Private until v0.1**, then public. History must hold no secrets before going public.
- **Every change reaches `main` through a pull request**: branch → PR → checks pass → squash merge, branch deleted. PR titles follow Conventional Commits and are checked in CI.
- **PR checks**, in one workflow:
  - part 1: style, types, PR-title check, money tests, server tests, build;
  - part 2: Playwright journeys, Chromium and WebKit side by side;
  - an **`all good`** gate job that needs both parts.
  - Under 10 minutes per PR; each job has a 15-minute timeout. A new push cancels that PR's older run; release runs are never cancelled. Package-manager cache only; Playwright browsers are installed fresh each run. Actions pinned by full SHA; least-privilege permissions. PR checks use no secrets, so fork and Dependabot PRs run normally.
- **Versions**: SemVer from 0.1.0. **release-please** keeps a Release PR with the version and `CHANGELOG.md` written from PR titles. **Breaking** means a self-hoster must do something by hand (a manual step, or a changed or new setting).
- **Release login**: a small GitHub App owned by the personal account, installed on `setaside` only, with contents, pull requests and issues write. App ID is a repo variable, private key a repo secret. Each run mints a 1-hour token, so CI runs on the Release PR.
- **Release run** (on merging the Release PR, same workflow run): tag and GitHub Release; part 1 again; record the D1 Time Travel bookmark in the log; apply D1 migrations to the live database; deploy. No browser journeys. Goes live on each release, not on every merge.
- **Planning in the open**: build work in GitHub Issues, one Project board (To do / Doing / Done), one milestone per version. GitHub's default labels.
- **Docs in the repo**: `GLOSSARY.md`, `docs/adr/`, `docs/data-model.md`, this spec and the backlog, changed through PRs.

### Going public (at v0.1)

- README, CONTRIBUTING, CODE_OF_CONDUCT (Contributor Covenant 3.0), SECURITY (reports through GitHub private vulnerability reporting), issue forms (bug, feature), PR template.
- Ruleset on `main`: requires a PR and the **`all good`** check only, not strict (a PR need not be up to date with `main`), blocks force push, no review required.
- Dependabot (alerts and grouped version updates), CodeQL default setup, secret scanning with push protection, private vulnerability reporting. No OpenSSF Scorecard.
- Move the Cloudflare API token into a `production` environment limited to `main`, used only by the release run.

## 18. Deploy and self-hosting

- **Address**: `setaside.<account-name>.workers.dev`, free. `<account-name>` is the Cloudflare account's workers.dev name, picked once. Passkeys and Google sign-in are bound to it, so it is fixed before real use.
- **One Worker** named `setaside`, one D1 database, one Cron Trigger (reminders).
- **No online test copy.** Changes are tried locally and tested in CI; a release goes straight to the live app. Cloudflare **preview URLs are turned off** (they would use live data).
- **Cloudflare API token**: Workers Scripts edit and D1 edit, this account only. A repo secret while private; a `production` environment secret once public. Account ID is a repo variable.
- **Migrations are additive only** (new tables or columns). Removing something takes two releases, so old code keeps working on the new schema during a release.
- **Failed migration**: the release run stops before the new code goes live; the old app keeps running; fix forward in a new release. Restore with D1 Time Travel only if data looks wrong.
- **App settings** (Google client ID and secret, Better Auth secret, allowed-email list, Web Push keys) are **Worker secrets set once by hand** with `wrangler secret put`. Never in files or GitHub; releases leave them untouched.
- **Google sign-in**: one OAuth client for the live address only, basic scopes (`openid email profile`), consent screen published ("In production"), not "Testing". The allowed-email list is the gate.
- **First-time setup** (once, at repo creation): pick the workers.dev name, create the D1 database, make the Google OAuth client, make the Web Push keys, set the Worker secrets, make the release GitHub App, add the token, account ID and App details to GitHub.
- **Self-hosting**: a written guide in the repo with those same first-time steps, then "pull, run one command" for updates. No Deploy to Cloudflare button for now.
- **To confirm at setup**: D1 Time Travel keeps 7 days on the free plan; preview URLs share the live bindings; GitHub Free environments are public-repo only; basic-scope Google apps need no verification.

## 19. Not in v0.1

- **Public sign-up.** Before it: a privacy note, and a Turnstile bot check on sign-up.
- Automatic spend capture (bank SMS, email, bank API) and statement file import.
- Native mobile apps.
- Cash-flow or bank-balance projection.
- More than two currencies per user; live exchange rates.
- Other languages.
- Telegram or other reminder channels.
- Card limits, minimum payments, statement dates.
- Change history of edits.
