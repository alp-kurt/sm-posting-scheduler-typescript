import { BadRequestError, ConflictError, NotFoundError } from "../lib/errors";
import { db, FieldValue, Timestamp } from "../lib/firebase";
import { assertPostTransition, canMutatePost } from "../state/postTransitions";
import type { AccountDoc, Platform, PostDoc, PostStatus, PostTarget } from "../types";
import { attachMediaToPost, getMedia, purgeMediaFiles } from "./mediaService";
import { emitNotification } from "./notificationService";

function posts() {
  return db.collection("posts");
}

async function loadOwnedPost(postId: string, userId: string): Promise<PostDoc & { id: string }> {
  const snap = await posts().doc(postId).get();
  if (!snap.exists) throw new NotFoundError("Post not found");
  const data = snap.data() as PostDoc;
  if (data.userId !== userId) throw new NotFoundError("Post not found");
  return { id: snap.id, ...data };
}

async function resolveTargets(
  userId: string,
  accountIds: string[],
): Promise<PostTarget[]> {
  if (!accountIds.length) throw new BadRequestError("At least one account target required");
  const targets: PostTarget[] = [];
  for (const accountId of accountIds) {
    const snap = await db.collection("accounts").doc(accountId).get();
    if (!snap.exists) throw new BadRequestError(`Unknown account ${accountId}`);
    const account = snap.data() as AccountDoc;
    if (account.userId !== userId) throw new BadRequestError(`Unknown account ${accountId}`);
    if (account.status !== "ACTIVE") {
      throw new BadRequestError(`Account ${accountId} is not ACTIVE`);
    }
    targets.push({
      accountId,
      platform: account.platform as Platform,
      status: "PENDING",
    });
  }
  return targets;
}

export async function createPost(params: {
  userId: string;
  text: string;
  mediaIds: string[];
  accountIds: string[];
  scheduledAt?: Date;
}): Promise<{ id: string } & PostDoc> {
  const { userId, text, mediaIds, accountIds, scheduledAt } = params;
  if (!text?.trim() && mediaIds.length === 0) {
    throw new BadRequestError("Post requires text or media");
  }
  for (const mediaId of mediaIds) {
    const media = await getMedia(mediaId);
    if (media.userId !== userId) throw new BadRequestError("Media ownership mismatch");
    if (media.status !== "VALIDATED") {
      throw new BadRequestError(`Media ${mediaId} must be VALIDATED`);
    }
  }

  const targets = await resolveTargets(userId, accountIds);
  const now = Timestamp.now();
  const status: PostStatus = scheduledAt ? "SCHEDULED" : "DRAFT";
  if (scheduledAt && scheduledAt.getTime() <= Date.now()) {
    throw new BadRequestError("scheduledAt must be in the future");
  }

  const ref = posts().doc();
  const doc: PostDoc = {
    userId,
    status,
    text: text ?? "",
    mediaIds,
    targets,
    scheduledAt: scheduledAt ? Timestamp.fromDate(scheduledAt) : undefined,
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(doc);
  if (mediaIds.length) await attachMediaToPost(mediaIds, ref.id, userId);
  return { id: ref.id, ...doc };
}

export async function getPost(postId: string, userId: string) {
  return loadOwnedPost(postId, userId);
}

export async function updatePost(
  postId: string,
  userId: string,
  patch: { text?: string; mediaIds?: string[]; accountIds?: string[]; scheduledAt?: Date | null },
): Promise<{ id: string } & PostDoc> {
  const post = await loadOwnedPost(postId, userId);
  if (!canMutatePost(post.status)) {
    throw new ConflictError(`Cannot edit post in status ${post.status}`);
  }

  const updates: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (patch.text !== undefined) updates.text = patch.text;
  if (patch.mediaIds !== undefined) {
    for (const mediaId of patch.mediaIds) {
      const media = await getMedia(mediaId);
      if (media.userId !== userId) throw new BadRequestError("Media ownership mismatch");
    }
    updates.mediaIds = patch.mediaIds;
    await attachMediaToPost(patch.mediaIds, postId, userId);
  }
  if (patch.accountIds !== undefined) {
    updates.targets = await resolveTargets(userId, patch.accountIds);
  }
  if (patch.scheduledAt !== undefined) {
    if (patch.scheduledAt === null) {
      updates.scheduledAt = FieldValue.delete();
      if (post.status === "SCHEDULED") {
        assertPostTransition("SCHEDULED", "DRAFT");
        updates.status = "DRAFT";
      }
    } else {
      if (patch.scheduledAt.getTime() <= Date.now()) {
        throw new BadRequestError("scheduledAt must be in the future");
      }
      updates.scheduledAt = Timestamp.fromDate(patch.scheduledAt);
    }
  }

  await posts().doc(postId).update(updates);
  return loadOwnedPost(postId, userId);
}

export async function schedulePost(
  postId: string,
  userId: string,
  scheduledAt?: Date,
): Promise<{ id: string } & PostDoc> {
  const post = await loadOwnedPost(postId, userId);
  assertPostTransition(post.status, "SCHEDULED");
  if (!post.targets.length) throw new BadRequestError("Post needs targets");
  if (!post.text.trim() && post.mediaIds.length === 0) {
    throw new BadRequestError("Post requires text or media");
  }

  const when = scheduledAt ?? (post.scheduledAt ? post.scheduledAt.toDate() : undefined);
  if (!when || when.getTime() <= Date.now()) {
    throw new BadRequestError("scheduledAt must be in the future");
  }

  await posts().doc(postId).update({
    status: "SCHEDULED",
    scheduledAt: Timestamp.fromDate(when),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return loadOwnedPost(postId, userId);
}

export async function cancelPost(postId: string, userId: string): Promise<{ id: string } & PostDoc> {
  const post = await loadOwnedPost(postId, userId);
  assertPostTransition(post.status, "CANCELED");
  await posts().doc(postId).update({
    status: "CANCELED",
    updatedAt: FieldValue.serverTimestamp(),
  });
  await purgeMediaFiles(postId, userId);
  await emitNotification(userId, "MEDIA_PURGED", { postId, reason: "canceled" });
  return loadOwnedPost(postId, userId);
}

export async function retryPermanentFailure(
  postId: string,
  userId: string,
  scheduledAt: Date,
): Promise<{ id: string } & PostDoc> {
  const post = await loadOwnedPost(postId, userId);
  assertPostTransition(post.status, "SCHEDULED");
  for (const mediaId of post.mediaIds) {
    const media = await getMedia(mediaId);
    if (media.status === "PURGED") {
      throw new ConflictError("Cannot retry: media has been purged");
    }
  }
  if (scheduledAt.getTime() <= Date.now()) {
    throw new BadRequestError("scheduledAt must be in the future");
  }
  const targets = post.targets.map((t) => ({
    ...t,
    status: "PENDING" as const,
    error: undefined,
    externalPostUrl: undefined,
  }));
  await posts().doc(postId).update({
    status: "SCHEDULED",
    scheduledAt: Timestamp.fromDate(scheduledAt),
    targets,
    retryCount: 0,
    processingStartedAt: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return loadOwnedPost(postId, userId);
}
