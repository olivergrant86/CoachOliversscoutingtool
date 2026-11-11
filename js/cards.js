/* cards.js — the two one-page printouts for game day:
 *   • Dugout Card (Letter landscape): their lineup with a threat level, a one-line "how to
 *     handle him", steals and bunts, plus their pitchers, team tendencies and note lines.
 *   • Positioning Card (Letter portrait): a mini field per hitter showing where his balls in
 *     play go, where to stand, and a one-line call.
 *
 * Everything comes from the imported GameChanger games. All the "rules" (threat levels,
 * when to shift, etc.) are the CARD_* constants right below, so they're easy to tune.
 * Every global starts with card/CARD_ so it can't collide with the other script files.
 */

// ---------- tunable rules ----------
const CARD_MIN_PA = 15;            // fewer PA than this → "LIMITED DATA" instead of a threat level
const CARD_HIGH_OPS = 0.850;       // HIGH threat at this OPS or better...
const CARD_HIGH_HR = 3;            // ...or this many HR
const CARD_LOW_OPS = 0.650;        // LOW threat under this OPS
const CARD_MIN_BIP_SHIFT = 8;      // balls in play needed before the positioning card makes a call
const CARD_SIDE_PCT = 45;          // shade toward a side when this % of located balls in play go there
const CARD_SIDE_STRONG = 55;       // ...and shade harder at this %
const CARD_BUNTS_CORNERS_IN = 4;   // corners in at this many bunts
const CARD_RED_SB = 8;             // highlight steals at this many
const CARD_RED_BUNTS = 5;          // highlight bunts at this many

const CARD_INK = "#1c2733", CARD_MUTED = "#5c6b78", CARD_RED = "#b3352c", CARD_BORDER = "#c9d1d8";
const CARD_LEFT = new Set([5, 6, 7]), CARD_CENTER = new Set([1, 2, 8]), CARD_RIGHT = new Set([3, 4, 9]);

function cardEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function cardAvg(v) { return v.toFixed(3).replace(/^0/, ""); }
function cardPct(a, b) { return b ? Math.round((a / b) * 100) : 0; }

/* ===================== data ===================== */

// Their batting order: Game Day's lineup if one is set, otherwise the most common
// order across the imported games (each slot gets the name that hit there most often).
function cardLineup(gameLogs, team, totalsByName, gameDayLineup) {
  const typed = (gameDayLineup || []).map(n => String(n || "").trim()).filter(Boolean);
  if (typed.length) return { names: typed, source: "Game Day lineup" };

  const tally = {}; // slot -> name -> { n, last }
  let games = 0;
  (gameLogs || []).forEach((g, gi) => {
    const order = [];
    (g.events || []).forEach(e => { if (e.team === team && !order.includes(e.batter)) order.push(e.batter); });
    if (!order.length) return;
    games++;
    order.slice(0, 9).forEach((name, slot) => {
      const s = tally[slot] || (tally[slot] = {});
      const x = s[name] || (s[name] = { n: 0, last: -1 });
      x.n++; x.last = gi;
    });
  });
  const cands = [];
  Object.keys(tally).forEach(slot => Object.keys(tally[slot]).forEach(name => cands.push({ slot: +slot, name, n: tally[slot][name].n, last: tally[slot][name].last })));
  cands.sort((a, b) => b.n - a.n || b.last - a.last);
  const slots = new Array(9).fill(null), used = new Set();
  cands.forEach(c => { if (!slots[c.slot] && !used.has(c.name)) { slots[c.slot] = c.name; used.add(c.name); } });
  // any slot left empty: best remaining hitter by PA
  const spare = Object.values(totalsByName).filter(t => t.PA > 0 && !used.has(t.name)).sort((a, b) => b.PA - a.PA);
  for (let i = 0; i < 9; i++) if (!slots[i] && spare.length) { const t = spare.shift(); slots[i] = t.name; used.add(t.name); }
  return { names: slots.filter(Boolean), source: games ? `most common order, ${games} game${games === 1 ? "" : "s"}` : "" };
}

function cardThreat(t) {
  if (!t || t.PA < CARD_MIN_PA) return { level: 0, label: "LIMITED DATA" };
  const m = computeBattingMetrics(t);
  if (m.ops >= CARD_HIGH_OPS || t.HR >= CARD_HIGH_HR) return { level: 3, label: "HIGH" };
  if (m.ops < CARD_LOW_OPS) return { level: 1, label: "LOW" };
  return { level: 2, label: "MED" };
}

