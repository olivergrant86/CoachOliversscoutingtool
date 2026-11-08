/* gameday.js — Game Day mode: a live, iPad-friendly batter view.
 *
 * You pick a team, set their batting order, and as each hitter comes up the
 * screen shows that hitter's scouting numbers (slash line, approach notes,
 * spray chart, count-by-count swing table, steal tendencies). Results can be
 * logged live; those go into a separate Game Day log for the game in front of
 * you and are NOT mixed into the season stats the rest of the app calculates.
 *
 * Everything here is split in two halves on purpose:
 *   1. Plain state logic (gd... functions) — lineup, who's up, the log. No DOM.
 *   2. Rendering (gdRender... functions) — returns HTML strings.
 * app.js owns the DOM wiring and saving. Names all start with gd/GD_ so they
 * can't collide with the other script files, which share one global scope.
 */

const GD_MIN_SLOTS = 9;
const GD_MAX_SLOTS = 12;

// group drives button color; ball = true means a location question follows.
// The ORDER matters: the button grid is 5 across, so each row of five reads as a group —
// row 1 hits + walk, row 2 strikeouts and outs, row 3 the leftovers.
const GD_RESULTS = [
  { code: "1B", label: "Single", short: "1B", group: "hit", ball: true },
  { code: "2B", label: "Double", short: "2B", group: "hit", ball: true },
  { code: "3B", label: "Triple", short: "3B", group: "hit", ball: true },
  { code: "HR", label: "Home Run", short: "HR", group: "hit", ball: true },
  { code: "BB", label: "Walk", short: "BB", group: "reach", ball: false },
  { code: "Ks", label: "K Swinging", short: "K", group: "out", ball: false },
  { code: "Kl", label: "K Looking", short: "K-L", group: "out", ball: false },
  { code: "GO", label: "Ground Out", short: "GO", group: "out", ball: true },
  { code: "FO", label: "Fly Out", short: "FO", group: "out", ball: true },
  { code: "LO", label: "Line Out", short: "LO", group: "out", ball: true },
  { code: "PO", label: "Pop Out", short: "PO", group: "out", ball: true },
  { code: "HBP", label: "Hit By Pitch", short: "HBP", group: "reach", ball: false },
  { code: "ROE", label: "Reached on Error", short: "ROE", group: "other", ball: true },
  { code: "FC", label: "Fielder's Choice", short: "FC", group: "other", ball: true },
  { code: "SAC", label: "Sacrifice", short: "SAC", group: "other", ball: true },
];
const GD_RESULT_BY_CODE = {};
GD_RESULTS.forEach(r => { GD_RESULT_BY_CODE[r.code] = r; });

const GD_LOCATIONS = ["LF", "CF", "RF", "3B", "SS", "2B", "1B", "P"];
const GD_HIT_CODES = new Set(["1B", "2B", "3B", "HR"]);
const GD_NOT_AT_BAT_CODES = new Set(["BB", "HBP", "SAC"]);

function gdEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function gdOrdinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return n + "th";
  return n + (["th", "st", "nd", "rd"][n % 10] || "th");
}

/* ===================== 1. State logic ===================== */

function gdNewState() {
  return { lineup: new Array(GD_MIN_SLOTS).fill(""), current: 0, log: [] };
}

// Turns whatever came back from storage into a safe, well-formed state — a
// hand-edited or older save should never be able to crash the screen.
function gdSanitizeState(raw) {
  const s = gdNewState();
  if (!raw || typeof raw !== "object") return s;
  if (Array.isArray(raw.lineup)) {
    const names = raw.lineup.slice(0, GD_MAX_SLOTS).map(n => (typeof n === "string" ? n : ""));
    while (names.length < GD_MIN_SLOTS) names.push("");
    s.lineup = names;
  }
  if (Array.isArray(raw.log)) {
    s.log = raw.log
      .filter(e => e && typeof e.name === "string" && GD_RESULT_BY_CODE[e.code])
      .map((e, i) => ({
        n: i + 1,
        slot: Number.isInteger(e.slot) && e.slot >= 0 ? e.slot : 0,
        name: e.name,
        code: e.code,
        loc: GD_LOCATIONS.includes(e.loc) ? e.loc : null,
        at: typeof e.at === "string" ? e.at : "",
      }));
  }
  s.current = Number.isInteger(raw.current) && raw.current >= 0 && raw.current < s.lineup.length ? raw.current : 0;
  return s;
}

