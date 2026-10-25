import { Router } from "express";
import { customerAuthController } from "./customer-auth.controller";
import { authenticateCustomer } from "../../middleware/customerAuth.middleware";

const router = Router();

// Public: wallet code + PIN → customer JWT
router.post("/login", (req, res) => customerAuthController.login(req, res));

// Authenticated customer session
router.get("/me", authenticateCustomer, (req, res) => customerAuthController.me(req, res));
router.put("/profile", authenticateCustomer, (req, res) => customerAuthController.updateProfile(req, res));
router.post("/change-pin", authenticateCustomer, (req, res) => customerAuthController.changePin(req, res));

export { router as customerAuthRouter };
