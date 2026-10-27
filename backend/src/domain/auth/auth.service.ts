import { db } from "../../config/db";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";

export const SECRET_KEY = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? undefined : 'dev_jwt_secret_change_me');
if (!SECRET_KEY) {
  throw new Error("JWT_SECRET environment variable must be set for secure authentication");
}

if (!process.env.JWT_SECRET) {
  console.warn("WARNING: JWT_SECRET is not set. Using development fallback secret. Set JWT_SECRET in .env before deploying to production.");
}

export class AuthService {
  async login(username: string, password: string, deviceInfo: string = "Unknown Device", ipAddress: string = "127.0.0.1") {
    try {
      console.log(`Attempting login for: '${username}' with password length: ${password?.length}`);
      
      const res = await db.query("SELECT * FROM admin_users WHERE username = $1", [username]);
      if (res.rowCount === 0) {
        throw new Error("Invalid credentials");
      }

      const user = res.rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        throw new Error("Invalid credentials");
      }

      // Create Session
      await db.query(
        "INSERT INTO user_sessions (user_id, device_info, ip_address) VALUES ($1, $2, $3)", 
        [user.id, deviceInfo, ipAddress]
      );

      const token = jwt.sign({ id: user.id, username: user.username }, SECRET_KEY as string, { expiresIn: "24h" });
      return { token, user: { id: user.id, username: user.username } };
    } catch (e: any) {
        console.error("Login DB Error:", e.message || e);
        throw e;
    }
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const res = await db.query("SELECT * FROM admin_users WHERE id = $1", [userId]);
    if (res.rowCount === 0) {
      throw new Error("User not found");
    }

    const user = res.rows[0];
    const valid = await bcrypt.compare(oldPassword, user.password_hash);
    if (!valid) {
      return { status: false, message: "Old password is incorrect" };
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.query("UPDATE admin_users SET password_hash = $1 WHERE id = $2", [hashedPassword, userId]);

    return { status: true, message: "Password updated successfully" };
  }

  async getProfile(userId: string) {
    const res = await db.query("SELECT full_name, display_name, phone, country, timezone, company_name, email, avatar_url, two_factor_enabled, theme_preference, language_preference, api_key FROM admin_users WHERE id = $1", [userId]);
    const user = res.rows[0];

    if (user && !user.api_key) {
        // Generate a merchant API secret if missing
        const newKey = "mk_" + crypto.randomBytes(24).toString('hex');
        await db.query("UPDATE admin_users SET api_key = $1 WHERE id = $2", [newKey, userId]);
        user.api_key = newKey;
    }

    return user || {};
  }

  async updateProfile(userId: string, profile: any) {
    // Check if email is being updated and if it's unique
    if (profile.email) {
      const emailCheck = await db.query("SELECT id FROM admin_users WHERE email = $1 AND id != $2", [profile.email, userId]);
      if (emailCheck.rowCount > 0) {
        throw new Error("Email already in use");
      }
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    // Helper to add field if present
    const addField = (key: string, dbCol: string) => {
      if (profile[key] !== undefined) {
        fields.push(`${dbCol} = $${idx++}`);
        values.push(profile[key]);
      }
    };

    addField("full_name", "full_name");
    addField("display_name", "display_name");
    addField("phone", "phone");
    addField("country", "country");
    addField("timezone", "timezone");
    addField("company_name", "company_name");
    addField("email", "email");
    addField("avatar_url", "avatar_url");
    addField("theme_preference", "theme_preference");
    addField("language_preference", "language_preference");

    if (fields.length === 0) return { status: true, message: "No changes" };

    values.push(userId);
    await db.query(
      `UPDATE admin_users SET ${fields.join(", ")} WHERE id = $${idx}`,
      values
    );
    return { status: true, message: "Profile updated successfully" };
  }

  async toggle2FA(userId: string, enable: boolean) {
    await db.query("UPDATE admin_users SET two_factor_enabled = $1 WHERE id = $2", [enable, userId]);
    return { status: true, message: `2FA ${enable ? 'enabled' : 'disabled'}` };
  }

  async getSessions(userId: string) {
    const res = await db.query("SELECT id, device_info, ip_address, last_active FROM user_sessions WHERE user_id = $1 ORDER BY last_active DESC", [userId]);
    return res.rows.map((row: any) => ({
      ...row,
      current: false
    }));
  }

  async revokeSession(userId: string, sessionId: string) {
    await db.query("DELETE FROM user_sessions WHERE id = $1 AND user_id = $2", [sessionId, userId]);
    return { status: true, message: "Session revoked" };
  }

  async regenerateApiKey(userId: string) {
    const newKey = "mk_" + crypto.randomBytes(24).toString('hex');
    await db.query("UPDATE admin_users SET api_key = $1 WHERE id = $2", [newKey, userId]);
    return { api_key: newKey };
  }
}

export const authService = new AuthService();
