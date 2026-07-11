# 🔥 FIRE Calculator

A transparent **FIRE (Financial Independence, Retire Early)** planner. No build
step, no dependencies, no data leaving your browser — everything is computed
locally and saved to `localStorage`.

**Live app:** https://shagunbandi.github.io/FireCalculator/

## What it does

A five-step guided flow:

1. **Pick your flavour of FIRE** — Regular, Lean (discretionary spending halved
   in retirement), Fat (1.5× cushion), Coast (front-load investing, then let
   compounding finish the job), or Barista (part-time income covers part of the
   bill). Plus your currency (₹ / $ / € / £).
2. **List your expenses** — either a single total (monthly or yearly, with a
   rough essential share) or an optional per-category breakdown where each
   item is marked essential/discretionary and tied to its own inflation rate
   (general, healthcare, or education). Plus big one-time goals (house down
   payment, kids' education, weddings…) with the age they happen and today's
   cost.
3. **Check the assumptions** — every estimate (inflation rates, portfolio
   returns before/after FIRE, safe withdrawal rate, plan-until age, annual
   investment step-up) is shown with its default, the reasoning behind it, and
   an input to change it. Changed values are highlighted and individually
   resettable.
4. **Set your timeline** — current age, target FIRE age, what you've already
   invested, and (optionally) what you invest today for on-track feedback.
5. **Get your plan** — the required monthly investment (flat, and a lower
   step-up variant), the corpus you need (nominal and in today's money), an
   interactive year-by-year portfolio projection, a full data table, and a
   plain-language "how this was calculated" walkthrough.

## How the math works

- Every expense inflates at its own category rate from today to each future year.
- The **required corpus** at your FIRE age is the exact present value (at your
  post-FIRE return) of every year of spending and every goal from FIRE to your
  plan-until age — not just a 25× rule of thumb. The SWR shortcut is shown
  alongside as a cross-check.
- The **required monthly investment** is the smallest amount for which the
  simulated portfolio never dips below zero through your whole life — including
  through every one-time goal (found by binary search over a year-by-year
  simulation in [`engine.js`](engine.js)).
- Deliberately not modelled (and said so in the app): taxes, fees, market
  volatility / sequence-of-returns risk. Returns are smooth averages; treat the
  answer as a floor, not a ceiling.

## Run locally

It's a static page — open `index.html` in a browser, or:

```bash
python3 -m http.server   # then visit http://localhost:8000
```

Append `?example=1` to load a filled-in example plan.

## Deployment

Pushes to the configured branches trigger
[`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml),
which publishes the repository root to GitHub Pages.

---

*Educational tool, not financial advice.*
