/* gamelog-parser.js — parses raw, natural-language game logs (the format
 * exported by common scorekeeping apps like GameChanger), e.g.:
 *
 *   Strikeout
 *   3 Outs
 *   Strike 1 swinging, Foul, Ball 1, Ball 2, Strike 3 looking.
 *   S Underwood strikes out looking, J Pineda pitching.
 *
 * This is a heuristic, regex-based parser — real-world logs vary, so it
 * matches on the common patterns (play-type headers, narrative sentences,
 * steals/scores mentioned inline) rather than a strict grammar. Anything
 * it can't confidently read is skipped and reported back to the caller.
 */

const GLOG_HEADERS = new Set([
  "Strikeout","Fly Out","Ground Out","Pop Out","Line Out","Single","Double",
  "Triple","Home Run","Walk","Hit By Pitch","Error","Fielder's Choice",
  "Double Play","Triple Play","Runner Out","Dropped 3rd Strike","Sac Fly","Sac Bunt",
]);

const GLOG_INNING_RE = /^(Top|Bottom)\s+\d/;
const GLOG_NAME = "[A-Z][\\w.']*(?:\\s[A-Z][\\w.']*)*(?:\\sJr\\.)?";
const GLOG_NARRATIVE_START_RE = new RegExp(
  `^(${GLOG_NAME})\\s(strikes|flies|grounds|pops|lines|singles|doubles|triples|homers|walks|is hit|reaches|hits)`
);
const GLOG_STEAL_RE = new RegExp(`(${GLOG_NAME})\\ssteals\\s(2nd|3rd|home)`, "g");
const GLOG_CS_RE = new RegExp(`(${GLOG_NAME})\\s(?:caught stealing|out at)\\s(2nd|3rd|home)`, "g");
const GLOG_SCORES_RE = new RegExp(`(${GLOG_NAME})\\sscores`, "g");
const GLOG_ERROR_RE = new RegExp(
  `error by (pitcher|catcher|first baseman|second baseman|third baseman|shortstop|left fielder|center fielder|right fielder)\\s(${GLOG_NAME})`, "gi"
);
const GLOG_PICKED_OFF_RE = new RegExp(`(${GLOG_NAME})\\spicked off`, "g");
// For unassisted putouts (fly/pop/line outs) — a caught fly ball is always a clean,
// single-fielder putout, so this is the one defensive credit we can attribute with
// real confidence from narrative text alone.
const GLOG_PUTOUT_FIELDER_RE = new RegExp(
  `to\\s(pitcher|catcher|first baseman|second baseman|third baseman|shortstop|left fielder|center fielder|right fielder)\\s(${GLOG_NAME})`, "i"
);
const GLOG_UNASSISTED_PUTOUT_HEADERS = new Set(["Fly Out", "Pop Out", "Line Out"]);

const GLOG_POS_MAP = [
  ["pitcher", 1], ["catcher", 2], ["first baseman", 3], ["second baseman", 4],
  ["third baseman", 5], ["shortstop", 6], ["left fielder", 7],
  ["center fielder", 8], ["right fielder", 9],
];

function glogFindPosition(text) {
  for (const [k, v] of GLOG_POS_MAP) if (text.includes(k)) return v;
  if (text.includes("left field")) return 7;
  if (text.includes("center field")) return 8;
  if (text.includes("right field")) return 9;
  return null;
}

function glogHeaderToCode(header) {
  switch (header) {
    case "Strikeout": return { code: "K", isBip: false };
    case "Walk": return { code: "BB", isBip: false };
    case "Hit By Pitch": return { code: "HBP", isBip: false };
    case "Single": return { code: "1B", isBip: true };
    case "Double": return { code: "2B", isBip: true };
    case "Triple": return { code: "3B", isBip: true };
    case "Home Run": return { code: "HR", isBip: true };
    case "Fly Out": return { code: "FB", isBip: true };
    case "Ground Out": return { code: "GB", isBip: true };
    case "Pop Out": return { code: "PU", isBip: true };
    case "Line Out": return { code: "LO", isBip: true };
    case "Error": return { code: "E", isBip: true };
    case "Fielder's Choice": return { code: "FC", isBip: true };
    case "Double Play": return { code: "GB", isBip: true, isGIDP: true };
    case "Triple Play": return { code: "GB", isBip: true };
    case "Sac Fly": return { code: "SF", isBip: true };
    case "Sac Bunt": return { code: "SAC", isBip: true };
    case "Dropped 3rd Strike": return { code: "K", isBip: false };
    default: return null;
  }
}

const GLOG_HIT_CODES = new Set(["1B", "2B", "3B", "HR"]);
const GLOG_XBH_CODES = new Set(["2B", "3B", "HR"]);

