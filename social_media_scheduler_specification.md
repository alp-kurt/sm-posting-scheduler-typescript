# Headless Social Media Post Scheduler — Architecture & Core Specification

A server-side Node.js + TypeScript specification for scheduling and publishing content to **Instagram**, **TikTok**, and **X**. Designed without a UI layer, prioritizing strict state machines, server-side sessions, deterministic media cleanup, and reliable background queue processing.

---

## 1. Core Architectural Modules & Functions

### A. Server-Side Session & Auth Module
* **`createSession(userId)` / `validateSession(sessionId)` / `revokeSession(sessionId)`**: Server-side session store (Redis or PostgreSQL-backed) using `httpOnly` signed cookies or bearer tokens. Avoid stateless JWTs if you require immediate session revocation.
* **`initiateOAuth(platform, userId)`**: Generates a cryptographically random `state` token (plus `code_verifier` for PKCE on X and TikTok), persists it in the session store with a short TTL, and returns the provider's authorization URL.
* **`handleOAuthCallback(platform, code, state)`**: Validates `state` against the session, exchanges the authorization code for access/refresh tokens, fetches platform account metadata (e.g., Instagram Business Account ID via linked Facebook Page, TikTok `open_id`), and encrypts tokens at rest (`AES-256-GCM`).
* **`refreshPlatformToken(accountId)`**: Proactive background worker and just-in-time interceptor:
  * **X (OAuth 2.0)**: Access tokens expire every 2 hours; requires rotating `refresh_token`.
  * **TikTok**: Access tokens expire in 24 hours; refresh tokens last 365 days.
  * **Instagram (Graph API)**: Long-lived user tokens expire in 60 days; must be refreshed before expiration via `fb_exchange_token`.

### B. Media Storage & Lifecycle Manager
* **`ingestMediaStream(reqStream, metadata)`**: Streams multipart uploads directly to a local staging directory (`/var/app/media/{postId}/{uuid}`) to prevent memory spikes. Computes SHA-256 checksum, byte size, MIME type, duration, and resolution via `ffprobe`.
* **`validateMediaConstraints(platform, mediaMeta)`**: Enforces platform-specific gates *before* enqueuing:
  * **Instagram**: JPEG only for images ($4:5$ to $1.91:1$ aspect ratio); MP4 for Reels/Video (up to 15 min for Reels). *Crucial constraint*: Instagram's Graph API (`POST /{ig-user-id}/media`) pulls media via a public URL (`image_url` / `video_url`), meaning your server must expose a temporary signed route (e.g., `GET /media/temp/:token`) until Meta finishes downloading it.
  * **TikTok**: MP4/WebM video (up to 10 min, bounded by `max_video_post_duration_sec` from creator info) or up to 35 WebP/JPEG images via verified domain URL. Text-only posts are unsupported.
  * **X**: Up to 4 images (JPEG, PNG, GIF, WEBP, max 5 MB each) or 1 video (MP4/MOV, up to 20 min / 8 GB for standard accounts; 125 min / 16 GB for Premium).
* **`purgeMediaFiles(postId)`**: Idempotent cleanup function using `fs.rm(dir, { recursive: true, force: true })`. Triggered via two hooks:
  1. Immediately after all target platforms reach a terminal state (`PUBLISHED` or `FAILED_PERMANENT`).
  2. A sweep cron job that deletes orphaned directories older than 24 hours (covering abandoned drafts or crashed jobs).

### C. Platform Adapter Engine (Publishing Mechanics)
Each platform requires an isolated adapter implementing a unified `publish(post, mediaFiles, credentials)` interface:

* **Instagram Adapter**:
  1. `createMediaContainer()` $\rightarrow$ `POST /{ig-user-id}/media` (creates child containers first if `CAROUSEL`, then parent container).
  2. `pollContainerStatus()` $\rightarrow$ `GET /{container-id}?fields=status_code` until `FINISHED`.
  3. `publishContainer()` $\rightarrow$ `POST /{ig-user-id}/media_publish`.
* **TikTok Adapter**:
  1. `queryCreatorInfo()` $\rightarrow$ `POST /v2/post/publish/creator_info/query/` (mandatory pre-flight check for privacy levels and duration caps).
  2. `initAndUpload()` $\rightarrow$ `POST /v2/post/publish/video/init/` (`FILE_UPLOAD` chunked transfer or `PULL_FROM_URL`).
  3. `pollPublishStatus()` $\rightarrow$ `POST /v2/post/publish/status/fetch/` until `PUBLISH_COMPLETE`.
* **X Adapter**:
  1. `uploadMediaV2()` $\rightarrow$ Single-shot `POST /2/media/upload` for images, or chunked `POST /2/media/upload/initialize` $\rightarrow$ `/append` $\rightarrow$ `/finalize` + status polling for videos.
  2. `createPost()` $\rightarrow$ `POST /2/tweets` passing `text` and `media.media_ids` (chaining `reply.in_reply_to_tweet_id` if publishing a thread).

### D. Queue & Worker System (BullMQ + Redis)
* **`enqueueScheduledPost(postId, scheduledAt)`**: Adds a delayed job (`delay = scheduledAt - Date.now()`) with a deterministic `jobId` (`publish:${postId}:${platform}`) to prevent duplicate execution.
* **`processPublishJob(job)`**:
  * Acquires a distributed per-account lock (e.g., Redlock) so concurrent posts to the same account don't collide on rate limits or token refreshes.
  * Executes the platform adapter.
  * Classifies errors into **Transient** (`429 Too Many Requests`, `5xx`, network timeouts $\rightarrow$ exponential backoff retry up to 3 times) vs. **Permanent** (`401 Invalid Token`, `400 Policy/Format Violation` $\rightarrow$ fail immediately and notify).
