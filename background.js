// background.js — clock owner, alarm manager, state tracker
// Uses chrome.alarms (survives service worker suspension + browser restart)

const ALARM_NAME     = "productivity-tick";
const STORAGE_KEY    = "productivity_logs";
const SETTINGS_KEY   = "productivity_settings";

const DEFAULT_SETTINGS = {
  interval_minutes:        30,
  work_start:              "09:00",
  work_end:                "18:00",
  lunch_start:             "12:30",
  lunch_end:               "13:30",
  break_threshold_windows: 2
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseHHMM(str) {
  const [h, m] = str.split(":").map(Number);
  return h * 60 + m;
}

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function dayName() {
  return new Date().toLocaleDateString("en-GB", { weekday: "long" });
}

function currentSlot() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function inRange(nowMins, startStr, endStr) {
  return nowMins >= parseHHMM(startStr) && nowMins <= parseHHMM(endStr);
}

// ── Settings ─────────────────────────────────────────────────────────────────

async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(SETTINGS_KEY, data => {
      resolve({ ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) });
    });
  });
}

// ── Log helpers ───────────────────────────────────────────────────────────────

async function getLogs() {
  return new Promise(resolve => {
    chrome.storage.local.get(STORAGE_KEY, data => {
      resolve(data[STORAGE_KEY] || []);
    });
  });
}

async function saveLogs(logs) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [STORAGE_KEY]: logs }, resolve);
  });
}

async function appendLog(entry) {
  const logs = await getLogs();
  logs.push(entry);
  await saveLogs(logs);
}

async function retroMarkBreak(n) {
  const logs = await getLogs();
  if (logs.length < n) return;

  const tail = logs.slice(-n);
  if (tail.every(r => r.entry_type === "missed")) {
    tail.forEach(r => r.entry_type = "break");
    logs.splice(-n, n, ...tail);
    await saveLogs(logs);
  }
}

// ── Alarm registration ────────────────────────────────────────────────────────

async function registerAlarm() {
  const settings = await getSettings();
  await chrome.alarms.clearAll();
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: settings.interval_minutes,
    periodInMinutes: settings.interval_minutes
  });
}

// ── Alarm handler ─────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== ALARM_NAME) return;

  const settings = await getSettings();
  const now      = nowMinutes();
  const slot     = currentSlot();
  const date     = todayStr();
  const day      = dayName();

  const isWorkHours = inRange(now, settings.work_start, settings.work_end);
  const isLunch     = inRange(now, settings.lunch_start, settings.lunch_end);
  const isOvertime  = !isWorkHours; // anything before work_start or after work_end

  // Lunch — silent log, no popup
  if (isLunch) {
    await appendLog({ date, time_slot: slot, day, category: "", note: "", entry_type: "lunch" });
    return;
  }

  // Store pending slot so popup can read it (work hours + overtime both get a popup)
  await chrome.storage.local.set({ pending_slot: { date, time_slot: slot, day, is_overtime: isOvertime } });

  // Fire notification — label differs for overtime
  chrome.notifications.create("prod-tick", {
    type:     "basic",
    iconUrl:  "icons/icon48.png",
    title:    isOvertime ? "Productivity Tracker — Overtime" : "Productivity Tracker",
    message:  isOvertime ? `⚠ ${slot} — logging overtime window` : `Log your ${slot} window`,
    priority: 2,
    requireInteraction: false
  });

  // Auto-log as missed after 3 minutes if popup not submitted
  setTimeout(async () => {
    const pending = await new Promise(r =>
      chrome.storage.local.get("pending_slot", d => r(d.pending_slot))
    );

    // Still pending = user didn't submit
    if (pending && pending.time_slot === slot) {
      await chrome.storage.local.remove("pending_slot");
      const missedType = pending.is_overtime ? "overtime" : "missed";
      await appendLog({ date, time_slot: slot, day, category: "", note: "", entry_type: missedType });

      // Break inference only applies within work hours (not overtime)
      if (!pending.is_overtime) {
        const settings2 = await getSettings();
        const logs      = await getLogs();
        const recent    = logs.slice(-settings2.break_threshold_windows);

        if (
          recent.length === settings2.break_threshold_windows &&
          recent.every(r => r.entry_type === "missed")
        ) {
          await retroMarkBreak(settings2.break_threshold_windows);
        }
      }
    }
  }, 3 * 60 * 1000); // 3 min window to respond
});

// ── Notification click → open popup ──────────────────────────────────────────

chrome.notifications.onClicked.addListener(id => {
  if (id === "prod-tick") {
    chrome.action.openPopup().catch(() => {
      // openPopup() only works if user gesture is in scope
      // fallback: badge the icon so user knows to click
      chrome.action.setBadgeText({ text: "!" });
      chrome.action.setBadgeBackgroundColor({ color: "#89b4fa" });
    });
  }
});

// ── On install / startup: register alarm ─────────────────────────────────────

chrome.runtime.onInstalled.addListener(registerAlarm);
chrome.runtime.onStartup.addListener(registerAlarm);

// ── Message from popup: submitted ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "LOG_ENTRY") {
    (async () => {
      const pending = await new Promise(r =>
        chrome.storage.local.get("pending_slot", d => r(d.pending_slot))
      );

      const slot = pending || {
        date:      todayStr(),
        time_slot: currentSlot(),
        day:       dayName()
      };

      await appendLog({
        ...slot,
        category:   msg.category,
        note:       msg.note,
        entry_type: pending?.is_overtime ? "overtime" : "logged"
      });

      await chrome.storage.local.remove("pending_slot");
      chrome.action.setBadgeText({ text: "" });
      sendResponse({ ok: true });
    })();
    return true; // async response
  }

  if (msg.type === "SETTINGS_SAVED") {
    registerAlarm();
    sendResponse({ ok: true });
    return true;
  }
});
