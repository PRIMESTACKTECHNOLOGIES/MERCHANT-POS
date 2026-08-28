# POS Offline Software

> Last updated: August 2026

This repository contains a full offline-capable POS stack with a React + Vite dashboard, a Node.js/TypeScript backend, and an Android client. The current setup is suitable for local development and for deployment to a public HTTPS host with a real payment processor or payout provider.

## What is included

- Web dashboard and POS UI
- Node.js/TypeScript backend with SQLite storage
- Android POS app
- Offline transaction handling and batch sync flow
- Primestack integration for live payment routing
- Optional crypto and bank payout provider integrations

## Quick start

### Windows

Use the helper scripts in the repository root:

- Run [start_all.bat](start_all.bat) to start the backend and frontend together
- Or run [start_dev.ps1](start_dev.ps1) from PowerShell

### Manual start

From the repository root:

1. Install backend dependencies
   - cd backend
   - npm install

2. Install frontend dependencies
   - cd client
   - npm install

3. Start the backend
   - cd backend
   - npm run dev

4. Start the frontend
   - cd client
   - npm run dev

Default local URLs:
- Backend: http://localhost:7000
- Frontend: http://localhost:7001

## Default login

On the first run, sign in with:
- Username: admin
- Password: set in the backend environment file

If no password has been configured, the default example value is admin123, but it should be changed immediately.

## Configuration

Copy the backend environment template before running the app:

- backend/.env.example -> backend/.env

Important variables:
- PORT=7000
- JWT_SECRET=your_secret_here
- PRIMESTACK_API_URL=http://localhost:6001
- PRIMESTACK_API_KEY=your_key_here

Optional live integrations:
- CRYPTO_PROVIDER / CUSTOM_CRYPTO_PROVIDER
- BANK_PAYOUT_PROVIDER / BANK_PAYOUT_API_URL

## Build commands

From the repository root:

- Backend build: cd backend && npm run build
- Frontend build: cd client && npm run build
- Full build: npm run build

## Project structure

- backend/ — Express API, SQLite schema, domain services, auth, payments, terminals, transactions
- client/ — Vite React frontend and POS pages
- android_pos_app/ — Android Kotlin app
- docker-compose.yml — container-based startup template
- start_all.bat / start_dev.ps1 — local development helpers

## Deployment notes

The app is prepared for deployment with:
- Docker Compose
- A public HTTPS host such as Render, Railway, Fly.io, or a similar provider
- Environment variables for the payment processor and payout provider

For public deployment, ensure that:
- The backend is reachable over HTTPS
- JWT secrets and API keys are not committed to source control
- Webhook URLs are configured with the deployed backend host

## Notes

This codebase includes offline transaction logic and live payment integration hooks, but it is not a PCI-certified payment solution. Any production deployment should be reviewed for compliance, secure storage, and operational controls before handling real customer payments at scale.
