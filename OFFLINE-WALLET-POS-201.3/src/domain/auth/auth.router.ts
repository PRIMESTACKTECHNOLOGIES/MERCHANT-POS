import { Router } from "express";
import { authController } from "./auth.controller";
import { authenticateToken } from "../../middleware/auth.middleware";

const router = Router();

router.post("/login", authController.login.bind(authController));
router.get("/profile", authenticateToken, authController.getProfile.bind(authController));
router.put("/profile", authenticateToken, authController.updateProfile.bind(authController));
router.post("/change-password", authenticateToken, authController.changePassword.bind(authController));

// API Key & Sessions Management
router.post("/api-key/regenerate", authenticateToken, authController.regenerateApiKey.bind(authController));
router.get("/sessions", authenticateToken, authController.getSessions.bind(authController));

export { router as authRouter };
