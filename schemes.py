"""Scheme lifecycle: ownership, copies, approval status and version history.

A scheme is a first class document here, separate from the legacy
`departments.schemes` structure that the original editor still reads. Rows
reference departments and people by code/e-mail because `db.save_state()`
rewrites those tables whenever the whole state is saved.
"""

import datetime
import json
import os
import sqlite3
import uuid

import db

STATUS_DRAFT = 'Draft'
STATUS_PENDING_HOD = 'Pending HOD'
STATUS_CHANGES_HOD = 'Changes Requested by HOD'
STATUS_PENDING_DEAN = 'Pending Dean'
STATUS_CHANGES_DEAN = 'Changes Requested by Dean'
STATUS_APPROVED = 'Approved'

STATUSES = [STATUS_DRAFT, STATUS_PENDING_HOD, STATUS_CHANGES_HOD,
            STATUS_PENDING_DEAN, STATUS_CHANGES_DEAN, STATUS_APPROVED]

EDITABLE = {STATUS_DRAFT, STATUS_CHANGES_HOD, STATUS_CHANGES_DEAN}

COURSE_FIELDS = ['sl_no', 'type', 'code', 'title', 'td', 'psb', 'l', 't', 'p', 's',
                 'tot', 'exam_hours', 'cia', 'see', 'total', 'credits']


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _now():
    return datetime.datetime.now().isoformat(timespec='seconds')


def _text(value):
    return '' if value is None else str(value).strip()


