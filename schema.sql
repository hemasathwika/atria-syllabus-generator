-- Atria Autonomous — Scheme & Syllabus Generator
-- SQLite schema v1
--
-- Normalised replacement for the single data/default_data.json blob.
-- Every child table cascades from its parent, so deleting a department or a
-- course removes its schemes, syllabi, COs, modules and books in one step.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS departments (
    id          INTEGER PRIMARY KEY,
    code        TEXT    NOT NULL UNIQUE,          -- CSE, ECE, ME, CIVIL
    name        TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT '',
    hod         TEXT    NOT NULL DEFAULT '',
    regulations TEXT    NOT NULL DEFAULT '',
    position    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS semesters (
    id            INTEGER PRIMARY KEY,
    department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    number        INTEGER NOT NULL,
    UNIQUE (department_id, number)
);

CREATE TABLE IF NOT EXISTS courses (
    id            INTEGER PRIMARY KEY,
    department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    semester_id   INTEGER NOT NULL REFERENCES semesters(id)   ON DELETE CASCADE,
    sl_no         INTEGER,
    type          TEXT    NOT NULL DEFAULT '',   -- IPCC, PCC, ...
    code          TEXT    NOT NULL,              -- BBCOAB301
    title         TEXT    NOT NULL DEFAULT '',
    td            TEXT    NOT NULL DEFAULT '',
    psb           TEXT    NOT NULL DEFAULT '',
    l             INTEGER NOT NULL DEFAULT 0,
    t             INTEGER NOT NULL DEFAULT 0,
    p             INTEGER NOT NULL DEFAULT 0,
    s             INTEGER NOT NULL DEFAULT 0,
    tot           INTEGER NOT NULL DEFAULT 0,
    exam_hours    INTEGER NOT NULL DEFAULT 0,
    cia           INTEGER NOT NULL DEFAULT 0,
    see           INTEGER NOT NULL DEFAULT 0,
    total         INTEGER NOT NULL DEFAULT 0,
    credits       INTEGER NOT NULL DEFAULT 0,
    position      INTEGER NOT NULL DEFAULT 0,
    UNIQUE (department_id, code)
);

CREATE INDEX IF NOT EXISTS idx_courses_semester ON courses (semester_id, position);

CREATE TABLE IF NOT EXISTS syllabi (
    id                INTEGER PRIMARY KEY,
    course_id         INTEGER NOT NULL UNIQUE REFERENCES courses(id) ON DELETE CASCADE,
    department_id     INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    title             TEXT    NOT NULL DEFAULT '',
    semester          TEXT    NOT NULL DEFAULT '',
    code              TEXT    NOT NULL DEFAULT '',
    type              TEXT    NOT NULL DEFAULT '',
    cia               INTEGER NOT NULL DEFAULT 0,
    see               INTEGER NOT NULL DEFAULT 0,
    slt               TEXT    NOT NULL DEFAULT '',
    l                 INTEGER NOT NULL DEFAULT 0,
    t                 INTEGER NOT NULL DEFAULT 0,
    p                 INTEGER NOT NULL DEFAULT 0,
    s                 INTEGER NOT NULL DEFAULT 0,
    total_marks       INTEGER NOT NULL DEFAULT 0,
    credits           INTEGER NOT NULL DEFAULT 0,
    exam_hours        TEXT    NOT NULL DEFAULT '',
    exam_type         TEXT    NOT NULL DEFAULT '',
    prerequisites     TEXT    NOT NULL DEFAULT '',
    course_objectives TEXT    NOT NULL DEFAULT '',
    has_practical     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_syllabi_dept ON syllabi (department_id);

CREATE TABLE IF NOT EXISTS course_outcomes (
    id         INTEGER PRIMARY KEY,
    syllabus_id INTEGER NOT NULL REFERENCES syllabi(id) ON DELETE CASCADE,
    co_id      TEXT    NOT NULL DEFAULT '',   -- CO1
    description TEXT   NOT NULL DEFAULT '',
    cl         TEXT    NOT NULL DEFAULT '',
    pl         TEXT    NOT NULL DEFAULT '',
    position   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS co_assessment (
    id          INTEGER PRIMARY KEY,
    syllabus_id INTEGER NOT NULL REFERENCES syllabi(id) ON DELETE CASCADE,
    co          TEXT    NOT NULL DEFAULT '',  -- CO 1
    cie1        TEXT    NOT NULL DEFAULT '',
    cie2        TEXT    NOT NULL DEFAULT '',
    assignment  TEXT    NOT NULL DEFAULT '',
    see         TEXT    NOT NULL DEFAULT '',
    position    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS modules (
    id           INTEGER PRIMARY KEY,
    syllabus_id  INTEGER NOT NULL REFERENCES syllabi(id) ON DELETE CASCADE,
    number_label TEXT    NOT NULL DEFAULT '',  -- "Module 1"
    co           TEXT    NOT NULL DEFAULT '',
    level        TEXT    NOT NULL DEFAULT '',
    content      TEXT    NOT NULL DEFAULT '',
    textbook_ref TEXT    NOT NULL DEFAULT '',
    position     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS practical_items (
    id          INTEGER PRIMARY KEY,
    syllabus_id INTEGER NOT NULL REFERENCES syllabi(id) ON DELETE CASCADE,
    part        TEXT    NOT NULL CHECK (part IN ('A', 'B')),
    item_text   TEXT    NOT NULL DEFAULT '',
    position    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS books (
    id          INTEGER PRIMARY KEY,
    syllabus_id INTEGER NOT NULL REFERENCES syllabi(id) ON DELETE CASCADE,
    kind        TEXT    NOT NULL CHECK (kind IN ('textbook', 'reference')),
    item_text   TEXT    NOT NULL DEFAULT '',
    position    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS web_links (
    id          INTEGER PRIMARY KEY,
    syllabus_id INTEGER NOT NULL REFERENCES syllabi(id) ON DELETE CASCADE,
    url         TEXT    NOT NULL DEFAULT '',
    position    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
    id                 INTEGER PRIMARY KEY,
    external_id        TEXT    NOT NULL DEFAULT '',   -- ADM-01, FAC-9302
    name               TEXT    NOT NULL,
    email              TEXT    NOT NULL UNIQUE,
    password           TEXT    NOT NULL DEFAULT '',   -- plain text for now; phase 2 hashes it
    role               TEXT    NOT NULL DEFAULT '',
    title              TEXT    NOT NULL DEFAULT '',
    designation        TEXT    NOT NULL DEFAULT '',
    department_code    TEXT    NOT NULL DEFAULT '',
    can_edit           INTEGER NOT NULL DEFAULT 0,
    -- Nullable on purpose: faculty records may omit this key entirely, and the
    -- JSON round-trip has to reproduce that absence rather than invent False.
    can_manage_faculty INTEGER,
    badge_color        TEXT    NOT NULL DEFAULT '',
    is_leadership      INTEGER NOT NULL DEFAULT 0,
    position           INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_dept ON users (department_code);

-- ---------------------------------------------------------------------------
-- Scheme lifecycle (2026-11): a scheme is a first-class, owned document.
-- Rows reference departments/users by code and email rather than by id because
-- save_state() rewrites those tables on every whole-state save.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schemes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid            TEXT    NOT NULL UNIQUE,
    name            TEXT    NOT NULL,
    department_code TEXT    NOT NULL,
    semester        TEXT    NOT NULL,
    academic_year   TEXT    NOT NULL DEFAULT '',
    regulation      TEXT    NOT NULL DEFAULT '',
    status          TEXT    NOT NULL DEFAULT 'Draft',
    owner_email     TEXT    NOT NULL,
    visibility      TEXT    NOT NULL DEFAULT 'personal',
    source_uuid     TEXT    NOT NULL DEFAULT '',
    submitted_at    TEXT    NOT NULL DEFAULT '',
    decided_at      TEXT    NOT NULL DEFAULT '',
    decided_by      TEXT    NOT NULL DEFAULT '',
    created_at      TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schemes_owner ON schemes (owner_email, status);
CREATE INDEX IF NOT EXISTS idx_schemes_scope ON schemes (department_code, semester, academic_year);

CREATE TABLE IF NOT EXISTS scheme_courses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    scheme_id   INTEGER NOT NULL REFERENCES schemes (id) ON DELETE CASCADE,
    sl_no       INTEGER NOT NULL DEFAULT 0,
    type        TEXT    NOT NULL DEFAULT '',
    code        TEXT    NOT NULL DEFAULT '',
    title       TEXT    NOT NULL DEFAULT '',
    td          TEXT    NOT NULL DEFAULT '',
    psb         TEXT    NOT NULL DEFAULT '',
    l           INTEGER NOT NULL DEFAULT 0,
    t           INTEGER NOT NULL DEFAULT 0,
    p           INTEGER NOT NULL DEFAULT 0,
    s           INTEGER NOT NULL DEFAULT 0,
    tot         INTEGER NOT NULL DEFAULT 0,
    exam_hours  TEXT    NOT NULL DEFAULT '',
    cia         INTEGER NOT NULL DEFAULT 0,
    see         INTEGER NOT NULL DEFAULT 0,
    total       INTEGER NOT NULL DEFAULT 0,
    credits     INTEGER NOT NULL DEFAULT 0,
    position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_scheme_courses ON scheme_courses (scheme_id, position);

CREATE TABLE IF NOT EXISTS scheme_versions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    scheme_id   INTEGER NOT NULL REFERENCES schemes (id) ON DELETE CASCADE,
    version_no  INTEGER NOT NULL,
    snapshot    TEXT    NOT NULL,
    note        TEXT    NOT NULL DEFAULT '',
    created_by  TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scheme_versions ON scheme_versions (scheme_id, version_no DESC);
