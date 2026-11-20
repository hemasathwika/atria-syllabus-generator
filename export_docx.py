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
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL, WD_ROW_HEIGHT_RULE
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

def _roman(num):
    """1 -> I, 12 -> XII. Used for semester headings."""
    try:
        n = int(num)
    except (TypeError, ValueError):
        return str(num)
    if n <= 0 or n > 39:
        return str(num)
    vals = [(10, 'X'), (9, 'IX'), (5, 'V'), (4, 'IV'), (1, 'I')]
    out = ''
    for v, sym in vals:
        while n >= v:
            out += sym
            n -= v
    return out


def set_table_borders(table, inner=6, outer=12):
    """Single black rules: 0.75pt inside, 1.5pt on the outside (matches the print CSS)."""
    tblPr = table._tbl.tblPr
    borders = OxmlElement('w:tblBorders')
    for edge, sz in (('top', outer), ('left', outer), ('bottom', outer),
                     ('right', outer), ('insideH', inner), ('insideV', inner)):
        el = OxmlElement(f'w:{edge}')
        el.set(qn('w:val'), 'single')
        el.set(qn('w:sz'), str(sz))
        el.set(qn('w:space'), '0')
        el.set(qn('w:color'), '000000')
        borders.append(el)
    tblPr.insert_element_before(borders, 'w:shd', 'w:tblLayout', 'w:tblCellMar',
                                'w:tblLook', 'w:tblCaption', 'w:tblDescription')


def set_default_font(doc, name='Times New Roman', size_pt=8.25):
    style = doc.styles['Normal']
    style.font.name = name
    style.font.size = Pt(size_pt)
    rpr = style.element.get_or_add_rPr()
    rfonts = rpr.find(qn('w:rFonts'))
    if rfonts is None:
        rfonts = OxmlElement('w:rFonts')
        rpr.append(rfonts)
    for attr in ('w:ascii', 'w:hAnsi', 'w:cs', 'w:eastAsia'):
        rfonts.set(qn(attr), name)
    style.paragraph_format.space_before = Pt(0)
    style.paragraph_format.space_after = Pt(0)


def _force_font(run, name='Times New Roman'):
    run.font.name = name
    run._element.get_or_add_rPr().find(qn('w:rFonts')).set(qn('w:eastAsia'), name)


def write_cell(cell, text, size=8.25, bold=False, align=WD_ALIGN_PARAGRAPH.CENTER,
               valign=WD_ALIGN_VERTICAL.CENTER, font='Times New Roman'):
    """Replace a cell's content with one clean, explicitly formatted paragraph."""
    for extra in cell.paragraphs[1:]:
        extra._element.getparent().remove(extra._element)
    p = cell.paragraphs[0]
    for r in list(p.runs):
        r._element.getparent().remove(r._element)
    p.alignment = align
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.line_spacing = Pt(11)
    cell.vertical_alignment = valign
    run = p.add_run(str(text))
    _force_font(run, font)
    run.font.size = Pt(size)
    run.bold = bold


def mark_header_row(row):
    trPr = row._tr.get_or_add_trPr()
    if trPr.find(qn('w:tblHeader')) is None:
        trPr.append(OxmlElement('w:tblHeader'))


def keep_row_together(row):
    """Stop Word splitting a row's content across a page boundary."""
    trPr = row._tr.get_or_add_trPr()
    if trPr.find(qn('w:cantSplit')) is None:
        trPr.append(OxmlElement('w:cantSplit'))