// Turns a pitch-sequence token like "Ball 1" / "Strike 2 swinging" / "Foul" / "In play"
// into a classified pitch event. Returns null for anything that isn't a pitch outcome
// (lineup changes, steals, baserunning notes, etc. — these get mixed into the same
// comma-separated line in real exports and need to be filtered out).
function glogClassifyPitchToken(tokRaw) {
  const t = tokRaw.replace(/\.$/, "").trim();
  let m;
  if ((m = t.match(/^Ball\s+(\d+)$/i))) return { type: "ball", swing: false, resultBalls: parseInt(m[1], 10) };
  if ((m = t.match(/^Strike\s+(\d+)\s+looking$/i))) return { type: "strike_looking", swing: false, resultStrikes: parseInt(m[1], 10) };
  if ((m = t.match(/^Strike\s+(\d+)\s+swinging$/i))) return { type: "strike_swinging", swing: true, resultStrikes: parseInt(m[1], 10) };
  if (/^Foul$/i.test(t)) return { type: "foul", swing: true };
  if (/^In play$/i.test(t)) return { type: "in_play", swing: true };
  return null;
}

// Builds an ordered pitch sequence (with the ball-strike count BEFORE each pitch) from
// the non-narrative lines of a play block. Non-pitch clauses (lineup changes, steals,
// "advances to 2nd on error", etc.) are filtered out wherever they fall in the sequence.
//
// IMPORTANT: each line's comma-separated tokens are extracted independently, NOT by
// joining all lines into one string first. Joining first lets an adjacent line with no
// trailing comma (e.g. "3 Outs", or a score line) fuse onto the very next line's first
// token — e.g. "3 Outs" + "Strike 1 swinging, Foul, ..." becomes one merged token
// "3 Outs Strike 1 swinging", which then fails to match the classifier and silently
// drops that pitch. Processing line-by-line avoids that cross-line contamination.
const GLOG_STEAL_TOKEN_RE = new RegExp(`^(${GLOG_NAME})\\ssteals\\s(2nd|3rd|home)$`, "i");
const GLOG_CS_TOKEN_RE = new RegExp(`^(${GLOG_NAME})\\s(?:caught stealing|out at)\\s(2nd|3rd|home)`, "i");

function glogBuildPitchSequence(lines) {
  let balls = 0, strikes = 0;
  const pitches = [];
  const stealAttempts = []; // [{ runner, type: "SB"|"CS", base, count: "1-2" }] — count at the moment of the attempt
  lines.forEach(line => {
    const tokens = line.split(",").map(t => t.trim()).filter(Boolean);
    tokens.forEach(tokRaw => {
      const c = glogClassifyPitchToken(tokRaw);
      if (!c) {
        // Not a pitch token — check whether it's a steal/caught-stealing mention,
        // so we can record the count in progress at that exact moment.
        const sbMatch = tokRaw.match(GLOG_STEAL_TOKEN_RE);
        if (sbMatch) { stealAttempts.push({ runner: glogCleanName(sbMatch[1]), type: "SB", base: sbMatch[2], count: `${balls}-${strikes}` }); return; }
        const csMatch = tokRaw.match(GLOG_CS_TOKEN_RE);
        if (csMatch) { stealAttempts.push({ runner: glogCleanName(csMatch[1]), type: "CS", base: csMatch[2], count: `${balls}-${strikes}` }); return; }
        return;
      }
      pitches.push({ countBefore: `${balls}-${strikes}`, swing: c.swing, type: c.type });
      if (c.type === "ball") balls = c.resultBalls;
      else if (c.type === "strike_looking" || c.type === "strike_swinging") strikes = c.resultStrikes;
      else if (c.type === "foul" && strikes < 2) strikes++;
    });
  });
  return { pitches, stealAttempts };
}

const GLOG_INNING_HEADER_RE = /^(Top|Bottom)\s+(\d+)\w*\s*-\s*(.+)$/;
const GLOG_OUTS_LINE_RE = /(\d)\s+Outs?\b/;
const GLOG_PITCHING_RE = new RegExp(`(${GLOG_NAME})\\s+pitching`, "g");
const GLOG_SUB_PITCHER_RE = new RegExp(`(${GLOG_NAME})\\s+in for pitcher`, "g");

// Finds the last-mentioned pitcher name in a block's text — covers both the
// common ", X pitching" trailer on narrative lines and "X in for pitcher Y"
// substitution lines (which don't restate "pitching" themselves).
// Strips a trailing end-of-sentence period a name match can accidentally
// swallow (e.g. "...error by third baseman J Ramirez." -> "J Ramirez."),
// without touching a legitimate "Jr." suffix.
function glogCleanName(name) {
  if (!name) return name;
  return /\sJr\.$/.test(name) ? name : name.replace(/\.$/, "");
}