function gdHasLineup(state) {
  return state.lineup.some(n => n.trim());
}

// Moves to the next (dir = 1) or previous (dir = -1) lineup spot that has a
// name in it, wrapping around — empty spots are skipped, not stopped on.
function gdStep(state, dir) {
  const n = state.lineup.length;
  for (let k = 1; k <= n; k++) {
    const idx = (((state.current + dir * k) % n) + n) % n;
    if (state.lineup[idx].trim()) { state.current = idx; return idx; }
  }
  return state.current;
}

function gdSetCurrent(state, idx) {
  if (Number.isInteger(idx) && idx >= 0 && idx < state.lineup.length) state.current = idx;
  return state.current;
}

// If "who's up" points at an empty spot (e.g. after clearing a name), hop to the first filled one.
function gdEnsureCurrentFilled(state) {
  if (state.lineup[state.current] && state.lineup[state.current].trim()) return;
  const first = state.lineup.findIndex(n => n.trim());
  state.current = first === -1 ? 0 : first;
}

function gdSetSlotName(state, idx, name) {
  if (!Number.isInteger(idx) || idx < 0 || idx >= state.lineup.length) return false;
  state.lineup[idx] = String(name || "").trim();
  return true;
}

// Drops a name into the first empty spot. Returns the spot index, or -1 if the
// player is already in the lineup or there's no empty spot left.
function gdPlaceInLineup(state, name) {
  const clean = String(name || "").trim();
  if (!clean) return -1;
  if (state.lineup.some(n => n.trim().toLowerCase() === clean.toLowerCase())) return -1;
  const idx = state.lineup.findIndex(n => !n.trim());
  if (idx === -1) return -1;
  state.lineup[idx] = clean;
  return idx;
}

function gdAddSlot(state) {
  if (state.lineup.length >= GD_MAX_SLOTS) return false;
  state.lineup.push("");
  return true;
}

function gdRemoveSlot(state) {
  if (state.lineup.length <= GD_MIN_SLOTS) return false;
  state.lineup.pop();
  if (state.current >= state.lineup.length) state.current = 0;
  return true;
}

// Records the current batter's result, then moves on to the next hitter.
function gdLogResult(state, code, loc, nowIso) {
  const result = GD_RESULT_BY_CODE[code];
  const name = (state.lineup[state.current] || "").trim();
  if (!result || !name) return null;
  const entry = {
    n: state.log.length + 1,
    slot: state.current,
    name,
    code,
    loc: result.ball && GD_LOCATIONS.includes(loc) ? loc : null,
    at: nowIso || new Date().toISOString(),
  };
  state.log.push(entry);
  gdStep(state, 1);
  return entry;
}

// Removes the last logged result and puts that hitter back on deck.
function gdUndo(state) {
  const entry = state.log.pop();
  if (!entry) return null;
  state.current = Math.min(entry.slot, state.lineup.length - 1);
  return entry;
}

function gdNewGame(state) {
  state.log = [];
  state.current = 0;
  gdEnsureCurrentFilled(state);
}

function gdShortResult(entry) {
  const r = GD_RESULT_BY_CODE[entry.code];
  return (r ? r.short : entry.code) + (entry.loc ? ` (${entry.loc})` : "");
}

// A hitter's line for the game so far: AB/H plus everything he's done, in order.
function gdTodayLine(state, name) {
  const key = String(name || "").trim().toLowerCase();
  const entries = state.log.filter(e => e.name.trim().toLowerCase() === key);
  let ab = 0, h = 0, bb = 0, hbp = 0, sac = 0;
  entries.forEach(e => {
    if (!GD_NOT_AT_BAT_CODES.has(e.code)) ab++;
    if (GD_HIT_CODES.has(e.code)) h++;
    if (e.code === "BB") bb++;
    if (e.code === "HBP") hbp++;
    if (e.code === "SAC") sac++;
  });
  let text = "";
  if (entries.length) {
    text = `${h}-for-${ab}`;
    if (bb) text += `, ${bb} BB`;
    if (hbp) text += `, ${hbp} HBP`;
    if (sac) text += `, ${sac} SAC`;
  }
  return { entries, ab, h, pa: entries.length, text };
}

