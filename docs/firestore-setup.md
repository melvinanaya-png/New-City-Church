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

## Give the Render app access

1. Google Cloud → **IAM & Admin → Service Accounts → Create service account**. Name it `new-city-requests-storage`.
2. Grant **Cloud Datastore User** (`roles/datastore.user`) on this project. Do not grant Owner or Editor. Skip optional user access.
3. Open that account → **Keys → Add key → Create new key → JSON**. Download privately. If your organization disables key creation, stop here and arrange an approved authentication method with your Google Workspace administrator; do not disable organization policy.
4. Render → `new-city-building-requests` → **Environment → Edit**. Add:
   - `STORAGE_BACKEND`: `firestore`
   - `FIRESTORE_PROJECT_ID`: the Google Cloud **Project ID**, not project name or number.
   - `FIRESTORE_SERVICE_ACCOUNT_JSON`: the entire downloaded JSON file contents, including braces. Keep the private key exactly as represented in the JSON (`\n` remains escaped inside the JSON string). Enter this only in Render's private environment settings. Never put it in GitHub, public code, Squarespace, or chat.
5. Save and deploy. Keep existing Gmail, Calendar and public URL variables.
6. Check logs for `Request storage check: Firestore read access verified`. This verifies read access only. `/api/status` reports `storageBackend: "firestore"` and `durableStorageConfigured: true` when the backend is selected; these settings indicators do not prove successful writes.
7. Submit a coordinated test request, check the private `buildingRequests` collection for the new document, redeploy/restart the service, then approve using the original test email link. Verify the agreement and approval survive and only one calendar entry is created. Do not send test requests to unsuspecting recipients.

The collection appears automatically on the first successful submission. Each document stores a private `payload` Bytes field, preserving the exact signed terms and fee snapshot. Exempt `payload` from single-field indexing if configuring indexes; the application only reads documents by ID, never queries this field. Records over 900 KB are rejected before email delivery (Firestore's document limit is 1 MiB).

## Existing records and operational limits

Switching backends does **not** automatically migrate existing local request records. Render Free local files may already have disappeared. Before deploying, preserve any important pending records that are still available; earlier local approval links will not work in Firestore until their records are securely migrated. Existing email copies and Calendar entries remain independent of request storage.

Once Firestore is selected, failures never fall back to temporary disk. Do not remove the storage variables as a workaround. Keep the app on one Render instance: final booking approval is serialized within one Node process, not across multiple instances. External Calendar edits can still cause conflicts.

Firestore persistence is not a separate backup. Retention, deletion and backup policy should be decided by church administration; no automatic record deletion is enabled. Restrict project IAM to authorized administrators. Rotate a service-account key by adding the replacement securely in Render and verifying access before retiring the old key.

## Local development

`STORAGE_BACKEND` defaults to `file` and uses `DATA_DIR` or `.data/requests`. It is not durable on Render Free. Tests use temporary local files and mocked Firestore clients, never your live project. For a deliberate live Firestore test, use the same three variables securely; ambient workspace Google credentials are intentionally not used as this app's service account.
