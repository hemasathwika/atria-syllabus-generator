"""
Autonomous College Scheme & Syllabus Generator - Word (.docx) Exporter
Exports formatted Scheme and Syllabus Word documents matching official university standards.
Run: python export_docx.py
"""

import json
import os
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn

def set_cell_margins(cell, top=100, bottom=100, left=150, right=150):
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = OxmlElement('w:tcMar')
    for m, val in [('top', top), ('bottom', bottom), ('left', left), ('right', right)]:
        node = OxmlElement(f'w:{m}')
        node.set(qn('w:w'), str(val))
        node.set(qn('w:type'), 'dxa')
        tcMar.append(node)
    tcPr.append(tcMar)

def set_cell_background(cell, color_hex):
    shading_elm = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{color_hex}"/>')
    cell._tc.get_or_add_tcPr().append(shading_elm)

def generate_scheme_docx(dept_data, output_path="Generated_CSE_2024_SCHEME.docx"):
    doc = Document()
    
    # Page Setup - Landscape for wide Scheme table
    section = doc.sections[0]
    section.orientation = 1 # Landscape
    section.page_width, section.page_height = Inches(11.69), Inches(8.27)
    section.top_margin = Inches(0.5)
    section.bottom_margin = Inches(0.5)
    section.left_margin = Inches(0.5)
    section.right_margin = Inches(0.5)

    # Header with official Atria Logo & Institution Title
    header_table = doc.add_table(rows=1, cols=2)
    header_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    header_table.autofit = False
    
    # Left: Atria Logo
    c_left = header_table.rows[0].cells[0]
    c_left.width = Inches(3.2)
    logo_path = os.path.join(os.path.dirname(__file__), "assets", "atria_logo.png")
    if os.path.exists(logo_path):
        p_l = c_left.paragraphs[0]
        p_l.alignment = WD_ALIGN_PARAGRAPH.LEFT
        p_l.add_run().add_picture(logo_path, width=Inches(2.8))
    
    # Right: Institutional Title
    c_right = header_table.rows[0].cells[1]
    c_right.width = Inches(7.4)
    p_r = c_right.paragraphs[0]
    p_r.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    r1 = p_r.add_run("ATRIA INSTITUTE OF TECHNOLOGY\n")
    r1.bold = True
    r1.font.size = Pt(13)
    r1_sub = p_r.add_run("(An Autonomous Institution Affiliated to VTU, Belagavi | Approved by AICTE, New Delhi)\n")
    r1_sub.font.size = Pt(8.5)
    r2 = p_r.add_run(f"DEPARTMENT OF {dept_data['name'].upper()}\n")
    r2.bold = True
    r2.font.size = Pt(11)
    r3 = p_r.add_run("TEACHING AND EXAMINATION SCHEME (2024 REGULATION)")
    r3.bold = True
    r3.font.size = Pt(9.5)
    r3.font.color.rgb = RGBColor(60, 60, 60)

    for sem_num, courses in dept_data.get('schemes', {}).items():
        doc.add_paragraph()
        sem_p = doc.add_paragraph()
        sem_r = sem_p.add_run(f"SEMESTER {sem_num} - SCHEME OF TEACHING AND EXAMINATION")
        sem_r.bold = True
        sem_r.font.size = Pt(11)

        # 16 Columns Table
        headers_row1 = [
            ("Sl. No.", 1, 2), ("Course Type", 1, 2), ("Course Code", 1, 2), ("Course Title", 1, 2),
            ("TD", 1, 2), ("PSB", 1, 2), ("Student Learning Hours (SLT)", 5, 1),
            ("Assessment Information", 4, 1), ("Credits", 1, 2)
        ]
        headers_row2 = ["L", "T", "P", "S", "TOT", "Duration (Hrs)", "CIA", "SEE", "Total"]

        table = doc.add_table(rows=2 + len(courses) + 1, cols=16)
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table.autofit = False

        # Format Header Row 1
        hdr_cells = table.rows[0].cells
        hdr_cells[0].text = "Sl. No."
        hdr_cells[1].text = "Course Type"
        hdr_cells[2].text = "Course Code"
        hdr_cells[3].text = "Course Title"
        hdr_cells[4].text = "TD"
        hdr_cells[5].text = "PSB"
        hdr_cells[6].text = "Student Learning Hours (SLT)"
        hdr_cells[11].text = "Assessment Information"
        hdr_cells[15].text = "Credits"

        # Merge horizontal header blocks
        hdr_cells[6].merge(hdr_cells[10])
        hdr_cells[11].merge(hdr_cells[14])

        # Header Row 2
        r2_cells = table.rows[1].cells
        col_offset = 6
        for name in headers_row2:
            r2_cells[col_offset].text = name
            col_offset += 1

        # Style header cells
        for row in [table.rows[0], table.rows[1]]:
            for c in row.cells:
                set_cell_background(c, "F1F5F9")
                for p in c.paragraphs:
                    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    for run in p.runs:
                        run.bold = True
                        run.font.size = Pt(8.5)

        # Data Rows
        total_l, total_t, total_p, total_s, total_tot = 0, 0, 0, 0, 0
        total_cia, total_see, total_marks, total_credits = 0, 0, 0, 0

        for idx, c in enumerate(courses):
            row_cells = table.rows[2 + idx].cells
            l, t, p, s = c.get('l', 0), c.get('t', 0), c.get('p', 0), c.get('s', 0)
            tot = c.get('tot', l + t + p + s)
            cia, see = c.get('cia', 50), c.get('see', 50)
            tot_m = c.get('total', cia + see)
            cred = c.get('c', 0)

            total_l += l; total_t += t; total_p += p; total_s += s; total_tot += tot
            total_cia += cia; total_see += see; total_marks += tot_m; total_credits += cred

            row_cells[0].text = str(c.get('sl', idx + 1))
            row_cells[1].text = str(c.get('type', ''))
            row_cells[2].text = str(c.get('code', ''))
            row_cells[3].text = str(c.get('title', ''))
            row_cells[4].text = str(c.get('td', 'CSE'))
            row_cells[5].text = str(c.get('psb', 'CSE'))
            row_cells[6].text = str(l)
            row_cells[7].text = str(t)
            row_cells[8].text = str(p)
            row_cells[9].text = str(s)
            row_cells[10].text = str(tot)
            row_cells[11].text = str(c.get('exam_hours', 3))
            row_cells[12].text = str(cia)
            row_cells[13].text = str(see)
            row_cells[14].text = str(tot_m)
            row_cells[15].text = str(cred)

            for col_i, cell in enumerate(row_cells):
                for prg in cell.paragraphs:
                    if col_i in [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]:
                        prg.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    for r in prg.runs:
                        r.font.size = Pt(8.5)
                        if col_i in [2, 10, 14, 15]:
                            r.bold = True

        # Footer Row (Total)
        foot_cells = table.rows[-1].cells
        foot_cells[0].text = "TOTAL"
        foot_cells[0].merge(foot_cells[5])
        foot_cells[6].text = str(total_l)
        foot_cells[7].text = str(total_t)
        foot_cells[8].text = str(total_p)
        foot_cells[9].text = str(total_s)
        foot_cells[10].text = str(total_tot)
        foot_cells[11].text = "-"
        foot_cells[12].text = str(total_cia)
        foot_cells[13].text = str(total_see)
        foot_cells[14].text = str(total_marks)
        foot_cells[15].text = str(total_credits)

        for cell in foot_cells:
            set_cell_background(cell, "E2E8F0")
            for prg in cell.paragraphs:
                prg.alignment = WD_ALIGN_PARAGRAPH.CENTER
                for r in prg.runs:
                    r.bold = True
                    r.font.size = Pt(9)

    doc.save(output_path)
    print(f"Generated scheme document: {output_path}")

