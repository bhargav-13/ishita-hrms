# Ishita HRMS (desktop)

Local face-attendance & payroll app for the client PC. React UI inside an
Electron shell. Reads punches from the ZKTeco device DB (`easytime`), keeps
its own payroll data in a separate `hrms` database, logs in with cloud-ERP
credentials, and auto-updates.

## Architecture
```
Face device --LAN--> ZKTeco software --> Postgres "easytime"   (read only)
                                                  |
                                    Electron main (Node + pg)   <- the "backend"
                                                  |  own tables in "hrms" DB
                                          React UI (this app)
```
- `electron/` – Node main process: pg pools, auth, punch reader, IPC, auto-update.
- `src/` – React renderer (login, dashboard). Talks to Node only via `window.hrms`.
- `sql/hrms_schema.sql` – our own tables, created on first run.

## First-time setup
```bash
npm install
npm run dev        # Vite on :5174 + Electron window
```

## Configure the client PC
On first launch a config file is written to the app's userData folder
(`%APPDATA%/Ishita HRMS/config.json`). Edit it to match the site:
- `authBaseUrl` / `authLoginPath` – the cloud ERP login endpoint.
- `pg` – host/port/user/password of the local Postgres (the one the device software uses).
- `easytimeDb` / `hrmsDb` – database names.

Then open **Settings → Test connections**, and **Initialise HRMS tables**.

## Shipping updates (2–3×/week)
1. Set `build.publish.owner` in `package.json` to your GitHub org/user (private repo `ishita-hrms`).
2. Bump `version`, then:
   ```bash
   set GH_TOKEN=<your token> && npm run publish
   ```
Every installed client picks up the new version automatically on next launch.
