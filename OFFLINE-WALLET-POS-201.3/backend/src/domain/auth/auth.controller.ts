import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { authService, SECRET_KEY } from "./auth.service";

export class AuthController {
  async login(req: Request, res: Response) {
    try {
      let { username, password } = req.body;
      const deviceInfo = req.headers['user-agent'] || "Unknown Device";
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || "127.0.0.1";

      if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
      }

      // Trim username to avoid accidental spaces
      username = username.trim();
      
      const result = await authService.login(username, password, deviceInfo, ipAddress);
      res.json(result);
    } catch (e: any) {
      res.status(401).json({ error: e.message });
    }
  }

  async changePassword(req: Request, res: Response) {
    try {
      const { old_password, new_password } = req.body;
      const userId = (req as any).user?.id;

      if (!userId) {
        return res.status(401).json({ status: false, message: "Unauthorized" });
      }

      if (!old_password || !new_password) {
        return res.status(400).json({ status: false, message: "Old and new passwords are required" });
      }

      const result = await authService.changePassword(userId, old_password, new_password);
      // authService.changePassword returns { status: boolean, message: string }
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ status: false, message: e.message || "Failed to change password" });
    }
  }

  async getProfile(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const result = await authService.getProfile(userId);
      
      // Map to user requested format + new fields
      const response = {
        full_name: result.full_name,
        display_name: result.display_name,
        phone: result.phone,
        country: result.country,
        timezone: result.timezone,
        company: result.company_name,
        email: result.email,
        avatar_url: result.avatar_url,
        two_factor_enabled: result.two_factor_enabled,
        theme_preference: result.theme_preference,
        language_preference: result.language_preference,
        api_key: result.api_key
      };
      
      res.json(response);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  }

  async updateProfile(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      
      const { company, ...rest } = req.body;
      const profile = { ...rest, company_name: company };
      
      const result = await authService.updateProfile(userId, profile);
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  }

  async toggle2FA(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      
      const { enable } = req.body;
      if (typeof enable !== 'boolean') return res.status(400).json({ error: "enable (boolean) required" });

      const result = await authService.toggle2FA(userId, enable);
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  }

  async getSessions(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const result = await authService.getSessions(userId);
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  }

  async revokeSession(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const { sessionId } = req.params;
      const result = await authService.revokeSession(userId, sessionId);
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
}

export const authController = new AuthController();
