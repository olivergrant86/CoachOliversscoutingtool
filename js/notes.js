/* notes.js — your own notes on individual players.
 *
 * Two places use this:
 *   - Game Day: a Notes button next to the hitter's name opens a sheet. What you type is a
 *     DRAFT that saves on the device as you go (so it works with no signal). "Save" turns the
 *     draft into a permanent, dated note on that player.
 *   - The Notes tab on the Import Game Log page: every saved note, by player, where you can
 *     also add, edit, and delete.
 *
 * Saved notes live on the opponent record (opp.playerNotes) in the cloud data:
 *     { "Team Name|C Davis": [ { id, text, at, source, editedAt? }, ... ] }
 * They are keyed by team + player name, so a "J Smith" on one team never mixes with a
 * "J Smith" on another. Each note is its own dated entry; nothing is ever merged or overwritten,
 * which is what makes saving them safe.
 *
 * This file is plain data logic + HTML strings. app.js does the saving. Every global here
 * starts with pn/PN_ so it can't collide with the other script files.
 */

const PN_MAX_LEN = 4000;

function pnEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function pnKey(team, player) {
  return `${String(team || "").trim()}|${String(player || "").trim()}`;
}

function pnNewId() {
  return "pn_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function pnFormatDate(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "Undated";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/* ===================== saved notes ===================== */

// One player's saved notes, newest first.
function pnEntriesFor(playerNotes, team, player) {
  const list = (playerNotes && playerNotes[pnKey(team, player)]) || [];
  return list.slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// Everyone on a team who has saved notes: [{ player, entries }], alphabetical.
function pnAllForTeam(playerNotes, team) {
  const prefix = pnKey(team, "");
  const groups = [];
  Object.keys(playerNotes || {}).forEach(key => {
    if (!key.startsWith(prefix)) return;
    const player = key.slice(prefix.length);
    const entries = pnEntriesFor(playerNotes, team, player);
    if (entries.length) groups.push({ player, entries });
  });
  return groups.sort((a, b) => a.player.localeCompare(b.player));
}

function pnCountForTeam(playerNotes, team) {
  return pnAllForTeam(playerNotes, team).reduce((n, g) => n + g.entries.length, 0);
}

// Adds a new dated note. Returns the entry, or null if there was nothing to save.
function pnAdd(playerNotes, team, player, text, nowIso, source) {
  const clean = String(text || "").trim().slice(0, PN_MAX_LEN);
  const who = String(player || "").trim();
  if (!clean || !who) return null;
  const key = pnKey(team, who);
  const entry = { id: pnNewId(), text: clean, at: nowIso || new Date().toISOString(), source: source || "notes" };
  if (!Array.isArray(playerNotes[key])) playerNotes[key] = [];
  playerNotes[key].push(entry);
  return entry;
}

function pnUpdate(playerNotes, id, text, nowIso) {
  const clean = String(text || "").trim().slice(0, PN_MAX_LEN);
  if (!clean) return false;
  for (const key of Object.keys(playerNotes || {})) {
    const hit = (playerNotes[key] || []).find(e => e.id === id);
    if (hit) { hit.text = clean; hit.editedAt = nowIso || new Date().toISOString(); return true; }
  }
  return false;
}

function pnDelete(playerNotes, id) {
  for (const key of Object.keys(playerNotes || {})) {
    const list = playerNotes[key] || [];
    const i = list.findIndex(e => e.id === id);
    if (i !== -1) {
      list.splice(i, 1);
      if (!list.length) delete playerNotes[key];
      return true;
    }
  }
  return false;
}

/* ===================== drafts (unsaved, on this device) ===================== */

function pnSanitizeDrafts(raw) {
  const out = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    Object.keys(raw).forEach(k => { if (typeof raw[k] === "string" && raw[k].trim()) out[k] = raw[k].slice(0, PN_MAX_LEN); });
  }
  return out;
}

// A blank draft is removed rather than stored, so "unsaved notes" counts only real text.
function pnSetDraft(drafts, player, text) {
  const who = String(player || "").trim();
  if (!who) return;
  if (String(text || "").trim()) drafts[who] = String(text).slice(0, PN_MAX_LEN);
  else delete drafts[who];
}

function pnDraftPlayers(drafts) {
  return Object.keys(drafts || {}).filter(k => String(drafts[k]).trim()).sort((a, b) => a.localeCompare(b));
}

/* ===================== rendering ===================== */

function pnRenderEntryText(text) {
  return `<div class="pn-text">${pnEsc(text)}</div>`;
}

// The sheet that slides over Game Day. o = { team, player, draft, saved, othersCount, status, busy }
// (othersCount = how many OTHER hitters have an unsaved note.)
function pnRenderSheet(o) {
  const history = o.saved.length
    ? `<div class="gd-sheet-label">EARLIER NOTES ON HIM (${o.saved.length})</div>` +
      o.saved.map(e => `
        <div class="gd-sheet-note">
          <div class="gd-sheet-date">${pnEsc(pnFormatDate(e.at))}</div>
          ${pnRenderEntryText(e.text)}
        </div>`).join("")
    : `<p class="hint" style="margin:10px 0 0;">No saved notes on ${pnEsc(o.player)} yet.</p>`;

  const status = o.status || `Your draft saves on this device as you type. Tap Save to add it to ${o.player}'s permanent notes.`;
  // Shown whenever ANOTHER hitter also has an unsaved note. (It can't be based on a count that includes
  // the box being typed in — typing deliberately doesn't redraw the sheet, so that count would go stale.)
  const saveAll = o.othersCount > 0
    ? `<button class="gd-btn" data-gd="notes-save-all"${o.busy ? " disabled" : ""}>Save all unsaved notes</button>`
    : "";

  return `
    <div class="gd-sheet-backdrop" data-gd="notes-close"></div>
    <div class="gd-sheet" role="dialog" aria-modal="true" aria-label="Notes for ${pnEsc(o.player)}">
      <div class="gd-sheet-head">
        <div>
          <div class="gd-batting" style="color:#5c6b78;">NOTES</div>
          <div class="gd-sheet-name">${pnEsc(o.player)}</div>
        </div>
        <button class="gd-btn" data-gd="notes-close">Done</button>
      </div>
      <textarea id="pnDraftBox" class="gd-sheet-box" data-pn-draft="${pnEsc(o.player)}" rows="6"
        maxlength="${PN_MAX_LEN}" placeholder="Anything you want to remember about him…">${pnEsc(o.draft)}</textarea>
      <div class="gd-sheet-actions">
        <div class="gd-sheet-status">${pnEsc(status)}</div>
        <div class="gd-sheet-btns">
          <button class="gd-btn primary" data-gd="notes-save-one"${o.busy ? " disabled" : ""}>Save to ${pnEsc(o.player)}'s notes</button>
          ${saveAll}
        </div>
      </div>
      ${history}
    </div>`;
}

// The Notes tab. o = { team, playerNotes, drafts, roster: [names], editingId, msg, busy }
function pnRenderPage(o) {
  const groups = pnAllForTeam(o.playerNotes, o.team);
  const total = groups.reduce((n, g) => n + g.entries.length, 0);
  const unsaved = pnDraftPlayers(o.drafts);

  const names = Array.from(new Set([...(o.roster || []), ...groups.map(g => g.player)])).sort((a, b) => a.localeCompare(b));
  const addForm = `
    <div class="pn-card">
      <div class="pn-card-head">Add a note</div>
      <div class="pn-card-body">
        <div class="pn-addrow">
          <select id="pnAddPlayer">
            <option value="">— choose a player —</option>
            ${names.map(n => `<option value="${pnEsc(n)}">${pnEsc(n)}</option>`).join("")}
          </select>
        </div>
        <textarea id="pnAddText" rows="3" maxlength="${PN_MAX_LEN}" placeholder="Write a note…"></textarea>
        <div class="pn-actions"><button class="btn" data-pn="add"${o.busy ? " disabled" : ""}>Add note</button></div>
      </div>
    </div>`;

  const unsavedBox = unsaved.length
    ? `<div class="pn-unsaved">
         <div><strong>${unsaved.length} unsaved note${unsaved.length === 1 ? "" : "s"} on this device</strong> (${unsaved.map(pnEsc).join(", ")}) — written in Game Day but not added to the players yet.</div>
         <button class="btn" data-pn="save-drafts"${o.busy ? " disabled" : ""}>Save them to the players</button>
       </div>`
    : "";

  const cards = groups.length
    ? groups.map(g => `
        <div class="pn-card">
          <div class="pn-card-head"><span>${pnEsc(g.player)}</span><span class="pn-count">${g.entries.length} note${g.entries.length === 1 ? "" : "s"}</span></div>
          <div class="pn-card-body">
            ${g.entries.map(e => {
              const meta = `${pnEsc(pnFormatDate(e.at))}${e.source === "gameday" ? " · from Game Day" : ""}${e.editedAt ? " · edited" : ""}`;
              if (o.editingId === e.id) {
                return `
                  <div class="pn-entry">
                    <div class="pn-meta">${meta}</div>
                    <textarea id="pnEditText" rows="4" maxlength="${PN_MAX_LEN}">${pnEsc(e.text)}</textarea>
                    <div class="pn-actions">
                      <button class="btn" data-pn="save-edit" data-id="${pnEsc(e.id)}"${o.busy ? " disabled" : ""}>Save</button>
                      <button class="btn" data-pn="cancel-edit">Cancel</button>
                    </div>
                  </div>`;
              }
              return `
                <div class="pn-entry">
                  <div class="pn-meta">${meta}</div>
                  ${pnRenderEntryText(e.text)}
                  <div class="pn-actions">
                    <button class="btn small" data-pn="edit" data-id="${pnEsc(e.id)}"${o.busy ? " disabled" : ""}>Edit</button>
                    <button class="btn small" data-pn="delete" data-id="${pnEsc(e.id)}"${o.busy ? " disabled" : ""}>Delete</button>
                  </div>
                </div>`;
            }).join("")}
          </div>
        </div>`).join("")
    : `<p class="hint">No saved notes on ${pnEsc(o.team)} players yet. Write them during a game from the Game Day tab, or add one below.</p>`;

  return `
    <div>
      <h2 style="margin:0 0 4px;">${pnEsc(o.team)} — Notes</h2>
      <p class="hint" style="margin:0 0 12px;">${total} saved note${total === 1 ? "" : "s"} on ${groups.length} player${groups.length === 1 ? "" : "s"}. Notes you write in Game Day show up here once you save them.</p>
      ${o.msg ? `<div class="pn-msg">${pnEsc(o.msg)}</div>` : ""}
      ${unsavedBox}
      ${cards}
      ${addForm}
    </div>`;
}
