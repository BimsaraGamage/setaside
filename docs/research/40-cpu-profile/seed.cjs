const fs = require("fs");
const uid = JSON.parse(fs.readFileSync(process.argv[2])).user.id;
const out = process.argv[3];
const id = () => crypto.randomUUID();
const now = Date.now();
const L = [];
const ins = (t, o) => {
  o = { id: id(), user_id: uid, created_at: now, updated_at: now, ...o };
  const vals = Object.values(o).map((v) => (v === null ? "null" : typeof v === "string" ? `'${v}'` : v));
  L.push(`insert into ${t} (${Object.keys(o).join(",")}) values (${vals.join(",")});`);
  return o.id;
};
const day = (base, n) => {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
ins("settings", { salary_currency: "LKR", spending_currency: "LKR", home_time_zone: "Asia/Colombo", usual_pay_day: 12 });
const last = ins("cycle", { started_on: "2026-10-12", expected_salary_on: "2026-11-12", created_at: now - 1 });
const cur = ins("cycle", { started_on: "2026-11-12", expected_salary_on: "2026-12-12" });
const card = ins("card", { name: "Visa", currency: "LKR", archived: 0 });
const pots = [];
for (const n of ["Groceries", "Transport", "Eating out", "Fun", "Health", "Home"]) {
  const p = ins("pot", { name: n, currency: "LKR", usual_amount_minor: 1500000, archived: 0 });
  pots.push(p);
  for (const c of [last, cur]) ins("pot_allocation", { pot_id: p, cycle_id: c, amount_minor: 1500000 });
}
for (const [c, b] of [
  [last, "2026-10-12"],
  [cur, "2026-11-12"],
]) {
  ins("income", { cycle_id: c, kind: "salary", currency: "LKR", amount_minor: 30000000, received_on: b });
  ins("income", { cycle_id: c, kind: "extra", currency: "LKR", amount_minor: 2000000, received_on: day(b, 5), to_savings_minor: 500000 });
  for (let i = 0; i < 90; i++)
    ins("spend", {
      cycle_id: c,
      spent_on: day(b, i % 30),
      amount_minor: 50000 + i * 1000,
      currency: "LKR",
      note: `spend ${i}`,
      pot_id: i % 3 ? pots[i % 6] : null,
      card_id: i % 7 ? null : card,
    });
  for (let k = 0; k < 14; k++) {
    const cm = ins("commitment", {
      cycle_id: c,
      name: `Bill ${k}`,
      kind: "bill",
      currency: "LKR",
      planned_minor: 500000 + k * 10000,
      due_on: day(b, k * 2),
      state: k < 8 ? "finished" : "open",
    });
    ins("commitment_payment", { commitment_id: cm, currency: "LKR", amount_minor: 500000, paid_on: day(b, k * 2) });
  }
  for (let d = 1; d < 6; d++) ins("day_choice", { cycle_id: c, day_on: day(b, d * 3), choice: "spread" });
  for (let s = 0; s < 4; s++)
    ins("savings_movement", { cycle_id: c, currency: "LKR", amount_minor: 300000, kind: "put_in", moved_on: day(b, s) });
}
for (let r = 0; r < 8; r++)
  ins("recurring_commitment", { name: `Bill ${r}`, kind: "bill", currency: "LKR", usual_amount_minor: 500000, usual_day: r + 1, active: 1 });
ins("cycle_close", { cycle_id: last, next_cycle_id: cur, currency: "LKR", leftover_correction_minor: 0, leftover_to_savings_minor: 0 });
ins("prepayment", { name: "Gym", currency: "LKR", total_minor: 6000000, payback_minor: 500000 });
const pl = ins("instalment_plan", {
  name: "Phone",
  currency: "LKR",
  price_minor: 10800000,
  payment_count: 12,
  payment_minor: 1000000,
  first_payment_on: "2026-10-20",
});
ins("plan_extra_payment", { cycle_id: cur, plan_id: pl, currency: "LKR", amount_minor: 100000, paid_from: "free", pays_off: 0, paid_on: "2026-11-13" });
ins("person_debt", { cycle_id: cur, person_name: "Nimal", direction: "lent", currency: "LKR", amount_minor: 500000, made_on: "2026-11-13" });
fs.writeFileSync(out, L.join("\n"));
console.log(L.length, "rows");
