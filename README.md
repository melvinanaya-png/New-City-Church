# New City Church · Building requests

A responsive building-request page, using Node.js 22+ and pinned PDFKit dependencies for signed PDF copies.

## Branding and form fields

The supplied New City Church brand guide defines the color palette: blue `#4f8cad`, cream `#fcfaed`, charcoal `#333132`, green `#779221`, and rust `#a94018`. The page uses the original blue logo extracted from the guide, Barlow for body text, and Barlow Condensed SemiBold for uppercase headings. Fonts are hosted locally under the SIL Open Font License, included in `public/assets/fonts/OFL.txt`.

Room request and equipment needs are required multi-select groups. Tables and chairs are optional; leave setup selections blank if none are needed. Selected round tables, rectangular tables, and chairs require positive whole-number quantities. Selecting Other for rooms or equipment requires a description. The approval agreement is required. The browser and server validate these requirements, and both notification emails include selections and quantities.

## Run

From `/workspace/New-City-Church`:

```sh
npm ci --ignore-scripts
npm start
```

The app runs on port 3000 (`PORT` overrides it). `npm run dev` restarts on edits. Run `npm test` for validation and routing tests.

## Workflow

1. A visitor supplies event, contact, room, equipment and quantity details.
2. The app sends each approver a branded HTML email with an **Approve request** button that opens the website for confirmation. A plain-text alternative includes the private link for email clients without HTML support. Routing:
   - Upper Elementary, Lower Elementary, City Students, Pre K and Nursery: Milyn Farrier (`milyn.farrier@newcitystc.church`) or Hope (`hope.varwig@newcitystc.church`).
   - Worship Center: Melvin (`melvin.anaya@newcitystc.church`) or Hope.
   - City Commons: Hospitality (`hospitality@newcitystc.church`) or Hope.
   - Kitchen alone, Entire Building and Other: Hope. City Commons + optional Kitchen is one Hospitality-or-Hope approval group.
3. Either assigned person can approve a room group. Requests spanning different groups require coverage of each group; Hope can approve all groups. For example, a classroom + Worship Center request can be approved by Hope alone, or by Milyn and Melvin together. Each person receives one email even when multiple rooms are selected. Opening a link does not approve.
4. Once all selected room groups are approved, the app notifies `facilities@newcitystc.church` (Darrell) and `mark.forbes@newcitystc.church` (Mark). Duplicate or late approvals do not resend completed notifications.
5. Once all room groups are approved, the app creates one event in the configured **shared Google Calendar** and emails Darrell and Mark the outcome. Calendar errors leave the request approved with an explicit pending-calendar message; retry from the same approval link. Retries use the same Google event ID to avoid duplicates. Google Calendar does not create Planning Center reservations.

Approval links expire after 14 days and act as bearer credentials; do not forward them. Tokens are stored only as hashes, carried in URL fragments, and removed from the browser URL when the approval page loads. Approval records must survive restarts for the links to work. Render Free currently has no durable storage configured; it remains unsuitable for real requests until storage is connected.

## Google Workspace email configuration

During testing, all emails are sent as **melvin.anaya@newcitystc.church** through the Gmail API. Melvin must authorize this app using his church Google account. Approval recipients follow the room routing above; Melvin remains the authorized email sender until Hope authorizes her mailbox. Before switching the sender to Hope, she must authorize her account and the sender and refresh token must be updated together. Resend is no longer used. Selecting an email address does not establish authorization.

A Google Workspace / Google Cloud administrator should:

1. Create a Google Cloud project, enable the Gmail API and Google Calendar API, and configure an Internal OAuth consent audience for the church's Workspace organization where available.
2. Create a server-side Web Application OAuth client. Register the actual authorization callback URL of the tool used for setup; the request app does not currently host an OAuth callback.
3. Obtain an offline refresh token by having Melvin sign in for testing (Hope when switching the sender) and explicitly grant both `https://www.googleapis.com/auth/gmail.send` and `https://www.googleapis.com/auth/calendar.events` scopes through a trusted OAuth authorization flow. Do not use anyone's regular Google password. External apps left in testing may have short-lived refresh tokens; configure the app's appropriate production/internal status with the administrator.
4. Store `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN` securely in environment settings. Do not commit these values or paste them in chat. The cloud configuration declares secret requirements, not values.
5. Set `PUBLIC_BASE_URL` to the actual HTTPS origin serving this app. It must not point to the existing church website unless this app is deployed there.

