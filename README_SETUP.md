# Real Estate Landing Page → Google Sheets CRM Auto-Populate System

This package contains an optimized landing page form and a Google Apps Script backend.

When a customer submits the form, the system automatically creates a new row in your Google Sheet CRM.

## Files

- `index.html` — landing website with property cards, Messenger, WhatsApp, email, and customer inquiry form.
- `google_sheets_backend.gs` — Apps Script backend that writes customer form data into Google Sheets.

## What gets auto-filled in Google Sheets

### `02_Leads`

The form automatically fills:

- Lead ID
- Date Created
- Lead Source
- Campaign Name
- Full Name
- Phone
- Email
- Facebook / Social Link or referrer
- Client Type
- Preferred Location
- Property Type
- Budget Min
- Budget Max
- Timeline
- Purpose
- Stage
- Lead Score
- Temperature
- Assigned Agent
- Next Follow-up Date
- Follow-up Count
- Matched Property ID
- Matched Property Name
- Days Since Contact formula
- Overdue? formula
- Notes

### `04_Activities`

The backend also logs:

- Activity ID
- Date
- Lead ID
- Lead Name
- Channel
- Action
- Outcome
- Next Action
- Next Follow-up Date
- Notes

## Step 1 — Open your CRM Google Sheet

1. Upload/open `real_estate_google_sheets_crm.xlsx` in Google Drive.
2. Open it with Google Sheets.
3. Confirm that these tabs exist:
   - `02_Leads`
   - `04_Activities`

## Step 2 — Add the backend Apps Script

1. In your Google Sheet, click `Extensions → Apps Script`.
2. Delete the starter code.
3. Paste everything from `google_sheets_backend.gs`.
4. Update these lines:

```js
const NOTIFY_EMAIL = 'your@email.com';
```

If the script is attached to the Google Sheet, you can leave this line unchanged:

```js
const SHEET_ID = 'PASTE_GOOGLE_SHEET_ID_HERE';
```

If the script is not attached to the Google Sheet, paste your Google Sheet ID there.

## Step 3 — Test the backend

Inside Apps Script:

1. Select the function `testLeadSubmit`.
2. Click Run.
3. Allow permissions.
4. Check your Google Sheet.
5. You should see:
   - 1 new row in `02_Leads`
   - 1 new row in `04_Activities`

## Step 4 — Deploy Apps Script as a Web App

1. Click `Deploy → New deployment`.
2. Click the gear icon and choose `Web app`.
3. Set:
   - Execute as: `Me`
   - Who has access: `Anyone`
4. Click `Deploy`.
5. Copy the Web App URL.

## Step 5 — Connect the landing page

Open `index.html` and find this section near the bottom:

```js
const CONFIG = {
  APPS_SCRIPT_URL: "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE",
  WHATSAPP_NUMBER: "639000000000",
  MESSENGER_USERNAME: "yourpageusername",
  EMAIL: "yourbusiness@email.com",
  BUSINESS_NAME: "Prime Property Match"
};
```

Replace:

- `APPS_SCRIPT_URL` with your Apps Script Web App URL.
- `WHATSAPP_NUMBER` with your WhatsApp number in international format, no plus sign.
- `MESSENGER_USERNAME` with your Facebook Page username.
- `EMAIL` with your business email.

## Step 6 — Publish the landing page

You can upload `index.html` to:

- Netlify
- Cloudflare Pages
- GitHub Pages
- Any basic shared hosting

For Netlify:

1. Go to Netlify.
2. Drag and drop the folder containing `index.html`.
3. Open the live website.
4. Submit a test inquiry.
5. Check `02_Leads` in your CRM Google Sheet.

## Important notes

The landing page uses a hidden form submission instead of normal `fetch()` because Google Apps Script often causes browser CORS problems on static sites. This method is more reliable for simple landing pages.

Because the endpoint is public, the backend includes a simple honeypot spam field. For serious ad campaigns later, add reCAPTCHA or Cloudflare Turnstile.

## Recommended next upgrades

- Load property cards directly from the `03_Properties` Google Sheet tab.
- Add Facebook Pixel and TikTok Pixel.
- Add automatic Messenger / WhatsApp reply templates.
- Add a lightweight admin page for property inventory.
- Upgrade from Google Sheets to Supabase when leads exceed 25,000 rows or when multiple agents need realtime access.
