"""
SQLite persistence layer for the Scheme & Syllabus Generator.

The application used to keep its entire state in data/default_data.json and
rewrite the whole file on every edit. This module replaces that with a
normalised SQLite database (data/curriculum.db) while keeping the exact same
dictionary shape on the way in and out, so app.js and export_docx.py need no
knowledge of the schema.

    load_state()  -> dict  (same shape as the old JSON)
    save_state(d) -> None  (transactional replacement)

Command line:
    python db.py init            create the database and import the JSON if present
    python db.py import [path]   replace database contents from JSON
    python db.py export [path]   write the JSON mirror from the database
    python db.py stats           row counts
    python db.py check           round-trip compare database against the JSON file
    python db.py backup [dir]    timestamped copy of the database file
"""

import json
import os
import shutil
import sqlite3
import sys
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "curriculum.db")
JSON_PATH = os.path.join(DATA_DIR, "default_data.json")
SCHEMA_PATH = os.path.join(BASE_DIR, "schema.sql")
SCHEMA_VERSION = "1"

ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8}


# --------------------------------------------------------------------------- #
# Connection
# --------------------------------------------------------------------------- #
def connect(path=None):
    path = path or DB_PATH
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db(path=None, reset=False):
    path = path or DB_PATH
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    if reset and os.path.exists(path):
        for suffix in ("", "-wal", "-shm"):
            if os.path.exists(path + suffix):
                os.remove(path + suffix)
    conn = connect(path)
    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        conn.executescript(f.read())
    conn.execute(
        "INSERT INTO meta (key, value) VALUES ('schema_version', ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (SCHEMA_VERSION,),
    )
    conn.commit()
    return conn


def ensure_ready():
    """Open the database, creating and seeding it from JSON on first run."""
    fresh = not os.path.exists(DB_PATH)
    conn = init_db() if fresh else connect()
    if is_empty(conn) and os.path.exists(JSON_PATH):
        import_json(conn, JSON_PATH)
    return conn


def is_empty(conn):
    return conn.execute("SELECT COUNT(*) FROM departments").fetchone()[0] == 0


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _i(value, default=0):
    try:
        if value is None or value == "":
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def _s(value):
    return "" if value is None else str(value)


def _semester_number(value):
    if isinstance(value, int):
        return value
    text = _s(value).strip().upper()
    if text.isdigit():
        return int(text)
    return ROMAN.get(text, 0)