def _int(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def ensure_schema(conn):
    conn.executescript(open(db.SCHEMA_PATH, encoding='utf-8').read())
    # Lightweight migrations for databases created before these columns existed.
    columns = {row[1] for row in conn.execute('PRAGMA table_info(schemes)')}
    if 'mail_status' not in columns:
        conn.execute("ALTER TABLE schemes ADD COLUMN mail_status TEXT NOT NULL DEFAULT ''")
    if 'mail_sent_at' not in columns:
        conn.execute("ALTER TABLE schemes ADD COLUMN mail_sent_at TEXT NOT NULL DEFAULT ''")
    conn.commit()


def _row(row):
    return dict(row) if row is not None else None


def _courses(conn, scheme_id):
    rows = conn.execute(
        'SELECT * FROM scheme_courses WHERE scheme_id = ? ORDER BY position, sl_no',
        (scheme_id,)).fetchall()
    return [_row(r) for r in rows]


def _snapshot(conn, scheme_id):
    meta = _row(conn.execute('SELECT * FROM schemes WHERE id = ?', (scheme_id,)).fetchone())
    if not meta:
        return None
    meta.pop('id', None)
    meta['courses'] = _courses(conn, scheme_id)
    return meta


def _next_version(conn, scheme_id):
    row = conn.execute(
        'SELECT COALESCE(MAX(version_no), 0) + 1 FROM scheme_versions WHERE scheme_id = ?',
        (scheme_id,)).fetchone()
    return int(row[0])


def _write_version(conn, scheme_id, user_email, note):
    snapshot = _snapshot(conn, scheme_id)
    conn.execute(
        'INSERT INTO scheme_versions (scheme_id, version_no, snapshot, note, created_by, created_at) '
        'VALUES (?, ?, ?, ?, ?, ?)',
        (scheme_id, _next_version(conn, scheme_id), json.dumps(snapshot, ensure_ascii=False),
         note, user_email, _now()))


def _touch(conn, scheme_id):
    conn.execute('UPDATE schemes SET updated_at = ? WHERE id = ?', (_now(), scheme_id))


# --------------------------------------------------------------------------- #
# reads
# --------------------------------------------------------------------------- #
def list_schemes(conn, user, scope='mine', filters=None):
    filters = filters or {}
    where, args = [], []
    role = (user or {}).get('role') or ''
    if scope == 'mine':
        where.append("owner_email = ?")
        args.append((user or {}).get('email', ''))
    elif scope == 'approvals':
        if role == 'HOD':
            dept = (user or {}).get('dept') or (user or {}).get('department_code') or ''
            if not dept:
                row = conn.execute('SELECT department_code FROM users WHERE email = ?',
                                   ((user or {}).get('email', ''),)).fetchone()
                dept = (row[0] or '') if row else ''
            where.append("status = 'Pending HOD'")
            where.append("department_code = ?")
            args.append(dept)
        elif role == 'DEAN':
            where.append("status = 'Pending Dean'")
        elif role == 'ADMIN':
            where.append("status IN ('Pending Dean', 'Pending HOD')")
        else:
            where.append('0 = 1')
    else:
        # shared library: approved schemes published for reuse, never my own
        where.append("visibility = 'library'")
        where.append("owner_email <> ?")
        args.append((user or {}).get('email', ''))

    mapping = {
        'department': 'department_code',
        'semester': 'semester',
        'academic_year': 'academic_year',
        'regulation': 'regulation',
        'status': 'status',
    }
    for key, column in mapping.items():
        value = _text(filters.get(key))
        if value and value.upper() != 'ALL':
            where.append(f'{column} = ?')
            args.append(value)

    sql = 'SELECT * FROM schemes'
    if where:
        sql += ' WHERE ' + ' AND '.join(where)
    sql += ' ORDER BY updated_at DESC'

    items = []
    for row in conn.execute(sql, args).fetchall():
        item = _row(row)
        course_args = [item['id']]
        course_where = ''
        code = _text(filters.get('code'))
        title = _text(filters.get('title'))
        if code:
            course_where += ' AND LOWER(code) LIKE ?'
            course_args.append(f'%{code.lower()}%')
        if title:
            course_where += ' AND LOWER(title) LIKE ?'
            course_args.append(f'%{title.lower()}%')
        courses = conn.execute(
            'SELECT * FROM scheme_courses WHERE scheme_id = ?' + course_where, course_args).fetchall()
        item['courses'] = [_row(c) for c in courses]
        item['course_count'] = len(item['courses'])
        item['credits'] = sum(_int(c['credits']) for c in item['courses'])
        # Resolve the reviewer here: the client never sees per-user departments.
        hod = conn.execute(
            "SELECT name FROM users WHERE role = 'HOD' AND department_code = ? LIMIT 1",
            (item['department_code'],)).fetchone()
        item['hod_name'] = hod[0] if hod else ''
        dean = conn.execute("SELECT name FROM users WHERE role = 'DEAN' LIMIT 1").fetchone()
        item['dean_name'] = dean[0] if dean else ''
        item.pop('id', None)
        items.append(item)
    return items


def get_scheme(conn, scheme_uuid):
    row = conn.execute('SELECT * FROM schemes WHERE uuid = ?', (scheme_uuid,)).fetchone()
    if not row:
        return None
    item = _row(row)
    item['courses'] = _courses(conn, item['id'])
    item.pop('id', None)
    return item


# --------------------------------------------------------------------------- #
# writes
# --------------------------------------------------------------------------- #
def create_scheme(conn, user, payload):
    name = _text(payload.get('name'))
    dept = _text(payload.get('department') or payload.get('department_code'))
    semester = _text(payload.get('semester'))
    if not dept or not semester:
        raise ValueError('Department and semester are required')

    scheme_uuid = uuid.uuid4().hex[:12]
    if not name:
        name = f'{dept} Semester {semester}'
    now = _now()
    cur = conn.execute(
        'INSERT INTO schemes (uuid, name, department_code, semester, academic_year, regulation, '
        'status, owner_email, visibility, source_uuid, created_at, updated_at) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (scheme_uuid, name, dept, semester, _text(payload.get('academic_year')),
         _text(payload.get('regulation')), STATUS_DRAFT,
         (user or {}).get('email', ''), 'personal', _text(payload.get('source_uuid')),
         now, now))
    scheme_id = cur.lastrowid
    _replace_courses(conn, scheme_id, payload.get('courses') or [])
    _write_version(conn, scheme_id, (user or {}).get('email', ''), 'Created')
    conn.commit()
    return get_scheme(conn, scheme_uuid)


