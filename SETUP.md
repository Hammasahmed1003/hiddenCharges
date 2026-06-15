# HiddenCharges Local Setup

## 1. Start The React Client

```bash
cd /Users/hammasahmed/Documents/hiddenCharges
npm run dev --workspace client
```

Open:

```text
http://localhost:5173
```

## 2. Start MySQL In XAMPP

Open XAMPP and start **MySQL Database**.

Default XAMPP MySQL values are usually:

```bash
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DATABASE=hiddencharges
MYSQL_SOCKET=
```

The Node API creates the `hiddencharges` database and required tables automatically.

If XAMPP on Mac does not accept TCP connections, try this socket path:

```bash
MYSQL_SOCKET=/Applications/XAMPP/xamppfiles/var/mysql/mysql.sock
```

## 3. Configure Server Environment

Edit:

```text
server/.env
```

Required values:

```bash
PORT=4000
CLIENT_URL=http://localhost:5173
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DATABASE=hiddencharges
MYSQL_SOCKET=
SESSION_SECRET=replace-with-a-long-random-secret
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:4000/api/auth/gmail/callback
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-4.1-mini
```

## 4. Start The Node API

```bash
cd /Users/hammasahmed/Documents/hiddenCharges
npm run dev --workspace server
```

Health check:

```bash
curl http://localhost:4000/api/health
```

Expected:

```json
{"ok":true,"name":"HiddenCharges API"}
```

## 5. Start Both Together

After MySQL and `.env` are ready:

```bash
cd /Users/hammasahmed/Documents/hiddenCharges
npm run dev
```

## 6. Google OAuth Redirect URI

Use this exact redirect URI in Google Cloud:

```text
http://localhost:4000/api/auth/gmail/callback
```

If this does not exactly match the value in Google Cloud and `server/.env`, Google will show `redirect_uri_mismatch`.