function gdLogText(state, team) {
  const lines = [`${team} — Game Day log`, ""];
  state.log.forEach(e => {
    const r = GD_RESULT_BY_CODE[e.code];
    lines.push(`${e.n}. ${e.name} — ${r ? r.label : e.code}${e.loc ? ` (${e.loc})` : ""}`);
  });
  if (!state.log.length) lines.push("(nothing logged yet)");
  return lines.join("\n");
}

/* ===================== 2. Batter profile ===================== */

function gdLookup(map, name) {
  if (!map) return null;
  if (map[name]) return map[name];
  const lower = String(name || "").trim().toLowerCase();
  const key = Object.keys(map).find(k => k.trim().toLowerCase() === lower);
  return key ? map[key] : null;
}

// Everything the batter card shows, computed from the season totals plus that
// hitter's own events and steals. Approach notes use fixed thresholds and a
// minimum sample size — below it, the note is simply left out rather than guessed.
function gdBatterProfile(t, events, steals) {
  if (!t) return null;
  const bat = computeBattingMetrics(t);
  const pa = t.PA || 0;
  const pct = (n, d) => (d ? (n / d) * 100 : null);
  const pc = t.pitchCounts || {};

  const sumCounts = keys => {
    let total = 0, swings = 0;
    keys.forEach(k => { if (pc[k]) { total += pc[k].total; swings += pc[k].swings; } });
    return { total, swingPct: total ? (swings / total) * 100 : null };
  };
  const firstPitch = sumCounts(["0-0"]);
  const twoStrike = sumCounts(["0-2", "1-2", "2-2", "3-2"]);
  const ahead = sumCounts(["1-0", "2-0", "2-1", "3-1"]); // 3-0 left out — nearly always an automatic take

  let swings = 0, whiffs = 0;
  (events || []).forEach(e => (e.pitches || []).forEach(p => {
    if (p.swing) { swings++; if (p.type === "strike_swinging") whiffs++; }
  }));
  const whiffPct = pct(whiffs, swings);

  const sb = t.SB || 0, cs = t.CS || 0, pik = t.PIK || 0;
  const byStrikes = [0, 0, 0];
  let timed = 0;
  (steals || []).forEach(s => {
    if (s.type !== "SB" || s.count == null) return;
    const k = parseInt(String(s.count).split("-")[1], 10);
    if (k >= 0 && k <= 2) { byStrikes[k]++; timed++; }
  });

  const kPct = pct(t.K || 0, pa);
  const bbPct = pct(t.BB || 0, pa);
  const xbhOfHits = pct(t.XBH || 0, t.H || 0);
  const qabPct = pct(t.qab || 0, pa);

  const notes = [];
  const r0 = v => Math.round(v);

  if (firstPitch.total >= 10) {
    const p = r0(firstPitch.swingPct);
    if (p >= 40) notes.push(`Attacks the first pitch — swings ${p}% of the time at 0-0.`);
    else if (p <= 25) notes.push(`Usually takes the first pitch — swings only ${p}% at 0-0.`);
    else notes.push(`Mixed on the first pitch — swings ${p}% at 0-0.`);
  }
  if (twoStrike.total >= 20) {
    const p = r0(twoStrike.swingPct);
    if (p >= 68) notes.push(`Swings aggressively with 2 strikes (${p}%).`);
    else if (p <= 52) notes.push(`Lets more pitches go by with 2 strikes — swings ${p}%.`);
    else notes.push(`Typical 2-strike approach — swings ${p}%.`);
  }
  if (ahead.total >= 15) {
    const p = r0(ahead.swingPct);
    if (p >= 60) notes.push(`Hunts a pitch to drive when ahead in the count (swings ${p}%).`);
    else if (p <= 35) notes.push(`Rarely swings even when ahead in the count (${p}%).`);
    else notes.push(`Swings ${p}% of the time when ahead in the count.`);
  }
  if (swings >= 40 && whiffPct != null) {
    if (whiffPct >= 30) notes.push(`Swings and misses often — ${r0(whiffPct)}% of his swings.`);
    else if (whiffPct <= 12) notes.push(`Rarely swings and misses — ${r0(whiffPct)}% of his swings.`);
  }
  if ((t.K || 0) >= 5 && (t.KL || 0) / t.K >= 0.5) {
    notes.push(`Most of his strikeouts are looking (${t.KL} of ${t.K}).`);
  }
  if ((t.H || 0) >= 8 && xbhOfHits != null && xbhOfHits >= 35) {
    notes.push(`Power threat — ${t.XBH} of his ${t.H} hits go for extra bases.`);
  }
  if ((t.BUNT || 0) >= 2) {
    notes.push(`Has bunted ${t.BUNT} time${t.BUNT === 1 ? "" : "s"} in ${t.BIP} balls in play.`);
  }

  const attempts = sb + cs;
  if (attempts >= 1) {
    let s = `Steals: ${sb} for ${attempts} attempts`;
    if (pik) s += `, picked off ${pik}x`;
    s += ".";
    if (timed >= 3) {
      // Only call out a pattern when one strike count clearly leads — a tie isn't a tendency.
      const max = Math.max(...byStrikes);
      const leaders = [0, 1, 2].filter(k => byStrikes[k] === max);
      if (leaders.length === 1) {
        const best = leaders[0];
        s += ` Most steals come with ${best} strike${best === 1 ? "" : "s"} (${byStrikes[best]} of ${timed}).`;
      }
    }
    notes.push(s);
  } else if (pa >= 25) {
    notes.push(`No steal attempts in ${pa} plate appearances.`);
  }

  return {
    pa, hr: t.HR || 0, h: t.H || 0, xbh: t.XBH || 0,
    avg: bat.avg, obp: bat.obp, slg: bat.slg, ops: bat.ops,
    kPct, bbPct, xbhOfHits, qabPct, whiffPct, swings,
    sb, cs, pik, steals: byStrikes, stealsTimed: timed,
    firstPitch, twoStrike, ahead,
    badges: computeIQProfile(t),
    notes,
    smallSample: pa < 15,
  };
}

