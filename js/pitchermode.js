/* pitchermode.js — Pitcher Mode: chart the opponent's pitcher live while WE hit.
 *
 * One tap per pitch (Ball, Called Strike, Swing & Miss, Foul, In Play, HBP). The count runs
 * itself, the batting-order spot moves on when an at-bat ends, and the screen compares what
 * the pitcher is doing TODAY with his SEASON numbers from the GameChanger games you imported.
 *
 * The live log is saved on THIS device only (localStorage), the same way Game Day works, and
 * it is never mixed into the season stats — so importing the same game from GameChanger later
 * can't double-count anything. The one thing that goes to the cloud is the optional
 * "Save today's line to his notes", which adds an ordinary dated note on the pitcher.
 *
 * This file is data logic + HTML strings; app.js does the wiring. Every global here starts
 * with pm/PM_ so it can't collide with the other script files.
 */

const PM_MAX_HISTORY = 80;      // how many taps Undo can back out
const PM_MIN_SAMPLE = 15;       // pitches before today's numbers are trusted
const PM_PCT_GAP = 8;           // points away from his season number to call him OFF / SHARP
const PM_PPB_GAP = 0.6;         // same idea for pitches per batter

const PM_PITCHES = [
  { code: "B",   label: "Ball",          cls: "ball" },
  { code: "CS",  label: "Called Strike", cls: "strike" },
  { code: "SS",  label: "Swing & Miss",  cls: "strike" },
  { code: "F",   label: "Foul",          cls: "neutral" },
  { code: "IP",  label: "In Play",       cls: "neutral" },
  { code: "HBP", label: "HBP",           cls: "neutral" },
];
const PM_LABEL = { B: "Ball", CS: "Called strike", SS: "Swing and miss", F: "Foul", IP: "In play", HBP: "Hit by pitch" };

function pmEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function pmPct(a, b) { return b ? Math.round((a / b) * 100) : null; }
function pmOrdinal(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function pmIsStrike(c) { return c === "CS" || c === "SS" || c === "F" || c === "IP"; }
function pmIsSwing(c) { return c === "SS" || c === "F" || c === "IP"; }

/* ===================== live state ===================== */

function pmNewState() {
  return { v: 1, pitchers: [], cur: -1, inning: 1, balls: 0, strikes: 0, spot: 1, spots: 9, last: "", history: [] };
}

function pmSanitizeState(raw) {
  const s = pmNewState();
  if (!raw || typeof raw !== "object") return s;
  if (Array.isArray(raw.pitchers)) {
    s.pitchers = raw.pitchers
      .filter(p => p && typeof p.name === "string" && p.name.trim())
      .map(p => ({
        name: p.name.trim(),
        pk: Number.isFinite(p.pk) ? p.pk : 0,
        log: Array.isArray(p.log) ? p.log.filter(x => x && PM_LABEL[x.c]) : [],
      }));
  }
  const int = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);
  s.spots = int(raw.spots, 1, 15, 9);
  s.cur = int(raw.cur, -1, s.pitchers.length - 1, s.pitchers.length ? 0 : -1);
  s.inning = int(raw.inning, 1, 30, 1);
  s.balls = int(raw.balls, 0, 3, 0);
  s.strikes = int(raw.strikes, 0, 2, 0);
  s.spot = int(raw.spot, 1, s.spots, 1);
  s.last = typeof raw.last === "string" ? raw.last : "";
  s.history = Array.isArray(raw.history) ? raw.history.filter(h => typeof h === "string").slice(-PM_MAX_HISTORY) : [];
  return s;
}

function pmSnapshot(st) {
  const copy = Object.assign({}, st);
  delete copy.history;
  return JSON.stringify(copy);
}

function pmRemember(st) {
  st.history.push(pmSnapshot(st));
  if (st.history.length > PM_MAX_HISTORY) st.history.splice(0, st.history.length - PM_MAX_HISTORY);
}

function pmUndo(st) {
  if (!st.history.length) return false;
  const prev = JSON.parse(st.history.pop());
  const keep = st.history;
  Object.keys(st).forEach(k => { delete st[k]; });
  Object.assign(st, pmSanitizeState(prev));
  st.history = keep;
  return true;
}

function pmCurrent(st) { return st.cur >= 0 ? st.pitchers[st.cur] || null : null; }

