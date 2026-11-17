import { db, FieldValue } from "../lib/firebase";
import type { NotificationDoc, NotificationEventType } from "../types";

export async function emitNotification(
  userId: string,
  eventType: NotificationEventType,
  payload: Record<string, unknown>,
): Promise<string> {
  const ref = db.collection("notifications").doc();
  const doc: NotificationDoc = {
    userId,
    eventType,
    payload,
    read: false,
    createdAt: FieldValue.serverTimestamp() as FirebaseFirestore.Timestamp,
  };
  await ref.set(doc);
  return ref.id;
}

export async function listNotifications(
  userId: string,
  opts: { unreadOnly?: boolean; limit?: number } = {},
): Promise<Array<{ id: string } & NotificationDoc>> {
  let q = db
    .collection("notifications")
    .where("userId", "==", userId)
    .orderBy("createdAt", "desc")
    .limit(opts.limit ?? 50);

  if (opts.unreadOnly) {
    q = db
      .collection("notifications")
      .where("userId", "==", userId)
      .where("read", "==", false)
      .orderBy("createdAt", "desc")
      .limit(opts.limit ?? 50);
  }

  const snap = await q.get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as NotificationDoc) }));
}
