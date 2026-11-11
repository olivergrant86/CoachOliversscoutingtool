/* app.js — wires up state, UI events, and rendering */

// Real data loads asynchronously after sign-in (see auth.js -> initAppState()).
// This placeholder just lets event listeners attach safely before that happens.
let state = { opponents: {}, currentOpponentId: null };

const el = id => document.getElementById(id);

function currentOpponent() {
  return state.opponents[state.currentOpponentId] || null;
}

function persist() {
  saveState(state).catch(err => {
    console.warn("Couldn't save to your account:", err);
    const banner = document.getElementById("storageWarning");
    if (banner) {
      banner.style.display = "block";
      banner.innerHTML = "⚠️ Couldn't save your changes — check your internet connection. (" + (err.message || err) + ")";
    }
  });
}

// Called once by auth.js after a successful sign-in, and again after sign-out ->
// sign-in as a different user. Loads that user's data from Supabase, then renders.
async function initAppState() {
  state = await loadState();
  renderAll();
}

/* ---------- Opponent picker ---------- */

function refreshOpponentPicker() {
  const picker = el("opponentPicker");
  picker.innerHTML = `<option value="">— none —</option>`;
  Object.values(state.opponents).forEach(opp => {
    const opt = document.createElement("option");
    opt.value = opp.id;
    opt.textContent = opp.name;
    if (opp.id === state.currentOpponentId) opt.selected = true;
    picker.appendChild(opt);
  });
}

el("opponentPicker").addEventListener("change", e => {
  state.currentOpponentId = e.target.value || null;
  persist();
  renderAll();
});

el("btnAddOpponent").addEventListener("click", () => {
  const name = prompt("Opponent team name:");
  if (!name || !name.trim()) return;
  const opp = newOpponent(name.trim());
  state.opponents[opp.id] = opp;
  state.currentOpponentId = opp.id;
  persist();
  refreshOpponentPicker();
  renderAll();
});

el("btnEditOpponent").addEventListener("click", () => {
  const opp = currentOpponent();
  if (!opp) { alert("Select an opponent first."); return; }
  const name = prompt("Rename opponent:", opp.name);
  if (name === null) return; // cancelled
  if (!name.trim()) { alert("Name can't be blank."); return; }
  opp.name = name.trim();
  persist();
  refreshOpponentPicker();
  renderAll();
});

el("btnDeleteOpponent").addEventListener("click", () => {
  const opp = currentOpponent();
  if (!opp) return;
  if (!confirm(`Delete "${opp.name}" and all its processed games? This can't be undone.`)) return;
  delete state.opponents[opp.id];
  state.currentOpponentId = null;
  persist();
  refreshOpponentPicker();
  renderAll();
});

/* ---------- Tabs ---------- */

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    el("tab-" + btn.dataset.tab).classList.add("active");
    // Game Day hides the app header + tab bar to give the hitter the whole screen; the
    // Menu button on the Game Day top bar brings them back. Leaving Game Day restores them.
    const onGameDay = btn.dataset.tab === "gameday";
    const onPitcher = btn.dataset.tab === "pitcher";
    document.body.classList.toggle("gd-focus", onGameDay || onPitcher);
    document.body.classList.remove("gd-menu-open");
    gcGdSyncMenuButton();
    if (onGameDay) { window.scrollTo(0, 0); renderGameDay(); }
    if (onPitcher) { window.scrollTo(0, 0); renderPitcherMode(); }
    if (btn.dataset.tab === "gclog") { renderGcGamesTable(); renderGcReports(); }
  });
});

document.querySelectorAll(".rtab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".rtab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".rtab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    el("rtab-" + btn.dataset.rtab).classList.add("active");
  });
});

/* ---------- Import Game Log (name-keyed, persisted per opponent) ---------- */

document.querySelectorAll(".gctab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".gctab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll("#tab-gclog .rtab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    el("gctab-" + btn.dataset.gctab).classList.add("active");
  });
});

function gcAllEvents(opp) {
  return (opp.gameLogs || []).flatMap(g => g.events);
}
function gcAllSteals(opp) {
  return (opp.gameLogs || []).flatMap(g => g.steals);
}
function gcAllScores(opp) {
  return (opp.gameLogs || []).flatMap(g => g.scores);
}
function gcAllOutsLog(opp) {
  return (opp.gameLogs || []).flatMap(g => g.outsLog || []);
}
function gcAllWildPitches(opp) {
  return (opp.gameLogs || []).flatMap(g => g.wildPitches || []);
}
function gcAllFieldingErrors(opp) {
  return (opp.gameLogs || []).flatMap(g => g.fieldingErrors || []);
}
function gcAllFieldingPutouts(opp) {
  return (opp.gameLogs || []).flatMap(g => g.fieldingPutouts || []);
}
function gcAllPickedOff(opp) {
  return (opp.gameLogs || []).flatMap(g => g.pickedOff || []);
}

// A single comparable "YYYY-MM-DD"-ish key per game: the entered/detected game date
// if there is one, otherwise the date portion of when it was imported (best available
// fallback, consistent with how the games table itself sorts).
function gcGameSortKey(g) {
  return g.gameDate || (g.processedAt ? g.processedAt.slice(0, 10) : "0000-00-00");
}

// This team's games, oldest first.
function gcRelevantGamesSorted(opp, team) {
  return (opp.gameLogs || [])
    .filter(g => g.homeTeamName === team || g.visitorTeamName === team)
    .slice()
    .sort((a, b) => gcGameSortKey(a).localeCompare(gcGameSortKey(b)));
}

// Full batting + pitching summary for an arbitrary subset of a team's games —
// used to build the First Half/Second Half and Season/Recent comparisons.
function gcAggregateGamesSubset(games, team) {
  const events = games.flatMap(g => g.events || []);
  const steals = games.flatMap(g => g.steals || []);
  const scores = games.flatMap(g => g.scores || []);
  const fieldingErrors = games.flatMap(g => g.fieldingErrors || []);
  const fieldingPutouts = games.flatMap(g => g.fieldingPutouts || []);
  const pickedOff = games.flatMap(g => g.pickedOff || []);
  const outsLog = games.flatMap(g => g.outsLog || []).filter(o => o.team === team);
  const wildPitches = games.flatMap(g => g.wildPitches || []).filter(w => w.team === team);

  const totals = aggregateGameLogStats(events, steals, scores, fieldingErrors, pickedOff, fieldingPutouts);
  const totalsArray = Object.values(totals).filter(t => t.team === team);

  const teamPitchEvents = events.filter(e => e.pitcherTeam === team);
  const teamPitchScores = scores.filter(s => s.pitcherTeam === team);
  const teamSteals = steals.filter(s => s.pitcherTeam === team);
  const pitchingTotals = aggregatePitchingStats(teamPitchEvents, teamPitchScores, outsLog, wildPitches, teamSteals);

  return {
    batting: computeTeamCurrentPerformance(totalsArray),
    pitching: computeTeamPitchingSummary(pitchingTotals),
    gameCount: games.length,
  };
}

// { before: <first half>, after: <second half> } — split by count, oldest games first.
function gcComputeHalfSplit(opp, team) {
  const games = gcRelevantGamesSorted(opp, team);
  const mid = Math.ceil(games.length / 2);
  return {
    before: gcAggregateGamesSubset(games.slice(0, mid), team),
    after: gcAggregateGamesSubset(games.slice(mid), team),
  };
}

// { before: <full season>, after: <most recent N games> }
function gcComputeRecentSplit(opp, team, n = 5) {
  const games = gcRelevantGamesSorted(opp, team);
  return {
    before: gcAggregateGamesSubset(games, team),
    after: gcAggregateGamesSubset(games.slice(-n), team),
  };
}

// The top N players on a team by season-total plate appearances — used to decide
// who gets a line on the player-trend chart, so it's not cluttered with everyone
// who's had one at-bat all season.
function gcTopPlayersByPA(opp, team, n) {
  const games = gcRelevantGamesSorted(opp, team);
  const events = games.flatMap(g => g.events || []);
  const totals = aggregateGameLogStats(events, [], []);
  return Object.values(totals)
    .filter(t => t.team === team)
    .sort((a, b) => b.PA - a.PA)
    .slice(0, n)
    .map(t => t.name);
}