// One short "how to handle him" line built from his most notable tendencies.
function cardHandleLine(t) {
  if (!t || !t.PA) return "No plate appearances in the imported games.";
  const out = [];
  const kPct = cardPct(t.K, t.PA);
  const fp = t.pitchCounts && t.pitchCounts["0-0"];
  const fpSwing = fp && fp.total >= 8 ? cardPct(fp.swings, fp.total) : null;
  if (t.XBH >= 4 && t.H && t.XBH / t.H >= 0.35) out.push(`Power threat — ${t.XBH} of ${t.H} hits for extra bases.`);
  if (t.PA >= 20 && kPct >= 25) out.push(`Strikes out ${kPct}% — expand with two strikes.`);
  else if (t.PA >= 20 && kPct <= 10) out.push(`Tough out — strikes out just ${kPct}%.`);
  if (fpSwing != null && fpSwing >= 45) out.push(`Swings ${fpSwing}% at 0-0 — start him with a chase pitch.`);
  else if (fpSwing != null && fpSwing <= 20) out.push(`Takes the first pitch (${100 - fpSwing}%) — steal a strike.`);
  if (t.SB >= CARD_RED_SB) out.push(`Runs — ${t.SB} SB. Be quick to the plate.`);
  if (t.BUNT >= CARD_RED_BUNTS) out.push(`Bunts (${t.BUNT}) — corners ready.`);
  if (!out.length) {
    if (t.PA < CARD_MIN_PA) return `Only ${t.PA} PA — not much to go on.`;
    return "No strong tendencies — pitch him normal.";
  }
  return out.slice(0, 2).join(" ");
}

// Where his located balls in play went, plus the positioning call.
function cardSpray(events) {
  const s = { bip: 0, located: 0, left: 0, center: 0, right: 0, gb: 0, byPos: {} };
  (events || []).forEach(e => {
    if (!e.isBip) return;
    s.bip++;
    if (e.code === "GB") s.gb++;
    if (!e.location) return;
    s.located++;
    s.byPos[e.location] = (s.byPos[e.location] || 0) + 1;
    if (CARD_LEFT.has(e.location)) s.left++;
    else if (CARD_RIGHT.has(e.location)) s.right++;
    else s.center++;
  });
  s.leftPct = cardPct(s.left, s.located);
  s.centerPct = cardPct(s.center, s.located);
  s.rightPct = cardPct(s.right, s.located);
  s.gbPct = cardPct(s.gb, s.bip);
  return s;
}

// Returns { call, da (degrees all fielders slide, − = toward 3B side), ofDr, ifDr, ovr: { pos: [da, dr] } }
function cardPositioning(t, sp) {
  const res = { calls: [], da: 0, ofDr: 0, ovr: {} };
  if (!t || sp.located < CARD_MIN_BIP_SHIFT) {
    res.calls.push(`Only ${sp.located} located ball${sp.located === 1 ? "" : "s"} in play — play him straight up.`);
    return res;
  }
  if (sp.leftPct >= CARD_SIDE_PCT && sp.leftPct > sp.rightPct) {
    const strong = sp.leftPct >= CARD_SIDE_STRONG;
    res.da = strong ? -12 : -7;
    res.calls.push(`${sp.leftPct}% to the left side — shade everyone ${strong ? "a full step" : "a half step"} toward 3B.`);
  } else if (sp.rightPct >= CARD_SIDE_PCT && sp.rightPct > sp.leftPct) {
    const strong = sp.rightPct >= CARD_SIDE_STRONG;
    res.da = strong ? 12 : 7;
    res.calls.push(`${sp.rightPct}% to the right side — shade everyone ${strong ? "a full step" : "a half step"} toward 1B.`);
  }
  const xbhShare = t.H ? t.XBH / t.H : 0;
  if (t.XBH >= 3 && xbhShare >= 0.35) { res.ofDr = 10; res.calls.push(`${t.XBH} XBH — outfield back two steps.`); }
  else if (t.BIP >= 12 && t.XBH <= 1) { res.ofDr = -14; res.calls.push(`No pop (${t.XBH} XBH) — bring the outfield in.`); }
  if (t.BUNT >= CARD_BUNTS_CORNERS_IN) {
    res.ovr["3B"] = [0, -10]; res.ovr["1B"] = [0, -10];
    res.calls.push(`Bunts ${t.BUNT} times — corners in.`);
  }
  if (sp.located >= 12) {
    if (!sp.byPos[9]) { res.ovr.RF = [0, -16]; res.calls.push("Never hits it to right field — RF in."); }
    else if (!sp.byPos[7]) { res.ovr.LF = [0, -16]; res.calls.push("Never hits it to left field — LF in."); }
  }
  if (!res.calls.length) res.calls.push("Sprays it around — play him straight up.");
  return res;
}

