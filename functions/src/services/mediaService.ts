import { createHmac, timingSafeEqual } from "crypto";
import { config } from "../config";
import { randomToken, sha256 } from "../lib/crypto";
import { BadRequestError, NotFoundError } from "../lib/errors";
import { db, FieldValue, storage, Timestamp } from "../lib/firebase";
import { assertMediaTransition } from "../state/mediaTransitions";
import type { MediaDoc, TempMediaTokenPayload } from "../types";

function tokenSecret(): Buffer {
  return Buffer.from(config.tokenEncryptionKeyHex, "hex");
}

export function signTempMediaToken(mediaId: string, userId: string): string {
  const payload: TempMediaTokenPayload = {
    mediaId,
    userId,
    exp: Date.now() + config.tempMediaTokenTtlMs,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", tokenSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyTempMediaToken(token: string): TempMediaTokenPayload {
  const [body, sig] = token.split(".");
  if (!body || !sig) throw new BadRequestError("Invalid temp token");
  const expected = createHmac("sha256", tokenSecret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new BadRequestError("Invalid temp token signature");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TempMediaTokenPayload;
  if (payload.exp <= Date.now()) throw new BadRequestError("Temp token expired");
  return payload;
}

export async function ingestMedia(params: {
  userId: string;
  filename: string;
  mime: string;
  buffer: Buffer;
}): Promise<{ mediaId: string; status: string }> {
  const { userId, filename, mime, buffer } = params;
  if (!config.allowedMimeTypes.has(mime)) {
    throw new BadRequestError(`Unsupported MIME type: ${mime}`);
  }
  if (buffer.length > config.mediaMaxBytes) {
    throw new BadRequestError(`File exceeds max size of ${config.mediaMaxBytes} bytes`);
  }
  if (buffer.length === 0) throw new BadRequestError("Empty file");

  const mediaId = randomToken(16);
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_") || "upload.bin";
  const storagePath = `media/${userId}/${mediaId}/${safeName}`;
  const checksum = sha256(buffer);

  const ref = db.collection("media").doc(mediaId);
  const now = Timestamp.now();
  const uploading: MediaDoc = {
    userId,
    status: "UPLOADING",
    storagePath,
    mime,
    size: buffer.length,
    checksum,
    filename: safeName,
    createdAt: now,
  };
  await ref.set(uploading);

  try {
    await storage.bucket().file(storagePath).save(buffer, {
      contentType: mime,
      metadata: { metadata: { userId, mediaId, checksum } },
    });
    assertMediaTransition("UPLOADING", "VALIDATED");
    await ref.update({ status: "VALIDATED", updatedAt: FieldValue.serverTimestamp() });
    return { mediaId, status: "VALIDATED" };
  } catch (err) {
    assertMediaTransition("UPLOADING", "REJECTED");
    await ref.update({
      status: "REJECTED",
      updatedAt: FieldValue.serverTimestamp(),
    });
    throw err;
  }
}

export async function getMedia(mediaId: string): Promise<MediaDoc & { id: string }> {
  const snap = await db.collection("media").doc(mediaId).get();
  if (!snap.exists) throw new NotFoundError("Media not found");
  return { id: snap.id, ...(snap.data() as MediaDoc) };
}

export async function attachMediaToPost(mediaIds: string[], postId: string, userId: string): Promise<void> {
  for (const mediaId of mediaIds) {
    const media = await getMedia(mediaId);
    if (media.userId !== userId) throw new BadRequestError("Media ownership mismatch");
    if (media.status !== "VALIDATED" && media.status !== "ATTACHED") {
      throw new BadRequestError(`Media ${mediaId} not attachable (status=${media.status})`);
    }
    if (media.status === "VALIDATED") {
      assertMediaTransition("VALIDATED", "ATTACHED");
    }
    await db.collection("media").doc(mediaId).update({
      status: "ATTACHED",
      postId,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

export async function purgeMediaFiles(postId: string, userId: string): Promise<void> {
  const snap = await db.collection("media").where("postId", "==", postId).get();
  for (const doc of snap.docs) {
    const media = doc.data() as MediaDoc;
    if (media.userId !== userId) continue;
    if (media.status === "PURGED") continue;
    try {
      await storage.bucket().file(media.storagePath).delete({ ignoreNotFound: true });
    } catch {
      // ponytail: ignore storage delete races; mark purged anyway
    }
    assertMediaTransition(media.status, "PURGED");
    await doc.ref.update({ status: "PURGED", updatedAt: FieldValue.serverTimestamp() });
  }
}

export async function openMediaReadStream(mediaId: string): Promise<{
  stream: NodeJS.ReadableStream;
  mime: string;
  size: number;
}> {
  const media = await getMedia(mediaId);
  if (media.status === "PURGED" || media.status === "REJECTED") {
    throw new NotFoundError("Media unavailable");
  }
  const file = storage.bucket().file(media.storagePath);
  return { stream: file.createReadStream(), mime: media.mime, size: media.size };
}
