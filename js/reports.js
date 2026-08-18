/* reports.js — renders summary/damage tables, spray chart SVG, player card */

// Approximate field coordinates for standard scorekeeping location numbers (1-9)
// viewBox 0 0 400 420, home plate near the bottom
const LOCATION_COORDS = {
  1: [200, 300], // P
  2: [200, 375], // C
  3: [285, 285], // 1B
  4: [245, 205], // 2B
  5: [115, 285], // 3B
  6: [155, 205], // SS
  7: [80, 110],  // LF
  8: [200, 55],  // CF
  9: [320, 110], // RF
};

function jitter(coord, amount = 14) {
  return [
    coord[0] + (Math.random() - 0.5) * amount,
    coord[1] + (Math.random() - 0.5) * amount,
  ];
}

/* ---------- Zone heat-tendency chart (per-player) ----------
 * A fan diagram divided into 8 zones — LF/CF/RF (outfield), 1B/2B/SS/3B
 * (infield), and BUNT — each colored by what percentage of the player's
 * total balls in play landed there. Works on any array of play-like
 * objects that have isBip / location / isBunt fields, so it's shared
 * between the jersey-based system (parser.js "plays") and the game-log
 * system (gamelog-parser.js "events").
 */

const ZONE_HEAT_BUCKETS = [
  [35, "#8b1a1a"], [30, "#d9534f"], [25, "#f2b6b6"], [20, "#f2f2f2"],
  [15, "#a9c6e8"], [10, "#4a7fc9"], [0, "#1f4e96"],
];
function zoneHeatColor(pct) {
  for (const [min, color] of ZONE_HEAT_BUCKETS) if (pct >= min) return color;
  return ZONE_HEAT_BUCKETS[ZONE_HEAT_BUCKETS.length - 1][1];
}
// Text stays readable on both the very dark and very light ends of the scale.
function zoneHeatTextColor(pct) {
  return (pct >= 30 || pct < 10) ? "#ffffff" : "#1c2733";
}

