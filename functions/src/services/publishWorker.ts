import { randomToken, decrypt } from "../lib/crypto";
import { config } from "../config";
import { getAdapter } from "../adapters/stubAdapter";
import { PublishError } from "../adapters/types";
import { db, FieldValue, Timestamp } from "../lib/firebase";
import { assertPostTransition } from "../state/postTransitions";
import type { MediaDoc, PostDoc, PostTarget, TargetStatus } from "../types";
import {
  acquireAccountLock,
  getAccount,
  releaseAccountLock,
} from "./accountService";
import { getMedia, purgeMediaFiles } from "./mediaService";
import { emitNotification } from "./notificationService";

async function claimDuePost(postId: string): Promise<(PostDoc & { id: string }) | null> {
  const ref = db.collection("posts").doc(postId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const post = snap.data() as PostDoc;
    if (post.status !== "SCHEDULED" && post.status !== "FAILED_RETRY") return null;
    if (post.status === "SCHEDULED") {
      if (!post.scheduledAt || post.scheduledAt.toMillis() > Date.now()) return null;
      assertPostTransition("SCHEDULED", "PROCESSING");
    } else {
      assertPostTransition("FAILED_RETRY", "PROCESSING");
    }
    tx.update(ref, {
      status: "PROCESSING",
      processingStartedAt: Timestamp.now(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { id: snap.id, ...post, status: "PROCESSING" as const };
  });
}

async function publishTarget(
  post: PostDoc & { id: string },
  target: PostTarget,
  media: MediaDoc[],
  holder: string,
): Promise<PostTarget> {
  const locked = await acquireAccountLock(target.accountId, holder);
  if (!locked) {
    return {
      ...target,
      status: "FAILED_RETRY",
      error: "Could not acquire account lock",
    };
  }
  try {
    const account = await getAccount(target.accountId);
    if (account.status !== "ACTIVE") {
      return {
        ...target,
        status: "FAILED_PERMANENT",
        error: `Account status ${account.status}`,
      };
    }
    const accessToken = account.encryptedAccessToken
      ? decrypt(account.encryptedAccessToken)
      : "";
    const refreshToken = account.encryptedRefreshToken
      ? decrypt(account.encryptedRefreshToken)
      : undefined;
    const adapter = getAdapter(target.platform);
    const result = await adapter.publish(post, target, media, {
      accessToken,
      refreshToken,
    });
    return {
      ...target,
      status: "PUBLISHED",
      externalPostUrl: result.externalPostUrl,
      error: undefined,
    };
  } catch (err) {
    if (err instanceof PublishError) {
      const status: TargetStatus =
        err.kind === "transient" ? "FAILED_RETRY" : "FAILED_PERMANENT";
      return { ...target, status, error: `${err.code}: ${err.message}` };
    }
    return {
      ...target,
      status: "FAILED_RETRY",
      error: err instanceof Error ? err.message : "Unknown error",
    };
  } finally {
    await releaseAccountLock(target.accountId, holder);
  }
}

function aggregateStatus(
  targets: PostTarget[],
  retryCount: number,
): "PUBLISHED" | "FAILED_RETRY" | "FAILED_PERMANENT" {
  if (targets.every((t) => t.status === "PUBLISHED")) return "PUBLISHED";
  if (targets.some((t) => t.status === "FAILED_RETRY")) {
    return retryCount + 1 < config.maxPublishRetries ? "FAILED_RETRY" : "FAILED_PERMANENT";
  }
  return "FAILED_PERMANENT";
}

async function finalizePost(postId: string, targets: PostTarget[], prev: PostDoc): Promise<void> {
  const next = aggregateStatus(targets, prev.retryCount);
  assertPostTransition("PROCESSING", next);
  const retryCount = next === "FAILED_RETRY" ? prev.retryCount + 1 : prev.retryCount;
  const updates: Record<string, unknown> = {
    status: next,
    targets,
    retryCount,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (next === "FAILED_RETRY") {
    // Re-queue shortly via scheduledAt in the past-ish → next poll picks FAILED_RETRY via reconcile or explicit schedule
    updates.scheduledAt = Timestamp.fromMillis(Date.now() + 60_000);
  }
  await db.collection("posts").doc(postId).update(updates);

  if (next === "PUBLISHED") {
    await emitNotification(prev.userId, "POST_PUBLISHED", { postId, targets });
  }
  if (next === "FAILED_PERMANENT") {
    await emitNotification(prev.userId, "POST_FAILED_PERMANENT", { postId, targets });
  }
  if (next === "PUBLISHED" || next === "FAILED_PERMANENT") {
    await purgeMediaFiles(postId, prev.userId);
    await emitNotification(prev.userId, "MEDIA_PURGED", { postId, reason: next });
  }
}

export async function processPost(postId: string): Promise<void> {
  const claimed = await claimDuePost(postId);
  if (!claimed) return;

  const media: MediaDoc[] = [];
  for (const mediaId of claimed.mediaIds) {
    media.push(await getMedia(mediaId));
  }

  const holder = `worker:${randomToken(8)}`;
  const targets: PostTarget[] = [];
  for (const target of claimed.targets) {
    if (target.status === "PUBLISHED") {
      targets.push(target);
      continue;
    }
    targets.push(await publishTarget(claimed, { ...target, status: "PROCESSING" }, media, holder));
  }
  await finalizePost(postId, targets, claimed);
}

export async function publishDuePosts(): Promise<{ processed: number }> {
  const now = Timestamp.now();
  const due = await db
    .collection("posts")
    .where("status", "==", "SCHEDULED")
    .where("scheduledAt", "<=", now)
    .limit(25)
    .get();

  const retryDue = await db
    .collection("posts")
    .where("status", "==", "FAILED_RETRY")
    .where("scheduledAt", "<=", now)
    .limit(25)
    .get();

  const ids = new Set([...due.docs, ...retryDue.docs].map((d) => d.id));
  let processed = 0;
  for (const id of ids) {
    await processPost(id);
    processed += 1;
  }
  return { processed };
}

export async function reconcileMissedJobs(): Promise<{ requeued: number }> {
  const cutoff = Timestamp.fromMillis(Date.now() - config.processingTimeoutMs);
  const stuck = await db
    .collection("posts")
    .where("status", "==", "PROCESSING")
    .where("processingStartedAt", "<=", cutoff)
    .limit(25)
    .get();

  let requeued = 0;
  for (const doc of stuck.docs) {
    const post = doc.data() as PostDoc;
    const next =
      post.retryCount + 1 < config.maxPublishRetries ? "FAILED_RETRY" : "FAILED_PERMANENT";
    try {
      assertPostTransition("PROCESSING", next);
    } catch {
      continue;
    }
    await doc.ref.update({
      status: next,
      retryCount: post.retryCount + 1,
      scheduledAt: Timestamp.fromMillis(Date.now() + 30_000),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (next === "FAILED_PERMANENT") {
      await emitNotification(post.userId, "POST_FAILED_PERMANENT", {
        postId: doc.id,
        reason: "processing_timeout",
      });
    }
    requeued += 1;
  }
  return { requeued };
}
