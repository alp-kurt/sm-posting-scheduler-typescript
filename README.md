# SM Posting Scheduler (Firebase backend)

Headless Node.js + TypeScript backend on Firebase Functions. Firestore for sessions/data, Storage for media, Cloud Scheduler poller for due posts. Platform adapters are stubs in this step.

## Setup

```bash
# root + functions
cp .env.example .env                 # deploy secrets for local firebase-tools (optional)
cp functions/.env.example functions/.env
# set TOKEN_ENCRYPTION_KEY (64 hex chars):
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm install
npm install --prefix functions
npm run check                        # lint + unit tests + build
```

Point `.firebaserc` at your Firebase project, then:

```bash
npm run serve
# or: firebase emulators:start --only auth,functions,firestore,storage
```

HTTP API (emulator): `http://127.0.0.1:5001/<project-id>/us-central1/api`

### Scripts

| Command | Where | What |
| :--- | :--- | :--- |
| `npm run lint` | root / functions | ESLint (security rules) + `tsc --noEmit` |
| `npm run test` | root / functions | Build + `node --test` unit tests |
| `npm run predeploy` / `check` | root / functions | lint → test (blocks Firebase deploy) |
| `npm run deploy` | root | predeploy + `firebase deploy --only hosting,functions` |

### GitHub Actions secrets

Set in **Settings → Secrets and variables → Actions** (see `.env.example`):

| Secret | Purpose |
| :--- | :--- |
| `TOKEN_ENCRYPTION_KEY` | Functions AES-256-GCM key (64 hex chars) |
| `FIREBASE_SERVICE_ACCOUNT` | GCP service account JSON for deploy |
| `FIREBASE_PROJECT_ID` | Optional override (default `sm-posting-scheduler`) |

Optional **Variables**: `SESSION_TTL_HOURS`, `PROCESSING_TIMEOUT_MS`, `MAX_PUBLISH_RETRIES`, `MEDIA_MAX_BYTES`.

## Auth

Protected routes need:

1. `Authorization: Bearer <Firebase ID token>`
2. Session via `Cookie: session=<id>` or `X-Session-Id: <id>`

Create a session: `POST /auth/session` with the Bearer token only.

## Smoke path (emulator)

1. Create a Firebase Auth user in the Auth emulator; get an ID token.
2. `POST /auth/session` → save `sessionId`.
3. `GET /oauth/x/connect` → follow with `GET /oauth/x/callback?code=test&state=<state>` to activate a stub account.
4. `POST /media` multipart file upload → `mediaId`.
5. `POST /posts` with `{ "text": "hi", "mediaIds": ["…"], "accountIds": ["…"], "scheduledAt": "<ISO soon>" }`.
6. Trigger the scheduler once (`publishDuePostsJob` in functions shell, or wait a minute).
7. `GET /posts/:id` → expect `FAILED_PERMANENT` (`NOT_IMPLEMENTED` from stub adapter).
8. `GET /notifications` → `POST_FAILED_PERMANENT` (+ `MEDIA_PURGED`).

## Tests & lint

```bash
npm run lint
npm test
npm run check   # both, same as Firebase predeploy
```

## Out of scope (later)

Real Instagram / TikTok / X OAuth + publish, UI/Hosting, ffprobe constraints, outbound notification channels.