def _replace_courses(conn, scheme_id, courses):
    conn.execute('DELETE FROM scheme_courses WHERE scheme_id = ?', (scheme_id,))
    for pos, course in enumerate(courses or []):
        conn.execute(
            'INSERT INTO scheme_courses (scheme_id, sl_no, type, code, title, td, psb, l, t, p, s, '
            'tot, exam_hours, cia, see, total, credits, position) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (scheme_id,
             _int(course.get('sl_no')) or _int(course.get('sl')) or pos + 1,
             _text(course.get('type')).upper(),
             _text(course.get('code')).upper(),
             _text(course.get('title')),
             _text(course.get('td')),
             _text(course.get('psb')),
             _int(course.get('l')), _int(course.get('t')), _int(course.get('p')), _int(course.get('s')),
             _int(course.get('tot')),
             _text(course.get('exam_hours')),
             _int(course.get('cia')), _int(course.get('see')), _int(course.get('total')),
             # The editor still speaks the legacy 'c' key for credits.
             _int(course.get('credits') if course.get('credits') not in (None, '') else course.get('c')),
             pos))


def update_scheme(conn, user, scheme_uuid, payload, note='Edited'):
    row = conn.execute('SELECT * FROM schemes WHERE uuid = ?', (scheme_uuid,)).fetchone()
    if not row:
        raise KeyError('Scheme not found')
    scheme = _row(row)

    owner = scheme['owner_email'] == (user or {}).get('email', '')
    if not owner:
        raise PermissionError('Only the owner can edit this scheme')
    if scheme['status'] not in EDITABLE:
        raise PermissionError(f'Scheme is {scheme["status"]} and can no longer be edited')

    fields = {}
    for key in ('name', 'academic_year', 'regulation'):
        if key in payload:
            fields[key] = _text(payload[key])
    if fields:
        assignments = ', '.join(f'{k} = ?' for k in fields)
        conn.execute(f'UPDATE schemes SET {assignments}, updated_at = ? WHERE id = ?',
                     (*fields.values(), _now(), scheme['id']))

    if 'courses' in payload:
        _replace_courses(conn, scheme['id'], payload.get('courses') or [])

    _touch(conn, scheme['id'])
    _write_version(conn, scheme['id'], (user or {}).get('email', ''), note)
    conn.commit()
    return get_scheme(conn, scheme_uuid)


def copy_scheme(conn, user, scheme_uuid):
    source = get_scheme(conn, scheme_uuid)
    if not source:
        raise KeyError('Scheme not found')
    payload = {
        'name': f"{source['name']} (My Copy)",
        'department': source['department_code'],
        'semester': source['semester'],
        'academic_year': source['academic_year'],
        'regulation': source['regulation'],
        'source_uuid': source['uuid'] if 'uuid' in source else scheme_uuid,
        'courses': source['courses'],
    }
    return create_scheme(conn, user, payload)


def delete_scheme(conn, user, scheme_uuid):
    row = conn.execute('SELECT * FROM schemes WHERE uuid = ?', (scheme_uuid,)).fetchone()
    if not row:
        raise KeyError('Scheme not found')
    scheme = _row(row)
    is_owner = scheme['owner_email'] == (user or {}).get('email', '')
    if not is_owner and (user or {}).get('role') != 'ADMIN':
        raise PermissionError('Only the owner can delete this scheme')
    # Any status may be deleted, approved documents included: the owner is
    # allowed to withdraw a scheme from the record. Copies already mailed out
    # stay with their recipients, which the UI warns about before deleting.
    conn.execute('DELETE FROM schemes WHERE id = ?', (scheme['id'],))
    conn.commit()
    return True


