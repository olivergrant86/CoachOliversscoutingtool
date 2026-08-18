/* supabase-client.js
 *
 * Fill in the two values below from your Supabase project:
 * Project Settings (gear icon) -> API -> Project URL / Project API keys -> anon public
 *
 * The anon/public key is meant to be visible in client-side code like this —
 * it's not a secret. Row Level Security (set up via SUPABASE_SETUP.md) is
 * what actually protects each user's data, not hiding this key.
 */

const SUPABASE_URL = "https://nyhbbdweiqnnpptzpnyr.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55aGJiZHdlaXFubnBwdHpwbnlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3NDc2MjIsImV4cCI6MjEwMjMyMzYyMn0.nlHhRbeuu5a9fMVUWTh9HY1KIw8DaeQ32FEeGkjO_5I";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
