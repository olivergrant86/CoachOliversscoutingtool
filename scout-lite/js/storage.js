/* storage.js — Supabase-backed data layer.
 *
 * Each signed-in user's entire app state (all opponents, games, everything)
 * is stored as one JSON blob in a single row of the `scouting_data` table,
 * keyed by their user id. Row Level Security (set up via the SQL script in
 * SUPABASE_SETUP.md) means each user can only ever read or write their own
 * row — Supabase enforces that server-side, not just in this code.
 *
 * loadState() and saveState() are both async now (network calls), unlike the
 * old localStorage version. See app.js's initAppState() for how loading is
 * sequenced after sign-in.
 */

const SCOUTING_TABLE = "scouting_data";

async function loadState() {
  const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
  if (userError || !user) return { opponents: {}, currentOpponentId: null };

  const { data, error } = await supabaseClient
    .from(SCOUTING_TABLE)
    .select("state")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.warn("Couldn't load your data from the server.", error);
    return { opponents: {}, currentOpponentId: null };
  }
  if (!data || !data.state) return { opponents: {}, currentOpponentId: null };

  // Defensive: old data might predate a field being added.
  const loaded = data.state;
  if (!loaded.opponents) loaded.opponents = {};
  if (loaded.currentOpponentId === undefined) loaded.currentOpponentId = null;
  return loaded;
}

async function saveState(state) {
  const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
  if (userError || !user) throw new Error("Not signed in.");

  const { error } = await supabaseClient
    .from(SCOUTING_TABLE)
    .upsert({ user_id: user.id, state, updated_at: new Date().toISOString() }, { onConflict: "user_id" });

  if (error) throw error;
}

function newOpponent(name) {
  return {
    id: "opp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    roster: [],       // { number, name, bats } — legacy field, unused by current UI
    games: [],        // legacy field, unused by current UI
    gameLogs: [],      // { id, processedAt, events, steals, scores, outsLog, wildPitches, homeTeamName, visitorTeamName }
  };
}
