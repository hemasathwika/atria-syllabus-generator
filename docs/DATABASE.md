# Database

The portal stores its data in **SQLite** (`data/curriculum.db`). The old
`data/default_data.json` is still written on every save, but only as a mirror:
the database is the source of truth.

## Why SQLite

- No server to install — `python run_app.py` still starts everything
- Single file, trivial to copy or hand to the head of department
- Real transactions and foreign keys, so a half-finished save cannot corrupt the data
- SQL is portable; moving to PostgreSQL later mostly means changing `connect()`

## Files

| File | Purpose |
|---|---|
| `schema.sql` | Table definitions (v1) |
| `db.py` | Connection, migration, read/write, backup, CLI |
| `data/curriculum.db` | Live database (git-ignored) |
| `data/default_data.json` | JSON mirror, regenerated on every save |

## Schema

```
departments ─┬─ semesters ─── courses ─── syllabi ─┬─ course_outcomes
             └─ syllabi                             ├─ co_assessment
                                                    ├─ modules
                                                    ├─ practical_items (part A/B)
                                                    ├─ books (textbook/reference)
                                                    └─ web_links
users  (leadership + faculty, role based)
meta   (schema_version)
```

Every child row cascades from its parent: delete a department and its semesters,
courses, syllabi, COs, modules and books disappear with it.

`syllabi` carries `has_practical`, so a syllabus with no lab still round-trips
to `{"has_practical": false, "part_a": [], "part_b": []}`.

## Data flow

```
app.js  ──GET /api/state──────────►  db.load_state()   (SQLite → JSON shape)
        ──POST /api/save-state────►  db.save_state()   (transaction)
                                     db.export_json()  (mirror)
                                     export_docx.main() (regenerate .docx)
```

`app.js` falls back to `data/default_data.json` if `/api/state` is unavailable,
so opening `index.html` directly still works.

## Commands

```powershell
python db.py init            # create the DB and import the JSON if present
python db.py init --reset    # wipe and rebuild from the JSON
python db.py import          # replace contents from data/default_data.json
python db.py export          # write the JSON mirror from the DB
python db.py stats           # row counts per table
python db.py check           # round-trip comparison, DB vs JSON
python db.py backup          # timestamped copy in backups/
```

`python db.py check` is the regression test: it loads the database back into the
old dictionary shape and compares it field by field against the JSON mirror.

## Notes for the next phase

- **Passwords are still plain text.** The admin credential panel displays them on
  purpose, so hashing needs a product decision (show-once, or a reset flow).
  A `password_hash` column is the planned addition.
- **Saves are whole-state.** The frontend posts the entire document tree, so two
  people editing different departments would overwrite each other (last write
  wins). Per-entity endpoints (`PATCH /api/courses/<id>`) are the fix before the
  portal is shared on a campus network.
- **Concurrency** is already safe for one writer: WAL mode plus a single
  transaction per save.
