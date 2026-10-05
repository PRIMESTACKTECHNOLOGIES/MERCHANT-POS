const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const bcrypt = require('bcryptjs');
(async () => {
  try {
    const newPassword = process.argv[2] || 'admin123';
    const hash = await bcrypt.hash(newPassword, 10);
    const db = await open({ filename: 'e:\\DOWNLOADS\\POS OFFLINE SFTWR\\database.sqlite', driver: sqlite3.Database });
    const res = await db.run("UPDATE admin_users SET password_hash = ? WHERE username = ?", [hash, 'admin']);
    console.log('Updated rows:', res.changes);
    await db.close();
    console.log('Admin password set to:', newPassword);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
