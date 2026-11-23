"""Session, credential and redaction helpers for the curriculum portal.

Kept deliberately small and dependency-free (stdlib only):

* sessions live in process memory, keyed by an unguessable token that is
  carried in an HttpOnly cookie. Restarting the server signs everyone out,
  which is acceptable for a single-office deployment and keeps the app
  usable without a database migration.
* credentials are still stored in the database in plain text because the
  admin dashboard deliberately displays them (see docs/DATABASE.md). This
  module makes sure they are never handed to an anonymous or non-admin
  client, and that every write goes through a verified session.
"""

import copy
import secrets
import threading
import time

COOKIE_NAME = 'atria_session'
SESSION_TTL = 8 * 60 * 60      # 8 hours
RESET_TTL = 10 * 60           # OTP valid for 10 minutes

_lock = threading.Lock()
_sessions = {}                 # token -> {'user': dict, 'expires': float}
_resets = {}                   # email -> {'otp': str, 'expires': float}


# ---------------------------------------------------------------- users

def all_users(state):
    """Every account in the state, leadership first."""
    auth = (state or {}).get('auth_system') or {}
    return list(auth.get('leadership') or []) + list(auth.get('faculty_roster') or [])


def find_user(state, email):
    email = (email or '').strip().lower()
    if not email:
        return None
    for user in all_users(state):
        if (user.get('email') or '').strip().lower() == email:
            return user
    return None


def public_user(user):
    """A user record safe to hand to the browser."""
    if not user:
        return None
    safe = {k: v for k, v in user.items() if k != 'password'}
    if not safe.get('dept') and user.get('department_code'):
        safe['dept'] = user['department_code']
    return safe


def verify_credentials(state, email, password):
    user = find_user(state, email)
    if not user:
        return None
    expected = user.get('password') or 'college@123'
    return public_user(user) if password == expected else None


def is_admin(user):
    return bool(user) and (user.get('role') or '') == 'ADMIN'


def can_edit(user):
    return bool(user) and (bool(user.get('can_edit')) or is_admin(user))


# ---------------------------------------------------------------- sessions

def create_session(user):
    token = secrets.token_urlsafe(32)
    with _lock:
        _sessions[token] = {'user': public_user(user),
                            'expires': time.time() + SESSION_TTL}
    return token


def get_session(token):
    if not token:
        return None
    with _lock:
        record = _sessions.get(token)
        if not record:
            return None
        if record['expires'] < time.time():
            _sessions.pop(token, None)
            return None
        return dict(record['user'])


def destroy_session(token):
    if not token:
        return
    with _lock:
        _sessions.pop(token, None)


def cookie_from_header(cookie_header, name=COOKIE_NAME):
    if not cookie_header:
        return None
    for part in cookie_header.split(';'):
        key, _, value = part.strip().partition('=')
        if key == name:
            return value
    return None


def session_cookie(token, max_age=SESSION_TTL):
    return f'{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}'


def clear_cookie():
    return f'{COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'


# ---------------------------------------------------------------- reset OTP

def issue_otp(email):
    email = (email or '').strip().lower()
    otp = str(secrets.randbelow(900000) + 100000)
    with _lock:
        _resets[email] = {'otp': otp, 'expires': time.time() + RESET_TTL}
    return otp


def consume_otp(email, otp):
    email = (email or '').strip().lower()
    with _lock:
        record = _resets.get(email)
        if not record or record['expires'] < time.time():
            _resets.pop(email, None)
            return False
        if record['otp'] != (otp or '').strip():
            return False
        _resets.pop(email, None)
        return True


# ---------------------------------------------------------------- redaction

def redact_passwords(state, viewer):
    """Drop password fields for everyone except an administrator.

    Anonymous callers and ordinary faculty still receive the account list
    (they need names/roles for the directory and department scoping), but
    never the secrets.
    """
    if is_admin(viewer):
        return state
    clone = copy.deepcopy(state)
    for user in all_users(clone):
        user.pop('password', None)
    return clone