// For each given player, their CUMULATIVE (season-to-date) value of the given batting
// stat after each of the team's games in order — a running total through each game,
// not that single game's own number. A single game's average is too noisy to plot
// meaningfully (an 0-for-2 game alone reads as ".000"); cumulative is what actually
// shows a real trajectory. A player's line stays flat across any game they didn't
// have a plate appearance in, since their season total didn't change.
function gcComputePlayerTrendSeries(opp, team, statKey, playerNames) {
  const games = gcRelevantGamesSorted(opp, team);
  const running = {};
  playerNames.forEach(name => { running[name] = { PA: 0, AB: 0, H: 0, "1B": 0, "2B": 0, "3B": 0, HR: 0, BB: 0, HBP: 0 }; });

  const labels = [];
  const valuesByPlayer = {};
  playerNames.forEach(name => { valuesByPlayer[name] = []; });

  games.forEach(g => {
    labels.push(g.gameDate || (g.processedAt ? g.processedAt.slice(0, 10) : ""));
    const gameTotals = aggregateGameLogStats(g.events || [], g.steals || [], g.scores || []);
    playerNames.forEach(name => {
      const gt = gameTotals[name];
      const r = running[name];
      if (gt) {
        r.PA += gt.PA; r.AB += gt.AB; r.H += gt.H;
        r["1B"] += gt["1B"]; r["2B"] += gt["2B"]; r["3B"] += gt["3B"]; r.HR += gt.HR;
        r.BB += gt.BB; r.HBP += gt.HBP;
      }
      valuesByPlayer[name].push(computeBattingMetrics(r)[statKey]);
    });
  });

  return { labels, series: playerNames.map(name => ({ name, values: valuesByPlayer[name] })) };
}

// Parses the "Short Name, Slot, Full Name" textarea into the map shape
// parseGameLogText expects: { "K Garrett": [{ slot: 3, name: "Kyle Garrett" }, ...] }
function gcParseDisambigInput(text) {
  const map = {};
  (text || "").split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const parts = trimmed.split(",");
    if (parts.length < 3) return;
    const shortName = parts[0].trim();
    const slot = parseInt(parts[1].trim(), 10);
    const fullName = parts.slice(2).join(",").trim();
    if (!shortName || !fullName || Number.isNaN(slot) || slot < 1) return;
    if (!map[shortName]) map[shortName] = [];
    map[shortName].push({ slot, name: fullName });
  });
  return map;
}

el("btnParseGcLog").addEventListener("click", () => {
  const opp = currentOpponent();
  if (!opp) { alert("Select or add an opponent first (top right)."); return; }
  const rawText = el("gcInput").value;
  if (!rawText.trim()) { el("gcMsg").textContent = "Paste a game log first."; return; }

  // Multiple games can be pasted at once, separated by a line containing just "===".
  const gameTexts = rawText.split(/^\s*={3,}\s*$/m).map(t => t.trim()).filter(Boolean);

  const homeInput = el("gcHomeTeamInput");
  const visitorInput = el("gcVisitorTeamInput");
  const homeOverride = homeInput.value.trim();
  const visitorOverride = visitorInput.value.trim();
  // Same slot mapping applies to every game in this paste — if the same players' batting
  // order spots actually change from game to game, import those games separately with
  // different values here rather than pasting them together.
  const disambiguation = gcParseDisambigInput(el("gcDisambigInput").value);

  if (!opp.gameLogs) opp.gameLogs = [];

  let gamesAdded = 0, totalEvents = 0, totalErrorLines = 0, skippedGames = 0;
  let lastHomeUsed = "", lastVisitorUsed = "";
  const consoleWarnings = [];

  gameTexts.forEach((text, idx) => {
    const parsed = parseGameLogText(text, disambiguation, 9);
    if (parsed.events.length === 0) {
      skippedGames++;
      if (parsed.errors.length) consoleWarnings.push(`Game ${idx + 1}: ${parsed.errors.join("; ")}`);
      return;
    }

    const homeTeamName = homeOverride || parsed.detectedHome || "Home Team";
    const visitorTeamName = visitorOverride || parsed.detectedVisitor || "Visitor Team";
    applyTeamNames(parsed, homeTeamName, visitorTeamName);

    const { events, steals, scores, errors, outsLog, wildPitches, fieldingErrors, fieldingPutouts, pickedOff } = parsed;
    opp.gameLogs.push({
      id: "gclog_" + Date.now().toString(36) + "_" + idx,
      processedAt: new Date().toISOString(),
      homeTeamName, visitorTeamName,
      gameDate: parsed.detectedGameDate, // "YYYY-MM-DD" or null — year is guessed (see glogFindGameDate), editable in the games table
      rawText: text, // kept so this game can be re-parsed later (e.g. after an app update) without re-pasting
      disambiguation, // same-name-player rules used for this game, reapplied on re-run
      events, steals, scores, outsLog, wildPitches, fieldingErrors, fieldingPutouts, pickedOff,
    });

    gamesAdded++;
    totalEvents += events.length;
    totalErrorLines += errors.length;
    lastHomeUsed = homeTeamName; lastVisitorUsed = visitorTeamName;
    if (errors.length) consoleWarnings.push(`Game ${idx + 1} (${homeTeamName} vs ${visitorTeamName}): ${errors.join("; ")}`);
  });

  if (gamesAdded === 0) {
    el("gcMsg").textContent = "No plays recognized in any game. Check that this is a supported log format.";
    if (consoleWarnings.length) console.warn(consoleWarnings);
    return;
  }

  persist();
  // Show the user what was actually used, without clobbering a value they typed themselves.
  if (!homeOverride) homeInput.value = lastHomeUsed;
  if (!visitorOverride) visitorInput.value = lastVisitorUsed;

  const parts = [`Added ${gamesAdded} game${gamesAdded === 1 ? "" : "s"} (${totalEvents} plate appearances total)`];
  if (skippedGames) parts.push(`${skippedGames} chunk(s) had no recognizable plays and were skipped`);
  if (totalErrorLines) parts.push(`${totalErrorLines} line(s) skipped across games (see console)`);
  el("gcMsg").textContent = parts.join(" — ") + ".";
  if (consoleWarnings.length) console.warn(consoleWarnings);

  el("gcInput").value = "";
  renderGcGamesTable();
  renderGcReports();
});

el("btnUndoLastGcGame").addEventListener("click", () => {
  const opp = currentOpponent();
  if (!opp || !opp.gameLogs || !opp.gameLogs.length) return;
  if (!confirm("Remove the most recently imported game from this opponent's season?")) return;
  opp.gameLogs.pop();
  persist();
  renderGcGamesTable();
  renderGcReports();
});

el("btnRerunGames").addEventListener("click", () => {
  const opp = currentOpponent();
  if (!opp || !opp.gameLogs || !opp.gameLogs.length) {
    el("gcRerunMsg").textContent = "No games imported yet for this opponent.";
    return;
  }

  const rerunnable = opp.gameLogs.filter(g => g.rawText);
  const notRerunnable = opp.gameLogs.length - rerunnable.length;

  if (!rerunnable.length) {
    el("gcRerunMsg").textContent = `None of these ${opp.gameLogs.length} game(s) can be re-run — they were imported before this feature existed and don't have their original text saved. Re-paste them if you want the latest calculations.`;
    return;
  }

  if (!confirm(`Re-run ${rerunnable.length} game(s) using the current version of this tool? This replaces their stored stats with freshly-calculated ones — your imported-games list and any manual team-name overrides for each game stay the same.`)) return;

  let reErrorLines = 0;
  rerunnable.forEach(g => {
    const parsed = parseGameLogText(g.rawText, g.disambiguation || {}, 9);
    applyTeamNames(parsed, g.homeTeamName, g.visitorTeamName);
    const { events, steals, scores, errors, outsLog, wildPitches, fieldingErrors, fieldingPutouts, pickedOff } = parsed;
    Object.assign(g, { events, steals, scores, outsLog, wildPitches, fieldingErrors, fieldingPutouts, pickedOff });
    reErrorLines += errors.length;
  });

  persist();
  renderGcGamesTable();
  renderGcReports();

  const parts = [`Re-ran ${rerunnable.length} game(s)`];
  if (notRerunnable) parts.push(`${notRerunnable} game(s) couldn't be re-run (imported before this feature — re-paste them for the latest calculations)`);
  if (reErrorLines) parts.push(`${reErrorLines} line(s) skipped across the re-run games (see console)`);
  el("gcRerunMsg").textContent = parts.join(" — ") + ".";
});

