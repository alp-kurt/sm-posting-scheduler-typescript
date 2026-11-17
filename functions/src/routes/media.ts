import Busboy from "busboy";
import { Router } from "express";
import { AppError, BadRequestError } from "../lib/errors";
import { requireSession, type AuthedRequest } from "../middleware/auth";
import {
  ingestMedia,
  openMediaReadStream,
  signTempMediaToken,
  verifyTempMediaToken,
} from "../services/mediaService";

export const mediaRouter = Router();

mediaRouter.post("/", requireSession, (req: AuthedRequest, res) => {
  const bb = Busboy({ headers: req.headers, limits: { files: 1 } });
  let filename = "upload.bin";
  let mime = "application/octet-stream";
  const chunks: Buffer[] = [];
  let sawFile = false;

  bb.on("file", (_name, file, info) => {
    sawFile = true;
    filename = info.filename || "upload.bin";
    mime = info.mimeType || "application/octet-stream";
    file.on("data", (d: Buffer) => chunks.push(d));
  });

  bb.on("error", () => {
    res.status(400).json({ error: "BAD_REQUEST", message: "Multipart parse failed" });
  });

  bb.on("finish", async () => {
    try {
      if (!sawFile) throw new BadRequestError("Expected a file field");
      const buffer = Buffer.concat(chunks);
      const result = await ingestMedia({
        userId: req.userId!,
        filename,
        mime,
        buffer,
      });
      const tempToken = signTempMediaToken(result.mediaId, req.userId!);
      res.status(201).json({ ...result, tempToken });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ error: err.code, message: err.message });
        return;
      }
      res.status(500).json({ error: "INTERNAL", message: "Media upload failed" });
    }
  });

  // Firebase Functions may already have consumed the body into rawBody
  const raw = (req as AuthedRequest & { rawBody?: Buffer }).rawBody;
  if (raw) {
    bb.end(raw);
  } else {
    req.pipe(bb);
  }
});

mediaRouter.get("/temp/:signedToken", async (req, res) => {
  try {
    const payload = verifyTempMediaToken(req.params.signedToken);
    const { stream, mime, size } = await openMediaReadStream(payload.mediaId);
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", String(size));
    stream.pipe(res);
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "INTERNAL", message: "Temp media read failed" });
  }
});
