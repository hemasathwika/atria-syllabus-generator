# College Curriculum Management System: Scheme & Syllabus Generator
## Project Specification & Technical Design Document (Updated)

---

### 1. Executive Summary & Architecture Overview

The **Autonomous College Curriculum Engineering Portal** is a web-based academic platform built to standardize and automate:
1. **Teaching & Examination Schemes** (16-column matrix: Course Type, TD, PSB, SLT [L:T:P:S:TOT], Assessment [Duration, CIA, SEE, Total], Credits).
2. **Detailed Course Syllabi** (Metadata header, Course Outcomes with CL & PL levels, CO-Assessment Mapping Grid, 5-Module Contents, Practical Components [Part A & Part B], and Literature citations).

To prevent user confusion and information overload, the system employs a **decoupled, role-based workflow**:

```
[Tab 0: Overview Dashboard]
   │
   ├── Phase 1: Scheme of Examination ─── (Semester matrix, credits, hours, assessment balance)
   │
   ├── Phase 2: Guided Syllabus Builder ─── (6-Step Stepper Wizard)
   │      ├── Step 1: Basic Overview & Metadata
   │      ├── Step 2: Course Outcomes (COs) & Bloom's Levels (CL / PL)
   │      ├── Step 3: CO-Assessment Mapping Matrix
   │      ├── Step 4: 5-Module Modular Contents
   │      ├── Step 5: Practical Components (Part A Conventional + Part B Open-Ended)
   │      └── Step 6: Textbooks, Reference Literature & Virtual Labs
   │
   └── Final Delivery: Official Document Preview & Export (Word .docx & Print/PDF)
```

---

### 2. Eliminating Dashboard Clutter: Key UX Enhancements

| Area | Before (Cluttered) | Now (Clean & Guided) |
| :--- | :--- | :--- |
| **Landing Screen** | User was dropped immediately into a dense table. | Clean **Overview Dashboard** with 3 distinct phase cards, inventory counts, and clear next actions. |
| **Scheme Table** | Hard to find courses in long semester lists. | Added live **Search Bar** (by code or title) + **Filter by Course Type** (IPCC, PCC, Electives, Labs, Projects). |
| **Syllabus Editing** | 7 giant sections dumped on one long scrolling page. | **6-Step Stepper Wizard**: User focuses on one section at a time with smooth `Next` / `Back` navigation. |
| **Module Editing** | Endless scrolling through 5 long module blocks. | **Quick Module Pills** (Module 1 to 5) allowing instant jumping to any module. |
| **Official Preview** | Mixed with editor controls. | Isolated dedicated preview tab formatted exactly like the official `.docx` documents with zero distractions. |

---

### 3. Institutional Documents Compliance

- **Scheme Table Format**: 100% matched to `CSE_2024_SCHEME (2).docx`.
- **Course Syllabus Format**: 100% matched to `CSE_III_IV_SYLLABUS_2025 _25_06 (2).docx`.
- **Direct Export**: `export_docx.py` creates native `.docx` files ready for Board of Studies (BoS) submission.