def add_institution_header(doc, dept_name):
    """Logo left, centred institutional block, then the 2px rule — repeated per page."""
    header_table = doc.add_table(rows=1, cols=3)
    header_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    header_table.autofit = False
    hdr_widths = [Inches(2.5), Inches(5.7), Inches(2.49)]
    for i, w in enumerate(hdr_widths):
        header_table.columns[i].width = w
        header_table.rows[0].cells[i].width = w
    for c in header_table.rows[0].cells:
        set_cell_margins(c, top=0, bottom=0, left=0, right=0)
        c.vertical_alignment = WD_ALIGN_VERTICAL.CENTER

    c_left, c_mid, _c_right = header_table.rows[0].cells
    logo_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "atria_logo.png")
    if os.path.exists(logo_path):
        p_l = c_left.paragraphs[0]
        p_l.alignment = WD_ALIGN_PARAGRAPH.LEFT
        p_l.paragraph_format.space_before = Pt(0)
        p_l.paragraph_format.space_after = Pt(0)
        p_l.add_run().add_picture(logo_path, width=Inches(2.35))

    lines = [
        ("ATRIA INSTITUTE OF TECHNOLOGY", 14.25, True),
        ("(An Autonomous Institution Affiliated to VTU, Belagavi | Approved by AICTE, New Delhi)", 8.25, True),
        (f"DEPARTMENT OF {dept_name.upper()}", 10.5, True),
        ("TEACHING & EXAMINATION SCHEME (2024 REGULATION)", 9, True),
    ]
    for idx, (text, size, bold) in enumerate(lines):
        p = c_mid.paragraphs[0] if idx == 0 else c_mid.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(4 if idx < len(lines) - 1 else 0)
        p.paragraph_format.line_spacing = Pt(11)
        r = p.add_run(text)
        _force_font(r)
        r.font.size = Pt(size)
        r.bold = bold

    rule_p = doc.add_paragraph()
    rule_p.paragraph_format.space_before = Pt(10)
    rule_p.paragraph_format.space_after = Pt(10)
    pPr = rule_p._p.get_or_add_pPr()
    pBdr = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), '12')
    bottom.set(qn('w:space'), '1')
    bottom.set(qn('w:color'), '000000')
    pBdr.append(bottom)
    pPr.insert_element_before(pBdr, 'w:shd', 'w:tabs', 'w:suppressAutoHyphens',
                              'w:kinsoku', 'w:wordWrap', 'w:overflowPunct',
                              'w:topLinePunct', 'w:autoSpaceDE', 'w:autoSpaceDN',
                              'w:bidi', 'w:adjustRightInd', 'w:snapToGrid',
                              'w:spacing', 'w:ind', 'w:contextualSpacing',
                              'w:mirrorIndents', 'w:suppressOverlap', 'w:jc',
                              'w:textDirection', 'w:textAlignment',
                              'w:textboxTightWrap', 'w:outlineLvl', 'w:divId',
                              'w:cnfStyle', 'w:rPr', 'w:sectPr', 'w:pPrChange')


