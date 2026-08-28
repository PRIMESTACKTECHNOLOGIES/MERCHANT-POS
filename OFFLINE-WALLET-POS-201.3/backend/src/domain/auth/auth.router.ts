import { Router } from "express";
import { authController } from "./auth.controller";
import { authenticateToken } from "../../middleware/auth.middleware";

const router = Router();

router.post("/login", (req, res) => authController.login(req, res));
router.post("/change-password", authenticateToken, (req, res) => authController.changePassword(req, res));
router.get("/profile", authenticateToken, (req, res) => authController.getProfile(req, res));
router.put("/profile", authenticateToken, (req, res) => authController.updateProfile(req, res));
router.post("/2fa/toggle", authenticateToken, (req, res) => authController.toggle2FA(req, res));
router.get("/sessions", authenticateToken, (req, res) => authController.getSessions(req, res));
router.delete("/sessions/:sessionId", authenticateToken, (req, res) => authController.revokeSession(req, res));
router.post("/api-key/regenerate", authenticateToken, (req, res) => authController.regenerateApiKey(req, res));

export { router as authRouter };
