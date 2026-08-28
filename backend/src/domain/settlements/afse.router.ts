import { Router, Request, Response } from "express";
import { afse } from "./automatic-fund-settlement-engine";
import { authenticateToken } from "../../middleware/auth.middleware";

const router = Router();

router.get("/status", authenticateToken, async (req: Request, res: Response) => {
  try {
    const s = await afse.getStatus();
    res.json(s);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

router.post("/run-for-auth/:code", authenticateToken, async (req: Request, res: Response) => {
  try {
    const op = (req as any).user?.id || "system";
    const r = await afse.runForAuthCode(req.params.code, op);
    if (r.run_status === "COMPLETE" || r.run_status === "ALREADY_SETTLED") {
      res.json({ success: true, ...r });
    } else {
      const code =
        r.run_status === "CONFIG_ERROR"
          ? 400
          : r.run_status.endsWith("_FAILED")
            ? 502
            : 202;
      res.status(code).json({ success: false, ...r });
    }
  } catch (e: any) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

router.post("/run-all", authenticateToken, async (req: Request, res: Response) => {
  try {
    const op = (req as any).user?.id || "system";
    const r = await afse.runAll(op);
    if (r.failed === 0 && r.total > 0) {
      res.json({ success: true, ...r });
    } else if (r.total === 0) {
      res.json({ success: true, nothing_to_do: true, ...r });
    } else {
      res.status(207).json({ success: r.succeeded > 0, ...r });
    }
  } catch (e: any) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

export default router;
