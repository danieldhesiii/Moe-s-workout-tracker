# Moe's Training Log

A mobile-first training tracker for an advanced runner training toward a marathon — built **injury-first**, with a knee-safe strength plan woven throughout and an adaptive daily check-in that decides the session for you.

> Demo build. Static site, no backend, no build step. Data persists locally in the browser (`localStorage`).

## What it does

- **Daily check-in → adaptive session.** Rate sleep, energy, legs, knees, motivation and stress. A readiness engine (knees and legs weighted heaviest) sets today's workout so there's nothing to think about. Sore knees automatically cap the day and swap to low-impact + rehab.
- **Today.** Your prescribed run + strength, warm-up, targets, and a coach note. One tap to log it.
- **Swap anytime.** Don't want to run? Switch to strength, rehab, cross-train, easy, or rest — flexibility keeps consistency.
- **Plan.** The full weekly structure: 5 run days, 2 rest, strength stacked on run days, progressive overload, knee rehab throughout.
- **Log.** Distance, time, pace, HR, RPE, mood, weather, and free-text notes (notes sit above the numbers).
- **Progress.** Weekly & all-time volume, average pace, longest run, a 7-day bar chart, and full session history.
- **Goals & events.** Add races as they come up — countdown and build progress adapt around them.

## Design

Deliberately not the generic "AI app" look. Warm paper, ink, a single clay-red accent, monospaced numbers — a training journal that happens to be smart. Optimised for one-handed phone use.

## Run locally

Just open `index.html` in a browser, or serve the folder:

```bash
npx serve .
```

## Deploy (Vercel)

No configuration required — it's a static site.

1. Import the GitHub repo at [vercel.com/new](https://vercel.com/new)
2. Framework preset: **Other** (leave build & output empty)
3. Deploy

`vercel.json` is included for clean URLs and sensible headers.

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell, header, bottom nav |
| `styles.css` | Full design system |
| `data.js` | Weekly plan, exercises, knee rehab, check-in config |
| `app.js` | State, readiness engine, all five tabs |
| `vercel.json` | Static hosting config |

## Roadmap

- Sync/backend (Supabase) for multi-device
- Auto-progression of weekly volume (+10%/wk cap)
- Export history to CSV
- Optional non-running trackers (the app is structured to extend)
