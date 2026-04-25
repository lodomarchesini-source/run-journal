(function () {
  const SUPABASE_URL = window.RUNJOURNAL_SUPABASE_URL || "";
  const SUPABASE_ANON_KEY = window.RUNJOURNAL_SUPABASE_ANON_KEY || "";

  const els = {
    authRequestForm: document.getElementById("auth-request-form"),
    authEmail: document.getElementById("auth-email"),
    authStatus: document.getElementById("auth-status"),
  };

  function setAuthStatus(message, kind) {
    if (!els.authStatus) return;
    els.authStatus.textContent = message;
    els.authStatus.classList.remove("is-error", "is-ok", "is-muted");
    if (kind === "error") els.authStatus.classList.add("is-error");
    else if (kind === "ok") els.authStatus.classList.add("is-ok");
    else els.authStatus.classList.add("is-muted");
  }

  function nextPath() {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    if (!next) return "index.html";
    return next;
  }

  function redirectToJournal() {
    window.location.href = nextPath();
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    setAuthStatus("Missing Supabase URL or anon key", "error");
    return;
  }
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    setAuthStatus("Supabase SDK failed to load", "error");
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  async function sendLoginLink(e) {
    e.preventDefault();
    const email = String(els.authEmail.value || "").trim();
    if (!email) return;
    const { error } = await client.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}${window.location.pathname.replace(
          /auth\.html$/,
          "index.html"
        )}`,
      },
    });
    if (error) {
      setAuthStatus(`Could not send login link: ${error.message}`, "error");
      return;
    }
    setAuthStatus(`Login link sent to ${email}. Open it from your email.`, "ok");
  }

  els.authRequestForm.addEventListener("submit", (e) => {
    sendLoginLink(e).catch((err) => {
      setAuthStatus(`Auth error: ${err.message || err}`, "error");
    });
  });

  client.auth.onAuthStateChange((_event, session) => {
    if (session && session.user) {
      redirectToJournal();
    }
  });

  client.auth
    .getSession()
    .then(({ data, error }) => {
      if (error) {
        setAuthStatus(`Session lookup failed: ${error.message}`, "error");
        return;
      }
      if (data && data.session && data.session.user) {
        redirectToJournal();
      }
    })
    .catch((err) => {
      setAuthStatus(`Startup auth error: ${err.message || err}`, "error");
    });
})();