function glogFindActivePitcher(fullText) {
  let last = null, lastIdx = -1;
  let m;
  GLOG_PITCHING_RE.lastIndex = 0;
  while ((m = GLOG_PITCHING_RE.exec(fullText))) { if (m.index > lastIdx) { last = m[1]; lastIdx = m.index; } }
  GLOG_SUB_PITCHER_RE.lastIndex = 0;
  while ((m = GLOG_SUB_PITCHER_RE.exec(fullText))) { if (m.index > lastIdx) { last = m[1]; lastIdx = m.index; } }
  return last;
}

function parseGameLogText(text) {
  const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Group lines into play blocks, split on header lines and inning headers.
  // Also track which side (home/visitor) is at bat: "Bottom Nth - Team" means
  // the home team is batting; "Top Nth - Team" means the visiting team is batting.
  // This is standard scorekeeping convention baked into the log itself.
  //
  // Some exports (this one included) list innings newest-first — Bottom 7th at
  // the top of the file, Top 1st at the bottom — the reverse of real game time.
  // That's fine for the batting stats (each block is self-contained), but it
  // breaks anything that depends on scan ORDER: which pitcher is currently in,
  // and the running out-count within a half-inning. So: track the first and
  // last inning numbers seen, and if the file runs high-to-low, reverse the
  // block order before the stateful (pitcher/outs) pass below.
  const blocks = [];
  let cur = null;
  let currentSide = null;
  let detectedHome = null;
  let detectedVisitor = null;
  let firstInningNum = null, lastInningNum = null;

  let currentInningNum = null;

  rawLines.forEach(line => {
    const inningMatch = line.match(GLOG_INNING_HEADER_RE);
    if (GLOG_HEADERS.has(line)) {
      if (cur) blocks.push(cur);
      cur = { header: line, lines: [], side: currentSide, inningKey: `${currentSide}-${currentInningNum}` };
    } else if (inningMatch) {
      if (cur) blocks.push(cur);
      cur = null;
      const [, half, inningNumStr, teamName] = inningMatch;
      currentInningNum = parseInt(inningNumStr, 10);
      if (firstInningNum === null) firstInningNum = currentInningNum;
      lastInningNum = currentInningNum;
      if (half === "Bottom") { currentSide = "home"; detectedHome = teamName.trim(); }
      else { currentSide = "visitor"; detectedVisitor = teamName.trim(); }
    } else if (cur) {
      cur.lines.push(line);
    }
  });
  if (cur) blocks.push(cur);

  // If the file lists innings newest-first (e.g. Bottom 7th before Top 1st),
  // reverse to true chronological order before any stateful processing.
  if (firstInningNum !== null && lastInningNum !== null && firstInningNum > lastInningNum) {
    blocks.reverse();
  }

  const events = [];
  const steals = [];
  const scores = [];
  const errors = [];
  const outsLog = []; // [{ pitcher, side (fielding side), outs }] — for innings-pitched math
  const wildPitches = []; // [{ pitcher, side (fielding side) }]
  const fieldingErrors = []; // [{ fielder, position, side (fielding side) }]
  const fieldingPutouts = []; // [{ fielder, position, side (fielding side) }] — unassisted only (fly/pop/line outs)
  const pickedOff = []; // [{ runner, side (batting side) }]

  // Current pitcher for each side, persists across blocks until re-mentioned.
  const currentPitcher = { home: null, visitor: null };
  let runningOuts = 0;
  let prevInningKey = null;

  blocks.forEach(block => {
    if (block.inningKey !== prevInningKey) { runningOuts = 0; prevInningKey = block.inningKey; }
    const outsBeforePlay = runningOuts; // snapshot BEFORE this block's own outs (if any) are applied
    // Joined with " | " rather than a plain space so cross-line word fusion can't
    // happen — e.g. a block's "1 Out" line immediately followed by another line
    // starting with a capitalized name (like a pitcher) would otherwise let the
    // NAME regex's word-chaining swallow "Out" into the name it captures. This is
    // the same class of bug fixed earlier for glogBuildPitchSequence.
    const fullText = block.lines.join(" | ");
    const fieldingSide = block.side === "home" ? "visitor" : block.side === "visitor" ? "home" : null;

    const mentionedPitcher = glogFindActivePitcher(fullText);
    if (mentionedPitcher && fieldingSide) currentPitcher[fieldingSide] = mentionedPitcher;
    const activePitcher = fieldingSide ? currentPitcher[fieldingSide] : null;

    const outsLine = block.lines.find(l => GLOG_OUTS_LINE_RE.test(l));
    if (outsLine) {
      const n = parseInt(outsLine.match(GLOG_OUTS_LINE_RE)[1], 10);
      const increment = Math.max(0, n - runningOuts);
      runningOuts = n;
      // Record the out even if we don't yet know the pitcher's name (fieldingSide is
      // enough — aggregatePitchingStats falls back to a per-team placeholder bucket).
      // Requiring activePitcher here used to silently drop outs entirely whenever a
      // log never explicitly named a pitcher, zeroing out IP for that team.
      if (increment > 0 && fieldingSide) outsLog.push({ pitcher: activePitcher, side: fieldingSide, outs: increment });
    }

    let m;
    // Count-tagged steal attempts, walked from the same token sequence used to build
    // pitch counts — safe to run over the whole block here (steal mentions never
    // appear inside the narrative line itself, only within pitch-sequence lines).
    const stealAttemptsWithCount = glogBuildPitchSequence(block.lines).stealAttempts;
    const sbCounts = stealAttemptsWithCount.filter(s => s.type === "SB").map(s => s.count);
    const csCounts = stealAttemptsWithCount.filter(s => s.type === "CS").map(s => s.count);
    let sbIdx = 0, csIdx = 0;

    GLOG_STEAL_RE.lastIndex = 0;
    while ((m = GLOG_STEAL_RE.exec(fullText))) steals.push({ runner: m[1], type: "SB", base: m[2], side: block.side, pitcher: activePitcher, pitcherSide: fieldingSide, count: sbCounts[sbIdx++] });
    GLOG_CS_RE.lastIndex = 0;
    while ((m = GLOG_CS_RE.exec(fullText))) steals.push({ runner: m[1], type: "CS", base: m[2], side: block.side, pitcher: activePitcher, pitcherSide: fieldingSide, count: csCounts[csIdx++] });
    // Earned/unearned: if this block mentions a fielding error at all, treat any runs
    // that scored in it as unearned. This is a block-level heuristic, not official
    // scoring — a real official scorer traces a run back through the whole inning's
    // defensive sequence (would this run have scored anyway without the error?),
    // which this text doesn't reliably support. Still meaningfully better than
    // treating every run as earned regardless of context.
    GLOG_ERROR_RE.lastIndex = 0;
    const hasErrorInBlock = GLOG_ERROR_RE.test(fullText);
    GLOG_ERROR_RE.lastIndex = 0;

    GLOG_SCORES_RE.lastIndex = 0;
    while ((m = GLOG_SCORES_RE.exec(fullText))) scores.push({ name: m[1], side: block.side, pitcher: activePitcher, pitcherSide: fieldingSide, earned: !hasErrorInBlock });

    // RBI credit: runs that scored within this same play, EXCLUDING wild pitch / passed ball —
    // those aren't credited as RBIs to the batter under standard scoring rules. This is a
    // block-level heuristic (if the block mentions a wild pitch/passed ball anywhere, none of
    // that block's scores count as RBIs) rather than trying to match each specific runner to
    // the exact play that advanced them, which the text doesn't reliably support.
    const blockScoreCount = (fullText.match(GLOG_SCORES_RE) || []).length;
    const hasWildPitchOrPassedBall = /wild pitch|passed ball/i.test(fullText);
    // Home runs always score the batter — some log styles state this explicitly ("X scores"),
    // others treat it as self-evident from "homers" and never say it. Guarantee at least 1 RBI
    // on a HR regardless, while still adding any additional runners' explicit "scores" mentions.
    const rbiCountForBlock = hasWildPitchOrPassedBall ? 0
      : block.header === "Home Run" ? Math.max(blockScoreCount, 1)
      : blockScoreCount;

    GLOG_ERROR_RE.lastIndex = 0;
    while ((m = GLOG_ERROR_RE.exec(fullText))) fieldingErrors.push({ position: m[1], fielder: glogCleanName(m[2]), side: fieldingSide });

    GLOG_PICKED_OFF_RE.lastIndex = 0;
    while ((m = GLOG_PICKED_OFF_RE.exec(fullText))) pickedOff.push({ runner: glogCleanName(m[1]), side: block.side });

    if (/wild pitch/i.test(fullText) && fieldingSide) {
      wildPitches.push({ pitcher: activePitcher, side: fieldingSide });
    }

    if (block.header === "Runner Out") return; // baserunning out only, no batter PA

    const mapping = glogHeaderToCode(block.header);
    if (!mapping) return;

    let narrative = null;
    let narrativeIdx = -1;
    for (let i = block.lines.length - 1; i >= 0; i--) {
      if (GLOG_NARRATIVE_START_RE.test(block.lines[i])) { narrative = block.lines[i]; narrativeIdx = i; break; }
    }
    if (!narrative) { narrative = block.lines[block.lines.length - 1]; narrativeIdx = block.lines.length - 1; }
    if (!narrative) { errors.push(`Couldn't find a batter for a "${block.header}" play.`); return; }

    const batterMatch = narrative.match(new RegExp(`^(${GLOG_NAME})\\s`));
    const batter = batterMatch ? batterMatch[1] : null;
    if (!batter) { errors.push(`Couldn't read batter name from: "${narrative}"`); return; }

    if (GLOG_UNASSISTED_PUTOUT_HEADERS.has(block.header)) {
      const putoutMatch = narrative.match(GLOG_PUTOUT_FIELDER_RE);
      if (putoutMatch) {
        fieldingPutouts.push({ position: putoutMatch[1], fielder: glogCleanName(putoutMatch[2]), side: fieldingSide });
      }
    }

    const pitchLines = block.lines.filter((_, idx) => idx !== narrativeIdx);
    const pitches = glogBuildPitchSequence(pitchLines).pitches;

    const lowerNarrative = narrative.toLowerCase();
    events.push({
      batter,
      code: mapping.code,
      isBip: mapping.isBip,
      isHit: GLOG_HIT_CODES.has(mapping.code),
      isXbh: GLOG_XBH_CODES.has(mapping.code),
      isGIDP: !!mapping.isGIDP,
      rbi: rbiCountForBlock,
      outsBeforePlay, // 0/1/2 — how many outs there were in the half-inning when this PA started
      isBunt: lowerNarrative.includes("bunt"),
      location: mapping.isBip ? glogFindPosition(lowerNarrative) : null,
      side: block.side, // 'home' | 'visitor' | null — batter's side
      pitcher: activePitcher, // pitcher facing this batter (fielding side's pitcher)
      pitcherSide: fieldingSide,
      pitches, // [{ countBefore: "1-2", swing: true/false, type: ... }, ...]
      raw: narrative,
    });
  });

  return { events, steals, scores, errors, outsLog, wildPitches, fieldingErrors, fieldingPutouts, pickedOff, detectedHome, detectedVisitor };
}

