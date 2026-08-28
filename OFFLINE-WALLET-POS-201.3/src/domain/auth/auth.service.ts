import { db } from "../../config/db";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";

export const SECRET_KEY = process.env.SECRET_KEY || "pos-offline-secret-key-change-me";

export class AuthService {
  async login(username: string, password: string, deviceInfo: string = "Unknown Device", ipAddress: string = "127.0.0.1") {
    // Default admin check for initial login
    const defaultPassword = process.env.ADMIN_PASSWORD || "admin123";
    
    // Check if it's the default admin FIRST to allow access during setup
    if (username === "admin" && password === defaultPassword) {
      console.log("[AuthService] Default admin login successful");
      const token = jwt.sign({ id: "admin-id", username: "admin" }, SECRET_KEY, { expiresIn: "24h" });
      return { token, user: { id: "admin-id", username: "admin" } };
    }

    try {
      const res = await db.query("SELECT * FROM admin_users WHERE username = ?", [username]);
      if (res.rowCount === 0) {
        throw new Error("Invalid credentials");
      }

      const user = res.rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);

      if (!valid) {
        throw new Error("Invalid credentials");
      }

      // Create Session (optional, log it)
      // await db.query("INSERT INTO user_sessions ...")

      const token = jwt.sign({ id: user.id, username: user.username }, SECRET_KEY, { expiresIn: "24h" });
      return { token, user: { id: user.id, username: user.username } };
    } catch (e: any) {
      throw e;
    }
  }

  async getProfile(userId: string) {
    // If it's the fallback admin
    if (userId === "admin-id") {
      return {
        id: "admin-id",
        username: "admin",
        full_name: "System Administrator",
        email: "admin@pos2013.com",
        role: "admin",
        merchant_id: "MRC-1001"
      };
    }

    try {
      const res = await db.query("SELECT id, username, email, full_name, role FROM admin_users WHERE id = ?", [userId]);
      if (res.rowCount === 0) {
        throw new Error("User not found");
      }
      return res.rows[0];
    } catch (e) {
      // Fallback if DB fails but token is valid
      return {
        id: userId,
        username: "admin",
        full_name: "System Administrator",
        email: "admin@pos2013.com",
        role: "admin"
      };
    }
  }

  async updateProfile(userId: string, data: any) {
    if (userId === "admin-id") {
      // Cannot update the hardcoded fallback admin
      return { ...data, id: "admin-id" }; 
    }
    
    const { full_name, email } = data;
    await db.query(
      "UPDATE admin_users SET full_name = ?, email = ? WHERE id = ?",
      [full_name, email, userId]
    );
    return { id: userId, ...data };
  }

  async changePassword(userId: string, oldPass: string, newPass: string) {
    if (userId === "admin-id") {
      throw new Error("Cannot change password for default admin. Please create a real admin user.");
    }

    const res = await db.query("SELECT password_hash FROM admin_users WHERE id = ?", [userId]);
    if (res.rowCount === 0) throw new Error("User not found");

    const valid = await bcrypt.compare(oldPass, res.rows[0].password_hash);
    if (!valid) throw new Error("Incorrect old password");

    const newHash = await bcrypt.hash(newPass, 10);
    await db.query("UPDATE admin_users SET password_hash = ? WHERE id = ?", [newHash, userId]);
    
    return { success: true };
  }

  async regenerateApiKey(userId: string) {
    if (userId === "admin-id") {
      // Return a demo API key for the fallback admin
      return { api_key: "sk_test_demo_key_" + Date.now() };
    }

    const newApiKey = "sk_live_" + crypto.randomBytes(24).toString("hex");
    await db.query("UPDATE admin_users SET api_key = ? WHERE id = ?", [newApiKey, userId]);
    return { api_key: newApiKey };
  }
}

export const authService = new AuthService();
