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

  if (!opp.gameLogs) opp.gameLogs = [];

  let gamesAdded = 0, totalEvents = 0, totalErrorLines = 0, skippedGames = 0;
  let lastHomeUsed = "", lastVisitorUsed = "";
  const consoleWarnings = [];

  gameTexts.forEach((text, idx) => {
    const parsed = parseGameLogText(text);
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
    const parsed = parseGameLogText(g.rawText);
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
      sprayHolder.innerHTML = renderZoneHeatChart(events.filter(e => e.batter === pick), pick);
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
  if (!selectedTeam) {
    pitchHolder.innerHTML = `<p class="hint">Select a specific team from the Team filter above to see its pitching staff report.</p>`;
    tendenciesHolder.innerHTML = `<p class="hint">Select a specific team from the Team filter above to see its team tendencies.</p>`;
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

el("btnPrintGcReport").addEventListener("click", () => window.print());

/* ---------- Init ---------- */

function renderAll() {
  refreshOpponentPicker();
  renderGcGamesTable();
  renderGcReports();
}