// Stamps a resolved team NAME (not just home/visitor) onto every event/steal/score,
// using the given names for whichever side each item belongs to.
function applyTeamNames(parsed, homeTeamName, visitorTeamName) {
  const nameFor = side => side === "home" ? homeTeamName : side === "visitor" ? visitorTeamName : "Unknown";
  parsed.events.forEach(e => { e.team = nameFor(e.side); e.pitcherTeam = e.pitcherSide ? nameFor(e.pitcherSide) : null; });
  parsed.steals.forEach(s => { s.team = nameFor(s.side); s.pitcherTeam = s.pitcherSide ? nameFor(s.pitcherSide) : null; });
  parsed.scores.forEach(s => { s.team = nameFor(s.side); s.pitcherTeam = s.pitcherSide ? nameFor(s.pitcherSide) : null; });
  (parsed.outsLog || []).forEach(o => { o.team = nameFor(o.side); });
  (parsed.wildPitches || []).forEach(w => { w.team = nameFor(w.side); });
  (parsed.fieldingErrors || []).forEach(fe => { fe.team = nameFor(fe.side); });
  (parsed.fieldingPutouts || []).forEach(fp => { fp.team = nameFor(fp.side); });
  (parsed.pickedOff || []).forEach(p => { p.team = nameFor(p.side); });
  return parsed;
}

