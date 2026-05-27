# Cobra – Hostinger VPS Deployment

## 1. First time setup on VPS

```bash
# Install Node 20 (if not already installed like your CRM)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Create MySQL database
mysql -u root -p
CREATE DATABASE cobra CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'cobra_user'@'localhost' IDENTIFIED BY 'your_strong_password';
GRANT ALL PRIVILEGES ON cobra.* TO 'cobra_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

## 2. Clone and configure

```bash
cd /var/www
git clone https://github.com/Daniel666674/cobra.git
cd cobra/server

cp .env.example .env
nano .env   # fill in DB_PASS, JWT_SECRET at minimum
            # leave WA/Dapta/Bold/Alegra blank → mock mode

npm install
node src/db/migrate.js   # create tables
node src/db/seed.js      # load Real Confort demo data
```

## 3. Start with PM2 (same as your CRM)

```bash
npm install -g pm2   # if not already installed

pm2 start src/app.js --name cobra-api
pm2 save
pm2 startup   # auto-start on reboot
```

## 4. Nginx reverse proxy

Add to your nginx config (same pattern as CRM):

```nginx
server {
    listen 80;
    server_name api.cobra.yourdomain.com;

    location / {
        proxy_pass         http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 5. Test it's working

```bash
curl http://localhost:3001/health
# → {"status":"ok","ts":"..."}

curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@realconfort.co","password":"cobra2024"}'
# → {"token":"eyJ...","user":{...}}
```

## 6. Manually trigger escalation (dev test)

```bash
curl -X POST http://localhost:3001/dev/run-escalation
# Watch the console — mock WA/calls will log to stdout
```

## 7. When you get real API keys

Just add them to `.env` and restart:

```bash
pm2 restart cobra-api
```

The system auto-detects which services are live vs. mock on boot.

---

## API routes summary

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/auth/login | Login → JWT |
| GET | /api/auth/me | Current user |
| GET | /api/credits | List credits |
| POST | /api/credits | Create credit |
| POST | /api/credits/:id/payment-link | Generate Bold link |
| GET | /api/clients | List clients |
| POST | /api/clients | Create client |
| GET | /api/clients/:id | Client + history |
| POST | /api/promises | Record promise |
| PATCH | /api/promises/:id | Mark kept/broken |
| POST | /api/payments | Record manual payment |
| POST | /api/payments/webhook/bold | Bold webhook |
| POST | /api/whatsapp/send/reminder | Manual WA trigger |
| GET | /api/whatsapp/webhook | Meta verification |
| POST | /api/whatsapp/webhook | Incoming messages |
| POST | /api/calls/trigger | Trigger AI call |
| GET | /api/analytics/kpis | Dashboard numbers |
| GET | /api/analytics/aging | Mora aging |
| GET | /api/analytics/recovery-trend | Weekly chart |
