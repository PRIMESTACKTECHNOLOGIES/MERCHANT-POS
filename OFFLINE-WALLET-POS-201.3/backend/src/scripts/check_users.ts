import { db } from "../config/db";

async function run() {
  try {
    console.log("Checking admin_users table...");
    const res = await db.query("SELECT id, email, username FROM admin_users;");
    console.log("admin_users:", res.rows);

    try {
        console.log("Checking users table (if exists)...");
        const res2 = await db.query("SELECT id, email FROM users;");
        console.log("users:", res2.rows);
    } catch (e: any) {
        console.log("users table check failed (likely doesn't exist):", e.message);
    }

  } catch (error) {
    console.error("Error:", error);
  } finally {
    process.exit();
  }
}

run();
