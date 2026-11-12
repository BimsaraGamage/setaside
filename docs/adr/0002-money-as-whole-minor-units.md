# Money stored as whole minor units, rates kept exactly as typed

Decided in ticket 07, 2026-11-12. With two currencies and many partial USD-to-LKR conversions (ticket 11), floating-point drift would add up across a cycle. So every amount is stored as an integer in its currency's smallest unit (USD 12.34 → `1234`, LKR 500.00 → `50000`), together with its currency code. Exchange rates are kept exactly as the user typed them, as a decimal string or a scaled integer, never as a float. Rounding happens once, at conversion, using one fixed rule in the shared rules code.