def transition(conn, user, scheme_uuid, action, note=''):
    row = conn.execute('SELECT * FROM schemes WHERE uuid = ?', (scheme_uuid,)).fetchone()
    if not row:
        raise KeyError('Scheme not found')
    scheme = _row(row)
    role = (user or {}).get('role') or ''
    email = (user or {}).get('email') or ''
    dept = (user or {}).get('dept') or (user or {}).get('department_code') or ''
    if not dept:
        row_dept = conn.execute('SELECT department_code FROM users WHERE email = ?',
                                (email,)).fetchone()
        dept = (row_dept[0] or '') if row_dept else ''
    owner = scheme['owner_email'] == email
    admin = role == 'ADMIN'

    def need(ok, message):
        if not ok:
            raise PermissionError(message)

    if action == 'submit':
        need(owner, 'Only the owner can submit this scheme')
        need(scheme['status'] in EDITABLE, 'This scheme is not in an editable state')
        new_status = STATUS_PENDING_HOD
    elif action == 'hod_forward':
        need(admin or (role == 'HOD' and dept == scheme['department_code']),
             'Only the department HOD can forward a scheme')
        need(scheme['status'] == STATUS_PENDING_HOD, 'Scheme is not awaiting HOD review')
        new_status = STATUS_PENDING_DEAN
    elif action == 'hod_changes':
        need(admin or (role == 'HOD' and dept == scheme['department_code']),
             'Only the department HOD can return a scheme')
        need(scheme['status'] == STATUS_PENDING_HOD, 'Scheme is not awaiting HOD review')
        new_status = STATUS_CHANGES_HOD
    elif action == 'dean_approve':
        need(admin or role == 'DEAN', 'Only the Dean can approve a scheme')
        need(scheme['status'] == STATUS_PENDING_DEAN, 'Scheme is not awaiting Dean approval')
        new_status = STATUS_APPROVED
    elif action == 'dean_changes':
        need(admin or role == 'DEAN', 'Only the Dean can return a scheme')
        need(scheme['status'] == STATUS_PENDING_DEAN, 'Scheme is not awaiting Dean approval')
        new_status = STATUS_CHANGES_DEAN
    else:
        raise ValueError(f'Unknown action: {action}')

    now = _now()
    submitted = now if action == 'submit' else scheme['submitted_at']
    decided_at = now if new_status in (STATUS_APPROVED, STATUS_CHANGES_HOD, STATUS_CHANGES_DEAN) \
        else scheme['decided_at']
    decided_by = email if new_status != STATUS_PENDING_HOD else ''
    visibility = 'library' if new_status == STATUS_APPROVED else scheme['visibility']

    conn.execute(
        'UPDATE schemes SET status = ?, submitted_at = ?, decided_at = ?, decided_by = ?, '
        'visibility = ?, updated_at = ? WHERE id = ?',
        (new_status, submitted, decided_at, decided_by, visibility, now, scheme['id']))
    _write_version(conn, scheme['id'], email, note or f'Status: {new_status}')
    conn.commit()

    if new_status == STATUS_APPROVED:
        # Mail the approved copy to the owner's registered address. Never let a
        # mail failure roll back the approval itself.
        try:
            _mail_approval(conn, scheme_uuid)
        except Exception as exc:  # pragma: no cover - defensive
            conn.execute("UPDATE schemes SET mail_status = 'error', mail_sent_at = ? WHERE uuid = ?",
                         (_now(), scheme_uuid))
            conn.commit()
            print(f'Approval mail failed: {exc}')

    return get_scheme(conn, scheme_uuid)


def _approved_docx(scheme):
    """Build the approved document in memory so it can be attached."""
    import tempfile
    import export_docx

    path = os.path.join(tempfile.gettempdir(), f"approved_{scheme.get('uuid', 'scheme')}.docx")
    export_docx.generate_scheme_docx(to_dept_data(scheme), path)
    with open(path, 'rb') as handle:
        return handle.read()


def _mail_approval(conn, scheme_uuid):
    import importlib
    import mailer
    mailer = importlib.reload(mailer)

    scheme = get_scheme(conn, scheme_uuid)
    if not scheme:
        return {'status': 'error', 'detail': 'Scheme not found'}

    owner = conn.execute('SELECT name FROM users WHERE email = ?',
                         (scheme.get('owner_email', ''),)).fetchone()
    scheme['owner_name'] = owner[0] if owner else ''

    try:
        payload = _approved_docx(scheme)
    except Exception as exc:
        payload = None
        print(f'Could not render approved document: {exc}')

    result = mailer.send_approval_mail(scheme, payload)
    conn.execute('UPDATE schemes SET mail_status = ?, mail_sent_at = ? WHERE uuid = ?',
                 (result.get('status', ''), result.get('at', ''), scheme_uuid))
    conn.commit()
    return result


