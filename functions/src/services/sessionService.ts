import { config } from "../config";
import { randomToken } from "../lib/crypto";
import { UnauthorizedError } from "../lib/errors";
import { db, FieldValue, Timestamp } from "../lib/firebase";
import type { SessionDoc, UserDoc } from "../types";

const sessions = () => db.collection("sessions");
const users = () => db.collection("users");

export async function createSession(userId: string, email?: string): Promise<{
  sessionId: string;
  expiresAt: Date;
}> {
  const sessionId = randomToken(24);
  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(
    now.toMillis() + config.sessionTtlHours * 60 * 60 * 1000,
  );

  const session: SessionDoc = {
    userId,
    createdAt: now,
    expiresAt,
  };
  await sessions().doc(sessionId).set(session);

  const userRef = users().doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    const user: UserDoc = {
      email,
      createdAt: now,
      updatedAt: now,
    };
    await userRef.set(user);
  } else if (email) {
    await userRef.update({ email, updatedAt: FieldValue.serverTimestamp() });
  }

  return { sessionId, expiresAt: expiresAt.toDate() };
}

export async function validateSession(sessionId: string): Promise<{
  sessionId: string;
  userId: string;
}> {
  if (!sessionId) throw new UnauthorizedError("Missing session");
  const snap = await sessions().doc(sessionId).get();
  if (!snap.exists) throw new UnauthorizedError("Invalid session");
  const data = snap.data() as SessionDoc;
  if (data.revokedAt) throw new UnauthorizedError("Session revoked");
  if (data.expiresAt.toMillis() <= Date.now()) {
    throw new UnauthorizedError("Session expired");
  }
  return { sessionId, userId: data.userId };
}

export async function revokeSession(sessionId: string): Promise<void> {
  const ref = sessions().doc(sessionId);
  const snap = await ref.get();
  if (!snap.exists) return;
  await ref.update({ revokedAt: FieldValue.serverTimestamp() });
}