// Their pitchers from the imported games, most recently used first.
function cardPitchers(gameLogs, team, today) {
  const map = {};
  (gameLogs || []).forEach((g, gi) => {
    const evs = (g.events || []).filter(e => e.pitcherTeam === team && e.pitcher);
    if (!evs.length) return;
    const starter = evs[0].pitcher;
    const per = {};
    evs.forEach(e => {
      const p = per[e.pitcher] || (per[e.pitcher] = { pitches: 0, strikes: 0 });
      (e.pitches || []).forEach(x => { p.pitches++; if (x.type !== "ball") p.strikes++; });
    });
    Object.keys(per).forEach(name => {
      const m = map[name] || (map[name] = { name, games: 0, starts: 0, pitches: 0, strikes: 0, last: null });
      m.games++; m.pitches += per[name].pitches; m.strikes += per[name].strikes;
      if (name === starter) m.starts++;
      const outing = { gi, date: g.gameDate || null, pitches: per[name].pitches, started: name === starter };
      if (!m.last || gi > m.last.gi) m.last = outing;
    });
  });
  const list = Object.values(map);
  list.forEach(p => {
    p.strikePct = cardPct(p.strikes, p.pitches);
    if (p.last && p.last.date) {
      const d = new Date(p.last.date + "T12:00:00");
      p.daysSince = Math.round((today - d) / 86400000);
    } else p.daysSince = null;
  });
  const mostStarts = list.reduce((best, p) => (p.starts > (best ? best.starts : 0) ? p : best), null);
  list.sort((a, b) => (b.last ? b.last.gi : -1) - (a.last ? a.last.gi : -1) || b.pitches - a.pitches);
  return { list, topStarter: mostStarts ? mostStarts.name : null };
}

function cardTeamTendencies(totalsArray, games) {
  const sum = k => totalsArray.reduce((a, t) => a + (t[k] || 0), 0);
  const SB = sum("SB"), CS = sum("CS"), BUNT = sum("BUNT"), PA = sum("PA"), K = sum("K");
  let fpS = 0, fpT = 0, twoS = 0, twoT = 0;
  totalsArray.forEach(t => {
    Object.keys(t.pitchCounts || {}).forEach(c => {
      const x = t.pitchCounts[c];
      if (c === "0-0") { fpS += x.swings; fpT += x.total; }
      if (c.endsWith("-2")) { twoS += x.swings; twoT += x.total; }
    });
  });
  const g = Math.max(games, 1);
  return [
    ["Steals", `${SB}-${CS} SB-CS in ${games} game${games === 1 ? "" : "s"} (${(SB + CS) / g >= 1 ? ((SB + CS) / g).toFixed(1) + " attempts a game" : "rarely run"})`],
    ["Bunts", `${BUNT} bunts in play (${(BUNT / g).toFixed(1)} a game)`],
    ["First pitch", fpT ? `Team swings ${cardPct(fpS, fpT)}% at 0-0` : "—"],
    ["Strikeouts", PA ? `Team K% ${cardPct(K, PA)}${twoT ? ` · swing ${cardPct(twoS, twoT)}% with 2 strikes` : ""}` : "—"],
  ];
}