* **`reconcileMissedJobs()`**: Startup recovery function that queries the database for posts stuck in `SCHEDULED` or `PROCESSING` whose `scheduledAt` has passed and re-queues them.

### E. Notification Dispatcher
* **`emitNotification(userId, eventType, payload)`**: Decoupled event emitter pushing to an internal `notifications` queue.
* **Channels**: Outbound signed webhooks (`POST` to user-configured URL with `X-Signature-256` HMAC header), transactional email (SMTP/Resend), or Server-Sent Events (`GET /api/notifications/stream`) for real-time headless monitoring.
* **Triggers**: `POST_PUBLISHED`, `POST_FAILED_PERMANENT`, `ACCOUNT_TOKEN_EXPIRED`, `MEDIA_PURGED`.

---

## 2. State Machines & HTTP Endpoints

Every resource must enforce strict transition guards in the service layer (rejecting illegal transitions with `409 Conflict`).

### Post Lifecycle State Machine

```text
[DRAFT] ──(schedule)──> [SCHEDULED] ──(worker picks up)──> [PROCESSING]
   │                         │                                  │
   └──(cancel)──> [CANCELED] <┘                       ┌─────────┴─────────┐
                                                      ▼                   ▼
                                                [PUBLISHED]         [FAILED_RETRY]
                                                                          │
                                                                 (max retries hit)
                                                                          ▼
                                                                 [FAILED_PERMANENT]
```

| State | Allowed Transitions | Trigger / Guard |
| :--- | :--- | :--- |
| `DRAFT` | `SCHEDULED`, `CANCELED` | Requires valid text/media payload and at least 1 connected platform target. |
| `SCHEDULED` | `PROCESSING`, `DRAFT`, `CANCELED` | Editing or canceling removes the delayed BullMQ job before reverting/canceling. |
| `PROCESSING` | `PUBLISHED`, `FAILED_RETRY`, `FAILED_PERMANENT` | Locked by worker; HTTP mutations (`PATCH`/`DELETE`) are blocked (`409`). |
| `FAILED_RETRY` | `PROCESSING`, `FAILED_PERMANENT` | Managed automatically by queue backoff timer. |
| `PUBLISHED` | *Terminal* | Triggers media deletion check. |
| `FAILED_PERMANENT` | `SCHEDULED` (manual retry) | Only allowed if local media files have not yet been purged. |
| `CANCELED` | *Terminal* | Triggers immediate media deletion. |

### Media File State Machine
`UPLOADING` $\rightarrow$ `VALIDATED` (or `REJECTED` $\rightarrow$ deleted) $\rightarrow$ `ATTACHED` $\rightarrow$ `PURGED`

### Connected Account State Machine
`PENDING_OAUTH` $\rightarrow$ `ACTIVE` $\leftrightarrow$ `REFRESHING` $\rightarrow$ `EXPIRED` (or `REVOKED`)

---

## 3. Core HTTP API Surface (Node.js / TypeScript)

| Method & Endpoint | State Transition / Action | Notes |
| :--- | :--- | :--- |
| `POST /api/auth/session` | `null` $\rightarrow$ `ACTIVE_SESSION` | Authenticates user, sets `httpOnly` session cookie. |
| `GET /api/oauth/:platform/connect` | `null` $\rightarrow$ `PENDING_OAUTH` | Returns provider OAuth URL + stores `state`/PKCE. |
| `GET /api/oauth/:platform/callback` | `PENDING_OAUTH` $\rightarrow$ `ACTIVE` | Exchanges code, stores encrypted tokens. |
| `POST /api/media` | `null` $\rightarrow$ `UPLOADING` $\rightarrow$ `VALIDATED` | Streams file to disk, runs `ffprobe`, returns `mediaId`. |
| `GET /api/media/temp/:signedToken` | Read-only stream | Temporary public endpoint for Meta/TikTok `PULL_FROM_URL`. |
| `POST /api/posts` | `null` $\rightarrow$ `DRAFT` (or `SCHEDULED`) | Validates platform constraints and attaches `mediaIds`. |
| `PATCH /api/posts/:id` | `DRAFT` $\rightarrow$ `DRAFT` or `SCHEDULED` $\rightarrow$ `SCHEDULED` | Fails with `409` if state is `PROCESSING` or terminal. |
| `POST /api/posts/:id/schedule` | `DRAFT` $\rightarrow$ `SCHEDULED` | Enqueues delayed BullMQ job. |
| `POST /api/posts/:id/cancel` | `SCHEDULED` $\rightarrow$ `CANCELED` | Removes BullMQ job and triggers `purgeMediaFiles()`. |
| `GET /api/posts/:id` | Read-only | Returns post state, per-platform job status, and external post URLs. |
| `GET /api/notifications` | Read-only | Lists persisted events; supports `?unread=true` or SSE stream. |

---

## 4. Recommended TypeScript Stack

* **Runtime & HTTP**: Node.js 22+ with **Fastify** (built-in schema validation via TypeBox/Zod and low-overhead streaming multipart via `@fastify/multipart`).
* **Database & ORM**: **PostgreSQL** + **Drizzle ORM** (ideal for strict enum state columns and transactional outbox patterns).
* **Queue & State Store**: **Redis** + **BullMQ** (native delayed jobs, exponential backoff, rate limiting, and atomic job removal).
* **Media Inspection**: `fluent-ffmpeg` / `ffprobe-static` for validating codecs, aspect ratios, and durations prior to scheduling.