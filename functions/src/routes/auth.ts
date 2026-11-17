import { Router } from "express";
import { auth as adminAuth } from "../lib/firebase";
import { AppError } from "../lib/errors";
import { requireFirebaseUser, requireSession, type AuthedRequest } from "../middleware/auth";
import { createSession, revokeSession } from "../services/sessionService";

export const authRouter = Router();

authRouter.post("/session", requireFirebaseUser, async (req: AuthedRequest, res) => {
  try {
    const uid = req.firebaseUid!;
    const user = await adminAuth.getUser(uid);
    const { sessionId, expiresAt } = await createSession(uid, user.email);
    res.cookie("session", sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      expires: expiresAt,
    });
    res.status(201).json({ sessionId, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "INTERNAL", message: "Failed to create session" });
  }
});

authRouter.delete("/session", requireSession, async (req: AuthedRequest, res) => {
  try {
    await revokeSession(req.sessionId!);
    res.clearCookie("session");
    res.status(204).send();
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "INTERNAL", message: "Failed to revoke session" });
  }
});
