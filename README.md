# Kontinuando World Cup 2026 🏆

A single-file website (`index.html`) for the family sweepstake — no backend, no build step.

## How it works
- **48 teams, 8 players, 6 pools** ranked by real bookmaker odds (BetMGM via Yahoo Sports, June 2026).
  Everyone draws one team per pool, so each person owns 6 teams.
- **Scoring — "The Underdog Multiplier":** win 3 / draw 1 / goal 1 / clean sheet 2, +5 per knockout
  round reached, +10 for the champion, +3 for winning the third-place match — all multiplied by the
  team's pool: Giants ×1 · Contenders ×1.5 · Dark Horses ×2 · Outsiders ×3 · Long Shots ×4 · Miracle Workers ×5.
  Winning a penalty shootout counts as a win, but shootout goals don't score.
- All kick-off times are shown in **London time**.

## Running it
- Just open `index.html` in any browser (double-click), **or**
- Host it for the whole family: push this folder to GitHub and enable GitHub Pages — everyone gets a URL.

## Draw day
1. Open the site, enter the 8 names on **The Draw** tab.
2. Hit **Begin the Draw Ceremony** — teams reveal one by one with sound and confetti, ending with the Giants.
3. After the draw, click **Share / export draw** and paste the code into the family chat.
   Everyone else uses **Import a draw** on their device so all phones show the same squads.

## Keeping scores up to date
- The site refreshes itself: on every visit, every 10 minutes while open, and when you switch back
  to the tab. You can also click **🔄 Refresh results**. Results come from the free,
  public-domain [openfootball/worldcup.json](https://github.com/openfootball/worldcup.json) dataset:
  `https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json`
- If that dataset is ever a day behind, use **📋 Paste results JSON** on the Matches tab — paste the
  full `worldcup.json` contents. You can ask Claude:
  *"Fetch the latest World Cup 2026 results and give me the worldcup.json with scores filled in (openfootball format)"*
  and paste what it returns.

Draw, names and results are saved in the browser (localStorage), so the site remembers everything between visits.
