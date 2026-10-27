# Keyless Google Cloud Run migration

## Current status

Code is prepared, not deployed or live-verified. Render remains in its existing user-OAuth mode until explicitly changed. Do not weaken the organization's service-account-key policy or the 16-hour human reauthentication policy.

The proposed setup uses one dedicated Cloud Run runtime service account:

- Firestore: attached service identity through Application Default Credentials, with Cloud Datastore User on the existing project. No data migration: same `(default)` database and `buildingRequests` collection.
- Gmail + Calendar: Google Workspace domain-wide delegation for **only** `gmail.send` and `calendar.events`, impersonating the current sender `melvin.anaya@newcitystc.church`. The runtime calls IAM Credentials `signJwt`, then exchanges the assertion for a short-lived delegated token. No private key download or human refresh token.
- Public URL: Cloud Run, with the old Render service changed to redirects so existing approval email links continue to open the new app. Existing hashes/expiry and signed snapshots are preserved.

Domain-wide delegation is a privileged administrator approval. Although the app restricts impersonation to its configured church user, the service identity's approved scopes can technically be used to impersonate other domain users. A Google Workspace super administrator must review and authorize the two scopes. Keep deployment/IAM access limited to trusted administrators. The app requests no Gmail read/delete scope and no datastore scope through delegation.

Cloud Run has a free allowance but requires an appropriate billing setup and can incur charges, as can builds, image storage and Firestore. Review current Google pricing before enabling billing or deployment. These instructions do not claim a guaranteed $0 bill. Set a budget alert; budget alerts are not a spending cap.

## 1. Open Cloud Shell in the existing project

Use https://console.cloud.google.com/run?project=new-city-building-requests.

Confirm billing is acceptable before deploying. In Cloud Shell, use a new clone if the repository is not present. Do not overwrite an existing checkout or local work. Authenticate the private repository through Google's supported GitHub connection or your normal authorized Git workflow; do not paste GitHub credentials into chat.

```
gcloud config set project new-city-building-requests
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com iamcredentials.googleapis.com firestore.googleapis.com gmail.googleapis.com calendar-json.googleapis.com
```

## 2. Create the dedicated runtime identity

Use `new-city-requests-runtime` (distinct from the earlier unused storage-only account):

```
gcloud iam service-accounts create new-city-requests-runtime --display-name="New City building requests runtime"
gcloud projects add-iam-policy-binding new-city-building-requests --member="serviceAccount:new-city-requests-runtime@new-city-building-requests.iam.gserviceaccount.com" --role="roles/datastore.user"
gcloud iam service-accounts add-iam-policy-binding new-city-requests-runtime@new-city-building-requests.iam.gserviceaccount.com --member="serviceAccount:new-city-requests-runtime@new-city-building-requests.iam.gserviceaccount.com" --role="roles/iam.serviceAccountTokenCreator"
```

The last binding is on this service account itself, not the whole project. It permits server-side signing of the Workspace assertion. Do not give the runtime Owner or Editor.

Record its **OAuth 2 client ID** (not its email address):

```
gcloud iam service-accounts describe new-city-requests-runtime@new-city-building-requests.iam.gserviceaccount.com --format="value(oauth2ClientId)"
```

If needed, the service account's Google Cloud Console details/advanced settings show the OAuth client ID and Workspace domain-wide-delegation settings. Enable delegation for this account if the console requires it; no JSON key is needed.

## 3. Workspace administrator approval

Google Admin → Security → Access and data control → API controls → Manage Domain Wide Delegation → Add new.

Enter the runtime account's numeric OAuth client ID and exactly:

```
https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/calendar.events
```

Approve using the organization's super-admin process. This is a concrete approval of unattended send/Calendar access, separate from relaxing a human sign-in policy. The configured Workspace user must have an active Gmail mailbox and edit access to the existing shared calendar. Initially retain Melvin; changing to Hope later requires her mailbox/calendar permissions and updating GOOGLE_WORKSPACE_USER. Approver routing is separate and does not change.

Allow time for delegation changes to propagate (Google notes that it may take up to 24 hours). An authorization error during propagation is not a reason to disable security controls or repeatedly recreate credentials.

## 4. Deploy privately first

From the repository root with this migration commit checked out, deploy one instance and one concurrent request. The limit matters because booking serialization is local to one process. Do not enable multiple serving revisions, multiple instances, or parallel Render processing without distributed booking coordination.

