# ESP-01 Smart Switch + Render Cloud — مکمل پروجیکٹ (Prototype)

## کیا کام کرتا ہے؟
- ESP-01 اپنا `SmartSwitch-Setup` Wi-Fi اور `http://192.168.4.1` Dashboard چلاتا ہے۔
- Offline ON/OFF، Auto-OFF Countdown اور 8 الگ روزانہ Local ON/OFF Schedules۔
- گھر کے 2.4GHz Wi-Fi سے جڑتا ہے؛ Wi-Fi دستیاب ہو تو NTP Clock استعمال کرتا ہے۔
- Render پر Node.js + PostgreSQL Cloud Dashboard؛ Email OTP Signup/Login، Multiple Devices، Rename، Remote ON/OFF، Countdown، اور 16 فی Device Cloud Daily Schedules۔
- ESP-01 ہر تقریباً 15 سیکنڈ میں HTTPS سے Cloud Commands Poll کرتا ہے۔
- Device Secret کو Cloud میں SHA-256 Hash کی صورت میں رکھا جاتا ہے؛ ESP-01 پر Secret محفوظ ہوتا ہے۔

## ضروری حدود
- یہ **development prototype** ہے؛ 220V پانی کی موٹر یا کوئی mains load براہ راست اس سے نہ چلائیں۔ ESP-01 کا GPIO2 Boot Pin ہے؛ Boot پر Pulse ہو سکتا ہے۔ Motor-rated contactor, isolation, protection, enclosure, proper driver اور qualified electrician ضروری ہیں۔
- Online commands کی delivery instant نہیں: تقریباً 15 سیکنڈ polling اور Render latency لگ سکتی ہے۔ Free Render service sleep ہونے پر مزید تاخیر ہو سکتی ہے۔
- Offline Schedules الگ ESP-01 میں محفوظ ہیں، اور صحیح وقت کے لیے کبھی نہ کبھی NTP Sync درکار ہے؛ مکمل Power Loss کے بعد بغیر انٹرنیٹ صحیح Clock دستیاب نہیں۔ Cloud Schedules Server پر چلتے ہیں، Server/Internet بند ہو تو نہیں چلیں گے۔
- Cloud Scheduler اس Node.js Instance میں چلتا ہے؛ اس لیے Render Service مسلسل چلنی چاہیے۔ Render Service Sleep یا Restart سے Scheduled Times miss ہو سکتے ہیں۔ Production کے لیے dedicated scheduler/worker چاہیے۔
- AP password `12345678` صرف ابتدائی Test کے لیے ہے؛ اصل Installation سے پہلے Firmware میں Strong Unique Password رکھیں۔ AP پر Local Controls موجود ہیں۔ Cloud Key کسی کو نہ دیں۔
- Wi-Fi Password اور Device Key ESP-01 EEPROM emulation میں موجود ہیں؛ physical access رکھنے والا شخص انہیں نکال سکتا ہے۔
- Render HTTPS certificate کے لیے `CloudCerts.h` میں GTS Root R1 اور ISRG Root X1 رکھے ہیں۔ Render کی Certificate Chain بدلے تو Trust Anchors Update کرنے پڑ سکتے ہیں؛ **TLS Verification بند نہ کریں**۔
- نئی Firmware کا EEPROM Layout پرانی Firmware سے مختلف ہے؛ پہلی بار Wi-Fi اور Schedules دوبارہ Configure کرنا ہوں گے۔

## Render Setup
1. GitHub پر **اس پورے فولڈر** کو نئی private repository میں Upload کریں، جس کے Root پر `render.yaml` ہو۔
2. Render میں PostgreSQL Database بنائیں۔ اس کا Internal Database URL Copy کریں۔ Render Plan اور Storage Pricing چیک کریں۔
3. Render Dashboard > New > Blueprint یا Web Service: repository Connect کریں۔ اگر manually Web Service بنائیں تو Root Directory `server`, Build Command `npm install`, Start Command `npm start`۔
4. Environment Variables میں `DATABASE_URL`, `SESSION_SECRET` (random 32+ characters), `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` دیں۔ Email OTP کے لیے ایک حقیقی SMTP Account ضروری ہے۔ `NODE_ENV=production` بھی Set کریں۔
5. Deploy کے بعد `https://YOUR-SERVICE.onrender.com/health` کھولیں؛ `{ "ok": true }` آنا چاہیے۔
6. Cloud Dashboard پر Email Enter کریں، OTP لیں، Verify کریں۔ `Add a device` پر Name لکھیں۔ Device ID اور Secret Key صرف ایک بار دکھیں گے، محفوظ کرلیں۔

