"""Outbound mail for approved schemes.

Credentials are never committed: they come from environment variables or from
data/mail_config.json, which .gitignore excludes. When SMTP is not configured
the message is written to data/outbox/*.eml so the flow can be inspected
without sending anything.
"""

import datetime
import json
import os
import smtplib
import ssl
from email.message import EmailMessage

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
CONFIG_PATH = os.path.join(DATA_DIR, 'mail_config.json')
OUTBOX_DIR = os.path.join(DATA_DIR, 'outbox')
DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
DOCX_SUBTYPE = 'vnd.openxmlformats-officedocument.wordprocessingml.document'


def load_config():
    config = {
        'host': os.environ.get('ATRIA_SMTP_HOST', ''),
        'port': int(os.environ.get('ATRIA_SMTP_PORT', '587') or 587),
        'user': os.environ.get('ATRIA_SMTP_USER', ''),
        'password': os.environ.get('ATRIA_SMTP_PASSWORD', ''),
        'sender': os.environ.get('ATRIA_SMTP_FROM', ''),
        'use_tls': (os.environ.get('ATRIA_SMTP_TLS', 'true').lower() != 'false'),
        'sender_name': os.environ.get('ATRIA_SMTP_NAME', ''),
    }

    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, encoding='utf-8') as f:
                stored = json.load(f)
            for key in ('host', 'user', 'password', 'sender', 'use_tls', 'sender_name'):
                if stored.get(key):
                    config[key] = stored[key]
            if stored.get('port'):
                config['port'] = int(stored['port'])
        except Exception as exc:  # pragma: no cover - surfaced in the response
            config['config_error'] = str(exc)

    if not config['sender']:
        config['sender'] = config['user'] or 'no-reply@atria.local'

    config['configured'] = bool(config['host'] and config['sender'] and (config['password'] or not config['user']))
    return config


def _message(scheme, to_email, config):
    msg = EmailMessage()
    msg['Subject'] = f"Approved scheme: {scheme.get('name') or 'Scheme'} ({scheme.get('department_code')} · Sem {scheme.get('semester')})"
    from email.utils import formataddr
    msg['From'] = formataddr((config['sender_name'], config['sender'])) if config.get('sender_name') else config['sender']
    msg['To'] = to_email

    approved_on = scheme.get('decided_at') or datetime.datetime.now().isoformat(timespec='seconds')
    body = (
        f"Dear {scheme.get('owner_name') or 'Faculty'},\n\n"
        f"Your scheme has been approved.\n\n"
        f"Scheme   : {scheme.get('name')}\n"
        f"Department: {scheme.get('department_code')}\n"
        f"Semester : {scheme.get('semester')}\n"
        f"Academic year: {scheme.get('academic_year') or '-'}\n"
        f"Regulation: {scheme.get('regulation') or '-'}\n"
        f"Courses  : {len(scheme.get('courses') or [])}\n"
        f"Approved on: {approved_on}\n"
        f"Approved by: {scheme.get('decided_by') or 'Dean (Academics)'}\n\n"
        "The approved copy is attached. This document is the version of record; "
        "further edits require a new revision.\n\n"
        "Regards,\nAtria Autonomous Curriculum Portal\n"
    )
    msg.set_content(body)
    return msg


def _filename(scheme):
    dept = (scheme.get('department_code') or 'SCHEME').replace(' ', '')
    sem = (scheme.get('semester') or '').replace(' ', '')
    return f"{dept}_{sem}_SCHEME_APPROVED.docx"


def send_approval_mail(scheme, docx_bytes):
    """Send the approved document. Returns a dict describing what happened."""
    config = load_config()
    to_email = (scheme.get('owner_email') or '').strip()
    result = {
        'status': 'skipped',
        'detail': '',
        'to': to_email,
        'at': datetime.datetime.now().isoformat(timespec='seconds'),
    }

    if not to_email:
        result['detail'] = 'No registered email on the scheme owner.'
        return result

    msg = _message(scheme, to_email, config)
    if docx_bytes:
        msg.add_attachment(docx_bytes, maintype='application', subtype=DOCX_SUBTYPE,
                           filename=_filename(scheme))

    if not config['configured']:
        os.makedirs(OUTBOX_DIR, exist_ok=True)
        stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
        eml_path = os.path.join(OUTBOX_DIR, f"{scheme.get('uuid', 'scheme')}-{stamp}.eml")
        with open(eml_path, 'wb') as f:
            f.write(bytes(msg))
        result['status'] = 'not-configured'
        result['preview'] = eml_path
        result['detail'] = ('SMTP is not configured, so the mail was saved as a preview: '
                            + os.path.basename(eml_path))
        return result

    try:
        if config.get('use_tls', True):
            context = ssl.create_default_context()
            with smtplib.SMTP(config['host'], config['port'], timeout=20) as server:
                server.starttls(context=context)
                if config.get('user'):
                    server.login(config['user'], config['password'])
                server.send_message(msg)
        else:
            with smtplib.SMTP_SSL(config['host'], config['port'], timeout=20) as server:
                if config.get('user'):
                    server.login(config['user'], config['password'])
                server.send_message(msg)
        result['status'] = 'sent'
        result['detail'] = f'Approved copy emailed to {to_email}.'
    except Exception as exc:
        result['status'] = 'error'
        result['detail'] = f'Could not send mail: {exc}'

    return result
