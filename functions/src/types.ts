export type Platform = "instagram" | "tiktok" | "x";

export type PostStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "PROCESSING"
  | "PUBLISHED"
  | "FAILED_RETRY"
  | "FAILED_PERMANENT"
  | "CANCELED";

export type TargetStatus =
  | "PENDING"
  | "PROCESSING"
  | "PUBLISHED"
  | "FAILED_RETRY"
  | "FAILED_PERMANENT";

export type MediaStatus = "UPLOADING" | "VALIDATED" | "REJECTED" | "ATTACHED" | "PURGED";

export type AccountStatus =
  | "PENDING_OAUTH"
  | "ACTIVE"
  | "REFRESHING"
  | "EXPIRED"
  | "REVOKED";

export type NotificationEventType =
  | "POST_PUBLISHED"
  | "POST_FAILED_PERMANENT"
  | "ACCOUNT_TOKEN_EXPIRED"
  | "MEDIA_PURGED";

export interface SessionDoc {
  userId: string;
  createdAt: FirebaseFirestore.Timestamp;
  expiresAt: FirebaseFirestore.Timestamp;
  revokedAt?: FirebaseFirestore.Timestamp;
}

export interface UserDoc {
  email?: string;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

export interface AccountDoc {
  userId: string;
  platform: Platform;
  status: AccountStatus;
  encryptedAccessToken?: string;
  encryptedRefreshToken?: string;
  externalAccountId?: string;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

export interface OAuthStateDoc {
  userId: string;
  platform: Platform;
  accountId: string;
  codeVerifier?: string;
  expiresAt: FirebaseFirestore.Timestamp;
  createdAt: FirebaseFirestore.Timestamp;
}

export interface PostTarget {
  accountId: string;
  platform: Platform;
  status: TargetStatus;
  externalPostUrl?: string;
  error?: string;
}

export interface PostDoc {
  userId: string;
  status: PostStatus;
  text: string;
  mediaIds: string[];
  targets: PostTarget[];
  scheduledAt?: FirebaseFirestore.Timestamp;
  processingStartedAt?: FirebaseFirestore.Timestamp;
  retryCount: number;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

export interface MediaDoc {
  userId: string;
  postId?: string;
  status: MediaStatus;
  storagePath: string;
  mime: string;
  size: number;
  checksum: string;
  filename: string;
  width?: number;
  height?: number;
  durationSec?: number;
  createdAt: FirebaseFirestore.Timestamp;
}

export interface NotificationDoc {
  userId: string;
  eventType: NotificationEventType;
  payload: Record<string, unknown>;
  read: boolean;
  createdAt: FirebaseFirestore.Timestamp;
}

export interface LockDoc {
  holder: string;
  expiresAt: FirebaseFirestore.Timestamp;
}

export interface TempMediaTokenPayload {
  mediaId: string;
  userId: string;
  exp: number;
}
