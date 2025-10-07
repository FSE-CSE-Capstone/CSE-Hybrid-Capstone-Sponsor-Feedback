// scripts.js — Multi-stage UI, project list, per-project comments, local save/resume
const ENDPOINT_URL = 'https://csesponsors.sbecerr7.workers.dev/';
const CSV_FILENAME = 'data.csv';
const SCALE = ['Terrible','Poor','Average','Good','Excellent'];
const STORAGE_KEY = 'sponsor_progress_v1';

document.addEventListener('DOMContentLoaded', () => {
  const stageIdentity = document.getElementById('stage-identity');
  const stageProjects = document.getElementById('stage-projects');
  const stageThankyou = document.getElementById('stage-thankyou');
  const identitySubmit = document.getElementById('identitySubmit');
  const backToIdentity = document.getElementById('backToIdentity');
  const nameInput = document.getElementById('fullName');
  const emailInput = document.getElementById('email');
  const projectListEl = document.getElementById('project-list');
  const projectHeadingOutside = document.getElementById('projects-heading-outside');
  const matrixContainer = document.getElementById('matrix-container');
  const formStatus = document.getElementById('form-status');
  const submitProjectBtn = document.getElementById('submitProject');
  const finishClose = document.getElementById('finishClose');
  const finishStartOver = document.getElementById('finishStartOver');

  let sponsorData = {};
  let sponsorProjects = {};
  let currentEmail = '';
  let currentName = '';
  let currentProject = '';
  let completedProjects = {};
  let stagedRatings = {};

  function setStatus(msg, color) {
    formStatus.textContent = msg || '';
    formStatus.style.color = color || 'inherit';
  }

  function parseCSV(text) {
    const rows = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!rows.length) return [];
    const headers = rows[0].split(',').map(h => h.trim());
    return rows.slice(1).map(line => {
      const parts = line.split(',').map(p => p.trim());
      const obj = {};
      headers.forEach((h, i) => obj[h] = parts[i] || '');
      return obj;
    });
  }

  function buildSponsorMap(rows) {
    const map = {};
    rows.forEach(r => {
      const email = (r.sponsorEmail || r.email || '').toLowerCase();
      const project = (r.project || '').trim();
      const student = (r.student || '').trim();
      if (!email || !project || !student) return;
      if (!map[email]) map[email] = { projects: {} };
      if (!map[email].projects[project]) map[email].projects[project] = [];
      if (!map[email].projects[project].includes(student)) map[email].projects[project].push(student);
    });
    return map;
  }

  function saveProgress() {
    const payload = { name: currentName, email: currentEmail, completedProjects, stagedRatings };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch (e) { console.warn('Could not save progress', e); }
  }

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (obj && obj.email) {
        currentName = obj.name || '';
        currentEmail = obj.email || '';
        completedProjects = obj.completedProjects || {};
        stagedRatings = obj.stagedRatings || {};
        nameInput.value = currentName;
        emailInput.value = currentEmail;
      }
    } catch (e) { console.warn('Could not load progress', e); }
  }

  async function tryFetchCSV() {
    try {
      const resp = await fetch(CSV_FILENAME, { cache: 'no-store' });
      if (!resp.ok) throw new Error('CSV not found: ' + resp.status);
      const txt = await resp.text();
      const rows = parseCSV(txt);
      sponsorData = buildSponsorMap(rows);

      // DEBUG: attach to window for inspection (safe)
      window._sponsorData = sponsorData;
      console.log('CSV loaded, sponsorData keys:', Object.keys(sponsorData).slice(0,50));
      setStatus('Project data loaded. Enter your email to continue.', 'green');

      loadProgress();
      if (currentEmail && sponsorData[currentEmail]) {
        showProjectsStage();
        populateProjectListFor(currentEmail);
      }
    } catch (err) {
      console.debug('CSV fetch failed', err);
      setStatus('Project data not found. Ensure data.csv is present.');
    }
  }

  function showIdentityStage() {
    stageIdentity.style.display = '';
    stageProjects.style.display = 'none';
    stageThankyou.style.display = 'none';
    projectHeadingOutside.style.display = 'none';
    setStatus('');
  }
  function showProjectsStage() {
    stageIdentity.style.display = 'none';
    stageProjects.style.display = '';
    stageThankyou.style.display = 'none';
    projectHeadingOutside.style.display = '';
  }
  function showThankyouStage() {
    stageIdentity.style.display = 'none';
    stageProjects.style.display = 'none';
    stageThankyou.style.display = '';
    projectHeadingOutside.style.display = 'none';
  }

  function escapeHtml(s) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(s).replace(/[&<>"']/g, m => map[m]);
  }

  function populateProjectListFor(email) {
    projectListEl.innerHTML = '';
    sponsorProjects = {};
    const entry = sponsorData[email];
    if (!entry || !entry.projects) { setStatus('No projects found for that email.', 'red'); return; }
    const allProjects = Object.keys(entry.projects).slice();
    allProjects.sort((a,b) => {
      const ca = completedProjects[a] ? -1 : 1;
      const cb = completedProjects[b] ? -1 : 1;
      return ca - cb;
    });

    allProjects.forEach((p) => {
      const li = document.createElement('li');
      li.className = 'project-item';
      li.tabIndex = 0;
      li.dataset.project = p;
      li.innerHTML = `<strong>${escapeHtml(p)}</strong>`;
      if (completedProjects[p]) {
        li.classList.add('completed');
        li.innerHTML = `<strong>${escapeHtml(p)}</strong> <span class="meta">(completed)</span>`;
      }

      li.addEventListener('click', () => {
        if (completedProjects[p]) { setStatus('This project is already completed.', 'red'); return; }
        projectListEl.querySelectorAll('.project-item.active').forEach(el => el.classList.remove('active'));
        li.classList.add('active');
        // do NOT move items in the list — comment out prepend lines to keep order
        // projectListEl.prepend(li); // <-- intentionally disabled to keep list stable
        loadProjectIntoMatrix(p, entry.projects[p]);
        setStatus('');
      });

      projectListEl.appendChild(li);
      sponsorProjects[p] = entry.projects[p].slice();
    });

    setStatus('');
  }

  function loadProjectIntoMatrix(projectName, students) {
    currentProject = projectName;
    matrixContainer.innerHTML = '';

    let headerEl = document.querySelector('.current-project-header');
    if (!headerEl) {
      headerEl = document.createElement('div');
      headerEl.className = 'current-project-header';
      matrixContainer.parentNode.insertBefore(headerEl, matrixContainer);
    }
    headerEl.textContent = projectName;

    let desc = document.querySelector('.matrix-description');
    if (!desc) {
      desc = document.createElement('div');
      desc.className = 'matrix-description';
      matrixContainer.parentNode.insertBefore(desc, matrixContainer);
    }
    desc.textContent = 'Please evaluate the students on Communication';

    if (!students || !students.length) { matrixContainer.textContent = 'No students found for this project.'; return; }

    const table = document.createElement('table'); table.className = 'matrix-table';
    const thead = document.createElement('thead'); const headRow = document.createElement('tr'); const thStudent = document.createElement('th'); thStudent.textContent=''; headRow.appendChild(thStudent);
    SCALE.forEach(label => { const th = document.createElement('th'); th.textContent = label; headRow.appendChild(th); });
    thead.appendChild(headRow); table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const draft = stagedRatings[projectName] || { ratings: {}, comment: '' };

    students.forEach((student, sIdx) => {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td'); tdName.textContent = student; tr.appendChild(tdName);
      SCALE.forEach((_, colIdx) => {
        const td = document.createElement('td'); td.style.textAlign='center';
        const wrapper = document.createElement('div'); wrapper.className='rating-row';
        const id = 'rating-' + encodeURIComponent(projectName) + '-' + sIdx + '-' + colIdx;
        const input = document.createElement('input'); input.type='radio'; input.name = 'rating-' + sIdx; input.value = String(colIdx+1); input.id = id;
        if (draft.ratings && draft.ratings[student] && String(draft.ratings[student]) === String(colIdx+1)) input.checked = true;
        const label = document.createElement('label'); label.htmlFor = id; label.textContent = '';
        wrapper.appendChild(input); wrapper.appendChild(label);
        td.appendChild(wrapper);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    matrixContainer.appendChild(table);

    const commentWrap = document.createElement('div'); commentWrap.className='project-comment-wrap';
    const lbl = document.createElement('label'); lbl.htmlFor='project-comment'; lbl.textContent='Comments about this project (optional)';
    const ta = document.createElement('textarea'); ta.id='project-comment'; ta.rows=4; ta.style.width='100%'; ta.value = draft.comment || '';
    commentWrap.appendChild(lbl); commentWrap.appendChild(ta);
    matrixContainer.appendChild(commentWrap);

    matrixContainer.removeEventListener('change', saveDraftHandler);
    matrixContainer.removeEventListener('input', saveDraftHandler);
    matrixContainer.addEventListener('change', saveDraftHandler);
    matrixContainer.addEventListener('input', saveDraftHandler);

    function saveDraftHandler() {
      const rows = students.map((s,i) => {
        const sel = document.querySelector('input[name="rating-' + i + '"]:checked');
        return { student: s, rating: sel ? parseInt(sel.value, 10) : null };
      });
      const comment = document.getElementById('project-comment') ? document.getElementById('project-comment').value : '';
      const draftObj = { ratings: {}, comment };
      rows.forEach(r => { if (r.rating != null) draftObj.ratings[r.student] = r.rating; });
      stagedRatings[projectName] = draftObj;
      saveProgress();
    }
  }

  async function submitCurrentProject() {
    if (!currentProject) { setStatus('No project is loaded.', 'red'); return; }
    const students = sponsorProjects[currentProject] || [];
    if (!students.length) { setStatus('No students to submit.', 'red'); return; }

    const rows = students.map((student, sIdx) => {
      const sel = document.querySelector('input[name="rating-' + sIdx + '"]:checked');
      return { student, rating: sel ? parseInt(sel.value, 10) : null, comment: (document.getElementById('project-comment')?.value || '') };
    });
    if (!rows.some(r => r.rating !== null)) { setStatus('Please rate at least one student before submitting.', 'red'); return; }

    const payload = {
      sponsorName: currentName || nameInput.value.trim(),
      sponsorEmail: currentEmail || emailInput.value.trim(),
      project: currentProject,
      responses: rows,
      timestamp: new Date().toISOString()
    };

    try {
      setStatus('Submitting...', 'black');
      submitProjectBtn.disabled = true;
      const form = new FormData(); form.append('payload', JSON.stringify(payload));
      const resp = await fetch(ENDPOINT_URL, { method: 'POST', body: form });
      if (!resp.ok) {
        const txt = await resp.text();
        console.error('Server error', resp.status, txt);
        throw new Error('Network response not ok: ' + resp.status);
      }
      const data = await resp.json();
      console.log('Saved', data);
      setStatus('Submission saved. Thank you!', 'green');

      completedProjects[currentProject] = true;
      delete stagedRatings[currentProject];
      saveProgress();

      const item = projectListEl.querySelector('li[data-project="' + CSS.escape(currentProject) + '"]');
      if (item) {
        item.classList.add('completed'); item.classList.remove('active');
        item.innerHTML = '<strong>' + escapeHtml(currentProject) + '</strong> <span class="meta">(completed)</span>';
      }

      matrixContainer.innerHTML = '';
      const headerEl = document.querySelector('.current-project-header');
      if (headerEl) headerEl.remove();
      currentProject = '';

      if (hasCompletedAllProjects()) showThankyouStage();
    } catch (err) {
      console.error('Submission error', err);
      setStatus('Submission failed. See console.', 'red');
    } finally {
      submitProjectBtn.disabled = false;
    }
  }

  function hasCompletedAllProjects(){
    const entry = sponsorData[currentEmail];
    if (!entry || !entry.projects) return false;
    const all = Object.keys(entry.projects);
    return all.length > 0 && all.every(p => completedProjects[p]);
  }

  identitySubmit.addEventListener('click', () => {
    const name = nameInput.value.trim();
    const email = (emailInput.value || '').toLowerCase().trim();
    console.log('Identity submit clicked', { name, email });
    if (!name) { setStatus('Please enter your name.', 'red'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setStatus('Please enter a valid email.', 'red'); return; }
    currentName = name; currentEmail = email; saveProgress();
    if (!sponsorData[email]) { setStatus('No projects found for that email.', 'red'); return; }
    showProjectsStage(); populateProjectListFor(email);
  });

  backToIdentity.addEventListener('click', () => showIdentityStage());
  submitProjectBtn.addEventListener('click', () => submitCurrentProject());
  finishClose && finishClose.addEventListener('click', () => window.close?.());
  finishStartOver && finishStartOver.addEventListener('click', () => {
    completedProjects = {}; stagedRatings = {}; saveProgress(); currentProject = ''; matrixContainer.innerHTML = ''; showIdentityStage();
  });

  showIdentityStage();
  tryFetchCSV();
});


