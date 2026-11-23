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
import schemes

PORT = 8000


def fresh_db():
    """Reload db.py too, so schema/persistence edits apply without a restart."""
    return importlib.reload(db)


def fresh_schemes():
    """Reload schemes.py for the same reason db/export_docx are reloaded."""
    import schemes as _schemes
    return importlib.reload(_schemes)


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
            if path == '/api/schemes':
                return self._scheme_create()
            if path.startswith('/api/schemes/'):
                return self._scheme_write(path)
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

    # ------------------------------------------------------------ schemes
    def _scheme_conn(self):
        conn = fresh_db().ensure_ready()
        fresh_schemes().ensure_schema(conn)
        return conn

    def _scheme_list(self):
        user = self._user()
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        scope = (qs.get('scope', ['mine'])[0] or 'mine').lower()
        filters = {k: qs[k][0] for k in
                   ('department', 'semester', 'academic_year', 'regulation', 'status', 'code', 'title')
                   if qs.get(k)}
        if scope == 'mine' and not user:
            return self._json(401, {"status": "error", "message": "Sign in to see your schemes."})
        conn = self._scheme_conn()
        try:
            items = fresh_schemes().list_schemes(conn, user or {}, scope, filters)
        except Exception as e:
            traceback.print_exc()
            return self._json(500, {"status": "error", "message": str(e)})
        finally:
            conn.close()
        return self._json(200, {"status": "ok", "scope": scope,
                                "count": len(items), "items": items})

    def _scheme_read(self, path):
        parts = [p for p in path.split('/') if p]
        if len(parts) < 3:
            return self._json(404, {"status": "error", "message": "Scheme id missing"})
        scheme_uuid = parts[2]
        tail = parts[3] if len(parts) > 3 else ''
        conn = self._scheme_conn()
        try:
            mod = fresh_schemes()
            if tail == 'versions':
                return self._json(200, {"status": "ok", "items": mod.list_versions(conn, scheme_uuid)})
            item = mod.get_scheme(conn, scheme_uuid)
        except KeyError as e:
            return self._json(404, {"status": "error", "message": str(e)})
        except Exception as e:
            traceback.print_exc()
            return self._json(500, {"status": "error", "message": str(e)})
        finally:
            conn.close()
        if not item:
            return self._json(404, {"status": "error", "message": "Scheme not found"})
        return self._json(200, {"status": "ok", "scheme": item})

    def _scheme_create(self):
        user = self._require_editor()
        if not user:
            return
        payload = self._body()
        conn = self._scheme_conn()
        try:
            item = fresh_schemes().create_scheme(conn, user, payload)
        except ValueError as e:
            return self._json(400, {"status": "error", "message": str(e)})
        except Exception as e:
            traceback.print_exc()
            return self._json(500, {"status": "error", "message": str(e)})
        finally:
            conn.close()
        return self._json(201, {"status": "ok", "scheme": item})

    def _scheme_write(self, path):
        user = self._require_editor()
        if not user:
            return
        parts = [p for p in path.split('/') if p]
        if len(parts) < 3:
            return self._json(400, {"status": "error", "message": "Scheme id missing"})
        scheme_uuid = parts[2]
        action = parts[3] if len(parts) > 3 else 'update'
        payload = self._body()
        conn = self._scheme_conn()
        try:
            mod = fresh_schemes()
            if action == 'update':
                item = mod.update_scheme(conn, user, scheme_uuid, payload)
            elif action == 'copy':
                item = mod.copy_scheme(conn, user, scheme_uuid)
            elif action == 'status':
                item = mod.transition(conn, user, scheme_uuid,
                                      payload.get('action', ''), payload.get('note', ''))
            elif action == 'restore':
                item = mod.restore_version(conn, user, scheme_uuid, int(payload.get('version_no') or 0))
            elif action == 'email':
                result = mod.resend_approval_mail(conn, user, scheme_uuid)
                return self._json(200, {"status": "ok", "mail": result,
                                        "scheme": mod.get_scheme(conn, scheme_uuid)})
            elif action == 'delete':
                mod.delete_scheme(conn, user, scheme_uuid)
                return self._json(200, {"status": "ok", "message": "Scheme deleted"})
            else:
                return self._json(400, {"status": "error", "message": f"Unknown action: {action}"})
        except PermissionError as e:
            return self._json(403, {"status": "error", "message": str(e)})
        except KeyError as e:
            return self._json(404, {"status": "error", "message": str(e)})
        except ValueError as e:
            return self._json(400, {"status": "error", "message": str(e)})
        except Exception as e:
            traceback.print_exc()
            return self._json(500, {"status": "error", "message": str(e)})
        finally:
            conn.close()
        return self._json(200, {"status": "ok", "scheme": item})

    def _scheme_docx(self, path):
        scheme_uuid = path.rsplit('/', 1)[-1].replace('.docx', '')
        conn = self._scheme_conn()
        try:
            item = fresh_schemes().get_scheme(conn, scheme_uuid)
            dept = conn.execute('SELECT name FROM departments WHERE code = ?',
                                (item['department_code'],)).fetchone() if item else None
        finally:
            conn.close()
        if not item:
            return self._json(404, {"status": "error", "message": "Scheme not found"})
        item['department_name'] = dept[0] if dept else item['department_code']
        dept_data = fresh_schemes().to_dept_data(item)
        out_path = os.path.join(db.DATA_DIR, f'Generated_{scheme_uuid}.docx')
        try:
            fresh_exporter().generate_scheme_docx(dept_data, out_path)
        except Exception as e:
            traceback.print_exc()
            return self._json(500, {"status": "error", "message": f"Export failed: {e}"})
        with open(out_path, 'rb') as f:
            body = f.read()
        self.send_response(200)
        self.send_header('Content-Type',
                         'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        self.send_header('Content-Disposition',
                         f'attachment; filename="{item["department_code"]}_{item["semester"]}_SCHEME.docx"')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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

        if path == '/api/schemes':
            return self._scheme_list()

        if path.startswith('/api/schemes/'):
            return self._scheme_read(path)

        if path.startswith('/api/download/scheme/'):
            return self._scheme_docx(path)

        if path == '/api/mail/status':
            try:
                import importlib
                import mailer
                mailer = importlib.reload(mailer)
                config = mailer.load_config()
                return self._json(200, {"status": "ok",
                                        "configured": bool(config.get('configured')),
                                        "sender": config.get('sender', ''),
                                        "preview_dir": mailer.OUTBOX_DIR})
            except Exception as e:
                return self._json(500, {"status": "error", "message": str(e)})

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
    with http.server.ThreadingHTTPServer(("", PORT), CustomHandler) as httpd:
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
