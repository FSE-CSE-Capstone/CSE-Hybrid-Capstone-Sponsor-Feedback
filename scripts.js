// scripts.js — restored card UI + ASU colors. Uses Cloudflare Worker proxy endpoint.
const ENDPOINT_URL = 'https://csesponsors.sbecerr7.workers.dev/'; // update this if your worker URL differs
const CSV_FILENAME = 'data.csv';
const SCALE = ['Terrible','Poor','Average','Good','Excellent'];

document.addEventListener('DOMContentLoaded', () => {
  const nameInput = document.getElementById('fullName');
  const emailInput = document.getElementById('email');
  const projectSelect = document.getElementById('project');
  const loadProjectBtn = document.getElementById('loadProjectBtn');
  const skipBtn = document.getElementById('skipBtn');
  const matrixContainer = document.getElementById('matrix-container');
  const matrixTitle = document.getElementById('matrix-project-title');
  const status = document.getElementById('form-status');
  const submitBtn = document.getElementById('submitBtn');
  const commentsEl = document.getElementById('comments');

  let sponsorData = {};
  let sponsorProjects = {};

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
      if (!resp.ok) throw new Error('CSV not found');
      const txt = await resp.text();
      const rows = parseCSV(txt);
      sponsorData = buildSponsorMap(rows);
      setStatus('Project data loaded. Enter your email to see projects.', 'green');
    } catch (err) {
      console.debug('CSV fetch failed', err);
      setStatus('Project data not found. Use admin upload if needed.');
    }
  }

  function populateProjectDropdown(email) {
    projectSelect.innerHTML = '<option value="">— Select a project —</option>';
    sponsorProjects = {};
    const entry = sponsorData[email];
    if (!entry || !entry.projects) {
      projectSelect.disabled = true;
      setStatus('No projects found for that email.');
      return;
    }
    Object.keys(entry.projects).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      projectSelect.appendChild(opt);
      sponsorProjects[p] = entry.projects[p].slice();
    });
    projectSelect.disabled = false;
    setStatus('Projects loaded. Select and click Load Project.');
  }

  function renderMatrix(project) {
    matrixContainer.innerHTML = '';
    matrixTitle.textContent = project || '';
    const students = sponsorProjects[project] || [];
    if (!students.length) { matrixContainer.textContent = 'No students found'; return; }

    const table = document.createElement('table');
    table.className = 'matrix-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const thEmpty = document.createElement('th'); thEmpty.textContent = ''; headRow.appendChild(thEmpty);
    SCALE.forEach(label => { const th = document.createElement('th'); th.textContent = label; headRow.appendChild(th); });
    thead.appendChild(headRow); table.appendChild(thead);

    const tbody = document.createElement('tbody');
    students.forEach((student, sIdx) => {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td'); tdName.textContent = student; tr.appendChild(tdName);
      SCALE.forEach((_, colIdx) => {
        const td = document.createElement('td');
        const div = document.createElement('div'); div.className = 'rating-row';
        const id = `rating-${sIdx}-${colIdx}`;
        const input = document.createElement('input'); input.type = 'radio'; input.name = `rating-${sIdx}`; input.value = String(colIdx + 1); input.id = id;
        const label = document.createElement('label'); label.htmlFor = id; label.className = 'sr-only';
        div.appendChild(input); div.appendChild(label); td.appendChild(div); tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    matrixContainer.appendChild(table);
  }

  function collectResponses(project) {
    const students = sponsorProjects[project] || [];
    return students.map((student, sIdx) => {
      const sel = document.querySelector(`input[name="rating-${sIdx}"]:checked`);
      return { student, rating: sel ? parseInt(sel.value, 10) : null, comment: '' };
    });
  }

  emailInput.addEventListener('input', () => {
    const v = (emailInput.value || '').toLowerCase().trim();
    if (!v) return;
    if (sponsorData[v]) populateProjectDropdown(v);
  });

  loadProjectBtn.addEventListener('click', () => {
    const sel = projectSelect.value;
    if (!sel) { setStatus('Please select a project to load.', 'red'); return; }
    renderMatrix(sel);
  });

  skipBtn.addEventListener('click', () => {
    const sel = projectSelect.value;
    if (!sel) { setStatus('Please select a project to skip.', 'red'); return; }
    delete sponsorProjects[sel];
    const opt = projectSelect.querySelector(`option[value="${sel}"]`);
    if (opt) opt.remove();
    matrixContainer.innerHTML = ''; matrixTitle.textContent = '';
    setStatus(`Removed project "${sel}"`);
  });

  document.getElementById('judge-form').addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const name = (nameInput.value || '').trim();
    const email = (emailInput.value || '').trim();
    const project = projectSelect.value;
    if (!name) { setStatus('Please enter your name.', 'red'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setStatus('Please enter a valid email.', 'red'); return; }
    if (!project) { setStatus('Please select a project.', 'red'); return; }

    const responses = collectResponses(project);
    if (!responses.some(r => r.rating !== null)) { setStatus('Please rate at least one student.', 'red'); return; }

    const payload = {
      sponsorName: name,
      sponsorEmail: email,
      project,
      responses,
      comment: (commentsEl.value || '').trim(),
      timestamp: new Date().toISOString()
    };

    try {
      setStatus('Submitting...', null);
      submitBtn.disabled = true;

      const form = new FormData();
      form.append('payload', JSON.stringify(payload));

      const resp = await fetch(ENDPOINT_URL, {
        method: 'POST',
        body: form
      });

      const text = await resp.text();
      let data = null;
      try { data = JSON.parse(text); } catch(e) { console.warn('Response not JSON:', text); }

      if (!resp.ok) {
        console.error('Submit failed', resp.status, text);
        setStatus('Submission failed. See console.', 'red');
      } else {
        if (data && data.status === 'ok') {
          setStatus('Submission saved. Thank you!', 'green');
          delete sponsorProjects[project];
          const opt = projectSelect.querySelector(`option[value="${project}"]`);
          if (opt) opt.remove();
          matrixContainer.innerHTML = '';
          matrixTitle.textContent = '';
          commentsEl.value = '';
        } else {
          setStatus('Submission received (server response unexpected). Check console.', 'red');
          console.log('Server raw response:', text);
        }
      }
    } catch (err) {
      console.error('Submission error', err);
      setStatus('Submission failed. See console.', 'red');
    } finally {
      submitBtn.disabled = false;
    }
  });

  // initial CSV load
  tryFetchCSV();
});



