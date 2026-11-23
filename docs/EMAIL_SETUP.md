# Approval email

When a scheme is approved by the Dean, the portal emails the approved `.docx`
to the scheme owner's registered address.

## 1. Configure SMTP

Credentials are **never** committed. They come from `data/mail_config.json`
(gitignored) or environment variables.

### Microsoft 365 / Outlook (Atria)

```json
{
  "host": "smtp.office365.com",
  "port": 587,
  "user": "hema_cse@atria.edu.in",
  "password": "your-mailbox-password",
  "sender": "hema_cse@atria.edu.in",
  "use_tls": true
}
```

Port 587 uses STARTTLS (`use_tls: true`). Office 365 does **not** accept 465.

Two things must be true on the Microsoft side, or the login fails:

1. **SMTP AUTH is enabled** for the mailbox. Admins manage this in
   Microsoft 365 admin center → Active users → *Mail* → **Manage email apps** →
   tick *Authenticated SMTP*. It is off by default for new tenants.
2. **The password is accepted for SMTP.** If the account enforces MFA, a normal
   password will be rejected; the admin must either allow an app password for
   that mailbox or the tenant needs OAuth2 (see below).

Environment variables work the same way:

```
ATRIA_SMTP_HOST=smtp.office365.com
ATRIA_SMTP_PORT=587
ATRIA_SMTP_USER=hema_cse@atria.edu.in
ATRIA_SMTP_PASSWORD=...
ATRIA_SMTP_FROM=hema_cse@atria.edu.in
ATRIA_SMTP_TLS=true
```

### Other providers

| Provider | Host | Port | use_tls |
|---|---|---|---|
| Gmail / Workspace | `smtp.gmail.com` | 587 | true (needs App Password) |
| Outlook.com personal | `smtp-mail.outlook.com` | 587 | true |
| College relay | from IT | usually 25/587 | per IT |

## 2. Check the state

```powershell
(Invoke-WebRequest http://localhost:8000/api/mail/status -UseBasicParsing).Content
```

`configured: true` means host, sender **and** password are present.

## 3. If the tenant blocks SMTP AUTH

Typical error: `535 5.7.139 Authentication unsuccessful, SMTP AUTH is disabled`
or `5.7.57 Client not authenticated to send mail`.

Three ways forward, in order of effort:

1. **Ask IT to enable Authenticated SMTP** on the sending mailbox (5 minutes).
2. **Ask IT for an SMTP relay** host that allows the portal's IP without auth —
   put its host/port in `mail_config.json` and leave `user`/`password` empty.
3. **OAuth2 via Microsoft Graph** (`Mail.Send` application permission). Requires
   an app registration, admin consent and a token endpoint; `mailer.py` would
   need a Graph send path instead of `smtplib`. Doable, but it needs IT
   cooperation.

## 4. What happens without configuration

Nothing breaks. The message is written to `data/outbox/<uuid>-<timestamp>.eml`
and the scheme is tagged `mail_status = not-configured`. Open the `.eml` in any
mail client to inspect exactly what would be sent, attachment included.

## 5. Behaviour

| Event | Result |
|---|---|
| Dean approves | mail sent (or preview written), `mail_status` / `mail_sent_at` recorded |
| SMTP error | approval still succeeds; `mail_status = error`, detail returned to the caller |
| Owner re-sends | `POST /api/schemes/<uuid>/email` or the **Email copy** action on an Approved row |
| Non-owner re-sends | `403 Only the owner can resend the approved copy` |

The attachment is generated fresh from the database at send time, so the mailed
document always matches the approved version.
