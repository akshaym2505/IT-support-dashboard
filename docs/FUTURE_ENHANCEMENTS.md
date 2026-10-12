# IT Support Portal: Future Enhancements

These are suggested next steps, grouped by area and ordered by priority inside each group. **P1** = do next (security or correctness), **P2** = high value, **P3** = nice to have. Items marked 🔗 close an open bug in [BUGS_FOUND.md](BUGS_FOUND.md).

---

## 1. Security & access (P1)

| Priority | Enhancement | Why |
|---|---|---|
| P1 🔗 O-01 | **Real login on the server.** Store users with hashed passwords (e.g. `bcrypt`), issue a session cookie or JWT, and check it on every API call. Remove the hard-coded demo account from `js/app.js`. | Today anyone can read the password in the browser source, and anyone who can reach port 8000 can use the API without logging in. |
| P1 🔗 O-02 | **Lock down CORS.** Replace `allow_origins=["*"]` with the portal's own address(es). | Stops other web pages from calling the API from an admin's browser. |
| P1 | **Separate "agent registration" from admin access.** Give installers a per-download enrollment token (embedded in the `.exe`) and accept `POST /api/remote-machines/register` only with a valid token. | Right now anyone on the network can register fake machines. |
| P2 | **Roles:** Admin, Technician, Requester. Only technicians see *Internal* notes; requesters see *Discussion* and *Resolution*. | This makes the note types meaningful beyond labels. |
| P2 | **Note ownership rules.** Only the author (or an admin) can edit or delete a note. Keep an edit history. | Today any logged-in user can edit any note. |
| P2 | **Audit log** of ticket changes (status, priority and assignee changes, with who and when). | Accountability, and it lets the details page show a full activity timeline. |
| P3 | **HTTPS** for the portal (reverse proxy such as Caddy or IIS). | Needed before the portal leaves a trusted LAN. |

## 2. Tickets & notes (P2)

| Priority | Enhancement |
|---|---|
| P2 | **"Resolution note → resolve ticket" shortcut:** when adding a Resolution note, offer a "Mark ticket as Resolved" checkbox. |
| P2 | **Activity timeline** on the details page that merges notes and field changes (needs the audit log). |
| P2 | **Attachments on notes**, such as screenshots and log files, stored on disk and linked from `ticket_notes`. |
| P2 | **Email notifications** to the requester (Discussion and Resolution notes) and to the assignee (new assignment). |
| P2 | **Filters and sorting** on the Tickets page (status, priority, assignee, category, date), plus **pagination** once there are hundreds of tickets. |
| P2 | **SLA timers:** time to first response and time to resolve, per priority, with overdue highlighting. |
| P3 | **Rich-text notes** (bold, lists, links). The unused "rich text editor" and "time entry" styles already in `style.css` were a start. |
| P3 | **Time reports:** time spent per technician, category or week, based on `time_spent_minutes`. |
| P3 | **Ticket templates / canned responses** for common issues (the unused `.standard-note-select` style hints at this). |
| P3 | **Link tickets to assets and machines**: pick the affected laptop from Assets or Remote Access. |
| P3 | **Convert old ticket dates** (stored as `8/27/2026, 6:30:44 AM` text) to ISO format with a one-time migration. |

## 3. Remote access & agent (P2)

| Priority | Enhancement |
|---|---|
| P2 🔗 O-04 | **Heartbeat / online status.** The agent (or a small Windows service) checks in every few minutes, and the backend marks a machine *Offline* when `last_seen` is too old. Today the status stays "Online" forever. |
| P2 | **Code-sign the `.exe`** with the company's code-signing certificate (`signtool sign …`) so SmartScreen and browsers stop showing "unknown publisher". |
| P2 🔗 O-05 | **Real remote-session gateway.** For example Apache Guacamole or MeshCentral, stored in `remote_url`, so *Remote Desktop / Web SSH* work for registered machines (today only the demo rows have a URL). |
| P2 | **Machine management UI:** edit labels, delete or retire machines (the API endpoints already exist). |
| P3 | **Use the unused installer fields** ("Selective Lock On Disconnect Extension") or remove them. |
| P3 🔗 O-06 | **Session file improvements:** only close the RDP window that the 5-minute session opened (not every `mstsc`), and make the macOS script work without GNU `timeout`. |
| P3 | **MSI package** for Group Policy / Intune deployment (the `.exe` already supports `/y` for silent runs). |
| P3 | **Build agents on non-Windows servers** (e.g. with the .NET SDK / Mono `mcs`) so the backend can run on Linux. |

## 4. Assets (P3)

| Priority | Enhancement |
|---|---|
| P3 🔗 O-12 | **Consistent status rules**, e.g. "Ready to Deploy" can't have a "Checked Out To" person, enforced on save. |
| P3 🔗 O-13 | **Unique serial numbers** (warn or block duplicates). |
| P3 🔗 O-14 | **Numeric cost/value fields** stored as numbers, formatted as currency, with depreciation for *Current Value*. |
| P3 | **Check-in/out history** per asset (who had it, when). |
| P3 | **Image upload** instead of pasting image URLs. |
| P3 | **CSV import/export** of the inventory. |

## 5. Users page (P2)

| Priority | Enhancement |
|---|---|
| P2 | Build the **Users** page (currently a "coming soon" placeholder): list technicians and requesters, set roles, and deactivate users. Feed the *Assigned To* suggestions from this list. |

## 6. Platform & quality (P2)

| Priority | Enhancement |
|---|---|
| P2 | **Serve the frontend from FastAPI** (`StaticFiles`), so one `uvicorn` command runs everything and the page and API share one address. This also makes the hard-coded `API_BASE` unnecessary. |
| P2 | **Automated tests:** `pytest` + FastAPI `TestClient` for every endpoint (using `ITPORTAL_DB` pointed at a temp file), plus a few browser tests (Playwright) for the ticket and notes flows. |
| P2 | **Version control:** put the project in git, with a `.gitignore` for `*.db`, `backend/agent/build/` and `__pycache__/`. |
| P3 | **Run as a service:** a Windows service or `nssm` for the backend, with log files. |
| P3 | **Database backups:** a nightly copy of `backend/tickets.db`. |
| P3 | **Split `js/app.js` per page** (tickets.js, assets.js, …) or move to ES modules; it's now well organized, but still one file loaded by every page. |

## 7. UX polish (P3)

| Priority | Enhancement |
|---|---|
| P3 🔗 O-03 | **Mobile menu button** to open the sidebar on phones (the sidebar is hidden below 768 px with no way to open it). |
| P3 | **Toast messages** instead of `alert()` pop-ups. |
| P3 🔗 O-10 | **Accessibility pass:** labels on all inputs, focus styles, screen-reader names for icon buttons. |
| P3 🔗 O-11 | **Login page clean-up:** replace the template text ("Welcome to Fluid", *Sign Up*, *Contact Us* links) with the portal's own branding. |
| P3 | **Dark mode.** |
