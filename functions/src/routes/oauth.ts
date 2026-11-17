import { Router } from "express";
import { AppError } from "../lib/errors";
import { requireSession, type AuthedRequest } from "../middleware/auth";
import {
  handleOAuthCallback,
  initiateOAuth,
  parsePlatform,
} from "../services/accountService";

export const oauthRouter = Router();

oauthRouter.get("/:platform/connect", requireSession, async (req: AuthedRequest, res) => {
  try {
    const platform = parsePlatform(req.params.platform);
    const result = await initiateOAuth(platform, req.userId!);
    res.json(result);
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "INTERNAL", message: "OAuth connect failed" });
  }
});

// Callback is typically hit by the provider browser redirect — accepts state/code without session cookie.
oauthRouter.get("/:platform/callback", async (req, res) => {
  try {
    const platform = parsePlatform(req.params.platform);
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");
    const result = await handleOAuthCallback(platform, code, state);
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "INTERNAL", message: "OAuth callback failed" });
  }
});