`MAIL_FROM` is no longer read: Melvin's test sender address is fixed in the app. Remove the obsolete `RESEND_API_KEY` and `MAIL_FROM` requirements in the configuration review UI. Google OAuth token refresh and Gmail send are implemented. The user confirmed receipt of a test email from the Render deployment; the new room routing is verified with mocked email tests and still needs a coordinated live check. Tests mock both Google endpoints and send no real email. Gmail does not promise idempotency based on Message-ID; after an ambiguous network interruption, check the authorized sender's Sent folder before retrying.

`DATA_DIR` optionally sets a persistent private request directory; default is `.data/requests` in the checkout. Retain records across restarts. No records are publicly served. Without Google configuration, visitors see preview mode and submitting returns an honest unavailable message.

## Shared Google Calendar

Set `GOOGLE_CALENDAR_ID` in Render to:

```text
c_856d9d9e318f7ac86bd0853b496002b294a8148bac8b9d23b8f42b65b13c6787@group.calendar.google.com
```

Enable **Google Calendar API** in the same Google Cloud project as the OAuth client. Use Google OAuth Playground with the existing OAuth client and authorize **both** scopes together as `melvin.anaya@newcitystc.church`:

```text
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/calendar.events
```

Exchange the authorization code for tokens and replace `GOOGLE_REFRESH_TOKEN` securely in Render. Keep the same matching client ID and secret. The authorized account must be allowed to make changes to the target calendar. Save and redeploy. Do not paste tokens in chat. `calendarConfigured: true` means settings are present, not that permission or live insertion has been verified. The integration has mocked tests but no live Calendar verification yet.

On startup, `Google Calendar check:` in server logs reports a read-only access check. It requests only the response kind, never event details, and does not create events or send emails. Calendar failures distinguish missing OAuth scopes, disabled API, Workspace policy, permission and quota errors using recognized Google reason codes without logging raw provider responses or tokens. Successful read access does not establish write access.

Events contain the requested date/time (America/Chicago), rooms, equipment, setup quantities, requester and notes. Leaders view events through the calendar's sharing settings; the app does not invite attendees or send Google meeting invitations. The user chose organization-wide calendar visibility; review event-detail visibility before entering sensitive information.

If Google Calendar returns an error, the page and facilities notification say entry is pending and offer retry. Retrying does not resend completed facilities notifications. Do not manually create a duplicate while an uncertain automatic insert is unresolved. Durable request storage remains required: deterministic event IDs protect retries of an existing request, but do not restore approval records lost from Render's ephemeral disk.

## Planning Center Calendar limitation