// Location numbers 1 (pitcher) and 2 (catcher) don't get their own wedge in this
// chart (matching the reference design) — non-bunt balls fielded there are rare,
// and are folded into the nearest infield wedge so the totals still add up.
const ZONE_LOCATION_MAP = { 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF", 1: "SS", 2: "1B" };

function computeZoneCounts(plays) {
  const counts = { LF: 0, CF: 0, RF: 0, "3B": 0, SS: 0, "2B": 0, "1B": 0, BUNT: 0 };
  plays.forEach(p => {
    if (!p.isBip) return;
    if (p.isBunt) { counts.BUNT++; return; }
    const zone = ZONE_LOCATION_MAP[p.location];
    if (zone) counts[zone]++;
  });
  return counts;
}

function polarPoint(cx, cy, angleDeg, r) {
  const rad = angleDeg * Math.PI / 180;
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
}

function wedgePath(cx, cy, startDeg, endDeg, r1, r2) {
  const [x1i, y1i] = polarPoint(cx, cy, startDeg, r1);
  const [x1o, y1o] = polarPoint(cx, cy, startDeg, r2);
  const [x2o, y2o] = polarPoint(cx, cy, endDeg, r2);
  const [x2i, y2i] = polarPoint(cx, cy, endDeg, r1);
  const large = (endDeg - startDeg) > 180 ? 1 : 0;
  return `M ${x1i.toFixed(1)},${y1i.toFixed(1)} L ${x1o.toFixed(1)},${y1o.toFixed(1)} `
    + `A ${r2},${r2} 0 ${large} 1 ${x2o.toFixed(1)},${y2o.toFixed(1)} `
    + `L ${x2i.toFixed(1)},${y2i.toFixed(1)} A ${r1},${r1} 0 ${large} 0 ${x1i.toFixed(1)},${y1i.toFixed(1)} Z`;
}

const ZONE_LEGEND_ITEMS = [
  ["0–9%", "#1f4e96"], ["10–14%", "#4a7fc9"], ["15–19%", "#a9c6e8"], ["20–24%", "#f2f2f2"],
  ["25–29%", "#f2b6b6"], ["30–34%", "#d9534f"], ["35%+", "#8b1a1a"],
];

function renderZoneHeatLegend() {
  const swatches = ZONE_LEGEND_ITEMS.map(([label, color]) => `
    <div style="flex:1;text-align:center;">
      <div style="background:${color};height:14px;"></div>
      <div style="font-size:.68rem;color:var(--muted);margin-top:2px;">${label}</div>
    </div>`).join("");
  return `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;font-size:.75rem;">
      <div style="color:var(--muted);white-space:nowrap;">ZONE HEAT = % of player BIP<br/>LOW TENDENCY</div>
      <div style="display:flex;flex:1;">${swatches}</div>
      <div style="color:var(--danger);white-space:nowrap;font-weight:600;">HIGH TENDENCY</div>
    </div>`;
}

function renderZoneWedge(cx, cy, startDeg, endDeg, r1, r2, count, total, label) {
  const pct = total ? (count / total) * 100 : 0;
  const color = zoneHeatColor(pct);
  const textColor = zoneHeatTextColor(pct);
  const path = wedgePath(cx, cy, startDeg, endDeg, r1, r2);
  const midAngle = (startDeg + endDeg) / 2;
  const midR = (r1 + r2) / 2;
  const [lx, ly] = polarPoint(cx, cy, midAngle, midR);
  const pctLabel = total ? `${pct.toFixed(1)}%` : "—";
  return `
    <path d="${path}" fill="${color}" stroke="#fff" stroke-width="2"><title>${label}: ${count} (${pctLabel})</title></path>
    <text x="${lx.toFixed(1)}" y="${(ly - 14).toFixed(1)}" text-anchor="middle" font-size="10" fill="${textColor}">${pctLabel}</text>
    <text x="${lx.toFixed(1)}" y="${(ly + 6).toFixed(1)}" text-anchor="middle" font-size="18" font-weight="700" fill="${textColor}">${count}</text>
    <text x="${lx.toFixed(1)}" y="${(ly + 20).toFixed(1)}" text-anchor="middle" font-size="10" fill="${textColor}">${label}</text>`;
}

function renderZoneHeatCard(plays, title) {
  const counts = computeZoneCounts(plays);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const cx = 250, cy = 380;

  const outfieldZones = [["LF", -90, -30], ["CF", -30, 30], ["RF", 30, 90]];
  const infieldZones = [["3B", -90, -45], ["SS", -45, 0], ["2B", 0, 45], ["1B", 45, 90]];

  let wedges = "";
  outfieldZones.forEach(([name, s, e]) => { wedges += renderZoneWedge(cx, cy, s, e, 150, 230, counts[name], total, name); });
  infieldZones.forEach(([name, s, e]) => { wedges += renderZoneWedge(cx, cy, s, e, 60, 150, counts[name], total, name); });
  wedges += renderZoneWedge(cx, cy, -25, 25, 0, 55, counts.BUNT, total, "BUNT");

  // Simple home-plate icon below the fan.
  const plate = `<polygon points="${cx-14},${cy+10} ${cx+14},${cy+10} ${cx+14},${cy+22} ${cx},${cy+34} ${cx-14},${cy+22}" fill="#fff" stroke="#999" stroke-width="1.5" />`;

  const outfieldTotal = counts.LF + counts.CF + counts.RF;
  const infieldTotal = counts["1B"] + counts["2B"] + counts["3B"] + counts.SS;
  const buntTotal = counts.BUNT;
  let primaryZone = "—", primaryCount = 0;
  Object.entries(counts).forEach(([z, c]) => { if (c > primaryCount) { primaryCount = c; primaryZone = z; } });
  const pct = n => total ? `${((n / total) * 100).toFixed(1)}%` : "—";

  return `
    <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;">
      <div style="background:var(--navy);color:#fff;padding:8px 14px;font-weight:600;display:flex;justify-content:space-between;">
        <span>${title}</span><span>${total} BIP</span>
      </div>
      <div style="padding:10px;">
        <svg viewBox="0 0 500 400" width="100%" height="360" xmlns="http://www.w3.org/2000/svg">
          ${wedges}${plate}
        </svg>
      </div>
      <div style="display:flex;border-top:1px solid var(--border);text-align:center;font-size:.78rem;">
        <div style="flex:1;padding:8px;border-right:1px solid var(--border);">
          <div style="color:var(--muted);">PRIMARY ZONE</div>
          <div style="color:var(--danger);font-weight:700;">${primaryZone} — ${primaryCount}</div>
          <div style="color:var(--muted);">${pct(primaryCount)} of BIP</div>
        </div>
        <div style="flex:1;padding:8px;border-right:1px solid var(--border);">
          <div style="color:var(--muted);">OUTFIELD</div>
          <div style="font-weight:700;">${outfieldTotal} / ${total}</div>
          <div style="color:var(--muted);">${pct(outfieldTotal)}</div>
        </div>
        <div style="flex:1;padding:8px;border-right:1px solid var(--border);">
          <div style="color:var(--muted);">INFIELD</div>
          <div style="font-weight:700;">${infieldTotal} / ${total}</div>
          <div style="color:var(--muted);">${pct(infieldTotal)}</div>
        </div>
        <div style="flex:1;padding:8px;">
          <div style="color:var(--muted);">BUNT</div>
          <div style="font-weight:700;">${buntTotal} / ${total}</div>
          <div style="color:var(--muted);">${pct(buntTotal)}</div>
        </div>
      </div>
    </div>`;
}

function renderZoneHeatChart(plays, title) {
  return `${renderZoneHeatLegend()}${renderZoneHeatCard(plays, title)}`;
}

// Prints the top-N players (by at-bats) as individual zone-heat charts in a
// grid, sized to fit on a printed page rather than scrolling like the
// single-player view does.
function renderTopSprayGrid(playersWithEvents, teamLabel, n) {
  const cards = playersWithEvents
    .map(p => `<div>${renderZoneHeatCard(p.events, p.name)}</div>`)
    .join("");
  return `
    <div style="margin-bottom:10px;">
      <h2 style="margin:0 0 4px;">Top ${n} — ${teamLabel}</h2>
      <p class="hint" style="margin:0 0 10px;">Ranked by at-bats.</p>
      ${renderZoneHeatLegend()}
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;">
      ${cards}
    </div>`;
}

function renderSprayChartSVG(games, roster, filterJersey) {
  const rosterMap = {};
  roster.forEach(p => rosterMap[p.number] = p.name);

  let dots = "";
  games.forEach(game => {
    game.plays.forEach(play => {
      if (!play.isBip || !play.location) return;
      if (filterJersey && play.jersey !== filterJersey) return;
      const base = LOCATION_COORDS[play.location];
      if (!base) return;
      const [x, y] = jitter(base);
      let color = "#4a7dbd"; // out in play
      if (play.isHit) color = play.isXbh ? "#c0392b" : "#2e8b57";
      const label = rosterMap[play.jersey] ? `#${play.jersey} ${rosterMap[play.jersey]}` : `#${play.jersey}`;
      dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="${color}" fill-opacity="0.8" stroke="#222" stroke-width="0.5"><title>${label} — ${play.code}${play.isBunt ? " (bunt)" : ""}</title></circle>`;
    });
  });

  return `
  <svg id="sprayField" viewBox="0 0 400 420" width="100%" height="420" xmlns="http://www.w3.org/2000/svg">
    <polygon points="200,390 40,220 200,40 360,220" fill="#d8c48a" opacity="0.5" />
    <polygon points="200,390 170,360 200,330 230,360" fill="#fff" stroke="#999" />
    <path d="M40,220 A230,230 0 0,1 360,220" fill="none" stroke="#7ba05b" stroke-width="2" />
    <line x1="200" y1="390" x2="40" y2="220" stroke="#999" stroke-width="1.5" />
    <line x1="200" y1="390" x2="360" y2="220" stroke="#999" stroke-width="1.5" />
    ${dots}
  </svg>
  <div class="hint" style="margin-top:8px;">
    <span style="color:#2e8b57;">●</span> single/hit &nbsp;
    <span style="color:#c0392b;">●</span> extra-base hit &nbsp;
    <span style="color:#4a7dbd;">●</span> out in play
  </div>`;
}

function renderSummaryTable(totalsArray) {
  return totalsArray.map(t => `
    <tr>
      <td>${t.number}</td>
      <td>${t.name}</td>
      <td>${t.PA}</td>
      <td>${t.BIP}</td>
      <td>${t.K}</td>
      <td>${t.BB}</td>
      <td>${t.SB}</td>
      <td>${t.CS}</td>
      <td>${t.BUNT}</td>
      <td>${t.XBH}</td>
      <td>${t.HR}</td>
    </tr>`).join("");
}

function renderDamageTable(totalsArray) {
  const withDamage = totalsArray.filter(t => t.XBH > 0)
    .sort((a, b) => b.XBH - a.XBH);
  if (!withDamage.length) {
    return `<tr><td colspan="7">No extra-base hits recorded yet.</td></tr>`;
  }
  const locName = n => ({1:"P",2:"C",3:"1B",4:"2B",5:"3B",6:"SS",7:"LF",8:"CF",9:"RF"}[n] || n);
  return withDamage.map(t => `
    <tr>
      <td>${t.number}</td>
      <td>${t.name}</td>
      <td>${t["2B"]}</td>
      <td>${t["3B"]}</td>
      <td>${t.HR}</td>
      <td>${t.XBH}</td>
      <td>${t.xbhLocations.map(locName).join(", ") || "-"}</td>
    </tr>`).join("");
}

// Standard ball-strike count progression, used to order the swing-tendency table sensibly.
const COUNT_ORDER = ["0-0","1-0","0-1","1-1","2-0","0-2","2-1","1-2","3-0","2-2","3-1","3-2"];

function renderSwingByCountTable(pitchCounts) {
  // Jersey-based (legacy compact format) player totals never have pitch-by-pitch
  // data at all — that format has no pitch sequences to draw from — so render nothing.
  if (!pitchCounts) return "";

  const seenCounts = Object.keys(pitchCounts);
  if (!seenCounts.length) {
    return `<p class="hint">No pitch-by-pitch data recorded for this player.</p>`;
  }

  const sorted = seenCounts.sort((a, b) => {
    const ia = COUNT_ORDER.indexOf(a), ib = COUNT_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  let totalPitches = 0, totalSwings = 0;
  const rows = sorted.map(count => {
    const c = pitchCounts[count];
    totalPitches += c.total;
    totalSwings += c.swings;
    const pct = c.total ? Math.round((c.swings / c.total) * 100) : 0;
    return `<tr><td>${count}</td><td>${c.total}</td><td>${c.swings}</td><td>${pct}%</td></tr>`;
  }).join("");
  const overallPct = totalPitches ? Math.round((totalSwings / totalPitches) * 100) : 0;

  return `
    <p style="margin-top:16px;"><strong>Swing tendency by count</strong>
      &nbsp;(overall: ${totalSwings} of ${totalPitches} pitches swung at — ${overallPct}%)</p>
    <table class="data-table">
      <thead><tr><th>Count (B-S)</th><th>Pitches Seen</th><th>Swung At</th><th>Swing %</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderPlayerCard(t) {
  if (!t) return "<p class='hint'>Select a player above.</p>";
  const locName = n => ({1:"P",2:"C",3:"1B",4:"2B",5:"3B",6:"SS",7:"LF",8:"CF",9:"RF"}[n] || n);
  const gbLocs = Object.entries(t.gbLocations).map(([loc,c]) => `${locName(loc)}: ${c}`).join(", ") || "-";
  const fbLocs = Object.entries(t.fbLocations).map(([loc,c]) => `${locName(loc)}: ${c}`).join(", ") || "-";
  return `
    <div class="snapshot">
      <div class="stat-box"><div class="label">PA</div><div class="value">${t.PA}</div></div>
      <div class="stat-box"><div class="label">BIP</div><div class="value">${t.BIP}</div></div>
      <div class="stat-box"><div class="label">K</div><div class="value">${t.K}</div></div>
      <div class="stat-box"><div class="label">BB</div><div class="value">${t.BB}</div></div>
      <div class="stat-box"><div class="label">SB</div><div class="value">${t.SB}</div></div>
      <div class="stat-box"><div class="label">CS</div><div class="value">${t.CS}</div></div>
      <div class="stat-box"><div class="label">BUNT</div><div class="value">${t.BUNT}</div></div>
      <div class="stat-box"><div class="label">XBH</div><div class="value">${t.XBH}</div></div>
    </div>
    <p><strong>Ground-ball locations:</strong> ${gbLocs}</p>
    <p><strong>Fly/line-ball locations:</strong> ${fbLocs}</p>
    ${renderSwingByCountTable(t.pitchCounts)}
  `;
}

/* ---------- Contact Profile card (Standard Card layout) ----------
 * A denser single-player card: a field diagram with ground/fly split per
 * defensive position (heat-colored on the same blue→white→red scale used
 * elsewhere), discipline/pressure/small-ball stat panels, a scouting
 * snapshot, and a pitch-by-pitch attack-plan log for every plate appearance.
 */

const CONTACT_PROFILE_POSITIONS = [
  ["LF", 6, 8], ["CF", 40, 3], ["RF", 74, 8],
  ["SS", 22, 30], ["2B", 56, 30],
  ["3B", 12, 52], ["1B", 66, 52],
  ["P", 39, 70],
];

// Folds a raw location-count object (keyed 1-9) into the 8 named positions,
// merging pitcher(1)+catcher(2) into "P" since there's no separate catcher box.
function foldPositionCounts(locObj) {
  const g = n => (locObj && locObj[n]) || 0;
  return { P: g(1) + g(2), "1B": g(3), "2B": g(4), "3B": g(5), SS: g(6), LF: g(7), CF: g(8), RF: g(9) };
}
// Same folding, but counting occurrences in a flat array (e.g. xbhLocations) rather than a count object.
function foldPositionArray(locArray) {
  const counts = { P: 0, "1B": 0, "2B": 0, "3B": 0, SS: 0, LF: 0, CF: 0, RF: 0 };
  (locArray || []).forEach(loc => {
    const key = { 1: "P", 2: "P", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF" }[loc];
    if (key) counts[key]++;
  });
  return counts;
}

function contactProfileFieldBg() {
  return `
    <svg viewBox="0 0 100 84" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;">
      <path d="M 10 78 A 42 42 0 0 1 90 78" fill="none" stroke="#d8dee3" stroke-width="0.6" />
      <line x1="50" y1="78" x2="10" y2="78" stroke="#d8dee3" stroke-width="0.6" stroke-dasharray="2,2" />
      <polygon points="50,78 42,66 50,58 58,66" fill="none" stroke="#d8dee3" stroke-width="0.6" />
    </svg>`;
}

function renderDCPBox(label, leftPct, topPct, groundCount, flyCount, bip) {
  const gPct = bip ? (groundCount / bip) * 100 : 0;
  const fPct = bip ? (flyCount / bip) * 100 : 0;
  const cell = (count, pct) => count
    ? `<td style="background:${heatCellColor(pct)};color:${heatCellTextColor(pct)};font-weight:700;">${Math.round(pct)}%</td>`
    : `<td style="color:var(--muted);">0%</td>`;
  return `
    <div style="position:absolute;left:${leftPct}%;top:${topPct}%;width:110px;box-shadow:0 1px 3px rgba(0,0,0,.15);">
      <div style="background:var(--navy);color:#fff;text-align:center;font-weight:700;font-size:.7rem;padding:3px;">${label}</div>
      <table style="width:100%;border-collapse:collapse;background:#fff;font-size:.68rem;">
        <tr><td style="border:1px solid var(--border);text-align:center;color:var(--muted);">GROUND</td><td style="border:1px solid var(--border);text-align:center;color:var(--muted);">FLY</td></tr>
        <tr><td style="border:1px solid var(--border);text-align:center;font-weight:700;">${groundCount}</td><td style="border:1px solid var(--border);text-align:center;font-weight:700;">${flyCount}</td></tr>
        <tr>${cell(groundCount, gPct)}${cell(flyCount, fPct)}</tr>
      </table>
    </div>`;
}

const PITCH_ABBR = { ball: "B", strike_looking: "SL", strike_swinging: "SS", foul: "F", in_play: "IP" };

function renderPitchSequenceTable(playerEvents) {
  const rows = playerEvents.map((e, i) => {
    const pitches = (e.pitches || []).slice(0, 10);
    const pitchCells = Array.from({ length: 10 }, (_, idx) => {
      const p = pitches[idx];
      return `<td>${p ? (PITCH_ABBR[p.type] || p.type) : ""}</td>`;
    }).join("");
    return `<tr><td>${i + 1}</td><td>-</td>${pitchCells}<td style="font-weight:700;">${e.code}</td></tr>`;
  }).join("");
  return `
    <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-top:16px;">
      <div style="background:var(--navy);color:#fff;padding:7px 14px;font-weight:700;font-size:.8rem;display:flex;justify-content:space-between;">
        <span>PITCH SEQUENCE / ATTACK PLAN</span><span style="font-size:.62rem;color:#cfd9e2;">TRACK EACH PLATE APPEARANCE</span>
      </div>
      <div style="overflow-x:auto;">
        <table class="data-table" style="margin-top:0;min-width:820px;">
          <thead><tr>
            <th>AB</th><th>B/S</th>
            ${Array.from({ length: 10 }, (_, i) => `<th>PITCH ${i + 1}</th>`).join("")}
            <th>RESULT</th>
          </tr></thead>
          <tbody>${rows || `<tr><td colspan="12">No plate appearances recorded.</td></tr>`}</tbody>
        </table>
      </div>
    </div>`;
}

function renderContactProfileCard(t, playerEvents, teamLabel) {
  if (!t) return "<p class='hint'>Select a player above.</p>";

  const gb = foldPositionCounts(t.gbLocations);
  const fb = foldPositionCounts(t.fbLocations);
  const boxesHtml = CONTACT_PROFILE_POSITIONS.map(([label, left, top]) =>
    renderDCPBox(label, left, top, gb[label] || 0, fb[label] || 0, t.BIP)
  ).join("");

  const combinedTotals = {};
  CONTACT_PROFILE_POSITIONS.forEach(([label]) => { combinedTotals[label] = (gb[label] || 0) + (fb[label] || 0); });
  let primaryZone = "-", primaryCount = -1;
  Object.entries(combinedTotals).forEach(([z, c]) => { if (c > primaryCount) { primaryCount = c; primaryZone = z; } });

  const xbhByZone = foldPositionArray(t.xbhLocations);
  let topDamageZone = "-", topDamageCount = 0;
  Object.entries(xbhByZone).forEach(([z, c]) => { if (c > topDamageCount) { topDamageCount = c; topDamageZone = z; } });

  const gbRate = t.BIP ? Math.round((locSum(t.gbLocations) / t.BIP) * 100) : 0;
  const fbRate = t.BIP ? Math.round((locSum(t.fbLocations) / t.BIP) * 100) : 0;
  const bat = computeBattingMetrics(t);

  const badges = computeIQProfile(t);
  const badgeHtml = badges.map(b => `<span style="display:inline-block;background:${IQ_BADGE_DEFS[b].color};color:#fff;font-size:.7rem;font-weight:700;padding:2px 8px;border-radius:3px;margin-right:4px;">${b}</span>`).join("");

  const statBox = (label, value) => `
    <div style="text-align:center;padding:8px 4px;">
      <div style="font-size:.62rem;color:var(--muted);letter-spacing:.03em;">${label}</div>
      <div style="font-size:1.5rem;font-weight:800;">${value}</div>
    </div>`;
  const panel = (title, boxesHtmlInner) => `
    <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:10px;">
      <div style="background:var(--navy);color:#fff;padding:6px 12px;font-weight:700;font-size:.68rem;letter-spacing:.04em;">${title}</div>
      <div style="display:flex;">${boxesHtmlInner}</div>
    </div>`;

  return `
    <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;background:#fff;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:14px 20px;border-bottom:1px solid var(--border);">
        <div>
          <div style="font-size:1.3rem;font-weight:800;color:#3a4552;">${t.name.toUpperCase()}</div>
          <div style="font-size:.68rem;letter-spacing:.05em;color:var(--muted);">PLAYER CARD &nbsp;|&nbsp; CONTACT PROFILE</div>
          <div style="margin-top:6px;">${badgeHtml}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:.65rem;letter-spacing:.05em;color:var(--muted);">TEAM</div>
          <div style="font-weight:700;">${teamLabel || "-"}</div>
          <div style="font-size:1.8rem;font-weight:800;color:var(--navy);margin-top:4px;">${t.BIP}<span style="font-size:.7rem;font-weight:600;color:var(--muted);"> BIP</span></div>
        </div>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:16px;padding:16px 20px;">
        <div style="flex:2;min-width:420px;">
          <div style="font-size:.68rem;letter-spacing:.05em;color:var(--muted);margin-bottom:8px;">DEFENSIVE CONTACT PROFILE</div>
          <div style="position:relative;height:340px;background:#fafbfc;border:1px solid var(--border);border-radius:8px;">
            ${contactProfileFieldBg()}
            ${boxesHtml}
          </div>
        </div>
        <div style="flex:1;min-width:220px;">
          ${panel("DISCIPLINE", statBox("K", t.K) + statBox("BB", t.BB) + statBox("K-L", t.KL || 0))}
          ${panel("PRESSURE", statBox("SB", t.SB) + statBox("CS", t.CS))}
          ${panel("SMALL BALL", statBox("BUNT", t.BUNT))}
        </div>
      </div>

      <div style="border-top:1px solid var(--border);padding:14px 20px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
          <span style="font-weight:700;font-size:.8rem;">SCOUTING SNAPSHOT</span>
          <span style="font-size:.62rem;color:var(--muted);">CONTACT SHAPE AND DAMAGE DIRECTION</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;text-align:center;">
          <div style="flex:1;min-width:140px;"><div style="font-size:.65rem;color:var(--muted);">PRIMARY CONTACT ZONE</div><div style="font-size:1.3rem;font-weight:800;color:var(--danger);">${primaryZone}</div></div>
          <div style="flex:1;min-width:140px;"><div style="font-size:.65rem;color:var(--muted);">GROUND BALL RATE</div><div style="font-size:1.3rem;font-weight:800;">${gbRate}%</div></div>
          <div style="flex:1;min-width:140px;"><div style="font-size:.65rem;color:var(--muted);">FLY BALL RATE</div><div style="font-size:1.3rem;font-weight:800;">${fbRate}%</div></div>
          <div style="flex:1;min-width:140px;"><div style="font-size:.65rem;color:var(--muted);">TOP DAMAGE FIELD</div><div style="font-size:1.3rem;font-weight:800;color:var(--danger);">${topDamageZone}</div></div>
          <div style="flex:1;min-width:140px;"><div style="font-size:.65rem;color:var(--muted);">BATTING AVERAGE</div><div style="font-size:1.3rem;font-weight:800;">${bat.avg.toFixed(3).replace(/^0/, "")}</div></div>
          <div style="flex:1;min-width:140px;"><div style="font-size:.65rem;color:var(--muted);">ON-BASE %</div><div style="font-size:1.3rem;font-weight:800;">${bat.obp.toFixed(3).replace(/^0/, "")}</div></div>
          <div style="flex:1;min-width:140px;"><div style="font-size:.65rem;color:var(--muted);">QAB %</div><div style="font-size:1.3rem;font-weight:800;">${Math.round(bat.qabPct)}%</div></div>
        </div>
      </div>
    </div>`;
}

// Spray chart directly from parsed game-log events (name-keyed, no roster needed)
function renderSprayChartFromEvents(events, filterName, filterTeam) {
  let dots = "";
  events.forEach(play => {
    if (!play.isBip || !play.location) return;
    if (filterName && play.batter !== filterName) return;
    if (filterTeam && play.team !== filterTeam) return;
    const base = LOCATION_COORDS[play.location];
    if (!base) return;
    const [x, y] = jitter(base);
    let color = "#4a7dbd";
    if (play.isHit) color = play.isXbh ? "#c0392b" : "#2e8b57";
    dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="${color}" fill-opacity="0.8" stroke="#222" stroke-width="0.5"><title>${play.batter} — ${play.code}${play.isBunt ? " (bunt)" : ""}</title></circle>`;
  });
  return `
  <svg id="sprayField" viewBox="0 0 400 420" width="100%" height="420" xmlns="http://www.w3.org/2000/svg">
    <polygon points="200,390 40,220 200,40 360,220" fill="#d8c48a" opacity="0.5" />
    <polygon points="200,390 170,360 200,330 230,360" fill="#fff" stroke="#999" />
    <path d="M40,220 A230,230 0 0,1 360,220" fill="none" stroke="#7ba05b" stroke-width="2" />
    <line x1="200" y1="390" x2="40" y2="220" stroke="#999" stroke-width="1.5" />
    <line x1="200" y1="390" x2="360" y2="220" stroke="#999" stroke-width="1.5" />
    ${dots}
  </svg>
  <div class="hint" style="margin-top:8px;">
    <span style="color:#2e8b57;">●</span> single/hit &nbsp;
    <span style="color:#c0392b;">●</span> extra-base hit &nbsp;
    <span style="color:#4a7dbd;">●</span> out in play
  </div>`;
}

function gcTotalsToCsv(totalsArray) {
  const header = ["Player","PA","AB","H","2B","3B","HR","BB","HBP","K","SB","CS","BUNT","R"];
  const rows = totalsArray.map(t => [t.name, t.PA, t.AB, t.H, t["2B"], t["3B"], t.HR, t.BB, t.HBP, t.K, t.SB, t.CS, t.BUNT, t.RunsScored]);
  return [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
}

function renderGcSummaryTable(totalsArray) {
  return totalsArray.map(t => `
    <tr>
      <td style="text-align:left">${t.name}</td>
      <td>${t.team || "—"}</td>
      <td>${t.PA}</td>
      <td>${t.BIP}</td>
      <td>${t.K}</td>
      <td>${t.BB}</td>
      <td>${t.SB}</td>
      <td>${t.CS}</td>
      <td>${t.BUNT}</td>
      <td>${t.XBH}</td>
      <td>${t.HR}</td>
    </tr>`).join("");
}

function renderGcDamageTable(totalsArray) {
  const withDamage = totalsArray.filter(t => t.XBH > 0).sort((a, b) => b.XBH - a.XBH);
  if (!withDamage.length) {
    return `<tr><td colspan="12">No extra-base hits recorded yet.</td></tr>`;
  }
  const posCols = ["P", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
  return withDamage.map(t => {
    const byPos = foldPositionArray(t.xbhLocations);
    return `
    <tr>
      <td style="text-align:left">${t.name}</td>
      <td>${t.team || "—"}</td>
      <td>${t["2B"]}</td>
      <td>${t["3B"]}</td>
      <td>${t.HR}</td>
      <td>${t.XBH}</td>
      ${posCols.map(p => `<td>${byPos[p] || "-"}</td>`).join("")}
    </tr>`;
  }).join("");
}

/* ---------- Hitter Summary (IQ-profile style season summary) ----------
 * A denser scouting-report table: IQ profile badges (earned against fixed
 * thresholds — not ranked against other players), GB%/FB% by field location
 * with heat-mapped cells, and counting stats. GB-P and GB-C (pitcher/catcher
 * fielded) are folded into a single "P" column, since those are rare and the
 * reference design doesn't show a separate catcher column either.
 */

const IQ_BADGE_DEFS = {
  CONTACT: { color: "#2e8b57", desc: "High contact rate<br/>Low strikeout rate" },
  DAMAGE: { color: "#c0392b", desc: "Drives the baseball<br/>Produces extra-base hits" },
  "K-PRONE": { color: "#6b7280", desc: "Elevated strikeout rate<br/>Swing-and-miss tendency" },
  BUNT: { color: "#c9962c", desc: "Creates pressure<br/>Dangerous with the bunt" },
  "GROUND BALL": { color: "#b8722c", desc: "Ground-ball hitter<br/>Keeps ball on the ground" },
  "FLY BALL": { color: "#3a6ea5", desc: "Air-ball hitter<br/>Drives balls to the outfield" },
};
const IQ_BADGE_RULES = [
  ["CONTACT", "40+ PA · K% ≤ 10%"],
  ["DAMAGE", "20+ BIP · XBH/BIP ≥ 20%"],
  ["K-PRONE", "40+ PA · K% ≥ 25%"],
  ["BUNT", "20+ BIP · Bunts/BIP ≥ 15%"],
  ["GROUND BALL", "30+ BIP · GB% ≥ 66%"],
  ["FLY BALL", "30+ BIP · FB% ≥ 66%"],
];

function locSum(locObj) { return Object.values(locObj || {}).reduce((a, b) => a + b, 0); }

// Folds pitcher(1)+catcher(2) into a single "P" bucket; other numbers map directly.
function locBreakdown(locObj) {
  const g = n => (locObj && locObj[n]) || 0;
  return { P: g(1) + g(2), "1B": g(3), "2B": g(4), "3B": g(5), SS: g(6), LF: g(7), CF: g(8), RF: g(9) };
}

function computeIQProfile(t) {
  const kPct = t.PA ? (t.K / t.PA) * 100 : 0;
  const xbhPct = t.BIP ? (t.XBH / t.BIP) * 100 : 0;
  const buntPct = t.BIP ? (t.BUNT / t.BIP) * 100 : 0;
  const gbPct = t.BIP ? (locSum(t.gbLocations) / t.BIP) * 100 : 0;
  const fbPct = t.BIP ? (locSum(t.fbLocations) / t.BIP) * 100 : 0;
  const badges = [];
  if (t.PA >= 40 && kPct <= 10) badges.push("CONTACT");
  if (t.BIP >= 20 && xbhPct >= 20) badges.push("DAMAGE");
  if (t.PA >= 40 && kPct >= 25) badges.push("K-PRONE");
  if (t.BIP >= 20 && buntPct >= 15) badges.push("BUNT");
  if (t.BIP >= 30 && gbPct >= 66) badges.push("GROUND BALL");
  if (t.BIP >= 30 && fbPct >= 66) badges.push("FLY BALL");
  return badges;
}

// A single blue → white → red gradient by raw percentage value (not normalized
// per-column), matching the reference: GB% cells cluster low (mostly blue/white)
// while FB% cells run higher per-cell (more often crossing into red) simply
// because fly balls concentrate into 3 outfield columns.
function heatCellColor(pct) {
  const blue = [31, 77, 150], white = [245, 245, 245], red = [139, 26, 26];
  const mid = 10, hi = 32;
  let c1, c2, t;
  if (pct <= mid) { c1 = blue; c2 = white; t = pct / mid; }
  else { c1 = white; c2 = red; t = Math.min((pct - mid) / (hi - mid), 1); }
  const mix = i => Math.round(c1[i] + (c2[i] - c1[i]) * t);
  return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
}
function heatCellTextColor(pct) { return (pct >= 25 || pct <= 2) ? "#fff" : "#1c2733"; }

function renderIQProfileKey() {
  const cards = IQ_BADGE_RULES.map(([name]) => {
    const def = IQ_BADGE_DEFS[name];
    return `
      <div style="flex:1;min-width:130px;">
        <span style="display:inline-block;background:${def.color};color:#fff;font-size:.68rem;font-weight:700;padding:3px 8px;border-radius:4px;">${name}</span>
        <div style="font-size:.68rem;color:var(--muted);margin-top:4px;line-height:1.4;">${def.desc}</div>
      </div>`;
  }).join("");
  return `
    <div style="background:var(--navy);color:#fff;border-radius:8px 8px 0 0;padding:12px 16px;">
      <div style="font-size:.7rem;letter-spacing:.05em;color:#cfd9e2;margin-bottom:8px;">IQ PROFILE KEY</div>
      <div style="display:flex;flex-wrap:wrap;gap:16px;">${cards}</div>
    </div>`;
}

function renderHeatMapGuide() {
  return `
    <div style="display:flex;align-items:center;gap:8px;font-size:.68rem;color:var(--muted);margin:10px 0;">
      <span>Most Often</span>
      <div style="flex:1;max-width:220px;height:10px;border-radius:4px;background:linear-gradient(to right, rgb(139,26,26), rgb(245,245,245), rgb(31,77,150));"></div>
      <span>Least Often</span>
      <span style="margin-left:6px;">— heat = % of player BIP at that location</span>
    </div>`;
}

function renderHitterSummaryTable(totalsArray, gpMap) {
  const gbLocCols = ["P", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
  const fbLocCols = ["P", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];

  const heatCell = (count, bip) => {
    if (!count) return `<td>-</td>`;
    const pct = bip ? (count / bip) * 100 : 0;
    return `<td style="background:${heatCellColor(pct)};color:${heatCellTextColor(pct)};font-weight:600;">${Math.round(pct)}%</td>`;
  };

  const rows = totalsArray.map((t, i) => {
    const gb = locBreakdown(t.gbLocations);
    const fb = locBreakdown(t.fbLocations);
    const gbPct = t.BIP ? Math.round((locSum(t.gbLocations) / t.BIP) * 100) : 0;
    const fbPct = t.BIP ? Math.round((locSum(t.fbLocations) / t.BIP) * 100) : 0;
    const badges = computeIQProfile(t);
    const badgeHtml = badges.map(b => `<span style="display:block;background:${IQ_BADGE_DEFS[b].color};color:#fff;font-size:.62rem;font-weight:700;padding:2px 5px;border-radius:3px;margin-bottom:2px;white-space:nowrap;">${b}</span>`).join("");

    return `
      <tr>
        <td>${i + 1}</td>
        <td style="text-align:left;white-space:nowrap;">${t.name}</td>
        <td>${badgeHtml}</td>
        <td>${gpMap[t.name] || 0}</td>
        <td>${t.BIP ? gbPct + "%" : "-"}</td>
        <td>${t.BIP ? fbPct + "%" : "-"}</td>
        ${gbLocCols.map(c => heatCell(gb[c], t.BIP)).join("")}
        ${fbLocCols.map(c => heatCell(fb[c], t.BIP)).join("")}
        <td>${t.BIP}</td>
        <td>${t.BUNT}</td>
        <td>${t.K}</td>
        <td>${t.BB}</td>
        <td>${t.SB}</td>
        <td>${t.CS}</td>
      </tr>`;
  }).join("");

  return `
    ${renderIQProfileKey()}
    <div style="overflow-x:auto;border:1px solid var(--border);border-top:none;border-radius:0 0 8px 8px;">
      <table class="data-table" style="min-width:1400px;margin-top:0;">
        <thead>
          <tr>
            <th rowspan="2">#</th>
            <th rowspan="2">Player</th>
            <th rowspan="2">IQ Profile</th>
            <th rowspan="2">GP</th>
            <th rowspan="2">GB%</th>
            <th rowspan="2">FB%</th>
            <th colspan="8" style="background:#eef2f5;">GROUND BALL % BY LOCATION</th>
            <th colspan="8" style="background:#eef2f5;">FLY BALL % BY LOCATION</th>
            <th colspan="6" style="background:#eef2f5;">COUNTING STATS</th>
          </tr>
          <tr>
            ${gbLocCols.map(c => `<th>GB-${c}</th>`).join("")}
            ${fbLocCols.map(c => `<th>FB-${c}</th>`).join("")}
            <th>BIP</th><th>BUNT</th><th>K</th><th>BB</th><th>SB</th><th>CS</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="28">No games imported yet for this opponent.</td></tr>`}</tbody>
      </table>
    </div>
    ${renderHeatMapGuide()}
    <p class="hint" style="margin-top:6px;">
      IQ Profiles are earned against fixed thresholds, not ranked against other players — a cell stays blank unless a player clears the bar.
      Thresholds: ${IQ_BADGE_RULES.map(([n, r]) => `<strong>${n}</strong> (${r})`).join(", ")}.
    </p>`;
}

function totalsToCsv(totalsArray) {
  const header = ["#","Player","Team","PA","BIP","K","BB","SB","CS","BUNT","XBH","HR"];
  const rows = totalsArray.map(t => [t.number, t.name, t.team || "", t.PA, t.BIP, t.K, t.BB, t.SB, t.CS, t.BUNT, t.XBH, t.HR]);
  return [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
}

function downloadText(filename, content, mime = "text/csv") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* ---------- Player Development Plan ----------
 * A single-player report styled after horizontal benchmark bars: each stat
 * gets a bar colored green/gold/red depending on how it compares to a
 * reference "average" value, with a tick mark showing where that average
 * sits. The benchmark numbers below are general, reasonable reference points
 * for competitive HS/travel-level baseball — NOT calibrated to match any
 * specific commercial product's proprietary thresholds, since those aren't
 * public. Treat them as a sensible starting point to tune, not gospel.
 */

const PDP_BENCHMARKS = {
  obp: { label: "On-base %", desc: "How often he reaches base", min: 0.150, max: 0.550, avg: 0.350, fmt: v => v.toFixed(3).replace(/^0/, "") },
  slg: { label: "Slugging %", desc: "Damage per at-bat", min: 0.150, max: 0.750, avg: 0.420, fmt: v => v.toFixed(3).replace(/^0/, "") },
  bbk: { label: "BB : K", desc: "Walks vs. strikeouts", min: 0, max: 2.5, avg: 0.55, fmt: v => v.toFixed(2) },
  qab: { label: "QAB %", desc: "At-bats that helped the team", min: 20, max: 80, avg: 50, fmt: v => v.toFixed(1) + "%" },
  contact: { label: "Contact %", desc: "Hits it when he swings", min: 30, max: 100, avg: 72, fmt: v => v.toFixed(1) + "%" },
  twoOutAvg: { label: "2-Out AVG", desc: "Batting average with 2 outs", min: 0, max: 0.600, avg: 0.250, fmt: v => v.toFixed(3).replace(/^0/, "") },
  fps: { label: "First-pitch strike %", desc: "Starts a hitter 0-1", min: 20, max: 80, avg: 58, fmt: v => v.toFixed(1) + "%" },
  strikepct: { label: "Strike %", desc: "Pitches that are strikes", min: 30, max: 80, avg: 62, fmt: v => v.toFixed(1) + "%" },
  k7: { label: "Strikeouts per 7", desc: "Per seven innings", min: 0, max: 16, avg: 6.5, fmt: v => v.toFixed(1) },
  kbb: { label: "K : BB", desc: "Strikeouts vs. walks", min: 0, max: 6, avg: 2.0, fmt: v => v.toFixed(2) },
  freebases7: { label: "Free Bases per 7", desc: "Walks + HBP allowed, per seven innings", min: 0, max: 10, avg: 3, fmt: v => v.toFixed(1), invert: true },
};

function pdpBarColor(value, avg, min, max, invert) {
  const rel = avg !== 0 ? (value - avg) / Math.abs(avg) : (value > 0 ? 1 : 0);
  const effectiveRel = invert ? -rel : rel;
  if (effectiveRel >= 0.08) return "#2e8b57";   // clearly favorable — green
  if (effectiveRel <= -0.12) return "#b3352c";  // clearly unfavorable — red
  return "#c9962c";                              // near average — gold
}

function pdpBarRow(key, value) {
  const b = PDP_BENCHMARKS[key];
  if (value == null || Number.isNaN(value)) return "";
  const clamped = Math.max(b.min, Math.min(b.max, value));
  const fillPct = ((clamped - b.min) / (b.max - b.min)) * 100;
  const tickPct = ((b.avg - b.min) / (b.max - b.min)) * 100;
  const color = pdpBarColor(value, b.avg, b.min, b.max, b.invert);
  return `
    <div style="margin-bottom:14px;">
      <div style="font-weight:700;font-size:.85rem;">${b.label}</div>
      <div style="font-size:.72rem;color:var(--muted);margin-bottom:4px;">${b.desc}</div>
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="flex:1;position:relative;height:16px;background:#e9edf0;border-radius:3px;overflow:visible;">
          <div style="position:absolute;left:0;top:0;bottom:0;width:${fillPct}%;background:${color};border-radius:3px;"></div>
          <div style="position:absolute;left:${tickPct}%;top:-3px;bottom:-3px;width:2px;background:#1c2733;"></div>
        </div>
        <div style="width:60px;text-align:right;font-weight:700;font-size:.85rem;">${b.fmt(value)}</div>
      </div>
    </div>`;
}

// Computes the batting-side metrics this report needs from a player's totals
// object (as produced by aggregateGameLogStats).
function computeBattingMetrics(t) {
  const totalBases = (t["1B"] || 0) * 1 + (t["2B"] || 0) * 2 + (t["3B"] || 0) * 3 + (t.HR || 0) * 4;
  const obp = t.PA ? (t.H + t.BB + t.HBP) / t.PA : 0;
  const slg = t.AB ? totalBases / t.AB : 0;
  const avg = t.AB ? t.H / t.AB : 0;
  const bbk = t.K ? t.BB / t.K : (t.BB > 0 ? t.BB : 0);
  const qabPct = t.PA ? (t.qab / t.PA) * 100 : 0;
  const contactPct = t.totalSwings ? (t.contactSwings / t.totalSwings) * 100 : 0;
  return { obp, slg, avg, ops: obp + slg, bbk, qabPct, contactPct, totalBases };
}

// Computes the pitching-side metrics from an aggregatePitchingStats() entry.
function computePitchingMetrics(p) {
  if (!p || !p.outs) return null;
  const ip = p.outs / 3;
  return {
    ip, ipDisplay: `${Math.floor(p.outs / 3)}.${p.outs % 3}`,
    era: (p.ER * 21) / p.outs,
    k7: (p.K * 21) / p.outs,
    kbb: p.BB ? p.K / p.BB : (p.K > 0 ? p.K : 0),
    strikePct: p.pitchesThrown ? (p.strikesThrown / p.pitchesThrown) * 100 : 0,
    fpsPct: p.firstPitchTotal ? (p.firstPitchStrikes / p.firstPitchTotal) * 100 : 0,
    freeBases7: ((p.BB || 0) + (p.HBP || 0)) * 21 / p.outs,
  };
}

function renderPlayerDevelopmentPlan(t, pitching, teamLabel, dateLabel) {
  const bat = computeBattingMetrics(t);
  const pitch = computePitchingMetrics(pitching);

  const statLineParts = [
    `${bat.ops.toFixed(3).replace(/^0/, "")} OPS`,
    `${bat.avg.toFixed(3).replace(/^0/, "")}/${bat.obp.toFixed(3).replace(/^0/, "")}/${bat.slg.toFixed(3).replace(/^0/, "")}`,
    `${t.HR} HR`, `${t.BB} BB`, `${t.K} K`, `${t.PA} PA`,
    `${bat.qabPct.toFixed(1)}% QAB`,
  ];
  if (pitch) {
    statLineParts.push(`${pitch.era.toFixed(2)} ERA`, `${pitching.K} K / ${pitching.BB} BB`, `${pitch.ipDisplay} IP`);
  }

  const twoOutAvg = t.twoOutAB >= 5 ? t.twoOutH / t.twoOutAB : null;
  const battingRows = [
    pdpBarRow("obp", bat.obp), pdpBarRow("slg", bat.slg), pdpBarRow("bbk", bat.bbk),
    pdpBarRow("qab", bat.qabPct), pdpBarRow("contact", bat.contactPct), pdpBarRow("twoOutAvg", twoOutAvg),
  ].join("");

  const pitchingSection = pitch ? `
    <div style="font-weight:700;color:var(--navy);margin:18px 0 10px;font-size:.95rem;">Pitching</div>
    ${pdpBarRow("fps", pitch.fpsPct)}${pdpBarRow("strikepct", pitch.strikePct)}${pdpBarRow("k7", pitch.k7)}${pdpBarRow("kbb", pitch.kbb)}${pdpBarRow("freebases7", pitch.freeBases7)}
  ` : "";

  return `
    <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;background:#fff;">
      <div style="padding:14px 20px;border-bottom:1px solid var(--border);">
        <div style="display:flex;justify-content:space-between;font-size:.68rem;letter-spacing:.06em;color:var(--muted);text-transform:uppercase;">
          <span>${teamLabel}</span><span>Player Development Plan / ${dateLabel}</span>
        </div>
        <div style="font-size:1.3rem;font-weight:800;color:#3a4552;margin-top:4px;">${(t.number && t.number !== "-") ? t.number : ""}${t.name.toUpperCase()}</div>
        <div style="font-size:.78rem;color:var(--muted);margin-top:4px;">${statLineParts.join(" · ")}</div>
      </div>
      <div style="padding:16px 20px;">
        <div style="display:flex;justify-content:space-between;font-size:.68rem;font-weight:700;letter-spacing:.04em;margin-bottom:10px;">
          <span style="color:var(--danger);">← BELOW AVERAGE</span>
          <span style="color:#2e8b57;">ABOVE AVERAGE →</span>
        </div>
        <div style="font-weight:700;color:var(--navy);margin-bottom:10px;font-size:.95rem;">Batting</div>
        ${battingRows}
        ${pitchingSection}
      </div>
    </div>
    <p class="hint" style="margin-top:8px;">
      Bar color compares each stat to a general reference average for competitive HS/travel baseball (shown as the tick mark) — not
      an official league benchmark, and not calibrated to match any specific commercial scouting product.
      ${pitch ? "Pitching IP/ERA are approximate: reconstructed from the log's out-counts and run-scoring text, treating all runs as earned." : ""}
    </p>`;
}

/* ---------- Swing Decisions (count & swing tendencies report) ---------- */

const COUNT_TABLE_ORDER = ["0-0", "1-0", "0-1", "2-0", "1-1", "0-2", "3-0", "2-1", "1-2", "3-1", "2-2", "3-2"];
const TWO_STRIKE_COUNTS = ["0-2", "1-2", "2-2", "3-2"];
const HITTERS_COUNT_SET = ["0-1", "1-2", "2-1"]; // as specified by the reference report's own footnote

function sumPitchCounts(counts, keys) {
  let swings = 0, total = 0;
  keys.forEach(k => { if (counts[k]) { swings += counts[k].swings; total += counts[k].total; } });
  return { swings, total };
}

// Merges every player's pitchCounts/countXBH into one team-wide table.
function computeTeamCountTotals(totalsArray) {
  const pitchCounts = {}, countXBH = {};
  totalsArray.forEach(t => {
    Object.entries(t.pitchCounts || {}).forEach(([k, v]) => {
      if (!pitchCounts[k]) pitchCounts[k] = { swings: 0, total: 0 };
      pitchCounts[k].swings += v.swings; pitchCounts[k].total += v.total;
    });
    Object.entries(t.countXBH || {}).forEach(([k, v]) => {
      if (!countXBH[k]) countXBH[k] = { bip: 0, xbh: 0 };
      countXBH[k].bip += v.bip; countXBH[k].xbh += v.xbh;
    });
  });
  return { pitchCounts, countXBH };
}

function renderCountTable(pitchCounts, countXBH, title) {
  const rows = COUNT_TABLE_ORDER.map(count => {
    const pc = pitchCounts[count];
    const xb = countXBH[count];
    if (!pc || !pc.total) return `<tr><td>${count}</td><td>-</td><td>-</td><td>-</td><td>-</td><td>0</td></tr>`;
    const swingPct = Math.round((pc.swings / pc.total) * 100);
    const takePct = 100 - swingPct;
    const takes = pc.total - pc.swings;
    const stpPct = takes ? Math.round(((pc.strikesLooking || 0) / takes) * 100) : null;
    const xbhBipStr = xb && xb.bip ? `${xb.xbh}/${xb.bip} (${Math.round((xb.xbh / xb.bip) * 100)}%)` : "-";
    return `<tr>
      <td style="font-weight:700;">${count}</td>
      <td>${swingPct}%</td>
      <td>${takePct}%</td>
      <td>${stpPct == null ? "-" : stpPct + "%"}</td>
      <td style="background:#eaf3e6;font-weight:600;">${xbhBipStr}</td>
      <td>${pc.total}</td>
    </tr>`;
  }).join("");
  return `
    <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;">
      <div style="background:var(--navy);color:#fff;padding:8px 14px;font-weight:700;font-size:.85rem;letter-spacing:.02em;">${title}</div>
      <table class="data-table" style="margin-top:0;">
        <thead><tr><th>Count</th><th>Swing %</th><th>Take %</th><th>STP %</th><th>XBH/BIP</th><th>Total PA</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// The 5 "Quick Scout" leaderboards, each with its own minimum-sample rule.
function computeQuickScoutLeaders(totalsArray, rawSteals) {
  const firstPitch = totalsArray
    .map(t => ({ name: t.name, ...((t.pitchCounts["0-0"]) || { swings: 0, total: 0 }) }))
    .filter(x => x.total >= 20)
    .map(x => ({ name: x.name, pct: (x.swings / x.total) * 100 }))
    .sort((a, b) => b.pct - a.pct).slice(0, 7);

  const hittersCount = totalsArray
    .map(t => ({ name: t.name, ...sumPitchCounts(t.pitchCounts, HITTERS_COUNT_SET) }))
    .filter(x => x.total >= 40)
    .map(x => ({ name: x.name, pct: (x.swings / x.total) * 100 }))
    .sort((a, b) => b.pct - a.pct).slice(0, 7);

  const twoStrike = totalsArray
    .map(t => ({ name: t.name, ...sumPitchCounts(t.pitchCounts, TWO_STRIKE_COUNTS) }))
    .filter(x => x.total >= 30)
    .map(x => ({ name: x.name, pct: (x.swings / x.total) * 100 }))
    .sort((a, b) => b.pct - a.pct).slice(0, 7);

  const bestDamage = totalsArray
    .map(t => {
      let best = null;
      Object.entries(t.countXBH || {}).forEach(([count, v]) => {
        if (v.bip >= 15) {
          const ratio = v.xbh / v.bip;
          if (!best || ratio > best.ratio) best = { count, ratio, xbh: v.xbh, bip: v.bip };
        }
      });
      return best ? { name: t.name, ...best } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.ratio - a.ratio).slice(0, 7);

  const strongestTendency = totalsArray
    .map(t => {
      let best = null;
      Object.entries(t.pitchCounts || {}).forEach(([count, v]) => {
        if (count === "3-0") return; // almost always an automatic take — excluded as noise
        if (v.total >= 10) {
          const swingPct = (v.swings / v.total) * 100;
          const takePct = 100 - swingPct;
          const extreme = swingPct >= takePct ? { type: "Swing", pct: swingPct } : { type: "Take", pct: takePct };
          if (!best || extreme.pct > best.pct) best = { count, ...extreme };
        }
      });
      return best ? { name: t.name, ...best } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.pct - a.pct).slice(0, 7);

  // Of the pitches a player took (didn't swing at) in a given count, what % were
  // actually called strikes rather than balls — i.e. how often taking a pitch in
  // that count cost them a strike. Best (highest) single count per player.
  const strikeTake = totalsArray
    .map(t => {
      let best = null;
      Object.entries(t.pitchCounts || {}).forEach(([count, v]) => {
        const takes = v.total - v.swings;
        if (takes >= 10) {
          const pct = (v.strikesLooking / takes) * 100;
          if (!best || pct > best.pct) best = { count, pct };
        }
      });
      return best ? { name: t.name, ...best } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.pct - a.pct).slice(0, 7);

  // Of the swings a player took that weren't the final pitch of the at-bat (fouls, or
  // a non-final swinging strike), what % were immediately followed by taking the very
  // next pitch — i.e. "swings once, then lays off."
  const swingThenTake = totalsArray
    .filter(t => (t.swingThenTakeOpp || 0) >= 15)
    .map(t => ({
      name: t.name,
      pct: (t.swingThenTakeCount / t.swingThenTakeOpp) * 100,
      balls: t.swingThenTakeBalls || 0,
      strikes: t.swingThenTakeStrikes || 0,
    }))
    .sort((a, b) => b.pct - a.pct).slice(0, 7);

  // Steal timing: buckets each attempt by how many strikes were in the count at the
  // moment of the attempt (0/1/2) rather than the exact count — with steal attempts
  // being naturally low-volume per player, bucketing by exact count fragments the
  // sample too much to say anything useful. Strikes-in-count is the more meaningful
  // scouting question anyway: does this runner go early in the count, or specifically
  // when protecting against a strikeout with 2 strikes?
  const stealTiming = (() => {
    const byRunner = {};
    (rawSteals || []).forEach(s => {
      if (s.type !== "SB" || s.count == null) return;
      if (!byRunner[s.runner]) byRunner[s.runner] = { 0: 0, 1: 0, 2: 0, total: 0 };
      const strikes = parseInt(s.count.split("-")[1], 10);
      if (Number.isNaN(strikes)) return;
      byRunner[s.runner][strikes]++;
      byRunner[s.runner].total++;
    });
    return Object.entries(byRunner)
      .filter(([, v]) => v.total >= 3)
      .map(([runner, v]) => {
        let bestStrikes = 0, bestCount = v[0];
        [1, 2].forEach(s => { if (v[s] > bestCount) { bestCount = v[s]; bestStrikes = s; } });
        return { name: runner, strikes: bestStrikes, pct: (bestCount / v.total) * 100, total: v.total };
      })
      .sort((a, b) => b.pct - a.pct).slice(0, 7);
  })();

  return { firstPitch, hittersCount, twoStrike, bestDamage, strongestTendency, strikeTake, swingThenTake, stealTiming };
}

function renderLeaderCard(title, footnote, rows) {
  const listHtml = rows.length
    ? rows.map((r, i) => `
        <div style="display:flex;justify-content:space-between;padding:4px 0;${i < rows.length - 1 ? "border-bottom:1px solid #f0f0f0;" : ""}">
          <span><strong>${i + 1}.</strong> ${r.name.toUpperCase()}</span>
          <span style="color:#2e8b57;font-weight:700;">${r.valueLabel}</span>
        </div>`).join("")
    : `<p class="hint" style="margin:4px 0;">No players met the minimum sample size yet.</p>`;
  return `
    <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;flex:1;min-width:260px;">
      <div style="background:var(--navy);color:#fff;padding:7px 12px;font-weight:700;font-size:.78rem;">${title}</div>
      <div style="padding:10px 12px;font-size:.82rem;">${listHtml}</div>
      <div style="padding:6px 12px;border-top:1px solid var(--border);font-size:.62rem;color:var(--muted);">${footnote}</div>
    </div>`;
}

function renderSwingDecisionsReport(totalsArray, teamLabel, selectedPlayerName, selectedPlayerTotals, rawSteals) {
  const { pitchCounts: teamCounts, countXBH: teamXBH } = computeTeamCountTotals(totalsArray);
  const leaders = computeQuickScoutLeaders(totalsArray, rawSteals);

  const leaderCards = [
    renderLeaderCard("FIRST-PITCH ATTACKERS", "MINIMUM: 20 PITCHES · SWING RATE ON FIRST PITCH",
      leaders.firstPitch.map(x => ({ name: x.name, valueLabel: `${Math.round(x.pct)}% Swing` }))),
    renderLeaderCard("HITTER'S COUNT ATTACKERS", "MINIMUM: 40 PITCHES · SWING RATE IN 0-1, 1-2, 2-1 COUNTS",
      leaders.hittersCount.map(x => ({ name: x.name, valueLabel: `${Math.round(x.pct)}% Swing` }))),
    renderLeaderCard("TWO-STRIKE SWING RATE", "MINIMUM: 30 PITCHES · SWING RATE IN ALL TWO-STRIKE COUNTS",
      leaders.twoStrike.map(x => ({ name: x.name, valueLabel: `${Math.round(x.pct)}% Swing` }))),
    renderLeaderCard("SWING THEN TAKE PERCENTAGE", "MINIMUM: 15 SWINGS (NOT THE FINAL PITCH) · % FOLLOWED BY TAKING THE NEXT PITCH",
      leaders.swingThenTake.map(x => ({ name: x.name, valueLabel: `${x.balls}B / ${x.strikes}S · ${Math.round(x.pct)}%` }))),
    renderLeaderCard("BEST DAMAGE COUNT", "MINIMUM: 15 BIP IN COUNT · HIGHEST XBH/BIP IN ANY SINGLE COUNT",
      leaders.bestDamage.map(x => ({ name: x.name, valueLabel: `${x.count}: ${x.ratio.toFixed(3).replace(/^0/, "")} (${x.xbh}/${x.bip})` }))),
    renderLeaderCard("STRONGEST COUNT TENDENCY", "MINIMUM: 10 PITCHES IN COUNT · LARGEST SWING OR TAKE TENDENCY",
      leaders.strongestTendency.map(x => ({ name: x.name, valueLabel: `${x.count}: ${x.type} ${Math.round(x.pct)}%` }))),
    renderLeaderCard("STRIKE TAKE PERCENTAGE", "MINIMUM: 10 TAKEN PITCHES IN COUNT · HIGHEST % OF TAKES THAT WERE CALLED STRIKES",
      leaders.strikeTake.map(x => ({ name: x.name, valueLabel: `${x.count}: ${Math.round(x.pct)}%` }))),
    renderLeaderCard("STEAL TIMING", "MINIMUM: 3 STOLEN BASE ATTEMPTS · MOST COMMON STRIKE COUNT WHEN THEY GO",
      leaders.stealTiming.map(x => ({ name: x.name, valueLabel: `${x.strikes} strike${x.strikes === 1 ? "" : "s"}: ${Math.round(x.pct)}% (${x.total} att.)` }))),
  ];

  const playerTableHtml = selectedPlayerName && selectedPlayerTotals
    ? renderCountTable(selectedPlayerTotals.pitchCounts || {}, selectedPlayerTotals.countXBH || {}, selectedPlayerName.toUpperCase())
    : `<div style="border:1px dashed var(--border);border-radius:8px;padding:24px;text-align:center;color:var(--muted);font-size:.85rem;">Select a player above to see their individual count breakdown.</div>`;

  return `
    <div style="background:var(--navy);border-radius:8px 8px 0 0;padding:16px 20px;color:#fff;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div style="font-size:.65rem;letter-spacing:.08em;color:#8fa; color:#9fd6a8;">OPPONENT SCOUTING</div>
          <div style="font-size:1.4rem;font-weight:800;">${teamLabel}</div>
          <div style="font-size:.68rem;letter-spacing:.05em;color:#cfd9e2;">COUNT-BASED HITTER APPROACH REPORT</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:1rem;font-weight:800;">COUNT &amp; SWING</div>
          <div style="font-size:1rem;font-weight:800;color:#9fd6a8;">TENDENCIES</div>
        </div>
      </div>
    </div>
    <div style="border:1px solid var(--border);border-top:none;padding:16px 20px;background:#fafbfc;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div style="font-weight:700;font-size:.85rem;">QUICK SCOUT</div>
        <div style="font-size:.65rem;color:var(--muted);letter-spacing:.04em;">QUALIFIED TEAM LEADERS</div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;">${leaderCards.join("")}</div>
    </div>
    <div style="border:1px solid var(--border);border-top:none;padding:16px 20px;background:#fff;">
      <div style="display:flex;flex-wrap:wrap;gap:16px;">
        <div style="flex:1;min-width:320px;">${renderCountTable(teamCounts, teamXBH, "TEAM TOTAL")}</div>
        <div style="flex:1;min-width:320px;">${playerTableHtml}</div>
      </div>
    </div>
    <div style="border:1px solid var(--border);border-top:none;border-radius:0 0 8px 8px;padding:14px 20px;background:#fafbfc;">
      <div style="font-weight:700;font-size:.8rem;margin-bottom:8px;display:flex;justify-content:space-between;">
        <span>REPORT GUIDE</span><span style="font-size:.62rem;color:var(--muted);">COUNT-BASED HITTER APPROACH</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:16px;font-size:.75rem;">
        <div style="flex:1;min-width:150px;"><strong>SWING %</strong><br/><span style="color:var(--muted);">Percentage of all pitches the hitter swung at in that count.</span></div>
        <div style="flex:1;min-width:150px;"><strong>TAKE %</strong><br/><span style="color:var(--muted);">Percentage of all pitches the hitter took in that count.</span></div>
        <div style="flex:1;min-width:150px;"><strong>XBH/BIP</strong><br/><span style="color:var(--muted);">Extra-base hits divided by balls put in play in that count.</span></div>
        <div style="flex:1;min-width:150px;"><strong>TOTAL PA</strong><br/><span style="color:var(--muted);">Number of plate appearances that reached that count.</span></div>
      </div>
      <div style="margin-top:8px;font-size:.68rem;color:#2e8b57;">READING THE DATA: 11/18 (61%) means 11 extra-base hits on 18 balls put in play from that count.</div>
    </div>`;
}

/* ---------- Pitching Scout Report ----------
 * A staff-wide pitching report: team summary bar, Rotation/Bullpen tables,
 * a workload-detail table, and a per-outing opponent breakdown. W/L/SV are
 * always shown as "-" — reliably determining pitcher-of-record requires
 * game-state logic (who was ahead when, save situations) this text format
 * doesn't give us cleanly, so rather than guess, those are left blank.
 */

function pitchIpDisplay(outs) { return `${Math.floor(outs / 3)}.${outs % 3}`; }
function pitchEra(ER, outs) { return outs ? (ER * 21 / outs) : null; }
function pitchWhip(H, BB, outs) { return outs ? ((H + BB) / (outs / 3)) : null; }
function pitchK7(K, outs) { return outs ? (K * 21 / outs) : null; }
function pitchBB7(BB, outs) { return outs ? (BB * 21 / outs) : null; }
function pitchKBB(K, BB) { return BB ? (K / BB) : (K > 0 ? K : 0); }
function pitchStrikePct(strikes, total) { return total ? (strikes / total * 100) : null; }
function fmt1(v) { return v == null ? "-" : v.toFixed(1); }
function fmt2(v) { return v == null ? "-" : v.toFixed(2); }
function fmtPct(v) { return v == null ? "-" : Math.round(v) + "%"; }

function renderStaffTable(names, seasonPitching, staffData, title, headerColor) {
  const rows = names.map(name => {
    const p = seasonPitching[name];
    if (!p) return "";
    const gs = staffData.gsCounts[name] || 0, relief = staffData.reliefCounts[name] || 0;
    const since = staffData.sincePitched[name];
    const strikePct = pitchStrikePct(p.strikesThrown, p.pitchesThrown);
    return `<tr>
      <td style="text-align:left;font-weight:700;">${name}</td>
      <td>${gs || "-"}</td><td>${relief || "-"}</td><td>${gs + relief}</td>
      <td>${since != null ? since : "-"}</td>
      <td>${pitchIpDisplay(p.outs)}</td><td>${p.H}</td><td>${p.R}</td><td>${p.ER}</td><td>${p.BB}</td><td>${p.K}</td>
      <td>${fmt2(pitchEra(p.ER, p.outs))}</td><td>${fmt2(pitchWhip(p.H, p.BB, p.outs))}</td>
      <td>${fmtPct(strikePct)}</td><td>${fmt1(pitchKBB(p.K, p.BB))}</td>
    </tr>`;
  }).join("");
  return `
    <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:14px;">
      <div style="background:${headerColor};color:#fff;padding:7px 14px;font-weight:700;font-size:.78rem;">${title}</div>
      <div style="overflow-x:auto;">
        <table class="data-table" style="margin-top:0;min-width:760px;">
          <thead><tr>
            <th>Pitcher</th><th>GS</th><th>Relief</th><th>G</th><th>Since Pitched</th>
            <th>IP</th><th>H</th><th>R</th><th>ER</th><th>BB</th><th>SO</th><th>ERA</th><th>WHIP</th><th>S%</th><th>K/BB</th>
          </tr></thead>
          <tbody>${rows || `<tr><td colspan="14">No pitchers in this group.</td></tr>`}</tbody>
        </table>
      </div>
    </div>`;
}

function renderWorkloadTable(names, seasonPitching, staffData) {
  let totals = { GS: 0, relief: 0, BF: 0, P: 0, strikes: 0, WP: 0, HBP: 0 };
  const rows = names.map(name => {
    const p = seasonPitching[name];
    if (!p) return "";
    const gs = staffData.gsCounts[name] || 0, relief = staffData.reliefCounts[name] || 0;
    const strikePct = pitchStrikePct(p.strikesThrown, p.pitchesThrown);
    const ballPct = strikePct == null ? null : 100 - strikePct;
    const pPerSp = gs ? (p.pitchesThrown / gs) : null;
    const pPerBf = p.battersFaced ? (p.pitchesThrown / p.battersFaced) : null;
    totals.GS += gs; totals.relief += relief; totals.BF += p.battersFaced; totals.P += p.pitchesThrown;
    totals.strikes += p.strikesThrown; totals.WP += p.WP; totals.HBP += p.HBP;
    return `<tr>
      <td style="text-align:left;font-weight:700;">${name}</td>
      <td>${gs || "-"}</td><td>${relief || "-"}</td><td>${p.battersFaced}</td><td>${p.pitchesThrown}</td>
      <td>${fmtPct(strikePct)}</td><td>${fmtPct(ballPct)}</td>
      <td>${fmt1(pPerSp)}</td><td>${fmt2(pPerBf)}</td>
      <td>${p.WP || "-"}</td><td>${p.HBP || "-"}</td><td>-</td><td>-</td><td>-</td>
    </tr>`;
  }).join("");
  const totalStrikePct = pitchStrikePct(totals.strikes, totals.P);
  return `
    <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:14px;">
      <div style="background:#5c6b78;color:#fff;padding:7px 14px;font-weight:700;font-size:.78rem;display:flex;justify-content:space-between;">
        <span>WORKLOAD &amp; DETAIL</span><span style="font-size:.62rem;color:#e3e7ea;">PITCHES · EXTRAS · DECISIONS (SAME BOARD WHEN SPACE ALLOWS)</span>
      </div>
      <div style="overflow-x:auto;">
        <table class="data-table" style="margin-top:0;min-width:900px;">
          <thead><tr>
            <th>Pitcher</th><th>GS</th><th>Relief</th><th>BF</th><th>#P</th><th>S%</th><th>Ball%</th>
            <th>P/SP</th><th>P/BF</th><th>WP</th><th>HBP</th><th>W</th><th>L</th><th>SV</th>
          </tr></thead>
          <tbody>
            ${rows}
            <tr style="background:#f4f6f8;font-weight:700;">
              <td style="text-align:left;">Team</td><td>${totals.GS}</td><td>${totals.relief}</td><td>${totals.BF}</td><td>${totals.P}</td>
              <td>${fmtPct(totalStrikePct)}</td><td>${fmtPct(totalStrikePct == null ? null : 100 - totalStrikePct)}</td>
              <td>-</td><td>-</td><td>${totals.WP || "-"}</td><td>${totals.HBP || "-"}</td><td>-</td><td>-</td><td>-</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderOpponentBoxTable(names, staffData) {
  const rows = [];
  names.forEach(name => {
    const games = staffData.perPitcherGames[name] || [];
    games.forEach((g, i) => {
      const era = pitchEra(g.stats.R, g.stats.outs);
      const whip = pitchWhip(g.stats.H, g.stats.BB, g.stats.outs);
      rows.push(`<tr>
        <td style="text-align:left;font-weight:700;">${i === 0 ? name : ""}</td>
        <td style="text-align:left;">${g.opponent}</td>
        <td>${g.role}</td><td>${pitchIpDisplay(g.stats.outs)}</td><td>${g.stats.H}</td><td>${g.stats.R}</td>
        <td>${g.stats.BB}</td><td>${g.stats.K}</td><td>${fmt2(era)}</td><td>${fmt2(whip)}</td>
      </tr>`);
    });
  });
  return `
    <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;">
      <div style="background:var(--navy);color:#fff;padding:7px 14px;font-weight:700;font-size:.78rem;display:flex;justify-content:space-between;">
        <span>OPPONENT BOX</span><span style="font-size:.62rem;color:#cfd9e2;">EVERY OUTING · ROLE = SP/RP · PITCHERS STAY GROUPED</span>
      </div>
      <div style="overflow-x:auto;">
        <table class="data-table" style="margin-top:0;min-width:760px;">
          <thead><tr><th>Pitcher</th><th>Opponent</th><th>Role</th><th>IP</th><th>H</th><th>ER</th><th>BB</th><th>SO</th><th>ERA</th><th>WHIP</th></tr></thead>
          <tbody>${rows.join("") || `<tr><td colspan="10">No outings recorded.</td></tr>`}</tbody>
        </table>
      </div>
    </div>`;
}

function renderPitchingScoutReport(teamLabel, seasonPitching, staffData) {
  const names = Object.keys(seasonPitching);
  const rotationNames = names.filter(n => (staffData.gsCounts[n] || 0) > 0);
  const bullpenNames = names.filter(n => (staffData.gsCounts[n] || 0) === 0);

  let teamOuts = 0, teamH = 0, teamR = 0, teamER = 0, teamBB = 0, teamK = 0, teamPitches = 0, teamStrikes = 0;
  names.forEach(n => {
    const p = seasonPitching[n];
    teamOuts += p.outs; teamH += p.H; teamR += p.R; teamER += p.ER; teamBB += p.BB; teamK += p.K;
    teamPitches += p.pitchesThrown; teamStrikes += p.strikesThrown;
  });
  const teamStrikePct = pitchStrikePct(teamStrikes, teamPitches);

  const summaryBox = (label, value) => `
    <div style="flex:1;text-align:center;padding:10px 4px;border-right:1px solid rgba(255,255,255,.12);">
      <div style="font-size:.62rem;color:#cfd9e2;letter-spacing:.03em;">${label}</div>
      <div style="font-size:1.15rem;font-weight:800;">${value}</div>
    </div>`;

  return `
    <div style="background:var(--navy);border-radius:8px 8px 0 0;padding:14px 20px;color:#fff;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div style="font-size:.62rem;letter-spacing:.08em;color:#9fd6a8;">OPPONENT IQ SCOUTING</div>
          <div style="font-size:1.3rem;font-weight:800;">${teamLabel}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:1.1rem;font-weight:800;">PITCHING SCOUT REPORT</div>
          <div style="font-size:.62rem;color:#cfd9e2;">Game-day staff board · box score source</div>
        </div>
      </div>
      <div style="font-size:.62rem;color:#9fb0c0;margin-top:6px;">
        GS = STARTS · RELIEF = BULLPEN APPEARANCES · SINCE PITCHED = GAMES SINCE LAST PITCHED · RATES USE 7-INNING REGULATION ·
        ${rotationNames.length + bullpenNames.length} ARM${rotationNames.length + bullpenNames.length === 1 ? "" : "S"} ON BOARD
      </div>
    </div>
    <div style="background:#16324f;display:flex;border-top:1px solid rgba(255,255,255,.1);">
      ${summaryBox("ERA", fmt2(pitchEra(teamER, teamOuts)))}
      ${summaryBox("WHIP", fmt2(pitchWhip(teamH, teamBB, teamOuts)))}
      ${summaryBox("K/7 IP", fmt1(pitchK7(teamK, teamOuts)))}
      ${summaryBox("BB/7 IP", fmt1(pitchBB7(teamBB, teamOuts)))}
      ${summaryBox("K/BB", fmt1(pitchKBB(teamK, teamBB)))}
      ${summaryBox("S%", fmtPct(teamStrikePct))}
      ${summaryBox("IP", pitchIpDisplay(teamOuts))}
      ${summaryBox("G", staffData.totalGames)}
    </div>
    <div style="border:1px solid var(--border);border-top:none;padding:16px 20px;background:#fafbfc;">
      ${renderStaffTable(rotationNames, seasonPitching, staffData, "ROTATION", "#2e7d4f")}
      ${renderStaffTable(bullpenNames, seasonPitching, staffData, "BULLPEN", "var(--navy)")}
      ${renderWorkloadTable(names, seasonPitching, staffData)}
      ${renderOpponentBoxTable(names, staffData)}
    </div>
    <p class="hint" style="margin-top:6px;">
      R is every run allowed; ER excludes runs that scored in a play where a fielding error was also recorded (a block-level
      estimate, not official scoring — it doesn't trace a run through the whole inning's defensive sequence). ERA uses ER.
      W/L/SV aren't computed — reliably crediting a pitcher of record needs game-state logic this text format doesn't give cleanly, so those stay blank rather than guess.
      Games where the log never explicitly names an early pitcher (only a later substitution) credit the start to the first pitcher actually named, which may occasionally misattribute a start to a reliever.
    </p>`;
}

/* ---------- Team Tendencies ----------
 * A plain-language scouting summary of a team's overall tendencies: plate
 * discipline, strikeout rate, power profile, running game, and staff
 * control/strikeouts. Each metric is bucketed against fixed thresholds
 * (not compared to other teams in the system) to produce a short,
 * practical note — the same kind of framing a scout would jot down, not a
 * precise statistical claim. Rates use per-7-innings, matching the rest of
 * this app (built around 7-inning HS/travel games), not the traditional
 * per-9 convention.
 */

function pickTendencyText(value, buckets) {
  for (const [min, text] of buckets) if (value >= min) return text;
  return buckets[buckets.length - 1][1];
}

function computeTeamTendencies(totalsArray, pitchingTotals, gamesPlayed) {
  const sum = key => totalsArray.reduce((a, t) => a + (t[key] || 0), 0);
  const teamPA = sum("PA"), teamBB = sum("BB"), teamK = sum("K"), teamH = sum("H"), teamXBH = sum("XBH"), teamSB = sum("SB");

  const pitchers = Object.values(pitchingTotals);
  const pitchBB = pitchers.reduce((a, p) => a + (p.BB || 0), 0);
  const pitchK = pitchers.reduce((a, p) => a + (p.K || 0), 0);
  const pitchOuts = pitchers.reduce((a, p) => a + (p.outs || 0), 0);

  const walkRate = teamPA ? (teamBB / teamPA) * 100 : 0;
  const kRate = teamPA ? (teamK / teamPA) * 100 : 0;
  const powerPct = teamH ? (teamXBH / teamH) * 100 : 0;
  const sbPerGame = gamesPlayed ? teamSB / gamesPlayed : 0;
  const staffBB7 = pitchOuts ? (pitchBB * 21) / pitchOuts : 0;
  const staffK7 = pitchOuts ? (pitchK * 21) / pitchOuts : 0;

  const topPowerThreats = totalsArray.filter(t => t.XBH > 0)
    .sort((a, b) => b.XBH - a.XBH).slice(0, 3).map(t => t.name);

  return [
    {
      metric: "Plate discipline", value: `${walkRate.toFixed(1)}% walk rate`,
      meaning: pickTendencyText(walkRate, [
        [10, "Patient, disciplined lineup — expect long at-bats and be ready to work the zone carefully rather than nibbling."],
        [6, "Average discipline — they'll take some pitches, but won't automatically give away free bases either."],
        [0, "Aggressive, free-swinging lineup — pound the strike zone early and often rather than trying to work around them."],
      ]),
    },
    {
      metric: "Strikeout rate", value: `${kRate.toFixed(1)}% of plate appearances`,
      meaning: pickTendencyText(kRate, [
        [25, "Strikes out at a high clip — trust the zone, challenge hitters, and let your defense play behind you."],
        [15, "Moderate swing-and-miss — mixing speeds and locations should generate some empty swings."],
        [0, "Puts the ball in play consistently — expect quick, ball-in-play outs rather than relying on strikeouts."],
      ]),
    },
    {
      metric: "Power profile", value: `${powerPct.toFixed(1)}% of hits go for extra bases`,
      meaning: pickTendencyText(powerPct, [
        [25, `Legitimate power threats throughout the order — respect the barrel everywhere${topPowerThreats.length ? `, especially ${topPowerThreats.join(", ")}` : ""}.`],
        [15, `Average power overall${topPowerThreats.length ? `, but ${topPowerThreats.join(", ")} are genuine extra-base threats to respect specifically` : ""}.`],
        [0, "Mostly a singles-and-speed lineup — limited over-the-fence or gap power to worry about."],
      ]),
    },
    {
      metric: "Running game", value: `${sbPerGame.toFixed(1)} SB per game`,
      meaning: pickTendencyText(sbPerGame, [
        [3, "Very active on the bases — they will pressure you constantly, so control the running game and don't get lazy with times to the plate."],
        [1, "Moderate aggression on the bases — stay disciplined with your delivery times and don't give away easy jumps."],
        [0, "Rarely runs — don't over-commit to holding runners at the expense of your pitcher's normal rhythm."],
      ]),
    },
    {
      metric: "Staff control", value: `${staffBB7.toFixed(2)} BB/7`,
      meaning: pickTendencyText(staffBB7, [
        [4, "Walk-prone staff — work counts aggressively, be selective, and make them find the zone before you expand."],
        [2, "Occasionally wild — patient hitters can work counts and draw walks against this staff."],
        [0, "Around-the-zone staff — don't expect free baserunners, be ready to hit rather than waiting them out."],
      ]),
    },
    {
      metric: "Staff strikeouts", value: `${staffK7.toFixed(2)} K/7`,
      meaning: pickTendencyText(staffK7, [
        [9, "Swing-and-miss heavy staff — shorten up with two strikes and battle rather than trying to do too much."],
        [5, "Moderate swing-and-miss stuff — stay disciplined and don't chase out of the zone."],
        [0, "Contact-friendly staff — expect balls in play, be ready to hit early in counts."],
      ]),
    },
  ];
}

function renderTeamTendencies(teamLabel, tendencies) {
  const rows = tendencies.map(row => `
    <tr>
      <td style="text-align:left;font-weight:700;white-space:nowrap;">${row.metric}</td>
      <td style="text-align:left;white-space:nowrap;">${row.value}</td>
      <td style="text-align:left;">${row.meaning}</td>
    </tr>`).join("");

  return `
    <div>
      <h2 style="border-bottom:3px solid var(--danger);display:inline-block;padding-bottom:4px;color:var(--danger);">TEAM TENDENCIES</h2>
      <div style="font-size:.85rem;color:var(--muted);margin:-8px 0 14px;">${teamLabel}</div>
      <div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px;">
        <table class="data-table" style="margin-top:0;min-width:640px;">
          <thead><tr>
            <th style="text-align:left;color:var(--danger);">METRIC</th>
            <th style="text-align:left;color:var(--danger);">VALUE</th>
            <th style="text-align:left;color:var(--danger);">WHAT IT MEANS</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="hint" style="margin-top:8px;">
        Each note is generated from fixed statistical thresholds for this team's overall numbers — not a comparison against other teams
        in the system, and not written by a human scout. Treat it as a starting point, not a final read.
      </p>
    </div>`;
}

/* ---------- Current Performance + Top Performers ----------
 * Team-wide slash line and counting stats, plus a top-5 leaderboard by
 * batting average (minimum plate-appearance threshold to avoid tiny-sample
 * flukes). RBI is a new computed field: credited to the batter whose own
 * block a run scored in, EXCLUDING runs that scored via wild pitch or
 * passed ball (those aren't RBIs under standard scoring rules). This is a
 * block-level heuristic, not exact play-by-play attribution — treat it as
 * a reasonable estimate, not an official statistic.
 */

function computeTeamCurrentPerformance(totalsArray) {
  const sum = key => totalsArray.reduce((a, t) => a + (t[key] || 0), 0);
  const teamAB = sum("AB"), teamH = sum("H"), teamBB = sum("BB"), teamHBP = sum("HBP"), teamPA = sum("PA");
  const teamTB = totalsArray.reduce((a, t) => a + (t["1B"] || 0) * 1 + (t["2B"] || 0) * 2 + (t["3B"] || 0) * 3 + (t.HR || 0) * 4, 0);
  const avg = teamAB ? teamH / teamAB : 0;
  const obp = teamPA ? (teamH + teamBB + teamHBP) / teamPA : 0;
  const slg = teamAB ? teamTB / teamAB : 0;
  return {
    avg, obp, slg, ops: obp + slg,
    hits: teamH, runs: sum("RunsScored"), rbi: sum("RBI"), hr: sum("HR"),
  };
}

// Team-wide pitching slash line, matching computeTeamCurrentPerformance's batting shape.
function computeTeamPitchingSummary(pitchingTotals) {
  const pitchers = Object.values(pitchingTotals || {});
  const sum = key => pitchers.reduce((a, p) => a + (p[key] || 0), 0);
  const outs = sum("outs"), h = sum("H"), er = sum("ER"), bb = sum("BB"), k = sum("K");
  return {
    era: outs ? (er * 21) / outs : 0,
    whip: outs ? (h + bb) / (outs / 3) : 0,
    k7: outs ? (k * 21) / outs : 0,
    bb7: outs ? (bb * 21) / outs : 0,
    outs,
  };
}

/* ---------- Performance Trends ----------
 * Two comparisons, both using real game dates now that they're tracked:
 * the team's first half of the season vs its second half, and its most
 * recent games vs the full season. Both are genuinely small samples for a
 * HS/travel team's game count, especially "recent" — shown as a direct
 * side-by-side with an up/down indicator rather than a confident verdict,
 * since a handful of games swinging one way is easy to over-read.
 */

function trendArrow(before, after, higherIsBetter) {
  if (before === after) return `<span style="color:var(--muted);">–</span>`;
  const improved = higherIsBetter ? after > before : after < before;
  return improved
    ? `<span style="color:#2e8b57;font-weight:700;">▲</span>`
    : `<span style="color:var(--danger);font-weight:700;">▼</span>`;
}

function trendRow(label, before, after, fmt, higherIsBetter) {
  return `<tr>
    <td style="text-align:left;font-weight:700;">${label}</td>
    <td>${fmt(before)}</td>
    <td>${fmt(after)}</td>
    <td>${trendArrow(before, after, higherIsBetter)}</td>
  </tr>`;
}

function renderTrendTable(title, beforeLabel, afterLabel, before, after, subtitle) {
  const avgFmt = v => v.toFixed(3).replace(/^0/, "");
  const rows = [
    trendRow("AVG", before.batting.avg, after.batting.avg, avgFmt, true),
    trendRow("OBP", before.batting.obp, after.batting.obp, avgFmt, true),
    trendRow("SLG", before.batting.slg, after.batting.slg, avgFmt, true),
    trendRow("OPS", before.batting.ops, after.batting.ops, v => v.toFixed(3).replace(/^0/, ""), true),
    trendRow("ERA", before.pitching.era, after.pitching.era, v => v.toFixed(2), false),
    trendRow("WHIP", before.pitching.whip, after.pitching.whip, v => v.toFixed(2), false),
    trendRow("K/7", before.pitching.k7, after.pitching.k7, v => v.toFixed(1), true),
    trendRow("BB/7", before.pitching.bb7, after.pitching.bb7, v => v.toFixed(1), false),
  ].join("");

  return `
    <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:16px;">
      <div style="background:var(--navy);color:#fff;padding:8px 14px;">
        <div style="font-weight:700;">${title}</div>
        <div style="font-size:.72rem;color:#cfd9e2;">${subtitle}</div>
      </div>
      <table class="data-table" style="margin-top:0;">
        <thead><tr><th style="text-align:left;">Stat</th><th>${beforeLabel}</th><th>${afterLabel}</th><th>Trend</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderPerformanceTrends(teamLabel, halfSplit, recentSplit) {
  if (!halfSplit || halfSplit.before.gameCount === 0) {
    return `<p class="hint">No games with tracked at-bats yet for ${teamLabel}.</p>`;
  }

  const halfTable = halfSplit.before.gameCount >= 1 && halfSplit.after.gameCount >= 1
    ? renderTrendTable(
        "First Half vs. Second Half", "1ST HALF", "2ND HALF", halfSplit.before, halfSplit.after,
        `${halfSplit.before.gameCount} game(s) → ${halfSplit.after.gameCount} game(s), split by date`)
    : `<p class="hint">Need at least 2 games to split into halves — only ${halfSplit.before.gameCount + halfSplit.after.gameCount} recorded so far.</p>`;

  const recentTable = recentSplit && recentSplit.after.gameCount > 0
    ? renderTrendTable(
        "Season vs. Most Recent Games", "FULL SEASON", `LAST ${recentSplit.after.gameCount}`, recentSplit.before, recentSplit.after,
        `${recentSplit.before.gameCount} game(s) total`)
    : "";

  return `
    <div>
      <h2 style="margin:0 0 12px;">${teamLabel}</h2>
      ${halfTable}
      ${recentTable}
      <p class="hint" style="margin-top:4px;">
        Both splits use game dates you've entered — a guessed or missing date can put a game in the wrong half or drop it from
        the "recent" group. These are small samples, especially "recent games" — treat a swing in either direction as worth
        watching, not as a confirmed trend.
      </p>
    </div>`;
}

function computeTopPerformers(totalsArray, n = 5, minPA = 10) {
  return totalsArray
    .filter(t => t.PA >= minPA && t.AB > 0)
    .map(t => {
      const totalBases = (t["1B"] || 0) * 1 + (t["2B"] || 0) * 2 + (t["3B"] || 0) * 3 + (t.HR || 0) * 4;
      const avg = t.H / t.AB;
      const obp = t.PA ? (t.H + t.BB + t.HBP) / t.PA : 0;
      const slg = totalBases / t.AB;
      return { name: t.name, avg, obp, slg, rbi: t.RBI || 0, hr: t.HR || 0 };
    })
    .sort((a, b) => b.avg - a.avg)
    .slice(0, n);
}

function fmtAvg(v) { return v.toFixed(3).replace(/^0/, ""); }

function renderCurrentPerformance(perf) {
  return `
    <div style="border:1px solid var(--border);border-radius:8px;padding:16px 20px;margin-bottom:16px;">
      <div style="font-weight:700;font-size:.95rem;margin-bottom:10px;">Current Performance</div>
      <ul style="margin:0;padding-left:20px;font-size:.85rem;line-height:1.8;">
        <li>The team has a <strong>${fmtAvg(perf.avg)}</strong> AVG, <strong>${fmtAvg(perf.obp)}</strong> OBP,
          <strong>${fmtAvg(perf.slg)}</strong> SLG, and a <strong>${perf.ops.toFixed(3).replace(/^0/, "")}</strong> OPS.</li>
        <li>Total production so far: <strong>${perf.hits}</strong> hits, <strong>${perf.runs}</strong> runs,
          <strong>${perf.rbi}</strong> RBIs, and <strong>${perf.hr}</strong> home runs.</li>
      </ul>
    </div>`;
}

function renderTopPerformers(performers) {
  const rows = performers.length
    ? performers.map((p, i) => `
        <div style="padding:6px 0;${i < performers.length - 1 ? "border-bottom:1px solid #f0f0f0;" : ""}font-size:.85rem;">
          <strong>${p.name}:</strong> AVG ${fmtAvg(p.avg)}, OBP ${fmtAvg(p.obp)}, SLG ${fmtAvg(p.slg)},
          ${p.rbi} RBI${p.rbi === 1 ? "" : "s"}, ${p.hr} HR${p.hr === 1 ? "" : "s"}
        </div>`).join("")
    : `<p class="hint" style="margin:4px 0;">No players have met the minimum plate-appearance threshold yet.</p>`;
  return `
    <div style="border:1px solid var(--border);border-radius:8px;padding:16px 20px;">
      <div style="font-weight:700;font-size:.95rem;margin-bottom:10px;">Top Performers</div>
      ${rows}
      <p class="hint" style="margin-top:8px;">Minimum 10 plate appearances to qualify, ranked by batting average.</p>
    </div>`;
}

/* ---------- Defensive Statistics ----------
 * Play-by-play text gives real signal for only two defensive numbers with
 * confidence: Errors (explicitly named in the narrative — "error by
 * <position> <Name>") and Putouts on unassisted catches (a caught fly
 * ball/pop-up/line drive is always a clean, single-fielder out, no
 * ambiguity about who else touched it). Everything else GameChanger
 * normally tracks — assists, fielding %, double/triple plays turned,
 * catcher-specific innings/passed balls/caught-stealing, and innings
 * played by position — requires either a full fielding sequence per play
 * or roster/lineup position assignments, neither of which this text
 * format reliably provides. Rather than approximate those with
 * potentially misleading numbers, they're listed as unavailable.
 */

function renderDefensiveStatsTable(totalsArray, gpMap) {
  const rows = totalsArray
    .filter(t => t.PO > 0 || t.E > 0)
    .sort((a, b) => (b.PO + b.E) - (a.PO + a.E))
    .map(t => `
      <tr>
        <td style="text-align:left;font-weight:700;">${t.name}</td>
        <td style="text-align:left;">${t.team || "-"}</td>
        <td>${gpMap && gpMap[t.name] ? gpMap[t.name] : "-"}</td>
        <td>${t.PO}</td>
        <td style="${t.E > 0 ? "color:var(--danger);font-weight:700;" : ""}">${t.E}</td>
      </tr>`).join("");

  return `
    <div>
      <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;">
        <table class="data-table" style="margin-top:0;">
          <thead><tr>
            <th style="text-align:left;">Player</th>
            <th style="text-align:left;">Team</th>
            <th>GP</th>
            <th>PO</th>
            <th>E</th>
          </tr></thead>
          <tbody>${rows || `<tr><td colspan="5" class="hint" style="text-align:left;">No defensive plays recorded yet.</td></tr>`}</tbody>
        </table>
      </div>
      <p class="hint" style="margin-top:8px;">
        <strong>PO</strong> (putouts) only counts unassisted catches — fly outs, pop outs, and line outs — since those are the
        one defensive play type this text format identifies a specific fielder for with real confidence.
        <strong>E</strong> counts errors explicitly attributed to a fielder by name in the log.
      </p>
      <div style="border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-top:10px;background:#fafafa;">
        <div style="font-weight:700;font-size:.82rem;margin-bottom:6px;">Not available from play-by-play text</div>
        <p class="hint" style="margin:0;">
          Assists, fielding %, double/triple plays turned, and total chances all require knowing the complete fielding sequence
          on every play (who fielded it, who threw it, who caught it), which this log format doesn't reliably state for routine
          plays — only errors and unassisted putouts. Catcher-specific stats (innings caught, passed balls, stolen bases/caught
          stealing while catching, caught-stealing %, pickoffs, catcher's interference) and innings played by position both
          require roster/lineup data — which position each player was playing and for how long — that simply isn't part of a
          play-by-play narrative at all.
        </p>
      </div>
    </div>`;
}

/* ---------- Lineup Builder ----------
 * Suggests a 1-9 batting order from tracked stats using a common, teachable
 * construction rule rather than a black-box optimizer: the leadoff and
 * 2-hole spots prioritize OBP (table-setters), the cleanup and 5-hole spots
 * prioritize SLG (power), the 3-hole goes to the best remaining hitter by
 * OPS (protects cleanup), and the bottom of the order (6-9) is whoever's
 * left, sorted by OPS. This is a reasonable, explainable suggestion — not a
 * guarantee, and it doesn't know anything about handedness, speed, or
 * matchups the way a coach does.
 */

function computeLineupOrder(totalsArray) {
  const qualified = totalsArray.filter(t => t.PA > 0).map(t => {
    const bat = computeBattingMetrics(t);
    return { name: t.name, obp: bat.obp, slg: bat.slg, ops: bat.ops };
  });

  const remaining = [...qualified];
  const takeBy = key => {
    if (!remaining.length) return null;
    let bestIdx = 0;
    remaining.forEach((p, i) => { if (p[key] > remaining[bestIdx][key]) bestIdx = i; });
    return remaining.splice(bestIdx, 1)[0];
  };

  const slots = new Array(9).fill(null);
  slots[0] = takeBy("obp");  // 1: leadoff — OBP
  slots[3] = takeBy("slg");  // 4: cleanup — SLG
  slots[2] = takeBy("ops");  // 3: best remaining all-around hitter
  slots[1] = takeBy("obp");  // 2: table-setter — OBP
  slots[4] = takeBy("slg");  // 5: secondary power — SLG
  for (let i = 5; i < 9; i++) slots[i] = takeBy("ops"); // 6-9: best of what's left

  const battingOrder = slots.filter(Boolean).map(p => p.name);
  const usedNames = new Set(battingOrder);
  const subs = qualified.filter(p => !usedNames.has(p.name)).map(p => p.name);

  return { battingOrder, subs };
}

function renderLineupCard(teamLabel, lineupResult) {
  const rows = lineupResult.battingOrder.map((name, i) => `
    <tr>
      <td style="font-weight:700;">${i + 1}</td>
      <td></td>
      <td style="text-align:left;font-weight:700;">${name}</td>
      <td></td>
    </tr>`).join("")
    + Array.from({ length: 9 - lineupResult.battingOrder.length }).map((_, i) => `
    <tr>
      <td style="font-weight:700;">${lineupResult.battingOrder.length + i + 1}</td>
      <td></td><td></td><td></td>
    </tr>`).join("");

  const subCols = [[], []];
  lineupResult.subs.forEach((name, i) => subCols[i % 2].push(name));
  const subRows = Math.max(subCols[0].length, subCols[1].length);
  const subsTable = lineupResult.subs.length
    ? `<table class="data-table" style="margin-top:0;">
        <tbody>${Array.from({ length: subRows }).map((_, i) => `
          <tr>
            <td style="text-align:left;">${subCols[0][i] || ""}</td>
            <td style="text-align:left;">${subCols[1][i] || ""}</td>
          </tr>`).join("")}</tbody>
      </table>`
    : `<p class="hint">No additional players tracked for this team beyond the batting order.</p>`;

  const shortfallNote = lineupResult.battingOrder.length < 9
    ? `<p class="hint" style="color:var(--danger);">Only ${lineupResult.battingOrder.length} player${lineupResult.battingOrder.length === 1 ? "" : "s"} with recorded at-bats — not enough data yet to fill a full 9-spot order.</p>`
    : "";

  return `
    <div>
      <h2 style="margin:0 0 2px;">${teamLabel}</h2>
      <div style="color:var(--muted);font-size:.85rem;margin-bottom:2px;">VS ______________________</div>
      ${shortfallNote}
      <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-top:10px;">
        <table class="data-table" style="margin-top:0;">
          <thead><tr><th>Order</th><th>#</th><th style="text-align:left;">Name</th><th>Pos</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="font-weight:700;margin:16px 0 6px;">Substitutes</div>
      ${subsTable}
      <p class="hint" style="margin-top:10px;">
        Order is a suggestion from tracked stats: leadoff/2-hole by OBP, cleanup/5-hole by SLG, 3-hole by best remaining OPS,
        6-9 filled by remaining OPS. It doesn't account for handedness, speed, or matchups — use it as a starting point.
        # and Pos are left blank since this system doesn't track jersey numbers or defensive positions.
      </p>
    </div>`;
}
