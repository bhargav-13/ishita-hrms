# Face attendance → ERP: setup guide

## How it works

```
Face device ──LAN──> device software ──> "easytime" DB (factory PC)
                                              │
                               Ishita HRMS app (already installed there)
                                              │  every 30 seconds, over the internet
                                              ▼
                          Cloud ERP (ishita-api.duckdns.org) ──> attendance tables
```

- **Nothing new to install on the factory PC.** The Ishita HRMS app already reads the `easytime`
  database. Version **0.1.2** also sends every new punch to the ERP.
- **Nobody needs to open HRMS.** After the one-time setup (Step 3), HRMS starts **by itself, hidden,
  every time the PC is switched on and Windows logs in**. Only a small icon sits in the tray, near
  the clock. Punches go to the ERP all day even if no one ever opens the app.
- Closing the HRMS window also doesn't stop it; it goes back to the tray.
- **Updates install themselves.** If a new version comes out while HRMS is only in the tray, it
  installs quietly and starts again in the tray. Nobody has to click anything.
- **Nothing is lost.** If the PC or the internet is off, the device keeps the punches. When things
  come back, HRMS sends everything it missed.
- **No duplicates.** If the same punch is sent twice, the ERP keeps only one copy.
- The ERP only accepts punches from a PC that has the **sync key**, a secret password you create
  once (Step 1).

There are 4 steps. You do Steps 1–2 on your own computer; Step 3 takes 2 minutes on the factory PC.

---

## Step 1: Give the ERP server a sync key *(you, once)*

**1a. Make a key.** Open PowerShell on your computer and run:

```powershell
[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
```

You get a long code like `3f9c0a…e71b`. **Copy it into a safe note.** You need it in Step 3.

**1b. Put the key on the ERP server.** The backend reads it from the environment variable
`ATTENDANCE_SYNC_KEY`, the same way it reads `DB_PASSWORD` and `JWT_SECRET_KEY`.

- **Live server (EC2):** SSH in and see where the app's variables are kept:
  ```bash
  sudo systemctl cat sme-erp
  ```
  Look for the line that sets `DB_PASSWORD`. Then add one more line in the same place:
  - Variables written directly in the service file → add
    `Environment=ATTENDANCE_SYNC_KEY=<your key>` under `[Service]`
    (edit with `sudo systemctl edit --full sme-erp`).
  - Service uses `EnvironmentFile=/some/file` → add `ATTENDANCE_SYNC_KEY=<your key>` to that file.

  Then reload:
  ```bash
  sudo systemctl daemon-reload
  ```
- **Local testing (IntelliJ):** Run → Edit Configurations → your backend → Environment variables →
  add `ATTENDANCE_SYNC_KEY=<your key>`.

**1c. Deploy the backend** with the new attendance code (commit, push, run your usual deploy
workflow). Restarting creates the two new tables (`attendance_employee`, `attendance_punch`)
automatically.

**1d. Check the server.** Replace `<your key>` and run in PowerShell:

```powershell
curl.exe -H "X-Sync-Key: <your key>" https://ishita-api.duckdns.org/api/v1/attendance/sync/status
```

- You see something like `{"totalPunches":0,"totalEmployees":0,...}` → ✅ the server is ready.
- `401` → the key isn't set on the server, or the server wasn't restarted.
- `404` → the new backend version isn't deployed yet.

---

## Step 2: Publish the new HRMS version *(you, once)*

On your computer, in the `ishita-hrms` folder (PowerShell):

```powershell
$env:GH_TOKEN = "<your GitHub token>"
npm run publish
```

This builds **v0.1.2** and puts it on GitHub. The factory PC downloads it by itself.

---

## Step 3: Turn it on at the factory PC *(2 minutes, once)*

1. Open **Ishita HRMS**. Within a minute a message appears: **"Update ready → Restart & install"**.
   Click it. *(If you don't see it, close the app fully: right-click the tray icon → Quit. Then
   open it again.)*
