# 📦 POS System Installation Guide

This guide will help you install and run the **Offline-First POS System** on a new computer (Windows, Mac, or Linux).

---

## 🛠️ Prerequisites (What you need first)

Before starting, ensure you have the following installed:

1.  **Node.js** (Version 18 or higher)
    *   Download: [https://nodejs.org/](https://nodejs.org/)
    *   *Verify:* Open terminal and type `node -v`
2.  **PostgreSQL** (Database)
    *   Download: [https://www.postgresql.org/download/](https://www.postgresql.org/download/)
    *   *Note:* Remember the password you set during installation (default is usually `postgres`).

---

## 🚀 Step 1: Database Setup

1.  Open **pgAdmin** (installed with PostgreSQL) or your preferred SQL tool.
2.  Create a new database named `pos_db`.
3.  (Optional) If you want to use a different user/password, remember them for the next step.

---

## ⚙️ Step 2: Configure the Application

1.  Navigate to the project folder.
2.  Open the file named `.env` (or create it if it doesn't exist).
3.  Update the database connection string:

```env
# Example .env file
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password_here
DB_NAME=pos_db
JWT_SECRET=your_secure_random_secret_key
PORT=3000
```

*Replace `your_password_here` with your actual PostgreSQL password.*

---

## 📦 Step 3: Install Dependencies

Open a terminal (Command Prompt or PowerShell) in the project folder and run:

```bash
# 1. Install Backend Dependencies
npm install

# 2. Install Frontend Dependencies
cd client
npm install
cd ..
```

---

## 🏗️ Step 4: Initialize the Database

Run this command once to set up all the tables (merchants, terminals, transactions):

```bash
npm run init-db
```

*If successful, you will see "Database initialized successfully".*

---

## ▶️ Step 5: Start the System

You need to start both the Backend (Server) and Frontend (Dashboard).

### Option A: Run Both (Recommended)
If you have a script for it (e.g., `npm run dev` in root):
```bash
npm run dev
```

### Option B: Run Separately (If Option A fails)
**Terminal 1 (Backend):**
```bash
npm run start
```

**Terminal 2 (Frontend):**
```bash
cd client
npm run dev
```

---

## 🌐 Step 6: Access the Dashboard

1.  Open your browser (Chrome/Edge).
2.  Go to: **[http://localhost:5173](http://localhost:5173)**
3.  You should see the POS Dashboard.

---

## 📱 Step 7: Connect a Mobile Terminal (Optional)

If you have the Android POS app:
1.  Ensure your phone and computer are on the **same Wi-Fi**.
2.  Find your computer's IP address (Run `ipconfig` on Windows).
3.  In the mobile app settings, set the Server URL to: `http://YOUR_PC_IP:3000`
4.  Pair using the Terminal ID from the Dashboard.

---

## ❓ Troubleshooting

*   **"Connection Refused"**: Check if PostgreSQL is running.
*   **"Module not found"**: Run `npm install` again in both folders.
*   **"Port in use"**: Close other running node processes or restart your PC.
