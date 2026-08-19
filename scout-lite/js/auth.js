/* auth.js — email/password authentication via Supabase.
 *
 * Shows #authGate until someone is signed in. Once signed in, checks their
 * `profiles.approved` flag: if not approved yet, shows #pendingApproval
 * instead of the app. Approval itself happens outside this app entirely —
 * a coach flips `approved` to true for that user's row in Supabase's Table
 * Editor. This is enforced server-side too (see the RLS policies in
 * SUPABASE_SETUP.md), not just here in the UI — an unapproved user's
 * requests to read/write scouting_data are rejected by Postgres itself,
 * regardless of what this client-side code does.
 */

function showScreen(id) {
  ["authGate", "resetPasswordGate", "pendingApproval", "appRoot"].forEach(s => {
    document.getElementById(s).style.display = s === id ? "" : "none";
  });
}

function authMsg(text, isError = false) {
  const el = document.getElementById("authMsg");
  el.textContent = text;
  el.style.color = isError ? "#b3352c" : "#2e8b57";
}

function resetMsg(text, isError = false) {
  const el = document.getElementById("resetMsg");
  el.textContent = text;
  el.style.color = isError ? "#b3352c" : "#2e8b57";
}

async function handleAuthenticated() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) { showScreen("authGate"); return; }

  const { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("approved")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.warn("Couldn't check approval status.", error);
    // Fail closed: if we can't confirm approval, don't show the app.
    document.getElementById("pendingEmailLabel").textContent = user.email;
    showScreen("pendingApproval");
    return;
  }

  if (!profile || !profile.approved) {
    document.getElementById("pendingEmailLabel").textContent = user.email;
    showScreen("pendingApproval");
    return;
  }

  showScreen("appRoot");
  const label = document.getElementById("currentUserLabel");
  if (label) label.textContent = user.email;
  await initAppState(); // defined in app.js
}

async function initAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    await handleAuthenticated();
  } else {
    showScreen("authGate");
  }

  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      showScreen("resetPasswordGate");
    } else if (event === "SIGNED_IN" && session) {
      await handleAuthenticated();
    } else if (event === "SIGNED_OUT") {
      showScreen("authGate");
    }
  });
}

document.getElementById("btnAuthSignUp").addEventListener("click", async () => {
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  if (!email || !password) { authMsg("Enter an email and password.", true); return; }
  if (password.length < 6) { authMsg("Password needs to be at least 6 characters.", true); return; }

  authMsg("Creating your account…");
  const { error } = await supabaseClient.auth.signUp({ email, password });
  if (error) { authMsg(error.message, true); return; }
  authMsg("Account created! Check your email to confirm it (if required), then log in below. A coach will need to approve your account before you can use the app.");
});

document.getElementById("btnAuthSignIn").addEventListener("click", async () => {
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  if (!email || !password) { authMsg("Enter an email and password.", true); return; }

  authMsg("Signing in…");
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) { authMsg(error.message, true); return; }
  // onAuthStateChange picks up from here.
});

document.getElementById("btnAuthSignOut").addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
});

document.getElementById("btnPendingSignOut").addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
});

document.getElementById("linkForgotPassword").addEventListener("click", async (e) => {
  e.preventDefault();
  const email = document.getElementById("authEmail").value.trim();
  if (!email) { authMsg("Type your email in the box above first, then click \"Forgot password?\" again.", true); return; }

  authMsg("Sending a reset link…");
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });
  if (error) { authMsg(error.message, true); return; }
  authMsg("Check your email for a password reset link. Clicking it will bring you back here to set a new password.");
});

document.getElementById("btnSetNewPassword").addEventListener("click", async () => {
  const newPassword = document.getElementById("newPassword").value;
  if (!newPassword || newPassword.length < 6) { resetMsg("Password needs to be at least 6 characters.", true); return; }

  resetMsg("Updating your password…");
  const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
  if (error) { resetMsg(error.message, true); return; }

  resetMsg("Password updated! Signing you in…");
  document.getElementById("newPassword").value = "";
  await handleAuthenticated(); // the recovery flow already leaves them signed in
});

initAuth();
