/* Scheme workspace: My Schemes, Available Schemes, creation, approvals, versions.
   Talks to /api/schemes and drives the existing editor through window.AtriaApp. */
(function () {
  'use strict';

  const SEMESTERS = [
    ['I', '1'], ['II', '2'], ['III', '3'], ['IV', '4'],
    ['V', '5'], ['VI', '6'], ['VII', '7'], ['VIII', '8']
  ];
  const STATUS_CLASS = {
    'Draft': 'st-draft',
    'Pending HOD': 'st-hod',
    'Changes Requested by HOD': 'st-changes',
    'Pending Dean': 'st-dean',
    'Changes Requested by Dean': 'st-changes',
    'Approved': 'st-approved'
  };
  const EDITABLE = ['Draft', 'Changes Requested by HOD', 'Changes Requested by Dean'];

  let scope = 'mine';
  let data = { mine: [], available: [] };
  let searchTerm = '';
  let activeVersionsFor = null;

  const $ = (id) => document.getElementById(id);
  const app = () => window.AtriaApp || null;
  const user = () => (app() && app().user) || {};

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function semKey(label) {
    const hit = SEMESTERS.find(([name]) => name === String(label).toUpperCase());
    return hit ? hit[1] : String(label);
  }

  async function api(path, method, payload) {
    const res = await fetch(path, {
      method: method || 'GET',
      headers: payload ? { 'Content-Type': 'application/json' } : undefined,
      body: payload ? JSON.stringify(payload) : undefined
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || ('HTTP ' + res.status));
    return body;
  }

  function fmtDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (isNaN(d)) return value;
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function badge(status) {
    return '<span class="ws-badge ' + (STATUS_CLASS[status] || 'st-draft') + '">' + esc(status) + '</span>';
  }

  // ---------------------------------------------------------------- filters
  function fillFilters() {
    const state = (app() && app().state) || { departments: [] };
    const dept = $('wsFilterDept');
    if (dept && dept.options.length <= 1) {
      state.departments.forEach((d) => {
        dept.insertAdjacentHTML('beforeend', '<option value="' + esc(d.code) + '">' + esc(d.code) + ' — ' + esc(d.name) + '</option>');
      });
    }
    const sem = $('wsFilterSem');
    if (sem && sem.options.length <= 1) {
      SEMESTERS.forEach(([label]) => sem.insertAdjacentHTML('beforeend', '<option value="' + label + '">' + label + '</option>'));
    }
    const status = $('wsFilterStatus');
    if (status && status.options.length <= 1) {
      Object.keys(STATUS_CLASS).forEach((s) => status.insertAdjacentHTML('beforeend', '<option value="' + esc(s) + '">' + esc(s) + '</option>'));
    }
    const year = $('wsFilterYear');
    if (year && year.options.length <= 1) {
      const years = new Set(['2026-27', '2025-26', '2024-25']);
      (data.mine || []).concat(data.available || []).forEach((s) => s.academic_year && years.add(s.academic_year));
      Array.from(years).sort().reverse().forEach((y) => year.insertAdjacentHTML('beforeend', '<option value="' + esc(y) + '">' + esc(y) + '</option>'));
    }
    const reg = $('wsFilterReg');
    if (reg && reg.options.length <= 1) {
      const regs = new Set(['2024', '2022']);
      (data.mine || []).concat(data.available || []).forEach((s) => s.regulation && regs.add(s.regulation));
      Array.from(regs).sort().reverse().forEach((r) => reg.insertAdjacentHTML('beforeend', '<option value="' + esc(r) + '">' + esc(r) + '</option>'));
    }
  }

  function query() {
    const params = new URLSearchParams({ scope: scope });
    const map = { department: 'wsFilterDept', semester: 'wsFilterSem', academic_year: 'wsFilterYear', regulation: 'wsFilterReg', status: 'wsFilterStatus' };
    Object.keys(map).forEach((key) => {
      const el = $(map[key]);
      if (el && el.value) params.set(key, el.value);
    });
    return params.toString();
  }

  // ---------------------------------------------------------------- loading
  function paintCounts() {
    if ($('wsCardMine')) $('wsCardMine').textContent = (data.mine || []).length;
    if ($('wsCardAvail')) $('wsCardAvail').textContent = (data.available || []).length;
    if ($('wsCardApprovals')) $('wsCardApprovals').textContent = (data.approvals || []).length;
  }

  function showLanding() {
    $('wsLanding').style.display = 'grid';
    $('wsListView').style.display = 'none';
    loadCounts();
  }

  function openList(target) {
    scope = target || 'mine';
    $('wsLanding').style.display = 'none';
    $('wsListView').style.display = 'block';
    $('wsListTitle').textContent = scope === 'mine' ? 'My Schemes'
      : scope === 'available' ? 'Available Schemes' : 'Approvals';
    load();
  }

  async function load() {
    if (!user() || !user().email) return;
    try {
      fillFilters();
      const body = await api('/api/schemes?' + query());
      data[scope] = body.items || [];
      paintCounts();
      if ($('wsListCount')) $('wsListCount').textContent = data[scope].length;
      render();
    } catch (err) {
      $('wsBody').innerHTML = '<tr><td colspan="10" class="ws-error-cell">' + esc(err.message) + '</td></tr>';
    }
  }

  async function loadCounts() {
    try {
      const mine = await api('/api/schemes?scope=mine');
      data.mine = mine.items || [];
      const avail = await api('/api/schemes?scope=available');
      data.available = avail.items || [];
      if (['HOD', 'DEAN', 'ADMIN'].includes(user().role)) {
        const queue = await api('/api/schemes?scope=approvals');
        data.approvals = queue.items || [];
      }
      paintCounts();
    } catch (e) { /* anonymous viewers */ }
  }

  function matchesSearch(scheme) {
    if (!searchTerm) return true;
    const needle = searchTerm.toLowerCase();
    if ((scheme.name || '').toLowerCase().includes(needle)) return true;
    if ((scheme.department_code || '').toLowerCase().includes(needle)) return true;
    return (scheme.courses || []).some((c) =>
      (c.code || '').toLowerCase().includes(needle) || (c.title || '').toLowerCase().includes(needle));
  }

  // ---------------------------------------------------------------- render
  function render() {
    const mine = scope === 'mine';
    const approvals = scope === 'approvals';
    $('wsHeadRow').innerHTML = (mine || approvals)
      ? '<th>Scheme</th><th>Department</th><th>Semester</th>' + (approvals ? '<th>Submitted By</th>' : '<th>Academic Year</th><th>Regulation</th>') +
        '<th>Courses</th><th>Status</th><th>Last Modified</th><th>Actions</th>'
      : '<th>Scheme</th><th>Department</th><th>Semester</th><th>Academic Year</th><th>Regulation</th><th>Created By</th><th>Last Updated</th><th>Actions</th>';

    const rows = (data[scope] || []).filter(matchesSearch);
    const body = $('wsBody');
    const empty = $('wsEmpty');

    if (!rows.length) {
      body.innerHTML = '';
      empty.style.display = 'block';
      empty.innerHTML = mine
        ? '<strong>No schemes yet.</strong><br>Use “Create New Scheme” to start one, or copy one from Available Schemes.'
        : '<strong>Nothing shared yet.</strong><br>Schemes appear here once another faculty member’s scheme is approved.';
      return;
    }
    empty.style.display = 'none';
    body.innerHTML = rows.map((s) => approvals ? approvalRow(s) : (mine ? mineRow(s) : availableRow(s))).join('');
  }

  function approvalRow(s) {
    const role = (user().role || '');
    const parts = [iconBtn({ act: 'preview', uuid: s.uuid, icon: '👁️', label: 'Preview scheme' })];
    if (s.status === 'Pending HOD' && (role === 'HOD' || role === 'ADMIN')) {
      parts.push(iconBtn({ act: 'hod_forward', uuid: s.uuid, icon: '➡️', label: 'Forward to Dean', variant: 'is-primary' }));
      parts.push(iconBtn({ act: 'hod_changes', uuid: s.uuid, icon: '↩️', label: 'Request changes', variant: 'is-danger' }));
    }
    if (s.status === 'Pending Dean' && (role === 'DEAN' || role === 'ADMIN')) {
      parts.push(iconBtn({ act: 'dean_approve', uuid: s.uuid, icon: '✅', label: 'Approve scheme', variant: 'is-primary' }));
      parts.push(iconBtn({ act: 'dean_changes', uuid: s.uuid, icon: '↩️', label: 'Request changes', variant: 'is-danger' }));
    }
    return '<tr>' +
      '<td><button class="ws-link" data-act="preview" data-uuid="' + s.uuid + '">' + esc(s.name) + '</button></td>' +
      '<td>' + esc(s.department_code) + '</td>' +
      '<td>' + esc(s.semester) + '</td>' +
      '<td>' + esc(s.owner_email) + '</td>' +
      '<td>' + (s.course_count || 0) + ' · ' + (s.credits || 0) + ' cr</td>' +
      '<td>' + badge(s.status) + mailTag(s) + '</td>' +
      '<td>' + fmtDate(s.updated_at) + '</td>' +
      '<td class="ws-actions">' + parts.join('') + '</td>' +
      '</tr>';
  }

  function iconBtn(opts) {
    const cls = 'ws-icon-btn' + (opts.variant ? ' ' + opts.variant : '') + (opts.disabled ? ' is-disabled' : '');
    return '<button type="button" class="' + cls + '" data-act="' + opts.act + '" data-uuid="' + opts.uuid + '"' +
      ' title="' + esc(opts.label) + '" aria-label="' + esc(opts.label) + '"' +
      (opts.disabled ? ' disabled' : '') + '>' + opts.icon + '</button>';
  }

  function ownerActions(s) {
    const editable = EDITABLE.includes(s.status);
    const parts = [];

    parts.push(iconBtn({
      act: 'open', uuid: s.uuid, icon: '✏️',
      label: editable ? 'Edit scheme' : 'Edit unavailable — ' + s.status + ' schemes cannot be edited',
      disabled: !editable
    }));

    parts.push(iconBtn({ act: 'preview', uuid: s.uuid, icon: '👁️', label: 'Preview scheme' }));
    parts.push(iconBtn({ act: 'download', uuid: s.uuid, icon: '⬇️', label: 'Download Word (.docx)' }));
    parts.push(iconBtn({ act: 'print', uuid: s.uuid, icon: '🖨️', label: 'Print scheme' }));
    parts.push(iconBtn({ act: 'versions', uuid: s.uuid, icon: '🕘', label: 'Version history' }));

    if (s.status === 'Approved') {
      parts.push(iconBtn({ act: 'email', uuid: s.uuid, icon: '✉️', label: 'Email the approved copy' }));
    }

    parts.push(iconBtn({
      act: 'delete', uuid: s.uuid, icon: '🗑️', variant: 'is-danger',
      label: s.status === 'Approved'
        ? 'Delete this approved scheme (also removes its version history)'
        : 'Delete this scheme'
    }));

    return parts.join('');
  }

  function mailTag(s) {
    if (s.mail_status === 'sent') return '<span class="ws-mail ok" title="Approved copy emailed to ' + esc(s.owner_email || '') + '">✉ sent</span>';
    if (s.mail_status === 'not-configured') return '<span class="ws-mail prev" title="SMTP not configured - preview saved to data/outbox">✉ preview</span>';
    if (s.mail_status === 'error') return '<span class="ws-mail err" title="Mail failed">✉ failed</span>';
    return '';
  }

  function mineRow(s) {
    return '<tr>' +
      '<td><button class="ws-link" data-act="open" data-uuid="' + s.uuid + '">' + esc(s.name) + '</button></td>' +
      '<td>' + esc(s.department_code) + '</td>' +
      '<td>' + esc(s.semester) + '</td>' +
      '<td>' + esc(s.academic_year || '—') + '</td>' +
      '<td>' + esc(s.regulation || '—') + '</td>' +
      '<td>' + (s.course_count || 0) + ' · ' + (s.credits || 0) + ' cr</td>' +
      '<td>' + badge(s.status) + mailTag(s) + '</td>' +
      '<td>' + fmtDate(s.updated_at) + '</td>' +
      '<td class="ws-actions">' + ownerActions(s) + '</td>' +
      '</tr>';
  }

  function availableRow(s) {
    return '<tr>' +
      '<td><button class="ws-link" data-act="view" data-uuid="' + s.uuid + '">' + esc(s.name) + '</button></td>' +
      '<td>' + esc(s.department_code) + '</td>' +
      '<td>' + esc(s.semester) + '</td>' +
      '<td>' + esc(s.academic_year || '—') + '</td>' +
      '<td>' + esc(s.regulation || '—') + '</td>' +
      '<td>' + esc(s.owner_email || '—') + '</td>' +
      '<td>' + fmtDate(s.updated_at) + '</td>' +
      '<td class="ws-actions">' +
        iconBtn({ act: 'view', uuid: s.uuid, icon: '👁️', label: 'View scheme (read-only)' }) +
        iconBtn({ act: 'preview', uuid: s.uuid, icon: '🔍', label: 'Preview scheme' }) +
        iconBtn({ act: 'copy', uuid: s.uuid, icon: '⧉', label: 'Create my copy', variant: 'is-primary' }) +
      '</td>' +
      '</tr>';
  }

  // ---------------------------------------------------------------- actions
  function findScheme(uuid) {
    return (data.mine || []).concat(data.available || []).find((s) => s.uuid === uuid);
  }

  async function fetchScheme(uuid) {
    const body = await api('/api/schemes/' + uuid);
    return body.scheme;
  }

  async function openEditor(uuid, readOnly) {
    const scheme = await fetchScheme(uuid);
    if (readOnly) {
      app().openSchemeEditor({ ...scheme, readOnly: true });
      return;
    }
    app().openSchemeEditor(scheme);
  }

  async function createScheme() {
    const payload = {
      department: $('csDept').value,
      semester: $('csSem').value,
      academic_year: $('csYear').value.trim(),
      regulation: $('csReg').value.trim(),
      name: $('csName').value.trim()
    };
    const err = $('csError');
    err.textContent = '';
    try {
      const body = await api('/api/schemes', 'POST', payload);
      closeModal('schemeCreateModal');
      $('csName').value = '';
      await loadCounts();
      app().openSchemeEditor(body.scheme);
      await load();
    } catch (e) {
      err.textContent = e.message;
    }
  }

  async function copyScheme(uuid) {
    const body = await api('/api/schemes/' + uuid + '/copy', 'POST', {});
    await loadCounts();
    app().openSchemeEditor(body.scheme);
    await load();
  }

  async function emailCopy(uuid) {
    const body = await api('/api/schemes/' + uuid + '/email', 'POST', {});
    const mail = body.mail || {};
    alert(mail.detail || 'Approved copy sent.');
    await load();
  }

  async function deleteScheme(uuid) {
    let scheme = findScheme(uuid);
    if (!scheme) {
      try { scheme = await fetchScheme(uuid); } catch (e) { scheme = null; }
    }
    const name = scheme ? scheme.name : 'this scheme';
    const warning = scheme && scheme.status === 'Approved'
      ? 'Delete the APPROVED scheme "' + name + '"?\n\nThis removes the document and its version history from the portal. Copies already emailed to recipients cannot be recalled.'
      : 'Delete "' + name + '"?\n\nThis removes the document and its version history.';
    if (!confirm(warning)) return;
    await api('/api/schemes/' + uuid + '/delete', 'POST', {});
    await load();
    await loadCounts();
  }

  async function transition(uuid, action) {
    let note = '';
    if (action === 'hod_changes' || action === 'dean_changes') {
      note = prompt('What needs to change?', 'Please amend the scheme.') || '';
    }
    const body = await api('/api/schemes/' + uuid + '/status', 'POST', { action, note });
    if (body.mail && action === 'dean_approve') {
      alert(body.mail.detail || 'Scheme approved.');
    }
    if (window.activeScheme && window.activeScheme.uuid === uuid) {
      window.activeScheme.status = body.scheme.status;
      app().refreshActiveBar && app().refreshActiveBar();
    }
    await load();
    await loadCounts();
  }

  function download(uuid) {
    window.location.href = '/api/download/scheme/' + uuid + '.docx';
  }

  async function preview(uuid) {
    const scheme = window.activeScheme && window.activeScheme.uuid === uuid
      ? window.activeScheme : await fetchScheme(uuid);
    app().openSchemeEditor(scheme);
    window.navigateToTab('tab-preview');
  }

  function print(uuid) {
    preview(uuid).then(() => setTimeout(() => window.print(), 400));
  }

  async function showVersions(uuid) {
    activeVersionsFor = uuid;
    const scheme = findScheme(uuid) || await fetchScheme(uuid);
    $('versionsTitle').textContent = 'Version History — ' + (scheme.name || '');
    const body = await api('/api/schemes/' + uuid + '/versions');
    const items = body.items || [];
    $('versionsBody').innerHTML = items.length ? items.map((v) => (
      '<div class="ws-version-row">' +
        '<div><strong>v' + v.version_no + '</strong> · ' + esc(v.note || '') + '</div>' +
        '<div class="ws-version-meta">' + fmtDate(v.created_at) + ' · ' + esc(v.created_by || '') + '</div>' +
        (EDITABLE.includes((scheme || {}).status || '')
          ? '<button class="ws-act" data-act="restore" data-version="' + v.version_no + '">Restore</button>' : '') +
      '</div>'
    )).join('') : '<p class="ws-empty-inline">No saved versions yet.</p>';
    openModal('versionsModal');
  }

  async function restore(versionNo) {
    if (!confirm('Restore version ' + versionNo + '? The current version is kept in history.')) return;
    await api('/api/schemes/' + activeVersionsFor + '/restore', 'POST', { version_no: versionNo });
    closeModal('versionsModal');
    await load();
    const scheme = await fetchScheme(activeVersionsFor);
    if (window.activeScheme && window.activeScheme.uuid === activeVersionsFor) app().openSchemeEditor(scheme);
  }

  // ---------------------------------------------------------------- modals
  function openModal(id) { $(id).classList.add('open'); }
  function closeModal(id) { $(id).classList.remove('open'); }

  function fillCreateModal() {
    const state = (app() && app().state) || { departments: [] };
    const dept = $('csDept');
    if (!dept.options.length) {
      state.departments.forEach((d) => dept.insertAdjacentHTML('beforeend',
        '<option value="' + esc(d.code) + '">' + esc(d.code) + ' — ' + esc(d.name) + '</option>'));
    }
    const sem = $('csSem');
    if (!sem.options.length) {
      SEMESTERS.forEach(([label]) => sem.insertAdjacentHTML('beforeend', '<option value="' + label + '">' + label + '</option>'));
      sem.value = 'V';
    }
    const mine = user();
    if (mine && mine.dept && !dept.dataset.touched) {
      dept.value = mine.dept;
    }
  }

  // ---------------------------------------------------------------- wiring
  function wire() {
    document.querySelectorAll('.ws-card').forEach((card) => {
      card.addEventListener('click', () => openList(card.dataset.scope));
    });

    $('wsBack').addEventListener('click', showLanding);

    $('wsSearch').addEventListener('input', (e) => { searchTerm = e.target.value.trim(); render(); });

    ['wsFilterDept', 'wsFilterSem', 'wsFilterYear', 'wsFilterReg', 'wsFilterStatus'].forEach((id) => {
      $(id).addEventListener('change', load);
    });

    $('wsClearFilters').addEventListener('click', () => {
      ['wsFilterDept', 'wsFilterSem', 'wsFilterYear', 'wsFilterReg', 'wsFilterStatus'].forEach((id) => { $(id).value = ''; });
      searchTerm = '';
      $('wsSearch').value = '';
      load();
    });

    $('btnCreateScheme').addEventListener('click', () => {
      fillCreateModal();
      $('csError').textContent = '';
      openModal('schemeCreateModal');
    });
    $('csCancel').addEventListener('click', () => closeModal('schemeCreateModal'));
    $('csCreate').addEventListener('click', createScheme);
    $('versionsClose').addEventListener('click', () => { closeModal('versionsModal'); activeVersionsFor = null; });

    $('wsBody').addEventListener('click', async (event) => {
      const btn = event.target.closest('[data-act]');
      if (!btn) return;
      const uuid = btn.dataset.uuid;
      const act = btn.dataset.act;
      try {
        if (act === 'open' || act === 'view') await openEditor(uuid, act === 'view');
        else if (act === 'preview') await preview(uuid);
        else if (['hod_forward', 'hod_changes', 'dean_approve', 'dean_changes'].includes(act)) {
          await transition(uuid, act);
          await load();
        }
        else if (act === 'download') download(uuid);
        else if (act === 'print') print(uuid);
        else if (act === 'versions') await showVersions(uuid);
        else if (act === 'copy') await copyScheme(uuid);
        else if (act === 'delete') await deleteScheme(uuid);
        else if (act === 'email') await emailCopy(uuid);
      } catch (e) {
        alert(e.message);
      }
    });

    $('versionsBody').addEventListener('click', async (event) => {
      const btn = event.target.closest('[data-act="restore"]');
      if (!btn) return;
      try { await restore(Number(btn.dataset.version)); } catch (e) { alert(e.message); }
    });

    document.querySelectorAll('.ws-modal').forEach((m) => {
      m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('open'); });
    });

    const bar = $('activeSchemeBar');
    if (bar) {
      $('asbClose').addEventListener('click', () => {
        if (app() && app().closeActiveScheme) app().closeActiveScheme();
        else { window.activeScheme = null; bar.style.display = 'none'; }
        load();
        loadCounts();
      });
      $('asbSubmit').addEventListener('click', async () => {
        if (!window.activeScheme) return;
        try {
          await transition(window.activeScheme.uuid, 'submit');
          alert('Submitted for HOD review.');
        } catch (e) { alert(e.message); }
      });
      $('asbVersions').addEventListener('click', () => {
        if (window.activeScheme) showVersions(window.activeScheme.uuid);
      });
    }
  }

  let wired = false;
  let lastEmail = null;

  function init() {
    if (!app() || !app().user || !app().user.email) return;
    const email = app().user.email;
    if (!wired) { wire(); wired = true; }
    if (email !== lastEmail) {
      lastEmail = email;
      // Never force the list visible while a scheme is open for editing.
      const wsEl = $('schemeWorkspace');
      if (wsEl) wsEl.style.display = window.activeScheme ? 'none' : 'block';
      scope = 'mine';
      const approvalsCard = $('wsCardApprovals');
      if (approvalsCard) approvalsCard.style.display = ['HOD', 'DEAN', 'ADMIN'].includes(app().user.role) ? 'flex' : 'none';
      if (window.activeScheme) loadCounts();
      else showLanding();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    // app.js loads the session asynchronously, and signing in happens without a
    // reload, so poll until AtriaApp reports a user.
    setInterval(init, 900);
    setTimeout(init, 250);
  });

  window.AtriaSchemes = { reload: () => { showLanding(); }, loadCounts };
})();
