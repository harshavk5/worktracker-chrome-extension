// background.js — clock owner, alarm manager, state tracker
// Uses chrome.alarms throughout (survives service worker suspension + browser restart)
// setTimeout is NOT used — unreliable in MV3 service workers

const ALARM_NAME   = "productivity-tick";
const ALARM_MISSED = "productivity-missed"; // fires 3 min after tick to auto-log missed
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

// ── Settings ──────────────────────────────────────────────────────────────────

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

// ── Notification permission ───────────────────────────────────────────────────
// chrome.notifications requires runtime permission check — silent failure if skipped

async function ensureNotificationPermission() {
  return new Promise(resolve => {
    // chrome.notifications.getPermissionLevel is the correct check
    chrome.notifications.getPermissionLevel(level => {
      resolve(level === "granted");
    });
  });
}

// ── Alarm registration ────────────────────────────────────────────────────────

async function registerAlarm() {
  const settings = await getSettings();
  await chrome.alarms.clearAll();
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes:  settings.interval_minutes,
    periodInMinutes: settings.interval_minutes
  });
}

// ── Notify + badge ────────────────────────────────────────────────────────────

async function fireNotification(slot, isOvertime) {
  const allowed = await ensureNotificationPermission();

  // Always badge — works even if notifications are blocked
  chrome.action.setBadgeText({ text: "LOG" });
  chrome.action.setBadgeBackgroundColor({ color: isOvertime ? "#f38ba8" : "#89b4fa" });

  if (!allowed) return; // badge is the fallback

  chrome.notifications.create("prod-tick", {
    type:              "basic",
    iconUrl:           "icons/icon48.png",
    title:             isOvertime ? "⚠ Overtime Window" : "Productivity Tracker",
    message:           `Log your ${slot} window — click to open`,
    priority:          2,
    requireInteraction: true   // stays until dismissed — better than auto-dismiss
  });
}

// ── Main alarm handler ────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async alarm => {

  // ── Missed-window check (fires 3 min after tick alarm) ──────────────────────
  if (alarm.name === ALARM_MISSED) {
    const pending = await new Promise(r =>
      chrome.storage.local.get("pending_slot", d => r(d.pending_slot))
    );

    if (!pending) return; // already submitted — nothing to do

    await chrome.storage.local.remove("pending_slot");

    const missedType = pending.is_overtime ? "overtime" : "missed";
    await appendLog({
      date:       pending.date,
      time_slot:  pending.time_slot,
      day:        pending.day,
      category:   "",
      note:       "",
      entry_type: missedType
    });

    chrome.action.setBadgeText({ text: "" });
    chrome.notifications.clear("prod-tick");

    // Break inference — work hours only
    if (!pending.is_overtime) {
      const settings = await getSettings();
      const logs     = await getLogs();
      const recent   = logs.slice(-settings.break_threshold_windows);
      if (
        recent.length === settings.break_threshold_windows &&
        recent.every(r => r.entry_type === "missed")
      ) {
        await retroMarkBreak(settings.break_threshold_windows);
      }
    }
    return;
  }

  // ── Main tick alarm ───────────────────────────────────────────────────────
  if (alarm.name !== ALARM_NAME) return;

  const settings   = await getSettings();
  const now        = nowMinutes();
  const slot       = currentSlot();
  const date       = todayStr();
  const day        = dayName();
  const isWorkHours = inRange(now, settings.work_start, settings.work_end);
  const isLunch     = inRange(now, settings.lunch_start, settings.lunch_end);
  const isOvertime  = !isWorkHours;

  // Lunch — silent log, no prompt
  if (isLunch) {
    await appendLog({ date, time_slot: slot, day, category: "", note: "", entry_type: "lunch" });
    return;
  }

  // Store pending slot
  await chrome.storage.local.set({
    pending_slot: { date, time_slot: slot, day, is_overtime: isOvertime }
  });

  // Fire notification + badge
  await fireNotification(slot, isOvertime);

  // Schedule missed-window check via alarm (NOT setTimeout — survives SW death)
  chrome.alarms.create(ALARM_MISSED, { delayInMinutes: 3 });
});

// ── Notification click → open logger tab ──────────────────────────────────────
// chrome.action.openPopup() is blocked without a user gesture from the SW context.
// Opening a tab is the only reliable fallback.

chrome.notifications.onClicked.addListener(id => {
  if (id === "prod-tick") {
    chrome.notifications.clear("prod-tick");
    chrome.tabs.create({ url: chrome.runtime.getURL("logger.html"), active: true });
  }
});

// ── On install / startup ──────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(registerAlarm);
chrome.runtime.onStartup.addListener(registerAlarm);

// ── Messages from popup / logger ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "LOG_ENTRY") {
    (async () => {
      const pending = await new Promise(r =>
        chrome.storage.local.get("pending_slot", d => r(d.pending_slot))
      );

      const slot = pending || { date: todayStr(), time_slot: currentSlot(), day: dayName() };

      await appendLog({
        ...slot,
        category:   msg.category,
        note:       msg.note,
        entry_type: pending?.is_overtime ? "overtime" : "logged"
      });

      await chrome.storage.local.remove("pending_slot");
      await chrome.alarms.clear(ALARM_MISSED); // cancel missed-check — already logged
      chrome.action.setBadgeText({ text: "" });
      chrome.notifications.clear("prod-tick");
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === "SETTINGS_SAVED") {
    registerAlarm();
    sendResponse({ ok: true });
    return true;
  }
});
