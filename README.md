# Real Estate Lead Organizer V0.5

Full-featured CRM for real estate agents. Google Sheets as backend database. Admin + User login system. Optimized calendar. All buttons functional.

---

## What's New in V0.5

| Feature | Detail |
|---|---|
| **Login Gate** | App is locked behind a username/password login screen |
| **Admin role** | Can create users, delete users, reset any password, view all users |
| **User role** | Can log in, manage leads, change their own password |
| **Session tokens** | 8-hour sessions stored in Google Sheet. Auto-expire. |
| **SHA-256 passwords** | Salted hash — passwords never stored in plain text |
| **Calendar fixed** | Mini calendar + Full Calendar page: click any day to see events, edit from calendar |
| **Full Calendar page** | Dedicated calendar tab with large day cells, full appointment detail |
| **Follow-up Queue page** | Overdue, due today, upcoming — all in one dedicated page |
| **All buttons wired** | Every button in the app has a real, working function |
| **Redesigned UI** | Sidebar navigation, DM Serif Display typography, warm color system |
| **Sidebar nav** | Persistent sidebar with all pages, user info, logout |
| **Toast types** | success (green), error (red), warn (amber) visual feedback |
| **Admin User page** | Create, delete, reset passwords for users — admin only |
| **Change Password** | Any user can change their own password from the sidebar |

---

## Files

| File | Purpose |
|---|---|
| `index.html` | Upload to GitHub Pages — the full frontend |
| `apps_script_backend_v05.gs` | Paste into Google Apps Script inside your Google Sheet |

---

## Google Sheet Setup

### Step 1 — Create the Sheet

1. Create a new Google Sheet.
2. Go to **Extensions > Apps Script**.
3. Paste `apps_script_backend_v05.gs` into `Code.gs` and save.

### Step 2 — Set Your API Token

Change this line in `Code.gs`:

```js
const API_TOKEN = 'CHANGE_THIS_TO_A_LONG_RANDOM_TOKEN_12345';
```

Use a long, random, private string. Example:

```js
const API_TOKEN = 'qbee_realestate_2026_xK9f82bQmR';
```

### Step 3 — Run Setup Functions

In the Apps Script editor:

1. Select the function `setup` in the dropdown → click **Run** → authorize permissions.
2. Select the function `seedAdminUser` → click **Run**.

This creates:
- `Leads` sheet with all headers
- `Labels` sheet with defaults
- `Users` sheet with first admin account
- `Meta` sheet with notes

Default admin credentials (change immediately after first login):
```
Username: admin
Password: Admin@1234
```

### Step 4 — Deploy as Web App

1. Click **Deploy > New deployment**.
2. Select type: **Web app**.
3. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
4. Click **Deploy** and copy the Web App URL.

---

## Website Setup

1. Upload `index.html` to your GitHub Pages repository root.
2. Open the site in your browser.
3. You'll see the login screen first — but you must configure the Sheet first:
   - On the login page, click the `⚙` icon is not visible before login — see note below.
4. Open the browser's DevTools Console and run:

```js
localStorage.setItem('reLeadOrgV05_settings', JSON.stringify({
  apiUrl: 'YOUR_WEB_APP_URL_HERE',
  apiToken: 'YOUR_API_TOKEN_HERE',
  autoSync: 'on'
}));
location.reload();
```

Then log in with `admin / Admin@1234`.

**Or** — host the file locally, open it, use the login error to locate the Settings dialog, configure it there, then reload.

> **Better UX tip:** After your first login, go to **Sheet Sync Settings** in the sidebar to verify/update the URL and token anytime.

---

## Security Model

| Layer | How it works |
|---|---|
| API Token | Required on every request. Stored in browser localStorage. |
| Login | Username + SHA-256+salt hashed password, verified in Google Sheet |
| Session token | UUID stored in the Users sheet; expires in 8 hours; checked on every action |
| Admin actions | Checked server-side — role is read from the session row in the Sheet |
| Password storage | `salt:sha256(salt+plaintext)` — never stored as plain text |

**Known MVP limitation:** The API token is in browser localStorage, not a proper backend. This is sufficient for internal team use. For public-facing production, move to Supabase, Firebase, or a private server.

---

## Roles

### Admin
- All lead/label actions
- View all users
- Create new users (admin or user role)
- Delete users (except primary `admin`)
- Reset any user's password

### User (Agent)
- All lead/label actions
- Change their own password only
- Cannot access User Management page

---

## Google Sheet Tabs Created

| Tab | Contents |
|---|---|
| `Leads` | All lead records, 23 columns |
| `Labels` | Custom label list |
| `Users` | Usernames, hashed passwords, roles, session tokens |
| `Meta` | Setup notes and version info |

---

## Calendar Features

| Feature | How to use |
|---|---|
| Mini calendar (Command Center) | Click any day to see appointments for that day in the detail panel below |
| Full Calendar page | Dedicated full-size calendar; click day to expand full appointment cards with Edit and Reply buttons |
| Appointment entry | Set Appointment Date + Time in the Add/Edit Lead dialog |
| Reminders | Set "Remind Before" in the lead; keep the tab open; enable browser notifications in the Follow-up Queue page |
| Follow-up Queue | Dedicated page showing overdue, due-today, upcoming — with direct edit buttons |

---

## All Buttons — What They Do

| Button | Function |
|---|---|
| + Add Lead | Opens full lead edit dialog |
| ⚡ Intake Form | Fast add form with auto-scoring |
| 🏷 Labels | Manage custom labels (add, rename, delete) |
| ⬇ Export | Downloads JSON backup of all local data |
| ⬆ Import | Loads a JSON backup into the app |
| ↓ Pull | Loads Google Sheet data into app |
| ↑ Push | Overwrites Sheet with local data |
| ⟳ Sync | Same as Pull (quick re-sync) |
| 🎯 Auto Score | Scores and sets status from current form fields |
| 📋 Copy Reply | Copies a pre-written reply for this lead's status |
| 🔔 Enable Notifications | Requests browser notification permission |
| Change Password | Change your own password (sidebar) |
| Sheet Sync Settings | Configure Apps Script URL + token |
| Sign Out | Clears session and returns to login |
| Create User (admin) | Creates new user with chosen role |
| Delete User (admin) | Removes a user from the Sheet |
| Reset Pwd (admin) | Resets any user's password without needing old password |

---

## Upgrade Notes from V0.4

- V0.5 uses a new localStorage key (`reLeadOrgV05_*`). Your V0.4 data will not carry over automatically. Use **Export** from V0.4 first, then **Import** in V0.5.
- Run `setup()` and `seedAdminUser()` on the new V0.5 Apps Script before deploying.
- The Apps Script backend is not backward compatible — do not mix V0.4 frontend with V0.5 backend.