/* ===================== 3. Rendering ===================== */

function gdFmtRate(v) {
  return v == null || Number.isNaN(v) ? "—" : v.toFixed(3).replace(/^0/, "");
}
function gdFmtPct(v) {
  return v == null || Number.isNaN(v) ? "—" : `${Math.round(v)}%`;
}

function gdTile(label, value) {
  return `<div class="gd-tile"><div class="gd-tile-l">${label}</div><div class="gd-tile-v">${value}</div></div>`;
}

// The few buttons that live in the slim top bar (next to the team picker). The big
// team title that used to be here is gone — the picker already says which team it is.
function gdRenderActions(state, ui) {
  return `
    <button class="gd-btn small" data-gd="toggle-edit">${ui && ui.editing ? "Back to Game" : "Edit Lineup"}</button>
    <button class="gd-btn small danger" data-gd="new-game">New Game</button>`;
}

// Tappable player chips for everyone tracked who isn't in the lineup yet. Its own
// function so the controller can refresh just this strip after a typed name,
// without redrawing the inputs (which would knock the iPad keyboard focus away).
function gdRenderChips(ctx, state) {
  const inLineup = new Set(state.lineup.map(n => n.trim().toLowerCase()).filter(Boolean));
  const available = ctx.roster.filter(r => !inLineup.has(r.name.trim().toLowerCase()));
  return available.length
    ? available.map(r => `<button class="gd-chip" data-gd="place" data-name="${gdEsc(r.name)}">${gdEsc(r.name)}<small>${r.pa} PA</small></button>`).join("")
    : `<span class="hint">${ctx.roster.length ? "Everyone tracked for this team is already in the lineup." : "No hitters tracked for this team yet."}</span>`;
}

// Typed names get matched to the tracked roster ignoring case/extra spaces, so
// "t lane" lands as "T Lane" and finds his data. Unknown names pass through as typed.
function gdCanonicalName(roster, typed) {
  const clean = String(typed || "").trim().replace(/\s+/g, " ");
  const lower = clean.toLowerCase();
  const hit = (roster || []).find(r => r.name.trim().toLowerCase() === lower);
  return hit ? hit.name : clean;
}

