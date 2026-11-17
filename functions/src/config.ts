function requireTokenKey(): string {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be set to 64 hex chars (32 bytes). See functions/.env.example",
    );
  }
  return hex;
}

export const config = {
  get tokenEncryptionKeyHex() {
    return requireTokenKey();
  },
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 168),
  processingTimeoutMs: Number(process.env.PROCESSING_TIMEOUT_MS ?? 15 * 60 * 1000),
  maxPublishRetries: Number(process.env.MAX_PUBLISH_RETRIES ?? 3),
  mediaMaxBytes: Number(process.env.MEDIA_MAX_BYTES ?? 100 * 1024 * 1024),
  oauthStateTtlMs: 10 * 60 * 1000,
  lockTtlMs: 5 * 60 * 1000,
  tempMediaTokenTtlMs: 60 * 60 * 1000,
  allowedMimeTypes: new Set([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "video/mp4",
    "video/quicktime",
    "video/webm",
  ]),
} as const;