# --------------------------------------------------------------------------- #
# Write
# --------------------------------------------------------------------------- #
def save_state(state, conn=None):
    """Replace the database contents with `state` in one transaction."""
    own = conn is None
    conn = conn or connect()
    skipped_syllabi = []

    with conn:
        conn.execute("DELETE FROM departments")
        conn.execute("DELETE FROM users")

        for dept_pos, dept in enumerate(state.get("departments", [])):
            cur = conn.execute(
                "INSERT INTO departments (code, name, status, hod, regulations, position) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (_s(dept.get("code")), _s(dept.get("name")), _s(dept.get("status")),
                 _s(dept.get("hod")), _s(dept.get("regulations")), dept_pos),
            )
            dept_id = cur.lastrowid
            semester_ids = {}
            course_ids = {}

            for sem_key, courses in (dept.get("schemes") or {}).items():
                sem_no = _semester_number(sem_key)
                sem_cur = conn.execute(
                    "INSERT INTO semesters (department_id, number) VALUES (?, ?)",
                    (dept_id, sem_no),
                )
                sem_id = sem_cur.lastrowid
                semester_ids[sem_key] = sem_id

                for pos, course in enumerate(courses or []):
                    cur = conn.execute(
                        "INSERT INTO courses (department_id, semester_id, sl_no, type, code, title, "
                        "td, psb, l, t, p, s, tot, exam_hours, cia, see, total, credits, position) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            dept_id, sem_id,
                            course.get("sl"), _s(course.get("type")), _s(course.get("code")),
                            _s(course.get("title")), _s(course.get("td")), _s(course.get("psb")),
                            _i(course.get("l")), _i(course.get("t")), _i(course.get("p")),
                            _i(course.get("s")), _i(course.get("tot")), _i(course.get("exam_hours")),
                            _i(course.get("cia")), _i(course.get("see")), _i(course.get("total")),
                            _i(course.get("c")), pos,
                        ),
                    )
                    course_ids[_s(course.get("code"))] = cur.lastrowid

            for code, syl in (dept.get("syllabi") or {}).items():
                course_id = course_ids.get(code)
                if not course_id:
                    skipped_syllabi.append(f"{dept.get('code')}/{code}")
                    continue
                practicals = syl.get("practicals") or {}
                cur = conn.execute(
                    "INSERT INTO syllabi (course_id, department_id, title, semester, code, type, "
                    "cia, see, slt, l, t, p, s, total_marks, credits, exam_hours, exam_type, "
                    "prerequisites, course_objectives, has_practical) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        course_id, dept_id, _s(syl.get("title")), _s(syl.get("semester")),
                        _s(syl.get("code")), _s(syl.get("type")), _i(syl.get("cia")), _i(syl.get("see")),
                        _s(syl.get("slt")), _i(syl.get("l")), _i(syl.get("t")), _i(syl.get("p")),
                        _i(syl.get("s")), _i(syl.get("total_marks")), _i(syl.get("credits")),
                        _s(syl.get("exam_hours")), _s(syl.get("exam_type")),
                        _s(syl.get("prerequisites")), _s(syl.get("course_objectives")),
                        1 if practicals.get("has_practical") else 0,
                    ),
                )
                syl_id = cur.lastrowid

                for pos, co in enumerate(syl.get("outcomes") or []):
                    conn.execute(
                        "INSERT INTO course_outcomes (syllabus_id, co_id, description, cl, pl, position) "
                        "VALUES (?, ?, ?, ?, ?, ?)",
                        (syl_id, _s(co.get("id")), _s(co.get("desc")), _s(co.get("cl")),
                         _s(co.get("pl")), pos),
                    )

                for pos, row in enumerate(syl.get("co_assessment") or []):
                    conn.execute(
                        "INSERT INTO co_assessment (syllabus_id, co, cie1, cie2, assignment, see, position) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (syl_id, _s(row.get("co")), _s(row.get("cie1")), _s(row.get("cie2")),
                         _s(row.get("assignment")), _s(row.get("see")), pos),
                    )

                for pos, mod in enumerate(syl.get("modules") or []):
                    conn.execute(
                        "INSERT INTO modules (syllabus_id, number_label, co, level, content, "
                        "textbook_ref, position) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (syl_id, _s(mod.get("num")), _s(mod.get("co")), _s(mod.get("level")),
                         _s(mod.get("content")), _s(mod.get("textbook_ref")), pos),
                    )

                for part, key in (("A", "part_a"), ("B", "part_b")):
                    for pos, item in enumerate(practicals.get(key) or []):
                        conn.execute(
                            "INSERT INTO practical_items (syllabus_id, part, item_text, position) "
                            "VALUES (?, ?, ?, ?)",
                            (syl_id, part, _s(item), pos),
                        )

                for kind, key in (("textbook", "textbooks"), ("reference", "references")):
                    for pos, item in enumerate(syl.get(key) or []):
                        conn.execute(
                            "INSERT INTO books (syllabus_id, kind, item_text, position) VALUES (?, ?, ?, ?)",
                            (syl_id, kind, _s(item), pos),
                        )

                for pos, url in enumerate(syl.get("web_links") or []):
                    conn.execute(
                        "INSERT INTO web_links (syllabus_id, url, position) VALUES (?, ?, ?)",
                        (syl_id, _s(url), pos),
                    )

        auth = state.get("auth_system") or {}
        row_no = 0
        for kind, people in (("leadership", auth.get("leadership") or []),
                             ("faculty", auth.get("faculty_roster") or [])):
            for person in people:
                conn.execute(
                    "INSERT INTO users (external_id, name, email, password, role, title, designation, "
                    "department_code, can_edit, can_manage_faculty, badge_color, is_leadership, position) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        _s(person.get("id")), _s(person.get("name")), _s(person.get("email")),
                        _s(person.get("password")), _s(person.get("role")), _s(person.get("title")),
                        _s(person.get("designation")), _s(person.get("dept")),
                        1 if person.get("can_edit") else 0,
                        (1 if person.get("can_manage_faculty") else 0)
                        if (kind == "leadership" or "can_manage_faculty" in person) else None,
                        _s(person.get("badge_color")),
                        1 if kind == "leadership" else 0, row_no,
                    ),
                )
                row_no += 1

    if own:
        conn.close()
    return skipped_syllabi