def resend_approval_mail(conn, user, scheme_uuid):
    scheme = get_scheme(conn, scheme_uuid)
    if not scheme:
        raise KeyError('Scheme not found')
    role = (user or {}).get('role') or ''
    if (user or {}).get('email') != scheme.get('owner_email') and role != 'ADMIN':
        raise PermissionError('Only the owner can resend the approved copy')
    if scheme.get('status') != STATUS_APPROVED:
        raise PermissionError('Only an approved scheme can be mailed')
    return _mail_approval(conn, scheme_uuid)


def list_versions(conn, scheme_uuid):
    row = conn.execute('SELECT id FROM schemes WHERE uuid = ?', (scheme_uuid,)).fetchone()
    if not row:
        raise KeyError('Scheme not found')
    rows = conn.execute(
        'SELECT version_no, note, created_by, created_at FROM scheme_versions '
        'WHERE scheme_id = ? ORDER BY version_no DESC', (row[0],)).fetchall()
    return [_row(r) for r in rows]


def restore_version(conn, user, scheme_uuid, version_no):
    row = conn.execute('SELECT * FROM schemes WHERE uuid = ?', (scheme_uuid,)).fetchone()
    if not row:
        raise KeyError('Scheme not found')
    scheme = _row(row)
    if scheme['owner_email'] != (user or {}).get('email', ''):
        raise PermissionError('Only the owner can restore a version')
    if scheme['status'] not in EDITABLE:
        raise PermissionError('Only an editable scheme can be restored')

    vrow = conn.execute(
        'SELECT snapshot FROM scheme_versions WHERE scheme_id = ? AND version_no = ?',
        (scheme['id'], version_no)).fetchone()
    if not vrow:
        raise KeyError('Version not found')
    snapshot = json.loads(vrow[0])

    conn.execute('UPDATE schemes SET name = ?, academic_year = ?, regulation = ?, updated_at = ? '
                 'WHERE id = ?',
                 (snapshot.get('name', scheme['name']),
                  snapshot.get('academic_year', scheme['academic_year']),
                  snapshot.get('regulation', scheme['regulation']),
                  _now(), scheme['id']))
    _replace_courses(conn, scheme['id'], snapshot.get('courses') or [])
    _write_version(conn, scheme['id'], (user or {}).get('email', ''), f'Restored v{version_no}')
    conn.commit()
    return get_scheme(conn, scheme_uuid)


def to_dept_data(scheme):
    """Shape a scheme like the legacy department dict the exporter expects."""
    from_sem = str(scheme.get('semester') or '1').strip()
    numbers = {'I': '1', 'II': '2', 'III': '3', 'IV': '4', 'V': '5', 'VI': '6',
               'VII': '7', 'VIII': '8'}
    sem_key = numbers.get(from_sem.upper(), from_sem)
    # The exporter speaks the legacy key names (sl, c), the database speaks
    # sl_no/credits. Normalise here so neither side has to know about the other.
    courses = []
    for idx, course in enumerate(scheme.get('courses') or []):
        credits = course.get('credits')
        if credits in (None, ''):
            credits = course.get('c', 0)
        courses.append({
            'sl': course.get('sl_no') or course.get('sl') or idx + 1,
            'type': course.get('type', ''),
            'code': course.get('code', ''),
            'title': course.get('title', ''),
            'td': course.get('td', ''),
            'psb': course.get('psb', ''),
            'l': course.get('l', 0),
            't': course.get('t', 0),
            'p': course.get('p', 0),
            's': course.get('s', 0),
            'tot': course.get('tot', 0),
            'exam_hours': course.get('exam_hours', ''),
            'cia': course.get('cia', 0),
            'see': course.get('see', 0),
            'total': course.get('total', 0),
            'c': credits or 0,
        })

    return {
        'code': scheme.get('department_code', ''),
        'name': scheme.get('department_name') or scheme.get('department_code', ''),
        'schemes': {sem_key: courses},
    }
