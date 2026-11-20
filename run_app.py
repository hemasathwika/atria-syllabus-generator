"""
College Scheme & Syllabus Generator - Enhanced Local App Server
Provides API endpoints for:
- Session-based sign in (credentials verified server side)
- Auto-saving state to SQLite (+ JSON mirror)
- Dynamic generation and download of Scheme (.docx) separately
- Dynamic generation and download of Syllabus (.docx) separately
"""

import http.server
import socketserver
import webbrowser
import os
import sys
import json
import traceback
import urllib.parse
import importlib

import db
import auth

PORT = 8000


def fresh_db():
    """Reload db.py too, so schema/persistence edits apply without a restart."""
    return importlib.reload(db)


def fresh_exporter():
    """Reload export_docx on every request.

    Python caches imported modules, so a long-running server kept serving the
    exporter code it loaded at start-up: edits to export_docx.py had no effect
    on downloads until the process was restarted.
    """
    import export_docx
    return importlib.reload(export_docx)


def with_preserved_secrets(data):
    """Never let a redacted client payload erase stored passwords.

    Editors receive /api/state without password fields, then post the whole
    object back on save. Writing that verbatim would null every credential,
    so any account that arrives without a password inherits the stored one.
    """
    try:
        current = fresh_db().load_state()
    except Exception:
        return data
    known = {}
    for user in auth.all_users(current):
        email = (user.get('email') or '').lower()
        if email and user.get('password'):
            known[email] = user['password']
    for user in auth.all_users(data):
        if not user.get('password'):
            stored = known.get((user.get('email') or '').lower())
            if stored:
                user['password'] = stored
    return data


def persist(data):
    """Write state to SQLite, refresh the JSON mirror, regenerate the docx files."""
    database = fresh_db()
    conn = database.ensure_ready()
    try:
        skipped = database.save_state(data, conn=conn)
        database.export_json(conn, database.JSON_PATH)
    finally:
        conn.close()
    if skipped:
        print("Skipped syllabi without a matching course:", ", ".join(skipped))
    try:
        fresh_exporter().main()
    except Exception as e:
        print(f"Warning: could not regenerate docx files: {e}")