// Counts, per player name, how many distinct imported games they appeared in
// (had at least one plate appearance, steal, or run scored) — optionally scoped
// to one team's players only.
function computeGamesPlayed(gameLogs, teamFilter) {
  const gp = {};
  (gameLogs || []).forEach(g => {
    const namesInGame = new Set();
    (g.events || []).forEach(e => { if (!teamFilter || e.team === teamFilter) namesInGame.add(e.batter); });
    (g.steals || []).forEach(s => { if (!teamFilter || s.team === teamFilter) namesInGame.add(s.runner); });
    (g.scores || []).forEach(s => { if (!teamFilter || s.team === teamFilter) namesInGame.add(s.name); });
    namesInGame.forEach(name => { gp[name] = (gp[name] || 0) + 1; });
  });
  return gp;
}

// Aggregate parsed events/steals into per-player box score totals, keyed by player name.
function aggregateGameLogStats(events, steals, scores, fieldingErrors, pickedOff, fieldingPutouts) {
  const totals = {};
  const get = name => {
    if (!totals[name]) {
      totals[name] = {
        number: "-", name, team: null, PA: 0, AB: 0, BIP: 0, H: 0, "1B": 0, "2B": 0, "3B": 0, HR: 0,
        BB: 0, HBP: 0, K: 0, KL: 0, SB: 0, CS: 0, PIK: 0, BUNT: 0, XBH: 0, RunsScored: 0, RBI: 0,
        SAC: 0, SF: 0, ROE: 0, FC: 0, GIDP: 0, E: 0, PO: 0,
        twoOutPA: 0, twoOutAB: 0, twoOutH: 0, twoOutBB: 0, twoOutHBP: 0, twoOutRBI: 0, // 2-out situational
        gbLocations: {}, fbLocations: {}, lineDrives: 0, xbhLocations: [],
        pitchCounts: {}, // { "1-2": { swings: 3, total: 5 }, ... }
        countXBH: {}, // { "1-1": { bip: 5, xbh: 2 }, ... } — keyed by the count contact was made at
        totalSwings: 0, contactSwings: 0, // swings, and swings that were put in play (not fouled/whiffed)
        qab: 0, // "quality at-bat" count — see isQualityAtBat below
        pitchesSeen: 0, sixPlusPitchPAs: 0, battledPAs: 0, // 3+ pitches after reaching a 2-strike count
      };
    }
    return totals[name];
  };

  events.forEach(e => {
    const t = get(e.batter);
    if (e.team) t.team = e.team;
    t.PA++;
    const pitchList = e.pitches || [];
    t.pitchesSeen += pitchList.length;
    if (pitchList.length >= 6) t.sixPlusPitchPAs++;
    let sawTwoStrikes = false, pitchesAfterTwoStrikes = 0;
    if (!t.swingThenTakeOpp) { t.swingThenTakeOpp = 0; t.swingThenTakeCount = 0; t.swingThenTakeBalls = 0; t.swingThenTakeStrikes = 0; }
    pitchList.forEach((p, idx) => {
      if (!t.pitchCounts[p.countBefore]) t.pitchCounts[p.countBefore] = { swings: 0, total: 0, strikesLooking: 0 };
      t.pitchCounts[p.countBefore].total++;
      if (p.swing) t.pitchCounts[p.countBefore].swings++;
      if (p.type === "strike_looking") t.pitchCounts[p.countBefore].strikesLooking++;
      if (p.swing) {
        t.totalSwings++;
        if (p.type === "in_play") t.contactSwings++;
        // Swing-then-take: this swing was NOT the last pitch of the at-bat (i.e. it
        // was a foul or a continuing swinging strike), so there's a real "next pitch"
        // to check whether they took it.
        if (idx < pitchList.length - 1) {
          t.swingThenTakeOpp++;
          const nextPitch = pitchList[idx + 1];
          if (!nextPitch.swing) {
            t.swingThenTakeCount++;
            if (nextPitch.type === "strike_looking") t.swingThenTakeStrikes++;
            else t.swingThenTakeBalls++;
          }
        }
      }
      const strikesInCount = parseInt(p.countBefore.split("-")[1], 10);
      if (sawTwoStrikes) pitchesAfterTwoStrikes++;
      if (strikesInCount >= 2) sawTwoStrikes = true;
    });
    if (sawTwoStrikes && pitchesAfterTwoStrikes >= 3) t.battledPAs++;
    if (isQualityAtBat(e, pitchesAfterTwoStrikes, sawTwoStrikes)) t.qab++;
    t.RBI += (e.rbi || 0);
    const isTwoOut = e.outsBeforePlay === 2;
    if (isTwoOut) { t.twoOutPA++; t.twoOutRBI += (e.rbi || 0); }
    if (e.code === "BB") { t.BB++; if (isTwoOut) t.twoOutBB++; }
    else if (e.code === "HBP") { t.HBP++; if (isTwoOut) t.twoOutHBP++; }
    else {
      t.AB++;
      if (isTwoOut) t.twoOutAB++;
      if (e.code === "SAC") t.SAC++;
      if (e.code === "SF") t.SF++;
      if (e.code === "E") t.ROE++;
      if (e.code === "FC") t.FC++;
      if (e.isGIDP) t.GIDP++;
      if (e.isBip) {
        t.BIP++;
        if (e.isHit) { t.H++; t[e.code]++; if (isTwoOut) t.twoOutH++; }
        if (e.isXbh) { t.XBH++; if (e.location) t.xbhLocations.push(e.location); }
        if (e.isBunt) t.BUNT++;
        if (e.code === "GB" && e.location) t.gbLocations[e.location] = (t.gbLocations[e.location] || 0) + 1;
        if (["FB", "PU"].includes(e.code) && e.location) t.fbLocations[e.location] = (t.fbLocations[e.location] || 0) + 1;
        if (e.code === "LO") t.lineDrives++;
        // The count contact was made at is the count BEFORE the final (in-play) pitch.
        if (pitchList.length) {
          const contactCount = pitchList[pitchList.length - 1].countBefore;
          if (!t.countXBH[contactCount]) t.countXBH[contactCount] = { bip: 0, xbh: 0 };
          t.countXBH[contactCount].bip++;
          if (e.isXbh) t.countXBH[contactCount].xbh++;
        }
      }
      if (e.code === "K") {
        t.K++;
        const lastPitch = pitchList[pitchList.length - 1];
        if (lastPitch && lastPitch.type === "strike_looking") t.KL++;
      }
    }
  });

  steals.forEach(s => {
    const t = get(s.runner);
    if (s.team) t.team = s.team;
    if (s.type === "SB") t.SB++; else t.CS++;
  });

  (pickedOff || []).forEach(p => {
    const t = get(p.runner);
    if (p.team) t.team = p.team;
    t.PIK++;
  });

  (fieldingErrors || []).forEach(fe => {
    const t = get(fe.fielder);
    if (fe.team) t.team = fe.team;
    t.E++;
  });

  (fieldingPutouts || []).forEach(fp => {
    const t = get(fp.fielder);
    if (fp.team) t.team = fp.team;
    t.PO++;
  });

  scores.forEach(s => {
    const t = get(s.name);
    if (s.team) t.team = s.team;
    t.RunsScored++;
  });

  return totals;
}

