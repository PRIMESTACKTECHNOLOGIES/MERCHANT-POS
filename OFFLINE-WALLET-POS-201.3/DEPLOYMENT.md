# Deploy (No Render)

This project is a single Node.js server that serves:

- API on `/auth`, `/merchant`, `/api/health`
- Dashboard (React build) from `client/dist`

## Option A (Fastest): Railway (Docker)

1. Create a new Railway project
2. Deploy using Dockerfile
3. Set Variables:
   - `ADMIN_PASSWORD`
   - `SECRET_KEY`
   - `PORT` = `3000`
4. Deploy

## Option B: Fly.io (Docker)

1. Install `flyctl`
2. From project root:
   - `fly launch`
   - Set internal port `3000`
3. Set secrets:
   - `fly secrets set ADMIN_PASSWORD=... SECRET_KEY=...`
4. Deploy:
   - `fly deploy`

## Option C: Any VPS (Ubuntu)

1. Install Node 20, nginx
2. Build:
   - `npm ci`
   - `npm run build`
3. Run with PM2:
   - `pm2 start dist/app.js --name pos`
4. Reverse proxy with nginx to `localhost:3000`
