# School staff face kiosk

On-device **staff attendance kiosk** for a school tablet at the gate. A teacher stands in front of the camera. The tablet checks that the face is live, matches it against **faces stored only on this device**, then records **check-in or check-out**, **time**, and optional **GPS**.

This is a **React web kiosk** (Next.js + TypeScript). It is not Flutter and not React Native. Open it in Chrome on an Android tablet. If this does not fit later, we can rebuild in Flutter.

## What it does

- **Gate:** live camera, anti-spoof (one face, lighting, motion, random blink / turn-head), 1:N match against local embeddings.
- **Office (PIN):** today’s roster, per-teacher history, enroll faces, manual corrections, CSV export, school hours.
- **No paid face APIs.** Models ship in `public/models/face-api` and run in the browser with TensorFlow.js.

Anti-spoofing blocks common print/screen tricks. It cannot guarantee that a determined attacker with a high-quality video or mask will always fail.

## Tools

| Tool | Role |
|---|---|
| TypeScript + React 19 | App language and UI |
| Next.js 16 | Web app and dev server |
| Tailwind CSS + shadcn/ui | Layout and controls |
| Dexie (IndexedDB) | Local teachers, embeddings, sessions |
| `@vladmandic/face-api` + TensorFlow.js | Detect, landmarks, face vectors |
| Media is the tablet camera | No gallery upload |

Default office PIN: **1234** (change it in Settings).

## How to register a teacher

This app has **no email/password signup**. Registration is on this tablet only.

1. Run `npm install` and `npm run dev`.
2. Open [http://127.0.0.1:43123](http://127.0.0.1:43123) in Chrome.
3. Click **Register staff** (or go to [http://127.0.0.1:43123/office](http://127.0.0.1:43123/office)).
4. Unlock with PIN **1234**.
5. On **Staff**, type full name and employee ID, click **Register**.
6. Click **Enroll face**. Allow the camera. Look into the oval and **blink three times**.
7. Face status becomes `enrolled`. Return to the gate to check in.

If Chrome asks for the camera, choose **Allow**. Use the same browser profile later or enrollments disappear.

## Run locally

Needs Node.js 20+.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123). Allow the camera.

1. Open **Office**, PIN `1234`.
2. **Staff** → add a teacher → **Enroll face** (3 live blink samples).
3. Widen check-in/out hours in **Settings** if you are testing outside 06:30–10:00 / 12:00–18:00.
4. Return to the **gate** and stand in the oval.

Data stays in this browser profile. Clearing site data wipes enrollments.

## Production kiosk tips

- Use Chrome in fullscreen / kiosk mode on a school-owned tablet.
- Turn on **Require GPS** in Settings when the device has a clear location fix.
- Enroll staff in the same room lighting as the gate.
- Tighten check-in windows to your school day.
- Keep the tablet supervised; office PIN is the only report lock in v1.
