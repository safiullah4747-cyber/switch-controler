# Smart Switch Cloud — Resend OTP Update

یہ ZIP GitHub repository کے root میں upload کریں۔ موجودہ `index.js`, `index.html`, `package.json`, `render.yaml`, `.env.example` replace کریں۔

## Render Environment
- `DATABASE_URL`: پہلے والا PostgreSQL URL برقرار رکھیں
- `SESSION_SECRET`: پہلے والا secret برقرار رکھیں
- `RESEND_API_KEY`: Resend API key (صرف Render میں)
- `RESEND_FROM`: `Smart Switch <otp@corentra.website>`
- `NODE_ENV`: `production`

`SMTP_*` اب استعمال نہیں ہوتے؛ کامیاب Resend testing کے بعد انہیں Render سے ہٹا سکتے ہیں۔

## Test
1. GitHub commit کے بعد Render deployment Live ہونے دیں۔
2. Signup میں نیا email + password (10+ chars) ڈالیں اور OTP چیک کریں۔
3. پہلے سے موجود account کے لیے Forgot Password استعمال کریں۔
4. Resend dashboard میں Emails/Logs سے delivery status دیکھیں۔

## Important
- OTP صرف نئی signup یا password reset پر چاہیے؛ معمول کے login میں password کافی ہے۔
- موجودہ database اور cloud device API unchanged ہیں۔
- یہ ZIP صرف cloud backend ہے، ESP-01 firmware نہیں۔ Automatic hardware pairing اور offline-owner lock ابھی implement نہیں کیے گئے۔
- OTPs server memory میں ہیں؛ Render restart ہونے سے pending codes expire ہو جائیں گے۔
- Code syntax tested, live delivery not tested.