# --------------------------------------------------------------------------- #
# Read
# --------------------------------------------------------------------------- #
def load_state(conn=None):
    own = conn is None
    conn = conn or connect()

    departments = []
    for dept in conn.execute("SELECT * FROM departments ORDER BY position, id"):
        dept_dict = {
            "code": dept["code"],
            "name": dept["name"],
            "status": dept["status"],
            "hod": dept["hod"],
            "regulations": dept["regulations"],
            "schemes": {},
            "syllabi": {},
        }

        for sem in conn.execute(
            "SELECT * FROM semesters WHERE department_id = ? ORDER BY number", (dept["id"],)
        ):
            courses = []
            for c in conn.execute(
                "SELECT * FROM courses WHERE semester_id = ? ORDER BY position, id", (sem["id"],)
            ):
                courses.append({
                    "type": c["type"],
                    "code": c["code"],
                    "title": c["title"],
                    "td": c["td"],
                    "psb": c["psb"],
                    "l": c["l"], "t": c["t"], "p": c["p"], "s": c["s"],
                    "tot": c["tot"],
                    "exam_hours": c["exam_hours"],
                    "cia": c["cia"], "see": c["see"], "total": c["total"],
                    "c": c["credits"],
                    "sl": c["sl_no"],
                })
            dept_dict["schemes"][str(sem["number"])] = courses

        for syl in conn.execute(
            "SELECT * FROM syllabi WHERE department_id = ? ORDER BY id", (dept["id"],)
        ):
            sid = syl["id"]
            dept_dict["syllabi"][syl["code"]] = {
                "title": syl["title"],
                "semester": syl["semester"],
                "code": syl["code"],
                "type": syl["type"],
                "cia": syl["cia"],
                "see": syl["see"],
                "slt": syl["slt"],
                "l": syl["l"], "t": syl["t"], "p": syl["p"], "s": syl["s"],
                "total_marks": syl["total_marks"],
                "credits": syl["credits"],
                "exam_hours": syl["exam_hours"],
                "exam_type": syl["exam_type"],
                "prerequisites": syl["prerequisites"],
                "course_objectives": syl["course_objectives"],
                "outcomes": [
                    {"id": r["co_id"], "desc": r["description"], "cl": r["cl"], "pl": r["pl"]}
                    for r in conn.execute(
                        "SELECT * FROM course_outcomes WHERE syllabus_id = ? ORDER BY position, id", (sid,)
                    )
                ],
                "co_assessment": [
                    {"co": r["co"], "cie1": r["cie1"], "cie2": r["cie2"],
                     "assignment": r["assignment"], "see": r["see"]}
                    for r in conn.execute(
                        "SELECT * FROM co_assessment WHERE syllabus_id = ? ORDER BY position, id", (sid,)
                    )
                ],
                "modules": [
                    {"num": r["number_label"], "co": r["co"], "level": r["level"],
                     "content": r["content"], "textbook_ref": r["textbook_ref"]}
                    for r in conn.execute(
                        "SELECT * FROM modules WHERE syllabus_id = ? ORDER BY position, id", (sid,)
                    )
                ],
                "practicals": {
                    "has_practical": bool(syl["has_practical"]),
                    "part_a": [r["item_text"] for r in conn.execute(
                        "SELECT * FROM practical_items WHERE syllabus_id = ? AND part = 'A' "
                        "ORDER BY position, id", (sid,))],
                    "part_b": [r["item_text"] for r in conn.execute(
                        "SELECT * FROM practical_items WHERE syllabus_id = ? AND part = 'B' "
                        "ORDER BY position, id", (sid,))],
                },
                "textbooks": [r["item_text"] for r in conn.execute(
                    "SELECT * FROM books WHERE syllabus_id = ? AND kind = 'textbook' "
                    "ORDER BY position, id", (sid,))],
                "references": [r["item_text"] for r in conn.execute(
                    "SELECT * FROM books WHERE syllabus_id = ? AND kind = 'reference' "
                    "ORDER BY position, id", (sid,))],
                "web_links": [r["url"] for r in conn.execute(
                    "SELECT * FROM web_links WHERE syllabus_id = ? ORDER BY position, id", (sid,))],
            }

        departments.append(dept_dict)

    leadership, faculty = [], []
    for u in conn.execute("SELECT * FROM users ORDER BY position, id"):
        if u["is_leadership"]:
            leadership.append({
                "id": u["external_id"], "name": u["name"], "title": u["title"],
                "email": u["email"], "password": u["password"], "role": u["role"],
                "can_edit": bool(u["can_edit"]),
                "can_manage_faculty": bool(u["can_manage_faculty"]),
                "badge_color": u["badge_color"],
            })
        else:
            record = {
                "id": u["external_id"], "name": u["name"], "designation": u["designation"],
                "email": u["email"], "dept": u["department_code"], "password": u["password"],
                "can_edit": bool(u["can_edit"]),
            }
            if u["can_manage_faculty"] is not None:
                record["can_manage_faculty"] = bool(u["can_manage_faculty"])
            record["role"] = u["role"]
            faculty.append(record)

    if own:
        conn.close()
    return {"departments": departments,
            "auth_system": {"leadership": leadership, "faculty_roster": faculty}}


# --------------------------------------------------------------------------- #
# JSON bridge
# --------------------------------------------------------------------------- #
def import_json(conn, path=None):
    path = path or JSON_PATH
    with open(path, "r", encoding="utf-8") as f:
        state = json.load(f)
    skipped = save_state(state, conn=conn)
    return state, skipped


