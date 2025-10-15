// Full updated scripts.js
(function () {
  'use strict';

  // --- Configuration (Cloudflare Workers endpoints) ---
  var ENDPOINT_URL = 'https://csehybridsponsors.sbecerr7.workers.dev/';  // POST submissions here
  var DATA_LOADER_URL = 'https://data-loader.sbecerr7.workers.dev/';     // GET sponsor/project data here
  var STORAGE_KEY = 'sponsor_progress_v1';

  // --- RUBRIC (5 items) ---
  var RUBRIC = [
    {
      title: "Student has contributed an appropriate amount of development effort towards this project",
      description: "Development effort should be balanced between all team members; student should commit to a fair amount of development effort on each sprint."
    },
    {
      title: "Student's level of contribution and participation in meetings",
      description: "Students are expected to be proactive. Contributions and participation in meetings help ensure the student is aware of project goals."
    },
    {
      title: "Student's understanding of your project/problem",
      description: "Students are expected to understand important details of the project and be able to explain it from different stakeholder perspectives."
    },
    {
      title: "Quality of student's work product",
      description: "Students should complete assigned work to a high quality: correct, documented, and self-explanatory where appropriate."
    },
    {
      title: "Quality and frequency of student's communications",
      description: "Students are expected to be in regular communication and maintain professionalism when interacting with the sponsor."
    }
  ];

  // --- DOM nodes ---
  var stageIdentity = document.getElementById('stage-identity');
  var stageProjects = document.getElementById('stage-projects');
  var stageThankyou = document.getElementById('stage-thankyou');
  var identitySubmit = document.getElementById('identitySubmit');
  var backToIdentity = document.getElementById('backToIdentity');
  var nameInput = document.getElementById('fullName');
  var emailInput = document.getElementById('email');
  var projectListEl = document.getElementById('project-list');
  var matrixContainer = document.getElementById('matrix-container');
  var formStatus = document.getElementById('form-status');
  var submitProjectBtn = document.getElementById('submitProject');
  var finishStartOverBtn = document.getElementById('finishStartOver');
  var welcomeBlock = document.getElementById('welcome-block');
  var underTitle = document.getElementById('under-title');

  // --- State ---
  var sponsorData = {};
  var sponsorProjects = {};
  var currentEmail = '';
  var currentName = '';
  var currentProject = '';
  var completedProjects = {};
  var stagedRatings = {};

  // --- Helpers ---
  function setStatus(msg, color) {
    if (!formStatus) return;
    formStatus.textContent = msg || '';
    formStatus.style.color = color || '';
  }

  function escapeHtml(s) {
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(s || '').replace(/[&<>"']/g, function (m) { return map[m]; });
  }

// REPLACE the existing buildSponsorMap with this robust version
function buildSponsorMap(rows) {
  // rows: array of objects produced by the data-loader (keys come from sheet header text)
  var map = {};

  // harmless short-circuit
  if (!Array.isArray(rows) || rows.length === 0) return map;

  // normalize keys for each row, supporting many header variants
  rows.forEach(function (rawRow) {
    // build a normalized object with canonical keys we expect:
    // sponsorEmail, project, student
    var normalized = { sponsorEmail: '', project: '', student: '' };

    Object.keys(rawRow || {}).forEach(function (rawKey) {
      var k = String(rawKey || '').trim().toLowerCase();
      var v = (rawRow[rawKey] || '').toString().trim();

      // map known header variants to our canonical keys
      if (k === 'sponsoremail' || k === 'sponsor email' || k === 'sponsor' || k === 'email' || k === 'login_id') {
        // treat these as sponsor email candidate
        if (!normalized.sponsorEmail) normalized.sponsorEmail = v;
      } else if (k === 'project' || k === 'project name' || k === 'project_title' || k === 'group_name') {
        if (!normalized.project) normalized.project = v;
      } else if (k === 'student' || k === 'student name' || k === 'students' || k === 'name') {
        if (!normalized.student) normalized.student = v;
      } else {
        // if the sheet used short names like 'project' / 'student' variations,
        // we've already covered them. otherwise ignore unknown columns.
      }
    });

    var email = (normalized.sponsorEmail || '').toLowerCase().trim();
    var project = (normalized.project || '').trim();
    var student = (normalized.student || '').trim();

    if (!email || !project || !student) {
      // skip incomplete rows
      return;
    }

    if (!map[email]) map[email] = { projects: {} };
    if (!map[email].projects[project]) map[email].projects[project] = [];
    if (map[email].projects[project].indexOf(student) === -1) {
      map[email].projects[project].push(student);
    }
  });

  // debug summary so you can inspect quickly in console
  try {
    console.info('buildSponsorMap: mapped', Object.keys(map).length, 'sponsors and',
                 Object.keys(map).reduce(function (acc, e) {
                   return acc + Object.keys(map[e].projects).length;
                 }, 0), 'projects total');
  } catch (e) {}
  return map;
}


  // -------------------------
  // Project list builder
  // -------------------------
  function populateProjectListFor(email) {
    if (!projectListEl) return;
    projectListEl.innerHTML = '';
    sponsorProjects = {};
    var entry = sponsorData[email];
    if (!entry || !entry.projects) {
      setStatus('No projects found for that email.', 'red');
      return;
    }
    var allProjects = Object.keys(entry.projects).slice();
    allProjects.sort(function (a, b) {
      var ca = completedProjects[a] ? 1 : 0;
      var cb = completedProjects[b] ? 1 : 0;
      return ca - cb;
    });

    allProjects.forEach(function (p) {
      var li = document.createElement('li');
      li.className = 'project-item';
      li.tabIndex = 0;
      li.setAttribute('data-project', p);

      if (completedProjects[p]) {
        li.className += ' completed';
        li.innerHTML = '<strong>' + escapeHtml(p) + '</strong> <span class="meta">(completed)</span>';
      } else {
        li.innerHTML = '<strong>' + escapeHtml(p) + '</strong>';
      }

      li.addEventListener('click', function () {
        if (completedProjects[p]) {
          setStatus('This project is already completed.', 'red');
          return;
        }
        var act = projectListEl.querySelectorAll('.project-item.active');
        for (var ai = 0; ai < act.length; ai++) act[ai].classList.remove('active');
        li.classList.add('active');
        loadProjectIntoMatrix(p, entry.projects[p]);
        setStatus('');
      });

      projectListEl.appendChild(li);
      sponsorProjects[p] = entry.projects[p].slice();
    });

    setStatus('');
  }

    // -------------------------
  // Render matrix for a project (stacked rubric; each criterion in its own card)
  // -------------------------
  function loadProjectIntoMatrix(projectName, students) {
    currentProject = projectName;
    if (!matrixContainer) return;

    // Remove any previously injected matrix-info to avoid duplicates
    var oldInfo = document.getElementById('matrix-info');
    if (oldInfo && oldInfo.parentNode) oldInfo.parentNode.removeChild(oldInfo);

    // clear previous matrices and comments
    matrixContainer.innerHTML = '';
    var oldComment = document.querySelector('.section.section-comment');
    if (oldComment && oldComment.parentNode) oldComment.parentNode.removeChild(oldComment);

    // create (or re-create) matrix-info and place it right before matrixContainer if possible
    var info = document.createElement('div');
    info.id = 'matrix-info';
    var hdr = document.createElement('div');
    hdr.className = 'current-project-header';
    hdr.textContent = projectName || '';
    hdr.style.display = 'block';
    hdr.style.marginBottom = '6px';
    hdr.style.fontWeight = '600';
    var topDesc = document.createElement('div');
    topDesc.className = 'matrix-info-desc';
    topDesc.textContent = 'Please evaluate the students using the rubric below (scale 1–7).';
    topDesc.style.display = 'block';
    topDesc.style.color = '#0b1228';
    topDesc.style.fontWeight = '400';
    topDesc.style.fontSize = '14px';
    topDesc.style.marginBottom = '12px';

    info.appendChild(hdr);
    info.appendChild(topDesc);

    if (matrixContainer.parentNode) {
      matrixContainer.parentNode.insertBefore(info, matrixContainer);
    } else {
      document.body.insertBefore(info, matrixContainer);
    }

    // defensive: if no students, show message and exit
    if (!students || !students.length) {
      matrixContainer.textContent = 'No students found for this project.';
      return;
    }

    // Restore staged ratings for this project if existing
    if (!stagedRatings[currentProject]) stagedRatings[currentProject] = {};

    // Build each criterion block stacked — each inside its own .card
    RUBRIC.forEach(function (crit, cIdx) {
      // outer card wrapper (use existing .card class)
      var card = document.createElement('div');
      card.className = 'card matrix-card';
      card.style.marginBottom = '20px';
      // give a default padding if card has none via css
      card.style.padding = card.style.padding || '18px';

      // inside card: container for the criterion
      var critWrap = document.createElement('div');
      critWrap.className = 'matrix-criterion';

      // Title
      var critTitle = document.createElement('h4');
      critTitle.className = 'matrix-criterion-title';
      critTitle.textContent = (cIdx + 1) + '. ' + (crit.title || '');
      critTitle.style.margin = '0 0 8px 0';
      critTitle.style.fontWeight = '600';
      critWrap.appendChild(critTitle);

      // Description — force inline styles to ensure it shows and is not bold
      var critDesc = document.createElement('div');
      critDesc.className = 'matrix-criterion-desc';
      critDesc.textContent = crit.description || '';
      critDesc.style.display = 'block';
      critDesc.style.color = '#0b1228';
      critDesc.style.fontWeight = '400'; // normal
      critDesc.style.fontSize = '14px';
      critDesc.style.lineHeight = '1.3';
      critDesc.style.margin = '0 0 12px 0';
      critWrap.appendChild(critDesc);

      // Table
      var table = document.createElement('table');
      table.className = 'matrix-table';
      table.style.width = '100%';
      table.style.borderCollapse = 'collapse';
      var thead = document.createElement('thead');
      var trHead = document.createElement('tr');

      var thName = document.createElement('th');
      thName.textContent = 'Student';
      thName.style.textAlign = 'left';
      thName.style.padding = '8px';
      trHead.appendChild(thName);

      // columns 1..7
      for (var k = 1; k <= 7; k++) {
        var th = document.createElement('th');
        th.textContent = String(k);
        th.style.padding = '8px';
        th.style.textAlign = 'center';
        trHead.appendChild(th);
      }
      thead.appendChild(trHead);
      table.appendChild(thead);

      var tbody = document.createElement('tbody');

      // build rows for students
      students.forEach(function (studentName, sIdx) {
        var tr = document.createElement('tr');

        var tdName = document.createElement('td');
        tdName.textContent = studentName;
        tdName.style.padding = '8px 10px';
        tdName.style.verticalAlign = 'middle';
        tr.appendChild(tdName);

        for (var score = 1; score <= 7; score++) {
          var td = document.createElement('td');
          td.style.textAlign = 'center';
          td.style.padding = '8px';

          var input = document.createElement('input');
          input.type = 'radio';
          input.name = 'rating-' + cIdx + '-' + sIdx;
          input.value = String(score);
          input.id = 'rating-' + cIdx + '-' + sIdx + '-' + score;

          // restore staged if present
          var stagedForProject = stagedRatings[currentProject] || {};
          var stagedForStudent = stagedForProject[sIdx] || {};
          if (stagedForStudent[cIdx] && String(stagedForStudent[cIdx]) === String(score)) {
            input.checked = true;
          }

          var label = document.createElement('label');
          label.setAttribute('for', input.id);
          label.style.cursor = 'pointer';
          label.style.display = 'inline-block';
          label.style.padding = '2px';
          label.appendChild(input);

          td.appendChild(label);
          tr.appendChild(td);
        }

        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      critWrap.appendChild(table);

      // Append criterion container into card, then card into matrix container
      card.appendChild(critWrap);
      matrixContainer.appendChild(card);
    });

    // Single comment area (project-level)
    var commentSec = document.createElement('div');
    commentSec.className = 'section section-comment';
    commentSec.style.marginTop = '12px';

    var commentWrap = document.createElement('div');
    commentWrap.className = 'project-comment-wrap';
    var commentLabel = document.createElement('label');
    commentLabel.setAttribute('for', 'project-comment');
    commentLabel.textContent = 'Optional project comment';
    commentLabel.style.display = 'block';
    commentLabel.style.marginBottom = '6px';
    var commentTA = document.createElement('textarea');
    commentTA.id = 'project-comment';
    commentTA.placeholder = 'Any additional feedback for the students or instructor...';
    commentTA.style.width = '100%';
    commentTA.style.minHeight = '80px';
    commentTA.style.padding = '8px';

    var stagedComment = stagedRatings[currentProject] && stagedRatings[currentProject]._comment;
    if (stagedComment) commentTA.value = stagedComment;

    commentWrap.appendChild(commentLabel);
    commentWrap.appendChild(commentTA);
    commentSec.appendChild(commentWrap);

    if (matrixContainer.parentNode) {
      matrixContainer.parentNode.insertBefore(commentSec, matrixContainer.nextSibling);
    } else {
      document.body.appendChild(commentSec);
    }

    // Add event listeners for auto-saving staged ratings
    // remove previous listeners if present by cloning node (guard against duplicates)
    // (this pattern prevents duplicate handlers if function called repeatedly)
    var newMatrixContainer = matrixContainer.cloneNode(false);
    while (matrixContainer.firstChild) {
      newMatrixContainer.appendChild(matrixContainer.firstChild);
    }
    matrixContainer.parentNode.replaceChild(newMatrixContainer, matrixContainer);
    matrixContainer = newMatrixContainer;

    matrixContainer.addEventListener('change', saveDraftHandler);
    matrixContainer.addEventListener('input', saveDraftHandler);
    commentTA.addEventListener('input', saveDraftHandler);

    if (typeof updateSectionVisibility === 'function') updateSectionVisibility();
    if (typeof removeEmptySections === 'function') removeEmptySections();
  }

  // -------------------------
  // Draft saving handler
  // -------------------------
  function saveDraftHandler() {
    if (!currentProject) return;
    if (!stagedRatings[currentProject]) stagedRatings[currentProject] = {};

    var students = sponsorProjects[currentProject] || [];
    for (var s = 0; s < students.length; s++) {
      if (!stagedRatings[currentProject][s]) stagedRatings[currentProject][s] = {};
      for (var c = 0; c < RUBRIC.length; c++) {
        var sel = document.querySelector('input[name="rating-' + c + '-' + s + '"]:checked');
        if (sel) stagedRatings[currentProject][s][c] = parseInt(sel.value, 10);
      }
    }
    var ta = document.getElementById('project-comment');
    if (ta) stagedRatings[currentProject]._comment = ta.value || '';

    saveProgress();
  }

  // -------------------------
  // Submit current project (collect all criteria)
  // -------------------------
  function submitCurrentProject() {
    if (!currentProject) { setStatus('No project is loaded.', 'red'); return; }
    var students = sponsorProjects[currentProject] || [];
    if (!students.length) { setStatus('No students to submit.', 'red'); return; }

    var rows = [];
    for (var s = 0; s < students.length; s++) {
      var ratingsObj = {};
      for (var c = 0; c < RUBRIC.length; c++) {
        var sel = document.querySelector('input[name="rating-' + c + '-' + s + '"]:checked');
        ratingsObj[RUBRIC[c].title] = sel ? parseInt(sel.value, 10) : null;
      }
      var commentVal = '';
      var taEl = document.getElementById('project-comment');
      if (taEl) commentVal = taEl.value || '';
      rows.push({ student: students[s], ratings: ratingsObj, comment: commentVal });
    }

    var payload = {
      sponsorName: currentName || (nameInput ? nameInput.value.trim() : ''),
      sponsorEmail: currentEmail || (emailInput ? emailInput.value.trim() : ''),
      project: currentProject,
      rubric: RUBRIC.map(function (r) { return r.title; }),
      responses: rows,
      timestamp: new Date().toISOString()
    };

    setStatus('Submitting...', 'black');
    if (submitProjectBtn) submitProjectBtn.disabled = true;

    fetch(ENDPOINT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (resp) {
      if (!resp.ok) {
        return resp.text().then(function (txt) { throw new Error('Server error ' + resp.status + ': ' + txt); });
      }
      return resp.json().catch(function () { return {}; });
    }).then(function (data) {
      console.log('Saved', data);
      setStatus('Submission saved. Thank you!', 'green');

      completedProjects[currentProject] = true;
      if (stagedRatings && stagedRatings[currentProject]) delete stagedRatings[currentProject];
      saveProgress();

      if (projectListEl) {
        var li = projectListEl.querySelector('li[data-project="' + CSS.escape(currentProject) + '"]');
        if (li) {
          li.classList.add('completed');
          li.classList.remove('active');
          li.innerHTML = '<strong>' + escapeHtml(currentProject) + '</strong> <span class="meta">(completed)</span>';
        }
      }

      if (matrixContainer) matrixContainer.innerHTML = '';
      var commentSection = document.querySelector('.section.section-comment');
      if (commentSection) commentSection.parentNode.removeChild(commentSection);

      var headerEl = document.querySelector('.current-project-header');
      if (headerEl && headerEl.parentNode) headerEl.parentNode.removeChild(headerEl);

      var matrixInfoBlock = document.getElementById('matrix-info');
      if (matrixInfoBlock) matrixInfoBlock.style.display = 'none';

      currentProject = '';
      if (typeof updateSectionVisibility === 'function') updateSectionVisibility();
      if (typeof removeEmptySections === 'function') removeEmptySections();

      if (hasCompletedAllProjects()) showThankyouStage();
    }).catch(function (err) {
      console.error('Submission failed', err);
      setStatus('Submission failed. See console.', 'red');
    }).finally(function () {
      if (submitProjectBtn) submitProjectBtn.disabled = false;
    });
  }

  function hasCompletedAllProjects() {
    var entry = sponsorData[currentEmail] || {};
    var all = Object.keys(entry.projects || {});
    for (var i = 0; i < all.length; i++) if (!completedProjects[all[i]]) return false;
    return true;
  }

  // -------------------------
  // Event wiring
  // -------------------------
  function onIdentitySubmit() {
    var name = nameInput ? nameInput.value.trim() : '';
    var email = emailInput ? (emailInput.value || '').toLowerCase().trim() : '';
    if (!name) { setStatus('Please enter your name.', 'red'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setStatus('Please enter a valid email.', 'red'); return; }

    currentName = name;
    currentEmail = email;
    saveProgress();

    if (!sponsorData || Object.keys(sponsorData).length === 0) {
      setStatus('Loading project data, please wait...', 'black');
      tryFetchData(function () {
        if (!sponsorData || !sponsorData[currentEmail]) {
          setStatus('No projects found for that email.', 'red');
          return;
        }
        showProjectsStage();
        populateProjectListFor(currentEmail);
      });
    } else {
      if (!sponsorData[currentEmail]) {
        setStatus('No projects found for that email.', 'red');
        return;
      }
      showProjectsStage();
      populateProjectListFor(currentEmail);
    }
  }

  if (identitySubmit) identitySubmit.addEventListener('click', onIdentitySubmit);
  if (backToIdentity) backToIdentity.addEventListener('click', function () { showIdentityStage(); });
  if (submitProjectBtn) submitProjectBtn.addEventListener('click', function () { submitCurrentProject(); });
  if (finishStartOverBtn) finishStartOverBtn.addEventListener('click', function () {
    completedProjects = {};
    stagedRatings = {};
    saveProgress();
    currentProject = '';
    if (matrixContainer) matrixContainer.innerHTML = '';
    var commentSection = document.querySelector('.section.section-comment');
    if (commentSection) commentSection.parentNode.removeChild(commentSection);
    showIdentityStage();
  });

  // -------------------------
  // Stage display helpers
  // -------------------------
  function showIdentityStage() {
    stageIdentity.style.display = '';
    stageProjects.style.display = 'none';
    stageThankyou.style.display = 'none';
    welcomeBlock.style.display = '';
    underTitle.style.display = '';
    setStatus('');
  }
  function showProjectsStage() {
    stageIdentity.style.display = 'none';
    stageProjects.style.display = '';
    stageThankyou.style.display = 'none';
    welcomeBlock.style.display = 'none';
    underTitle.style.display = 'none';
  }
  function showThankyouStage() {
    stageIdentity.style.display = 'none';
    stageProjects.style.display = 'none';
    stageThankyou.style.display = '';
    welcomeBlock.style.display = 'none';
    underTitle.style.display = 'none';
  }

  // -------------------------
  // Secure data fetch (replaces CSV)
  // -------------------------
  function tryFetchData(callback) {
    fetch(DATA_LOADER_URL, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('Data loader returned ' + r.status);
        return r.json();
      })
      .then(function (rows) {
        sponsorData = buildSponsorMap(rows);
        setStatus('Project data loaded securely.', 'green');
        loadProgress();
        if (currentEmail && sponsorData[currentEmail]) {
          showProjectsStage();
          populateProjectListFor(currentEmail);
        }
        if (typeof callback === 'function') callback();
      })
      .catch(function (err) {
        console.error('Data fetch failed', err);
        setStatus('Project data not found. Please try again later.', 'red');
        if (typeof callback === 'function') callback();
      });
  }

  // -------------------------
  // Boot
  // -------------------------
  showIdentityStage();
  tryFetchData();

  // Debug helper
  window.__sponsorDebug = {
    sponsorData: sponsorData,
    stagedRatings: stagedRatings,
    completedProjects: completedProjects,
    reloadData: function (cb) { tryFetchData(cb); }
  };

  window.__submitCurrentProject = submitCurrentProject;
})();