function renderGcGamesTable() {
  const opp = currentOpponent();
  const tbody = document.querySelector("#gcGamesTable tbody");
  tbody.innerHTML = "";
  if (!opp) return;
  const games = opp.gameLogs || [];

  // Sort by game date (most recent first) so games show up in chronological order
  // regardless of the order they were imported in. Games with no detected/entered
  // date (older imports, or a date the parser couldn't find) fall to the bottom,
  // sorted among themselves by when they were imported.
  const sorted = [...games].sort((a, b) => {
    if (a.gameDate && b.gameDate) return b.gameDate.localeCompare(a.gameDate);
    if (a.gameDate && !b.gameDate) return -1;
    if (!a.gameDate && b.gameDate) return 1;
    return new Date(b.processedAt) - new Date(a.processedAt);
  });

  sorted.forEach((g, i) => {
    const tr = document.createElement("tr");
    const d = new Date(g.processedAt);
    tr.innerHTML = `<td>${i + 1}</td>` +
      `<td><input type="date" data-edit-game-date="${g.id}" value="${g.gameDate || ""}" style="font-size:.85rem;padding:2px 4px;" /></td>` +
      `<td>${d.toLocaleString()}</td><td>${g.homeTeamName || "—"}</td><td>${g.visitorTeamName || "—"}</td><td>${g.events.length}</td>` +
      `<td><button class="btn small danger" data-delete-game="${g.id}">Delete</button></td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("[data-edit-game-date]").forEach(input => {
    input.addEventListener("change", () => {
      const game = opp.gameLogs.find(g => g.id === input.dataset.editGameDate);
      if (!game) return;
      game.gameDate = input.value || null; // clearing the field removes the date entirely
      persist();
      renderGcGamesTable(); // re-sort with the corrected date
    });
  });

  tbody.querySelectorAll("[data-delete-game]").forEach(btn => {
    btn.addEventListener("click", () => {
      const gameId = btn.dataset.deleteGame;
      const game = opp.gameLogs.find(g => g.id === gameId);
      const label = game ? `${game.homeTeamName || "—"} vs ${game.visitorTeamName || "—"}` : "this game";
      if (!confirm(`Remove ${label} from this opponent's season? This can't be undone.`)) return;
      opp.gameLogs = opp.gameLogs.filter(g => g.id !== gameId);
      persist();
      renderGcGamesTable();
      renderGcReports();
    });
  });
}

let lastGcTotalsArray = [];
let gcCardViewMode = "standard"; // "standard" | "dev" — Player Card view toggle
let gcTrendsViewMode = "team"; // "team" | "players" — Performance Trends view toggle

/* ---------- Game Day (live batter view) ----------
 * The lineup, who's up, and the at-bat log are saved on THIS device (localStorage),
 * not in the cloud database. That's deliberate: every save of the cloud copy
 * re-uploads the entire season's data, which would be slow on a ball-field
 * connection after every tap — and a stale tab could overwrite games imported
 * elsewhere. The trade-off is that a lineup set up on a laptop won't appear on
 * the iPad; set it up on the device you'll use at the game.
 */

let gcGdCtx = null;   // scouting data for the selected team (built by renderGcReports)
let gcGdState = null; // lineup / who's up / log for that team
let gcGdKey = "";     // which opponent+team gcGdState belongs to
let gcGdUi = { editing: false, pending: null, msg: "" };

function gcGdStorageKey(key) { return "diamond-gameday:" + key; }

function gcGdLoad(key) {
  try { return gdSanitizeState(JSON.parse(localStorage.getItem(gcGdStorageKey(key)))); }
  catch (e) { return gdNewState(); }
}

function gcGdSave() {
  try { localStorage.setItem(gcGdStorageKey(gcGdKey), JSON.stringify(gcGdState)); }
  catch (e) { gcGdUi.msg = "Couldn't save on this device (private browsing?). Game Day still works, but it won't survive a reload."; }
}

function renderGameDay() {
  if (!gcGdCtx || !gcGdState) return;
  el("gcGdActions").innerHTML = gdRenderActions(gcGdState, gcGdUi);
  el("gcGameDayHolder").innerHTML = gdRenderPanel(gcGdCtx, gcGdState, gcGdUi, { saved: gcPnSaved(), drafts: gcPnDrafts });
}

// Every team's data for the current opponent, handed over by renderGcReports. Game Day
// has its own team picker (this tab doesn't show the Reports team filter), so it keeps
// the full dataset and builds the chosen team's view from it.
let gcGdSource = null;
let gcGdTeam = "";     // team chosen in the Game Day picker
let gcGdTeamOpp = "";  // which opponent gcGdTeam was chosen for

function gcGdTeamStorageKey(oppId) { return "diamond-gameday-team:" + oppId; }

function gcGdBuildContext(source, team) {
  const events = source.allEvents.filter(e => e.team === team);
  const totalsArray = source.allTotalsArray.filter(t => t.team === team);
  const totalsByName = {};
  totalsArray.forEach(t => { totalsByName[t.name] = t; });
  const eventsByName = {};
  events.forEach(ev => { (eventsByName[ev.batter] = eventsByName[ev.batter] || []).push(ev); });
  const stealsByRunner = {};
  source.allSteals.filter(st => st.team === team).forEach(st => { (stealsByRunner[st.runner] = stealsByRunner[st.runner] || []).push(st); });
  return {
    oppId: source.oppId,
    team,
    roster: totalsArray.filter(t => t.PA > 0).map(t => ({ name: t.name, pa: t.PA })).sort((a, b) => b.pa - a.pa),
    totalsByName, eventsByName, stealsByRunner,
  };
}

// Rebuilds the team picker and the Game Day view from the latest data.
function gcGdRefresh() {
  const picker = el("gcGdTeamPicker");
  if (!gcGdSource) {
    picker.innerHTML = `<option value="">— choose a team —</option>`;
    gcGdTeam = ""; gcGdTeamOpp = "";
    gcGdClearContext("Import at least one game, then choose a team above to set up Game Day.");
    return;
  }
  const src = gcGdSource;
  if (gcGdTeamOpp !== src.oppId) { // first load, or switched opponents: restore what was last used for this one
    gcGdTeamOpp = src.oppId;
    try { gcGdTeam = localStorage.getItem(gcGdTeamStorageKey(src.oppId)) || ""; } catch (e) { gcGdTeam = ""; }
  }
  if (!src.teamNames.includes(gcGdTeam)) gcGdTeam = "";
  picker.innerHTML = `<option value="">— choose a team —</option>` +
    src.teamNames.map(n => `<option value="${gdEsc(n)}">${gdEsc(n)}</option>`).join("");
  picker.value = gcGdTeam;
  if (!gcGdTeam) { gcGdClearContext("Choose a team above to set up Game Day."); return; }
  gcGdSetContext(gcGdBuildContext(src, gcGdTeam));
}

el("gcGdTeamPicker").addEventListener("change", () => {
  gcGdTeam = el("gcGdTeamPicker").value;
  try { localStorage.setItem(gcGdTeamStorageKey(gcGdTeamOpp), gcGdTeam); } catch (e) { /* remembering the team is a convenience only */ }
  gcGdRefresh();
});

function gcGdSyncMenuButton() {
  const open = document.body.classList.contains("gd-menu-open");
  ["btnGdMenu", "btnPmMenu"].forEach(id => {
    const btn = el(id);
    if (!btn) return;
    btn.textContent = open ? "✕ Menu" : "☰ Menu";
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });
}

el("btnGdMenu").addEventListener("click", () => {
  document.body.classList.toggle("gd-menu-open");
  gcGdSyncMenuButton();
  window.scrollTo(0, 0);
});

function gcGdSetContext(ctx) {
  const key = `${ctx.oppId}::${ctx.team}`;
  if (key !== gcGdKey) {
    gcGdKey = key;
    gcGdState = gcGdLoad(key);
    gcGdUi = { editing: !gdHasLineup(gcGdState), pending: null, msg: "" };
    gcPnDraftKey = key;
    gcPnDrafts = gcPnLoadDrafts(key);
  }
  gcGdCtx = ctx;
  renderGameDay();
}

function gcGdClearContext(message) {
  gcGdCtx = null; gcGdState = null; gcGdKey = "";
  gcPnDrafts = {}; gcPnDraftKey = ""; // anything typed is already saved on this device, so nothing is lost
  el("gcGdActions").innerHTML = "";
  el("gcGameDayHolder").innerHTML = `<p class="hint">${message}</p>`;
}

function gcGdScrollTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function gcGdCopyLog(btn) {
  const text = gdLogText(gcGdState, gcGdCtx.team);
  const original = btn.textContent;
  const flash = msg => { btn.textContent = msg; setTimeout(() => { btn.textContent = original; }, 2500); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => flash("Copied ✓"), () => flash("Copy failed — select the text instead"));
  } else {
    flash("Copy not supported here");
  }
}

function gcGdAction(action, ds, btn) {
  const st = gcGdState, ui = gcGdUi;
  ui.msg = "";
  let scroll = false;
  let focusNotes = false;

  switch (action) {
    case "toggle-edit": ui.editing = !ui.editing; ui.pending = null; break;
    case "notes": {
      const who = (st.lineup[st.current] || "").trim();
      if (!who) break;
      ui.notesOpen = who; ui.notesMsg = ""; focusNotes = true; break;
    }
    case "notes-close": ui.notesOpen = null; ui.notesMsg = ""; break;
    case "notes-save-one": gcPnSaveFromGameDay([ui.notesOpen]); return;
    case "notes-save-all": gcPnSaveFromGameDay(null); return;
    case "done-edit":
      if (!gdHasLineup(st)) { ui.msg = "Add at least one hitter to the lineup first."; break; }
      gdEnsureCurrentFilled(st); ui.editing = false; scroll = true; break;
    case "place":
      if (gdPlaceInLineup(st, ds.name) === -1) ui.msg = "Couldn't add him — the lineup is full or he's already in it.";
      break;
    case "clear-slot": gdSetSlotName(st, parseInt(ds.i, 10), ""); break;
    case "add-slot": if (!gdAddSlot(st)) ui.msg = `Lineups can have up to ${GD_MAX_SLOTS} spots.`; break;
    case "remove-slot": if (!gdRemoveSlot(st)) ui.msg = `A lineup needs at least ${GD_MIN_SLOTS} spots.`; break;
    case "select": {
      const i = parseInt(ds.i, 10);
      if (!st.lineup[i] || !st.lineup[i].trim()) { ui.editing = true; ui.msg = "That spot is empty — add a hitter, then tap Done."; break; }
      gdSetCurrent(st, i); ui.pending = null; scroll = true; break;
    }
    case "prev": gdStep(st, -1); ui.pending = null; scroll = true; break;
    case "next": gdStep(st, 1); ui.pending = null; scroll = true; break;
    case "result": {
      const r = GD_RESULT_BY_CODE[ds.code];
      if (!r) break;
      if (r.ball) ui.pending = r.code;                    // ask where it went before logging
      else { gdLogResult(st, r.code, null); ui.pending = null; scroll = true; }
      break;
    }
    case "loc":
      if (ui.pending) { gdLogResult(st, ui.pending, ds.value || null); ui.pending = null; scroll = true; }
      break;
    case "cancel-pending": ui.pending = null; break;
    case "undo":
      if (!gdUndo(st)) ui.msg = "Nothing to undo yet.";
      ui.pending = null; scroll = true; break;
    case "new-game":
      if (!confirm("Clear today's logged at-bats and go back to the leadoff hitter? The lineup stays.")) return;
      gdNewGame(st); ui.pending = null; scroll = true; break;
    case "copy-log": gcGdCopyLog(btn); return; // updates its own button, no redraw needed
    case "card-positioning": printGameCardFromGameDay("positioning"); return;
    case "card-dugout": printGameCardFromGameDay("dugout"); return;
    default: return;
  }

  gcGdSave();
  renderGameDay();
  if (scroll) gcGdScrollTop();
  if (focusNotes) {
    // open with the keyboard ready so you can start typing straight away
    const box = document.getElementById("pnDraftBox");
    if (box) { box.focus(); try { box.setSelectionRange(box.value.length, box.value.length); } catch (e) { /* not essential */ } }
  }
}

// One listener for every Game Day button — the panel is redrawn constantly, so
// listening on the container is simpler and safer than re-attaching to buttons.
function gcGdOnClick(e) {
  const btn = e.target.closest("[data-gd]");
  if (!btn || !gcGdState || !gcGdCtx) return;
  gcGdAction(btn.dataset.gd, btn.dataset, btn);
}
el("gcGameDayHolder").addEventListener("click", gcGdOnClick);
el("gcGdActions").addEventListener("click", gcGdOnClick);

// Typing a name into a lineup spot. Deliberately does NOT redraw the whole editor
// (that would drop the keyboard mid-edit on an iPad) — just tidies the input and
// refreshes the list of players still available to tap.
el("gcGameDayHolder").addEventListener("input", e => {
  const box = e.target.closest("[data-pn-draft]");
  if (!box || !gcGdCtx) return;
  pnSetDraft(gcPnDrafts, box.dataset.pnDraft, box.value);
  gcPnWriteDrafts(gcPnDraftKey, gcPnDrafts);
});

el("gcGameDayHolder").addEventListener("change", e => {
  const input = e.target.closest("[data-gd-slot]");
  if (!input || !gcGdState || !gcGdCtx) return;
  const name = gdCanonicalName(gcGdCtx.roster, input.value);
  input.value = name;
  gdSetSlotName(gcGdState, parseInt(input.dataset.gdSlot, 10), name);
  gcGdUi.msg = "";
  gcGdSave();
  const chips = el("gcGameDayHolder").querySelector(".gd-chips");
  if (chips) chips.innerHTML = gdRenderChips(gcGdCtx, gcGdState);
});

/* ---------- Pitcher Mode (see pitchermode.js) ----------
 * Charts the opponent's pitcher live while we hit. Like Game Day, the live log is saved on
 * THIS device only and never feeds the season stats (so a later GameChanger import of the same
 * game can't double-count). Season numbers come from gcGdSource.gameLogs. The only cloud write
 * is "Save today's line to his notes", which goes through the same safe path as player notes.
 */
let pmCtx = null, pmState = null, pmKey = "";
let pmUi = { choosing: false, msg: "", saving: false, saveMsg: "" };
let pmTeam = "", pmTeamOpp = "";

function pmStorageKey(key) { return "diamond-pitchermode:" + key; }
function pmTeamStorageKey(oppId) { return "diamond-pitchermode-team:" + oppId; }

function pmLoad(key) {
  try { return pmSanitizeState(JSON.parse(localStorage.getItem(pmStorageKey(key)))); }
  catch (e) { return pmNewState(); }
}
function pmSave() {
  try { localStorage.setItem(pmStorageKey(pmKey), JSON.stringify(pmState)); }
  catch (e) { pmUi.msg = "Couldn't save on this device (private browsing?). Pitcher Mode still works, but it won't survive a reload."; }
}

function renderPitcherMode() {
  if (!pmCtx || !pmState) return;
  pmCtx.notes = gcPnSaved();
  el("pmActions").innerHTML = pmRenderActions(pmState, pmUi);
  el("pmHolder").innerHTML = pmRenderPanel(pmCtx, pmState, pmUi);
}

function pmClear(message) {
  pmCtx = null; pmState = null; pmKey = "";
  el("pmActions").innerHTML = "";
  el("pmHolder").innerHTML = `<p class="hint">${message}</p>`;
}

function pmRefresh() {
  const picker = el("pmTeamPicker");
  if (!gcGdSource) {
    picker.innerHTML = `<option value="">— choose a team —</option>`;
    pmTeam = ""; pmTeamOpp = "";
    pmClear("Import at least one game, then choose a team above to chart their pitcher.");
    return;
  }
  const src = gcGdSource;
  if (pmTeamOpp !== src.oppId) {
    pmTeamOpp = src.oppId;
    try { pmTeam = localStorage.getItem(pmTeamStorageKey(src.oppId)) || ""; } catch (e) { pmTeam = ""; }
    if (!pmTeam) pmTeam = gcGdTeam; // first time: start on the same team as Game Day
  }
  if (!src.teamNames.includes(pmTeam)) pmTeam = "";
  picker.innerHTML = `<option value="">— choose a team —</option>` +
    src.teamNames.map(n => `<option value="${pmEsc(n)}">${pmEsc(n)}</option>`).join("");
  picker.value = pmTeam;
  if (!pmTeam) { pmClear("Choose the team that's pitching against us."); return; }

  const key = `${src.oppId}::${pmTeam}`;
  if (key !== pmKey) {
    pmKey = key;
    pmState = pmLoad(key);
    pmUi = { choosing: false, msg: "", saving: false, saveMsg: "" };
  }
  pmCtx = { oppId: src.oppId, team: pmTeam, gameLogs: src.gameLogs || [], known: pmKnownPitchers(src.gameLogs, pmTeam) };
  renderPitcherMode();
}

el("pmTeamPicker").addEventListener("change", () => {
  pmTeam = el("pmTeamPicker").value;
  try { localStorage.setItem(pmTeamStorageKey(pmTeamOpp), pmTeam); } catch (e) { /* convenience only */ }
  pmRefresh();
});

el("btnPmMenu").addEventListener("click", () => {
  document.body.classList.toggle("gd-menu-open");
  gcGdSyncMenuButton();
  window.scrollTo(0, 0);
});

async function pmSaveToNotes() {
  const p = pmCurrent(pmState);
  if (!p || pmUi.saving || !pmCtx) return;
  const text = pmSummaryText(p, pmState, pmCtx.gameLogs, pmCtx.team);
  pmUi.saving = true; pmUi.saveMsg = "Saving…"; renderPitcherMode();
  try {
    await gcPnCommit(pmCtx.oppId, notes => { pnAdd(notes, pmCtx.team, p.name, text, new Date().toISOString(), "pitcher"); });
    pmUi.saveMsg = `Saved to ${p.name}'s notes ✓`;
  } catch (err) {
    pmUi.saveMsg = gcPnErrorText(err).replace("Your notes are still safe on this device", "Today's chart is still on this device");
  }
  pmUi.saving = false;
  renderPitcherMode();
  renderGcNotesPage();
}

function pmStartTyped() {
  const box = document.getElementById("pmNameInput");
  const typed = box ? box.value.trim() : "";
  if (!typed) { pmUi.msg = "Type the pitcher's name, or tap one of the names above."; return false; }
  // match an imported name regardless of capitalization so his season numbers line up
  const hit = pmCtx.known.find(k => k.name.toLowerCase() === typed.toLowerCase());
  pmStartPitcher(pmState, hit ? hit.name : typed);
  return true;
}

function pmAction(action, ds) {
  const st = pmState, ui = pmUi;
  ui.msg = "";
  if (action !== "save-notes") ui.saveMsg = "";
  switch (action) {
    case "pitch":
      if (!pmLogPitch(st, ds.code)) { ui.choosing = true; ui.msg = "Pick who's pitching first."; }
      break;
    case "pickoff": pmPickoff(st); break;
    case "undo": if (!pmUndo(st)) ui.msg = "Nothing to undo yet."; ui.choosing = false; break;
    case "spot-prev": pmMoveSpot(st, -1); break;
    case "spot-next": pmMoveSpot(st, 1); break;
    case "next-inning": pmNextInning(st); break;
    case "choose": ui.choosing = true; break;
    case "cancel-choose": ui.choosing = false; break;
    case "start": pmStartPitcher(st, ds.name); ui.choosing = false; break;
    case "start-typed": if (pmStartTyped()) ui.choosing = false; break;
    case "switch": {
      const i = parseInt(ds.i, 10);
      if (st.pitchers[i] && i !== st.cur) pmStartPitcher(st, st.pitchers[i].name);
      break;
    }
    case "new-game":
      if (!confirm("Clear today's pitch chart and start over? (Anything you saved to a pitcher's notes stays.)")) return;
      pmNewGame(st); ui.choosing = false; break;
    case "save-notes": pmSaveToNotes(); return;
    default: return;
  }
  pmSave();
  renderPitcherMode();
}

function pmOnClick(e) {
  const btn = e.target.closest("[data-pm]");
  if (!btn || btn.disabled || !pmState || !pmCtx) return;
  pmAction(btn.dataset.pm, btn.dataset);
}
el("pmHolder").addEventListener("click", pmOnClick);
el("pmActions").addEventListener("click", pmOnClick);
el("pmHolder").addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.id === "pmNameInput") { e.preventDefault(); pmAction("start-typed", {}); }
});

