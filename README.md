# Productivity Tracker — Chrome / Edge Extension

No Python. No install. Drop a folder, load the extension. Done.

---

## Load in Chrome or Edge (takes 30 seconds)

1. Open `chrome://extensions` or `edge://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `productivity-tracker-ext` folder
5. Pin the extension — click the puzzle icon → pin

That's it. The tracker is running.

---

## How it works

| What happens | Result |
|---|---|
| Every 15 or 30 min (your choice) | Browser notification fires |
| Click notification or the extension icon | Popup opens |
| Submit a category + optional note | Logged as `logged` |
| Close popup without submitting | Auto-logged as `missed` after 3 min |
| 2 consecutive missed windows | Both retroactively marked `break` |
| 12:30–13:30 | Silent `lunch` entry, no popup |
| Outside 09:00–18:00 | Nothing fires |

---

## Export CSV

1. Click the extension icon
2. Go to **History** tab
3. Click **Export CSV ↓**

File downloads to your default Downloads folder.  
Filename: `productivity_log_YYYY-MM-DD.csv`

---

## CSV columns

| Column | Description |
|---|---|
| `date` | YYYY-MM-DD |
| `time_slot` | HH:MM of the window |
| `day` | Monday–Friday |
| `category` | What you selected |
| `note` | Free text note |
| `entry_type` | `logged` / `missed` / `break` / `lunch` |

---

## Settings

Click extension icon → **Settings** tab

- Interval: 15 or 30 minutes
- Work start / end
- Lunch start / end

Settings take effect immediately. Alarm re-registers automatically.

---

## Sharing with your team

Just zip the `productivity-tracker-ext` folder and share it.  
Anyone can load it via **Load unpacked** — no store, no approval needed.

For Edge rollout via Group Policy (managed devices), ask your IT admin to
push the folder via `ExtensionInstallForcelist`. No user action needed.

---

## Data storage

All data lives in `chrome.storage.local` — local to the browser profile,
never leaves the machine. To clear: Settings → **Clear all data**.
