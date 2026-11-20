// Autonomous College Curriculum Engineering Portal - JavaScript Engine
document.addEventListener('DOMContentLoaded', async () => {
  let appState = null;
  let currentDept = 'CSE';
  let currentSem = '5';
  let activeCourseCode = null;
  let schemeSearchQuery = '';
  let schemeTypeFilter = 'ALL';

  // 1. Load Data — served from SQLite via /api/state, with the static JSON as fallback
  try {
    let res = await fetch('/api/state');
    if (!res.ok) throw new Error(`api/state ${res.status}`);
    appState = await res.json();
  } catch (e) {
    console.warn('Could not load /api/state, falling back to data/default_data.json', e);
    try {
      const res = await fetch('data/default_data.json');
      if (res.ok) appState = await res.json();
    } catch (e2) {
      console.warn('Could not load data/default_data.json either, using built-in fallback.');
    }
  }

  if (!appState) {
    appState = {
      departments: [
        { code: 'CSE', name: 'Computer Science & Engineering', status: 'Active (Pilot)', hod: 'Dr. Devi Prasad', schemes: {}, syllabi: {} },
        { code: 'ECE', name: 'Electronics & Communication Engineering', status: 'Ready for Setup', hod: 'To be appointed', schemes: {}, syllabi: {} },
        { code: 'ME', name: 'Mechanical Engineering', status: 'Ready for Setup', hod: 'To be appointed', schemes: {}, syllabi: {} },
        { code: 'CIVIL', name: 'Civil Engineering', status: 'Ready for Setup', hod: 'To be appointed', schemes: {}, syllabi: {} }
      ]
    };
  }

  // 1.1 Department Scope & Role-Based Access Control (RBAC)
  const deptSelect = document.getElementById('deptSelect');
  const deptBadge = document.getElementById('deptStatusBadge');

  function isCrossDeptUser(user) {
    if (!user) return false;
    const role = (user.role || '').toUpperCase();
    return role === 'ADMIN' || role === 'PRINCIPAL' || role === 'DEAN';
  }

  function getUserAssignedDept(user) {
    if (!user) return null;
    if (user.dept) return user.dept.toUpperCase();
    if (user.email && user.email.includes('_') && user.email.includes('@atria.edu.in')) {
      const parts = user.email.split('@')[0].split('_');
      if (parts.length >= 2) return parts[1].toUpperCase();
    }
    return null;
  }

  let currentUser = {
    id: 'GUEST',
    name: 'Guest / Student Viewer',
    role: 'VIEWER',
    can_edit: false,
    can_manage_faculty: false
  };

  try {
    const saved = localStorage.getItem('academic_user');
    if (saved) {
      currentUser = JSON.parse(saved);
      const userDept = getUserAssignedDept(currentUser);
      if (!isCrossDeptUser(currentUser) && userDept) {
        currentDept = userDept;
      }
    }
  } catch (e) {}

  function renderDeptSelector() {
    if (!deptSelect) return;
    deptSelect.innerHTML = '';

    const userDept = getUserAssignedDept(currentUser);
    const isDeptBound = currentUser && currentUser.id !== 'GUEST' && !isCrossDeptUser(currentUser) && userDept;
    const wrap = document.querySelector('.dept-selector-wrap');

    if (isDeptBound) {
      // Force currentDept to user's assigned department
      currentDept = userDept;

      const dept = appState.departments.find(d => d.code === userDept) || { code: userDept, name: userDept };
      const opt = document.createElement('option');
      opt.value = dept.code;
      opt.textContent = `🔒 ${dept.name} (${dept.code}) [Your Dept]`;
      opt.selected = true;
      deptSelect.appendChild(opt);

      deptSelect.disabled = true;
      deptSelect.classList.add('dept-locked');
      deptSelect.title = `Department locked to ${dept.name} (${userDept}). Your authorization is strictly restricted to your assigned department.`;
      
      if (wrap) wrap.classList.add('locked');
    } else {
      deptSelect.disabled = false;
      deptSelect.classList.remove('dept-locked');
      deptSelect.title = 'Select department to view or manage';

      if (wrap) wrap.classList.remove('locked');

      appState.departments.forEach(dept => {
        const opt = document.createElement('option');
        opt.value = dept.code;
        opt.textContent = `${dept.name} (${dept.code})`;
        if (dept.code === currentDept) opt.selected = true;
        deptSelect.appendChild(opt);
      });
    }
    updateDeptBadge();
  }

  function updateDeptBadge() {
    const dept = appState.departments.find(d => d.code === currentDept);
    if (!dept) return;

    const userDept = getUserAssignedDept(currentUser);
    const isDeptBound = currentUser && currentUser.id !== 'GUEST' && !isCrossDeptUser(currentUser) && userDept;

    if (deptBadge) {
      if (isDeptBound) {
        deptBadge.textContent = `🔒 ${dept.code} Only`;
        deptBadge.className = 'badge badge-active';
        deptBadge.title = `Access strictly confined to ${dept.name}`;
      } else {
        deptBadge.textContent = dept.status;
        deptBadge.className = `badge ${dept.code === 'CSE' ? 'badge-active' : ''}`;
        deptBadge.title = '';
      }
    }

    const homeDeptName = document.getElementById('homeDeptName');
    if (homeDeptName) {
      if (isDeptBound) {
        homeDeptName.innerHTML = `${dept.name} (${dept.code}) <span class="badge" style="background: #0f766e; color: #fff; font-size: 11px; margin-left: 6px;">🔒 Assigned Dept</span>`;
      } else {
        homeDeptName.textContent = `${dept.name} (${dept.code})`;
      }
    }
    const printDeptName = document.getElementById('printDeptName');
    if (printDeptName) printDeptName.textContent = dept.name.toUpperCase();
    renderHomeStats();
  }

  if (deptSelect) {
    deptSelect.addEventListener('change', (e) => {
      const userDept = getUserAssignedDept(currentUser);
      const isDeptBound = currentUser && currentUser.id !== 'GUEST' && !isCrossDeptUser(currentUser) && userDept;

      if (isDeptBound && e.target.value !== userDept) {
        alert(`⚠️ Access Denied: You are signed in as ${currentUser.name} (${currentUser.role}) with authority exclusively for the ${userDept} department.\n\nYou cannot switch to or view other departments.`);
        deptSelect.value = userDept;
        currentDept = userDept;
        updateDeptBadge();
        return;
      }

      currentDept = e.target.value;
      updateDeptBadge();
      const dept = appState.departments.find(d => d.code === currentDept);
      if (!dept.schemes || Object.keys(dept.schemes).length === 0) {
        alert(`Department ${currentDept} has no scheme data yet. You can start adding courses or switch back to CSE to see the full pilot.`);
      }
      renderSchemeTable();
      updateSyllabusCourseDropdown();
    });
  }

  const userLoggedInBlock = document.getElementById('userLoggedInBlock');
  const userGuestBlock = document.getElementById('userGuestBlock');
  const userRoleBadge = document.getElementById('userRoleBadge');
  const userNameDisplay = document.getElementById('userNameDisplay');
  const btnManageAccess = document.getElementById('btnManageAccess');
  const btnLogout = document.getElementById('btnLogout');
  const btnLoginModalOpen = document.getElementById('btnLoginModalOpen');
  const loginModal = document.getElementById('loginModal');
  const accessManagementModal = document.getElementById('accessManagementModal');
  const authLandingView = document.getElementById('authLandingView');
  const appMainView = document.getElementById('appMainView');
  const btnContinueAsGuest = document.getElementById('btnContinueAsGuest');

  function showAuthLandingView(message = '') {
    if (authLandingView) authLandingView.style.display = 'flex';
    if (appMainView) appMainView.style.display = 'none';
    // NOTE: the login gate never renders the institutional accounts directory.
    // Credentials are shown only inside the admin dashboard (renderAccountDirectory).
    if (message) {
      const loginAlertBox = document.getElementById('loginAlertBox');
      if (loginAlertBox) {
        loginAlertBox.style.display = 'block';
        loginAlertBox.textContent = message;
      }
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function showAppMainView() {
    if (authLandingView) authLandingView.style.display = 'none';
    if (appMainView) appMainView.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function openLoginModal(message = '') {
    showAuthLandingView(message);
  }

  function closeLoginModal() {
    if (currentUser && currentUser.id !== 'GUEST') {
      showAppMainView();
    }
  }

  function updateUserSessionUI() {
    renderDeptSelector();

    const userDept = getUserAssignedDept(currentUser);
    const isDeptBound = currentUser && currentUser.id !== 'GUEST' && !isCrossDeptUser(currentUser) && userDept;

    if (currentUser.can_edit) {
      if (userLoggedInBlock) userLoggedInBlock.style.display = 'flex';
      if (userGuestBlock) userGuestBlock.style.display = 'none';

      if (userRoleBadge) {
        userRoleBadge.textContent = currentUser.role;
        userRoleBadge.style.background = currentUser.badge_color || (currentUser.can_manage_faculty ? '#1e3a8a' : '#047857');
      }
      if (userNameDisplay) {
        const deptTag = isDeptBound ? ` [${userDept}]` : '';
        userNameDisplay.textContent = `${currentUser.name} (${currentUser.title || currentUser.role}${deptTag})`;
      }
      if (btnManageAccess) {
        btnManageAccess.style.display = currentUser.can_manage_faculty ? 'inline-block' : 'none';
      }
    } else {
      if (userLoggedInBlock) userLoggedInBlock.style.display = 'none';
      if (userGuestBlock) userGuestBlock.style.display = 'flex';
    }

    // Update Notice Banners in Scheme & Syllabus
    const noticeScheme = document.getElementById('authNoticeScheme');
    const noticeSyllabus = document.getElementById('authNoticeSyllabus');

    if (noticeScheme) {
      if (currentUser.can_manage_faculty) {
        if (isCrossDeptUser(currentUser)) {
          noticeScheme.className = 'auth-notice-banner auth-notice-leadership';
          noticeScheme.innerHTML = `
            <div>👑 <strong>Institutional Leadership Mode:</strong> Logged in as <strong>${currentUser.name} (${currentUser.role})</strong>. You have college-wide oversight and authoring access across all departments.</div>
            <div><button class="btn btn-secondary btn-sm" id="btnNoticeManageAccess" style="font-size: 11px; padding: 4px 10px; background: #fff;">⚙️ Manage Faculty Access</button></div>
          `;
        } else {
          noticeScheme.className = 'auth-notice-banner auth-notice-leadership';
          noticeScheme.innerHTML = `
            <div>👑 <strong>Department Leadership Mode:</strong> Logged in as <strong>${currentUser.name} (HOD - ${userDept || currentDept})</strong>. You have authoring permissions and faculty authorization rights strictly for the <strong>${userDept || currentDept}</strong> department.</div>
            <div><button class="btn btn-secondary btn-sm" id="btnNoticeManageAccess" style="font-size: 11px; padding: 4px 10px; background: #fff;">⚙️ Manage Faculty Access</button></div>
          `;
        }
        const b = document.getElementById('btnNoticeManageAccess');
        if (b) b.onclick = openAccessModal;
      } else if (currentUser.can_edit) {
        noticeScheme.className = 'auth-notice-banner auth-notice-authorized';
        noticeScheme.innerHTML = `
          <div>✏️ <strong>Department Authoring Mode:</strong> Logged in as <strong>${currentUser.name} (Authorized BoS Coordinator - ${userDept || currentDept})</strong>. You have permission to create, edit, and update courses strictly for the <strong>${userDept || currentDept}</strong> department.</div>
        `;
      } else {
        noticeScheme.className = 'auth-notice-banner auth-notice-viewonly';
        noticeScheme.innerHTML = `
          <div>🔒 <strong>View-Only Mode:</strong> You can view schemes and download official documents. Only appointed BoS Coordinators, HOD, Dean, Principal, and Admin have editing rights.</div>
          <div><button class="btn btn-primary btn-sm" id="btnNoticeLoginScheme" style="font-size: 11px; padding: 4px 10px;">🔐 Log In</button></div>
        `;
        const b = document.getElementById('btnNoticeLoginScheme');
        if (b) b.onclick = () => openLoginModal();
      }
    }

    if (noticeSyllabus) {
      if (currentUser.can_manage_faculty) {
        noticeSyllabus.className = 'auth-notice-banner auth-notice-leadership';
        noticeSyllabus.innerHTML = `
          <div>👑 <strong>${isCrossDeptUser(currentUser) ? 'Institutional' : 'Department'} Leadership Mode:</strong> Full syllabus editing and outcome engineering permissions unlocked for <strong>${currentDept}</strong>.</div>
        `;
      } else if (currentUser.can_edit) {
        noticeSyllabus.className = 'auth-notice-banner auth-notice-authorized';
        noticeSyllabus.innerHTML = `
          <div>✏️ <strong>Syllabus Authoring Mode (${userDept || currentDept}):</strong> You are authorized to edit modules, Bloom's levels, and practical components for courses under the <strong>${userDept || currentDept}</strong> department.</div>
        `;
      } else {
        noticeSyllabus.className = 'auth-notice-banner auth-notice-viewonly';
        noticeSyllabus.innerHTML = `
          <div>🔒 <strong>View-Only Mode:</strong> Syllabus forms are locked. You can browse and export documents. Log in as an authorized coordinator or college leadership to edit.</div>
          <div><button class="btn btn-primary btn-sm" id="btnNoticeLoginSyllabus" style="font-size: 11px; padding: 4px 10px;">🔐 Log In</button></div>
        `;
        const b = document.getElementById('btnNoticeLoginSyllabus');
        if (b) b.onclick = () => openLoginModal();
      }
    }

    // Toggle Syllabus Inputs lock
    const sylPane = document.getElementById('tab-syllabus');
    if (sylPane) {
      sylPane.classList.toggle('is-viewonly', !currentUser.can_edit);
      const btnSave = document.getElementById('btnSaveSyllabus');
      if (btnSave) {
        btnSave.style.opacity = currentUser.can_edit ? '1' : '0.6';
        btnSave.title = currentUser.can_edit ? 'Save Syllabus' : 'Editing restricted to authorized faculty and leadership';
      }
    }

    // Toggle Scheme add course button lock
    const btnAdd = document.getElementById('btnAddCourse');
    if (btnAdd) {
      if (currentUser.can_edit) {
        btnAdd.textContent = '+ Add New Course';
        btnAdd.classList.remove('btn-disabled-lock');
      } else {
        btnAdd.textContent = '🔒 Add Course (Login Required)';
        btnAdd.classList.add('btn-disabled-lock');
      }
    }

    renderSchemeTable();

    // Institutional accounts directory: admin-only, and only inside the app dashboard.
    renderAccountDirectory();
  }

  // Deliberately NOT rendered on the login gate: visitors must never see credentials.
  // 1.4 Institutional accounts directory — ADMIN ONLY, rendered inside the app dashboard.
  // Deliberately NOT rendered on the login gate: visitors must never see credentials.
  let showAccountPasswords = false;

  function renderAccountDirectory() {
    const card = document.getElementById('adminDirectoryCard');
    const isAdmin = !!(currentUser && (currentUser.role || '').toUpperCase() === 'ADMIN');

    if (card) card.style.display = isAdmin ? 'block' : 'none';
    if (!card || !isAdmin) return;

    const auth = appState.auth_system || {};
    const leadList = document.getElementById('dirLeadershipList');
    const authList = document.getElementById('dirCoordinatorList');
    const genList = document.getElementById('dirFacultyList');

    function createAccountRow(user, defaultPwd = 'college@123') {
      const pwd = user.password || defaultPwd;
      const pwdCell = showAccountPasswords
        ? `<strong style="color: #991b1b;">${pwd}</strong>`
        : `<span style="letter-spacing: 2px; color: #94a3b8;">••••••</span>`;
      return `
        <div style="border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; background: #f8fafc; display: flex; justify-content: space-between; align-items: center; gap: 10px;">
          <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;">
            <div style="font-weight: 700; font-size: 12px; color: var(--text-main);">${user.name}</div>
            <div style="font-size: 11px; color: var(--text-muted); font-family: monospace;">${user.email} • ${pwdCell}</div>
          </div>
          <button type="button" class="btn btn-secondary btn-sm btn-dir-copy" data-copy="${user.email} | ${pwd}" style="font-size: 10.5px; padding: 2px 8px; flex-shrink: 0;">Copy</button>
        </div>
      `;
    }

    if (leadList) {
      leadList.innerHTML = (auth.leadership || []).map(u => createAccountRow(u, 'principal@123')).join('');
    }

    const roster = auth.faculty_roster || [];
    const authorizedFaculty = roster.filter(f => f.can_edit);
    const generalFaculty = roster.filter(f => !f.can_edit);

    if (authList) {
      authList.innerHTML = authorizedFaculty.length
        ? authorizedFaculty.map(f => createAccountRow(f, 'coord@123')).join('')
        : '<p class="text-muted" style="font-size: 11.5px; margin: 0;">No authoring coordinators appointed yet.</p>';
    }

    if (genList) {
      genList.innerHTML = generalFaculty.length
        ? generalFaculty.map(f => createAccountRow(f, 'faculty@123')).join('')
        : '<p class="text-muted" style="font-size: 11.5px; margin: 0;">No registered viewers yet.</p>';
    }

    card.querySelectorAll('.btn-dir-copy').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(btn.getAttribute('data-copy') || '');
          btn.textContent = 'Copied ✓';
        } catch (e) {
          btn.textContent = 'Manual copy';
        }
        setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
      });
    });
  }

  const btnToggleDirPasswords = document.getElementById('btnToggleDirPasswords');
  if (btnToggleDirPasswords) {
    btnToggleDirPasswords.addEventListener('click', () => {
      showAccountPasswords = !showAccountPasswords;
      btnToggleDirPasswords.textContent = showAccountPasswords ? '🙈 Hide Passwords' : '👁️ Show Passwords';
      renderAccountDirectory();
    });
  }

  // Auth Modal Sub-Tabs (Sign In, Self-Register, Reset Password)
  function switchAuthModalTab(paneId) {
    document.querySelectorAll('.auth-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-auth-pane') === paneId);
    });
    document.querySelectorAll('.auth-pane-view').forEach(p => {
      p.style.display = p.id === paneId ? 'block' : 'none';
    });
  }

  const tabBtnSignIn = document.getElementById('tabBtnSignIn');
  const tabBtnRegister = document.getElementById('tabBtnRegister');
  const tabBtnReset = document.getElementById('tabBtnReset');
  if (tabBtnSignIn) tabBtnSignIn.onclick = () => switchAuthModalTab('paneSignIn');
  if (tabBtnRegister) tabBtnRegister.onclick = () => switchAuthModalTab('paneRegister');
  if (tabBtnReset) tabBtnReset.onclick = () => switchAuthModalTab('paneReset');

  const linkGotoForgot = document.getElementById('linkGotoForgot');
  const linkGotoRegister = document.getElementById('linkGotoRegister');
  if (linkGotoForgot) {
    linkGotoForgot.onclick = (e) => {
      e.preventDefault();
      switchAuthModalTab('paneReset');
    };
  }
  if (linkGotoRegister) {
    linkGotoRegister.onclick = (e) => {
      e.preventDefault();
      switchAuthModalTab('paneRegister');
    };
  }

  // Toggle Credentials Directory accordion
  const toggleCredentialsDir = document.getElementById('toggleCredentialsDir');
  const credentialsDirContent = document.getElementById('credentialsDirContent');
  const credentialsDirChevron = document.getElementById('credentialsDirChevron');
  if (toggleCredentialsDir && credentialsDirContent) {
    toggleCredentialsDir.addEventListener('click', () => {
      const isHidden = credentialsDirContent.style.display === 'none';
      credentialsDirContent.style.display = isHidden ? 'block' : 'none';
      if (credentialsDirChevron) {
        credentialsDirChevron.textContent = isHidden ? '▲ Hide Accounts' : '▼ Click to Expand';
      }
    });
  }

  // 1.1 Strict Institutional Email Syntax & Department Validation: username_departmentname@atria.edu.in
  function validateAtriaEmailSyntax(email, expectedDept = null) {
    if (!email) {
      return { valid: false, message: 'Institutional email is required.' };
    }
    const trimmed = email.trim().toLowerCase();
    
    // Strict syntax regex: username_departmentname@atria.edu.in
    const match = trimmed.match(/^([a-z0-9._-]+)_([a-z0-9-]+)@atria\.edu\.in$/i);
    if (!match) {
      return {
        valid: false,
        message: '⚠️ Invalid Email Syntax! Must follow the format "username_departmentname@atria.edu.in" (e.g. yourname_cse@atria.edu.in).'
      };
    }

    const emailUsername = match[1];
    const emailDept = match[2].toLowerCase();

    // Cross-check with selected Department if provided
    if (expectedDept) {
      const normalizedExpectedDept = expectedDept.trim().toLowerCase();
      
      // Check department match with standard aliases if applicable
      const isDeptMatch = (emailDept === normalizedExpectedDept) ||
        (normalizedExpectedDept === 'me' && (emailDept === 'mech' || emailDept === 'me')) ||
        (normalizedExpectedDept === 'mech' && (emailDept === 'me' || emailDept === 'mech')) ||
        (normalizedExpectedDept === 'civil' && emailDept === 'civil') ||
        (normalizedExpectedDept === 'ece' && emailDept === 'ece') ||
        (normalizedExpectedDept === 'cse' && emailDept === 'cse') ||
        (normalizedExpectedDept === 'gen' && (emailDept === 'gen' || emailDept === 'basic' || emailDept === 'science' || emailDept === 'hsmc')) ||
        (normalizedExpectedDept === 'admin' && (emailDept === 'admin' || emailDept === 'it' || emailDept === 'academics'));

      if (!isDeptMatch) {
        return {
          valid: false,
          message: `⚠️ Department Mismatch! You selected '${expectedDept.toUpperCase()}' department, but entered email '${trimmed}' with '_${emailDept}'. The email must end with '_${normalizedExpectedDept}@atria.edu.in' (e.g. ${emailUsername}_${normalizedExpectedDept}@atria.edu.in).`
        };
      }
    }

    return { valid: true, email: trimmed, username: emailUsername, dept: emailDept };
  }

  // Live Auto-Sync for Registration Department & Email
  const regDept = document.getElementById('regDept');
  const regEmail = document.getElementById('regEmail');
  if (regDept && regEmail) {
    regDept.addEventListener('change', () => {
      const curDept = regDept.value.toLowerCase();
      regEmail.placeholder = `e.g. yourname_${curDept}@atria.edu.in`;
      const val = regEmail.value.trim();
      const match = val.match(/^([a-z0-9._-]+)_([a-z0-9-]+)(@atria\.edu\.in)$/i);
      if (match) {
        regEmail.value = `${match[1]}_${curDept}@atria.edu.in`;
      }
    });
  }

  // Toggle Password Visibility
  const btnTogglePassword = document.getElementById('btnTogglePassword');
  const loginInputPassword = document.getElementById('loginInputPassword');
  if (btnTogglePassword && loginInputPassword) {
    btnTogglePassword.addEventListener('click', () => {
      const isPwd = loginInputPassword.type === 'password';
      loginInputPassword.type = isPwd ? 'text' : 'password';
      btnTogglePassword.textContent = isPwd ? 'Hide Password' : 'Show Password';
    });
  }

  // Credential Login Form Submission Handler
  const credentialLoginForm = document.getElementById('credentialLoginForm');
  const loginAlertBox = document.getElementById('loginAlertBox');
  if (credentialLoginForm) {
    credentialLoginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rawEmail = (document.getElementById('loginInputEmail').value || '').trim();
      const pwd = (document.getElementById('loginInputPassword').value || '').trim();

      const syntaxCheck = validateAtriaEmailSyntax(rawEmail);
      if (!syntaxCheck.valid) {
        if (loginAlertBox) {
          loginAlertBox.style.display = 'block';
          loginAlertBox.textContent = syntaxCheck.message;
        }
        return;
      }

      const email = syntaxCheck.email;

      // Credentials are verified by the server, never against passwords that
      // this page may have received.
      if (loginAlertBox) loginAlertBox.style.display = 'none';
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, password: pwd })
        });
        const payload = await res.json().catch(() => ({}));
        if (res.ok && payload.user) {
          loginUser(payload.user);
          return;
        }
        if (loginAlertBox) {
          loginAlertBox.style.display = 'block';
          loginAlertBox.textContent = '⚠️ ' + (payload.message || ('Invalid password for ' + email + '.'));
        }
      } catch (err) {
        if (loginAlertBox) {
          loginAlertBox.style.display = 'block';
          loginAlertBox.textContent = '⚠️ Could not reach the server. Is run_app.py running?';
        }
      }
    });
  }

  // 1.2 Self-Registration Form (View & Download Access)
  const selfRegistrationForm = document.getElementById('selfRegistrationForm');
  const registerAlertBox = document.getElementById('registerAlertBox');
  if (selfRegistrationForm) {
    selfRegistrationForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fullName = (document.getElementById('regFullName').value || '').trim();
      const rawEmail = (document.getElementById('regEmail').value || '').trim();
      const dept = document.getElementById('regDept').value;
      const roleCategory = document.getElementById('regRole').value;
      const password = document.getElementById('regPassword').value;
      const passwordConfirm = document.getElementById('regPasswordConfirm').value;

      const syntaxCheck = validateAtriaEmailSyntax(rawEmail, dept);
      if (!syntaxCheck.valid) {
        if (registerAlertBox) {
          registerAlertBox.style.display = 'block';
          registerAlertBox.style.background = '#fef2f2';
          registerAlertBox.style.border = '1px solid #fecaca';
          registerAlertBox.style.color = '#991b1b';
          registerAlertBox.textContent = syntaxCheck.message;
        }
        return;
      }

      const email = syntaxCheck.email;

      if (password !== passwordConfirm) {
        if (registerAlertBox) {
          registerAlertBox.style.display = 'block';
          registerAlertBox.style.background = '#fef2f2';
          registerAlertBox.style.border = '1px solid #fecaca';
          registerAlertBox.style.color = '#991b1b';
          registerAlertBox.textContent = '⚠️ Passwords do not match. Please re-enter.';
        }
        return;
      }

      // The server owns account creation: it checks for duplicates, writes the
      // record and opens a session. The browser never sees a password list.
      try {
        const res = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: fullName,
            email: email,
            dept: dept,
            role: roleCategory,
            password: password
          })
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload.user) {
          if (registerAlertBox) {
            registerAlertBox.style.display = 'block';
            registerAlertBox.style.background = '#fef2f2';
            registerAlertBox.style.border = '1px solid #fecaca';
            registerAlertBox.style.color = '#991b1b';
            registerAlertBox.textContent = '⚠️ ' + (payload.message || 'Registration failed. Please try again.');
          }
          return;
        }
        loginUser(payload.user);
        alert(`🎉 Welcome to Atria Institute of Technology Curriculum Portal, ${fullName}!\n\nYour account (${email}) has been registered with View & Download access for all department schemes and syllabi.`);
      } catch (err) {
        if (registerAlertBox) {
          registerAlertBox.style.display = 'block';
          registerAlertBox.textContent = '⚠️ Could not reach the server. Is run_app.py running?';
        }
      }
    });
  }

  // 1.3 Password Reset with Simulated Registered Email OTP
  let activeResetOtp = null;
  let activeResetUser = null;
  let activeResetEmail = null;

  const btnSendResetOtp = document.getElementById('btnSendResetOtp');
  const resetInputEmail = document.getElementById('resetInputEmail');
  const resetAlertBox = document.getElementById('resetAlertBox');
  const resetStep1Box = document.getElementById('resetStep1Box');
  const resetStep2Box = document.getElementById('resetStep2Box');
  const simulatedOtpDisplay = document.getElementById('simulatedOtpDisplay');
  const otpTargetEmailText = document.getElementById('otpTargetEmailText');
  const resetVerifyForm = document.getElementById('resetVerifyForm');

  if (btnSendResetOtp && resetInputEmail) {
    btnSendResetOtp.addEventListener('click', async () => {
      const rawEmail = (resetInputEmail.value || '').trim();
      const syntaxCheck = validateAtriaEmailSyntax(rawEmail);
      if (!syntaxCheck.valid) {
        if (resetAlertBox) {
          resetAlertBox.style.display = 'block';
          resetAlertBox.style.background = '#fef2f2';
          resetAlertBox.style.border = '1px solid #fecaca';
          resetAlertBox.style.color = '#991b1b';
          resetAlertBox.textContent = syntaxCheck.message;
        }
        return;
      }

      const email = syntaxCheck.email;

      // The server issues and remembers the code; the browser only displays it
      // in place of the email a production deployment would send.
      try {
        const res = await fetch('/api/request-reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email })
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload.otp) {
          if (resetAlertBox) {
            resetAlertBox.style.display = 'block';
            resetAlertBox.style.background = '#fef2f2';
            resetAlertBox.style.border = '1px solid #fecaca';
            resetAlertBox.style.color = '#991b1b';
            resetAlertBox.textContent = '⚠️ ' + (payload.message || ('No registered account found for ' + email + '.'));
          }
          return;
        }
        activeResetOtp = payload.otp;
        activeResetUser = payload.name || email;
        activeResetEmail = email;
      } catch (err) {
        if (resetAlertBox) {
          resetAlertBox.style.display = 'block';
          resetAlertBox.textContent = '⚠️ Could not reach the server. Is run_app.py running?';
        }
        return;
      }

      if (resetAlertBox) resetAlertBox.style.display = 'none';
      if (otpTargetEmailText) otpTargetEmailText.textContent = email;
      if (simulatedOtpDisplay) simulatedOtpDisplay.textContent = activeResetOtp;

      if (resetStep1Box) resetStep1Box.style.display = 'none';
      if (resetStep2Box) resetStep2Box.style.display = 'block';
    });
  }

  if (resetVerifyForm) {
    resetVerifyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const enteredOtp = (document.getElementById('resetInputOtp').value || '').trim();
      const newPwd = document.getElementById('resetNewPassword').value;
      const confirmPwd = document.getElementById('resetConfirmPassword').value;

      if (newPwd !== confirmPwd) {
        alert('⚠️ Passwords do not match. Please re-enter.');
        return;
      }

      if (newPwd.length < 4) {
        alert('⚠️ Password must be at least 4 characters long.');
        return;
      }

      // The server checks the code and writes the new password.
      try {
        const res = await fetch('/api/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: activeResetEmail, otp: enteredOtp, password: newPwd })
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert('⚠️ ' + (payload.message || 'Password reset failed. Please request a new code.'));
          return;
        }
      } catch (err) {
        alert('⚠️ Could not reach the server. Is run_app.py running?');
        return;
      }

      alert(`✅ Password updated successfully for ${activeResetUser}!\nYou can now sign in with your new password.`);

      // Reset reset form state and switch to sign in
      if (resetStep1Box) resetStep1Box.style.display = 'block';
      if (resetStep2Box) resetStep2Box.style.display = 'none';
      activeResetOtp = null;
      activeResetUser = null;
      activeResetEmail = null;

      const loginEmailInput = document.getElementById('loginInputEmail');
      const loginPwdInput = document.getElementById('loginInputPassword');
      if (loginEmailInput) loginEmailInput.value = (resetInputEmail.value || '').trim();
      if (loginPwdInput) loginPwdInput.value = '';

      switchAuthModalTab('paneSignIn');
    });
  }

  async function loginUser(user) {
    currentUser = { ...user };
    try {
      localStorage.setItem('academic_user', JSON.stringify(currentUser));
    } catch (e) {}

    // Re-read the state as the authenticated user: administrators receive the
    // credential directory, everyone else receives the redacted variant.
    try {
      const stateRes = await fetch('/api/state');
      if (stateRes.ok) appState = await stateRes.json();
    } catch (e) {}

    const userDept = getUserAssignedDept(currentUser);
    if (!isCrossDeptUser(currentUser) && userDept) {
      currentDept = userDept;
    }

    showAppMainView();
    updateUserSessionUI();
    renderSchemeTable();
    updateSyllabusCourseDropdown();
    renderHomeStats();
    navigateToTab('tab-home');

    const scopeNotice = userDept && !isCrossDeptUser(currentUser)
      ? `\n🔒 Department Scope: Locked strictly to ${userDept} department.`
      : '\n🌐 Department Scope: College-wide Oversight (All Departments).';

    alert(`👋 Welcome ${currentUser.name}!\nYou are now signed in with role: ${currentUser.role} (${currentUser.can_edit ? 'Full Authoring Permissions' : 'View-Only Access'}).${scopeNotice}`);
  }

  function logoutUser() {
    currentUser = {
      id: 'GUEST',
      name: 'Guest / Student Viewer',
      role: 'VIEWER',
      can_edit: false,
      can_manage_faculty: false
    };
    try {
      localStorage.removeItem('academic_user');
    } catch (e) {}

    // Drop the server-side session cookie as well.
    fetch('/api/logout', { method: 'POST' }).catch(() => {});

    // Re-mask the credential directory so the next admin sees masked values.
    showAccountPasswords = false;
    const dirPwdBtn = document.getElementById('btnToggleDirPasswords');
    if (dirPwdBtn) dirPwdBtn.textContent = '👁️ Show Passwords';

    updateUserSessionUI();
    showAuthLandingView();
  }

  if (btnLoginModalOpen) btnLoginModalOpen.onclick = () => showAuthLandingView();
  if (btnLogout) btnLogout.onclick = logoutUser;

  const btnLoginClose = document.getElementById('btnLoginModalClose');
  if (btnLoginClose) btnLoginClose.onclick = closeLoginModal;

  const btnContinueGuest = document.getElementById('btnContinueGuest');
  if (btnContinueGuest) {
    btnContinueGuest.onclick = () => {
      logoutUser();
      closeLoginModal();
    };
  }

  if (btnContinueAsGuest) {
    btnContinueAsGuest.onclick = () => {
      currentUser = {
        id: 'GUEST',
        name: 'Guest / Student Viewer',
        role: 'VIEWER',
        can_edit: false,
        can_manage_faculty: false
      };
      showAppMainView();
      updateUserSessionUI();
      renderSchemeTable();
      updateSyllabusCourseDropdown();
      renderHomeStats();
      navigateToTab('tab-home');
    };
  }

  // Access Management Modal (Admin, Principal, Dean, HOD)
  function openAccessModal() {
    if (!currentUser.can_manage_faculty) {
      alert('Access Denied: Only Admin, Principal, Dean, and HOD can manage faculty permissions.');
      return;
    }
    renderFacultyAccessTable();
    if (accessManagementModal) {
      accessManagementModal.classList.add('show');
      accessManagementModal.classList.add('active');
    }
  }

  function closeAccessModal() {
    if (accessManagementModal) {
      accessManagementModal.classList.remove('show');
      accessManagementModal.classList.remove('active');
    }
  }

  // Click outside to close modals
  const editFacultyModal = document.getElementById('editFacultyModal');
  function closeEditFacultyModal() {
    if (editFacultyModal) {
      editFacultyModal.classList.remove('show');
      editFacultyModal.classList.remove('active');
    }
  }

  const btnEditFacultyModalClose = document.getElementById('btnEditFacultyModalClose');
  if (btnEditFacultyModalClose) btnEditFacultyModalClose.onclick = closeEditFacultyModal;
  const btnCancelEditFacultyModal = document.getElementById('btnCancelEditFacultyModal');
  if (btnCancelEditFacultyModal) btnCancelEditFacultyModal.onclick = closeEditFacultyModal;

  window.addEventListener('click', (e) => {
    if (e.target === loginModal) closeLoginModal();
    if (e.target === accessManagementModal) closeAccessModal();
    if (e.target === editFacultyModal) closeEditFacultyModal();
    if (e.target === courseModal) courseModal.classList.remove('show');
  });

  // Escape key to close modals
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeLoginModal();
      closeAccessModal();
      closeEditFacultyModal();
      if (courseModal) courseModal.classList.remove('show');
    }
  });

  // Faculty Search & Role Filter State
  let facultySearchQuery = '';
  let facultyFilterRoleState = 'ALL';

  const facultySearchInput = document.getElementById('facultySearchInput');
  if (facultySearchInput) {
    facultySearchInput.addEventListener('input', (e) => {
      facultySearchQuery = (e.target.value || '').trim().toLowerCase();
      renderFacultyAccessTable();
    });
  }

  const facultyFilterRole = document.getElementById('facultyFilterRole');
  if (facultyFilterRole) {
    facultyFilterRole.addEventListener('change', (e) => {
      facultyFilterRoleState = e.target.value;
      renderFacultyAccessTable();
    });
  }

  function getInitials(name) {
    if (!name) return 'FC';
    const clean = name.replace(/Dr\.|Prof\.|Mr\.|Ms\./g, '').trim();
    const parts = clean.split(' ').filter(p => p.length > 0);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return clean.substring(0, 2).toUpperCase() || 'FC';
  }

  function renderFacultyAccessTable() {
    const roster = (appState.auth_system && appState.auth_system.faculty_roster) || [];
    const tbody = document.getElementById('facultyRosterTableBody');
    const badge = document.getElementById('authCountBadge');
    const pillTotal = document.getElementById('facultyPillTotal');
    const pillAuth = document.getElementById('facultyPillAuth');
    const pillView = document.getElementById('facultyPillView');
    const chkSelectAll = document.getElementById('chkSelectAllFaculty');
    const bulkBar = document.getElementById('facultyBulkActionsBar');

    const totalCount = roster.length;
    const authCount = roster.filter(f => f.can_edit).length;
    const viewCount = totalCount - authCount;

    if (badge) badge.textContent = `${authCount} of ${totalCount} faculty currently authorized to edit.`;
    if (pillTotal) pillTotal.textContent = `Total: ${totalCount}`;
    if (pillAuth) pillAuth.textContent = `Authorized: ${authCount}`;
    if (pillView) pillView.textContent = `View-Only: ${viewCount}`;

    // Filter roster
    let displayList = roster;
    if (facultySearchQuery) {
      displayList = displayList.filter(f => 
        (f.name || '').toLowerCase().includes(facultySearchQuery) ||
        (f.designation || '').toLowerCase().includes(facultySearchQuery) ||
        (f.email || '').toLowerCase().includes(facultySearchQuery)
      );
    }

    if (facultyFilterRoleState === 'AUTH') {
      displayList = displayList.filter(f => f.can_edit);
    } else if (facultyFilterRoleState === 'VIEW') {
      displayList = displayList.filter(f => !f.can_edit);
    }

    if (tbody) {
      if (displayList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding: 24px;">No faculty members match your search criteria.</td></tr>`;
      } else {
        tbody.innerHTML = displayList.map((f, idx) => `
          <tr>
            <td style="text-align: center;">
              <input type="checkbox" class="faculty-row-select-chk" data-id="${f.id}" style="width: 16px; height: 16px; cursor: pointer;">
            </td>
            <td style="text-align: center; color: var(--text-muted); font-weight: 600;">${idx + 1}</td>
            <td>
              <div style="display: flex; align-items: center; gap: 8px;">
                <div class="faculty-avatar-mini">${getInitials(f.name)}</div>
                <div>
                  <strong>${f.name}</strong><br>
                  <span style="font-size: 11.5px; color: var(--text-muted);">${f.designation || 'Faculty Member'}</span>
                </div>
              </div>
            </td>
            <td style="font-size: 12px; font-family: monospace;">${f.email}</td>
            <td style="text-align: center;"><span class="badge">${f.dept || 'CSE'}</span></td>
            <td style="text-align: center;">
              <label style="display: inline-flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="checkbox" class="faculty-auth-chk" data-id="${f.id}" ${f.can_edit ? 'checked' : ''} style="width: 17px; height: 17px; cursor: pointer;">
                <span style="font-size: 12px; font-weight: 600; color: ${f.can_edit ? '#047857' : '#64748b'};">
                  ${f.can_edit ? 'Authorized (Edit)' : 'View-Only'}
                </span>
              </label>
            </td>
            <td style="text-align: center;">
              <div style="display: flex; gap: 4px; justify-content: center;">
                <button type="button" class="btn btn-sm btn-outline btn-edit-faculty" data-id="${f.id}" title="Edit Name, Email, Password & Permissions" style="padding: 3px 8px; font-size: 11.5px;">
                  ✏️ Edit
                </button>
                <button type="button" class="btn btn-sm btn-danger btn-del-faculty" data-id="${f.id}" data-name="${f.name}" title="Delete User" style="padding: 3px 8px; font-size: 11.5px;">
                  🗑️
                </button>
              </div>
            </td>
          </tr>
        `).join('');
      }

      // Checkbox update counter
      function updateBulkToolbar() {
        const checkedChks = tbody.querySelectorAll('.faculty-row-select-chk:checked');
        const count = checkedChks.length;
        if (bulkBar) {
          bulkBar.style.display = count > 0 ? 'flex' : 'none';
        }
        const textEl = document.getElementById('bulkSelectedCountText');
        if (textEl) textEl.textContent = `${count} user${count === 1 ? '' : 's'} selected`;
        if (chkSelectAll) {
          chkSelectAll.checked = count > 0 && count === tbody.querySelectorAll('.faculty-row-select-chk').length;
        }
      }

      // Individual row select checkboxes
      tbody.querySelectorAll('.faculty-row-select-chk').forEach(chk => {
        chk.addEventListener('change', updateBulkToolbar);
      });

      // Master Select All Checkbox
      if (chkSelectAll) {
        chkSelectAll.onclick = () => {
          const isChecked = chkSelectAll.checked;
          tbody.querySelectorAll('.faculty-row-select-chk').forEach(chk => {
            chk.checked = isChecked;
          });
          updateBulkToolbar();
        };
      }

      // Individual permission checkboxes
      tbody.querySelectorAll('.faculty-auth-chk').forEach(chk => {
        chk.addEventListener('change', () => {
          const count = tbody.querySelectorAll('.faculty-auth-chk:checked').length;
          if (badge) badge.textContent = `${count} of ${roster.length} faculty currently authorized to edit.`;
        });
      });

      // Single Delete Faculty Handler
      tbody.querySelectorAll('.btn-del-faculty').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = btn.getAttribute('data-id');
          const name = btn.getAttribute('data-name');

          if (currentUser && currentUser.id === id) {
            alert(`⚠️ Action Blocked: You cannot delete your own active account (${name}) while logged in.`);
            return;
          }

          if (!confirm(`Are you sure you want to permanently delete user "${name}" from the institutional roster?\n\nThis will remove their access and credentials.`)) {
            return;
          }

          appState.auth_system.faculty_roster = appState.auth_system.faculty_roster.filter(f => f.id !== id);
          await saveStateToServer();

          renderFacultyAccessTable();
          renderHomeDashboard();
          alert(`✅ User "${name}" has been permanently removed from the system.`);
        });
      });

      // Single Edit Faculty Handler
      tbody.querySelectorAll('.btn-edit-faculty').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = btn.getAttribute('data-id');
          const fac = roster.find(f => f.id === id);
          if (!fac) return;
          openEditFacultyModal(fac);
        });
      });
    }
  }

  // Edit Faculty Modal Implementation
  function openEditFacultyModal(fac) {
    if (!editFacultyModal) return;
    document.getElementById('editFacultyId').value = fac.id;
    document.getElementById('editFacultyName').value = fac.name || '';
    document.getElementById('editFacultyDesignation').value = fac.designation || '';
    document.getElementById('editFacultyEmail').value = fac.email || '';
    document.getElementById('editFacultyDept').value = fac.dept || 'CSE';
    document.getElementById('editFacultyPassword').value = fac.password || 'coord@123';
    document.getElementById('editFacultyCanEdit').checked = !!fac.can_edit;

    const alertBox = document.getElementById('editFacultyAlertBox');
    if (alertBox) alertBox.style.display = 'none';

    editFacultyModal.classList.add('show');
    editFacultyModal.classList.add('active');
  }

  const editFacultyDeptSelect = document.getElementById('editFacultyDept');
  const editFacultyEmailInput = document.getElementById('editFacultyEmail');
  if (editFacultyDeptSelect && editFacultyEmailInput) {
    editFacultyDeptSelect.addEventListener('change', () => {
      const curDept = editFacultyDeptSelect.value.toLowerCase();
      const val = editFacultyEmailInput.value.trim();
      const match = val.match(/^([a-z0-9._-]+)_([a-z0-9-]+)(@atria\.edu\.in)$/i);
      if (match) {
        editFacultyEmailInput.value = `${match[1]}_${curDept}@atria.edu.in`;
      }
    });
  }

  const editFacultyForm = document.getElementById('editFacultyForm');
  if (editFacultyForm) {
    editFacultyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('editFacultyId').value;
      const name = (document.getElementById('editFacultyName').value || '').trim();
      const designation = (document.getElementById('editFacultyDesignation').value || '').trim();
      const rawEmail = (document.getElementById('editFacultyEmail').value || '').trim();
      const dept = document.getElementById('editFacultyDept').value;
      const password = (document.getElementById('editFacultyPassword').value || '').trim();
      const canEdit = document.getElementById('editFacultyCanEdit').checked;
      const alertBox = document.getElementById('editFacultyAlertBox');

      const syntaxCheck = validateAtriaEmailSyntax(rawEmail, dept);
      if (!syntaxCheck.valid) {
        if (alertBox) {
          alertBox.style.display = 'block';
          alertBox.style.background = '#fef2f2';
          alertBox.style.border = '1px solid #fecaca';
          alertBox.style.color = '#991b1b';
          alertBox.textContent = syntaxCheck.message;
        }
        return;
      }

      const email = syntaxCheck.email;

      const roster = (appState.auth_system && appState.auth_system.faculty_roster) || [];
      const fac = roster.find(f => f.id === id);
      if (!fac) return;

      // Check if email conflicts with another user
      const auth = appState.auth_system || {};
      const allOtherUsers = [
        ...(auth.leadership || []),
        ...roster.filter(f => f.id !== id)
      ];

      if (allOtherUsers.some(u => (u.email || '').toLowerCase() === email)) {
        if (alertBox) {
          alertBox.style.display = 'block';
          alertBox.style.background = '#fef2f2';
          alertBox.style.border = '1px solid #fecaca';
          alertBox.style.color = '#991b1b';
          alertBox.textContent = '⚠️ This email address is already in use by another user.';
        }
        return;
      }

      // Update faculty details
      fac.name = name;
      fac.designation = designation;
      fac.email = email;
      fac.dept = dept;
      fac.password = password;
      fac.can_edit = canEdit;
      fac.role = canEdit ? 'Authorized Coordinator' : 'Faculty (View-Only)';

      // If active logged-in user was modified, sync session
      if (currentUser && currentUser.id === id) {
        currentUser.name = name;
        currentUser.email = email;
        currentUser.can_edit = canEdit;
        currentUser.role = fac.role;
        try {
          localStorage.setItem('academic_user', JSON.stringify(currentUser));
        } catch (err) {}
        updateUserSessionUI();
      }

      await saveStateToServer();
      closeEditFacultyModal();
      renderFacultyAccessTable();
      renderHomeDashboard();
      alert(`✅ Details for "${name}" have been updated successfully!`);
    });
  }

  // Bulk Actions Handlers
  const btnBulkDelete = document.getElementById('btnBulkDeleteFaculty');
  if (btnBulkDelete) {
    btnBulkDelete.addEventListener('click', async () => {
      const selectedChks = document.querySelectorAll('#facultyRosterTableBody .faculty-row-select-chk:checked');
      if (selectedChks.length === 0) return;

      const selectedIds = Array.from(selectedChks).map(chk => chk.getAttribute('data-id'));
      const roster = (appState.auth_system && appState.auth_system.faculty_roster) || [];
      
      // Filter out self if logged in
      const hasSelf = currentUser && selectedIds.includes(currentUser.id);
      const targetIds = selectedIds.filter(id => !currentUser || id !== currentUser.id);

      if (targetIds.length === 0) {
        alert('⚠️ Action Blocked: You cannot delete your own active account.');
        return;
      }

      const warningText = hasSelf ? '\n(Note: Your own logged-in account will be preserved).' : '';
      if (!confirm(`Are you sure you want to permanently delete the ${targetIds.length} selected users from the institutional roster?${warningText}`)) {
        return;
      }

      appState.auth_system.faculty_roster = roster.filter(f => !targetIds.includes(f.id));
      await saveStateToServer();

      renderFacultyAccessTable();
      renderHomeDashboard();
      alert(`✅ ${targetIds.length} users have been deleted successfully.`);
    });
  }

  const btnBulkAuthorize = document.getElementById('btnBulkAuthorizeFaculty');
  if (btnBulkAuthorize) {
    btnBulkAuthorize.addEventListener('click', async () => {
      const selectedChks = document.querySelectorAll('#facultyRosterTableBody .faculty-row-select-chk:checked');
      if (selectedChks.length === 0) return;

      const selectedIds = Array.from(selectedChks).map(chk => chk.getAttribute('data-id'));
      const roster = (appState.auth_system && appState.auth_system.faculty_roster) || [];

      roster.forEach(f => {
        if (selectedIds.includes(f.id)) {
          f.can_edit = true;
          f.role = 'Authorized Coordinator';
        }
      });

      await saveStateToServer();
      renderFacultyAccessTable();
      renderHomeDashboard();
      alert(`✅ Granted authoring permissions to ${selectedIds.length} selected users.`);
    });
  }

  const btnBulkRevoke = document.getElementById('btnBulkRevokeFaculty');
  if (btnBulkRevoke) {
    btnBulkRevoke.addEventListener('click', async () => {
      const selectedChks = document.querySelectorAll('#facultyRosterTableBody .faculty-row-select-chk:checked');
      if (selectedChks.length === 0) return;

      const selectedIds = Array.from(selectedChks).map(chk => chk.getAttribute('data-id'));
      const roster = (appState.auth_system && appState.auth_system.faculty_roster) || [];

      roster.forEach(f => {
        if (selectedIds.includes(f.id)) {
          f.can_edit = false;
          f.role = 'Faculty (View-Only)';
        }
      });

      await saveStateToServer();
      renderFacultyAccessTable();
      renderHomeDashboard();
      alert(`✅ Revoked authoring permissions for ${selectedIds.length} selected users.`);
    });
  }

  if (btnManageAccess) btnManageAccess.onclick = openAccessModal;
  const btnAccessClose = document.getElementById('btnAccessModalClose');
  if (btnAccessClose) btnAccessClose.onclick = closeAccessModal;
  const btnCancelAccess = document.getElementById('btnCancelAccessModal');
  if (btnCancelAccess) btnCancelAccess.onclick = closeAccessModal;

  // Access Modal Sub-Tabs
  function switchAccessModalTab(paneId) {
    document.querySelectorAll('[data-access-pane]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-access-pane') === paneId);
    });
    document.querySelectorAll('.access-pane-view').forEach(p => {
      p.style.display = p.id === paneId ? 'block' : 'none';
    });
    if (paneId === 'paneAccessRegister') {
      ensureMultiFacultyRowsInitialized();
    }
  }

  const tabBtnAccessList = document.getElementById('tabBtnAccessList');
  const tabBtnAccessRegister = document.getElementById('tabBtnAccessRegister');
  const tabBtnAccessBulkPaste = document.getElementById('tabBtnAccessBulkPaste');
  if (tabBtnAccessList) tabBtnAccessList.onclick = () => switchAccessModalTab('paneAccessList');
  if (tabBtnAccessRegister) tabBtnAccessRegister.onclick = () => switchAccessModalTab('paneAccessRegister');
  if (tabBtnAccessBulkPaste) tabBtnAccessBulkPaste.onclick = () => switchAccessModalTab('paneAccessBulkPaste');

  // Dynamic Multi-Row Batch Faculty Registration
  const multiRowsBody = document.getElementById('multiFacultyRowsBody');
  const btnAddMultiRow = document.getElementById('btnAddMultiRow');
  const btnResetMultiRows = document.getElementById('btnResetMultiRows');
  const multiFacultyEnrollForm = document.getElementById('multiFacultyEnrollForm');
  const multiRegAlertBox = document.getElementById('multiRegAlertBox');

  function createMultiFacultyRowHtml(index = 1) {
    return `
      <tr class="multi-add-row" data-row-idx="${index}">
        <td style="text-align: center; color: var(--text-muted); font-weight: 700;">${index}</td>
        <td><input type="text" class="form-input multi-name" placeholder="e.g. Dr. Harish Rao" required style="width: 100%;"></td>
        <td><input type="text" class="form-input multi-desig" placeholder="Associate Professor" required style="width: 100%;"></td>
        <td><input type="email" class="form-input multi-email" placeholder="harish_cse@atria.edu.in" required style="width: 100%;"></td>
        <td>
          <select class="form-input multi-dept" style="width: 100%;">
            <option value="CSE" selected>CSE</option>
            <option value="ECE">ECE</option>
            <option value="ME">ME</option>
            <option value="CIVIL">CIVIL</option>
          </select>
        </td>
        <td><input type="text" class="form-input multi-pwd" value="coord@123" required style="width: 100%; font-family: monospace;"></td>
        <td style="text-align: center;">
          <input type="checkbox" class="multi-can-edit" checked style="width: 17px; height: 17px; cursor: pointer;">
        </td>
        <td style="text-align: center;">
          <button type="button" class="btn btn-sm btn-danger btn-remove-multi-row" title="Remove this row" style="padding: 2px 6px;">✕</button>
        </td>
      </tr>
    `;
  }

  function ensureMultiFacultyRowsInitialized() {
    if (!multiRowsBody) return;
    if (multiRowsBody.children.length === 0) {
      multiRowsBody.innerHTML = createMultiFacultyRowHtml(1) + createMultiFacultyRowHtml(2);
      wireMultiRowRemoveButtons();
    }
  }

  function wireMultiRowRemoveButtons() {
    if (!multiRowsBody) return;
    multiRowsBody.querySelectorAll('.btn-remove-multi-row').forEach(btn => {
      btn.onclick = (e) => {
        const row = e.target.closest('tr');
        if (multiRowsBody.children.length > 1) {
          row.remove();
          // Renumber rows
          Array.from(multiRowsBody.children).forEach((r, i) => {
            r.querySelector('td:first-child').textContent = (i + 1).toString();
          });
        } else {
          alert('You must have at least one faculty row.');
        }
      };
    });

    // Auto-align email department placeholder and suffix on change
    multiRowsBody.querySelectorAll('.multi-dept').forEach(deptSel => {
      deptSel.onchange = () => {
        const row = deptSel.closest('tr');
        const emailInput = row.querySelector('.multi-email');
        const curDept = deptSel.value.toLowerCase();
        emailInput.placeholder = `e.g. harish_${curDept}@atria.edu.in`;
        const val = emailInput.value.trim();
        const match = val.match(/^([a-z0-9._-]+)_([a-z0-9-]+)(@atria\.edu\.in)$/i);
        if (match) {
          emailInput.value = `${match[1]}_${curDept}@atria.edu.in`;
        }
      };
    });
  }

  if (btnAddMultiRow) {
    btnAddMultiRow.onclick = () => {
      if (!multiRowsBody) return;
      const nextIdx = multiRowsBody.children.length + 1;
      const tr = document.createElement('tr');
      tr.className = 'multi-add-row';
      tr.innerHTML = createMultiFacultyRowHtml(nextIdx).replace(/^<tr[^>]*>|<\/tr>$/g, '');
      multiRowsBody.appendChild(tr);
      wireMultiRowRemoveButtons();
    };
  }

  if (btnResetMultiRows) {
    btnResetMultiRows.onclick = () => {
      if (multiRowsBody) {
        multiRowsBody.innerHTML = createMultiFacultyRowHtml(1);
        wireMultiRowRemoveButtons();
      }
      if (multiRegAlertBox) multiRegAlertBox.style.display = 'none';
    };
  }

  if (multiFacultyEnrollForm) {
    multiFacultyEnrollForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rows = multiRowsBody.querySelectorAll('.multi-add-row');
      const auth = appState.auth_system = appState.auth_system || {};
      auth.faculty_roster = auth.faculty_roster || [];
      const existingEmails = new Set([
        ...(auth.leadership || []).map(u => (u.email || '').toLowerCase()),
        ...auth.faculty_roster.map(u => (u.email || '').toLowerCase())
      ]);

      const toAdd = [];
      const seenBatchEmails = new Set();
      let hasError = false;

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const name = (r.querySelector('.multi-name').value || '').trim();
        const designation = (r.querySelector('.multi-desig').value || '').trim();
        const rawEmail = (r.querySelector('.multi-email').value || '').trim();
        const dept = r.querySelector('.multi-dept').value;
        const pwd = (r.querySelector('.multi-pwd').value || '').trim() || 'coord@123';
        const canEdit = r.querySelector('.multi-can-edit').checked;

        if (!name || !rawEmail) {
          hasError = true;
          alert(`Row ${i + 1} has empty Name or Email.`);
          break;
        }

        const syntaxCheck = validateAtriaEmailSyntax(rawEmail, dept);
        if (!syntaxCheck.valid) {
          hasError = true;
          alert(`Row ${i + 1}: ${syntaxCheck.message}`);
          break;
        }

        const email = syntaxCheck.email;

        if (existingEmails.has(email) || seenBatchEmails.has(email)) {
          hasError = true;
          alert(`Row ${i + 1}: Email "${email}" is already registered or duplicated in this batch.`);
          break;
        }

        seenBatchEmails.add(email);
        toAdd.push({
          id: `FAC-${Date.now().toString().slice(-4)}-${i+1}`,
          name: name,
          designation: designation,
          email: email,
          dept: dept,
          password: pwd,
          can_edit: canEdit,
          role: canEdit ? 'Authorized Coordinator' : 'Faculty (View-Only)'
        });
      }

      if (hasError || toAdd.length === 0) return;

      toAdd.forEach(item => auth.faculty_roster.push(item));
      await saveStateToServer();

      if (multiRegAlertBox) {
        multiRegAlertBox.style.display = 'block';
        multiRegAlertBox.style.background = '#f0fdf4';
        multiRegAlertBox.style.border = '1px solid #bbf7d0';
        multiRegAlertBox.style.color = '#166534';
        multiRegAlertBox.innerHTML = `✅ Successfully registered <strong>${toAdd.length} faculty members</strong>! They can now log in immediately.`;
      }

      // Reset rows to fresh template
      multiRowsBody.innerHTML = createMultiFacultyRowHtml(1) + createMultiFacultyRowHtml(2);
      wireMultiRowRemoveButtons();

      renderFacultyAccessTable();
      renderHomeDashboard();
    });
  }

  // Bulk CSV / Text Paste Importer
  const btnLoadSampleCsv = document.getElementById('btnLoadSampleCsv');
  const btnClearBulkPaste = document.getElementById('btnClearBulkPaste');
  const btnSubmitBulkPaste = document.getElementById('btnSubmitBulkPaste');
  const bulkPasteTextarea = document.getElementById('bulkPasteTextarea');
  const bulkPasteAlertBox = document.getElementById('bulkPasteAlertBox');

  if (btnLoadSampleCsv && bulkPasteTextarea) {
    btnLoadSampleCsv.onclick = () => {
      bulkPasteTextarea.value = 
`Dr. R. K. Mishra, Professor, mishra_cse@atria.edu.in, CSE, coord@123, Y
Prof. Sunita Sen, Associate Professor, sunita_cse@atria.edu.in, CSE, coord@123, Y
Prof. Manoj Patil, Assistant Professor, manoj_cse@atria.edu.in, CSE, faculty@123, N
Dr. Bhavana Nair, Assistant Professor, bhavana_cse@atria.edu.in, CSE, faculty@123, N`;
    };
  }

  if (btnClearBulkPaste && bulkPasteTextarea) {
    btnClearBulkPaste.onclick = () => {
      bulkPasteTextarea.value = '';
      if (bulkPasteAlertBox) bulkPasteAlertBox.style.display = 'none';
    };
  }

  if (btnSubmitBulkPaste && bulkPasteTextarea) {
    btnSubmitBulkPaste.onclick = async () => {
      const raw = (bulkPasteTextarea.value || '').trim();
      if (!raw) {
        alert('Please enter or paste at least one line of faculty details.');
        return;
      }

      const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));
      const auth = appState.auth_system = appState.auth_system || {};
      auth.faculty_roster = auth.faculty_roster || [];
      const existingEmails = new Set([
        ...(auth.leadership || []).map(u => (u.email || '').toLowerCase()),
        ...auth.faculty_roster.map(u => (u.email || '').toLowerCase())
      ]);

      const imported = [];
      const skipped = [];

      lines.forEach((line, idx) => {
        const parts = line.split(',').map(p => p.trim());
        if (parts.length >= 3) {
          const name = parts[0];
          const designation = parts[1] || 'Assistant Professor';
          const rawEmail = parts[2];
          const dept = (parts[3] || 'CSE').toUpperCase();
          const pwd = parts[4] || 'coord@123';
          const canEditFlag = (parts[5] || 'Y').toUpperCase();
          const canEdit = canEditFlag === 'Y' || canEditFlag === 'YES' || canEditFlag === 'TRUE';

          const syntaxCheck = validateAtriaEmailSyntax(rawEmail, dept);
          if (!syntaxCheck.valid) {
            skipped.push(`Line ${idx + 1}: ${syntaxCheck.message}`);
            return;
          }

          const email = syntaxCheck.email;

          if (existingEmails.has(email)) {
            skipped.push(`${email} (Already registered)`);
          } else {
            existingEmails.add(email);
            imported.push({
              id: `FAC-${Date.now().toString().slice(-4)}-${idx+1}`,
              name: name,
              designation: designation,
              email: email,
              dept: dept,
              password: pwd,
              can_edit: canEdit,
              role: canEdit ? 'Authorized Coordinator' : 'Faculty (View-Only)'
            });
          }
        } else {
          skipped.push(`Line ${idx + 1}: Insufficient comma-separated values`);
        }
      });

      if (imported.length > 0) {
        imported.forEach(fac => auth.faculty_roster.push(fac));
        await saveStateToServer();
        renderFacultyAccessTable();
        renderHomeDashboard();

        if (bulkPasteAlertBox) {
          bulkPasteAlertBox.style.display = 'block';
          bulkPasteAlertBox.style.background = '#f0fdf4';
          bulkPasteAlertBox.style.border = '1px solid #bbf7d0';
          bulkPasteAlertBox.style.color = '#166534';
          bulkPasteAlertBox.innerHTML = `✅ Successfully imported <strong>${imported.length} faculty members</strong> into the roster!${skipped.length > 0 ? `<br><span style="font-size: 11px; color: #b45309;">⚠️ Skipped ${skipped.length} invalid/duplicate entries.</span>` : ''}`;
        }
        bulkPasteTextarea.value = '';
      } else {
        alert('No valid faculty entries could be imported. Check for duplicate emails or invalid format.');
      }
    };
  }

  // Save Permissions Button Handler
  const btnSaveAccess = document.getElementById('btnSaveFacultyAccess');
  if (btnSaveAccess) {
    btnSaveAccess.onclick = async () => {
      const roster = (appState.auth_system && appState.auth_system.faculty_roster) || [];
      const chks = document.querySelectorAll('.faculty-auth-chk');
      chks.forEach(chk => {
        const id = chk.getAttribute('data-id');
        const fac = roster.find(f => f.id === id);
        if (fac) {
          fac.can_edit = chk.checked;
          fac.role = chk.checked ? 'Authorized Coordinator' : 'Faculty (View-Only)';
        }
      });

      // If currently logged in user is one of the modified faculty
      const currentFac = roster.find(f => f.id === currentUser.id);
      if (currentFac) {
        currentUser.can_edit = currentFac.can_edit;
        currentUser.role = currentFac.role;
        try {
          localStorage.setItem('academic_user', JSON.stringify(currentUser));
        } catch (e) {}
      }

      await saveStateToServer();
      closeAccessModal();
      updateUserSessionUI();
      renderHomeDashboard();
      alert('✅ Faculty access permissions saved and updated successfully!');
    };
  }

  // 2. Department Selector is managed by renderDeptSelector() with strict role-based scoping (initialized above)

  // 3. Tab & Stepper History Routing (Comprehensive SPA Navigation)
  const TAB_HASH_MAP = {
    'tab-home': 'home',
    'tab-scheme': 'scheme',
    'tab-syllabus': 'syllabus',
    'tab-preview': 'preview'
  };

  const HASH_TAB_MAP = {
    'home': 'tab-home',
    'overview': 'tab-home',
    'scheme': 'tab-scheme',
    'syllabus': 'tab-syllabus',
    'preview': 'tab-preview'
  };

  const STEP_HASH_MAP = {
    'step-overview': 'step-1-overview',
    'step-cos': 'step-2-cos',
    'step-assessment': 'step-3-assessment',
    'step-modules': 'step-4-modules',
    'step-practicals': 'step-5-practicals',
    'step-books': 'step-6-books'
  };

  const HASH_STEP_MAP = {
    'step-1-overview': 'step-overview',
    'step-overview': 'step-overview',
    'overview': 'step-overview',
    'step-2-cos': 'step-cos',
    'step-cos': 'step-cos',
    'cos': 'step-cos',
    'step-3-assessment': 'step-assessment',
    'step-assessment': 'step-assessment',
    'assessment': 'step-assessment',
    'step-4-modules': 'step-modules',
    'step-modules': 'step-modules',
    'modules': 'step-modules',
    'step-5-practicals': 'step-practicals',
    'step-practicals': 'step-practicals',
    'practicals': 'step-practicals',
    'step-6-books': 'step-books',
    'step-books': 'step-books',
    'books': 'step-books'
  };

  function showStep(stepId, pushHistory = true) {
    if (!stepId || !document.getElementById(stepId)) {
      stepId = 'step-overview';
    }

    const stepButtons = document.querySelectorAll('.stepper-nav .step-btn');
    const wizardSteps = document.querySelectorAll('.wizard-step');

    stepButtons.forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-step') === stepId);
    });
    wizardSteps.forEach(s => {
      s.classList.toggle('active', s.id === stepId);
    });

    try {
      sessionStorage.setItem('academic_active_step', stepId);
    } catch (e) {}

    // Push history state so browser Back/Forward stays inside Syllabus Builder and steps back through previous tabs!
    if (pushHistory) {
      const stepSlug = STEP_HASH_MAP[stepId] || 'step-1-overview';
      const targetHash = `#syllabus/${stepSlug}`;
      if (window.location.hash !== targetHash) {
        history.pushState({ tabId: 'tab-syllabus', stepId: stepId }, '', targetHash);
      }
    }
  }

  window.navigateToTab = function(tabId, pushHistory = true) {
    if (!tabId || !document.getElementById(tabId)) {
      tabId = 'tab-home';
    }

    const tabButtons = document.querySelectorAll('.tab-bar .tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');
    tabButtons.forEach(b => b.classList.remove('active'));
    tabPanes.forEach(p => p.classList.remove('active'));

    const activeBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    if (activeBtn) activeBtn.classList.add('active');
    const activePane = document.getElementById(tabId);
    if (activePane) activePane.classList.add('active');

    try {
      sessionStorage.setItem('academic_active_tab', tabId);
    } catch (e) {}

    if (tabId === 'tab-syllabus') {
      updateSyllabusCourseDropdown();
      let activeStep = 'step-overview';
      const rawHash = (window.location.hash || '').replace('#', '').toLowerCase();
      if (rawHash.startsWith('syllabus/')) {
        const stepPart = rawHash.replace('syllabus/', '');
        if (HASH_STEP_MAP[stepPart]) {
          activeStep = HASH_STEP_MAP[stepPart];
        }
      } else {
        try {
          const savedStep = sessionStorage.getItem('academic_active_step');
          if (savedStep && document.getElementById(savedStep)) {
            activeStep = savedStep;
          }
        } catch (e) {}
      }
      showStep(activeStep, false);

      if (pushHistory) {
        const stepSlug = STEP_HASH_MAP[activeStep] || 'step-1-overview';
        const targetHash = `#syllabus/${stepSlug}`;
        if (window.location.hash !== targetHash) {
          history.pushState({ tabId: 'tab-syllabus', stepId: activeStep }, '', targetHash);
        }
      }
    } else {
      const hash = TAB_HASH_MAP[tabId] || 'home';
      const targetHash = '#' + hash;
      if (pushHistory) {
        if (window.location.hash !== targetHash) {
          history.pushState({ tabId: tabId }, '', targetHash);
        }
      }

      if (tabId === 'tab-preview') {
        renderPrintPreview();
      } else if (tabId === 'tab-home') {
        renderHomeStats();
      }
    }
  };

  document.querySelectorAll('.tab-bar .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      navigateToTab(btn.getAttribute('data-tab'), true);
    });
  });

  // Handle Browser Back / Forward buttons (popstate & hashchange)
  window.addEventListener('popstate', (event) => {
    // If popstate event has stepId, stay in Syllabus Builder and navigate to that step!
    if (event.state && event.state.tabId === 'tab-syllabus') {
      navigateToTab('tab-syllabus', false);
      if (event.state.stepId) {
        showStep(event.state.stepId, false);
      }
      return;
    }

    const rawHash = (window.location.hash || '').replace('#', '').toLowerCase();
    if (rawHash.startsWith('syllabus/')) {
      const stepPart = rawHash.replace('syllabus/', '');
      navigateToTab('tab-syllabus', false);
      const targetStep = HASH_STEP_MAP[stepPart] || 'step-overview';
      showStep(targetStep, false);
      return;
    }

    let targetTab = 'tab-home';
    if (event.state && event.state.tabId && document.getElementById(event.state.tabId)) {
      targetTab = event.state.tabId;
    } else {
      if (HASH_TAB_MAP[rawHash]) {
        targetTab = HASH_TAB_MAP[rawHash];
      }
    }
    navigateToTab(targetTab, false);
  });

  window.addEventListener('hashchange', () => {
    const rawHash = (window.location.hash || '').replace('#', '').toLowerCase();
    if (rawHash.startsWith('syllabus/')) {
      const stepPart = rawHash.replace('syllabus/', '');
      navigateToTab('tab-syllabus', false);
      const targetStep = HASH_STEP_MAP[stepPart] || 'step-overview';
      showStep(targetStep, false);
      return;
    }
    if (HASH_TAB_MAP[rawHash]) {
      navigateToTab(HASH_TAB_MAP[rawHash], false);
    }
  });

  function initAppRouting() {
    const rawHash = (window.location.hash || '').replace('#', '').toLowerCase();
    let initialTab = 'tab-home';

    if (rawHash.startsWith('syllabus/')) {
      initialTab = 'tab-syllabus';
    } else if (HASH_TAB_MAP[rawHash]) {
      initialTab = HASH_TAB_MAP[rawHash];
    } else {
      try {
        const savedTab = sessionStorage.getItem('academic_active_tab');
        if (savedTab && document.getElementById(savedTab)) {
          initialTab = savedTab;
        }
      } catch (e) {}
    }

    if (initialTab === 'tab-syllabus') {
      const stepPart = rawHash.replace('syllabus/', '');
      const activeStep = HASH_STEP_MAP[stepPart] || 'step-overview';
      history.replaceState({ tabId: 'tab-syllabus', stepId: activeStep }, '', '#syllabus/' + (STEP_HASH_MAP[activeStep] || 'step-1-overview'));
      navigateToTab('tab-syllabus', false);
      showStep(activeStep, false);
    } else {
      const hash = TAB_HASH_MAP[initialTab] || 'home';
      history.replaceState({ tabId: initialTab }, '', '#' + hash);
      navigateToTab(initialTab, false);
    }
  }

  // 4. Home Dashboard Render
  function getInitials(name) {
    if (!name) return 'GV';
    const clean = name.replace(/Dr\.|Prof\.|Mr\.|Ms\./g, '').trim();
    const parts = clean.split(' ').filter(p => p.length > 0);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return clean.substring(0, 2).toUpperCase() || 'GV';
  }

  function renderHomeStats() {
    renderHomeDashboard();
  }

  function renderHomeDashboard() {
    const dept = getActiveDept();
    if (!dept) return;

    // 1. Update Executive Hero Banner
    const avatarText = document.getElementById('homeAvatarText');
    const greetingName = document.getElementById('homeGreetingName');
    const roleBadge = document.getElementById('homeRoleBadge');
    const roleDesc = document.getElementById('homeRoleDesc');
    const homeDeptName = document.getElementById('homeDeptName');
    const btnHomeQuickLogin = document.getElementById('btnHomeQuickLogin');
    const btnHomeQuickManageAccess = document.getElementById('btnHomeQuickManageAccess');
    const btnHomeManageAccess = document.getElementById('btnHomeManageAccess');

    if (avatarText) avatarText.textContent = getInitials(currentUser.name);
    if (greetingName) greetingName.textContent = currentUser.id === 'GUEST' ? 'Welcome, Guest Viewer' : `Welcome, ${currentUser.name}`;
    if (homeDeptName) homeDeptName.textContent = `${dept.name} (${dept.code})`;

    if (roleBadge) {
      roleBadge.textContent = currentUser.role || 'VIEW-ONLY';
      roleBadge.style.background = currentUser.badge_color || (currentUser.can_manage_faculty ? '#1e3a8a' : (currentUser.can_edit ? '#047857' : '#64748b'));
      roleBadge.style.color = '#ffffff';
    }

    if (roleDesc) {
      if (currentUser.can_manage_faculty) {
        roleDesc.textContent = `👑 Institutional Leadership Mode: Logged in as ${currentUser.name} (${currentUser.role}). Full authoring access and authority to appoint BoS faculty coordinators.`;
      } else if (currentUser.can_edit) {
        roleDesc.textContent = `✏️ Authorized BoS Coordinator Mode: Logged in as ${currentUser.name}. Full authoring access to design schemes and write course syllabi.`;
      } else {
        roleDesc.textContent = `🔒 View-Only Mode: You can browse schemes, read syllabi, and export documents. Sign in with coordinator or leadership credentials to edit.`;
      }
    }

    if (btnHomeQuickLogin) {
      btnHomeQuickLogin.textContent = currentUser.id === 'GUEST' ? '🔐 Sign In' : '🔄 Switch Account / Sign Out';
      btnHomeQuickLogin.onclick = () => openLoginModal();
    }

    if (btnHomeQuickManageAccess) {
      btnHomeQuickManageAccess.style.display = currentUser.can_manage_faculty ? 'inline-block' : 'none';
      btnHomeQuickManageAccess.onclick = openAccessModal;
    }
    if (btnHomeManageAccess) {
      btnHomeManageAccess.style.display = currentUser.can_manage_faculty ? 'inline-block' : 'none';
      btnHomeManageAccess.onclick = openAccessModal;
    }

    // 2. Update KPI Metrics
    const auth = appState.auth_system || {};
    const roster = auth.faculty_roster || [];
    const authCount = roster.filter(f => f.can_edit).length;

    let totalCoursesCount = 0;
    const semesterKeys = Object.keys(dept.schemes || {});
    semesterKeys.forEach(k => {
      totalCoursesCount += (dept.schemes[k] || []).length;
    });

    const metricReg = document.getElementById('metricRegulation');
    const metricSem = document.getElementById('metricSemesters');
    const metricCourses = document.getElementById('metricCoursesCount');
    const metricFac = document.getElementById('metricFacultyCount');

    if (metricReg) metricReg.textContent = dept.regulations || '2024 Scheme';
    if (metricSem) metricSem.textContent = '8 Semesters (I–VIII)';
    if (metricCourses) metricCourses.textContent = `${totalCoursesCount} Active Courses`;
    if (metricFac) metricFac.textContent = `${authCount} / ${roster.length} Authorized`;
  }

  // 5. Semester Selector
  const semSelect = document.getElementById('semSelect');
  semSelect.addEventListener('change', (e) => {
    currentSem = e.target.value;
    renderSchemeTable();
    updateSyllabusCourseDropdown();
  });

  // 6. Search & Filter in Scheme
  const schemeSearchInput = document.getElementById('schemeSearchInput');
  const schemeFilterType = document.getElementById('schemeFilterType');

  if (schemeSearchInput) {
    schemeSearchInput.addEventListener('input', (e) => {
      schemeSearchQuery = e.target.value.toLowerCase().trim();
      renderSchemeTable();
    });
  }

  if (schemeFilterType) {
    schemeFilterType.addEventListener('change', (e) => {
      schemeTypeFilter = e.target.value;
      renderSchemeTable();
    });
  }

  // 7. Interface 1: Scheme Management
  function getActiveDept() {
    return appState.departments.find(d => d.code === currentDept);
  }

  function getActiveSemesterCourses() {
    const dept = getActiveDept();
    if (!dept || !dept.schemes) return [];
    let list = dept.schemes[currentSem] || [];

    // Filter by type
    if (schemeTypeFilter !== 'ALL') {
      list = list.filter(c => c.type && c.type.includes(schemeTypeFilter));
    }

    // Filter by search query
    if (schemeSearchQuery) {
      list = list.filter(c => 
        (c.code && c.code.toLowerCase().includes(schemeSearchQuery)) ||
        (c.title && c.title.toLowerCase().includes(schemeSearchQuery)) ||
        (c.type && c.type.toLowerCase().includes(schemeSearchQuery))
      );
    }

    return list;
  }

  function renderSchemeTable() {
    const courses = getActiveSemesterCourses();
    const tbody = document.getElementById('schemeTableBody');
    const tfoot = document.getElementById('schemeTableFoot');
    tbody.innerHTML = '';
    tfoot.innerHTML = '';

    let totalCredits = 0;
    let totalL = 0, totalT = 0, totalP = 0, totalS = 0, totalTotHours = 0;
    let totalCia = 0, totalSee = 0, totalMarks = 0;

    if (courses.length === 0) {
      const isFiltered = schemeSearchQuery !== '' || schemeTypeFilter !== 'ALL';
      const emptyMsg = isFiltered
        ? `No matching courses found for ${currentDept} - Semester ${getRomanSemester(currentSem)}. Clear the search or type filter to see all courses.`
        : `No courses yet in ${currentDept} - Semester ${getRomanSemester(currentSem)}. Click “+ Add New Course” to start building this semester.`;
      tbody.innerHTML = `<tr><td colspan="15" class="text-center" style="padding: 30px; color: #64748b;">${emptyMsg}</td></tr>`;
    } else {
      courses.forEach((c, index) => {
        const credits = Number(c.c || 0);
        const l = Number(c.l || 0);
        const t = Number(c.t || 0);
        const p = Number(c.p || 0);
        const s = Number(c.s || 0);
        const tot = Number(c.tot || (l + t + p + s));
        const cia = Number(c.cia || 50);
        const see = Number(c.see || 50);
        const totMarks = Number(c.total || (cia + see));

        totalCredits += credits;
        totalL += l;
        totalT += t;
        totalP += p;
        totalS += s;
        totalTotHours += tot;
        totalCia += cia;
        totalSee += see;
        totalMarks += totMarks;

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="text-center">${c.sl || index + 1}</td>
          <td><span class="badge">${c.type}</span></td>
          <td><strong style="color: #1e40af;">${c.code}</strong></td>
          <td><strong>${c.title}</strong></td>
          <td class="text-center">${c.td || 'CSE'}</td>
          <td class="text-center">${c.psb || 'CSE'}</td>
          <td class="text-center">${l}</td>
          <td class="text-center">${t}</td>
          <td class="text-center">${p}</td>
          <td class="text-center">${s}</td>
          <td class="text-center" style="font-weight: 700; background: #f8fafc;">${tot}</td>
          <td class="text-center">${c.exam_hours || 3}</td>
          <td class="text-center">${cia}</td>
          <td class="text-center">${see}</td>
          <td class="text-center" style="font-weight: 700; background: #f8fafc;">${totMarks}</td>
          <td class="text-center" style="font-weight: 800; font-size: 13px; color: #1e40af;">${credits || '-'}</td>
          <td class="no-print text-center">
            <button class="btn btn-sm btn-outline btn-open-syl" data-code="${c.code}" title="Open Syllabus Builder">Syllabus ➔</button>
            ${currentUser && currentUser.can_edit ? `<button class="btn-danger btn-sm btn-del-course" data-code="${c.code}" title="Delete Course">✕</button>` : ''}
          </td>
        `;
        tbody.appendChild(tr);
      });

      // Total Row
      tfoot.innerHTML = `
        <tr style="border-top: 2px solid #000; font-weight: 800; background: #f1f5f9;">
          <td colspan="6" class="text-center">TOTAL</td>
          <td class="text-center">${totalL}</td>
          <td class="text-center">${totalT}</td>
          <td class="text-center">${totalP}</td>
          <td class="text-center">${totalS}</td>
          <td class="text-center">${totalTotHours}</td>
          <td class="text-center">-</td>
          <td class="text-center">${totalCia}</td>
          <td class="text-center">${totalSee}</td>
          <td class="text-center">${totalMarks}</td>
          <td class="text-center" style="color: #1e40af; font-size: 14px;">${totalCredits}</td>
          <td class="no-print"></td>
        </tr>
      `;
    }

    // Top Summary
    document.getElementById('valTotalCredits').textContent = totalCredits;
    document.getElementById('valTotalHours').textContent = `${totalTotHours} hrs`;
    document.getElementById('valCourseCount').textContent = courses.length;
    document.getElementById('valTotalMarks').textContent = totalMarks;
    document.getElementById('valCieSeeRatio').textContent = `CIA: ${totalCia} | SEE: ${totalSee}`;

    const creditHint = document.getElementById('valCreditHint');
    if (totalCredits > 24) {
      creditHint.textContent = '⚠️ High Credit Load (>24 credits)';
      creditHint.style.color = '#dc2626';
    } else {
      creditHint.textContent = 'Recommended: 20-24 credits';
      creditHint.style.color = '#64748b';
    }

    // Event handlers
    tbody.querySelectorAll('.btn-open-syl').forEach(b => {
      b.addEventListener('click', () => {
        const code = b.getAttribute('data-code');
        openCourseSyllabus(code);
      });
    });

    tbody.querySelectorAll('.btn-del-course').forEach(b => {
      b.addEventListener('click', () => {
        const code = b.getAttribute('data-code');
        if (confirm(`Remove course ${code} from Semester ${currentSem}?`)) {
          deleteCourse(code);
        }
      });
    });
  }

  async function deleteCourse(code) {
    if (!currentUser || !currentUser.can_edit) {
      openLoginModal('Permission denied: You must be an authorized coordinator or leadership member to delete courses.');
      return;
    }
    const dept = getActiveDept();
    if (dept && dept.schemes && dept.schemes[currentSem]) {
      dept.schemes[currentSem] = dept.schemes[currentSem].filter(c => c.code !== code);
      // Remove the linked syllabus too, otherwise it lingers in the JSON and reappears
      if (dept.syllabi && Object.prototype.hasOwnProperty.call(dept.syllabi, code)) {
        delete dept.syllabi[code];
      }
      renderSchemeTable();
      updateSyllabusCourseDropdown();
      renderHomeStats();
      await saveStateToServer();
    }
  }

  // Wipe every course + syllabus for the active semester, so the app can start fresh
  async function clearCurrentSemester() {
    if (!currentUser || !currentUser.can_edit) {
      openLoginModal('Permission denied: You must be an authorized coordinator or leadership member to clear a semester.');
      return;
    }
    const dept = getActiveDept();
    if (!dept) return;

    const existing = (dept.schemes && dept.schemes[currentSem]) ? dept.schemes[currentSem] : [];
    if (existing.length === 0) {
      alert(`Semester ${getRomanSemester(currentSem)} is already empty.`);
      return;
    }

    const label = `all ${existing.length} course(s) in ${currentDept} - Semester ${getRomanSemester(currentSem)}`;
    if (!confirm(`Remove ${label}, including their syllabus content?\n\nThis is saved immediately and cannot be undone.`)) {
      return;
    }

    existing.forEach(c => {
      if (dept.syllabi && Object.prototype.hasOwnProperty.call(dept.syllabi, c.code)) {
        delete dept.syllabi[c.code];
      }
    });

    if (!dept.schemes) dept.schemes = {};
    dept.schemes[currentSem] = [];
    activeCourseCode = null;
    renderSchemeTable();
    updateSyllabusCourseDropdown();
    renderHomeStats();
    await saveStateToServer();
    alert(`✅ Semester ${getRomanSemester(currentSem)} cleared. It is now empty.`);
  }

  // Course Modal
  const courseModal = document.getElementById('courseModal');
  const btnAddCourse = document.getElementById('btnAddCourse');
  const btnModalClose = document.getElementById('btnModalClose');
  const btnCancelModal = document.getElementById('btnCancelModal');
  const courseForm = document.getElementById('courseForm');

  btnAddCourse.addEventListener('click', () => {
    if (!currentUser || !currentUser.can_edit) {
      openLoginModal('Please log in with an authorized coordinator or leadership account to add new courses.');
      return;
    }
    courseForm.reset();
    document.getElementById('mL').value = 42;
    document.getElementById('mT').value = 0;
    document.getElementById('mP').value = 28;
    document.getElementById('mS').value = 56;
    document.getElementById('mCredits').value = 4;
    document.getElementById('mExamHours').value = 3;
    document.getElementById('mCia').value = 50;
    document.getElementById('mSee').value = 50;
    const userDept = getUserAssignedDept(currentUser);
    const isDeptBound = currentUser && currentUser.id !== 'GUEST' && !isCrossDeptUser(currentUser) && userDept;
    if (isDeptBound) {
      document.getElementById('mTd').value = userDept;
      document.getElementById('mTd').readOnly = true;
      document.getElementById('mPsb').value = userDept;
      document.getElementById('mPsb').readOnly = true;
    } else {
      document.getElementById('mTd').value = currentDept;
      document.getElementById('mTd').readOnly = false;
      document.getElementById('mPsb').value = currentDept;
      document.getElementById('mPsb').readOnly = false;
    }
    courseModal.classList.add('show');
  });

  const btnClearSemester = document.getElementById('btnClearSemester');
  if (btnClearSemester) {
    btnClearSemester.addEventListener('click', clearCurrentSemester);
  }

  btnModalClose.addEventListener('click', () => courseModal.classList.remove('show'));
  btnCancelModal.addEventListener('click', () => courseModal.classList.remove('show'));

  courseForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const l = Number(document.getElementById('mL').value || 0);
    const t = Number(document.getElementById('mT').value || 0);
    const p = Number(document.getElementById('mP').value || 0);
    const s = Number(document.getElementById('mS').value || 0);
    const cia = Number(document.getElementById('mCia').value || 50);
    const see = Number(document.getElementById('mSee').value || 50);

    const newCourse = {
      type: document.getElementById('mType').value,
      code: document.getElementById('mCode').value.trim().toUpperCase(),
      title: document.getElementById('mTitle').value.trim(),
      td: document.getElementById('mTd').value.trim() || 'CSE',
      psb: document.getElementById('mPsb').value.trim() || 'CSE',
      l: l,
      t: t,
      p: p,
      s: s,
      tot: l + t + p + s,
      exam_hours: Number(document.getElementById('mExamHours').value || 3),
      cia: cia,
      see: see,
      total: cia + see,
      c: Number(document.getElementById('mCredits').value || 0)
    };

    const dept = getActiveDept();
    if (!dept.schemes) dept.schemes = {};
    if (!dept.schemes[currentSem]) dept.schemes[currentSem] = [];

    const existingIndex = dept.schemes[currentSem].findIndex(c => c.code === newCourse.code);
    if (existingIndex >= 0) {
      dept.schemes[currentSem][existingIndex] = newCourse;
    } else {
      newCourse.sl = dept.schemes[currentSem].length + 1;
      dept.schemes[currentSem].push(newCourse);
    }

    courseModal.classList.remove('show');
    renderSchemeTable();
    updateSyllabusCourseDropdown();
    renderHomeStats();
    await saveStateToServer();
  });

  // 8. Interface 2: Stepper / Wizard Logic
  document.querySelectorAll('.stepper-nav .step-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showStep(btn.getAttribute('data-step'), true);
    });
  });

  window.nextWizardStep = function(targetStepId) {
    showStep(targetStepId, true);
    window.scrollTo({ top: 180, behavior: 'smooth' });
  };

  window.prevWizardStep = function(targetStepId) {
    showStep(targetStepId, true);
    window.scrollTo({ top: 180, behavior: 'smooth' });
  };

  const sylCourseSelect = document.getElementById('sylCourseSelect');

  function updateSyllabusCourseDropdown() {
    const dept = getActiveDept();
    const courses = (dept && dept.schemes && dept.schemes[currentSem]) ? dept.schemes[currentSem] : [];
    sylCourseSelect.innerHTML = '';

    if (courses.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = '-- No courses in active semester --';
      sylCourseSelect.appendChild(opt);
      activeCourseCode = null;
      return;
    }

    courses.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.code;
      opt.textContent = `${c.code}: ${c.title} (${c.type})`;
      if (activeCourseCode === c.code) opt.selected = true;
      sylCourseSelect.appendChild(opt);
    });

    if (!activeCourseCode || !courses.find(c => c.code === activeCourseCode)) {
      activeCourseCode = courses[0].code;
    }

    loadCourseSyllabus(activeCourseCode);
  }

  sylCourseSelect.addEventListener('change', (e) => {
    activeCourseCode = e.target.value;
    loadCourseSyllabus(activeCourseCode);
  });

  function openCourseSyllabus(code) {
    activeCourseCode = code;
    navigateToTab('tab-syllabus');
    showStep('step-overview');
  }

  function getRomanSemester(num) {
    const romans = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V', '6': 'VI', '7': 'VII', '8': 'VIII' };
    return romans[num] || num;
  }

  function loadCourseSyllabus(code) {
    const dept = getActiveDept();
    const courses = (dept && dept.schemes && dept.schemes[currentSem]) ? dept.schemes[currentSem] : [];
    const course = courses.find(c => c.code === code);
    if (!course) return;

    // Active Banner
    document.getElementById('lblSylTitle').textContent = course.title;
    document.getElementById('lblSylSemester').textContent = getRomanSemester(currentSem);
    document.getElementById('lblSylCode').textContent = course.code;
    document.getElementById('lblSylType').textContent = course.type;
    document.getElementById('lblSylMarks').textContent = `${course.cia || 50} CIA / ${course.see || 50} SEE`;
    document.getElementById('lblSylSlt').textContent = `${course.l}:${course.t}:${course.p}:${course.s}`;
    document.getElementById('lblSylCredits').textContent = course.c || 4;

    // Step 1: Overview
    document.getElementById('txtExamHours').value = course.exam_hours ? String(course.exam_hours).padStart(2, '0') : '03';
    document.getElementById('txtPsb').value = course.psb || 'CSE';

    let syl = dept.syllabi && dept.syllabi[code];
    if (!syl) {
      syl = {
        title: course.title,
        semester: getRomanSemester(currentSem),
        code: course.code,
        type: course.type,
        cia: course.cia || 50,
        see: course.see || 50,
        slt: `${course.l}:${course.t}:${course.p}:${course.s}`,
        l: course.l, t: course.t, p: course.p, s: course.s,
        total_marks: course.total || 100,
        credits: course.c || 4,
        exam_hours: String(course.exam_hours || 3).padStart(2, '0'),
        exam_type: course.type.includes('PCCL') || course.type.includes('IPCC') ? 'Theory / Laboratory' : 'Theory',
        prerequisites: '',
        course_objectives: '',
        outcomes: [
          { id: 'CO1', desc: '', cl: '', pl: '' },
          { id: 'CO2', desc: '', cl: '', pl: '' },
          { id: 'CO3', desc: '', cl: '', pl: '' },
          { id: 'CO4', desc: '', cl: '', pl: '' },
          { id: 'CO5', desc: '', cl: '', pl: '' }
        ],
        co_assessment: [
          { co: 'CO 1', cie1: '', cie2: '', assignment: '', see: '' },
          { co: 'CO 2', cie1: '', cie2: '', assignment: '', see: '' },
          { co: 'CO 3', cie1: '', cie2: '', assignment: '', see: '' },
          { co: 'CO 4', cie1: '', cie2: '', assignment: '', see: '' },
          { co: 'CO 5', cie1: '', cie2: '', assignment: '', see: '' }
        ],
        modules: [
          { num: 'Module 1', co: 'CO 1', level: '', content: '', textbook_ref: '' },
          { num: 'Module 2', co: 'CO 2', level: '', content: '', textbook_ref: '' },
          { num: 'Module 3', co: 'CO 3', level: '', content: '', textbook_ref: '' },
          { num: 'Module 4', co: 'CO 4', level: '', content: '', textbook_ref: '' },
          { num: 'Module 5', co: 'CO 5', level: '', content: '', textbook_ref: '' }
        ],
        practicals: {
          has_practical: course.p > 0 || course.type.includes('IPCC') || course.type.includes('PCCL'),
          part_a: [],
          part_b: []
        },
        textbooks: [],
        references: [],
        web_links: []
      };
      if (!dept.syllabi) dept.syllabi = {};
      dept.syllabi[code] = syl;
    }

    document.getElementById('selExamType').value = syl.exam_type || 'Theory';
    document.getElementById('txtPrereq').value = syl.prerequisites || '';
    document.getElementById('txtObjectives').value = syl.course_objectives || '';

    // Render Steps
    renderCOTable(syl.outcomes || []);
    renderCOAssessmentTable(syl.co_assessment || []);
    renderModules(syl.modules || []);
    renderPracticals(syl.practicals || { has_practical: false, part_a: [], part_b: [] });
    renderSimpleList('textbookList', syl.textbooks || [], 'txt-book', 'Author, Book Title, Edition, Publisher');
    renderSimpleList('referenceList', syl.references || [], 'ref-book', 'Reference Book Title, Publisher');
    renderSimpleList('weblinkList', syl.web_links || [], 'web-link', 'https://nptel.ac.in/...');
  }

  // Render COs
  function renderCOTable(cos) {
    const tbody = document.getElementById('coTableBody');
    tbody.innerHTML = '';
    cos.forEach((co, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="text-center"><strong style="color: #1e40af;">${co.id || 'CO' + (idx + 1)}</strong></td>
        <td><textarea class="form-textarea co-desc" rows="2">${co.desc || ''}</textarea></td>
        <td><input type="text" class="form-input co-cl text-center" value="${co.cl || '3'}"></td>
        <td><input type="text" class="form-input co-pl text-center" value="${co.pl || '3'}"></td>
        <td class="no-print text-center"><button class="btn-danger btn-sm btn-del-co">✕</button></td>
      `;
      tr.querySelector('.btn-del-co').addEventListener('click', () => tr.remove());
      tbody.appendChild(tr);
    });
  }

  document.getElementById('btnAddCO').addEventListener('click', () => {
    const tbody = document.getElementById('coTableBody');
    const idx = tbody.children.length + 1;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="text-center"><strong style="color: #1e40af;">CO${idx}</strong></td>
      <td><textarea class="form-textarea co-desc" rows="2" placeholder="Course outcome statement..."></textarea></td>
      <td><input type="text" class="form-input co-cl text-center" value="3"></td>
      <td><input type="text" class="form-input co-pl text-center" value="3"></td>
      <td class="no-print text-center"><button class="btn-danger btn-sm btn-del-co">✕</button></td>
    `;
    tr.querySelector('.btn-del-co').addEventListener('click', () => tr.remove());
    tbody.appendChild(tr);
  });

  // Render CO Assessment
  function renderCOAssessmentTable(mappings) {
    const tbody = document.getElementById('coAssessmentTableBody');
    tbody.innerHTML = '';
    mappings.forEach(m => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="text-center"><strong>${m.co}</strong></td>
        <td class="text-center"><input type="text" class="form-input text-center asm-cie1" value="${m.cie1 || ''}" style="width: 70px;"></td>
        <td class="text-center"><input type="text" class="form-input text-center asm-cie2" value="${m.cie2 || ''}" style="width: 70px;"></td>
        <td class="text-center"><input type="text" class="form-input text-center asm-asgn" value="${m.assignment || ''}" style="width: 70px;"></td>
        <td class="text-center"><input type="text" class="form-input text-center asm-see" value="${m.see || ''}" style="width: 70px;"></td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Render Modules & Quick Module Pills
  function renderModules(modules) {
    const container = document.getElementById('moduleListContainer');
    container.innerHTML = '';
    modules.forEach((mod, idx) => {
      const div = document.createElement('div');
      div.className = 'module-item';
      div.id = `mod-block-${idx}`;
      div.innerHTML = `
        <div class="module-header">
          <span class="module-title-badge">${mod.num || 'Module ' + (idx + 1)}</span>
          <div style="display: flex; gap: 12px; align-items: center;">
            <label style="font-weight: 700;">Target CO:</label>
            <input type="text" class="form-input mod-co" value="${mod.co || 'CO ' + (idx + 1)}" style="width: 70px; text-align: center;">
            <label style="font-weight: 700;">Level:</label>
            <input type="text" class="form-input mod-level" value="${mod.level || 'CL: 3 / PL: 3'}" style="width: 140px; text-align: center;">
          </div>
        </div>
        <div class="module-body">
          <label class="form-label">Module Syllabus Description & Topics:</label>
          <textarea class="form-textarea mod-content" rows="4">${mod.content || ''}</textarea>
          <div style="margin-top: 10px;">
            <label class="form-label">Textbook / Chapter Citation:</label>
            <input type="text" class="form-input mod-bookref" value="${mod.textbook_ref || ''}" placeholder="e.g., Text book 1: Chapter 2 (2.1 - 2.5)">
          </div>
        </div>
      `;
      container.appendChild(div);
    });

    // Module Quick Pill click
    document.querySelectorAll('.mod-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mod-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const targetIdx = btn.getAttribute('data-mod');
        const targetBlock = document.getElementById(`mod-block-${targetIdx}`);
        if (targetBlock) {
          targetBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    });
  }

  // Render Practicals
  function renderPracticals(practicals) {
    const partA = document.getElementById('partAContainer');
    const partB = document.getElementById('partBContainer');
    partA.innerHTML = '';
    partB.innerHTML = '';

    (practicals.part_a || []).forEach((exp, idx) => {
      addExpRow(partA, idx + 1, exp, 'part-a-exp');
    });

    (practicals.part_b || []).forEach((exp, idx) => {
      addExpRow(partB, idx + 1, exp, 'part-b-exp');
    });
  }

  function addExpRow(container, num, text, className) {
    const div = document.createElement('div');
    div.className = 'experiment-item';
    div.innerHTML = `
      <span class="exp-num">${num}.</span>
      <textarea class="form-textarea ${className}" rows="2" style="font-size: 12px;">${text}</textarea>
      <button class="btn-danger btn-sm">✕</button>
    `;
    div.querySelector('button').addEventListener('click', () => div.remove());
    container.appendChild(div);
  }

  document.getElementById('btnAddPartA').addEventListener('click', () => {
    const container = document.getElementById('partAContainer');
    addExpRow(container, container.children.length + 1, '', 'part-a-exp');
  });

  document.getElementById('btnAddPartB').addEventListener('click', () => {
    const container = document.getElementById('partBContainer');
    addExpRow(container, container.children.length + 1, '', 'part-b-exp');
  });

  // Simple Lists
  function renderSimpleList(elementId, items, className, placeholder) {
    const container = document.getElementById(elementId);
    container.innerHTML = '';
    items.forEach((item, idx) => {
      const div = document.createElement('div');
      div.style.display = 'flex';
      div.style.gap = '6px';
      div.style.marginBottom = '6px';
      div.innerHTML = `
        <span style="font-weight: 700; color: #1e40af; width: 20px;">${idx + 1}.</span>
        <input type="text" class="form-input ${className}" value="${item}">
        <button class="btn-danger btn-sm">✕</button>
      `;
      div.querySelector('button').addEventListener('click', () => div.remove());
      container.appendChild(div);
    });
  }

  function addListItem(elementId, className, placeholder) {
    const container = document.getElementById(elementId);
    const div = document.createElement('div');
    div.style.display = 'flex';
    div.style.gap = '6px';
    div.style.marginBottom = '6px';
    div.innerHTML = `
      <span style="font-weight: 700; color: #1e40af; width: 20px;">${container.children.length + 1}.</span>
      <input type="text" class="form-input ${className}" placeholder="${placeholder}">
      <button class="btn-danger btn-sm">✕</button>
    `;
    div.querySelector('button').addEventListener('click', () => div.remove());
    container.appendChild(div);
  }

  document.getElementById('btnAddBook').addEventListener('click', () => addListItem('textbookList', 'txt-book', 'Author, Title, Edition, Publisher'));
  document.getElementById('btnAddRef').addEventListener('click', () => addListItem('referenceList', 'ref-book', 'Reference Book Title, Publisher'));
  document.getElementById('btnAddWebLink').addEventListener('click', () => addListItem('weblinkList', 'web-link', 'https://nptel.ac.in/...'));

  // Save Syllabus Action
  async function saveCurrentSyllabus(showSuccessAlert = true) {
    if (!currentUser || !currentUser.can_edit) {
      openLoginModal('Permission denied: You must be an authorized coordinator or leadership member to save syllabus changes.');
      return;
    }
    if (!activeCourseCode) return;
    const dept = getActiveDept();
    if (!dept.syllabi) dept.syllabi = {};

    const cos = [];
    document.querySelectorAll('#coTableBody tr').forEach(tr => {
      cos.push({
        id: tr.querySelector('strong').textContent,
        desc: tr.querySelector('.co-desc').value.trim(),
        cl: tr.querySelector('.co-cl').value.trim(),
        pl: tr.querySelector('.co-pl').value.trim()
      });
    });

    const asm = [];
    document.querySelectorAll('#coAssessmentTableBody tr').forEach(tr => {
      asm.push({
        co: tr.querySelector('strong').textContent,
        cie1: tr.querySelector('.asm-cie1').value.trim(),
        cie2: tr.querySelector('.asm-cie2').value.trim(),
        assignment: tr.querySelector('.asm-asgn').value.trim(),
        see: tr.querySelector('.asm-see').value.trim()
      });
    });

    const modules = [];
    document.querySelectorAll('#moduleListContainer .module-item').forEach(item => {
      modules.push({
        num: item.querySelector('.module-title-badge').textContent,
        co: item.querySelector('.mod-co').value.trim(),
        level: item.querySelector('.mod-level').value.trim(),
        content: item.querySelector('.mod-content').value.trim(),
        textbook_ref: item.querySelector('.mod-bookref').value.trim()
      });
    });

    const partA = [];
    document.querySelectorAll('#partAContainer .part-a-exp').forEach(t => {
      if (t.value.trim()) partA.push(t.value.trim());
    });

    const partB = [];
    document.querySelectorAll('#partBContainer .part-b-exp').forEach(t => {
      if (t.value.trim()) partB.push(t.value.trim());
    });

    const textbooks = [];
    document.querySelectorAll('#textbookList .txt-book').forEach(i => {
      if (i.value.trim()) textbooks.push(i.value.trim());
    });

    const references = [];
    document.querySelectorAll('#referenceList .ref-book').forEach(i => {
      if (i.value.trim()) references.push(i.value.trim());
    });

    const webLinks = [];
    document.querySelectorAll('#weblinkList .web-link').forEach(i => {
      if (i.value.trim()) webLinks.push(i.value.trim());
    });

    if (!dept.syllabi) dept.syllabi = {};
    dept.syllabi[activeCourseCode] = {
      title: document.getElementById('lblSylTitle').textContent,
      semester: document.getElementById('lblSylSemester').textContent,
      code: activeCourseCode,
      type: document.getElementById('lblSylType').textContent,
      cia: 50,
      see: 50,
      slt: document.getElementById('lblSylSlt').textContent,
      total_marks: 100,
      credits: Number(document.getElementById('lblSylCredits').textContent),
      exam_hours: document.getElementById('txtExamHours').value.trim() || '03',
      exam_type: document.getElementById('selExamType').value,
      prerequisites: document.getElementById('txtPrereq').value.trim(),
      course_objectives: document.getElementById('txtObjectives').value.trim(),
      outcomes: cos,
      co_assessment: asm,
      modules: modules,
      practicals: {
        has_practical: partA.length > 0 || partB.length > 0,
        part_a: partA,
        part_b: partB
      },
      textbooks: textbooks,
      references: references,
      web_links: webLinks
    };

    renderHomeStats();
    await saveStateToServer();
    if (showSuccessAlert) {
      alert(`✅ Syllabus for course ${activeCourseCode} has been saved successfully!`);
    }
  }

  document.getElementById('btnSaveSyllabus').addEventListener('click', () => saveCurrentSyllabus(true));

  const btnFinish = document.getElementById('btnFinishSyllabus');
  if (btnFinish) {
    btnFinish.addEventListener('click', async () => {
      await saveCurrentSyllabus(false);
      navigateToTab('tab-preview');
    });
  }

  // 9. Tab 3: Official Document Preview & Separate Export
  let currentPreviewMode = 'scheme'; // 'scheme' | 'syllabus' | 'all'

  async function saveStateToServer() {
    try {
      const res = await fetch('/api/save-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(appState)
      });
      if (res.status === 401 || res.status === 403) {
        const info = await res.json().catch(() => ({}));
        console.warn('Save rejected by server:', info.message || res.status);
        return { status: 'error', message: info.message || 'Not authorised to save.' };
      }
      return await res.json();
    } catch (e) {
      console.warn('Local server save endpoint not reachable:', e);
      return null;
    }
  }

  async function downloadDocx(type, specificCode = null) {
    const btn = document.activeElement;
    const oldText = btn ? btn.textContent : '';
    if (btn) btn.textContent = '⏳ Preparing Word File...';
    
    try {
      await saveStateToServer();
    } catch (e) {}

    let url = '';
    let fallbackFilename = '';

    if (type === 'scheme') {
      url = '/api/download/scheme-docx';
      fallbackFilename = `${currentDept}_2024_SCHEME.docx`;
    } else {
      const targetCode = specificCode || activeCourseCode || 'ALL';
      url = `/api/download/syllabus-docx?course=${encodeURIComponent(targetCode)}`;
      fallbackFilename = targetCode === 'ALL' ? `${currentDept}_SYLLABUS_All_Courses.docx` : `${currentDept}_Syllabus_${targetCode}.docx`;
    }
    
    const a = document.createElement('a');
    a.href = url;
    a.download = fallbackFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    if (btn) {
      setTimeout(() => { btn.textContent = oldText; }, 1200);
    }
  }

  function printDocument(mode) {
    document.body.classList.remove('print-scheme-only', 'print-syllabus-only');
    if (mode === 'scheme') {
      document.body.classList.add('print-scheme-only');
    } else if (mode === 'syllabus') {
      document.body.classList.add('print-syllabus-only');
    }
    window.print();
    setTimeout(() => {
      document.body.classList.remove('print-scheme-only', 'print-syllabus-only');
    }, 1500);
  }

  // Preview Mode Toggles
  const btnModeScheme = document.getElementById('btnModeScheme');
  const btnModeSyllabus = document.getElementById('btnModeSyllabus');
  const btnModeAll = document.getElementById('btnModeAll');
  const previewCourseFilterWrapper = document.getElementById('previewCourseFilterWrapper');
  const previewCourseSelect = document.getElementById('previewCourseSelect');

  function setPreviewMode(mode) {
    currentPreviewMode = mode;
    [btnModeScheme, btnModeSyllabus, btnModeAll].forEach(btn => {
      if (btn) btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });
    renderPrintPreview();
  }

  if (btnModeScheme) btnModeScheme.addEventListener('click', () => setPreviewMode('scheme'));
  if (btnModeSyllabus) btnModeSyllabus.addEventListener('click', () => setPreviewMode('syllabus'));
  if (btnModeAll) btnModeAll.addEventListener('click', () => setPreviewMode('all'));

  if (previewCourseSelect) {
    previewCourseSelect.addEventListener('change', (e) => {
      if (e.target.value) {
        activeCourseCode = e.target.value;
        renderPrintPreview();
      }
    });
  }

  // Quick export buttons from Scheme Tab
  const btnExportSchemeQuick = document.getElementById('btnExportSchemeQuick');
  if (btnExportSchemeQuick) {
    btnExportSchemeQuick.addEventListener('click', () => {
      setPreviewMode('scheme');
      navigateToTab('tab-preview');
    });
  }
  const btnDownloadSchemeDocxQuick = document.getElementById('btnDownloadSchemeDocxQuick');
  if (btnDownloadSchemeDocxQuick) {
    btnDownloadSchemeDocxQuick.addEventListener('click', () => downloadDocx('scheme'));
  }

  // Quick export buttons from Syllabus Tab
  const btnExportSyllabusQuick = document.getElementById('btnExportSyllabusQuick');
  if (btnExportSyllabusQuick) {
    btnExportSyllabusQuick.addEventListener('click', () => {
      setPreviewMode('syllabus');
      navigateToTab('tab-preview');
    });
  }
  const btnDownloadSyllabusDocxQuick = document.getElementById('btnDownloadSyllabusDocxQuick');
  if (btnDownloadSyllabusDocxQuick) {
    btnDownloadSyllabusDocxQuick.addEventListener('click', () => downloadDocx('syllabus'));
  }

  function renderPrintPreview() {
    const courses = getActiveSemesterCourses();
    const dept = getActiveDept();
    document.getElementById('printSemHeader').textContent = `${getRomanSemester(currentSem)} SEMESTER SCHEME OF TEACHING AND EXAMINATION`;

    const printSchemeSection = document.getElementById('printSchemeSection');
    const printSyllabusSection = document.getElementById('printSyllabusSection');
    const printDocDivider = document.getElementById('printDocDivider');
    const printDocSubtitle = document.getElementById('printDocSubtitle');
    const actionButtonsContainer = document.getElementById('previewActionButtons');

    // Populate Course Selector for preview if not already done
    if (previewCourseSelect && courses.length > 0) {
      const selectedVal = previewCourseSelect.value || activeCourseCode || (courses[0] ? courses[0].code : 'ALL');
      let optHtml = `<option value="ALL" ${selectedVal === 'ALL' ? 'selected' : ''}>📚 ALL Subjects in Semester (${getRomanSemester(currentSem)})</option>`;
      optHtml += courses.map(c => 
        `<option value="${c.code}" ${c.code === selectedVal ? 'selected' : ''}>${c.code} - ${c.title}</option>`
      ).join('');
      previewCourseSelect.innerHTML = optHtml;
    }

    const currentSyllabusChoice = previewCourseSelect && previewCourseSelect.value ? previewCourseSelect.value : (activeCourseCode || 'ALL');
    const isAllSyllabus = currentSyllabusChoice === 'ALL';
    const syllabusLabel = isAllSyllabus ? 'All Subjects' : currentSyllabusChoice;

    // Configure visibility and action buttons based on mode
    if (currentPreviewMode === 'scheme') {
      printSchemeSection.style.display = 'block';
      printSyllabusSection.style.display = 'none';
      if (printDocDivider) printDocDivider.style.display = 'none';
      if (previewCourseFilterWrapper) previewCourseFilterWrapper.style.display = 'none';
      if (printDocSubtitle) printDocSubtitle.textContent = 'TEACHING & EXAMINATION SCHEME (2024 REGULATION)';

      if (actionButtonsContainer) {
        actionButtonsContainer.innerHTML = `
          <button class="btn btn-primary" id="btnActionPrint">🖨️ Print Scheme (PDF)</button>
          <button class="btn btn-secondary" id="btnActionDocx">📄 Download Scheme (.docx)</button>
        `;
        document.getElementById('btnActionPrint').onclick = () => printDocument('scheme');
        document.getElementById('btnActionDocx').onclick = () => downloadDocx('scheme');
      }
    } else if (currentPreviewMode === 'syllabus') {
      printSchemeSection.style.display = 'none';
      printSyllabusSection.style.display = 'block';
      if (printDocDivider) printDocDivider.style.display = 'none';
      if (previewCourseFilterWrapper) previewCourseFilterWrapper.style.display = 'flex';
      if (printDocSubtitle) printDocSubtitle.textContent = isAllSyllabus ? 'DETAILED SYLLABI FOR ALL SUBJECTS (2024 REGULATION)' : `DETAILED COURSE SYLLABUS - ${currentSyllabusChoice}`;

      if (actionButtonsContainer) {
        actionButtonsContainer.innerHTML = `
          <button class="btn btn-primary" id="btnActionPrint">🖨️ Print ${syllabusLabel} (PDF)</button>
          <button class="btn btn-secondary" id="btnActionDocx">📄 Download ${syllabusLabel} (.docx)</button>
          ${!isAllSyllabus ? `<button class="btn btn-secondary" id="btnActionDocxAll" style="font-size: 12px;">📥 All Subjects (.docx)</button>` : ''}
        `;
        document.getElementById('btnActionPrint').onclick = () => printDocument('syllabus');
        document.getElementById('btnActionDocx').onclick = () => downloadDocx('syllabus', currentSyllabusChoice);
        if (document.getElementById('btnActionDocxAll')) {
          document.getElementById('btnActionDocxAll').onclick = () => downloadDocx('syllabus', 'ALL');
        }
      }
    } else {
      // Both combined
      printSchemeSection.style.display = 'block';
      printSyllabusSection.style.display = 'block';
      if (printDocDivider) printDocDivider.style.display = 'block';
      if (previewCourseFilterWrapper) previewCourseFilterWrapper.style.display = 'none';
      if (printDocSubtitle) printDocSubtitle.textContent = 'TEACHING & EXAMINATION SCHEME AND DETAILED SYLLABI (2024 REGULATION)';

      if (actionButtonsContainer) {
        actionButtonsContainer.innerHTML = `
          <button class="btn btn-primary" id="btnActionPrint">🖨️ Print Both (PDF)</button>
          <button class="btn btn-secondary" id="btnActionDocxScheme">📄 Download Scheme (.docx)</button>
          <button class="btn btn-secondary" id="btnActionDocxSyllabus">📄 Download All Syllabi (.docx)</button>
        `;
        document.getElementById('btnActionPrint').onclick = () => printDocument('all');
        document.getElementById('btnActionDocxScheme').onclick = () => downloadDocx('scheme');
        document.getElementById('btnActionDocxSyllabus').onclick = () => downloadDocx('syllabus', 'ALL');
      }
    }

    // Render Scheme Table
    let schemeHtml = `
      <table class="data-table" style="border: 2px solid #000; width: 100%;">
        <thead>
          <tr style="background: #f1f5f9; border-bottom: 2px solid #000;">
            <th rowspan="2">Sl. No.</th>
            <th rowspan="2">Course Type</th>
            <th rowspan="2">Course Code</th>
            <th rowspan="2">Course Title</th>
            <th rowspan="2">TD</th>
            <th rowspan="2">PSB</th>
            <th colspan="5" class="text-center" style="background: #e2e8f0;">Student Learning Hours (SLT)</th>
            <th colspan="4" class="text-center" style="background: #e2e8f0;">Assessment Information</th>
            <th rowspan="2">Credits</th>
          </tr>
          <tr style="background: #f1f5f9;">
            <th>L</th><th>T</th><th>P</th><th>S</th><th>TOT</th>
            <th>Exam (Hrs)</th><th>CIA</th><th>SEE</th><th>Total</th>
          </tr>
        </thead>
        <tbody>
    `;

    let totalCredits = 0;
    let totalL = 0, totalT = 0, totalP = 0, totalS = 0, totalTot = 0;
    let totalCia = 0, totalSee = 0, totalMarks = 0;

    courses.forEach((c, idx) => {
      const l = Number(c.l || 0), t = Number(c.t || 0), p = Number(c.p || 0), s = Number(c.s || 0);
      const tot = Number(c.tot || (l + t + p + s));
      const cia = Number(c.cia || 50), see = Number(c.see || 50);
      const totMarks = Number(c.total || (cia + see));
      const cred = Number(c.c || 0);

      totalCredits += cred;
      totalL += l; totalT += t; totalP += p; totalS += s; totalTot += tot;
      totalCia += cia; totalSee += see; totalMarks += totMarks;

      schemeHtml += `
        <tr>
          <td class="text-center">${c.sl || idx + 1}</td>
          <td><strong>${c.type}</strong></td>
          <td><strong>${c.code}</strong></td>
          <td>${c.title}</td>
          <td class="text-center">${c.td || 'CSE'}</td>
          <td class="text-center">${c.psb || 'CSE'}</td>
          <td class="text-center">${l}</td>
          <td class="text-center">${t}</td>
          <td class="text-center">${p}</td>
          <td class="text-center">${s}</td>
          <td class="text-center" style="font-weight: 700;">${tot}</td>
          <td class="text-center">${c.exam_hours || 3}</td>
          <td class="text-center">${cia}</td>
          <td class="text-center">${see}</td>
          <td class="text-center" style="font-weight: 700;">${totMarks}</td>
          <td class="text-center" style="font-weight: 800;">${cred || '-'}</td>
        </tr>
      `;
    });

    schemeHtml += `
        <tr style="border-top: 2px solid #000; font-weight: 800; background: #f1f5f9;">
          <td colspan="6" class="text-center">TOTAL</td>
          <td class="text-center">${totalL}</td>
          <td class="text-center">${totalT}</td>
          <td class="text-center">${totalP}</td>
          <td class="text-center">${totalS}</td>
          <td class="text-center">${totalTot}</td>
          <td class="text-center">-</td>
          <td class="text-center">${totalCia}</td>
          <td class="text-center">${totalSee}</td>
          <td class="text-center">${totalMarks}</td>
          <td class="text-center" style="font-size: 14px;">${totalCredits}</td>
        </tr>
      </tbody>
    </table>
    `;
    document.getElementById('printSchemeTableWrapper').innerHTML = schemeHtml;

    // Render Syllabus
    const sylContainer = document.getElementById('printSyllabusContent');
    const targetCode = previewCourseSelect && previewCourseSelect.value ? previewCourseSelect.value : (activeCourseCode || 'ALL');

    function buildSingleSyllabusHtml(syl) {
      if (!syl) return '';
      let html = `
        <div class="syllabus-doc-box" style="margin-bottom: 30px;">
          <!-- Official Atria Syllabus Document Header -->
          <div style="position: relative; min-height: 56px; margin-bottom: 14px; border-bottom: 2px solid #000; padding-bottom: 10px;">
            <div style="position: absolute; left: 0; top: 50%; transform: translateY(-50%);">
              <img src="assets/atria_logo.png" alt="Atria Institute of Technology" style="height: 50px; max-width: 210px; object-fit: contain;">
            </div>
            <div style="text-align: center; padding: 0 40px;">
              <div style="font-size: 15px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">Atria Institute of Technology</div>
              <div style="font-size: 10.5px; font-weight: 600;">(An Autonomous Institution Affiliated to VTU, Belagavi | Approved by AICTE, New Delhi)</div>
              <div style="font-size: 11.5px; font-weight: 700; text-transform: uppercase; margin-top: 2px;">Department of Computer Science & Engineering</div>
            </div>
          </div>
          <table style="border: 2px solid #000; width: 100%; border-collapse: collapse; margin-bottom: 16px;">
            <tr>
              <td colspan="2" style="border: 1px solid #000; padding: 6px 10px;"><strong>Title of the Course:</strong> ${syl.title}</td>
              <td style="border: 1px solid #000; padding: 6px 10px;"><strong>Semester:</strong> ${syl.semester || getRomanSemester(currentSem)}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 6px 10px;"><strong>Course Code:</strong> ${syl.code}</td>
              <td colspan="2" style="border: 1px solid #000; padding: 6px 10px;"><strong>Course Type:</strong> ${syl.type}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 6px 10px;"><strong>CIA Marks:</strong> ${syl.cia}</td>
              <td colspan="2" style="border: 1px solid #000; padding: 6px 10px;"><strong>SEE Marks:</strong> ${syl.see}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 6px 10px;"><strong>Student Learning Hours (L:T:P:S):</strong> ${syl.slt}</td>
              <td colspan="2" style="border: 1px solid #000; padding: 6px 10px;"><strong>Total Marks:</strong> ${syl.total_marks}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 6px 10px;"><strong>Credits:</strong> ${syl.credits}</td>
              <td style="border: 1px solid #000; padding: 6px 10px;"><strong>Exam Hours:</strong> ${syl.exam_hours}</td>
              <td style="border: 1px solid #000; padding: 6px 10px;"><strong>Examination Type (SEE):</strong> ${syl.exam_type}</td>
            </tr>
            <tr style="background: #f8fafc; font-size: 11px;">
              <td colspan="3" style="border: 1px solid #000; padding: 6px 10px;">
                L - Lecture | T – Tutorial | P – Practical | S – Self Study | CL - Cognitive Level | PL - Psychomotor Level
              </td>
            </tr>
          </table>

          <!-- COs Table -->
          <table style="border: 2px solid #000; width: 100%; border-collapse: collapse; margin-bottom: 16px;">
            <thead>
              <tr style="background: #f1f5f9; border-bottom: 2px solid #000;">
                <th style="border: 1px solid #000; padding: 6px; width: 60px;">COs</th>
                <th style="border: 1px solid #000; padding: 6px;">Course Outcome: At the end of the course, the students will be able to</th>
                <th style="border: 1px solid #000; padding: 6px; width: 110px;">CL (Highest Level)</th>
                <th style="border: 1px solid #000; padding: 6px; width: 110px;">PL (Highest Level)</th>
              </tr>
            </thead>
            <tbody>
      `;

      (syl.outcomes || []).forEach(co => {
        html += `
          <tr>
            <td style="border: 1px solid #000; padding: 6px; text-align: center; font-weight: 700;">${co.id}</td>
            <td style="border: 1px solid #000; padding: 6px;">${co.desc}</td>
            <td style="border: 1px solid #000; padding: 6px; text-align: center;">${co.cl}</td>
            <td style="border: 1px solid #000; padding: 6px; text-align: center;">${co.pl}</td>
          </tr>
        `;
      });

      html += `
            </tbody>
          </table>

          <!-- CO - Assessment Mapping -->
          <table style="border: 2px solid #000; width: 100%; border-collapse: collapse; margin-bottom: 16px;">
            <thead>
              <tr style="background: #f1f5f9; border-bottom: 2px solid #000;">
                <th rowspan="2" style="border: 1px solid #000; padding: 6px;">Course Outcomes</th>
                <th colspan="3" style="border: 1px solid #000; padding: 6px; text-align: center; background: #e2e8f0;">Continuous Internal Assessment</th>
                <th rowspan="2" style="border: 1px solid #000; padding: 6px; text-align: center;">Semester End Exam</th>
              </tr>
              <tr style="background: #f1f5f9;">
                <th style="border: 1px solid #000; padding: 6px; text-align: center;">CIE I (15%)</th>
                <th style="border: 1px solid #000; padding: 6px; text-align: center;">CIE II (15%)</th>
                <th style="border: 1px solid #000; padding: 6px; text-align: center;">Assignment/Activities (20%)</th>
              </tr>
            </thead>
            <tbody>
      `;

      (syl.co_assessment || []).forEach(m => {
        html += `
          <tr>
            <td style="border: 1px solid #000; padding: 6px; font-weight: 700;">${m.co}</td>
            <td style="border: 1px solid #000; padding: 6px; text-align: center;">${m.cie1}</td>
            <td style="border: 1px solid #000; padding: 6px; text-align: center;">${m.cie2}</td>
            <td style="border: 1px solid #000; padding: 6px; text-align: center;">${m.assignment}</td>
            <td style="border: 1px solid #000; padding: 6px; text-align: center;">${m.see}</td>
          </tr>
        `;
      });

      html += `
            </tbody>
          </table>

          <!-- Course Contents (Modules) -->
          <div style="margin-top: 18px;">
            <h4 style="border-bottom: 2px solid #000; padding-bottom: 4px; font-size: 14px; text-transform: uppercase;">Course Contents</h4>
      `;

      (syl.modules || []).forEach(mod => {
        html += `
          <div style="margin-top: 12px; border: 1px solid #000; padding: 10px; background: #ffffff;">
            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #ccc; padding-bottom: 4px; font-weight: 700;">
              <span>${mod.num}</span>
              <span>${mod.co}</span>
              <span>${mod.level}</span>
            </div>
            <p style="margin: 8px 0; font-size: 12.5px; line-height: 1.5;">${mod.content.replace(/\n/g, '<br>')}</p>
            ${mod.textbook_ref ? `<p style="font-size: 11.5px; font-style: italic; color: #334155; margin-top: 4px;"><strong>${mod.textbook_ref}</strong></p>` : ''}
          </div>
        `;
      });

      // Practicals
      if (syl.practicals && (syl.practicals.part_a.length > 0 || syl.practicals.part_b.length > 0)) {
        html += `
          <div style="margin-top: 20px;">
            <h4 style="border-bottom: 2px solid #000; padding-bottom: 4px; font-size: 14px; text-transform: uppercase;">PRACTICAL COMPONENTS OF IPCC</h4>
            <h5 style="margin-top: 10px; font-size: 13px; font-weight: 700;">PART – A_CONVENTIONAL EXPERIMENTS</h5>
            <ol style="padding-left: 20px; font-size: 12.5px; margin-top: 6px;">
        `;
        (syl.practicals.part_a || []).forEach(exp => {
          html += `<li style="margin-bottom: 6px;">${exp}</li>`;
        });
        html += `</ol><h5 style="margin-top: 12px; font-size: 13px; font-weight: 700;">PART – B_TYPICAL OPEN-ENDED EXPERIMENTS (Higher CL / PL)</h5><ol style="padding-left: 20px; font-size: 12.5px; margin-top: 6px;">`;
        (syl.practicals.part_b || []).forEach(exp => {
          html += `<li style="margin-bottom: 6px;">${exp}</li>`;
        });
        html += `</ol></div>`;
      }

      // Books
      html += `
        <div style="margin-top: 20px;">
          <h4 style="border-bottom: 2px solid #000; padding-bottom: 4px; font-size: 14px; text-transform: uppercase;">Text Books</h4>
          <ol style="padding-left: 20px; font-size: 12.5px; margin-top: 6px;">
      `;
      (syl.textbooks || []).forEach(b => {
        html += `<li style="margin-bottom: 4px;">${b}</li>`;
      });
      html += `</ol><h4 style="border-bottom: 2px solid #000; padding-bottom: 4px; font-size: 14px; text-transform: uppercase; margin-top: 16px;">Reference Books</h4><ol style="padding-left: 20px; font-size: 12.5px; margin-top: 6px;">`;
      (syl.references || []).forEach(b => {
        html += `<li style="margin-bottom: 4px;">${b}</li>`;
      });
      html += `</ol>`;

      if (syl.web_links && syl.web_links.length > 0) {
        html += `<h4 style="border-bottom: 2px solid #000; padding-bottom: 4px; font-size: 14px; text-transform: uppercase; margin-top: 16px;">Reference Web Links / Virtual Experiments:</h4><ol style="padding-left: 20px; font-size: 12.5px; margin-top: 6px;">`;
        (syl.web_links || []).forEach(link => {
          html += `<li style="margin-bottom: 4px;"><a href="${link}" target="_blank">${link}</a></li>`;
        });
        html += `</ol>`;
      }

      html += `</div></div>`;
      return html;
    }

    if (targetCode === 'ALL') {
      const allSyllabi = Object.values(dept.syllabi || {});
      if (allSyllabi.length === 0) {
        sylContainer.innerHTML = '<p class="text-muted text-center" style="padding: 20px;">No course syllabi available yet for this department.</p>';
      } else {
        sylContainer.innerHTML = allSyllabi.map((s, idx) => `
          <div style="${idx > 0 ? 'page-break-before: always; margin-top: 40px; border-top: 3px dashed #cbd5e1; padding-top: 30px;' : ''}">
            <h3 style="margin-bottom: 15px; color: var(--primary);">Subject ${idx + 1}: ${s.code} - ${s.title}</h3>
            ${buildSingleSyllabusHtml(s)}
          </div>
        `).join('');
      }
    } else {
      const syl = dept.syllabi ? dept.syllabi[targetCode] : null;
      if (!syl) {
        sylContainer.innerHTML = `<p class="text-muted text-center" style="padding: 20px;">No detailed syllabus created yet for <strong>${targetCode}</strong>. You can configure it in Interface 2.</p>`;
      } else {
        sylContainer.innerHTML = buildSingleSyllabusHtml(syl);
      }
    }
  }

  // Export JSON
  document.getElementById('btnExportJSON').addEventListener('click', () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(appState, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', `curriculum_scheme_syllabus_${currentDept}.json`);
    dlAnchor.click();
  });

  // Initial Load
  renderDeptSelector();
  renderSchemeTable();
  updateSyllabusCourseDropdown();
  renderHomeStats();
  updateUserSessionUI();

  // First-Time User Gate:
  // If user has an existing session in localStorage, enter the portal directly.
  // If opening for the first time or logged out, present the Login & Sign Up landing page!
  // The cookie is the authority; localStorage is only a convenience mirror.
  let restoredUser = null;
  try {
    const sessionRes = await fetch('/api/session');
    if (sessionRes.ok) {
      const sessionPayload = await sessionRes.json();
      restoredUser = sessionPayload.user || null;
    }
  } catch (e) {}

  if (!restoredUser) {
    const savedUser = localStorage.getItem('academic_user');
    if (savedUser) {
      try { restoredUser = JSON.parse(savedUser); } catch (e) {}
    }
  }

  if (restoredUser) {
    currentUser = restoredUser;
    try {
      localStorage.setItem('academic_user', JSON.stringify(currentUser));
    } catch (e) {}
    const userDept = getUserAssignedDept(currentUser);
    if (!isCrossDeptUser(currentUser) && userDept) {
      currentDept = userDept;
    }
    showAppMainView();
    initAppRouting();
  } else {
    showAuthLandingView();
  }
});