// Everything both cards need for one team.
function cardBuildData(opp, team, gameDayLineup, today) {
  const gameLogs = (opp && opp.gameLogs) || [];
  const allEvents = gameLogs.flatMap(g => g.events || []);
  const teamEvents = allEvents.filter(e => e.team === team);
  const totals = aggregateGameLogStats(
    teamEvents,
    gameLogs.flatMap(g => g.steals || []).filter(s => s.team === team),
    gameLogs.flatMap(g => g.scores || []).filter(s => s.team === team),
    [], [], [] // fielding data isn't needed for these cards
  );
  Object.keys(totals).forEach(k => { if (totals[k].team && totals[k].team !== team) delete totals[k]; });
  const games = gameLogs.filter(g => (g.events || []).some(e => e.team === team)).length;
  const lineup = cardLineup(gameLogs, team, totals, gameDayLineup);
  const evByName = {};
  teamEvents.forEach(e => { (evByName[e.batter] = evByName[e.batter] || []).push(e); });

  const hitters = lineup.names.map((name, i) => {
    const t = totals[name] || null;
    const m = t ? computeBattingMetrics(t) : null;
    const sp = cardSpray(evByName[name]);
    return {
      slot: i + 1, name, t,
      threat: cardThreat(t),
      avg: t && t.AB ? cardAvg(m.avg) : "—",
      ops: t && t.PA ? cardAvg(m.ops) : "—",
      pa: t ? t.PA : 0,
      line: cardHandleLine(t),
      sb: t ? t.SB : 0, cs: t ? t.CS : 0, bunts: t ? t.BUNT : 0,
      spray: sp, pos: cardPositioning(t, sp),
    };
  });
  const inLineup = new Set(lineup.names);
  const bench = Object.values(totals).filter(t => t.PA > 0 && !inLineup.has(t.name)).sort((a, b) => b.PA - a.PA).slice(0, 6)
    .map(t => `${t.name} (${t.PA} PA${t.SB >= 3 ? `, ${t.SB} SB` : ""})`);
  return {
    team, games, lineupSource: lineup.source, hitters, bench,
    pitchers: cardPitchers(gameLogs, team, today),
    tendencies: cardTeamTendencies(Object.values(totals), games),
  };
}

/* ===================== Dugout Card ===================== */

function cardThreatChip(th) {
  if (!th.level) return `<div class="threat"><span class="tl" style="color:${CARD_MUTED};font-size:10px;">LIMITED<br>DATA</span></div>`;
  const dots = [0, 1, 2].map(i => `<span class="dot${i < th.level ? " on" : ""}"></span>`).join("");
  return `<div class="threat"><span class="tl${th.level === 3 ? " hi" : ""}">${th.label}</span><span class="dots">${dots}</span></div>`;
}

function cardDugoutHtml(d, oppName) {
  const rows = d.hitters.map(h => `
    <div class="row${h.threat.level === 3 ? " hot" : ""}">
      <div class="n">${h.slot}</div>
      <div class="nm">${cardEsc(h.name)}</div>
      ${cardThreatChip(h.threat)}
      <div class="avg"><b>${h.avg}</b><span>OPS ${h.ops}</span></div>
      <div class="line">${cardEsc(h.line)}</div>
      <div class="c${h.sb >= CARD_RED_SB ? " red" : ""}">${h.sb}-${h.cs}</div>
      <div class="c${h.bunts >= CARD_RED_BUNTS ? " red" : ""}">${h.bunts}</div>
    </div>`).join("");

  const today = d.pitchers;
  const plist = today.list.slice(0, 4).map(p => {
    const tag = p.name === today.topStarter && p.starts ? "MOST STARTS" : (p.starts ? `${p.starts} START${p.starts === 1 ? "" : "S"}` : "RELIEF");
    const last = p.last
      ? `Last: ${p.last.pitches} pitches${p.last.started ? " (start)" : ""}${p.daysSince != null ? ` · ${p.daysSince} day${p.daysSince === 1 ? "" : "s"} ago` : " · date unknown"}`
      : "";
    return `
      <div class="pitch${p.name === today.topStarter ? " top" : ""}">
        <div class="ph"><b>${cardEsc(p.name)}</b><span${p.name === today.topStarter ? ` style="color:${CARD_RED}"` : ""}>${tag}</span></div>
        <div class="pd">${cardEsc(last)}</div>
        <div class="pd mut">${p.games} G · ${p.pitches} pitches · ${p.strikePct}% strikes</div>
      </div>`;
  }).join("") || `<p class="mut">No pitchers named in the imported games.</p>`;

  const tend = d.tendencies.map(([a, b]) => `<div class="td"><span>${cardEsc(a.toUpperCase())}</span><div>${cardEsc(b)}</div></div>`).join("");

  return `
  <div class="page dug">
    <div class="bar">
      <div><div class="kick">DUNCAN DEMONS · DUGOUT CARD</div><div class="big">vs. ${cardEsc(d.team)}</div></div>
      <div class="r"><div>${cardEsc(oppName)} · ${d.games} imported game${d.games === 1 ? "" : "s"}</div><div>Lineup: ${cardEsc(d.lineupSource || "—")}</div></div>
    </div>
    <div class="main">
      <div class="tbl">
        <div class="row head"><div class="n">#</div><div>HITTER</div><div>THREAT</div><div>AVG</div><div>HOW TO HANDLE HIM</div><div class="c">SB-CS</div><div class="c">BUNTS</div></div>
        ${rows || `<div class="row"><div></div><div class="line">No hitters found for this team.</div></div>`}
        <div class="bench"><span>BENCH / SUBS SEEN</span><div>${d.bench.length ? cardEsc(d.bench.join(" · ")) : "—"}</div></div>
      </div>
      <div class="side">
        <div class="blk"><div class="bh">THEIR PITCHERS</div>${plist}</div>
        <div class="blk ruled"><div class="bh">TEAM TENDENCIES</div>${tend}</div>
        <div class="blk ruled grow"><div class="bh">IN-GAME NOTES</div><div class="lines"></div></div>
      </div>
    </div>
    <div class="foot"><span>THREAT from OPS and HR (HIGH .850+ OPS or ${CARD_HIGH_HR}+ HR · LOW under .650). Red SB-CS = ${CARD_RED_SB}+ steals · red bunts = ${CARD_RED_BUNTS}+.</span><span>Duncan Demon Diamond Analytics</span></div>
  </div>`;
}