def generate_scheme_docx(dept_data, output_path="Generated_CSE_2024_SCHEME.docx"):
    """Rebuilds the scheme to match the on-screen print preview 1:1:
    Times New Roman, ruled 16-column grid, proportional column widths,
    vertically merged single-column headers, Roman-numeral semester headings."""
    doc = Document()
    set_default_font(doc)

    # A4 landscape with the same 0.5in margins as the preview print
    section = doc.sections[0]
    section.orientation = WD_ORIENT.LANDSCAPE
    section.page_width, section.page_height = Inches(11.69), Inches(8.27)
    section.top_margin = Inches(0.646)
    section.bottom_margin = Inches(0.5)
    section.left_margin = Inches(0.646)
    section.right_margin = Inches(0.646)

    # Word's default 18pt document grid forces a 27pt minimum on every table row,
    # which made single-line course rows far taller than the PDF's 21.5pt rows.
    for _grid in section._sectPr.findall(qn('w:docGrid')):
        section._sectPr.remove(_grid)

    # Column geometry from the rendered preview (sums to ~10.54in of 10.69in usable)
    col_w = [0.542, 0.917, 0.993, 1.757, 0.576, 0.569, 0.410, 0.347, 0.403, 0.410,
             0.514, 0.792, 0.403, 0.417, 0.611, 0.736]
    col_w_in = [Inches(w) for w in col_w]

    sem_items = sorted(dept_data.get('schemes', {}).items(), key=lambda kv: int(kv[0]))
    for sem_index, (sem_num, courses) in enumerate(sem_items):
        if sem_index > 0:
            doc.add_page_break()

        add_institution_header(doc, dept_data['name'])

        sem_p = doc.add_paragraph()
        sem_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        sem_p.paragraph_format.space_before = Pt(2)
        sem_p.paragraph_format.space_after = Pt(15)
        sem_p.paragraph_format.keep_with_next = True
        sem_r = sem_p.add_run(f"{_roman(sem_num)} SEMESTER SCHEME OF TEACHING AND EXAMINATION")
        _force_font(sem_r)
        sem_r.font.size = Pt(10.5)
        sem_r.bold = True

        table = doc.add_table(rows=2 + len(courses) + 1, cols=16)
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table.autofit = False
        set_table_borders(table, inner=6, outer=12)

        for i, w in enumerate(col_w_in):
            table.columns[i].width = w
            for cell in table.columns[i].cells:
                cell.width = w

        # Vertical merges: every single-storey header spans both header rows
        for i in [0, 1, 2, 3, 4, 5, 15]:
            table.cell(0, i).merge(table.cell(1, i))

        single_headers = {0: "SL. NO.", 1: "COURSE TYPE", 2: "COURSE CODE", 3: "COURSE TITLE",
                          4: "TD", 5: "PSB", 15: "CREDITS"}
        for col, label in single_headers.items():
            write_cell(table.cell(0, col), label, size=8.62, bold=True)

        group_slt = table.cell(0, 6).merge(table.cell(0, 10))
        write_cell(group_slt, "STUDENT LEARNING HOURS (SLT)", size=8.62, bold=True)
        set_cell_background(group_slt, "E2E8F0")

        group_asmt = table.cell(0, 11).merge(table.cell(0, 14))
        write_cell(group_asmt, "ASSESSMENT INFORMATION", size=8.62, bold=True)
        set_cell_background(group_asmt, "E2E8F0")

        sub_headers = ["L", "T", "P", "S", "TOT", "EXAM (HRS)", "CIA", "SEE", "TOTAL"]
        for offset, label in enumerate(sub_headers):
            write_cell(table.cell(1, 6 + offset), label, size=8.62, bold=True)

        for ri in [0, 1]:
            for cell in table.rows[ri].cells:
                if cell._tc.tcPr is None or cell._tc.tcPr.find(qn('w:shd')) is None:
                    set_cell_background(cell, "F1F5F9")
                set_cell_margins(cell, top=105, bottom=105, left=120, right=120)
            mark_header_row(table.rows[ri])

        total_l = total_t = total_p = total_s = total_tot = 0
        total_cia = total_see = total_marks = total_credits = 0

        for idx, c in enumerate(courses):
            row = table.rows[2 + idx]
            cells = row.cells

            l, t, p, s = c.get('l', 0), c.get('t', 0), c.get('p', 0), c.get('s', 0)
            tot = c.get('tot', l + t + p + s)
            cia, see = c.get('cia', 50), c.get('see', 50)
            tot_m = c.get('total', cia + see)
            cred = c.get('c', 0)

            total_l += l; total_t += t; total_p += p; total_s += s; total_tot += tot
            total_cia += cia; total_see += see; total_marks += tot_m; total_credits += cred

            values = [c.get('sl', idx + 1), c.get('type', ''), c.get('code', ''), c.get('title', ''),
                      c.get('td', 'CSE'), c.get('psb', 'CSE'), l, t, p, s, tot,
                      c.get('exam_hours', 3), cia, see, tot_m, cred]
            for col_i, val in enumerate(values):
                align = WD_ALIGN_PARAGRAPH.LEFT if col_i == 3 else WD_ALIGN_PARAGRAPH.CENTER
                bold = col_i in (1, 2, 10, 14, 15)
                write_cell(cells[col_i], val, size=8.25, bold=bold, align=align)
                set_cell_margins(cells[col_i], top=105, bottom=105, left=120, right=120)

        # TOTAL footer
        foot = table.rows[-1]
        foot.cells[0].merge(foot.cells[5])
        foot_values = ["TOTAL", total_l, total_t, total_p, total_s, total_tot, "-",
                       total_cia, total_see, total_marks, total_credits]
        for pos, val in enumerate(foot_values):
            cell = foot.cells[0] if pos == 0 else foot.cells[5 + pos]
            write_cell(cell, val, size=8.25, bold=True)
            set_cell_background(cell, "F1F5F9")
            set_cell_margins(cell, top=105, bottom=105, left=120, right=120)

        # Never let Word break a course row across two pages.
        for row in table.rows:
            keep_row_together(row)

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
        # Header with official Atria Logo on left & Centered Headings
        syl_hdr = doc.add_table(rows=1, cols=3)
        syl_hdr.alignment = WD_TABLE_ALIGNMENT.CENTER
        syl_hdr.autofit = False

        # Left: Atria Logo
        c_l = syl_hdr.rows[0].cells[0]
        c_l.width = Inches(2.0)
        logo_path = os.path.join(os.path.dirname(__file__), "assets", "atria_logo.png")
        if os.path.exists(logo_path):
            p_l = c_l.paragraphs[0]
            p_l.alignment = WD_ALIGN_PARAGRAPH.LEFT
            p_l.add_run().add_picture(logo_path, width=Inches(1.8))

        # Center: Institutional Title
        c_m = syl_hdr.rows[0].cells[1]
        c_m.width = Inches(3.2)
        p_m = c_m.paragraphs[0]
        p_m.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r1 = p_m.add_run("ATRIA INSTITUTE OF TECHNOLOGY (AUTONOMOUS)\n")
        r1.bold = True
        r1.font.size = Pt(11)
        r1_sub = p_m.add_run("(Affiliated to VTU, Belagavi | Approved by AICTE, New Delhi)\n")
        r1_sub.font.size = Pt(8)
        r2 = p_m.add_run(f"DEPARTMENT OF {dept_data['name'].upper()}\n")
        r2.bold = True
        r2.font.size = Pt(9.5)

        # Right: Empty Spacer (balances center alignment)
        c_r = syl_hdr.rows[0].cells[2]
        c_r.width = Inches(2.0)

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