// Brings a pitcher in (or back in). A change mid at-bat keeps the count, like real life.
function pmStartPitcher(st, name) {
  const who = String(name || "").trim();
  if (!who) return false;
  pmRemember(st);
  let i = st.pitchers.findIndex(p => p.name.toLowerCase() === who.toLowerCase());
  if (i === -1) { st.pitchers.push({ name: who, pk: 0, log: [] }); i = st.pitchers.length - 1; }
  st.cur = i;
  st.last = `${st.pitchers[i].name} is pitching`;
  return true;
}

function pmAdvanceSpot(st) { st.spot = (st.spot % st.spots) + 1; }

function pmLogPitch(st, code) {
  const p = pmCurrent(st);
  if (!p || !PM_LABEL[code]) return false;
  pmRemember(st);
  const rec = { c: code, b: st.balls, s: st.strikes, i: st.inning, sp: st.spot };
  let end = false, label = PM_LABEL[code];
  if (code === "B") { st.balls++; if (st.balls >= 4) { end = true; label = "Ball four — walk"; } }
  else if (code === "CS" || code === "SS") { st.strikes++; if (st.strikes >= 3) { end = true; label = code === "CS" ? "Strikeout looking" : "Strikeout swinging"; } }
  else if (code === "F") { if (st.strikes < 2) st.strikes++; }
  else if (code === "IP" || code === "HBP") { end = true; }
  if (end) { rec.e = 1; st.balls = 0; st.strikes = 0; pmAdvanceSpot(st); label += " — next hitter up"; }
  p.log.push(rec);
  st.last = label;
  return true;
}

function pmPickoff(st) {
  const p = pmCurrent(st);
  if (!p) return false;
  pmRemember(st);
  p.pk++;
  st.last = "Pickoff throw (not a pitch)";
  return true;
}

function pmNextInning(st) {
  pmRemember(st);
  st.inning++; st.balls = 0; st.strikes = 0;
  st.last = `Inning ${st.inning} started`;
}

function pmMoveSpot(st, delta) {
  pmRemember(st);
  st.spot = ((st.spot - 1 + delta + st.spots) % st.spots) + 1;
  st.balls = 0; st.strikes = 0;
  st.last = `Fixed: our ${pmOrdinal(st.spot)} hitter is up`;
}

function pmNewGame(st) {
  const spots = st.spots;
  Object.keys(st).forEach(k => { delete st[k]; });
  Object.assign(st, pmNewState(), { spots });
}

/* ===================== numbers ===================== */

// Today's line for one pitcher, from the live log.
function pmTodayStats(p) {
  const log = (p && p.log) || [];
  const t = { pitches: log.length, strikes: 0, fpTotal: 0, fpStrikes: 0, behindTotal: 0, behindBalls: 0, swings: 0, whiffs: 0, bf: 0, pk: (p && p.pk) || 0, innings: {} };
  log.forEach(r => {
    const k = pmIsStrike(r.c);
    if (k) t.strikes++;
    if (r.b === 0 && r.s === 0) { t.fpTotal++; if (k) t.fpStrikes++; }
    if (r.b > r.s) { t.behindTotal++; if (!k) t.behindBalls++; }
    if (pmIsSwing(r.c)) { t.swings++; if (r.c === "SS") t.whiffs++; }
    if (r.e) t.bf++;
    const inn = t.innings[r.i] || (t.innings[r.i] = { s: 0, b: 0 });
    if (k) inn.s++; else inn.b++;
  });
  const strikeRate = list => pmPct(list.filter(r => pmIsStrike(r.c)).length, list.length);
  t.strikePct = pmPct(t.strikes, t.pitches);
  t.fpPct = pmPct(t.fpStrikes, t.fpTotal);
  t.behindPct = pmPct(t.behindBalls, t.behindTotal);
  t.whiffPct = pmPct(t.whiffs, t.swings);
  t.ppb = t.bf ? t.pitches / t.bf : null;
  t.last15 = log.length >= PM_MIN_SAMPLE * 2 ? strikeRate(log.slice(-PM_MIN_SAMPLE)) : null;
  t.first15 = log.length >= PM_MIN_SAMPLE * 2 ? strikeRate(log.slice(0, PM_MIN_SAMPLE)) : null;
  return t;
}