## ESP-01 Arduino Upload
1. `firmware/SmartSwitch_ESP01_Cloud/` فولڈر میں `.ino`, `Dashboard.h`, `CloudCerts.h` تینوں فائلیں **ایک ساتھ** رکھیں۔
2. Arduino IDE > Board `Generic ESP8266 Module`; ESP8266 Board Package 3.1.2؛ مناسب COM Port۔
3. Verify کریں۔ پھر GPIO0 کو Boot کے وقت GND سے جوڑ کر Flash Mode میں Upload کریں (صرف درست Pinout معلوم ہونے پر)۔
4. Upload کے بعد USB نکالیں، GPIO0-GND Short ہٹائیں، ESP-01 کو Programmer میں لگا رہنے دیں اور دوبارہ USB Power دیں۔
5. موبائل کو `SmartSwitch-Setup` سے Connect کریں، Password `12345678`؛ Chrome میں `http://192.168.4.1` کھولیں۔
6. Home Wi-Fi Scan کرکے 2.4GHz Wi-Fi Password Save کریں۔
7. Cloud Setup میں صرف Render Host لکھیں (`YOUR-SERVICE.onrender.com`، **https:// کے بغیر**)، Device ID اور Key Paste کریں۔ Save Cloud Connection۔
8. Render Dashboard Refresh کریں؛ تقریباً 15–90 سیکنڈ میں Device Online دکھنا چاہیے، بشرطیکہ Internet، Time Sync اور TLS Certificate Verification کامیاب ہو۔
9. پہلے **بغیر Relay، بغیر 220V** صرف Dashboard اور Serial Monitor سے Test کریں۔

## فائلیں
- `server/index.js` — Render API, OTP, Authentication, Devices, Schedules
- `server/public/index.html` — Online Mobile Dashboard
- `server/package.json` — Dependencies
- `server/.env.example` — Required Settings
- `render.yaml` — Render Blueprint
- `firmware/SmartSwitch_ESP01_Cloud/SmartSwitch_ESP01_Cloud.ino` — ESP-01 Firmware
- `firmware/SmartSwitch_ESP01_Cloud/Dashboard.h` — Local Offline Dashboard
- `firmware/SmartSwitch_ESP01_Cloud/CloudCerts.h` — TLS Root Certificates

## Important Troubleshooting
- `Dashboard.h not found`: تینوں Arduino Files ایک ہی Folder میں رکھیں، `.ino` اسی Folder کے نام کی ہو۔
- `Loading/Connecting`: Android captive sign-in کے بجائے Chrome میں `http://192.168.4.1` کھولیں۔
- GPIO0-GND Short کے ساتھ Upload کے بعد Wi-Fi نہ آئے: USB نکالیں، Short ہٹائیں، Normal Boot کے لیے دوبارہ Power دیں۔
- Cloud Offline: Wi-Fi Connected ہے؟ `cloudHost` میں URL Scheme/Slash تو نہیں؟ Device ID/Key صحیح؟ NTP Time Sync ہوا؟ Render `/health` چل رہا ہے؟ Certificate Trust Chain صحیح؟
- Device ON/OFF Relay سے Test کرنے سے پہلے low-voltage isolated driver circuit کا electrical review ضروری ہے۔

## Validation status
- Node.js `node --check` سے Backend Syntax چیک کیا گیا ہے۔
- HTML/JS اور Project Structure کی Static Checks کی گئی ہیں۔
- اس ماحول میں Arduino ESP8266 Toolchain اور Running Render/Postgres/SMTP نہیں تھے؛ Firmware کی مکمل Compilation اور End-to-End Hardware/Cloud Tests **نہیں کیے گئے**۔ اسے Production-Ready نہ سمجھیں۔
