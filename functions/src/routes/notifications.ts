import { Router } from "express";
import { AppError } from "../lib/errors";
import { requireSession, type AuthedRequest } from "../middleware/auth";
import { listNotifications } from "../services/notificationService";

export const notificationsRouter = Router();

notificationsRouter.get("/", requireSession, async (req: AuthedRequest, res) => {
  try {
    const unreadOnly = req.query.unread === "true";
    const items = await listNotifications(req.userId!, { unreadOnly });
    res.json({
      items: items.map((n) => ({
        id: n.id,
        eventType: n.eventType,
        payload: n.payload,
        read: n.read,
        createdAt: n.createdAt?.toDate?.()?.toISOString?.() ?? n.createdAt,
      })),
    });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "INTERNAL", message: "List notifications failed" });
  }
});