def export_json(conn, path=None):
    path = path or JSON_PATH
    state = load_state(conn)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)
    return path


# --------------------------------------------------------------------------- #
# Ops
# --------------------------------------------------------------------------- #
def stats(conn=None):
    own = conn is None
    conn = conn or connect()
    tables = ["departments", "semesters", "courses", "syllabi", "course_outcomes",
              "co_assessment", "modules", "practical_items", "books", "web_links", "users"]
    counts = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tables}
    if own:
        conn.close()
    return counts


def backup(dest_dir=None):
    dest_dir = dest_dir or os.path.join(BASE_DIR, "backups")
    os.makedirs(dest_dir, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = os.path.join(dest_dir, f"curriculum-{stamp}.db")
    src = connect()
    out = sqlite3.connect(dest)
    with out:
        src.backup(out)
    out.close()
    src.close()
    return dest


def check(conn=None):
    """Compare the database against the JSON mirror; returns list of differences."""
    own = conn is None
    conn = conn or connect()
    db_state = load_state(conn)
    if own:
        conn.close()
    with open(JSON_PATH, "r", encoding="utf-8") as f:
        json_state = json.load(f)
    diffs = []

    db_depts = {d["code"]: d for d in db_state["departments"]}
    js_depts = {d["code"]: d for d in json_state.get("departments", [])}
    if set(db_depts) != set(js_depts):
        diffs.append(f"departments differ: db={sorted(db_depts)} json={sorted(js_depts)}")
    for code in sorted(set(db_depts) & set(js_depts)):
        d_db, d_js = db_depts[code], js_depts[code]
        for field in ("name", "status", "hod", "regulations"):
            if d_db.get(field) != d_js.get(field):
                diffs.append(f"{code}.{field}: db={d_db.get(field)!r} json={d_js.get(field)!r}")
        sems_db = {k: v for k, v in d_db["schemes"].items() if v}
        sems_js = {k: v for k, v in (d_js.get("schemes") or {}).items() if v}
        if set(sems_db) != set(sems_js):
            diffs.append(f"{code}.schemes: db={sorted(sems_db)} json={sorted(sems_js)}")
        for sem in sorted(set(sems_db) & set(sems_js)):
            if sems_db[sem] != sems_js[sem]:
                diffs.append(f"{code}.schemes[{sem}]: content differs")
        if set(d_db["syllabi"]) != set(d_js.get("syllabi") or {}):
            diffs.append(f"{code}.syllabi: db={sorted(d_db['syllabi'])} json={sorted(d_js.get('syllabi') or {})}")
        for syl_code in sorted(set(d_db["syllabi"]) & set(d_js.get("syllabi") or {})):
            if d_db["syllabi"][syl_code] != d_js["syllabi"][syl_code]:
                diffs.append(f"{code}.syllabi[{syl_code}]: content differs")

    for kind in ("leadership", "faculty_roster"):
        if db_state["auth_system"][kind] != (json_state.get("auth_system") or {}).get(kind):
            diffs.append(f"auth_system.{kind}: differs")
    return diffs


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def _main(argv):
    cmd = argv[1] if len(argv) > 1 else "help"

    if cmd == "init":
        conn = init_db(reset="--reset" in argv)
        if is_empty(conn) and os.path.exists(JSON_PATH):
            _, skipped = import_json(conn)
            print(f"Seeded {sum(stats(conn).values())} rows from {JSON_PATH}")
            if skipped:
                print("Skipped syllabi without a matching course:", ", ".join(skipped))
        print("Database:", DB_PATH)
        return 0

    if cmd == "import":
        path = next((a for a in argv[2:] if not a.startswith("-")), JSON_PATH)
        conn = init_db()
        _, skipped = import_json(conn, path)
        print(f"Imported {path}")
        print(json.dumps(stats(conn), indent=2))
        if skipped:
            print("Skipped syllabi without a matching course:", ", ".join(skipped))
        return 0

    if cmd == "export":
        path = next((a for a in argv[2:] if not a.startswith("-")), JSON_PATH)
        conn = connect()
        export_json(conn, path)
        print("Wrote", path)
        return 0

    if cmd == "stats":
        print(json.dumps(stats(), indent=2))
        return 0

    if cmd == "check":
        diffs = check()
        if not diffs:
            print("OK — database and JSON mirror agree")
            return 0
        print(f"{len(diffs)} difference(s):")
        for d in diffs:
            print(" -", d)
        return 1

    if cmd == "backup":
        path = next((a for a in argv[2:] if not a.startswith("-")), None)
        print("Backup written:", backup(path))
        return 0

    print(__doc__.strip())
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv))