// A "quality at-bat" — a widely-used but not universally standardized youth/HS
// stat. Here: any PA that produced a hit, a walk/HBP, a sac bunt/fly, or a
// battle of 6+ pitches counts as quality (the coach "won" that at-bat even on
// an out). This is a reasonable common definition, not the one exact formula
// every program uses — adjust glogHeaderToCode-adjacent logic here if yours differs.
function isQualityAtBat(e, pitchesAfterTwoStrikes, sawTwoStrikes) {
  if (e.isXbh) return true;
  if (e.code === "BB" || e.code === "HBP") return true;
  if (e.code === "SAC" || e.code === "SF") return true;
  if ((e.pitches || []).length >= 6) return true;
  if (sawTwoStrikes && pitchesAfterTwoStrikes >= 3) return true;
  return false;
}

// Aggregate pitching stats per pitcher name from events (K/BB/H allowed),
// scores (runs allowed), and outsLog (innings pitched). Runs are split into
// R (all runs) and ER (earned runs) using a block-level heuristic: a run is
// unearned if a fielding error was mentioned anywhere in the same play block
// it scored in. This isn't official scoring (which traces a run through the
// whole inning's defensive sequence), but it's a real improvement over
// treating every run as earned regardless of context.
function aggregatePitchingStats(events, scores, outsLog, wildPitches, steals) {
  const totals = {};
  const get = name => {
    if (!totals[name]) {
      totals[name] = {
        name, team: null, outs: 0, battersFaced: 0, K: 0, KL: 0, BB: 0, HBP: 0, H: 0, R: 0, ER: 0, HR: 0,
        pitchesThrown: 0, strikesThrown: 0, swingingStrikes: 0, firstPitchStrikes: 0, firstPitchTotal: 0, WP: 0,
        fpsOuts: 0, fpsWalks: 0, fpsHits: 0, // outcomes of PAs that started with a first-pitch strike
        pitchesPer3OrFewer: 0, // batters retired/walked/hit on 3 pitches or fewer
        gbAllowed: 0, fbAllowed: 0, ldAllowed: 0,
        SB: 0, CS: 0, // stolen bases / caught stealing allowed
      };
    }
    return totals[name];
  };

  // If a pitcher's name was never mentioned anywhere in the log (some export
  // styles state the pitcher once at the top of an inning rather than on
  // every play, or use different phrasing our regex doesn't catch), fall back
  // to a per-team placeholder bucket rather than silently dropping the data —
  // that at least shows the team's aggregate pitching output instead of
  // nothing, and the placeholder name makes the gap visible rather than hidden.
  const fallbackName = team => team ? `${team} (unidentified pitcher)` : null;

  events.forEach(e => {
    const name = e.pitcher || fallbackName(e.pitcherTeam);
    if (!name) return;
    const t = get(name);
    if (e.pitcherTeam) t.team = e.pitcherTeam;
    t.battersFaced++;
    const pitchList = e.pitches || [];
    if (e.code === "K") {
      t.K++;
      const lastPitch = pitchList[pitchList.length - 1];
      if (lastPitch && lastPitch.type === "strike_looking") t.KL++;
    }
    if (e.code === "BB") t.BB++;
    if (e.code === "HBP") t.HBP++;
    if (e.isHit) t.H++;
    if (e.code === "HR") t.HR++;
    if (e.isBip) {
      if (e.code === "GB") t.gbAllowed++;
      if (["FB", "PU"].includes(e.code)) t.fbAllowed++;
      if (e.code === "LO") t.ldAllowed++;
    }
    if (pitchList.length <= 3) t.pitchesPer3OrFewer++;
    const firstPitchWasStrike = pitchList[0] && pitchList[0].type !== "ball";
    if (firstPitchWasStrike) {
      if (e.code === "BB") t.fpsWalks++;
      else if (e.isHit) t.fpsHits++;
      else t.fpsOuts++;
    }
    pitchList.forEach((p, idx) => {
      t.pitchesThrown++;
      if (p.type !== "ball") t.strikesThrown++;
      if (p.type === "strike_swinging") t.swingingStrikes++;
      if (idx === 0) { t.firstPitchTotal++; if (p.type !== "ball") t.firstPitchStrikes++; }
    });
  });

  (steals || []).forEach(s => {
    const name = s.pitcher || fallbackName(s.pitcherTeam);
    if (!name) return;
    const t = get(name);
    if (s.pitcherTeam) t.team = s.pitcherTeam;
    if (s.type === "SB") t.SB++; else t.CS++;
  });

  scores.forEach(s => {
    const name = s.pitcher || fallbackName(s.pitcherTeam);
    if (!name) return;
    const t = get(name);
    if (s.pitcherTeam) t.team = s.pitcherTeam;
    t.R++;
    if (s.earned !== false) t.ER++;
  });

  (outsLog || []).forEach(o => {
    const name = o.pitcher || fallbackName(o.team);
    if (!name) return;
    const t = get(name);
    if (o.team) t.team = o.team;
    t.outs += o.outs;
  });

  (wildPitches || []).forEach(w => {
    const name = w.pitcher || fallbackName(w.team);
    if (!name) return;
    const t = get(name);
    if (w.team) t.team = w.team;
    t.WP++;
  });

  return totals;
}

