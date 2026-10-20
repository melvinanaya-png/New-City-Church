# Google Firestore storage on Render

The app supports private Firestore storage for request details, signed agreement snapshots, approval tokens (hashed), delivery statuses and calendar event references. Photos stay packaged with the app. The app server accesses Firestore; browsers do not. Gmail and Calendar authorization are unchanged.

## Create the database

1. Open the existing Google Cloud project used for this app.
2. Open Firestore and create a **Standard edition**, **Native mode** database with ID **(default)**. Choose a US location close to Render (Oregon). Location cannot be changed later. Review Google's current free allowance and any billing requirements before accepting a paid option; this app does not require paid Firestore features.
3. If offered security rules, choose restrictive/production rules, not test mode. Deny direct client reads/writes:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if false; }
  }
}
```

Server service accounts use IAM instead of these browser rules. No public database access is needed.

## Connect Render without a service-account key (current church setup)

The church organization blocks service-account key creation. Leave that policy enabled. The app can reuse the existing server-side Google OAuth refresh token, with an additional Firestore scope. This is user OAuth, not Workload Identity Federation: storage access depends on the authorizing user's active account, IAM access and continuing consent. Keep this dependency in mind when changing staff accounts.

1. Ensure `melvin.anaya@newcitystc.church` has **Cloud Datastore User** access on this project in **IAM & Admin → IAM**. Existing sufficient access does not need another grant. Grant the human user used for OAuth; a role on the unused service account does not grant the user access.
2. Open [OAuth Playground](https://developers.google.com/oauthplayground/). In the gear menu enable **Use your own OAuth credentials** and enter the same Client ID and secret already in Render. Never paste them into chat. The OAuth client must permit `https://developers.google.com/oauthplayground` as a redirect URI (as in the existing email/calendar setup).
3. In Step 1's **Input your own scopes**, enter all three on one line:

```
https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/datastore
```

4. Click **Authorize APIs**, sign in as `melvin.anaya@newcitystc.church` (the current Gmail sender), and grant all three permissions. Use the app's internal organization audience as before. In Step 2 click **Exchange authorization code for tokens**.
5. In Render's private environment settings replace `GOOGLE_REFRESH_TOKEN` with the newly issued refresh token. Preserve `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; all three must belong to the same OAuth client. Add:
   - `STORAGE_BACKEND`: `firestore`
   - `FIRESTORE_AUTH_MODE`: `google-oauth`
   - `FIRESTORE_PROJECT_ID`: `new-city-building-requests` (confirm against the actual Cloud Project ID).
6. Do not add `FIRESTORE_SERVICE_ACCOUNT_JSON`. Save and deploy after the updated app commit is live. Keep existing Calendar and public URL settings.
7. Check logs for `Request storage check: Firestore read access verified`. This verifies read access only. `/api/status` reports `storageBackend: "firestore"` and `durableStorageConfigured: true` when the backend is selected; these settings indicators do not prove successful writes.
8. Submit a coordinated test request, check the private `buildingRequests` collection for the new document, redeploy/restart the service, then approve using the original test email link. Verify the agreement and approval survive and only one calendar entry is created. Do not send test requests to unsuspecting recipients.

If authorization fails, check that the new token has all three scopes, the Firestore API is enabled, and the signed-in user has project IAM access. Do not bypass organization policy or open database rules. The unused service account is not required for user OAuth.

For organizations that separately permit service-account keys, the previous explicitly configured `FIRESTORE_AUTH_MODE=service-account` plus `FIRESTORE_SERVICE_ACCOUNT_JSON` path remains supported. It is not the current church setup.

The collection appears automatically on the first successful submission. Each document stores a private `payload` Bytes field, preserving the exact signed terms and fee snapshot. Exempt `payload` from single-field indexing if configuring indexes; the application only reads documents by ID, never queries this field. Records over 900 KB are rejected before email delivery (Firestore's document limit is 1 MiB).

## Existing records and operational limits

Switching backends does **not** automatically migrate existing local request records. Render Free local files may already have disappeared. Before deploying, preserve any important pending records that are still available; earlier local approval links will not work in Firestore until their records are securely migrated. Existing email copies and Calendar entries remain independent of request storage.

Once Firestore is selected, failures never fall back to temporary disk. Do not remove the storage variables as a workaround. Keep the app on one Render instance: final booking approval is serialized within one Node process, not across multiple instances. External Calendar edits can still cause conflicts.

Firestore persistence is not a separate backup. Retention, deletion and backup policy should be decided by church administration; no automatic record deletion is enabled. Restrict project IAM to authorized administrators. Keep refresh tokens private. If Google authorization is revoked or the user account is disabled, reauthorize the app using the approved replacement account and update the Gmail sender as needed.

## Local development

`STORAGE_BACKEND` defaults to `file` and uses `DATA_DIR` or `.data/requests`. It is not durable on Render Free. Tests use temporary local files and mocked Firestore clients, never your live project. For a deliberate live Firestore test, use the same explicit storage and Google OAuth variables securely; ambient workspace Google credentials are intentionally not used as this app's service account.