/* ===================== Positioning Card ===================== */

const CARD_BASE = { "1B": [38, 58], "2B": [17, 72], SS: [-17, 72], "3B": [-38, 58], LF: [-28, 100], CF: [0, 110], RF: [28, 100] };
const CARD_OF = new Set(["LF", "CF", "RF"]);

function cardPt(a, r) { const t = a * Math.PI / 180; return [105 + r * Math.sin(t), 146 - r * Math.cos(t)]; }
function cardWedge(a1, a2, r1, r2) {
  const f = p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  const p1 = cardPt(a1, r1), p2 = cardPt(a1, r2), p3 = cardPt(a2, r2), p4 = cardPt(a2, r1);
  return `M${f(p1)} L${f(p2)} A${r2},${r2} 0 0 1 ${f(p3)} L${f(p4)} A${r1},${r1} 0 0 0 ${f(p1)} Z`;
}

function cardFieldSvg(h) {
  const s = [], sp = h.spray, pos = h.pos;
  s.push(`<svg width="210" height="160" viewBox="0 0 210 160" role="img" aria-label="Where to play ${cardEsc(h.name)}">`);
  s.push(`<path d="${cardWedge(-45, 45, 0.01, 125)}" fill="#f1f4f1" stroke="${CARD_BORDER}" stroke-width="1"/>`);
  [[-45, -15, sp.leftPct], [-15, 15, sp.centerPct], [15, 45, sp.rightPct]].forEach(([a1, a2, pct]) => {
    const op = sp.located ? 0.08 + 0.62 * Math.min(pct, 60) / 60 : 0.04;
    s.push(`<path d="${cardWedge(a1, a2, 60, 125)}" fill="${CARD_RED}" fill-opacity="${op.toFixed(2)}" stroke="#ffffff" stroke-width="1.5"/>`);
    const l = cardPt((a1 + a2) / 2, 140);
    s.push(`<text x="${l[0].toFixed(1)}" y="${(l[1] + 4).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="800" fill="${CARD_INK}">${sp.located ? pct + "%" : "—"}</text>`);
  });
  s.push(`<path d="${cardWedge(-45, 45, 0.01, 60)}" fill="#e7dccb"/>`);
  const b1 = cardPt(45, 48), b2 = cardPt(0, 68), b3 = cardPt(-45, 48);
  s.push(`<path d="M105,146 L${b1.join(",")} L${b2.join(",")} L${b3.join(",")} Z" fill="#f1f4f1" stroke="#ffffff"/>`);
  [b1, b2, b3].forEach(b => s.push(`<rect x="${(b[0] - 2.5).toFixed(1)}" y="${(b[1] - 2.5).toFixed(1)}" width="5" height="5" fill="#ffffff" stroke="${CARD_MUTED}" stroke-width="0.8"/>`));
  const fl = cardPt(-45, 125), fr = cardPt(45, 125);
  s.push(`<path d="M105,146 L${fl.join(",")} M105,146 L${fr.join(",")}" stroke="${CARD_MUTED}" stroke-width="1"/>`);
  Object.keys(CARD_BASE).forEach(p => {
    const [a, r] = CARD_BASE[p];
    let da = pos.da, dr = CARD_OF.has(p) ? pos.ofDr : 0;
    if (pos.ovr[p]) { da += pos.ovr[p][0]; dr += pos.ovr[p][1]; }
    const p0 = cardPt(a, r), p1 = cardPt(a + da, r + dr);
    if (Math.abs(p1[0] - p0[0]) + Math.abs(p1[1] - p0[1]) > 2) {
      s.push(`<circle cx="${p0[0].toFixed(1)}" cy="${p0[1].toFixed(1)}" r="5" fill="none" stroke="${CARD_MUTED}" stroke-dasharray="2 2"/>`);
      s.push(`<line x1="${p0[0].toFixed(1)}" y1="${p0[1].toFixed(1)}" x2="${p1[0].toFixed(1)}" y2="${p1[1].toFixed(1)}" stroke="${CARD_INK}" stroke-width="1.2"/>`);
    }
    s.push(`<circle cx="${p1[0].toFixed(1)}" cy="${p1[1].toFixed(1)}" r="6.5" fill="${CARD_INK}"/>`);
    s.push(`<text x="${p1[0].toFixed(1)}" y="${(p1[1] + 2.8).toFixed(1)}" text-anchor="middle" font-size="7.5" font-weight="800" fill="#ffffff">${p}</text>`);
  });
  s.push("</svg>");
  return s.join("");
}