/* ---------- Player notes (see notes.js) ----------
 * Two stages, on purpose:
 *   1. DRAFTS — what you type during a game. Saved on THIS device as you type (works with no
 *      signal, costs nothing, can't touch your season data).
 *   2. SAVED NOTES — dated entries stored with the opponent in your cloud data, shown on the
 *      Notes tab. A draft becomes a saved note when you tap Save.
 * Saving never trusts this device's in-memory copy of your data. It re-reads the latest copy
 * from the server, adds the note to THAT, and writes it back — so it can't overwrite games
 * imported elsewhere, and if the server can't be reached it writes nothing at all.
 */

let gcPnDrafts = {};   // unsaved notes for the Game Day team: { "C Davis": "text" }
let gcPnDraftKey = ""; // which opponent+team gcPnDrafts belongs to
let gcPnUi = { editingId: null, msg: "", busy: false };
let gcPnPage = null;   // { oppId, team, roster } for the Notes tab (set by renderGcReports)

function gcPnDraftStorageKey(key) { return "diamond-gameday-notes:" + key; }

function gcPnLoadDrafts(key) {
  try { return pnSanitizeDrafts(JSON.parse(localStorage.getItem(gcPnDraftStorageKey(key)))); }
  catch (e) { return {}; }
}

function gcPnWriteDrafts(key, drafts) {
  if (!key) return;
  try {
    if (pnDraftPlayers(drafts).length) localStorage.setItem(gcPnDraftStorageKey(key), JSON.stringify(drafts));
    else localStorage.removeItem(gcPnDraftStorageKey(key));
  } catch (e) { /* drafts just won't survive a reload */ }
}

