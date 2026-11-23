# Approval email

When a scheme is approved by the Dean, the portal emails the approved `.docx`
to the scheme owner's registered address.

## 1. Configure SMTP

Credentials are **never** committed. Use either environment variables or a local
file that `.gitignore` excludes.

### Option A — `data/mail_config.json`

```json
{
  "host": "smtp.gmail.com",
  "port": 587,
  "user": "curriculum@atria.edu.in",
  "password": "your-app-password",
  "sender": "curriculum@atria.edu.in",
  "use_tls": true
}
```

### Option B — environment variables

```
ATRIA_SMTP_HOST=smtp.gmail.com
ATRIA_SMTP_PORT=587
ATRIA_SMTP_USER=curriculum@atria.edu.in
ATRIA_SMTP_PASSWORD=your-app-password
ATRIA_SMTP_FROM=curriculum@atria.edu.in
ATRIA_SMTP_TLS=true
```

For Gmail you need an **App Password** (Google Account → Security → 2-Step
Verification → App passwords). Your normal account password will be rejected.
Port `465` with `"use_tls": false` uses implicit TLS (SMTP_SSL) instead.

## 2. Check the state

```powershell
Invoke-WebRequest http://localhost:8000/api/mail/status -UseBasicParsing |
  Select-Object -ExpandProperty Content
```

`configured: true` means the next approval will send for real.

## 3. What happens without configuration

Nothing breaks. The message is written to `data/outbox/<uuid>-<timestamp>.eml`
and the scheme is tagged `mail_status = not-configured`. Open the `.eml` in any
mail client to inspect exactly what would be sent, attachment included.

## 4. Behaviour

| Event | Result |
|---|---|
| Dean approves | mail sent (or preview written), `mail_status` + `mail_sent_at` recorded |
| SMTP error | approval still succeeds; `mail_status = error`, detail returned to the caller |
| Owner re-sends | `POST /api/schemes/<uuid>/email` or the **Email copy** action on an Approved row |
| Non-owner tries to re-send | `403 Only the owner can resend the approved copy` |

The attachment is generated fresh from the database at send time, so the mailed
document always matches the approved version.