```
gcloud run deploy new-city-building-requests --source . --region us-west1 --service-account new-city-requests-runtime@new-city-building-requests.iam.gserviceaccount.com --no-allow-unauthenticated --min-instances 0 --max-instances 1 --concurrency 1 --memory 512Mi --timeout 300 --set-env-vars "STORAGE_BACKEND=firestore,FIRESTORE_PROJECT_ID=new-city-building-requests,FIRESTORE_AUTH_MODE=attached-service-account,GOOGLE_AUTH_MODE=workspace-delegation,GOOGLE_SERVICE_ACCOUNT_EMAIL=new-city-requests-runtime@new-city-building-requests.iam.gserviceaccount.com,GOOGLE_WORKSPACE_USER=melvin.anaya@newcitystc.church,GOOGLE_CALENDAR_ID=c_856d9d9e318f7ac86bd0853b496002b294a8148bac8b9d23b8f42b65b13c6787@group.calendar.google.com,PUBLIC_BASE_URL=https://example.invalid"
```

`example.invalid` is a temporary placeholder while the service is private. Replace it before any submission/email test:

```
gcloud run services describe new-city-building-requests --region us-west1 --format="value(status.url)"
```

Copy the returned HTTPS `.run.app` URL. Update the variable using that exact value:

```
gcloud run services update new-city-building-requests --region us-west1 --update-env-vars "PUBLIC_BASE_URL=PASTE_THE_RETURNED_CLOUD_RUN_URL"
```

Do not configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN or FIRESTORE_SERVICE_ACCOUNT_JSON on Cloud Run. Do not set GOOGLE_APPLICATION_CREDENTIALS to a downloaded file. The attached runtime identity supplies authentication.

Read Cloud Run logs. Expect Firestore and Calendar read checks to pass; these checks send no emails or events. They do not establish Gmail-send or Calendar-write access. If source builds fail because your organization's build identity lacks permissions, follow the specific Google error and grant the required build identity access; do not grant the runtime Owner/Editor.

## 5. Cut over, then coordinate a real test

Keep submissions paused while switching; do not leave Render and Cloud Run accepting bookings concurrently.

1. In Render, add `LEGACY_REDIRECT_BASE_URL` with the exact Cloud Run service origin. Save/deploy. This version redirects every request with HTTP 307 and processes no bookings, sends no email and does not run startup provider checks. Keep enough existing configuration for startup; do not remove environment variables until verified. Old `/approval#id=...&token=...` links preserve their browser fragment when redirected to the new origin.
2. Make the Cloud Run form public:

```
gcloud run services add-iam-policy-binding new-city-building-requests --region us-west1 --member="allUsers" --role="roles/run.invoker"
```

If the organization's domain-restricted-sharing policy denies public invoker access, do not disable it as a shortcut. Have the administrator approve a supported public ingress arrangement for the form before proceeding.

3. Update the Squarespace Request a Space button to the new Cloud Run URL. The old Render link remains a redirect for previously sent emails and bookmarks. No iframe is needed for the chosen full-page design.
4. Submit a clearly labeled coordinated test. Real test emails go to the normal room approvers; agree with them beforehand. Verify the pending request is in the same Firestore collection, the requester receives their signed documents, and the approval email's URL uses Cloud Run.
5. Approve once, verify staff/requester delivery and exactly one calendar event. Restart/redeploy Cloud Run and verify the same request remains available without a new calendar event on retry. Check an unexpired pre-migration approval link through the Render redirect as well.
6. Verify the form again after **more than 16 hours** without reauthorizing anything. Until that is done, do not claim the overnight issue is resolved in production.

## Rollback and remaining limits

Keep Render available as a redirect until existing links are no longer needed. If rollback is necessary, pause submissions and disable public invocation of the failed Cloud Run service before removing the Render redirect. The old Render user-token mode still needs a valid token and remains subject to the previous problem; it is not a durable fix. Both backends refer to the same Firestore records, so avoid conflicting writers.

No separate health monitor or alert service is included. This migration replaces the human-token dependency, not provider availability monitoring. The app still has process-local booking coordination, no full request edit/cancel UI, and no automatic Firestore backup/retention policy. Google Calendar sharing and the calendar ID remain unchanged. No Planning Center automatic entry is added.