function gcPnSaved() {
  const opp = currentOpponent();
  return (opp && opp.playerNotes) || {};
}

function gcPnErrorText(err) {
  if (err && err.message === "NO_OPP") return "This opponent isn't in your saved data yet, so the note couldn't be saved. Your draft is still on this device.";
  return "Couldn't reach the server, so nothing was saved. Your notes are still safe on this device — try again when you have signal.";
}

// Re-reads the latest saved data, applies the change to it, and writes it back.
async function gcPnCommit(oppId, mutate) {
  const fresh = await loadStateStrict();        // throws if the server can't be reached -> nothing is written
  const opp = fresh && fresh.opponents && fresh.opponents[oppId];
  if (!opp) throw new Error("NO_OPP");
  if (!opp.playerNotes || typeof opp.playerNotes !== "object") opp.playerNotes = {};
  mutate(opp.playerNotes);
  await saveState(fresh);
  const mine = state.opponents[oppId];          // keep this page's copy in step
  if (mine) mine.playerNotes = opp.playerNotes;
}

// Turns drafts into saved notes. Returns how many were saved. A draft is only cleared if it
// hasn't changed while the save was in flight.
async function gcPnSaveDraftsFor(oppId, team, names) {
  const key = `${oppId}::${team}`;
  const drafts = key === gcPnDraftKey ? gcPnDrafts : gcPnLoadDrafts(key);
  const snapshot = {};
  names.forEach(n => { const t = String(drafts[n] || "").trim(); if (t) snapshot[n] = t; });
  const players = Object.keys(snapshot);
  if (!players.length) return 0;
  const nowIso = new Date().toISOString();
  await gcPnCommit(oppId, notes => { players.forEach(n => pnAdd(notes, team, n, snapshot[n], nowIso, "gameday")); });
  players.forEach(n => { if (String(drafts[n] || "").trim() === snapshot[n]) delete drafts[n]; });
  gcPnWriteDrafts(key, drafts);
  return players.length;
}

async function gcPnSaveFromGameDay(names) {
  const ui = gcGdUi;
  if (ui.notesBusy || !gcGdCtx) return;
  const list = names || pnDraftPlayers(gcPnDrafts);
  ui.notesBusy = true; ui.notesMsg = "Saving…"; renderGameDay();
  try {
    const n = await gcPnSaveDraftsFor(gcGdCtx.oppId, gcGdCtx.team, list);
    ui.notesMsg = n ? `Saved ${n} note${n === 1 ? "" : "s"} ✓` : "Nothing to save yet — type a note first.";
  } catch (err) {
    ui.notesMsg = gcPnErrorText(err);
  }
  ui.notesBusy = false;
  renderGameDay();
  renderGcNotesPage();
}

