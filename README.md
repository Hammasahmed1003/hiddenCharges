# HiddenCharges

HiddenCharges is a SaaS prototype for finding recurring payments from Gmail receipts, converting them into verified subscription records, and showing users where their money is going.

## Stack

- React + Vite frontend
- Node.js + Express backend
- MySQL/MariaDB persistence for XAMPP compatibility
- Gmail OAuth for user-approved email access
- Optional OpenAI extraction for receipt normalization

## Accuracy Model

Financial products should not present guesses as facts. HiddenCharges uses a review-first pipeline:

- Gmail search only scans likely receipt/subscription/payment emails.
- Regex and sender metadata produce deterministic candidates.
- AI returns structured JSON only when configured.
- Server validation rejects incomplete or impossible records.
- Every detected charge has a confidence score and verification status.
- Low-confidence items are shown as review-needed, not counted as confirmed spend.

## Quick Start

```bash
npm install
cp server/.env.example server/.env
npm run dev
```

Client: `http://localhost:5173`

Server: `http://localhost:4000`

## Environment

Set these in `server/.env`:

```bash
PORT=4000
CLIENT_URL=http://localhost:5173
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DATABASE=hiddencharges
SESSION_SECRET=replace-with-a-long-random-secret
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:4000/api/auth/gmail/callback
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
```