function gdRenderEditor(ctx, state) {
  const slots = state.lineup.map((name, i) => `
    <div class="gd-slot">
      <span class="gd-slotnum">${i + 1}</span>
      <input type="text" list="gdPlayerList" data-gd-slot="${i}" value="${gdEsc(name)}"
        placeholder="${i === 0 ? "Leadoff — tap a player below or type" : "Batter " + (i + 1)}"
        autocomplete="off" autocapitalize="words" spellcheck="false" />
      <button class="gd-btn small" data-gd="clear-slot" data-i="${i}" aria-label="Clear spot ${i + 1}">×</button>
    </div>`).join("");

  return `
    <div class="gd-editor">
      <p class="hint" style="margin-top:0;">
        Tap a player below to drop them into the next open spot, or type a name into any spot.
        Players with no scouting data can still be logged — they'll just show "no data yet."
      </p>
      <div class="gd-slots">${slots}</div>
      <div class="gd-row">
        <button class="gd-btn" data-gd="add-slot">+ Add Spot</button>
        <button class="gd-btn" data-gd="remove-slot">− Remove Spot</button>
      </div>
      <div class="gd-chips-label">TRACKED PLAYERS (most plate appearances first)</div>
      <div class="gd-chips">${gdRenderChips(ctx, state)}</div>
      <div class="gd-row"><button class="gd-btn primary big" data-gd="done-edit">Done — Start Game Day</button></div>
    </div>`;
}

function gdRenderStrip(state) {
  const chips = state.lineup.map((name, i) => {
    const clean = name.trim();
    if (!clean) return `<button class="gd-slotchip empty" data-gd="select" data-i="${i}"><span class="n">${i + 1}</span><span class="nm">—</span></button>`;
    const today = gdTodayLine(state, clean);
    const res = today.entries.map(gdShortResult).join(", ");
    return `
      <button class="gd-slotchip${i === state.current ? " current" : ""}" data-gd="select" data-i="${i}">
        <span class="n">${i + 1}</span>
        <span class="nm">${gdEsc(clean)}</span>
        <span class="res">${res ? gdEsc(res) : "&nbsp;"}</span>
      </button>`;
  }).join("");
  return `<div class="gd-strip">${chips}</div>`;
}

function gdRenderBatterCard(ctx, state) {
  const name = (state.lineup[state.current] || "").trim();
  if (!name) {
    return `<div class="gd-card"><div style="padding:20px;"><p class="hint" style="margin:0;">Tap a lineup spot above to see that hitter.</p></div></div>`;
  }

  const t = gdLookup(ctx.totalsByName, name);
  const events = t ? (ctx.eventsByName[t.name] || []) : [];
  const steals = t ? (ctx.stealsByRunner[t.name] || []) : [];
  const profile = gdBatterProfile(t, events, steals);
  const today = gdTodayLine(state, name);

  const head = `
    <div class="gd-card-head">
      <div>
        <div class="gd-batting">BATTING ${gdOrdinal(state.current + 1).toUpperCase()}</div>
        <div class="gd-name">${gdEsc(name)}</div>
      </div>
      <div class="gd-header-btns">
        <button class="gd-btn small light" data-gd="prev">◀ Prev</button>
        <button class="gd-btn small light" data-gd="next">Next ▶</button>
      </div>
    </div>`;

  const todayBar = `
    <div class="gd-today">
      <strong>TODAY:</strong>
      ${today.entries.length
        ? `${gdEsc(today.text)} &nbsp;·&nbsp; ${gdEsc(today.entries.map(gdShortResult).join(", "))}`
        : `no plate appearances yet`}
    </div>`;

  if (!profile) {
    return `
      <div class="gd-card">${head}${todayBar}
        <div style="padding:16px 20px;">
          <p class="hint" style="margin:0;">No scouting data for "${gdEsc(name)}" yet — either this player hasn't batted in the games you've imported, or the name doesn't match how GameChanger spells it. You can still log results below.</p>
        </div>
      </div>`;
  }

  const badges = profile.badges.length
    ? profile.badges.map(b => `<span class="gd-badge" style="background:${IQ_BADGE_DEFS[b].color};">${b}</span>`).join("")
    : "";

  const tiles = [
    gdTile("AVG", gdFmtRate(profile.avg)), gdTile("OBP", gdFmtRate(profile.obp)),
    gdTile("SLG", gdFmtRate(profile.slg)), gdTile("OPS", gdFmtRate(profile.ops)),
    gdTile("PA", profile.pa), gdTile("HR", profile.hr),
    gdTile("K%", gdFmtPct(profile.kPct)), gdTile("BB%", gdFmtPct(profile.bbPct)),
    gdTile("XBH / H", gdFmtPct(profile.xbhOfHits)), gdTile("QAB%", gdFmtPct(profile.qabPct)),
    gdTile("WHIFF%", gdFmtPct(profile.whiffPct)), gdTile("SB-CS", `${profile.sb}-${profile.cs}`),
  ].join("");

  const notes = profile.notes.length
    ? `<ul class="gd-notes">${profile.notes.map(n => `<li>${gdEsc(n)}</li>`).join("")}</ul>`
    : `<p class="hint" style="margin:0;">Not enough pitches tracked yet to say much about his approach.</p>`;

  const small = profile.smallSample
    ? `<div class="gd-warn">Small sample — only ${profile.pa} plate appearance${profile.pa === 1 ? "" : "s"} tracked. Treat these numbers cautiously.</div>`
    : "";

  return `
    <div class="gd-card">
      ${head}${todayBar}
      <div class="gd-body">
        ${badges ? `<div class="gd-badges">${badges}</div>` : ""}
        ${small}
        <div class="gd-tiles">${tiles}</div>
        <div class="gd-section-label">APPROACH &amp; TENDENCIES</div>
        ${notes}
      </div>
      <div class="gd-two">
        <div class="gd-two-a">${renderZoneHeatCard(events, name, { compact: true })}</div>
        <div class="gd-two-b">${renderCountTable(t.pitchCounts || {}, t.countXBH || {}, name.toUpperCase())}</div>
      </div>
      <p class="hint gd-footnote">Notes use fixed thresholds — a starting read, not a verdict. WHIFF% = share of his swings that miss.</p>
    </div>`;
}