/* ----- the Notes tab ----- */

function renderGcNotesPage() {
  if (!gcPnPage) return;
  const { oppId, team, roster } = gcPnPage;
  const key = `${oppId}::${team}`;
  el("gcNotesHolder").innerHTML = pnRenderPage({
    team, roster,
    playerNotes: gcPnSaved(),
    drafts: key === gcPnDraftKey ? gcPnDrafts : gcPnLoadDrafts(key),
    editingId: gcPnUi.editingId, msg: gcPnUi.msg, busy: gcPnUi.busy,
  });
}

// Runs one change against the saved notes, with a "Saving…" state. Returns true on success.
async function gcPnRun(oppId, mutate, okMsg) {
  gcPnUi.busy = true; gcPnUi.msg = "Saving…"; renderGcNotesPage();
  let ok = false;
  try {
    await gcPnCommit(oppId, mutate);
    gcPnUi.msg = okMsg; gcPnUi.editingId = null; ok = true;
  } catch (err) {
    gcPnUi.msg = gcPnErrorText(err);
  }
  gcPnUi.busy = false;
  renderGcNotesPage();
  if (ok) { renderGameDay(); renderPitcherMode(); } // keep note counts current
  return ok;
}

el("gcNotesHolder").addEventListener("click", async e => {
  const btn = e.target.closest("[data-pn]");
  if (!btn || !gcPnPage || gcPnUi.busy) return;
  const act = btn.dataset.pn, id = btn.dataset.id;
  const { oppId, team } = gcPnPage;
  const field = elId => { const f = document.getElementById(elId); return f ? f.value : ""; };

  if (act === "add") {
    const player = field("pnAddPlayer"), text = field("pnAddText");
    const keep = () => { // re-draw keeps what was typed when the save didn't go through
      document.getElementById("pnAddPlayer").value = player;
      document.getElementById("pnAddText").value = text;
    };
    if (!player) { gcPnUi.msg = "Choose a player first."; renderGcNotesPage(); keep(); return; }
    if (!text.trim()) { gcPnUi.msg = "Write a note first."; renderGcNotesPage(); keep(); return; }
    const ok = await gcPnRun(oppId, notes => { pnAdd(notes, team, player, text, new Date().toISOString(), "notes"); }, `Note added to ${player} ✓`);
    if (!ok) keep();
  } else if (act === "edit") {
    gcPnUi.editingId = id; gcPnUi.msg = ""; renderGcNotesPage();
  } else if (act === "cancel-edit") {
    gcPnUi.editingId = null; gcPnUi.msg = ""; renderGcNotesPage();
  } else if (act === "save-edit") {
    const text = field("pnEditText");
    if (!text.trim()) { gcPnUi.msg = "A note can't be blank — use Delete to remove it."; renderGcNotesPage(); document.getElementById("pnEditText").value = text; return; }
    const ok = await gcPnRun(oppId, notes => { pnUpdate(notes, id, text, new Date().toISOString()); }, "Note updated ✓");
    if (!ok && document.getElementById("pnEditText")) document.getElementById("pnEditText").value = text;
  } else if (act === "delete") {
    if (!confirm("Delete this note? This can't be undone.")) return;
    await gcPnRun(oppId, notes => { pnDelete(notes, id); }, "Note deleted.");
  } else if (act === "save-drafts") {
    const key = `${oppId}::${team}`;
    const names = pnDraftPlayers(key === gcPnDraftKey ? gcPnDrafts : gcPnLoadDrafts(key));
    gcPnUi.busy = true; gcPnUi.msg = "Saving…"; renderGcNotesPage();
    try {
      const n = await gcPnSaveDraftsFor(oppId, team, names);
      gcPnUi.msg = n ? `Saved ${n} note${n === 1 ? "" : "s"} ✓` : "Nothing to save.";
    } catch (err) {
      gcPnUi.msg = gcPnErrorText(err);
    }
    gcPnUi.busy = false;
    renderGcNotesPage();
    renderGameDay();
  }
});

function renderGcTeamSnapshot(totalsArray) {
  const sum = key => totalsArray.reduce((a, t) => a + (t[key] || 0), 0);
  const box = (label, value) => `<div class="stat-box"><div class="label">${label}</div><div class="value">${value}</div></div>`;
  el("gcTeamSnapshot").innerHTML =
    box("BIP", sum("BIP")) + box("K", sum("K")) + box("BB", sum("BB")) +
    box("SB", sum("SB")) + box("CS", sum("CS")) + box("BUNT", sum("BUNT")) + box("XBH", sum("XBH"));
}