// Every pitcher the imported games show for this team: [{ name, pitches, games }], busiest first.
function pmKnownPitchers(gameLogs, team) {
  const map = {};
  (gameLogs || []).forEach(g => {
    const seen = new Set();
    (g.events || []).forEach(e => {
      if (e.pitcherTeam !== team || !e.pitcher) return;
      const m = map[e.pitcher] || (map[e.pitcher] = { name: e.pitcher, pitches: 0, games: 0 });
      m.pitches += (e.pitches || []).length;
      if (!seen.has(e.pitcher)) { seen.add(e.pitcher); m.games++; }
    });
  });
  return Object.values(map).sort((a, b) => b.pitches - a.pitches);
}

function pmMedian(nums) {
  if (!nums.length) return null;
  const s = nums.slice().sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

// His season numbers from the imported GameChanger games (never from today's live log).
function pmSeasonProfile(gameLogs, team, name) {
  const who = String(name || "").trim().toLowerCase();
  const t = { pitches: 0, strikes: 0, fpTotal: 0, fpStrikes: 0, behindTotal: 0, behindBalls: 0, swings: 0, whiffs: 0, bf: 0, games: 0, starts: 0 };
  const startCounts = [], allCounts = [];
  (gameLogs || []).forEach(g => {
    const teamEvents = (g.events || []).filter(e => e.pitcherTeam === team && e.pitcher);
    const mine = teamEvents.filter(e => e.pitcher.trim().toLowerCase() === who);
    if (!mine.length) return;
    let gamePitches = 0;
    mine.forEach(e => {
      t.bf++;
      (e.pitches || []).forEach((p, idx) => {
        gamePitches++;
        const k = p.type !== "ball";
        if (k) t.strikes++;
        if (idx === 0) { t.fpTotal++; if (k) t.fpStrikes++; }
        const parts = String(p.countBefore || "").split("-").map(Number);
        if (parts.length === 2 && parts[0] > parts[1]) { t.behindTotal++; if (!k) t.behindBalls++; }
        if (p.swing) { t.swings++; if (p.type === "strike_swinging") t.whiffs++; }
      });
    });
    t.pitches += gamePitches;
    t.games++;
    const started = teamEvents[0].pitcher.trim().toLowerCase() === who;
    if (started) t.starts++;
    if (gamePitches >= 25) { allCounts.push(gamePitches); if (started) startCounts.push(gamePitches); }
  });
  if (!t.pitches) return null;
  t.strikePct = pmPct(t.strikes, t.pitches);
  t.fpPct = pmPct(t.fpStrikes, t.fpTotal);
  t.behindPct = pmPct(t.behindBalls, t.behindTotal);
  t.whiffPct = pmPct(t.whiffs, t.swings);
  t.ppb = t.bf ? t.pitches / t.bf : null;
  t.usualExit = pmMedian(startCounts.length ? startCounts : allCounts);
  t.usualExitFrom = startCounts.length ? `${startCounts.length} start${startCounts.length === 1 ? "" : "s"}` : (allCounts.length ? `${allCounts.length} outing${allCounts.length === 1 ? "" : "s"}` : "");
  return t;
}

// The plain-English calls for our hitters, most important first.
function pmAdvice(today, season) {
  if (today.pitches < PM_MIN_SAMPLE) return [`Too early to call — ${today.pitches} pitch${today.pitches === 1 ? "" : "es"} so far. Let him throw a few.`];
  const out = [];
  const normStrike = season && season.strikePct != null ? season.strikePct : 60;
  if (today.strikePct <= normStrike - PM_PCT_GAP || (!season && today.strikePct < 55)) {
    out.push(`Take until he throws a strike — he's at ${today.strikePct}% strikes today${season ? ` vs. ${season.strikePct}% normally` : ""}.`);
  }
  if (today.fpTotal >= 5 && today.fpPct >= 70) out.push(`Ambush the first pitch — ${today.fpPct}% of first pitches are strikes today. He's grooving it to get ahead.`);
  else if (today.fpTotal >= 5 && today.fpPct <= 40 && !out.length) out.push(`He's starting hitters 1-0 — take the first pitch until he proves he can land it.`);
  if (today.behindTotal >= 8 && today.behindPct >= 55) out.push(`Once he's behind, make him come to you — take on 2-0 and 3-1 (${today.behindPct}% balls when behind).`);
  if (season && season.usualExit && today.pitches >= season.usualExit - 10) {
    out.push(`He's at ${today.pitches} — he usually comes out around ${season.usualExit}. Work counts and make him throw.`);
  } else if (today.last15 != null && today.first15 != null && today.last15 <= today.first15 - 12) {
    out.push(`He's tiring — only ${today.last15}% strikes over his last 15 pitches (${today.first15}% over his first 15).`);
  }
  if (season && today.swings >= 10 && today.whiffPct >= season.whiffPct + PM_PCT_GAP) {
    out.push(`His stuff is missing bats today (${today.whiffPct}% whiffs) — shorten up with two strikes.`);
  }
  if (!out.length) out.push("He's in his normal range today — hitters' choice.");
  return out.slice(0, 3);
}

/* ===================== rendering ===================== */

function pmFmtPct(v) { return v == null ? "—" : `${v}%`; }
function pmFmtPpb(v) { return v == null ? "—" : v.toFixed(1); }

// diffForUs > 0 means "worse for the pitcher than normal".
function pmTile(label, todayTxt, seasonTxt, diffForUs, gap, faded) {
  let cls = "", tag = "";
  if (!faded && diffForUs != null) {
    if (diffForUs >= gap) { cls = " off"; tag = "OFF TODAY"; }
    else if (-diffForUs >= gap) { cls = " sharp"; tag = "SHARP TODAY"; }
  }
  return `
    <div class="pm-tile${cls}${faded ? " faded" : ""}">
      <div class="pm-tile-l">${pmEsc(label)}</div>
      <div class="pm-tile-v">${pmEsc(todayTxt)}</div>
      <div class="pm-tile-s">${pmEsc(seasonTxt)}</div>
      <div class="pm-tile-tag">${tag || "&nbsp;"}</div>
    </div>`;
}

function pmRenderTiles(today, season) {
  const faded = today.pitches < PM_MIN_SAMPLE;
  const d = (t, s, higherIsBetterForHim) => (t == null || s == null ? null : (higherIsBetterForHim ? s - t : t - s));
  const sv = k => (season ? season[k] : null);
  return [
    pmTile("STRIKE %", pmFmtPct(today.strikePct), "season " + pmFmtPct(sv("strikePct")), d(today.strikePct, sv("strikePct"), true), PM_PCT_GAP, faded),
    pmTile("1ST-PITCH STRIKE %", pmFmtPct(today.fpPct), "season " + pmFmtPct(sv("fpPct")), d(today.fpPct, sv("fpPct"), true), PM_PCT_GAP, faded),
    pmTile("BALL % WHEN BEHIND", pmFmtPct(today.behindPct), "season " + pmFmtPct(sv("behindPct")), d(today.behindPct, sv("behindPct"), false), PM_PCT_GAP, faded),
    pmTile("WHIFF %", pmFmtPct(today.whiffPct), "season " + pmFmtPct(sv("whiffPct")), d(today.whiffPct, sv("whiffPct"), true), PM_PCT_GAP, faded),
    pmTile("PITCHES / BATTER", pmFmtPpb(today.ppb), "season " + pmFmtPpb(sv("ppb")), d(today.ppb, sv("ppb"), false), PM_PPB_GAP, faded),
    pmTile("LAST 15 STRIKE %", pmFmtPct(today.last15), today.first15 == null ? "first 15: —" : `first 15: ${today.first15}%`, d(today.last15, today.first15, true), 12, today.last15 == null),
  ].join("");
}

function pmRenderInnings(today, st) {
  const keys = Object.keys(today.innings).map(Number);
  if (!keys.includes(st.inning)) keys.push(st.inning);
  keys.sort((a, b) => a - b);
  const maxP = Math.max(15, ...keys.map(k => { const x = today.innings[k]; return x ? x.s + x.b : 0; }));
  const H = 64;
  const bars = keys.map(k => {
    const x = today.innings[k] || { s: 0, b: 0 }, tot = x.s + x.b, cur = k === st.inning;
    return `
      <div class="pm-inn${cur ? " cur" : ""}">
        <div class="pm-inn-pct">${tot ? `${pmPct(x.s, tot)}%` : "—"}</div>
        <div class="pm-inn-bar" style="height:${H}px;" title="${x.s} strikes, ${x.b} balls">
          <div class="pm-inn-b" style="height:${Math.round((x.b / maxP) * H)}px;"></div>
          <div class="pm-inn-s" style="height:${Math.round((x.s / maxP) * H)}px;"></div>
        </div>
        <div class="pm-inn-l">${k}${cur ? " ●" : ""}</div>
        <div class="pm-inn-n">${tot}p</div>
      </div>`;
  }).join("");
  return `
    <div class="pm-box">
      <div class="gd-section-label pm-row-between"><span>STRIKES vs. BALLS BY INNING</span><span>${today.pk} pickoff throw${today.pk === 1 ? "" : "s"}</span></div>
      <div class="pm-inns">${bars}</div>
      <div class="pm-legend"><span><i class="pm-key s"></i>strikes</span><span><i class="pm-key b"></i>balls</span></div>
    </div>`;
}

function pmRenderChooser(ctx, st, ui) {
  const used = new Set(st.pitchers.map(p => p.name.toLowerCase()));
  const chips = ctx.known.length
    ? ctx.known.map(k => `<button class="gd-chip" data-pm="start" data-name="${pmEsc(k.name)}">${pmEsc(k.name)}<small>${k.games} G · ${k.pitches} pitches${used.has(k.name.toLowerCase()) ? " · pitched today" : ""}</small></button>`).join("")
    : `<span class="hint">No pitchers found for ${pmEsc(ctx.team)} in the games you've imported. Type his name below.</span>`;
  return `
    <div class="pm-chooser">
      <h3 style="margin:0 0 4px;">Who's pitching for ${pmEsc(ctx.team)}?</h3>
      <p class="hint" style="margin:0 0 10px;">Tap a pitcher from the imported games to compare him with his season numbers, or type a name.</p>
      <div class="gd-chips">${chips}</div>
      <div class="pm-typed">
        <input type="text" id="pmNameInput" list="pmPitcherList" placeholder="Pitcher name (e.g. J Carter)" autocomplete="off" />
        <datalist id="pmPitcherList">${ctx.known.map(k => `<option value="${pmEsc(k.name)}"></option>`).join("")}</datalist>
        <button class="gd-btn primary" data-pm="start-typed">Start</button>
      </div>
      ${st.cur >= 0 ? `<div class="gd-row"><button class="gd-btn" data-pm="cancel-choose">Back to ${pmEsc(pmCurrent(st).name)}</button></div>` : ""}
    </div>`;
}

// ctx: { oppId, team, gameLogs, known: [...], notes: opp.playerNotes }
// ui:  { choosing, msg, saving, saveMsg }
function pmRenderPanel(ctx, st, ui) {
  const msg = ui.msg ? `<div class="gd-msg">${pmEsc(ui.msg)}</div>` : "";
  const p = pmCurrent(st);
  if (ui.choosing || !p) return `<div class="gd-root">${msg}${pmRenderChooser(ctx, st, ui)}</div>`;

  const today = pmTodayStats(p);
  const season = pmSeasonProfile(ctx.gameLogs, ctx.team, p.name);
  const advice = pmAdvice(today, season);

  const sub = season
    ? (season.usualExit ? `Season: ${season.pitches} pitches in ${season.games} G · usually comes out around ${season.usualExit} (${season.usualExitFrom})` : `Season: ${season.pitches} pitches in ${season.games} G`)
    : "No imported games for him — today's numbers only";

  const strip = st.pitchers.length > 1
    ? `<div class="pm-pstrip">${st.pitchers.map((x, i) => `<button class="pm-pchip${i === st.cur ? " current" : ""}" data-pm="switch" data-i="${i}">${pmEsc(x.name)}<small>${x.log.length} pitches</small></button>`).join("")}</div>`
    : "";

  const notes = ctx.notes ? pnEntriesFor(ctx.notes, ctx.team, p.name) : [];
  const notesBox = notes.length
    ? `<details class="pm-box pm-notes"><summary>MY NOTES ON HIM (${notes.length})</summary>${notes.slice(0, 5).map(e => `<div class="gd-mynote"><div class="gd-mynote-date">${pmEsc(pnFormatDate(e.at))}</div><div class="gd-mynote-text">${pmEsc(e.text)}</div></div>`).join("")}</details>`
    : "";

  const save = `
    <div class="pm-save">
      <button class="gd-btn" data-pm="save-notes"${ui.saving || !today.pitches ? " disabled" : ""}>Save today's line to ${pmEsc(p.name)}'s notes</button>
      ${ui.saveMsg ? `<span class="pm-savemsg">${pmEsc(ui.saveMsg)}</span>` : ""}
    </div>`;

  const pad = PM_PITCHES.map(x => `<button class="pm-res ${x.cls}" data-pm="pitch" data-code="${x.code}">${x.label}</button>`).join("");

  return `
    <div class="gd-root">
      ${msg}
      ${strip}
      <div class="gd-card">
        <div class="gd-card-head">
          <div style="min-width:0;">
            <div class="gd-batting">PITCHER MODE · INNING ${st.inning}</div>
            <div class="gd-name">${pmEsc(p.name)}</div>
            <div class="pm-sub">${pmEsc(sub)}</div>
          </div>
          <div class="pm-count-badge"><div class="pm-count-n">${today.pitches}</div><div class="pm-count-l">PITCHES</div></div>
        </div>
        <div class="pm-countbar">
          <div class="pm-spot">
            <button class="gd-btn small" data-pm="spot-prev" aria-label="Previous hitter">◀</button>
            <div><div class="pm-spot-l">OUR HITTER UP</div><div class="pm-spot-v">${pmOrdinal(st.spot)} in the order</div></div>
            <button class="gd-btn small" data-pm="spot-next" aria-label="Next hitter">▶</button>
          </div>
          <div class="pm-count"><span class="pm-count-bs">${st.balls}-${st.strikes}</span><span class="pm-count-cl">COUNT</span></div>
        </div>
        <div class="pm-last">${st.last ? pmEsc(st.last) : "&nbsp;"}</div>
        <div class="gd-body">
          <div class="pm-advice">
            <div class="gd-section-label pm-advice-l">TELL YOUR HITTERS</div>
            ${advice.map(a => `<div class="pm-advice-t">${pmEsc(a)}</div>`).join("")}
          </div>
          <div class="gd-section-label pm-row-between"><span>TODAY vs. SEASON</span><span>${today.pitches < PM_MIN_SAMPLE ? "small sample — numbers firm up at 15 pitches" : `${today.pitches} pitches · ${today.bf} batters`}</span></div>
          <div class="pm-tiles">${pmRenderTiles(today, season)}</div>
          ${pmRenderInnings(today, st)}
          ${notesBox}
          ${save}
        </div>
      </div>
      <div class="gd-actionbar">
        <div class="gd-actionhead">
          <span>Pitch to our <strong>${pmOrdinal(st.spot)}</strong> hitter <em>· ${st.balls}-${st.strikes}</em></span>
          <span class="pm-headbtns">
            <button class="gd-btn small" data-pm="pickoff">Pickoff</button>
            <button class="gd-btn small" data-pm="undo">Undo Last</button>
          </span>
        </div>
        <div class="pm-res-grid">${pad}</div>
      </div>
    </div>`;
}

function pmRenderActions(st, ui) {
  const hasPitcher = !!pmCurrent(st);
  return `
    ${hasPitcher && !ui.choosing ? `<button class="gd-btn small" data-pm="choose">New Pitcher</button><button class="gd-btn small" data-pm="next-inning">Next Inning</button>` : ""}
    <button class="gd-btn small danger" data-pm="new-game">New Game</button>`;
}

// The note text saved on the pitcher.
function pmSummaryText(p, st, gameLogs, team) {
  const t = pmTodayStats(p);
  const s = pmSeasonProfile(gameLogs, team, p.name);
  const inns = Object.keys(t.innings).map(Number).sort((a, b) => a - b);
  const vs = (v, k, f) => (s && s[k] != null ? ` (season ${f(s[k])})` : "");
  const pct = v => (v == null ? "—" : `${v}%`);
  const lines = [
    `Pitcher Mode vs. us: ${t.pitches} pitches to ${t.bf} batters${inns.length ? `, innings ${inns[0]}${inns.length > 1 ? `–${inns[inns.length - 1]}` : ""}` : ""}.`,
    `Strike %: ${pct(t.strikePct)}${vs(t.strikePct, "strikePct", pct)} · 1st-pitch strike %: ${pct(t.fpPct)}${vs(t.fpPct, "fpPct", pct)}`,
    `Ball % when behind: ${pct(t.behindPct)}${vs(t.behindPct, "behindPct", pct)} · Whiff %: ${pct(t.whiffPct)}${vs(t.whiffPct, "whiffPct", pct)}`,
    `Pitches/batter: ${pmFmtPpb(t.ppb)}${vs(t.ppb, "ppb", pmFmtPpb)} · Pickoff throws: ${t.pk}`,
  ];
  if (inns.length) lines.push("By inning: " + inns.map(k => { const x = t.innings[k]; return `${k}: ${x.s + x.b}p ${pmPct(x.s, x.s + x.b)}% strikes`; }).join(" · "));
  return lines.join("\n");
}