2. Sign in as usual. Go to **Settings** (left sidebar, under *System*).
3. Scroll to **ERP sync**:
   - ☑ **Send face-device punches to the ERP**: leave ticked.
   - ☑ **Start with Windows and keep running in the background**: leave ticked.
   - **ERP sync key**: paste the key from Step 1a.
   - **ERP address**: leave empty (it uses the same server you sign in to).
4. Click **Save**.
5. Within a few seconds the badge turns green: **Syncing**, with a message like
   *"Sent 1,234 punches (1,234 new in ERP)."* On the first run it sends all the old punches too,
   so this can take a minute.

You're done. ✅ Close the window. **This was the only time anyone needs to open HRMS for the
sync.** From now on, every time the PC is switched on, HRMS starts by itself in the tray and keeps
sending punches. Staff can still open it from the desktop icon whenever they want to use it.

---

## Step 4: Check that it really works

- **On the factory PC:** Settings → ERP sync shows **Last successful sync** within the last minute,
  and **Punches added to ERP** goes up after someone punches.
- **From anywhere:** run the `curl.exe` command from Step 1d again. `totalPunches` should match,
  and `lastPunchTime` should be the latest punch.
- **"Without opening HRMS" test:** shut down the factory PC, switch it on, and log in to Windows.
  **Don't open HRMS.** Within a minute the HRMS icon appears in the tray by itself (no window).
  Punch on the device, wait 30 seconds, and run the Step 1d command again: `lastPunchTime` should
  show that punch.
- **Daily report in the ERP:** Swagger (`https://ishita-api.duckdns.org/swagger-ui.html` →
  **Attendance** → `GET /api/v1/attendance/daily`, after *Authorize*) shows first-in / last-out per
  employee. *(An Attendance page in the ERP website is not built yet.)*

---

## Everyday: nothing to do

Just switch the PC on. HRMS doesn't need to be opened, ever. Staff open it only when they want
attendance or payroll screens. Keep in mind:

- **Closing the window does not stop the sync.** To really stop it: right-click the tray icon →
  **Quit (stops ERP sync)**.
- The sync runs **after someone logs in to Windows**. If the PC sits at the Windows password screen,
  nothing is sent until someone logs in. *(Optional: set Windows to log in automatically. Run
  `netplwiz`, untick "Users must enter a user name and password".)*
- **Tray icon menu:** Open · Sync to ERP now · Quit.
- If someone clicks **Quit** in the tray, the sync stops until the PC is next restarted, or until
  someone opens HRMS. Nothing is lost; it catches up then.
- **Updates:** HRMS looks for a new version every 6 hours. When it's running only in the tray, it
  installs the update itself and keeps going.

## If something looks wrong

| Settings → ERP sync shows | What to do |
|---|---|
| **Needs sync key** | Paste the key from Step 1a and click Save. |
| **Problem:** *ERP rejected the sync key* | The key on this PC ≠ the key on the server. Copy it again (no spaces). Make sure the server was restarted after Step 1b. |
| **Problem:** *No connection to the ERP* | Internet is down or the server is off. Nothing to do: it retries by itself and catches up. |
| **Problem:** *ERP returned 404* | The backend with the attendance code isn't deployed yet (Step 1c). |
| **Problem:** mentions `easytime` / database | Check **Database connection** at the top of Settings. Is the device software installed and is PostgreSQL running? |
| No tray icon after restarting the PC | Open HRMS once by hand, then check that **Start with Windows** is ticked and click Save. |
| Times look 5:30 hours off | Windows time zone on the factory PC must be *(UTC+05:30) Chennai, Kolkata, Mumbai, New Delhi*. |

**Re-send everything** (only if someone asks): quit HRMS from the tray, delete
`%APPDATA%\Ishita HRMS\erp-sync-state.json`, then open HRMS again. The ERP skips the punches it
already has.
