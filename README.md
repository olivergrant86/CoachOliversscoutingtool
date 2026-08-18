# Duncan Demon Diamond Analytics

A local, original scouting-app scaffold inspired by the general idea of
opponent-scouting software: paste raw game logs, get roster-free stats
matched by player name, and generate scouting reports — season
summaries, damage reports, spray charts, player cards, count-based
swing tendencies, and a pitching staff report. All data lives in your
browser (`localStorage`) — there's no backend, account system, or paid
tier here.

This is **not** a copy of any commercial product's code, data format,
UI, or backend — it's a from-scratch implementation of the concept.

## Running it

No build step needed — **but don't just double-click `index.html`.**
Opening it as a `file://` page makes some browsers (Chrome especially)
block `localStorage`, which used to make every button silently do
nothing. That's now handled gracefully (you'll see a warning banner
instead, and everything still works — it just won't remember data
between reloads). To get full persistence, serve the folder instead:

1. Open this folder in VS Code.
2. Install the **Live Server** extension, right-click `index.html`, and
   choose *Open with Live Server* — or run `python3 -m http.server` from
   inside the folder and visit `http://localhost:8000/`.
3. Add an opponent (top right), then paste a game log on the Import
   Game Log tab.

## Logo

The header looks for `img/logo.png`. Drop your own logo file there
(any reasonable image works) — if it's missing, the header just shows
the text with no image, no errors.

## How it works

1. **Add an opponent** — the top-right picker is your season bucket.
   Everything you import gets scoped to whichever opponent is selected.
2. **Paste a game log** on the Import Game Log tab. Team names
   (`Top`/`Bottom Nth - Team` lines) are auto-detected — you can
   override either one before parsing. Every player is matched by name,
   so there's no roster setup.
3. **Multiple games at once:** paste several games into the same box,
   separated by a line containing just `===`, and one click parses and
   adds all of them.
4. Reports build up across every game you've imported for that
   opponent — paste more games later and everything recalculates.

## Reports

All scoped to whichever opponent (and, where relevant, which team
within that opponent's games) you've selected via the Team filter:

- **Season Summary** — IQ profile badges (Contact, Damage, K-Prone,
  Bunt, Ground Ball, Fly Ball — earned against fixed thresholds, not
  ranked against teammates), GB%/FB% by field location with heat-mapped
  cells, counting stats.
- **Damage Report** — extra-base hits broken out by field position.
- **Spray Chart** — a combined dot chart for the whole team, or a
  zone-heat fan chart for one player at a time.
- **Player Card** — toggle between a Standard Card (defensive contact
  profile, discipline/pressure/small-ball stats, scouting snapshot) and
  a Development Plan (benchmark bar chart vs. general HS/travel-ball
  reference averages, batting + pitching).
- **Swing Decisions** — count-based tendencies: Quick Scout leaderboards
  (first-pitch attackers, two-strike swingers, best damage count, etc.),
  plus a full team and individual swing%/take%/XBH-by-count table.
- **Pitching Scout Report** — a full staff board: rotation/bullpen
  splits, ERA/WHIP/K-BB, workload detail, and a per-outing opponent
  breakdown. Requires a specific team selected (not "All Teams").

Every panel has its own **Print to PDF** button.

## Import Game Log format

This app expects raw, natural-language game logs — the kind common
scorekeeping apps export — in blocks like:

```
Strikeout
3 Outs
Strike 1 swinging, Foul, Ball 1, Ball 2, Strike 3 looking.
S Underwood strikes out looking, J Pineda pitching.
```

i.e. a play-type header line (`Strikeout`, `Single`, `Home Run`,
`Ground Out`, `Fly Out`, `Pop Out`, `Line Out`, `Walk`, `Hit By Pitch`,
`Error`, `Fielder's Choice`, `Double Play`, `Dropped 3rd Strike`,
`Sac Fly`, `Sac Bunt`), followed by count/score lines, then a narrative
sentence starting with the batter's name. Steals, runs scored, and
pitching changes are picked up anywhere in the block (e.g.
`C Brown steals 2nd`, `K Thornton scores`, `X in for pitcher Y`).

**Team detection.** `Top Nth - Team` / `Bottom Nth - Team` lines mark
inning boundaries and tell you who's batting: `Bottom` = home team,
`Top` = visiting team. The parser also auto-detects and corrects for
logs listed newest-inning-first instead of in true chronological order.

This is a heuristic parser tuned to a specific real-world log style —
exports vary, so any line it can't confidently read is skipped and
listed in the browser console rather than silently guessed at. If your
export looks meaningfully different, `js/gamelog-parser.js` is the
place to adjust the regular expressions.

## Where to take this next

- Swap `localStorage` for a real backend (e.g. a small Node/Express +
  SQLite or Postgres API) if you want multi-device / multi-coach access.
- Add authentication if more than one person needs to log in.
- Generate real PDF exports (e.g. with a library like `pdf-lib` or
  `jsPDF`) instead of relying on the browser's print-to-PDF window.
- Tune the Player Development Plan's benchmark averages to your own
  level of competition — they're general reference points, not
  calibrated to any specific league.

## Project structure

```
├── index.html               UI shell, all tabs/panels
├── css/style.css             styling
├── img/                       drop your logo.png here
├── js/storage.js             localStorage load/save, opponent model
├── js/gamelog-parser.js      game log parser + all stat aggregation
├── js/reports.js             every report's rendering logic
└── js/app.js                 event wiring, state, top-level render loop
```