function gdRenderLog(state) {
  if (!state.log.length) return "";
  const rows = state.log.slice().reverse().map(e => {
    const r = GD_RESULT_BY_CODE[e.code];
    return `<li><strong>${gdEsc(e.name)}</strong> — ${gdEsc(r ? r.label : e.code)}${e.loc ? ` (${gdEsc(e.loc)})` : ""}</li>`;
  }).join("");
  return `
    <details class="gd-log">
      <summary>Game log (${state.log.length}) — newest first</summary>
      <ol reversed class="gd-log-list">${rows}</ol>
      <button class="gd-btn small" data-gd="copy-log">Copy log</button>
    </details>`;
}

function gdRenderActionBar(state, ui) {
  const name = (state.lineup[state.current] || "").trim();
  if (!name) return "";

  if (ui.pending && GD_RESULT_BY_CODE[ui.pending]) {
    const r = GD_RESULT_BY_CODE[ui.pending];
    const locs = GD_LOCATIONS.map(l => `<button class="gd-res loc" data-gd="loc" data-value="${l}">${l}</button>`).join("");
    return `
      <div class="gd-actionbar">
        <div class="gd-actionhead"><span>${gdEsc(name)} — <strong>${gdEsc(r.label)}</strong> · where did it go?</span></div>
        <div class="gd-res-grid">
          ${locs}
          <button class="gd-res skip" data-gd="loc" data-value="">No location</button>
          <button class="gd-res cancel" data-gd="cancel-pending">Cancel</button>
        </div>
      </div>`;
  }

  const buttons = GD_RESULTS.map(r => `<button class="gd-res ${r.group}" data-gd="result" data-code="${r.code}">${r.label}</button>`).join("");
  return `
    <div class="gd-actionbar">
      <div class="gd-actionhead">
        <span>Result for <strong>${gdEsc(name)}</strong> <em>· ${state.log.length} logged</em></span>
        <button class="gd-btn small" data-gd="undo">Undo Last</button>
      </div>
      <div class="gd-res-grid">${buttons}</div>
    </div>`;
}

// ctx: { team, roster: [{name, pa}], totalsByName, eventsByName, stealsByRunner }
// ui:  { editing, pending, msg }
function gdRenderPanel(ctx, state, ui) {
  const datalist = `<datalist id="gdPlayerList">${ctx.roster.map(r => `<option value="${gdEsc(r.name)}"></option>`).join("")}</datalist>`;
  const msg = ui.msg ? `<div class="gd-msg">${gdEsc(ui.msg)}</div>` : "";
  const body = ui.editing
    ? gdRenderEditor(ctx, state)
    : `${gdRenderStrip(state)}${gdRenderBatterCard(ctx, state)}${gdRenderLog(state)}${gdRenderActionBar(state, ui)}`;
  return `<div class="gd-root">${msg}${body}${datalist}</div>`;
}