function renderGcReports() {
  const opp = currentOpponent();
  const summaryHolder = el("gcHitterSummaryHolder");
  const damageBody = document.querySelector("#gcDamageTable tbody");
  const sprayHolder = el("gcSprayChartHolder");
  const cardPicker = el("gcPlayerCardPicker");
  const teamFilter = el("gcTeamFilter");

  if (!opp || !(opp.gameLogs || []).length) {
    el("gcTeamSnapshot").innerHTML = "";
    summaryHolder.innerHTML = `<p class="hint">No games imported yet for this opponent.</p>`;
    damageBody.innerHTML = `<tr><td colspan="7">No games imported yet.</td></tr>`;
    sprayHolder.innerHTML = "";
    teamFilter.innerHTML = `<option value="">All Teams</option>`;
    el("gcSprayPlayerPicker").innerHTML = `<option value="">All Players</option>`;
    cardPicker.innerHTML = `<option value="">Select a player…</option>`;
    el("gcPlayerCardHolder").innerHTML = "";
    el("gcSwingDecPicker").innerHTML = `<option value="">— none —</option>`;
    el("gcSwingDecHolder").innerHTML = "";
    el("gcPitchingReportHolder").innerHTML = "";
    gcGdSource = null; gcGdRefresh(); pmRefresh();
    gcPnPage = null; el("gcNotesHolder").innerHTML = `<p class="hint">Import at least one game, then pick a team to see its notes.</p>`;
    lastGcTotalsArray = [];
    return;
  }

  const allEvents = gcAllEvents(opp);
  const allSteals = gcAllSteals(opp);
  const allScores = gcAllScores(opp);
  const allTotals = aggregateGameLogStats(allEvents, allSteals, allScores, gcAllFieldingErrors(opp), gcAllPickedOff(opp), gcAllFieldingPutouts(opp));
  const allTotalsArray = Object.values(allTotals);

  // Populate the team filter from distinct team names actually seen, preserving selection.
  const teamNames = [...new Set(allTotalsArray.map(t => t.team).filter(Boolean))].sort();
  const prevTeamSelection = teamFilter.value;
  teamFilter.innerHTML = `<option value="">All Teams</option>` +
    teamNames.map(name => `<option value="${name}">${name}</option>`).join("");
  if (teamNames.includes(prevTeamSelection)) teamFilter.value = prevTeamSelection;
  const selectedTeam = teamFilter.value;

  gcGdSource = { oppId: opp.id, teamNames, allTotalsArray, allEvents, allSteals, gameLogs: opp.gameLogs || [] };
  gcGdRefresh();
  pmRefresh();

  const events = selectedTeam ? allEvents.filter(e => e.team === selectedTeam) : allEvents;
  const totalsArray = (selectedTeam ? allTotalsArray.filter(t => t.team === selectedTeam) : allTotalsArray)
    .sort((a, b) => b.BIP - a.BIP);
  lastGcTotalsArray = totalsArray;

  const gpMap = computeGamesPlayed(opp.gameLogs, selectedTeam);

  renderGcTeamSnapshot(totalsArray);
  summaryHolder.innerHTML = renderHitterSummaryTable(totalsArray, gpMap);
  damageBody.innerHTML = renderGcDamageTable(totalsArray);

  const gcSprayPicker = el("gcSprayPlayerPicker");
  const prevPlayerSelection = gcSprayPicker.value;
  gcSprayPicker.innerHTML = `<option value="">All Players</option>` +
    totalsArray.map(t => `<option value="${t.name}">${t.name}</option>`).join("");
  if (totalsArray.some(t => t.name === prevPlayerSelection)) gcSprayPicker.value = prevPlayerSelection;

  function renderGcSpray() {
    const pick = gcSprayPicker.value;
    if (pick) {
      const chartHtml = renderZoneHeatChart(events.filter(e => e.batter === pick), pick);
      const t = allTotals[pick];
      const countTableHtml = t ? renderCountTable(t.pitchCounts || {}, t.countXBH || {}, pick.toUpperCase()) : "";
      // The zone-heat chart has a color-scale legend above its black header bar; the count
      // table doesn't have an equivalent, so without this it sits higher. An invisible copy
      // of that same legend markup pushes the table down by exactly the right amount to
      // line up both black bars, regardless of how fonts render on a given screen.
      const alignmentSpacer = `<div style="visibility:hidden;">${renderZoneHeatLegend()}</div>`;
      sprayHolder.innerHTML = `
        <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;">
          <div style="flex:0 1 480px;min-width:320px;">${chartHtml}</div>
          <div style="flex:1 1 320px;min-width:320px;">${alignmentSpacer}${countTableHtml}</div>
        </div>`;
    } else {
      sprayHolder.innerHTML = renderSprayChartFromEvents(events, "", selectedTeam);
    }
  }
  renderGcSpray();
  gcSprayPicker.onchange = renderGcSpray;

  el("btnTop9Spray").onclick = () => {
    const top9 = totalsArray.filter(t => t.AB > 0).sort((a, b) => b.AB - a.AB).slice(0, 9);
    if (!top9.length) { el("gcMsg").textContent = "No at-bats recorded yet for this team."; return; }
    const playersWithEvents = top9.map(t => ({ name: t.name, events: events.filter(e => e.batter === t.name) }));
    const gridHtml = renderTopSprayGrid(playersWithEvents, selectedTeam || opp.name, top9.length);
    openPrintWindow(opp.name, "Top " + top9.length + " Spray Charts", gridHtml);
  };

  cardPicker.innerHTML = `<option value="">Select a player…</option>` +
    totalsArray.map(t => `<option value="${t.name}">${t.name}</option>`).join("");
  el("gcPlayerCardHolder").innerHTML = "";

  const pitchingTotals = aggregatePitchingStats(allEvents, allScores, gcAllOutsLog(opp));
  const btnStd = el("btnPdpStandard"), btnDev = el("btnPdpDev"), btnDefense = el("btnPdpDefense");

  function renderCardContent() {
    if (gcCardViewMode === "defense") {
      el("gcPlayerCardHolder").innerHTML = renderDefensiveStatsTable(totalsArray, gpMap);
      btnStd.style.fontWeight = "400";
      btnDev.style.fontWeight = "400";
      btnDefense.style.fontWeight = "700";
      return;
    }
    const pick = cardPicker.value;
    if (!pick) { el("gcPlayerCardHolder").innerHTML = ""; return; }
    const teamLabel = allTotals[pick] && allTotals[pick].team ? allTotals[pick].team : (opp ? opp.name : "");
    if (gcCardViewMode === "dev") {
      const dateLabel = new Date().toLocaleString("en-US", { month: "long", year: "numeric" }).toUpperCase();
      el("gcPlayerCardHolder").innerHTML = renderPlayerDevelopmentPlan(allTotals[pick], pitchingTotals[pick], teamLabel, dateLabel);
    } else {
      const playerEvents = allEvents.filter(e => e.batter === pick);
      el("gcPlayerCardHolder").innerHTML = renderContactProfileCard(allTotals[pick], playerEvents, teamLabel);
    }
    btnStd.style.fontWeight = gcCardViewMode === "dev" ? "400" : "700";
    btnDev.style.fontWeight = gcCardViewMode === "dev" ? "700" : "400";
    btnDefense.style.fontWeight = "400";
  }
  cardPicker.onchange = renderCardContent;
  btnStd.onclick = () => { gcCardViewMode = "standard"; renderCardContent(); };
  btnDev.onclick = () => { gcCardViewMode = "dev"; renderCardContent(); };
  btnDefense.onclick = () => { gcCardViewMode = "defense"; renderCardContent(); };
  renderCardContent();

  const swingDecPicker = el("gcSwingDecPicker");
  const prevSwingDecSelection = swingDecPicker.value;
  swingDecPicker.innerHTML = `<option value="">— none —</option>` +
    totalsArray.map(t => `<option value="${t.name}">${t.name}</option>`).join("");
  if (totalsArray.some(t => t.name === prevSwingDecSelection)) swingDecPicker.value = prevSwingDecSelection;

  function renderSwingDec() {
    const teamLabel = selectedTeam || (opp ? opp.name : "");
    const pick = swingDecPicker.value;
    const teamSteals = selectedTeam ? allSteals.filter(s => s.team === selectedTeam) : allSteals;
    el("gcSwingDecHolder").innerHTML = renderSwingDecisionsReport(totalsArray, teamLabel, pick, pick ? allTotals[pick] : null, teamSteals);
  }
  renderSwingDec();
  swingDecPicker.onchange = renderSwingDec;

  const pitchHolder = el("gcPitchingReportHolder");
  const tendenciesHolder = el("gcTendenciesHolder");
  const trendsHolder = el("gcTrendsHolder");
  if (!selectedTeam) {
    pitchHolder.innerHTML = `<p class="hint">Select a specific team from the Team filter above to see its pitching staff report.</p>`;
    tendenciesHolder.innerHTML = `<p class="hint">Select a specific team from the Team filter above to see its team tendencies.</p>`;
    trendsHolder.innerHTML = `<p class="hint">Select a specific team from the Team filter above to see its performance trends.</p>`;
    gcPnPage = null; el("gcNotesHolder").innerHTML = `<p class="hint">Select a specific team from the Team filter above to see its notes.</p>`;
  } else {
    const staffData = computeStaffReport(opp.gameLogs, selectedTeam);
    const teamPitchEvents = allEvents.filter(e => e.pitcherTeam === selectedTeam);
    const teamPitchScores = allScores.filter(s => s.pitcherTeam === selectedTeam);
    const teamOutsLog = gcAllOutsLog(opp).filter(o => o.team === selectedTeam);
    const teamWildPitches = gcAllWildPitches(opp).filter(w => w.team === selectedTeam);
    const seasonPitching = aggregatePitchingStats(teamPitchEvents, teamPitchScores, teamOutsLog, teamWildPitches);
    pitchHolder.innerHTML = Object.keys(seasonPitching).length
      ? renderPitchingScoutReport(selectedTeam, seasonPitching, staffData)
      : `<p class="hint">No pitching data recorded yet for ${selectedTeam}.</p>`;

    const teamTotalsArray = allTotalsArray.filter(t => t.team === selectedTeam);
    tendenciesHolder.innerHTML = teamTotalsArray.length
      ? renderTeamTendencies(selectedTeam, computeTeamTendencies(teamTotalsArray, seasonPitching, staffData.totalGames))
        + `<div style="margin-top:16px;">${renderCurrentPerformance(computeTeamCurrentPerformance(teamTotalsArray))}${renderTopPerformers(computeTopPerformers(teamTotalsArray))}</div>`
      : `<p class="hint">No data recorded yet for ${selectedTeam}.</p>`;

    gcPnPage = { oppId: opp.id, team: selectedTeam, roster: totalsArray.map(t => t.name) };
    renderGcNotesPage();

    const halfSplit = gcComputeHalfSplit(opp, selectedTeam);
    const recentSplit = gcComputeRecentSplit(opp, selectedTeam, 5);

    const btnTrendsTeam = el("btnTrendsTeam"), btnTrendsPlayers = el("btnTrendsPlayers"), statPicker = el("gcTrendsStatPicker");
    const statLabels = { avg: "AVG", obp: "OBP", slg: "SLG", ops: "OPS" };

    function renderTrendsContent() {
      if (gcTrendsViewMode === "players") {
        statPicker.style.display = "";
        const topPlayers = gcTopPlayersByPA(opp, selectedTeam, 6);
        const { labels, series } = gcComputePlayerTrendSeries(opp, selectedTeam, statPicker.value, topPlayers);
        trendsHolder.innerHTML = renderPlayerTrendsPanel(selectedTeam, labels, series, statPicker.value, statLabels[statPicker.value]);
      } else {
        statPicker.style.display = "none";
        trendsHolder.innerHTML = renderPerformanceTrends(selectedTeam, halfSplit, recentSplit);
      }
      btnTrendsTeam.style.fontWeight = gcTrendsViewMode === "players" ? "400" : "700";
      btnTrendsPlayers.style.fontWeight = gcTrendsViewMode === "players" ? "700" : "400";
    }
    btnTrendsTeam.onclick = () => { gcTrendsViewMode = "team"; renderTrendsContent(); };
    btnTrendsPlayers.onclick = () => { gcTrendsViewMode = "players"; renderTrendsContent(); };
    statPicker.onchange = renderTrendsContent;
    renderTrendsContent();
  }

  teamFilter.onchange = renderGcReports;
}