// Builds the per-game, per-pitcher data needed for a pitching staff report:
// who started vs relieved each game, games since last appearance, and an
// opponent-by-opponent breakdown of each outing. Requires a specific team
// (myTeam) — a staff report is inherently single-team.
function computeStaffReport(gameLogs, myTeam) {
  const relevantGames = (gameLogs || []).filter(g => g.homeTeamName === myTeam || g.visitorTeamName === myTeam);

  const perPitcherGames = {}; // name -> [{ gameIndex, opponent, role, stats }]
  const gsCounts = {}, reliefCounts = {}, lastAppearanceIndex = {};

  relevantGames.forEach((g, idx) => {
    const opponent = myTeam === g.homeTeamName ? g.visitorTeamName : g.homeTeamName;
    const firstEventForTeam = (g.events || []).find(e => e.pitcherTeam === myTeam && e.pitcher);
    const starterName = firstEventForTeam ? firstEventForTeam.pitcher : null;

    const gamePitching = aggregatePitchingStats(
      (g.events || []).filter(e => e.pitcherTeam === myTeam),
      (g.scores || []).filter(s => s.pitcherTeam === myTeam),
      (g.outsLog || []).filter(o => o.team === myTeam),
      (g.wildPitches || []).filter(w => w.team === myTeam),
      (g.steals || []).filter(s => s.pitcherTeam === myTeam)
    );

    Object.values(gamePitching).forEach(p => {
      if (!perPitcherGames[p.name]) perPitcherGames[p.name] = [];
      const isStarter = p.name === starterName;
      if (isStarter) gsCounts[p.name] = (gsCounts[p.name] || 0) + 1;
      else reliefCounts[p.name] = (reliefCounts[p.name] || 0) + 1;
      lastAppearanceIndex[p.name] = idx;
      perPitcherGames[p.name].push({ gameIndex: idx, opponent, role: isStarter ? "SP" : "RP", stats: p });
    });
  });

  const sincePitched = {};
  Object.keys(lastAppearanceIndex).forEach(name => {
    sincePitched[name] = (relevantGames.length - 1) - lastAppearanceIndex[name];
  });

  return { perPitcherGames, gsCounts, reliefCounts, sincePitched, totalGames: relevantGames.length };
}
