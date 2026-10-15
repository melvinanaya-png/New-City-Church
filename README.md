# New City Church · Building requests

A responsive building-request page, using Node.js 22+ with no third-party runtime dependencies.

## Branding and form fields

The supplied New City Church brand guide defines the color palette: blue `#4f8cad`, cream `#fcfaed`, charcoal `#333132`, green `#779221`, and rust `#a94018`. The page uses the original blue logo extracted from the guide, Barlow for body text, and Barlow Condensed SemiBold for uppercase headings. Fonts are hosted locally under the SIL Open Font License, included in `public/assets/fonts/OFL.txt`.

Room request, equipment/setup needs, and setup requirements are required multi-select groups. Selected round tables, rectangular tables, and chairs require positive whole-number quantities. Selecting Other for rooms or equipment requires a description. The approval agreement is required. The browser and server validate these requirements, and both notification emails include selections and quantities.

## Run

From `/workspace/New-City-Church`:

```sh
npm start
```

The app runs on port 3000 (`PORT` overrides it). `npm run dev` restarts on edits. Run `npm test` for validation and routing tests.

## Workflow

1. A visitor supplies event, contact, room, equipment and quantity details.
2. The app sends each approver a branded HTML email with an **Approve request** button that opens the website for confirmation. A plain-text alternative includes the private link for email clients without HTML support. Routing:
   - Upper Elementary, Lower Elementary, City Students, Pre K and Nursery: Milyn Farrier (`milyn.farrier@newcitystc.church`) or Hope (`hope.varwig@newcitystc.church`).
   - Worship Center: Melvin (`melvin.anaya@newcitystc.church`) or Hope.
   - City Commons, Kitchen, Entire Building and Other: Hope.
3. Either assigned person can approve a room group. Requests spanning different groups require coverage of each group; Hope can approve all groups. For example, a classroom + Worship Center request can be approved by Hope alone, or by Milyn and Melvin together. Each person receives one email even when multiple rooms are selected. Opening a link does not approve.
4. Once all selected room groups are approved, the app notifies `facilities@newcitystc.church` (Darrell) and `mark.forbes@newcitystc.church` (Mark). Duplicate or late approvals do not resend completed notifications.
5. **Planning Center Calendar entry is manual.** Its current public Calendar API has no event creation operation. Emails explicitly request manual calendar entry.

Approval links expire after 14 days and act as bearer credentials; do not forward them. Tokens are stored only as hashes, carried in URL fragments, and removed from the browser URL when the approval page loads. Approval records must survive restarts for the links to work. Render Free currently has no durable storage configured; it remains unsuitable for real requests until storage is connected.

## Google Workspace email configuration

During testing, all emails are sent as **melvin.anaya@newcitystc.church** through the Gmail API. Melvin must authorize this app using his church Google account. Approval recipients follow the room routing above; Melvin remains the authorized email sender until Hope authorizes her mailbox. Before switching the sender to Hope, she must authorize her account and the sender and refresh token must be updated together. Resend is no longer used. Selecting an email address does not establish authorization.

A Google Workspace / Google Cloud administrator should:

1. Create a Google Cloud project, enable the Gmail API, and configure an Internal OAuth consent audience for the church's Workspace organization where available.
2. Create a server-side Web Application OAuth client. Register the actual authorization callback URL of the tool used for setup; the request app does not currently host an OAuth callback.
3. Obtain an offline refresh token by having Melvin sign in for testing (Hope when switching the sender) and explicitly grant the `https://www.googleapis.com/auth/gmail.send` scope through a trusted OAuth authorization flow. Do not use anyone's regular Google password. External apps left in testing may have short-lived refresh tokens; configure the app's appropriate production/internal status with the administrator.
4. Store `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN` securely in environment settings. Do not commit these values or paste them in chat. The cloud configuration declares secret requirements, not values.
5. Set `PUBLIC_BASE_URL` to the actual HTTPS origin serving this app. It must not point to the existing church website unless this app is deployed there.

`MAIL_FROM` is no longer read: Melvin's test sender address is fixed in the app. Remove the obsolete `RESEND_API_KEY` and `MAIL_FROM` requirements in the configuration review UI. Google OAuth token refresh and Gmail send are implemented. The user confirmed receipt of a test email from the Render deployment; the new room routing is verified with mocked email tests and still needs a coordinated live check. Tests mock both Google endpoints and send no real email. Gmail does not promise idempotency based on Message-ID; after an ambiguous network interruption, check the authorized sender's Sent folder before retrying.

`DATA_DIR` optionally sets a persistent private request directory; default is `.data/requests` in the checkout. Retain records across restarts. No records are publicly served. Without Google configuration, visitors see preview mode and submitting returns an honest unavailable message.

## Planning Center Calendar limitation

Automatic creation is unavailable through the documented public Calendar API. The official [2026-06-22 OpenAPI specification](https://api.planningcenteronline.com/calendar/v2/open_api/2026-06-22) exposes GET for `/events`, `/events/{event_id}`, event instances, and resource requests, with no POST operation to create an event. Credentials cannot enable an operation absent from the supported API. Calendar notifications therefore ask Darrell/Mark to enter approved events manually; `calendarConfigured` remains false.

Before building any alternative calendar automation, confirm a supported creation method with Planning Center. Do not use private endpoints or browser automation with shared account passwords as a substitute.

The prior form at https://newcitystc.church/new-page returned HTTP 403 during initial setup. Fields and room names now follow the user's provided requirements. This app is deployed separately on Render, not published into Squarespace.