def generate_syllabus_docx(dept_data, output_path="Generated_CSE_SYLLABUS.docx", filter_code=None):
    doc = Document()
    
    # Portrait Page Setup
    section = doc.sections[0]
    section.page_width, section.page_height = Inches(8.27), Inches(11.69)
    section.top_margin = Inches(0.7)
    section.bottom_margin = Inches(0.7)
    section.left_margin = Inches(0.7)
    section.right_margin = Inches(0.7)

    items = dept_data.get('syllabi', {}).items()
    if filter_code and filter_code != 'ALL':
        items = [(code, syl) for code, syl in items if code == filter_code]

    for code, syl in items:
        # Header with official Atria Logo & Institution Title
        syl_hdr = doc.add_table(rows=1, cols=2)
        syl_hdr.alignment = WD_TABLE_ALIGNMENT.CENTER
        syl_hdr.autofit = False

        c_l = syl_hdr.rows[0].cells[0]
        c_l.width = Inches(2.6)
        logo_path = os.path.join(os.path.dirname(__file__), "assets", "atria_logo.png")
        if os.path.exists(logo_path):
            p_l = c_l.paragraphs[0]
            p_l.alignment = WD_ALIGN_PARAGRAPH.LEFT
            p_l.add_run().add_picture(logo_path, width=Inches(2.2))

        c_r = syl_hdr.rows[0].cells[1]
        c_r.width = Inches(4.6)
        p_r = c_r.paragraphs[0]
        p_r.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        r1 = p_r.add_run("ATRIA INSTITUTE OF TECHNOLOGY (AUTONOMOUS)\n")
        r1.bold = True
        r1.font.size = Pt(11)
        r1_sub = p_r.add_run("(Affiliated to VTU, Belagavi | Approved by AICTE, New Delhi)\n")
        r1_sub.font.size = Pt(8)
        r2 = p_r.add_run(f"DEPARTMENT OF {dept_data['name'].upper()}\n")
        r2.bold = True
        r2.font.size = Pt(9.5)

        doc.add_paragraph() # Spacing

        # Title Header
        title_p = doc.add_paragraph()
        title_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = title_p.add_run(f"Title of the Course: {syl.get('title')}\n")
        r.bold = True
        r.font.size = Pt(13)

        # Header Box Table
        table = doc.add_table(rows=6, cols=3)
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table.autofit = False

        # Row 0: Course Code & Semester
        c0 = table.rows[0].cells
        c0[0].text = f"Course Code: {syl.get('code')}"
        c0[1].text = f"Course Type: {syl.get('type')}"
        c0[2].text = f"Semester: {syl.get('semester')}"

        # Row 1: CIA & SEE Marks
        c1 = table.rows[1].cells
        c1[0].text = f"CIA Marks: {syl.get('cia')}"
        c1[1].text = f"SEE Marks: {syl.get('see')}"
        c1[2].text = f"Total Marks: {syl.get('total_marks')}"

        # Row 2: SLT & Credits
        c2 = table.rows[2].cells
        c2[0].text = f"Student Learning Hours (L:T:P:S): {syl.get('slt')}"
        c2[1].text = f"Credits: {syl.get('credits')}"
        c2[2].text = f"Exam Hours: {syl.get('exam_hours')}"

        # Row 3: Exam Type
        c3 = table.rows[3].cells
        c3[0].text = f"Examination Type (SEE): {syl.get('exam_type')}"
        c3[0].merge(c3[2])

        # Row 4: Legend
        c4 = table.rows[4].cells
        c4[0].text = "L - Lecture | T – Tutorial | P – Practical | S – Self Study | CL - Cognitive Level | PL - Psychomotor Level"
        c4[0].merge(c4[2])
        set_cell_background(c4[0], "F1F5F9")

        for row in table.rows:
            for cell in row.cells:
                for p in cell.paragraphs:
                    for r in p.runs:
                        r.font.size = Pt(9.5)

        doc.add_paragraph()

        # COs Table
        co_title = doc.add_paragraph()
        r_co = co_title.add_run("Course Outcomes: At the end of the course, the students will be able to:")
        r_co.bold = True
        r_co.font.size = Pt(10.5)

        outcomes = syl.get('outcomes', [])
        co_table = doc.add_table(rows=1 + len(outcomes), cols=4)
        co_table.alignment = WD_TABLE_ALIGNMENT.CENTER
        
        co_hdr = co_table.rows[0].cells
        co_hdr[0].text = "COs"
        co_hdr[1].text = "Course Outcome Statement"
        co_hdr[2].text = "CL (Highest Level)"
        co_hdr[3].text = "PL (Highest Level)"
        for c in co_hdr:
            set_cell_background(c, "F1F5F9")
            for p in c.paragraphs:
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                for r in p.runs:
                    r.bold = True
                    r.font.size = Pt(9.5)

        for i, co in enumerate(outcomes):
            cells = co_table.rows[1 + i].cells
            cells[0].text = co.get('id', f'CO{i+1}')
            cells[1].text = co.get('desc', '')
            cells[2].text = str(co.get('cl', '3'))
            cells[3].text = str(co.get('pl', '3'))
            for c_idx, c in enumerate(cells):
                for p in c.paragraphs:
                    if c_idx in [0, 2, 3]:
                        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    for r in p.runs:
                        r.font.size = Pt(9)
                        if c_idx == 0:
                            r.bold = True

        doc.add_paragraph()

        # CO Assessment Mapping Table
        asm_title = doc.add_paragraph()
        r_asm = asm_title.add_run("CO – Assessment Mapping:")
        r_asm.bold = True
        r_asm.font.size = Pt(10.5)

        mappings = syl.get('co_assessment', [])
        asm_table = doc.add_table(rows=2 + len(mappings), cols=5)
        asm_table.alignment = WD_TABLE_ALIGNMENT.CENTER

        r0 = asm_table.rows[0].cells
        r0[0].text = "Course Outcomes"
        r0[1].text = "Continuous Internal Assessment"
        r0[1].merge(r0[3])
        r0[4].text = "Semester End Exam (SEE)"

        r1 = asm_table.rows[1].cells
        r1[1].text = "CIE I (15%)"
        r1[2].text = "CIE II (15%)"
        r1[3].text = "Assignment/Activities (20%)"

        for row in [asm_table.rows[0], asm_table.rows[1]]:
            for c in row.cells:
                set_cell_background(c, "F1F5F9")
                for p in c.paragraphs:
                    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    for r in p.runs:
                        r.bold = True
                        r.font.size = Pt(9)

        for i, m in enumerate(mappings):
            cells = asm_table.rows[2 + i].cells
            cells[0].text = m.get('co', '')
            cells[1].text = m.get('cie1', '')
            cells[2].text = m.get('cie2', '')
            cells[3].text = m.get('assignment', '')
            cells[4].text = m.get('see', '')
            for c in cells:
                for p in c.paragraphs:
                    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    for r in p.runs:
                        r.font.size = Pt(9)

        doc.add_paragraph()

        # Modular Course Contents
        doc.add_heading("Course Contents", level=2)
        for mod in syl.get('modules', []):
            mod_p = doc.add_paragraph()
            r_num = mod_p.add_run(f"{mod.get('num', '')}   |   {mod.get('co', '')}   |   {mod.get('level', '')}\n")
            r_num.bold = True
            r_num.font.size = Pt(10.5)
            r_content = mod_p.add_run(mod.get('content', ''))
            r_content.font.size = Pt(9.5)
            if mod.get('textbook_ref'):
                mod_ref_p = doc.add_paragraph()
                r_ref = mod_ref_p.add_run(mod.get('textbook_ref'))
                r_ref.italic = True
                r_ref.font.size = Pt(9)

        # Practicals
        practicals = syl.get('practicals', {})
        if practicals.get('has_practical'):
            doc.add_heading("PRACTICAL COMPONENTS OF IPCC", level=2)
            
            p_a_head = doc.add_paragraph()
            r_pa = p_a_head.add_run("PART – A_CONVENTIONAL EXPERIMENTS")
            r_pa.bold = True

            for idx, exp in enumerate(practicals.get('part_a', [])):
                p_exp = doc.add_paragraph(f"{idx+1}. {exp}")
                p_exp.paragraph_format.left_indent = Inches(0.2)
                p_exp.runs[0].font.size = Pt(9.5)

            p_b_head = doc.add_paragraph()
            r_pb = p_b_head.add_run("PART – B_TYPICAL OPEN-ENDED EXPERIMENTS (Higher CL / PL)")
            r_pb.bold = True

            for idx, exp in enumerate(practicals.get('part_b', [])):
                p_exp = doc.add_paragraph(f"{idx+1}. {exp}")
                p_exp.paragraph_format.left_indent = Inches(0.2)
                p_exp.runs[0].font.size = Pt(9.5)

        # Textbooks & References
        doc.add_heading("Text Books", level=2)
        for idx, book in enumerate(syl.get('textbooks', [])):
            p_b = doc.add_paragraph(f"{idx+1}. {book}")
            p_b.runs[0].font.size = Pt(9.5)

        doc.add_heading("Reference Books", level=2)
        for idx, book in enumerate(syl.get('references', [])):
            p_b = doc.add_paragraph(f"{idx+1}. {book}")
            p_b.runs[0].font.size = Pt(9.5)

        if syl.get('web_links'):
            doc.add_heading("Reference Web Links / Virtual Experiments:", level=2)
            for idx, link in enumerate(syl.get('web_links', [])):
                p_b = doc.add_paragraph(f"{idx+1}. {link}")
                p_b.runs[0].font.size = Pt(9.5)

        doc.add_page_break()

    doc.save(output_path)
    print(f"Generated syllabus document: {output_path}")

def main():
    with open("data/default_data.json", "r", encoding="utf-8") as f:
        data = json.load(f)
    
    cse_data = next((d for d in data.get("departments", []) if d.get("code") == "CSE"), None)
    if cse_data:
        generate_scheme_docx(cse_data)
        generate_syllabus_docx(cse_data)

if __name__ == "__main__":
    main()
