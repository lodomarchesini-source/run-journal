(function () {
  const STORAGE_RUNS = "runjournal_runs";
  const STORAGE_MIGRATION_PREFIX = "runjournal_migrated_";

  // Set these in DevTools (window.RUNJOURNAL_SUPABASE_URL / _ANON_KEY) or edit here.
  const SUPABASE_URL = window.RUNJOURNAL_SUPABASE_URL || "";
  const SUPABASE_ANON_KEY = window.RUNJOURNAL_SUPABASE_ANON_KEY || "";

  const TIME_OF_DAY_LABELS = {
    morning: "Morning run",
    day: "Day run",
    evening: "Evening run",
  };

  /** Hoisted helper — avoids “Cannot access before initialization” if `tod` order drifts. */
  function timeOfDayKey(run) {
    if (!run) return "day";
    const t = run.timeOfDay;
    return t === "morning" || t === "day" || t === "evening" ? t : "day";
  }

  function runCardBgFile(whenKey) {
    return whenKey === "morning" || whenKey === "evening" ? whenKey : "day";
  }

  const els = {
    runForm: document.getElementById("run-form"),
    runDate: document.getElementById("run-date"),
    runDistance: document.getElementById("run-distance"),
    runUnit: document.getElementById("run-unit"),
    runDuration: document.getElementById("run-duration"),
    runNotes: document.getElementById("run-notes"),
    runCancel: document.getElementById("run-cancel"),
    runDelete: document.getElementById("run-delete"),
    runsList: document.getElementById("runs-list"),
    newRunEntry: document.getElementById("new-run-entry"),
    carouselViewport: document.querySelector(".runs-carousel-viewport"),
    totalRuns: document.getElementById("total-runs"),
    runsTimeBreakdown: document.getElementById("runs-time-breakdown"),
    totalElapsed: document.getElementById("total-elapsed"),
    totalDistance: document.getElementById("total-distance"),
    modal: document.getElementById("run-modal"),
    modalTitle: document.getElementById("run-modal-title"),
    modalBackdrop: document.getElementById("modal-backdrop"),
    pageTitle: document.getElementById("page-title"),
    editPageTitle: document.getElementById("edit-page-title"),
    authStatus: document.getElementById("account-email"),
    authSignout: document.getElementById("auth-signout"),
  };

  let editingRunId = null;
  let focusBeforeModal = null;
  let supabaseClient = null;
  let currentUser = null;
  let currentRuns = [];

  function uid() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : String(Date.now()) + Math.random().toString(36).slice(2);
  }

  function setAuthStatus(message, kind) {
    if (!els.authStatus) return;
    els.authStatus.textContent = message;
    els.authStatus.hidden = !message;
    els.authStatus.classList.remove("is-error", "is-ok", "is-muted");
    if (kind === "error") els.authStatus.classList.add("is-error");
    else if (kind === "ok") els.authStatus.classList.add("is-ok");
    else els.authStatus.classList.add("is-muted");
  }

  function setAuthControlsSignedIn(user) {
    if (!els.authSignout) return;
    els.authSignout.hidden = false;
    setAuthStatus("", "muted");
  }

  function setAuthControlsSignedOut() {
    if (!els.authSignout) return;
    els.authSignout.hidden = true;
    setAuthStatus("", "muted");
  }

  function getPageTitleForUser(user) {
    const fromMeta =
      user &&
      user.user_metadata &&
      typeof user.user_metadata.page_title === "string"
        ? user.user_metadata.page_title.trim()
        : "";
    return fromMeta || "Run-Journal";
  }

  function setPageTitle(titleText) {
    const text = String(titleText || "").trim() || "Run-Journal";
    if (els.pageTitle) {
      els.pageTitle.textContent = text;
    }
    document.title = text;
  }

  async function editPageTitle() {
    if (!supabaseClient || !currentUser) return;
    const current = els.pageTitle ? els.pageTitle.textContent : "Run-Journal";
    const next = window.prompt("Set page title", current || "Run-Journal");
    if (next == null) return;
    const cleaned = String(next).trim() || "Run-Journal";
    const { data, error } = await supabaseClient.auth.updateUser({
      data: { page_title: cleaned },
    });
    if (error) {
      setAuthStatus(`Title update failed: ${error.message}`, "error");
      return;
    }
    const user = data && data.user ? data.user : currentUser;
    setPageTitle(getPageTitleForUser(user));
  }

  function hasSupabaseConfig() {
    return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
  }

  function initSupabase() {
    if (!hasSupabaseConfig()) {
      setAuthStatus(
        "Add Supabase URL/anon key in app.js (or window.RUNJOURNAL_SUPABASE_*)",
        "error"
      );
      return null;
    }
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      setAuthStatus("Supabase SDK failed to load", "error");
      return null;
    }
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  function loadLocalRuns() {
    try {
      const raw = localStorage.getItem(STORAGE_RUNS);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  const MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  function ordinalSuffix(dayNum) {
    const d = Number(dayNum);
    const j = d % 10;
    const k = d % 100;
    if (j === 1 && k !== 11) return `${d}st`;
    if (j === 2 && k !== 12) return `${d}nd`;
    if (j === 3 && k !== 13) return `${d}rd`;
    return `${d}th`;
  }

  function formatRunDate(isoDate) {
    if (!isoDate) return "";
    const parts = String(isoDate).trim().split("-");
    if (parts.length !== 3) return isoDate;
    const [yStr, mStr, dayStr] = parts;
    const y = Number(yStr);
    const m = Number(mStr);
    const day = Number(dayStr);
    const monthName = MONTH_NAMES[(m || 1) - 1];
    if (!monthName || !Number.isFinite(y)) return isoDate;
    return `${monthName} ${ordinalSuffix(day)}, ${y}`;
  }

  function pacePerKm(distanceKm, durationMin) {
    if (!distanceKm || distanceKm <= 0 || durationMin == null || durationMin <= 0)
      return null;
    const minPerKm = durationMin / distanceKm;
    const whole = Math.floor(minPerKm);
    const sec = Math.round((minPerKm - whole) * 60);
    return `${whole}:${String(sec).padStart(2, "0")}`;
  }

  function toKm(distance, unit) {
    const n = Number(distance);
    if (!Number.isFinite(n) || n < 0) return 0;
    return unit === "mi" ? n * 1.609344 : n;
  }

  function minutesToHMS(totalMin) {
    if (totalMin == null || totalMin === "") return "";
    const m = Number(totalMin);
    if (!Number.isFinite(m) || m < 0) return "";
    const totalSec = Math.round(m * 60);
    const h = Math.floor(totalSec / 3600);
    const mi = Math.floor((totalSec % 3600) / 60);
    const sec = totalSec % 60;
    return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  function sumTotals(runs) {
    let minutes = 0;
    let km = 0;
    for (const r of runs) {
      const dm = r.durationMin != null ? Number(r.durationMin) : 0;
      if (Number.isFinite(dm) && dm > 0) minutes += dm;
      const d = r.distance != null ? Number(r.distance) : 0;
      const unit = r.unit === "mi" ? "mi" : "km";
      if (Number.isFinite(d) && d >= 0) km += toKm(d, unit);
    }
    return { minutes, km };
  }

  function formatTotalKm(totalKm) {
    if (!Number.isFinite(totalKm) || totalKm <= 0) return "—";
    if (totalKm >= 100) return `${Math.round(totalKm)} km`;
    if (totalKm >= 10) return `${totalKm.toFixed(1)} km`;
    return `${totalKm.toFixed(2)} km`;
  }

  function countRunsByTimeOfDay(runs) {
    let morning = 0;
    let day = 0;
    let evening = 0;
    for (const r of runs) {
      const t = r.timeOfDay;
      if (t === "morning") morning++;
      else if (t === "evening") evening++;
      else day++;
    }
    return { morning, day, evening };
  }

  function renderRunsTimeBreakdownTip(counts) {
    if (!els.runsTimeBreakdown) return;
    const { morning, day, evening } = counts;
    els.runsTimeBreakdown.innerHTML = `
      <div class="runs-time-tip-inner">
        <div class="runs-time-tip-heading">By time of day</div>
        <ul class="runs-time-tip-list">
          <li><span class="runs-time-tip-label">Morning</span><span class="runs-time-tip-num">${morning}</span></li>
          <li><span class="runs-time-tip-label">Day</span><span class="runs-time-tip-num">${day}</span></li>
          <li><span class="runs-time-tip-label">Evening</span><span class="runs-time-tip-num">${evening}</span></li>
        </ul>
      </div>
    `;
    els.runsTimeBreakdown.setAttribute("aria-hidden", "false");
  }

  function updateTotals(runs) {
    const n = runs.length;
    const byTime = countRunsByTimeOfDay(runs);
    if (els.totalRuns) {
      els.totalRuns.textContent = String(n);
      els.totalRuns.title =
        n > 0
          ? `${byTime.morning} morning · ${byTime.day} day · ${byTime.evening} evening`
          : "";
    }
    renderRunsTimeBreakdownTip(byTime);
    if (!els.totalElapsed || !els.totalDistance) return;
    if (!n) {
      els.totalElapsed.textContent = "—";
      els.totalDistance.textContent = "—";
      return;
    }
    const { minutes, km } = sumTotals(runs);
    els.totalElapsed.textContent =
      minutes > 0 ? formatDurationForCard(minutes) || "—" : "—";
    els.totalDistance.textContent = km > 0 ? formatTotalKm(km) : "—";
  }

  function formatDurationForCard(totalMin) {
    if (totalMin == null || totalMin === "") return null;
    const num = Number(totalMin);
    if (!Number.isFinite(num) || num <= 0) return null;
    let secTotal = Math.round(num * 60);
    const h = Math.floor(secTotal / 3600);
    secTotal %= 3600;
    const mi = Math.floor(secTotal / 60);
    const s = secTotal % 60;

    const parts = [];
    if (h > 0) parts.push(`${h}h`);
    if (mi > 0) parts.push(`${mi}m`);
    if (s > 0) parts.push(`${s}s`);
    if (parts.length > 0) return parts.join(" ");
    return null;
  }

  function parseHMSToMinutes(raw) {
    const str = String(raw).trim();
    if (!str) return null;
    const parts = str.split(":").map((p) => p.trim());
    const nums = parts.map((p) => (p === "" ? NaN : Number(p)));
    if (nums.some((n) => Number.isNaN(n) || n < 0)) return NaN;

    if (parts.length === 3) {
      const [hv, mv, sv] = nums;
      if (mv >= 60 || sv >= 60) return NaN;
      return (hv * 3600 + mv * 60 + sv) / 60;
    }
    if (parts.length === 2) {
      const [mv, sv] = nums;
      if (sv >= 60) return NaN;
      return (mv * 60 + sv) / 60;
    }
    if (parts.length === 1 && parts[0] !== "") return nums[0];
    return NaN;
  }

  function isModalOpen() {
    return els.modal.classList.contains("is-open");
  }

  function setDefaultRunDate() {
    const t = new Date();
    const z = (n) => String(n).padStart(2, "0");
    els.runDate.value = `${t.getFullYear()}-${z(t.getMonth() + 1)}-${z(t.getDate())}`;
  }

  function normalizeRun(raw) {
    return {
      id: raw.id,
      date: raw.date || "",
      distance: raw.distance != null ? Number(raw.distance) : 0,
      unit: raw.unit === "mi" ? "mi" : "km",
      durationMin:
        raw.durationMin != null && raw.durationMin !== ""
          ? Number(raw.durationMin)
          : null,
      notes: raw.notes || "",
      timeOfDay:
        raw.timeOfDay === "morning" ||
        raw.timeOfDay === "day" ||
        raw.timeOfDay === "evening"
          ? raw.timeOfDay
          : "day",
      createdAt: raw.createdAt || Date.now(),
      updatedAt: raw.updatedAt || null,
    };
  }

  function mapDbRowToRun(row) {
    return normalizeRun({
      id: row.id,
      date: row.date,
      distance: row.distance,
      unit: row.unit,
      durationMin: row.duration_min,
      notes: row.notes,
      timeOfDay: row.time_of_day,
      createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
      updatedAt: row.updated_at ? Date.parse(row.updated_at) : null,
    });
  }

  function mapRunToDbPayload(run, userId) {
    return {
      id: run.id,
      user_id: userId,
      date: run.date,
      distance: run.distance,
      unit: run.unit,
      duration_min: run.durationMin,
      notes: run.notes,
      time_of_day: run.timeOfDay,
      created_at: new Date(run.createdAt || Date.now()).toISOString(),
      updated_at: run.updatedAt ? new Date(run.updatedAt).toISOString() : null,
    };
  }

  async function loadRunsFromCloud(userId) {
    const { data, error } = await supabaseClient
      .from("runs")
      .select("*")
      .eq("user_id", userId)
      .order("date", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data || []).map(mapDbRowToRun);
  }

  async function createRunInCloud(run) {
    if (!currentUser) throw new Error("Not authenticated");
    const payload = mapRunToDbPayload(run, currentUser.id);
    payload.updated_at = new Date().toISOString();
    const { error } = await supabaseClient.from("runs").insert(payload);
    if (error) throw error;
  }

  async function updateRunInCloud(run) {
    if (!currentUser) throw new Error("Not authenticated");
    const payload = mapRunToDbPayload(run, currentUser.id);
    payload.updated_at = new Date().toISOString();
    const { error } = await supabaseClient
      .from("runs")
      .update(payload)
      .eq("id", run.id)
      .eq("user_id", currentUser.id);
    if (error) throw error;
  }

  async function deleteRunFromCloud(runId) {
    if (!currentUser) throw new Error("Not authenticated");
    const { error } = await supabaseClient
      .from("runs")
      .delete()
      .eq("id", runId)
      .eq("user_id", currentUser.id);
    if (error) throw error;
  }

  async function migrateLocalRunsIfNeeded(userId) {
    const markerKey = `${STORAGE_MIGRATION_PREFIX}${userId}`;
    if (localStorage.getItem(markerKey) === "1") return;
    const localRuns = loadLocalRuns();
    if (!localRuns.length) {
      localStorage.setItem(markerKey, "1");
      return;
    }
    const rows = localRuns.map((raw) => {
      const normalized = normalizeRun({
        id: raw.id || uid(),
        date: raw.date,
        distance: raw.distance,
        unit: raw.unit,
        durationMin: raw.durationMin,
        notes: raw.notes,
        timeOfDay: raw.timeOfDay,
        createdAt: raw.createdAt || Date.now(),
        updatedAt: raw.updatedAt || null,
      });
      return mapRunToDbPayload(normalized, userId);
    });

    const { error } = await supabaseClient.from("runs").upsert(rows, {
      onConflict: "id",
    });
    if (error) throw error;
    localStorage.setItem(markerKey, "1");
  }

  function openRunModal(run) {
    if (!currentUser) {
      setAuthStatus("Sign in to add or edit runs", "error");
      return;
    }
    focusBeforeModal = document.activeElement;
    editingRunId = run && run.id ? run.id : null;
    els.modalTitle.textContent = editingRunId ? "Edit run" : "New run";
    els.runDelete.hidden = !editingRunId;

    if (run && editingRunId) {
      els.runDate.value = run.date || "";
      els.runDistance.value = run.distance != null ? run.distance : "";
      els.runUnit.value = run.unit === "mi" ? "mi" : "km";
      els.runDuration.value =
        run.durationMin != null && Number(run.durationMin) > 0
          ? minutesToHMS(run.durationMin)
          : "";
      els.runNotes.value = run.notes || "";
      const whenKey = timeOfDayKey(run);
      const todInput = els.runForm.querySelector(
        `input[name="timeOfDay"][value="${whenKey}"]`
      );
      if (todInput) todInput.checked = true;
    } else {
      els.runForm.reset();
      setDefaultRunDate();
    }

    els.modal.classList.add("is-open");
    els.modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");

    requestAnimationFrame(() => {
      if (els.runNotes) els.runNotes.focus();
    });
  }

  function closeRunModal() {
    els.modal.classList.remove("is-open");
    els.modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    editingRunId = null;
    els.runForm.reset();
    setDefaultRunDate();
    els.runDelete.hidden = true;
    if (focusBeforeModal && typeof focusBeforeModal.focus === "function") {
      focusBeforeModal.focus();
    }
    focusBeforeModal = null;
  }

  function renderRuns() {
    const runs = [...currentRuns].sort((a, b) => {
      const da = a.date || "";
      const db = b.date || "";
      if (da !== db) return db.localeCompare(da);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    if (els.carouselViewport) {
      els.carouselViewport.hidden = false;
      els.carouselViewport.setAttribute("aria-hidden", "false");
    }

    els.runsList.innerHTML = "";

    for (const r of runs) {
      const li = document.createElement("li");
      const whenKey = timeOfDayKey(r);
      const bgFile = runCardBgFile(whenKey);
      li.className = `carousel-slide item run-card-tod--${whenKey}`;
      const dist = r.distance != null ? Number(r.distance) : 0;
      const unit = r.unit === "mi" ? "mi" : "km";
      const dur =
        r.durationMin != null && r.durationMin !== ""
          ? Number(r.durationMin)
          : null;
      const km = toKm(dist, unit);
      const pace = pacePerKm(km, dur);

      const statsHtml = `
        <div class="run-stats">
          <div class="run-stat">
            <span class="run-stat-label">KM</span>
            <span class="run-stat-value">${dist}</span>
          </div>
          <div class="run-stat">
            <span class="run-stat-label">Time</span>
            <span class="run-stat-value">${formatDurationForCard(dur) || "—"}</span>
          </div>
          <div class="run-stat">
            <span class="run-stat-label">PACE</span>
            <span class="run-stat-value">${pace || "—"}</span>
          </div>
        </div>
      `;

      li.setAttribute("role", "button");
      li.setAttribute("tabindex", "0");
      const todPhrase = TIME_OF_DAY_LABELS[whenKey]
        ? `, ${TIME_OF_DAY_LABELS[whenKey]}`
        : "";
      li.setAttribute(
        "aria-label",
        `Open run from ${formatRunDate(r.date)}${todPhrase}`
      );

      li.innerHTML = `
        <img class="run-card-bg" src="card-bg/${bgFile}.svg" alt="" width="360" height="640" decoding="async" />
        <div class="run-card-content">
          <div class="item-header">
            <h3 class="item-title"></h3>
          </div>
          <p class="item-body run-notes-body" hidden></p>
          ${statsHtml}
        </div>
      `;
      li.querySelector(".item-title").textContent = formatRunDate(r.date);

      const notesEl = li.querySelector(".run-notes-body");
      const notesText = (r.notes && String(r.notes).trim()) || "";
      if (notesText) {
        notesEl.hidden = false;
        notesEl.textContent = notesText;
      }

      function openCard(e) {
        if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") {
          return;
        }
        if (e.type === "keydown") {
          e.preventDefault();
        }
        openRunModal(r);
      }

      li.addEventListener("click", openCard);
      li.addEventListener("keydown", openCard);

      els.runsList.appendChild(li);
    }

    if (els.newRunEntry) {
      els.newRunEntry.hidden = !currentUser;
      els.newRunEntry.disabled = !currentUser;
    }

    updateTotals(runs);
  }

  async function refreshRuns() {
    if (!currentUser || !supabaseClient) {
      currentRuns = [];
      renderRuns();
      return;
    }
    try {
      currentRuns = await loadRunsFromCloud(currentUser.id);
      renderRuns();
    } catch (err) {
      setAuthStatus(`Failed to load runs: ${err.message || err}`, "error");
    }
  }

  async function applySession(session) {
    currentUser = session && session.user ? session.user : null;
    if (!currentUser) {
      setAuthControlsSignedOut();
      const next = encodeURIComponent("index.html");
      window.location.href = `auth.html?next=${next}`;
      return;
    }
    setPageTitle(getPageTitleForUser(currentUser));
    setAuthControlsSignedIn(currentUser);
    try {
      await migrateLocalRunsIfNeeded(currentUser.id);
    } catch (err) {
      setAuthStatus(`Migration failed: ${err.message || err}`, "error");
    }
    await refreshRuns();
  }

  async function handleSignOut() {
    if (!supabaseClient) return;
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
      setAuthStatus(`Sign out failed: ${error.message}`, "error");
      return;
    }
    window.location.href = "auth.html";
  }

  if (els.newRunEntry) {
    els.newRunEntry.addEventListener("click", () => {
      if (!currentUser) {
        setAuthStatus("Sign in to add runs", "error");
        return;
      }
      openRunModal(null);
    });
  }

  els.modalBackdrop.addEventListener("click", closeRunModal);
  els.runCancel.addEventListener("click", closeRunModal);

  els.runDelete.addEventListener("click", async () => {
    if (!editingRunId) return;
    if (!confirm("Delete this run? This cannot be undone.")) return;
    try {
      await deleteRunFromCloud(editingRunId);
      closeRunModal();
      await refreshRuns();
    } catch (err) {
      setAuthStatus(`Delete failed: ${err.message || err}`, "error");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isModalOpen()) {
      e.preventDefault();
      closeRunModal();
    }
  });

  els.runForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUser) {
      setAuthStatus("Sign in to save runs", "error");
      return;
    }
    const date = els.runDate.value;
    const distance = els.runDistance.value;
    const unit = els.runUnit.value;
    const durationRaw = els.runDuration.value.trim();
    const notes = els.runNotes.value.trim();
    const timeOfDaySelected = els.runForm.querySelector(
      'input[name="timeOfDay"]:checked'
    );
    const timeOfDay =
      timeOfDaySelected &&
      ["morning", "day", "evening"].includes(timeOfDaySelected.value)
        ? timeOfDaySelected.value
        : "day";

    if (!date || distance === "") return;

    let durationMinParsed = null;
    if (durationRaw !== "") {
      const parsed = parseHMSToMinutes(durationRaw);
      if (parsed === null) {
        durationMinParsed = null;
      } else if (Number.isNaN(parsed)) {
        alert(
          "Enter time as 00:00:00 (hours, minutes, seconds). Example: 01:05:30 or 45:30 for 45 min 30 sec."
        );
        return;
      } else {
        durationMinParsed = parsed;
      }
    }

    const now = Date.now();
    const payload = normalizeRun({
      id: editingRunId || uid(),
      date,
      distance: Number(distance),
      unit,
      durationMin: durationMinParsed,
      notes,
      timeOfDay,
      createdAt: editingRunId
        ? (currentRuns.find((r) => r.id === editingRunId)?.createdAt || now)
        : now,
      updatedAt: now,
    });

    try {
      if (editingRunId) await updateRunInCloud(payload);
      else await createRunInCloud(payload);
      closeRunModal();
      await refreshRuns();
    } catch (err) {
      setAuthStatus(`Save failed: ${err.message || err}`, "error");
    }
  });

  if (els.authSignout) {
    els.authSignout.addEventListener("click", () => {
      handleSignOut().catch((err) => {
        setAuthStatus(`Sign out error: ${err.message || err}`, "error");
      });
    });
  }

  if (els.editPageTitle) {
    els.editPageTitle.addEventListener("click", () => {
      editPageTitle().catch((err) => {
        setAuthStatus(`Title update error: ${err.message || err}`, "error");
      });
    });
  }

  setDefaultRunDate();
  setPageTitle("Run-Journal");
  renderRuns();

  supabaseClient = initSupabase();
  if (!supabaseClient) return;

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    applySession(session).catch((err) => {
      setAuthStatus(`Session error: ${err.message || err}`, "error");
    });
  });

  supabaseClient.auth
    .getSession()
    .then(({ data, error }) => {
      if (error) {
        setAuthStatus(`Session lookup failed: ${error.message}`, "error");
        return;
      }
      return applySession(data.session);
    })
    .catch((err) => {
      setAuthStatus(`Startup auth error: ${err.message || err}`, "error");
    });
})();