Automatic creation is unavailable through the documented public Calendar API. The official [2026-06-22 OpenAPI specification](https://api.planningcenteronline.com/calendar/v2/open_api/2026-06-22) exposes GET for `/events`, `/events/{event_id}`, event instances, and resource requests, with no POST operation to create an event. Credentials cannot enable an operation absent from the supported API. The shared Google Calendar is the supported alternative. Any Planning Center reservations remain manual; `calendarConfigured` refers only to the Google Calendar settings.

Before building any alternative calendar automation, confirm a supported creation method with Planning Center. Do not use private endpoints or browser automation with shared account passwords as a substitute.

The prior form at https://newcitystc.church/new-page returned HTTP 403 during initial setup. Fields and room names now follow the user's provided requirements. This app is deployed separately on Render, not published into Squarespace.

## AV request notifications

Selecting Sound Technician, TV Screens, Sound/Mixer, Microphones or TV/DVD notifies `melvin.anaya@newcitystc.church` immediately when submitted. If Melvin is already an assigned room approver, his approval email doubles as the AV notice and its subject is marked accordingly. Otherwise, he gets a separate informational email with no approval token; this does not grant him permission to approve another team's rooms. Final approvals still notify Darrell and Mark. Calendar creation waits for room approval as before.

## Squarespace placement

The app can be embedded only on `https://newcitystc.church` and `https://www.newcitystc.church` (and its own origin). Approval pages remain unframeable. The form-only URL is `https://new-city-building-requests.onrender.com/?embed=1`.

On the Squarespace page `/new-page`, enter Edit mode and add a Code Block in HTML mode. Paste `docs/squarespace-embed.html`. The optional script sizes the iframe using messages checked against the app's exact origin and iframe window. If JavaScript is unavailable, the fixed-height iframe remains scrollable. If the Squarespace plan disallows iframes, use a Button Block linking to the full app instead. Preview on mobile and desktop before replacing the old form. The app's embedded view hides duplicate navigation and the introductory panel but retains the New City logo and full form.

The repository update does not edit or publish Squarespace. The user must apply the block with their Squarespace account. Durable storage is still required before opening the page for real requests; Render Free can lose approval records on restarts/deployments.


## Recurring gatherings

The optional Repeat selector supports weekly, every-other-week and monthly gatherings. The requester chooses 2–104 total occurrences (including the first). The first event date sets the weekday or day of month. Monthly dates 29–31 skip months without that date, as explained by the form. There is no unlimited repeat option.

The full schedule is stored with the request, shown in approval/AV/facilities emails, and covered by the room approvals. The app sends one notification workflow for the entire series. After approval, Google Calendar receives one recurring event with a bounded RRULE and America/Chicago timezone so local meeting times remain consistent across daylight saving changes. Request IDs prevent duplicate series on retries. One-time requests continue to work with an omitted or null recurrence. Calendar changes/cancellations after creation must currently be managed by calendar editors; there is no request-editing flow.


## Room availability and overbooking

The form checks the shared Google Calendar for the requested date/time and every occurrence in a repeating schedule. Unavailable rooms are disabled and labelled **Already booked for this time**. A conflict anywhere in a series blocks that room for the whole request. Submission and final approval recheck availability; Google API failures block booking instead of assuming availability. Back-to-back events are allowed. Pending requests do not hold rooms, so two pending requests may overlap, but only the first can book after approval.

New calendar entries store structured room metadata. Existing app events are recognized by their comma-separated room location or the `Rooms:` description line. For manually created events, set Location to exact room names separated by commas (for example `City Commons, Kitchen`). `Entire Building` conflicts with any room. Unlabelled busy events and unknown/Other spaces conservatively block the whole building. Cancelled events and events marked **Free** do not block rooms. The form reveals only room names and conflicting request dates, never calendar event titles or notes.

Google expands existing recurring bookings, and the app expands requested weekly/biweekly/monthly dates in America/Chicago, including DST. The whole calendar result set is paginated; incomplete reads block booking. All-day events also block their rooms. Pending approvals for an existing calendar request ignore that request's own event to preserve safe retry behavior.

Final approval checks and event inserts are serialized within the single Node process. Google Calendar itself does not enforce room exclusivity: simultaneous manual edits, other integrations, or multiple app instances can bypass this process-level lock. Use the form as the booking entry point and keep one app process; durable storage and distributed coordination are still needed before broader production use. Firestore support is implemented; production configuration and a live persistence test are still required (see docs/firestore-setup.md).


## Signed building-use agreement

New requests require the displayed current agreement, a typed full-name signature, and explicit electronic-signature consent. The server records the terms snapshot, agreement version, signer, UTC timestamp, and exact fee document reviewed at signing with its SHA-256. Client-supplied terms or timestamps are not accepted. Update `AGREEMENT_VERSION` whenever changing terms or the fee document. Existing signed snapshots must remain unchanged.

The contract includes requester-provided setup/teardown/cleaning, all supplied kitchen and room cleanup duties, a $50 lost-key fee, and responsibility for damage charges determined from repair/replacement costs without a fixed damage amount. Fees are not automatically calculated or charged: the uploaded sheet has hourly and flat-rate sections, and staff must confirm the applicable charges.

At submission, the requester receives the signed agreement PDF and fee-sheet PDF reviewed at signing with a clear pending-approval notice. Approval emails to staff also include these documents. After full approval, the requester receives another copy and room-reset instructions. Completed requester/staff notifications are tracked separately to avoid resending completed messages on retry. Signed agreements are never served through public URLs. Keep the record store private and persistent; email attachments do not replace durable approval-record storage. Configure Firestore and verify persistence using docs/firestore-setup.md.

### Room reset photos

Three church-supplied HEIC photographs are retained as JPEG references: City Commons layout, City Commons chair storage, and kitchen. Only enhanced copies are included in outgoing emails, as explicitly requested by the user. They are labelled as enhanced visual aids because small details may differ from the actual room. Original files remain stored but are not attached. The originals remain preserved in the upload workspace and the original-layout JPEG assets remain alongside enhanced copies.

`RESET_PHOTOS` in `agreement.js` maps room names to attachment arrays. City Commons alone receives only its two enhanced views, not the kitchen image. Selecting Kitchen adds only its enhanced view; Entire Building receives all photos. No photos are exposed through public application routes. Kitchen-specific cleanup duties apply only when the kitchen is used. City Commons + Kitchen can be approved by Hospitality or Hope; Kitchen alone still routes to Hope. Existing signed terms stay snapshotted, while new requests use agreement version `2026-10-20-v6`.

### Expanded fee sheet

`fees.json` preserves the existing supplied rates and adds Pre K, Upper Elementary, Lower Elementary and Nursery alongside the existing City Students row in both sections. The user confirmed that each children’s room uses **$25/hour for non-members and $25 flat for members**, matching City Students. City Students retains $25/hour in the non-member section and $25 flat in the members section. These rates are per room. Run `node scripts/generate-fees.mjs` after an authorized rate update and bump the agreement version when changing the fee document. The generated PDF also records the existing $50 lost-key obligation, damage-cost responsibility, and requester setup/cleanup obligations. Each signed request keeps the exact fee bytes and hash reviewed at signing; later rate edits do not replace older signed copies.

### Lockbox code plan — not active

No codes are currently collected, stored, exposed, or automatically sent. Keep the changing access code out of the signed contract, calendar descriptions, and public page. Once the lockbox is installed and persistent storage is connected, maintain a private access-code record per valid period (`validFrom`, `validUntil`, and the confidential code). Monthly or every-other-month rotation can use the same model. Staff must change the physical lockbox code too; updating a database does not rotate the lockbox.

Send approved users access instructions separately for the actual visit date, near the event, after any required fees have been confirmed. Recurring users need a current code for each applicable period, rather than a promise that one code works for the entire series. This delivery/scheduling workflow has not been built; staff must provide access instructions manually until then. Never ask users to post codes or credentials in chat.

Setup inventory limits per request: 6 round tables, 8 rectangular tables, and 60 chairs. The browser and server enforce these maxima; setup remains optional. These are per-request limits, not pooled inventory reservations across different rooms.

Event setup policy: Daija is not a notification recipient. Groups handle setup and cleanup unless the church confirms assistance separately; staff arrange any help outside the form. Approved staff notifications go only to Darrell and Mark.

The event-type question has been removed at the user’s request. New requests do not classify internal/outside events. The simplified setup policy says groups handle setup, teardown and cleanup unless the church separately confirms assistance; the form never assigns a setup volunteer. Staff coordinate any church-event help outside the form.

### Durable Google storage

Firestore support is available: follow [the Firestore setup guide](docs/firestore-setup.md) to create a private database and configure Render. Set `STORAGE_BACKEND=firestore`, `FIRESTORE_AUTH_MODE=google-oauth`, and `FIRESTORE_PROJECT_ID` in Render's private environment settings. Reauthorize the existing Google OAuth client for Gmail send, Calendar events and `https://www.googleapis.com/auth/datastore`, then replace `GOOGLE_REFRESH_TOKEN`. This uses user authorization and requires no downloaded service-account key. The signed-in user needs Cloud Datastore User access to the project. Until configured, the app still uses local files. Do not paste service-account JSON into chat or commit it. Existing local records are not automatically migrated. Verify a test request survives redeployment before using this for real signed requests.

### Keyless Cloud Run migration (prepared, not deployed)

See [Cloud Run migration](docs/cloud-run-migration.md) for moving off human refresh tokens while keeping the church's 16-hour sign-in policy and key-creation policy enabled. New explicit modes: `GOOGLE_AUTH_MODE=workspace-delegation` for IAM-signed, Workspace-admin-authorized Gmail/Calendar tokens, and `FIRESTORE_AUTH_MODE=attached-service-account` for Firestore. Existing Render settings retain their current behavior. Domain-wide delegation requires a super administrator's approval, and Cloud Run billing must be reviewed before deployment. `LEGACY_REDIRECT_BASE_URL` supports redirecting old Render approval links after cutover. No cloud resources or Workspace grants are created by this code change.
