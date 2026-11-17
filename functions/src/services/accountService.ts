import { config } from "../config";
import { encrypt, randomToken } from "../lib/crypto";
import { BadRequestError, NotFoundError } from "../lib/errors";
import { db, FieldValue, Timestamp } from "../lib/firebase";
import { assertAccountTransition } from "../state/accountTransitions";
import type { AccountDoc, OAuthStateDoc, Platform } from "../types";

const PLATFORMS = new Set<Platform>(["instagram", "tiktok", "x"]);

export function parsePlatform(raw: string): Platform {
  if (!PLATFORMS.has(raw as Platform)) {
    throw new BadRequestError(`Unsupported platform: ${raw}`);
  }
  return raw as Platform;
}

export async function initiateOAuth(
  platform: Platform,
  userId: string,
): Promise<{ accountId: string; state: string; authorizationUrl: string }> {
  const accountRef = db.collection("accounts").doc();
  const now = Timestamp.now();
  const account: AccountDoc = {
    userId,
    platform,
    status: "PENDING_OAUTH",
    createdAt: now,
    updatedAt: now,
  };
  await accountRef.set(account);

  const state = randomToken(24);
  const codeVerifier = randomToken(32);
  const oauth: OAuthStateDoc = {
    userId,
    platform,
    accountId: accountRef.id,
    codeVerifier,
    expiresAt: Timestamp.fromMillis(now.toMillis() + config.oauthStateTtlMs),
    createdAt: now,
  };
  await db.collection("oauthStates").doc(state).set(oauth);

  // Placeholder URL until real adapters land.
  const authorizationUrl =
    `https://example.invalid/oauth/${platform}/authorize` +
    `?state=${encodeURIComponent(state)}&client_id=placeholder`;

  return { accountId: accountRef.id, state, authorizationUrl };
}

export async function handleOAuthCallback(
  platform: Platform,
  code: string,
  state: string,
): Promise<{ accountId: string }> {
  if (!code) throw new BadRequestError("Missing code");
  const stateRef = db.collection("oauthStates").doc(state);
  const stateSnap = await stateRef.get();
  if (!stateSnap.exists) throw new BadRequestError("Invalid OAuth state");
  const oauth = stateSnap.data() as OAuthStateDoc;
  if (oauth.platform !== platform) throw new BadRequestError("Platform mismatch");
  if (oauth.expiresAt.toMillis() <= Date.now()) {
    throw new BadRequestError("OAuth state expired");
  }

  const accountRef = db.collection("accounts").doc(oauth.accountId);
  const accountSnap = await accountRef.get();
  if (!accountSnap.exists) throw new NotFoundError("Account not found");
  const account = accountSnap.data() as AccountDoc;
  assertAccountTransition(account.status, "ACTIVE");

  // Skeleton: no real token exchange — store encrypted placeholders.
  await accountRef.update({
    status: "ACTIVE",
    encryptedAccessToken: encrypt(`placeholder-access:${code}`),
    encryptedRefreshToken: encrypt(`placeholder-refresh:${oauth.codeVerifier ?? ""}`),
    externalAccountId: `stub_${platform}_${oauth.accountId.slice(0, 8)}`,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await stateRef.delete();

  return { accountId: oauth.accountId };
}

export async function getAccount(accountId: string): Promise<AccountDoc & { id: string }> {
  const snap = await db.collection("accounts").doc(accountId).get();
  if (!snap.exists) throw new NotFoundError("Account not found");
  return { id: snap.id, ...(snap.data() as AccountDoc) };
}

export async function acquireAccountLock(
  accountId: string,
  holder: string,
): Promise<boolean> {
  const ref = db.collection("locks").doc(accountId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    if (snap.exists) {
      const data = snap.data() as { holder: string; expiresAt: FirebaseFirestore.Timestamp };
      if (data.expiresAt.toMillis() > now && data.holder !== holder) {
        return false;
      }
    }
    tx.set(ref, {
      holder,
      expiresAt: Timestamp.fromMillis(now + config.lockTtlMs),
    });
    return true;
  });
}

export async function releaseAccountLock(accountId: string, holder: string): Promise<void> {
  const ref = db.collection("locks").doc(accountId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() as { holder: string };
    if (data.holder === holder) tx.delete(ref);
  });
}
