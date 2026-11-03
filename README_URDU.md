# Smart Switch Cloud — Login & Ownership Update

## GitHub files
Upload the ROOT files `index.js`, `index.html`, `package.json`, `render.yaml`, `.env.example`, and this README. Replace the old root files. Do not upload the `.env` secrets.

## Render
Keep the existing Web Service: Root Directory blank; Build `npm install`; Start `node index.js`. Keep `DATABASE_URL`, `SESSION_SECRET` (24+ characters), SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM. Set NODE_ENV=production. Save and deploy.

## New authentication
- Sign Up: email + password (10+ characters), then email OTP once.
- Login: email + password; no OTP.
- Forgot Password: email OTP and new password.
- Existing accounts created under the earlier OTP-only server have no password. Use Forgot Password to set one.
- Existing devices remain linked to their original account in PostgreSQL.

## Device ownership
- Creating device credentials assigns it to the signed-in owner. Only that owner can rename/control/release it.
- Release requires owner's account password; old device credentials are revoked.
- After release, a new owner must create new device credentials and enter them physically in ESP-01 local setup.
- Do not share the device secret. Reflashing ESP-01 does not erase the database owner record.
- **Important:** Current firmware supports entering generated device credentials, not a cryptographically attested immutable hardware identity. A stronger physical pairing/anti-cloning protocol would require a firmware update.

## Notes
- OTP is stored in memory for 10 minutes; restarting Render invalidates pending codes.
- Existing passwordless users must reset their password; SMTP must be configured.
- Device GPIO output must not be directly connected to 220V or a motor.
- Test authentication and device behavior before production.
