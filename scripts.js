// scripts.js — staged flow + project comments + greying out completed projects
const ENDPOINT_URL = 'https://csesponsors.sbecerr7.workers.dev/';
const CSV_FILENAME = 'data.csv';
const SCALE = ['Terrible','Poor','Average','Good','Excellent'];

document.addEventListener('DOMContentLoaded', () => {
  // DOM refs
  const emailInput = document.getElementById('email');
  const nameInput = document.getElementById('fullName');
  const projectSelect = document.getElementById('project');
  const loadProjectBtn = document.getElementById('loadProjectBtn');
  const matrixContainer = document.getElementById('matrix-container');
  const matrixQuestion = document.getElementById('matrix-question');
  const questionHeading = document.getElementById('question-heading');
  const status = document.getElementById('form-status');
  const submitBtn = document.getElementById('submitBtn');
  const skipBtn = document.getElementById('skipBtn');

  // app state
  let sponsorData = {};        // built from CSV
  let sponsorProjects = {};    // projects currently available for the signed-in sponsor
  let currentProject = '';     // project currently shown in matrix
  let completedProjects = {};  // tracks projects that have been submitted (greyed out)

  // helpers
  function setStatus(msg, color) {
    status.textContent = msg || '';
    status.style.color = color || 'inherit';
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

  async function tryFetchCSV() {
    try {
      const resp = await fetch(CSV_FILENAME, { cache: 'no-store' });
      if (!resp.ok) throw new Error('not found');
      const txt = await resp.text();
      const rows = parseCSV(txt);
      sponsorData = buildSponsorMap(rows);
      setStatus('Project data loaded. Enter your email to see projects.', 'green');
    } catch (err) {
      console.debug('CSV fetch failed', err);
      setStatus('Project data not found. Make sure data.csv is present.');
    }
  }

  // Populate selection dropdown and keep the list visible (stage 2)
  function populateProjectDropdown(email) {
    projectSelect.innerHTML = '<option value="">— Select a project —</option>';
    sponsorProjects = {};
    const entry = sponsorData[email];
    if (!entry || !entry.projects) {
      projectSelect.disabled = true;
      setStatus('No projects found for that email.', 'red');
      return;
    }
    Object.keys(entry.projects).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      // if completed, mark disabled and style
      if (completedProjects[p]) {
        opt.disabled = true;
        opt.dataset.completed = 'true';
      }
      projectSelect.appendChild(opt);
      sponsorProjects[p] = entry.projects[p].slice();
    });
    projectSelect.disabled = false;
    setStatus('Please select the project you would like to evaluate.');
    // show stage 2 UI (project list visible) — questionHeading remains hidden until load
    questionHeading.style.display = 'none';
    matrixContainer.innerHTML = '';
    currentProject = '';
  }

  // Render the rating matrix for a chosen project
  function renderMatrix(project) {
    matrixContainer.innerHTML = '';
    questionHeading.style.display = 'block';
    matrixQuestion.textContent = 'Please evaluate the students on Communication';
    const students = sponsorProjects[project] || [];
    if (!students.length) { matrixContainer.textContent = 'No students found'; return; }

    const table = document.createElement('table');
    table.className = 'matrix-table';
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';

    // header
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const thStudent = document.createElement('th'); thStudent.textContent = ''; headRow.appendChild(thStudent);
    SCALE.forEach(label => { const th = document.createElement('th'); th.textContent = label; th.style.padding='6px'; headRow.appendChild(th); });
    thead.appendChild(headRow); table.appendChild(thead);

    // body rows
    const tbody = document.createElement('tbody');
    students.forEach((student, sIdx) => {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td'); tdName.textContent = student; tdName.style.padding='8px'; tr.appendChild(tdName);
      SCALE.forEach((_, colIdx) => {
        const td = document.createElement('td'); td.style.padding='6px'; td.style.textAlign='center';
        const div = document.createElement('div'); div.className = 'rating-row';
        const id = `rating-${encodeURIComponent(project)}-${sIdx}-${colIdx}`;
        const input = document.createElement('input'); input.type = 'radio'; input.name = `rating-${sIdx}`; input.value = String(colIdx + 1); input.id = id;
        const label = document.createElement('label'); label.htmlFor = id; label.textContent = ''; // visual is CSS
        div.appendChild(input); div.appendChild(label); td.appendChild(div); tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    matrixContainer.appendChild(table);

    // Project-level comment box (added beneath the matrix)
    const commentWrap = document.createElement('div');
    commentWrap.className = 'project-comment-wrap';
    commentWrap.style.marginTop = '12px';
    const commentLabel = document.createElement('label');
    commentLabel.textContent = 'Comments about this project (optional)';
    commentLabel.htmlFor = 'project-comment';
    commentLabel.style.display = 'block';
    commentLabel.style.marginBottom = '6px';
    const commentBox = document.createElement('textarea');
    commentBox.id = 'project-comment';
    commentBox.rows = 3;
    commentBox.style.width = '100%';
    commentBox.style.padding = '8px';
    commentBox.style.borderRadius = '8px';
    commentBox.style.border = '1px solid #dbe7fb';
    commentWrap.appendChild(commentLabel);
    commentWrap.appendChild(commentBox);
    matrixContainer.appendChild(commentWrap);

    // Save current project
    currentProject = project;
  }

  // Collect responses from the matrix and include project-level comment
  function collectResponses(project) {
    const students = sponsorProjects[project] || [];
    const projectCommentEl = document.getElementById('project-comment');
    const projectComment = projectCommentEl ? (projectCommentEl.value || '') : '';
    return students.map((student, sIdx) => {
      const sel = document.querySelector(`input[name="rating-${sIdx}"]:checked`);
      return { student, rating: sel ? parseInt(sel.value, 10) : null, comment: projectComment };
    });
  }

  // input handler for email — stage progression
  emailInput.addEventListener('input', () => {
    const v = (emailInput.value || '').toLowerCase().trim();
    // only populate if email recognized
    if (!v) {
      projectSelect.innerHTML = '<option value="">— Select a project —</option>';
      projectSelect.disabled = true;
      setStatus('Enter your email to load projects.');
      return;
    }
    if (sponsorData[v]) {
      populateProjectDropdown(v);
    } else {
      projectSelect.innerHTML = '<option value="">— Select a project —</option>';
      projectSelect.disabled = true;
      setStatus('No projects found for that email.', 'red');
    }
  });

  // Load project button: simply render the selected project (matrix shows)
  loadProjectBtn.addEventListener('click', () => {
    const sel = projectSelect.value;
    if (!sel) { setStatus('Please select a project to load.', 'red'); return; }
    if (completedProjects[sel]) { setStatus('This project was already submitted (greyed out).', 'red'); return; }
    renderMatrix(sel);
    setStatus(`Loaded project "${sel}". Rate the students and add optional comments.`);
  });

  // Skip project button: remove it from dropdown (mark as skipped/greyed)
  skipBtn.addEventListener('click', () => {
    const sel = projectSelect.value;
    if (!sel) { setStatus('Please select a project to skip.', 'red'); return; }
    // mark completed so it can't be selected again in this session
    completedProjects[sel] = true;
    const opt = projectSelect.querySelector(`option[value="${sel}"]`);
    if (opt) {
      opt.disabled = true;
      opt.dataset.completed = 'true';
      opt.textContent = `${sel} — skipped`;
    }
    matrixContainer.innerHTML = ''; questionHeading.style.display = 'none';
    setStatus(`Removed project "${sel}" from selection.`);
    // keep currentProject cleared
    if (currentProject === sel) currentProject = '';
  });

  // Form submit: collects responses for currentProject and sends payload
  document.getElementById('judge-form').addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const name = (nameInput.value || '').trim();
    const email = (emailInput.value || '').trim();
    const project = projectSelect.value;
    if (!name) { setStatus('Please enter your name.', 'red'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setStatus('Please enter a valid email.', 'red'); return; }
    if (!project) { setStatus('Please select a project.', 'red'); return; }
    if (completedProjects[project]) { setStatus('This project is already completed.', 'red'); return; }

    const responses = collectResponses(project);
    if (!responses.some(r => r.rating !== null)) { setStatus('Please rate at least one student.', 'red'); return; }

    const payload = { sponsorName: name, sponsorEmail: email, project, responses, timestamp: new Date().toISOString() };

    try {
      setStatus('Submitting...');
      submitBtn.disabled = true;

      const form = new FormData();
      form.append('payload', JSON.stringify(payload));

      const resp = await fetch(ENDPOINT_URL, {
        method: 'POST',
        body: form
      });

      if (!resp.ok) {
        const txt = await resp.text();
        console.error('Server error:', resp.status, txt);
        throw new Error('Network response not ok: ' + resp.status);
      }

      const data = await resp.json();
      console.log('Server response', data);
      setStatus('Submission saved. Thank you!', 'green');

      // mark project as completed (grey out)
      completedProjects[project] = true;
      const opt = projectSelect.querySelector(`option[value="${project}"]`);
      if (opt) {
        opt.disabled = true;
        opt.dataset.completed = 'true';
        opt.textContent = `${project} — completed`;
      }

      // clear matrix and keep project list visible for next selection
      matrixContainer.innerHTML = '';
      questionHeading.style.display = 'none';
      currentProject = '';

      // Optionally remove the project from sponsorProjects map to avoid re-rendering
      delete sponsorProjects[project];

    } catch (err) {
      console.error('Submission error', err);
      setStatus('Submission failed. See console.', 'red');
    } finally {
      submitBtn.disabled = false;
    }
  });

  // initial CSV load from the repo (data.csv)
  tryFetchCSV();
});




