# New City Church · Building requests

A responsive building-request page, using Node.js 22+ with no third-party runtime dependencies.

## Run

From `/workspace/New-City-Church`:

```sh
npm start
```

The app runs on port 3000 (`PORT` overrides it). `npm run dev` restarts on edits. Run `npm test` for validation and routing tests.

## Workflow

1. A visitor supplies event, contact, space, and setup details.
2. The request is saved locally and emailed **only to Hope.varwig@newcitystc.church**.
3. Hope uses the private, 14-day approval link in the email and explicitly approves. Opening the link alone does not approve anything.
4. Approval emails **facilities@newcitystc.church (Darrell Bearce)** and **mark.forbes@newcitystc.church (Mark Forbes)**. Retrying a completed approval does not resend notifications.
5. Calendar creation is currently manual. The emails and UI explicitly say that Planning Center is not connected.

Approval links are bearer credentials; do not forward them. Their tokens are stored only as hashes, transmitted in the URL fragment, and removed from browser history when the approval page loads.

## Google Workspace email configuration

During testing, all emails are sent as **melvin.anaya@newcitystc.church** through the Gmail API. Melvin must authorize this app using his church Google account. Hope remains the approver. Before switching the sender to Hope, she must authorize her account and the sender and refresh token must be updated together. Resend is no longer used. Selecting an email address does not establish authorization.

A Google Workspace / Google Cloud administrator should:

1. Create a Google Cloud project, enable the Gmail API, and configure an Internal OAuth consent audience for the church's Workspace organization where available.
2. Create a server-side Web Application OAuth client. Register the actual authorization callback URL of the tool used for setup; the request app does not currently host an OAuth callback.
3. Obtain an offline refresh token by having Melvin sign in for testing (Hope when switching the sender) and explicitly grant the `https://www.googleapis.com/auth/gmail.send` scope through a trusted OAuth authorization flow. Do not use anyone's regular Google password. External apps left in testing may have short-lived refresh tokens; configure the app's appropriate production/internal status with the administrator.
4. Store `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN` securely in environment settings. Do not commit these values or paste them in chat. The cloud configuration declares secret requirements, not values.
5. Set `PUBLIC_BASE_URL` to the actual HTTPS origin serving this app. It must not point to the existing church website unless this app is deployed there.

`MAIL_FROM` is no longer read: Melvin's test sender address is fixed in the app. Remove the obsolete `RESEND_API_KEY` and `MAIL_FROM` requirements in the configuration review UI. Google OAuth token refresh and Gmail send are implemented, but live delivery has not been verified without credentials. Tests mock both Google endpoints and send no real email. Gmail does not promise idempotency based on Message-ID; after an ambiguous network interruption, check the authorized sender's Sent folder before retrying.

`DATA_DIR` optionally sets a persistent private request directory; default is `.data/requests` in the checkout. Retain records across restarts. No records are publicly served. Without Google configuration, visitors see preview mode and submitting returns an honest unavailable message.

## Planning Center connection — pending

Automatic calendar creation is **not implemented or verified**. Before implementing it, obtain a supported Planning Center Calendar API connection with write access, the target calendar/event ownership details, and the actual room/resource identifiers. Confirm the supported event-creation workflow and conflict handling against the church's account. Do not put credentials in chat. Use secure environment settings. The proposed room options are preferences, not synced Planning Center resources.

The prior form at https://newcitystc.church/new-page returned HTTP 403 during setup, so its fields could not be inspected. Confirm the proposed fields and spaces before launch. The page is not published to the church website.
