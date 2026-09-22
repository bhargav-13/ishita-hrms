# Ishita HRMS — Installation Guide

A desktop app for daily face-device attendance and payroll. It runs **locally** on
one office PC and reads punches from the face-attendance device on the same network.

There are three things to install on that PC, in this order:

1. **PostgreSQL** — the database (comes with pgAdmin, a viewer). *Skip if already installed.*
2. **The face-device software** (from your device vendor) — creates the `easytime` database.
3. **Ishita HRMS** — this app.

> Do the whole setup once, on one PC. After that, staff just open the app and sign in.

---

## Part 1 — Install PostgreSQL  *(skip if the PC already has it)*

**Not sure if it's installed?** Press the Windows key and type **pgAdmin**. If it shows
up, PostgreSQL is already installed — skip to Part 2, and just make sure you know its
**password**.

**To install it:**

1. Open **https://www.postgresql.org/download/windows/** → click **Download the
   installer** → choose the latest version (e.g. PostgreSQL 17) → run the downloaded file.
2. Click **Next** through the screens. Keep the defaults (install location, components —
   leave **pgAdmin** and **Command Line Tools** ticked).
3. **Set a password** for the database user `postgres`.
   👉 **Write this password down — you'll need it twice** (for the device software and
   for the app). Example: keep it simple like `Ishita@123`.
4. **Port** — leave it as **5432** (default).
5. Finish the install. Skip "Stack Builder" at the end (uncheck it, click Finish).

PostgreSQL now runs automatically in the background every time the PC starts.

---

## Part 2 — Set up the face-device software

Install the software that came with your **face-attendance device** (from the device
vendor) and complete its setup. During its setup it will connect to PostgreSQL — use the
**same password** from Part 1 (Step 3) — and it creates a database called **easytime**
where every punch is stored.

*(This is the vendor's software, not ours — follow the manual that came with the device.
Our app only reads the `easytime` database it produces.)*

Enroll your staff (faces) in this software. Each person gets an **employee code** —
our app uses that same code to match them.

---

## Part 3 — Install Ishita HRMS

1. Double-click **`Ishita HRMS Setup.exe`** → click through → **Finish**.
   A **Ishita HRMS** icon appears on the desktop.
   *(If Windows shows "Windows protected your PC": click **More info → Run anyway** —
   this is normal for in-house apps.)*

2. Open **Ishita HRMS** → sign in with your **Ishita login** (same as the ERP website;
   needs internet the first time).

3. Go to **Settings** (left sidebar) → **Database connection**:
   - **Password** — enter the PostgreSQL password from Part 1, Step 3.
   - Leave Host `localhost`, Port `5432`, User `postgres` (unless your setup differs).
   - Click **Save & connect**.
   - You should see **easytime → connected** and **hrms → connected** (green).
     *(The app creates the `hrms` database itself — you don't make it.)*

4. Load your staff: **Employees → Import from device** → then open each person to set
   their **salary** and assign a **Shift** (Setup → Shifts).

Setup is complete. ✅

---

## Everyday use  *(for the office staff)*

1. Double-click the **Ishita HRMS** icon.
2. Sign in with your **Ishita username and password**.
3. Use it:
   - **Attendance** — today's punches from the device
   - **Payroll → Weekly (Thu)** → **Preview** → **Run & Save** → export/print
   - **Employees / Setup** — staff, shifts, holidays, leave, salary

No other software to open day-to-day.

---

## Updates — nothing to do

When a new version is released, the app **downloads it automatically** and shows a small
**"Update ready → Restart & install"** message. Click it — you're on the latest version.
You never re-install manually.

---

## (Optional) Viewing data in pgAdmin

Only needed if you want to look inside the database directly — not required to use the app.

1. Open **pgAdmin** from the Start menu (installed with PostgreSQL in Part 1).
2. First time, it asks you to set a **master password** (your own choice).
3. Expand **Servers → PostgreSQL** → enter the `postgres` password when asked.
4. Under **Databases** you'll see **easytime** (device data) and **hrms** (app data).

---

## If something looks wrong

| You see | Do this |
|---|---|
| Settings shows a DB "down" | Check the password in **Settings → Database connection**. Make sure PostgreSQL is running (restart the PC if unsure). |
| easytime "down" but hrms "connected" | The device software / `easytime` DB isn't set up yet (Part 2), or its name differs — check the **Device DB** field in Settings. |
| Attendance is empty | No punches recorded on the device for that day yet — normal. |
| Can't sign in | Check internet; use your Ishita ERP username and password. |

For anything else, contact your Ishita support/vendor.