class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS and disable aggressive caching for local development
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    # ------------------------------------------------------------ helpers

    def _json(self, code, payload, cookie=None):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get('Content-Length', 0) or 0)
        raw = self.rfile.read(length) if length else b''
        return json.loads(raw.decode('utf-8')) if raw else {}

    def _token(self):
        return auth.cookie_from_header(self.headers.get('Cookie'))

    def _user(self):
        return auth.get_session(self._token())

    def _require_editor(self):
        user = self._user()
        if not auth.can_edit(user):
            self._json(403, {"status": "error",
                             "message": "Sign in with an authoring account to modify curriculum data."})
            return None
        return user

    def do_HEAD(self):
        if self.path.startswith('/api/download/'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
            self.end_headers()
            return
        super().do_HEAD()

    # ------------------------------------------------------------ POST

    def do_POST(self):
        path = self.path.split('?')[0]
        try:
            if path == '/api/login':
                return self._login()
            if path == '/api/logout':
                auth.destroy_session(self._token())
                return self._json(200, {"status": "ok"}, cookie=auth.clear_cookie())
            if path == '/api/register':
                return self._register()
            if path == '/api/request-reset':
                return self._request_reset()
            if path == '/api/reset-password':
                return self._reset_password()
            if path == '/api/save-state':
                return self._save_state()
            self.send_response(404)
            self.end_headers()
        except json.JSONDecodeError:
            self._json(400, {"status": "error", "message": "Malformed JSON body."})
        except Exception as e:
            traceback.print_exc()
            self._json(500, {"status": "error", "message": str(e)})

    def _login(self):
        data = self._body()
        state = fresh_db().load_state()
        user = auth.verify_credentials(state, data.get('email'), data.get('password', ''))
        if not user:
            return self._json(401, {"status": "error",
                                    "message": "Invalid email or password."})
        token = auth.create_session(user)
        self._json(200, {"status": "ok", "user": user}, cookie=auth.session_cookie(token))

    def _register(self):
        data = self._body()
        state = fresh_db().load_state()
        email = (data.get('email') or '').strip().lower()
        password = data.get('password') or ''
        if not email or not password:
            return self._json(400, {"status": "error", "message": "Email and password are required."})
        if auth.find_user(state, email):
            return self._json(409, {"status": "error",
                                    "message": "An account with this email already exists."})

        role_category = data.get('role') or 'Faculty'
        user = {
            "id": "REG-%04d" % (int.from_bytes(os.urandom(2), 'big') % 10000),
            "name": (data.get('name') or '').strip() or email.split('@')[0],
            "designation": role_category,
            "email": email,
            "dept": data.get('dept') or 'CSE',
            "password": password,
            "can_edit": False,
            "can_manage_faculty": False,
            "role": f"{role_category} (View-Only)",
        }
        auth_system = state.setdefault('auth_system', {})
        auth_system.setdefault('faculty_roster', []).append(user)
        persist(state)

        token = auth.create_session(user)
        self._json(201, {"status": "ok", "user": auth.public_user(user)},
                   cookie=auth.session_cookie(token))

    def _request_reset(self):
        data = self._body()
        state = fresh_db().load_state()
        email = (data.get('email') or '').strip().lower()
        user = auth.find_user(state, email)
        if not user:
            return self._json(404, {"status": "error",
                                    "message": "No registered account found for this email."})
        otp = auth.issue_otp(email)
        # Stands in for the email that a production deployment would send.
        self._json(200, {"status": "ok", "otp": otp, "name": user.get('name')})

    def _reset_password(self):
        data = self._body()
        email = (data.get('email') or '').strip().lower()
        if not auth.consume_otp(email, data.get('otp')):
            return self._json(400, {"status": "error",
                                    "message": "Invalid or expired verification code."})
        new_password = data.get('password') or ''
        if len(new_password) < 4:
            return self._json(400, {"status": "error",
                                    "message": "Password must be at least 4 characters long."})

        state = fresh_db().load_state()
        user = auth.find_user(state, email)
        if not user:
            return self._json(404, {"status": "error", "message": "Account not found."})
        user['password'] = new_password
        persist(state)
        self._json(200, {"status": "ok", "message": "Password updated."})

    def _save_state(self):
        if not self._require_editor():
            return
        data = with_preserved_secrets(self._body())
        persist(data)
        self._json(200, {"status": "ok",
                         "message": "State saved and Word documents updated."})

    # ------------------------------------------------------------ GET

    def do_GET(self):
        path = self.path.split('?')[0]

        # Single source of truth: SQLite. The frontend receives the same JSON
        # shape as before, minus passwords unless an administrator is signed in.
        if path == '/api/state':
            try:
                state = fresh_db().load_state()
                viewer = self._user()
                payload = json.dumps(auth.redact_passwords(state, viewer),
                                     ensure_ascii=False).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except Exception as e:
                traceback.print_exc()
                self._json(500, {"status": "error", "message": str(e)})
            return

        if path == '/api/session':
            user = self._user()
            if not user:
                return self._json(401, {"status": "error", "user": None})
            return self._json(200, {"status": "ok", "user": user})

        if self.path.startswith('/api/download/scheme-docx'):
            file_path = "Generated_CSE_2024_SCHEME.docx"
            # Always rebuild from the live data and the current exporter code.
            # Previously this only ran when the file was missing, so every
            # download handed back a stale document.
            try:
                fresh_exporter().main()
            except Exception as e:
                print(f"Export error: {e}")

            if os.path.exists(file_path):
                self.send_response(200)
                self.send_header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
                self.send_header('Content-Disposition', 'attachment; filename="CSE_2024_SCHEME.docx"')
                with open(file_path, 'rb') as f:
                    file_content = f.read()
                self.send_header('Content-Length', str(len(file_content)))
                self.end_headers()
                self.wfile.write(file_content)
                return
            else:
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"Scheme Word document not found.")
                return

        elif self.path.startswith('/api/download/syllabus-docx'):
            parsed_url = urllib.parse.urlparse(self.path)
            query_params = urllib.parse.parse_qs(parsed_url.query)
            course_code = query_params.get('course', ['ALL'])[0]

            try:
                export_docx = fresh_exporter()
                with open("data/default_data.json", "r", encoding="utf-8") as f:
                    data = json.load(f)
                cse_data = next((d for d in data.get("departments", []) if d.get("code") == "CSE"), None)

                if course_code and course_code != 'ALL':
                    file_path = f"Generated_CSE_SYLLABUS_{course_code}.docx"
                    download_filename = f"CSE_Syllabus_{course_code}.docx"
                    export_docx.generate_syllabus_docx(cse_data, output_path=file_path, filter_code=course_code)
                else:
                    file_path = "Generated_CSE_SYLLABUS.docx"
                    download_filename = "CSE_SYLLABUS_All_Courses.docx"
                    export_docx.generate_syllabus_docx(cse_data, output_path=file_path, filter_code=None)
            except Exception as e:
                print(f"Export syllabus error: {e}")
                file_path = "Generated_CSE_SYLLABUS.docx"
                download_filename = "CSE_SYLLABUS.docx"

            if os.path.exists(file_path):
                self.send_response(200)
                self.send_header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
                self.send_header('Content-Disposition', f'attachment; filename="{download_filename}"')
                with open(file_path, 'rb') as f:
                    file_content = f.read()
                self.send_header('Content-Length', str(len(file_content)))
                self.end_headers()
                self.wfile.write(file_content)
                return
            else:
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"Syllabus Word document not found.")
                return

        super().do_GET()


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    url = f"http://localhost:{PORT}/index.html"

    # Create + seed the database on first run so the app works from a fresh clone.
    try:
        conn = fresh_db().ensure_ready()
        counts = fresh_db().stats(conn)
        conn.close()
        print("Database:", os.path.abspath(db.DB_PATH))
        print("Rows:", ", ".join(f"{k}={v}" for k, v in counts.items() if v))
    except Exception as e:
        print("Database initialisation failed:", e)
        traceback.print_exc()

    # Allow port reuse
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
        print("=" * 65)
        print("🎓 College Scheme & Syllabus Generator Platform")
        print("=" * 65)
        print(f"Server started at: {url}")
        print("Endpoints:")
        print("  - Web App: /index.html")
        print("  - Session: /api/login, /api/logout, /api/session")
        print("  - Download Scheme Word:   /api/download/scheme-docx")
        print("  - Download Syllabus Word: /api/download/syllabus-docx")
        print("  - Save State API:         /api/save-state")
        print("=" * 65)

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")
            httpd.server_close()
            sys.exit(0)


if __name__ == "__main__":
    main()
