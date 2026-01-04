# Render Cron Job Setup

## Daily Token Top-Up Cron Job

### What It Does
- Runs once per day at midnight UTC
- Tops up all users with < 100 tokens to exactly 100 tokens
- Skips users with ≥ 100 tokens (admin-granted users)
- Logs all transactions to the `transactions` table

### Setup Instructions

1. **Go to Render Dashboard** → Your Service → **Cron Jobs** tab

2. **Create New Cron Job** with these settings:

   **Name**: `Daily Token Top-Up`
   
   **Command**:
   ```bash
   curl -X POST https://skintip-backend.onrender.com/api/internal/daily-token-topup \
     -H "x-cron-secret: $CRON_SECRET"
   ```
   
   **Schedule**: `0 0 * * *` (Every day at midnight UTC)
   
   **Region**: Same as your web service

3. **Set Environment Variable** (if not already set):
   - Go to **Environment** tab
   - Add: `CRON_SECRET` = `<generate a random secret>`
   - Example: `CRON_SECRET=sk_live_abc123xyz789`

4. **Save and Enable** the cron job

### Alternative: Use Render's Native Cron Jobs

If your Render plan supports it, create a Cron Job service:

1. **Dashboard** → **New** → **Cron Job**
2. **Build Command**: `npm install`
3. **Command**: 
   ```bash
   curl -X POST $BACKEND_URL/api/internal/daily-token-topup \
     -H "x-cron-secret: $CRON_SECRET"
   ```
4. **Schedule**: `0 0 * * *`

### Testing

Test manually with curl:

```bash
curl -X POST https://skintip-backend.onrender.com/api/internal/daily-token-topup \
  -H "x-cron-secret: YOUR_CRON_SECRET_HERE"
```

Expected response:
```json
{
  "success": true,
  "message": "Topped up 5 users to 100 tokens",
  "toppedUpCount": 5,
  "totalEligible": 5,
  "sampleResults": [...]
}
```

### Monitoring

Check Render logs for:
- `Daily top-up complete: X users topped up to 100 tokens`
- Individual user top-ups: `Daily top-up: User username: +20 tokens (80 → 100)`

### Token Economy Rules

| Scenario | Tokens Before | Tokens Added | Tokens After |
|----------|---------------|--------------|--------------|
| New user | 0 | 100 (on register) | 100 |
| Used some tokens | 80 | +20 | 100 |
| At cap | 100 | 0 | 100 |
| Admin-granted | 150 | 0 (skipped) | 150 |
| Nearly empty | 5 | +95 | 100 |

### Security

- Endpoint protected by `CRON_SECRET` header
- Only processes users with < 100 tokens
- All transactions logged for audit trail
- Idempotent (safe to run multiple times)

