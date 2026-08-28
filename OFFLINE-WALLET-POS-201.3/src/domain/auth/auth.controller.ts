import { Request, Response } from "express";
import { authService } from "./auth.service";

export class AuthController {
  async login(req: Request, res: Response) {
    try {
      const { username, password } = req.body;
      const result = await authService.login(username, password);
      res.json(result);
    } catch (e: any) {
      res.status(401).json({ error: e.message });
    }
  }

  async getProfile(req: Request, res: Response) {
    try {
      // The user is attached to req by the authenticateToken middleware
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const profile = await authService.getProfile(userId);
      res.json(profile);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  async updateProfile(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      
      const result = await authService.updateProfile(userId, req.body);
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  }

  async changePassword(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { old_password, new_password } = req.body;
      if (!old_password || !new_password) {
        return res.status(400).json({ error: "Old and new passwords required" });
      }

      const result = await authService.changePassword(userId, old_password, new_password);
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  }

  async regenerateApiKey(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      
      const result = await authService.regenerateApiKey(userId);
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  }

  async getSessions(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      
      // Return dummy sessions for now
      res.json([
        {
          id: "session-1",
          device_info: "Current Browser",
          ip_address: req.ip,
          last_active: new Date().toISOString(),
          current: true
        }
      ]);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
}

export const authController = new AuthController();