el("btnExportGcCsv").addEventListener("click", () => {
  const opp = currentOpponent();
  if (!lastGcTotalsArray.length) { el("gcMsg").textContent = "No games imported yet."; return; }
  downloadText(`${(opp ? opp.name : "opponent").replace(/\s+/g, "_")}_gamelog_summary.csv`, totalsToCsv(lastGcTotalsArray));
});

// Opens a print-ready window containing just the given HTML content, styled
// consistently, and triggers the browser's print dialog once it's loaded.
function openPrintWindow(title, subtitle, contentHtml) {
  const win = window.open("", "_blank");
  if (!win) { alert("Your browser blocked the print window popup. Please allow popups for this site and try again."); return; }
  win.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${title}</title>
      <meta charset="UTF-8" />
      <style>
        body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 20px; color: #1c2733; }
        h1 { font-size: 1.2rem; margin-bottom: 12px; }
        table.data-table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: .82rem; }
        table.data-table th, table.data-table td { border: 1px solid #d8dee3; padding: 5px 7px; text-align: center; }
        table.data-table th { background: #eef2f5; }
        table.data-table td:nth-child(2) { text-align: left; }
        .hint { color: #5c6b78; font-size: .8rem; }
        svg { max-width: 100%; }
        @media print {
          @page { size: landscape; margin: 12mm; }
        }
      </style>
    </head>
    <body>
      <h1>${title}${subtitle ? " — " + subtitle : ""}</h1>
      ${contentHtml}
    </body>
    </html>
  `);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}

// Combines several already-rendered panels into one printable document, each
// forced onto its own page. Sections with no content (e.g. Player Card when
// no player is selected) get a plain placeholder instead of a blank page.
function openPrintPacket(packetTitle, teamLabel, sections) {
  const win = window.open("", "_blank");
  if (!win) { alert("Your browser blocked the print window popup. Please allow popups for this site and try again."); return; }

  const pages = sections.map(s => {
    const hasContent = s.html && s.html.replace(/<[^>]*>/g, "").trim().length > 0;
    return `
      <section class="packet-page">
        <h1>${s.title}${teamLabel ? " — " + teamLabel : ""}</h1>
        ${hasContent ? s.html : `<p class="hint">Nothing to show here yet — this panel had no data or no selection when the packet was printed.</p>`}
      </section>`;
  }).join("");

  win.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${packetTitle}</title>
      <meta charset="UTF-8" />
      <style>
        body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 0; color: #1c2733; }
        h1 { font-size: 1.2rem; margin: 0 0 12px; }
        h2 { font-size: 1.05rem; }
        table.data-table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: .82rem; }
        table.data-table th, table.data-table td { border: 1px solid #d8dee3; padding: 5px 7px; text-align: center; }
        table.data-table th { background: #eef2f5; }
        table.data-table td:nth-child(2) { text-align: left; }
        .hint { color: #5c6b78; font-size: .8rem; }
        svg { max-width: 100%; }
        select, input { display: none; } /* pickers from a live panel don't make sense printed */
        .packet-page { padding: 20px; page-break-after: always; break-after: page; }
        .packet-page:last-child { page-break-after: auto; break-after: auto; }
        @media print {
          @page { size: landscape; margin: 12mm; }
        }
      </style>
    </head>
    <body>
      ${pages}
    </body>
    </html>
  `);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}

function printPanel(btnId, holderId, subtitle, emptyCheck) {
  el(btnId).addEventListener("click", () => {
    const opp = currentOpponent();
    if (emptyCheck && emptyCheck()) { el("gcMsg").textContent = "No games imported yet."; return; }
    openPrintWindow(opp ? opp.name : "Duncan Demon Diamond Analytics", subtitle, el(holderId).innerHTML);
  });
}

printPanel("btnPrintSeasonSummary", "gcHitterSummaryHolder", "Season Summary", () => !lastGcTotalsArray.length);
printPanel("btnPrintDamage", "gcDamageHolder", "Damage Report", () => !lastGcTotalsArray.length);
printPanel("btnPrintSpray", "gcSprayChartHolder", "Spray Chart", () => !lastGcTotalsArray.length);
printPanel("btnPrintCard", "gcPlayerCardHolder", "Player Card", () => !lastGcTotalsArray.length);
printPanel("btnPrintSwingDec", "gcSwingDecHolder", "Swing Decisions", () => !lastGcTotalsArray.length);
printPanel("btnPrintPitching", "gcPitchingReportHolder", "Pitching Scout Report", () => !lastGcTotalsArray.length);
printPanel("btnPrintTendencies", "gcTendenciesHolder", "Team Tendencies", () => !lastGcTotalsArray.length);
printPanel("btnPrintTrends", "gcTrendsHolder", "Performance Trends", () => !lastGcTotalsArray.length);

el("btnPrintGcReport").addEventListener("click", () => window.print());

el("btnPrintPacket").addEventListener("click", () => {
  if (!lastGcTotalsArray.length) { el("gcMsg").textContent = "No games imported yet."; return; }
  const opp = currentOpponent();
  const teamLabel = el("gcTeamFilter").value || (opp ? opp.name : "");

  const sections = [
    { title: "Season Summary", html: el("gcHitterSummaryHolder").innerHTML },
    { title: "Damage Report", html: el("gcDamageHolder").innerHTML },
    { title: "Spray Chart", html: el("gcSprayChartHolder").innerHTML },
    { title: "Player Card", html: el("gcPlayerCardHolder").innerHTML },
    { title: "Swing Decisions", html: el("gcSwingDecHolder").innerHTML },
    { title: "Pitching Scout Report", html: el("gcPitchingReportHolder").innerHTML },
    { title: "Team Tendencies", html: el("gcTendenciesHolder").innerHTML },
    { title: "Performance Trends", html: el("gcTrendsHolder").innerHTML },
  ];

  openPrintPacket(opp ? opp.name : "Duncan Demon Diamond Analytics", teamLabel, sections);
});

/* ----- Dugout Card / Positioning Card (see cards.js) ----- */
// From the Import Game Log tab: uses the Team filter.
function printGameCard(kind) {
  if (!lastGcTotalsArray.length) { el("gcMsg").textContent = "No games imported yet."; return; }
  const team = el("gcTeamFilter").value;
  if (!team) {
    alert("Pick their team in the Team filter first (above the report tabs) — the cards are built for one team.");
    return;
  }
  printGameCardFor(kind, currentOpponent(), team);
}

// From Game Day: uses the team picked there.
function printGameCardFromGameDay(kind) {
  if (!gcGdCtx) return;
  const opp = state.opponents[gcGdCtx.oppId] || currentOpponent();
  if (!opp) return;
  printGameCardFor(kind, opp, gcGdCtx.team);
}

function printGameCardFor(kind, opp, team) {
  const win = window.open("", "_blank");
  if (!win) { alert("Your browser blocked the print window popup. Please allow popups for this site and try again."); return; }
  // If a Game Day lineup is set for this team on this device, the cards use that order.
  let gdLineup = [];
  try { gdLineup = gcGdLoad(`${opp.id}::${team}`).lineup || []; } catch (e) { gdLineup = []; }
  const data = cardBuildData(opp, team, gdLineup, new Date());
  const oppName = opp ? opp.name : "";
  const doc = kind === "dugout"
    ? cardPrintDocument(`Dugout Card — ${team}`, cardDugoutHtml(data, oppName), true)
    : cardPrintDocument(`Positioning Card — ${team}`, cardPositioningHtml(data, oppName), false);
  win.document.write(doc);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}
el("btnPrintDugoutCard").addEventListener("click", () => printGameCard("dugout"));
el("btnPrintPositioningCard").addEventListener("click", () => printGameCard("positioning"));

/* ---------- Init ---------- */

function renderAll() {
  refreshOpponentPicker();
  renderGcGamesTable();
  renderGcReports();
}
