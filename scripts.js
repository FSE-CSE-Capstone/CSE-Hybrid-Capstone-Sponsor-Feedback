/* scripts.clean.js — cleaned and refactored from your original scripts.js
   Keeps endpoints and behavior identical; optimized DOM access & table build.
   Source files reviewed: original scripts.js variants. */
(function () {
  'use strict';

  // --- Configuration (Cloudflare Workers endpoints) ---
  var ENDPOINT_URL = 'https://csehybridsponsors.sbecerr7.workers.dev/';  // POST submissions here
  var DATA_LOADER_URL = 'https://data-loader.sbecerr7.workers.dev/';    // HYBRID worker URL (reads hybrid sheet)
  var STORAGE_KEY = 'sponsor_progress_v1';
  var DATA_SOURCE = ''; // blank for hybrid


  // ---------- RUBRIC ----------
  const RUBRIC = [
    { title: "Student has contributed an appropriate amount of development effort towards this project", description: "Development effort should be balanced between all team members; student should commit to a fair amount of development effort on each sprint." },
    { title: "Student's level of contribution and participation in meetings", description: "Students are expected to be proactive. Contributions and participation in meetings help ensure the student is aware of project goals." },
    { title: "Student's understanding of your project/problem", description: "Students are expected to understand important details of the project and be able to explain it from different stakeholder perspectives." },
    { title: "Quality of student's work product", description: "Students should complete assigned work to a high quality: correct, documented, and self-explanatory where appropriate." },
    { title: "Quality and frequency of student's communications", description: "Students are expected to be in regular communication and maintain professionalism when interacting with the sponsor." }
  ];

  // ---------- DOM cache ----------
  const stageIdentity = document.getElementById('stage-identity');
  const stageProjects = document.getElementById('stage-projects');
  const stageThankyou = document.getElementById('stage-thankyou');
  const identitySubmit = document.getElementById('identitySubmit');
  const backToIdentity = document.getElementById('backToIdentity');
  const nameInput = document.getElementById('fullName');
  const emailInput = document.getElementById('email');
  const projectListEl = document.getElementById('project-list');
  let matrixContainer = document.getElementById('matrix-container');
  const formStatus = document.getElementById('form-status');
  const submitProjectBtn = document.getElementById('submitProject');
  const finishStartOverBtn = document.getElementById('finishStartOver');
  const welcomeBlock = document.getElementById('welcome-block');
  const underTitle = document.getElementById('under-title');

  // ---------- State ----------
  let sponsorData = {};
  let sponsorProjects = {};
  let currentEmail = '';
  let currentName = '';
  let currentProject = '';
  let completedProjects = {};
  let stagedRatings = {}; // shape: stagedRatings[project][studentIndex][criterionIndex] = value
  const TEAM_KEY_LABEL = "__TEAM__";
  const LEFT_DESCRIPTOR = "Far Below Expectations (Fail)";
  const RIGHT_DESCRIPTOR = "Exceeds Expectations (A+)";

  // ---------- Utilities ----------
  function setStatus(msg, color){
    if (!formStatus) return;
    formStatus.textContent = msg || '';
    formStatus.style.color = color || '';
  }

  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  // Simple debounce for draft saves
  let draftTimer = null;
  function debounceSaveDraft() {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraftHandler, 450);
  }

  // ---------- Persistence ----------
  function saveProgress(){
    const payload = { name: currentName, email: currentEmail, completedProjects, stagedRatings };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch(e){ /* ignore */ }
  }
  function loadProgress(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (obj) {
        currentName = obj.name || '';
        currentEmail = obj.email || '';
        completedProjects = obj.completedProjects || {};
        stagedRatings = obj.stagedRatings || {};
        if (nameInput) nameInput.value = currentName;
        if (emailInput) emailInput.value = currentEmail;
      }
    } catch(e){}
  }

  // ---------- Data fetch ----------
  function tryFetchData(cb){
    fetch(DATA_LOADER_URL, { cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error('Data loader returned ' + r.status); return r.json(); })
      .then(rows => {
        sponsorData = buildSponsorMap(rows || []);
        setStatus('Project data loaded securely.', 'green');
        loadProgress();
        if (currentEmail && sponsorData[currentEmail]) {
          showProjectsStage();
          populateProjectListFor(currentEmail);
        }
        if (typeof cb === 'function') cb();
      })
      .catch(err => {
        console.error('Data fetch failed', err);
        setStatus('Project data not found. Please try again later.', 'red');
        if (typeof cb === 'function') cb();
      });
  }

  function buildSponsorMap(rows){
    const map = {};
    (rows||[]).forEach(r => {
      const email = (r.sponsorEmail || r.email || '').toLowerCase();
      const project = (r.project || '').trim();
      const student = (r.student || '').trim();
      if (!email || !project || !student) return;
      if (!map[email]) map[email] = { projects: {} };
      if (!map[email].projects[project]) map[email].projects[project] = [];
      if (map[email].projects[project].indexOf(student) === -1) map[email].projects[project].push(student);
    });
    return map;
  }

  // ---------- Project list ----------
  function populateProjectListFor(email){
    if (!projectListEl) return;
    projectListEl.innerHTML = '';
    sponsorProjects = {};
    const entry = sponsorData[email];
    if (!entry || !entry.projects) { setStatus('No projects found for that email.', 'red'); return; }
    const allProjects = Object.keys(entry.projects).slice();
    allProjects.sort((a,b) => (completedProjects[a] ? 1 : 0) - (completedProjects[b] ? 1 : 0));
    allProjects.forEach(p => {
      const li = document.createElement('li');
      li.className = 'project-item';
      li.tabIndex = 0;
      li.setAttribute('data-project', p);
      if (completedProjects[p]) li.classList.add('completed'), li.innerHTML = `<strong>${escapeHtml(p)}</strong> <span class="meta">(completed)</span>`;
      else li.innerHTML = `<strong>${escapeHtml(p)}</strong>`;
      li.addEventListener('click', () => {
        if (completedProjects[p]) { setStatus('This project is already completed.', 'red'); return; }
        const act = projectListEl.querySelectorAll('.project-item.active');
        act.forEach(a=>a.classList.remove('active'));
        li.classList.add('active');
        loadProjectIntoMatrix(p, entry.projects[p]);
        setStatus('');
      });
      projectListEl.appendChild(li);
      sponsorProjects[p] = entry.projects[p].slice();
    });
    setStatus('');
  }

  // ---------- Matrix builder helpers ----------
  function makeHeaderCell(text, cls){
    const th = document.createElement('th');
    th.innerHTML = text.replace(/\n/g,'<br>');
    if (cls) th.classList.add(cls);
    return th;
  }

  function makeRadioCell(name, value){
    const td = document.createElement('td');
    td.classList.add('col-scale');
    const wrap = document.createElement('div'); wrap.className = 'radio-cell';
    const input = document.createElement('input'); input.type = 'radio'; input.name = name; input.value = String(value);
    wrap.appendChild(input); td.appendChild(wrap);
    return td;
  }

  // main renderer: builds stacked rubric cards with table per criterion
  function loadProjectIntoMatrix(projectName, students){
    currentProject = projectName || '';
    if (!matrixContainer) return;

    // clear previous
    matrixContainer.innerHTML = '';

    // header/info above matrix
    const info = document.createElement('div');
    info.id = 'matrix-info';
    info.className = 'matrix-info';
    info.innerHTML = `<div class="current-project-header">${escapeHtml(projectName)}</div>
                      <div class="matrix-description">Please evaluate the students using the rubric below (scale 1–7).</div>`;
    matrixContainer.parentNode.insertBefore(info, matrixContainer);

    if (!students || !students.length) {
      matrixContainer.textContent = 'No students found for this project.';
      return;
    }

    // ensure stagedRatings container exists
    if (!stagedRatings[currentProject]) stagedRatings[currentProject] = {};

    // build each rubric card
    const temp = document.createDocumentFragment();
    RUBRIC.forEach((crit, cIdx) => {
      const card = document.createElement('div'); card.className = 'card rubric-card';
      const title = document.createElement('h4'); title.textContent = `${cIdx+1}. ${crit.title}`; title.style.margin='0 0 8px';
      const desc = document.createElement('div'); desc.textContent = crit.description || ''; desc.style.margin='0 0 12px;'; desc.className='matrix-criterion-desc';
      card.appendChild(title); card.appendChild(desc);

      // table
      const scroll = document.createElement('div'); scroll.className = 'rubric-scrollwrap';
      const table = document.createElement('table'); table.className = 'matrix-table';
      const thead = document.createElement('thead'); const trHead = document.createElement('tr');

      // columns: Student | Left descriptor | 1..7 | Right descriptor
      trHead.appendChild(makeHeaderCell('Student', 'col-student'));
      trHead.appendChild(makeHeaderCell(LEFT_DESCRIPTOR, 'col-descriptor'));
      for (let s=1;s<=7;s++) trHead.appendChild(makeHeaderCell(String(s), 'col-scale'));
      trHead.appendChild(makeHeaderCell(RIGHT_DESCRIPTOR, 'col-descriptor'));
      thead.appendChild(trHead);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');

      // rows for each student
      students.forEach((stu, sIdx) => {
        const tr = document.createElement('tr');
        // student name cell
        const tdName = document.createElement('td'); tdName.className='col-student'; tdName.textContent = stu;
        tr.appendChild(tdName);
        // left descriptor empty cell for symmetry
        const ld = document.createElement('td'); ld.className='col-descriptor'; tr.appendChild(ld);

        // numeric columns
        for (let score=1; score<=7; score++) {
          const name = `rating-${cIdx}-${sIdx}`;
          const cell = makeRadioCell(name, score);
          // restore staged value if present
          const stagedVal = (stagedRatings[currentProject] && stagedRatings[currentProject][sIdx] && stagedRatings[currentProject][sIdx][cIdx] !== undefined) ? stagedRatings[currentProject][sIdx][cIdx] : null;
          if (stagedVal !== null && String(stagedVal) === String(score)) {
            const input = cell.querySelector('input[type="radio"]');
            if (input) input.checked = true;
          }
          tr.appendChild(cell);
        }
        // right descriptor cell empty for symmetry
        const rd = document.createElement('td'); rd.className='col-descriptor'; tr.appendChild(rd);

        tbody.appendChild(tr);
      });

      // team row (as last row)
      const trTeam = document.createElement('tr'); trTeam.className = 'team-row';
      const tdTeam = document.createElement('td'); tdTeam.className='col-student'; tdTeam.textContent = 'Team (group as a whole)';
      trTeam.appendChild(tdTeam);
      trTeam.appendChild(document.createElement('td')); // left descriptor
      const teamIndex = students.length;
      for (let score=1; score<=7; score++){
        const name = `rating-${cIdx}-${teamIndex}`;
        const cell = makeRadioCell(name, score);
        const stagedVal = (stagedRatings[currentProject] && stagedRatings[currentProject][teamIndex] && stagedRatings[currentProject][teamIndex][cIdx] !== undefined) ? stagedRatings[currentProject][teamIndex][cIdx] : null;
        if (stagedVal !== null && String(stagedVal) === String(score)) {
          const input = cell.querySelector('input[type="radio"]'); if (input) input.checked = true;
        }
        trTeam.appendChild(cell);
      }
      trTeam.appendChild(document.createElement('td')); // right descriptor
      tbody.appendChild(trTeam);

      table.appendChild(tbody);
      scroll.appendChild(table);
      card.appendChild(scroll);
      temp.appendChild(card);
    });

    // append built content and set up listeners
    matrixContainer.appendChild(temp);

    // create comment box under matrix once (project level). Keep same id so saveDraftHandler finds it.
    let commentSec = document.querySelector('.section.section-comment');
    if (commentSec) commentSec.parentNode.removeChild(commentSec);
    commentSec = document.createElement('div'); commentSec.className = 'section section-comment card';
    const commentWrap = document.createElement('div'); commentWrap.className = 'project-comment-wrap';
    const label = document.createElement('label'); label.setAttribute('for','project-comment'); label.textContent = 'Optional project comment';
    const ta = document.createElement('textarea'); ta.id = 'project-comment'; ta.placeholder = 'Any additional feedback for the students or instructor...'; ta.style.width='100%'; ta.style.minHeight='80px';
    commentWrap.appendChild(label); commentWrap.appendChild(ta); commentSec.appendChild(commentWrap);
    matrixContainer.parentNode.insertBefore(commentSec, matrixContainer.nextSibling);

    // attach change/input listeners to matrixContainer to save draft (debounced)
    matrixContainer.removeEventListener('change', debounceSaveDraft);
    matrixContainer.addEventListener('change', debounceSaveDraft);
    matrixContainer.removeEventListener('input', debounceSaveDraft);
    matrixContainer.addEventListener('input', debounceSaveDraft);
    ta.removeEventListener('input', debounceSaveDraft);
    ta.addEventListener('input', debounceSaveDraft);

    if (typeof updateSectionVisibility === 'function') updateSectionVisibility && updateSectionVisibility();
  }

  // Save current matrix state into stagedRatings (reads radio inputs)
  function saveDraftHandler(){
    if (!currentProject) return;
    if (!stagedRatings[currentProject]) stagedRatings[currentProject] = {};
    const students = sponsorProjects[currentProject] || [];
    for (let s = 0; s <= students.length; s++){
      if (!stagedRatings[currentProject][s]) stagedRatings[currentProject][s] = {};
      for (let c=0;c<RUBRIC.length;c++){
        const sel = document.querySelector(`input[name="rating-${c}-${s}"]:checked`);
        if (sel) stagedRatings[currentProject][s][c] = parseInt(sel.value,10);
        else if (stagedRatings[currentProject][s] && stagedRatings[currentProject][s][c] !== undefined) {
          delete stagedRatings[currentProject][s][c];
        }
      }
    }
    const ta = document.getElementById('project-comment');
    if (ta) stagedRatings[currentProject]._comment = ta.value || '';
    saveProgress();
  }

  // Submit payload preserves existing rows format
  function submitCurrentProject(){
    if (!currentProject) { setStatus('No project is loaded.', 'red'); return; }
    const students = sponsorProjects[currentProject] || [];
    if (!students.length) { setStatus('No students to submit.', 'red'); return; }

    const rows = [];
    for (let s=0;s<students.length;s++){
      const ratingsObj = {};
      for (let c=0;c<RUBRIC.length;c++){
        const val = (stagedRatings[currentProject] && stagedRatings[currentProject][s] && stagedRatings[currentProject][s][c] !== undefined) ? stagedRatings[currentProject][s][c] : null;
        ratingsObj[RUBRIC[c].title] = val;
      }
      const commentShared = (stagedRatings[currentProject][s] && stagedRatings[currentProject][s]._comment) ? stagedRatings[currentProject][s]._comment : '';
      const commentInstructor = (stagedRatings[currentProject][s] && stagedRatings[currentProject][s]._instructor) ? stagedRatings[currentProject][s]._instructor : '';
      rows.push({ student: students[s], ratings: ratingsObj, commentShared, commentInstructor, isTeam: "" });
    }

    // team row
    const teamIndex = students.length;
    const teamRatingsObj = {};
    for (let c=0;c<RUBRIC.length;c++){
      const tv = (stagedRatings[currentProject][teamIndex] && stagedRatings[currentProject][teamIndex][c] !== undefined) ? stagedRatings[currentProject][teamIndex][c] : null;
      teamRatingsObj[RUBRIC[c].title] = tv;
    }
    const teamCommentShared = (stagedRatings[currentProject][teamIndex] && stagedRatings[currentProject][teamIndex]._comment) ? stagedRatings[currentProject][teamIndex]._comment : '';
    const teamCommentInstructor = (stagedRatings[currentProject][teamIndex] && stagedRatings[currentProject][teamIndex]._instructor) ? stagedRatings[currentProject][teamIndex]._instructor : '';
    rows.push({ student: TEAM_KEY_LABEL, ratings: teamRatingsObj, commentShared: teamCommentShared, commentInstructor: teamCommentInstructor, isTeam: "TRUE" });

    const payload = {
      sponsorName: currentName || (nameInput ? nameInput.value.trim() : ''),
      sponsorEmail: currentEmail || (emailInput ? emailInput.value.trim() : ''),
      project: currentProject,
      rubric: RUBRIC.map(r=>r.title),
      responses: rows,
      timestamp: new Date().toISOString()
    };

    setStatus('Submitting...', 'black');
    if (submitProjectBtn) submitProjectBtn.disabled = true;
    fetch(ENDPOINT_URL, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) })
      .then(resp => {
        if (!resp.ok) return resp.text().then(txt => { throw new Error('Server error ' + resp.status + ': ' + txt); });
        return resp.json().catch(()=>({}));
      })
      .then(data => {
        setStatus('Submission saved. Thank you!', 'green');
        completedProjects[currentProject] = true;
        if (stagedRatings && stagedRatings[currentProject]) delete stagedRatings[currentProject];
        saveProgress();

        // mark list item as completed if exists
        if (projectListEl) {
          const li = projectListEl.querySelector(`li[data-project="${CSS.escape(currentProject)}"]`);
          if (li) { li.classList.remove('active'); li.classList.add('completed'); li.innerHTML = `<strong>${escapeHtml(currentProject)}</strong> <span class="meta">(completed)</span>`; }
        }

        // clear matrix and comments
        if (matrixContainer) matrixContainer.innerHTML = '';
        const commentSection = document.querySelector('.section.section-comment'); if (commentSection) commentSection.parentNode.removeChild(commentSection);
        const matrixInfoBlock = document.getElementById('matrix-info'); if (matrixInfoBlock) matrixInfoBlock.style.display = 'none';
        currentProject = '';
        if (typeof updateSectionVisibility === 'function') updateSectionVisibility();
        if (hasCompletedAllProjects()) showThankyouStage();
      })
      .catch(err => { console.error('Submission failed', err); setStatus('Submission failed. See console.', 'red'); })
      .finally(()=>{ if (submitProjectBtn) submitProjectBtn.disabled = false; });
  }

  function hasCompletedAllProjects(){
    const entry = sponsorData[currentEmail] || {};
    const all = Object.keys(entry.projects || {});
    for (let i=0;i<all.length;i++) if (!completedProjects[all[i]]) return false;
    return true;
  }

  // ---------- Stage helpers & events ----------
  function showIdentityStage(){ if (stageIdentity) stageIdentity.style.display=''; if (stageProjects) stageProjects.style.display='none'; if (stageThankyou) stageThankyou.style.display='none'; if (welcomeBlock) welcomeBlock.style.display=''; if (underTitle) underTitle.style.display=''; setStatus(''); }
  function showProjectsStage(){ if (stageIdentity) stageIdentity.style.display='none'; if (stageProjects) stageProjects.style.display=''; if (stageThankyou) stageThankyou.style.display='none'; if (welcomeBlock) welcomeBlock.style.display='none'; if (underTitle) underTitle.style.display='none'; }
  function showThankyouStage(){ if (stageIdentity) stageIdentity.style.display='none'; if (stageProjects) stageProjects.style.display='none'; if (stageThankyou) stageThankyou.style.display=''; if (welcomeBlock) welcomeBlock.style.display='none'; if (underTitle) underTitle.style.display='none'; }

  function onIdentitySubmit(){
    const name = nameInput ? nameInput.value.trim() : '';
    const email = emailInput ? (emailInput.value || '').toLowerCase().trim() : '';
    if (!name) { setStatus('Please enter your name.', 'red'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setStatus('Please enter a valid email.', 'red'); return; }
    currentName = name; currentEmail = email; saveProgress();
    if (!sponsorData || Object.keys(sponsorData).length === 0) {
      setStatus('Loading project data, please wait...', 'black');
      tryFetchData(() => { if (!sponsorData || !sponsorData[currentEmail]) { setStatus('No projects found for that email.', 'red'); return; } showProjectsStage(); populateProjectListFor(currentEmail); });
    } else {
      if (!sponsorData[currentEmail]) { setStatus('No projects found for that email.', 'red'); return; }
      showProjectsStage(); populateProjectListFor(currentEmail);
    }
  }

  if (identitySubmit) identitySubmit.addEventListener('click', onIdentitySubmit);
  if (backToIdentity) backToIdentity.addEventListener('click', () => { showIdentityStage(); });
  if (submitProjectBtn) submitProjectBtn.addEventListener('click', () => submitCurrentProject());
  if (finishStartOverBtn) finishStartOverBtn.addEventListener('click', () => {
    completedProjects = {}; stagedRatings = {}; saveProgress(); currentProject = ''; if (matrixContainer) matrixContainer.innerHTML = '';
    const commentSection = document.querySelector('.section.section-comment'); if (commentSection) commentSection.parentNode.removeChild(commentSection); showIdentityStage();
  });

  // ---------- Boot ----------
  showIdentityStage();
  tryFetchData();

  // expose some debug hooks (optional)
  window.__sponsorDebug = { sponsorData, stagedRatings, completedProjects, reloadData: (cb) => tryFetchData(cb) };
  window.__submitCurrentProject = submitCurrentProject;

})();


