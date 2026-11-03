# Smart Switch Cloud — Render / GitHub

## GitHub upload
Upload the files at the repository ROOT (not nested in a folder). Keep existing Render PostgreSQL database and secrets. Deploy with `npm install` and `node index.js`.

## Render Environment
- `NODE_ENV=production`
- `DATABASE_URL`: existing Render PostgreSQL URL (secret)
- `SESSION_SECRET`: existing random secret (do NOT change or sessions will be invalidated)
- `RESEND_API_KEY`: existing Resend key (secret)
- `RESEND_FROM=Smart Switch <otp@corentra.website>`
- `ADMIN_EMAIL`: EXACT verified email of the account allowed to administer devices. This is NOT an admin password. Sign in normally with this account.

`/` user dashboard; `/admin` private admin search by exact email and release device with admin account password. Admin releases recorded in `admin_audit`. Existing users and devices are preserved by migrations.

## Automatic linking (IMPORTANT)
The old manual Add Device endpoint and button are removed. The server now provides `POST /api/device/claim` for updated ESP-01 firmware. This is a DEVICE endpoint and must be called by the physical ESP-01 via HTTPS with certificate verification, after its own setup hotspot collects home Wi-Fi and account credentials. JSON body: `{ "email":"user@gmail.com", "password":"ACCOUNT_PASSWORD", "device_id":"12_lowercase_hex", "device_secret":"48_lowercase_hex", "name":"Water Pump" }`. Device ID and secret must be generated randomly once and retained across reboots, not regenerated on each startup. Never log or permanently store the account password on ESP-01. The device secret is its cloud key; keep it private. Server replies with `{ok:true,device_id:...}`; then ESP-01 polls `/api/device/poll` with headers `x-device-id` and `x-device-key` as in the existing protocol.

**ESP-01 firmware is NOT in this GitHub ZIP and must be updated separately**. Until it is updated, devices will not automatically appear. The first-claim endpoint is not manufacturer-attested; a forged ID/secret could create a phantom device, and physical access can defeat software protections. For production, implement factory provisioned credentials and secure pairing, and do not send passwords over the unencrypted setup hotspot unless the local setup channel is secured. A safer alternative is a cloud browser pairing flow. Admin release only removes cloud ownership; offline firmware locks must be handled separately.

## OTP
Resend sends signup and reset OTP. Check Spam if not in Inbox. Never upload API keys or .env secrets to GitHub.

## Safety
Do not connect an unknown 220V pump directly to an ESP-01 or a small general-purpose relay; use a properly rated motor contactor and a qualified electrician.