function cardPositioningHtml(d, oppName) {
  const cards = d.hitters.map(h => `
    <div class="pc">
      <div class="pt"><b>${h.slot}. ${cardEsc(h.name)}</b><span>${h.spray.bip ? `GB ${h.spray.gbPct}% · ${h.spray.located} BIP` : "no BIP"}</span></div>
      <div class="pf">${cardFieldSvg(h)}</div>
      <div class="pcall">${cardEsc(h.pos.calls.slice(0, 2).join(" "))}</div>
    </div>`).join("");
  return `
  <div class="page pos">
    <div class="bar">
      <div><div class="kick">DUNCAN DEMONS · DEFENSIVE POSITIONING</div><div class="big">vs. ${cardEsc(d.team)} — where to play them</div></div>
      <div class="r"><div>${cardEsc(oppName)}</div><div>${d.games} game${d.games === 1 ? "" : "s"} of spray data</div></div>
    </div>
    <div class="grid">${cards || `<p>No hitters found for this team.</p>`}</div>
    <div class="foot leg">
      <span><i class="k1"></i>Darker = more of his balls in play go there</span>
      <span><i class="k2"></i>Where to stand</span>
      <span><i class="k3"></i>Normal spot (moved)</span>
    </div>
  </div>`;
}

/* ===================== print document ===================== */

