import type { NextFunction, Request, Response } from "express";
import { auth } from "../lib/firebase";
import { AppError, UnauthorizedError } from "../lib/errors";
import { validateSession } from "../services/sessionService";

export interface AuthedRequest extends Request {
  userId?: string;
  sessionId?: string;
  firebaseUid?: string;
}

function bearer(req: Request): string | undefined {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return undefined;
  return h.slice(7).trim();
}

function sessionFromReq(req: Request): string | undefined {
  const cookie = (req as Request & { cookies?: Record<string, string> }).cookies?.session;
  if (cookie) return cookie;
  const header = req.headers["x-session-id"];
  return typeof header === "string" ? header : undefined;
}

/** Verify Firebase ID token only (for session create). */
export async function requireFirebaseUser(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = bearer(req);
    if (!token) throw new UnauthorizedError("Missing Bearer token");
    const decoded = await auth.verifyIdToken(token);
    req.firebaseUid = decoded.uid;
    req.userId = decoded.uid;
    next();
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    res.status(401).json({ error: "UNAUTHORIZED", message: "Invalid ID token" });
  }
}

/** Require Firebase ID token + valid server session. */
export async function requireSession(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = bearer(req);
    if (!token) throw new UnauthorizedError("Missing Bearer token");
    const decoded = await auth.verifyIdToken(token);
    const sessionId = sessionFromReq(req);
    if (!sessionId) throw new UnauthorizedError("Missing session");
    const session = await validateSession(sessionId);
    if (session.userId !== decoded.uid) {
      throw new UnauthorizedError("Session/user mismatch");
    }
    req.firebaseUid = decoded.uid;
    req.userId = session.userId;
    req.sessionId = session.sessionId;
    next();
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    res.status(401).json({ error: "UNAUTHORIZED", message: "Unauthorized" });
  }
}
