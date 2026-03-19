// popup.js — UI logic only. No alarm code here.

const STORAGE_KEY  = "productivity_logs";
const SETTINGS_KEY = "productivity_settings";

const DEFAULT_SETTINGS = {
  interval_minutes:        30,
  work_start:              "09:00",
  work_end:                "18:00",
  lunch_start:             "12:30",
  lunch_end:               "13:30",
  break_threshold_windows: 2
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function currentSlot() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function getLogs() {
  return new Promise(r =>
    chrome.storage.local.get(STORAGE_KEY, d => r(d[STORAGE_KEY] || []))
  );
}

function getSettings() {
  return new Promise(r =>
    chrome.storage.local.get(SETTINGS_KEY, d =>
      r({ ...DEFAULT_SETTINGS, ...(d[SETTINGS_KEY] || {}) })
    )
  );
}

function getPendingSlot() {
  return new Promise(r =>
    chrome.storage.local.get("pending_slot", d => r(d.pending_slot || null))
  );
}

function showToast(el, msg, type = "success") {
  el.textContent  = msg;
  el.className    = `toast ${type}`;
  setTimeout(() => { el.className = "toast"; el.textContent = ""; }, 2500);
}

// ── Tab switching ─────────────────────────────────────────────────────────────

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");

    if (tab.dataset.tab === "history")  renderHistory();
    if (tab.dataset.tab === "settings") loadSettings();
  });
});

// ── Live clock ────────────────────────────────────────────────────────────────

function startClock(isOvertime) {
  const clockEl  = document.getElementById("live-clock");
  const dateEl   = document.getElementById("clock-date");
  const statusEl = document.getElementById("clock-status");

  if (isOvertime) clockEl.classList.add("overtime");

  function tick() {
    const now  = new Date();
    const hh   = String(now.getHours()).padStart(2, "0");
    const mm   = String(now.getMinutes()).padStart(2, "0");
    const ss   = String(now.getSeconds()).padStart(2, "0");
    clockEl.textContent = `${hh}:${mm}:${ss}`;

    dateEl.textContent = now.toLocaleDateString("en-GB", {
      weekday: "short", day: "numeric", month: "short"
    });

    statusEl.textContent = isOvertime ? "⚠ Overtime" : "Work hours";
    statusEl.style.color = isOvertime ? "var(--red)" : "var(--green)";
  }

  tick();
  setInterval(tick, 1000);
}

// ── Log panel ─────────────────────────────────────────────────────────────────

async function initLogPanel() {
  const pending    = await getPendingSlot();
  const isOvertime = pending?.is_overtime || false;
  startClock(isOvertime);
  document.getElementById("note").focus();
}

document.getElementById("btn-submit").addEventListener("click", async () => {
  const category = document.getElementById("category").value.trim();
  const note     = document.getElementById("note").value.trim();
  const toast    = document.getElementById("log-toast");

  if (!category) {
    showToast(toast, "Pick a category.", "error");
    return;
  }

  chrome.runtime.sendMessage({ type: "LOG_ENTRY", category, note }, res => {
    if (res?.ok) {
      document.getElementById("note").value = "";
      showToast(toast, "Logged ✓");
    } else {
      showToast(toast, "Something went wrong.", "error");
    }
  });
});

document.getElementById("btn-skip").addEventListener("click", () => {
  window.close();
});

document.getElementById("note").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("btn-submit").click();
});

// ── History panel ─────────────────────────────────────────────────────────────

async function renderHistory() {
  const logs    = await getLogs();
  const today   = todayStr();
  const todayLogs = logs
    .filter(r => r.date === today)
    .sort((a, b) => a.time_slot.localeCompare(b.time_slot));

  const list = document.getElementById("log-list");

  if (!todayLogs.length) {
    list.innerHTML = `<div class="empty-state">No entries yet today.</div>`;
    return;
  }

  list.innerHTML = todayLogs.map(r => `
    <div class="log-row">
      <span class="log-slot">${r.time_slot}</span>
      <span class="log-cat">${r.category || "—"}</span>
      <span class="badge badge-${r.entry_type}">${r.entry_type}</span>
      ${r.note ? `<span class="log-note">${r.note}</span>` : ""}
    </div>
  `).join("");
}

// ── Export CSV ────────────────────────────────────────────────────────────────

document.getElementById("btn-export").addEventListener("click", async () => {
  const logs = await getLogs();
  if (!logs.length) return;

  const headers = ["date", "time_slot", "day", "category", "note", "entry_type"];
  const rows    = logs.map(r =>
    headers.map(h => `"${(r[h] || "").replace(/"/g, '""')}"`).join(",")
  );

  const csv     = [headers.join(","), ...rows].join("\n");
  const blob    = new Blob([csv], { type: "text/csv" });
  const url     = URL.createObjectURL(blob);
  const today   = todayStr();

  chrome.downloads.download({
    url,
    filename: `productivity_log_${today}.csv`,
    saveAs:   false
  });
});

// ── Settings panel ────────────────────────────────────────────────────────────

async function loadSettings() {
  const s = await getSettings();
  document.getElementById("s-interval").value    = s.interval_minutes;
  document.getElementById("s-work-start").value  = s.work_start;
  document.getElementById("s-work-end").value    = s.work_end;
  document.getElementById("s-lunch-start").value = s.lunch_start;
  document.getElementById("s-lunch-end").value   = s.lunch_end;
}

document.getElementById("btn-save-settings").addEventListener("click", async () => {
  const settings = {
    interval_minutes:        parseInt(document.getElementById("s-interval").value),
    work_start:              document.getElementById("s-work-start").value.trim(),
    work_end:                document.getElementById("s-work-end").value.trim(),
    lunch_start:             document.getElementById("s-lunch-start").value.trim(),
    lunch_end:               document.getElementById("s-lunch-end").value.trim(),
    break_threshold_windows: 2
  };

  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  chrome.runtime.sendMessage({ type: "SETTINGS_SAVED" });

  const toast = document.getElementById("settings-toast");
  toast.textContent = "Saved ✓";
  setTimeout(() => { toast.textContent = ""; }, 2000);
});

document.getElementById("btn-clear").addEventListener("click", async () => {
  const confirmed = confirm("Clear ALL logged data? This cannot be undone.");
  if (!confirmed) return;
  await chrome.storage.local.remove(STORAGE_KEY);
  renderHistory();
});

// ── Init ──────────────────────────────────────────────────────────────────────

initLogPanel();