const CARD_CSS = `
  *{box-sizing:border-box;}
  body{margin:0; font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; color:${CARD_INK}; background:#fff;
       -webkit-print-color-adjust:exact; print-color-adjust:exact;}
  .page{display:flex; flex-direction:column; gap:10px; padding:4px;}
  .bar{background:#000; color:#fff; border-radius:8px; padding:8px 14px; display:flex; justify-content:space-between; align-items:center; gap:12px;}
  .kick{font-size:11px; letter-spacing:.12em; color:#d5dce2;}
  .big{font-size:22px; font-weight:900;}
  .bar .r{text-align:right; font-size:12px; color:#d5dce2; line-height:1.5;}
  .mut{color:${CARD_MUTED};}
  .foot{display:flex; justify-content:space-between; gap:14px; font-size:11px; color:${CARD_MUTED}; flex-wrap:wrap;}

  .dug{height:7.6in;}
  .dug .main{display:flex; gap:14px; flex:1 1 auto; min-height:0;}
  .tbl{flex:1 1 auto; border:1.5px solid ${CARD_INK}; border-radius:8px; overflow:hidden; display:flex; flex-direction:column;}
  .row{display:grid; grid-template-columns:28px 120px 58px 70px 1fr 52px 44px; gap:8px; align-items:center; padding:5px 8px;
       border-bottom:1px solid ${CARD_BORDER}; min-height:0.56in;}
  .row.head{background:${CARD_INK}; color:#fff; font-size:10.5px; font-weight:800; letter-spacing:.06em; min-height:0;}
  .row.hot{background:#fbe9e7;}
  .row .n{font-size:20px; font-weight:900; text-align:center;}
  .row .nm{font-size:15px; font-weight:800;}
  .threat{display:flex; flex-direction:column; gap:3px;}
  .threat .tl{font-size:11px; font-weight:900; letter-spacing:.05em;}
  .threat .tl.hi{color:${CARD_RED};}
  .dots{display:flex; gap:3px;}
  .dot{width:9px; height:9px; border-radius:5px; border:1.5px solid #9aa5ae; background:#fff;}
  .dot.on{border-color:${CARD_RED}; background:${CARD_RED};}
  .avg{display:flex; flex-direction:column;} .avg b{font-size:14px;} .avg span{font-size:11px; color:${CARD_MUTED};}
  .line{font-size:12px; line-height:1.3;}
  .row .c{text-align:center; font-size:14px; font-weight:600;}
  .row .c.red{color:${CARD_RED}; font-weight:900;}
  .bench{padding:6px 8px; font-size:12px;} .bench span{font-size:10.5px; font-weight:800; letter-spacing:.06em; color:${CARD_MUTED};}
  .side{width:2.9in; flex:0 0 auto; display:flex; flex-direction:column; gap:10px;}
  .blk{display:flex; flex-direction:column; gap:6px;}
  .blk.ruled{border-top:1.5px solid ${CARD_INK}; padding-top:8px;}
  .blk.grow{flex:1 1 auto;}
  .bh{font-size:12px; font-weight:900; letter-spacing:.08em;}
  .pitch{border:1.5px solid ${CARD_BORDER}; border-radius:8px; padding:5px 9px;}
  .pitch.top{border-color:${CARD_INK};}
  .ph{display:flex; justify-content:space-between; gap:8px; align-items:baseline;} .ph b{font-size:14px;} .ph span{font-size:10.5px; font-weight:900; letter-spacing:.05em;}
  .pd{font-size:11.5px; line-height:1.3;}
  .td span{font-size:10.5px; font-weight:800; letter-spacing:.05em; color:${CARD_MUTED};} .td div{font-size:12px; line-height:1.3;}
  .lines{flex:1 1 auto; min-height:1in; background-image:repeating-linear-gradient(to bottom,transparent 0,transparent 24px,${CARD_BORDER} 24px,${CARD_BORDER} 25px);}

  .pos{height:10.2in;}
  .grid{display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); grid-auto-rows:1fr; gap:8px; flex:1 1 auto; min-height:0;}
  .pc{border:1.5px solid ${CARD_INK}; border-radius:8px; padding:6px 8px 8px; display:flex; flex-direction:column; gap:3px; min-width:0;}
  .pt{display:flex; justify-content:space-between; gap:6px; align-items:baseline;} .pt b{font-size:15px;} .pt span{font-size:10.5px; color:${CARD_MUTED}; white-space:nowrap;}
  .pf{display:flex; justify-content:center;}
  .pcall{font-size:12px; line-height:1.3; font-weight:600;}
  .leg{justify-content:flex-start;}
  .leg i{display:inline-block; vertical-align:-1px; margin-right:4px;}
  .k1{width:14px; height:10px; background:${CARD_RED}; opacity:.7;}
  .k2{width:11px; height:11px; border-radius:6px; background:${CARD_INK};}
  .k3{width:10px; height:10px; border-radius:6px; border:1px dashed ${CARD_MUTED};}
`;

function cardPrintDocument(title, bodyHtml, landscape) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8" /><title>${cardEsc(title)}</title>
    <style>@page{size:letter ${landscape ? "landscape" : "portrait"}; margin:0.35in;} ${CARD_CSS}</style></head>
    <body>${bodyHtml}</body></html>`;
}
