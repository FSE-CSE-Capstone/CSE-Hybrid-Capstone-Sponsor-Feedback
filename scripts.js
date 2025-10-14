// Replace your existing scripts.js with the file below.
// Note: keep your existing ENDPOINT_URL, CSV_FILENAME constants if you want to change them.
// This script assumes the rest of your HTML (ids, sections) and CSS remain the same.

(function () {
  'use strict';

  // --- Configuration (keep your endpoint & csv) ---
  var ENDPOINT_URL = 'https://csesponsors.sbecerr7.workers.dev/';
  var CSV_FILENAME = 'data.csv';
  var STORAGE_KEY = 'sponsor_progress_v1';

  // --- RUBRIC ---
  // This array was populated from your uploaded Sponsor Feedback Rubric.xlsx.
  // If there were fewer than 7 items in the file, placeholders are appended so UI shows 7 matrices.
  var RUBRIC = [
    {
      title: "Student has contributed an appropriate amount of development effort towards this project",
      description: "Development effort should be balanced between all team members; student should commit to fair amount of development effort on each sprint."
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
    // If your spreadsheet has more items they should be placed above.
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
  var matrixInfo = document.getElementById('matrix-info'); // may be created later
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
  // stagedRatings structure: { projectName: { studentIndex: { criterionIndex: score, ... }, ... }, ... }
  var stagedRatings = {};

  /* -------------------------
     Helpers
     ------------------------- */
  function setStatus(msg, color) {
    if (!formStatus) return;
    formStatus.textContent = msg || '';
    formStatus.style.color = color || '';
  }

  function escapeHtml(s) {
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(s || '').replace(/[&<>"']/g, function (m) { return map[m]; });
  }

  function parseCSV(text) {
    var rows = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (!rows.length) return [];
    var headers = rows[0].split(',').map(function (h) { return h.trim(); });
    return rows.slice(1).map(function (line) {
      var parts = line.split(',').map(function (p) { return p.trim(); });
      var obj = {};
      headers.forEach(function (h, i) { obj[h] = parts[i] || ''; });
      return obj;
    });
  }

  function buildSponsorMap(rows) {
    var map = {};
    rows.forEach(function (r) {
      var email = (r.sponsorEmail || r.email || '').toLowerCase();
      var project = (r.project || '').trim();
      var student = (r.student || '').trim();
      if (!email || !project || !student) return;
      if (!map[email]) map[email] = { projects: {} };
      if (!map[email].projects[project]) map[email].projects[project] = [];
      if (map[email].projects[project].indexOf(student) === -1) {
        map[email].projects[project].push(student);
      }
    });
    return map;
  }

  function saveProgress() {
    var payload = {
      name: currentName,
      email: currentEmail,
      completedProjects: completedProjects,
      stagedRatings: stagedRatings
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.warn('Could not save progress', e);
    }
  }

  function loadProgress() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var obj = JSON.parse(raw);
      if (obj && obj.email) {
        currentName = obj.name || '';
        currentEmail = obj.email || '';
        completedProjects = obj.completedProjects || {};
        stagedRatings = obj.stagedRatings || {};
        if (nameInput) nameInput.value = currentName;
        if (emailInput) emailInput.value = currentEmail;
      }
    } catch (e) {
      console.warn('Could not load progress', e);
    }
  }

  // keep the existing updateSectionVisibility/removeEmptySections implementations in your file
  // (they're long; for brevity I call them if defined below)
  // If your original functions are in the same file, they remain unchanged.

  /* -------------------------
     Project list builder
     ------------------------- */
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
      var ca = completedProjects[a] ? -1 : 1;
      var cb = completedProjects[b] ? -1 : 1;
      return ca - cb;
    });

    for (var i = 0; i < allProjects.length; i++) {
      (function (p) {
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
      })(allProjects[i]);
    }

    setStatus('');
  }

  /* -------------------------
     Render matrix for a project (stacked rubric)
     ------------------------- */
  function loadProjectIntoMatrix(projectName, students) {
    currentProject = projectName;
    if (!matrixContainer) return;
    // clear previous
    matrixContainer.innerHTML = '';

    // ensure matrix info block exists above matrix (recreate if necessary)
    var info = document.getElementById('matrix-info');
    if (!info) {
      info = document.createElement('div');
      info.id = 'matrix-info';
      var hdr = document.createElement('div');
      hdr.className = 'current-project-header';
      var desc = document.createElement('div');
      desc.className = 'matrix-description';
      info.appendChild(hdr);
      info.appendChild(desc);
      matrixContainer.parentNode.insertBefore(info, matrixContainer);
    }

    // set header and top description
    var headerEl = info.querySelector('.current-project-header');
    var descEl = info.querySelector('.matrix-description');
    if (headerEl) headerEl.textContent = projectName;
    if (descEl) descEl.textContent = 'Please evaluate the students using the rubric below (scale 1–7).';
    info.style.display = '';

    if (!students || !students.length) {
      matrixContainer.textContent = 'No students found for this project.';
      return;
    }

    // Restore staged ratings for this project if existing
    if (!stagedRatings[currentProject]) stagedRatings[currentProject] = {};

    // Build each criterion block stacked
    RUBRIC.forEach(function (crit, cIdx) {
      // container per criterion
      var critWrap = document.createElement('div');
      critWrap.className = 'matrix-criterion';
      critWrap.style.marginBottom = '32px';
      // Title
      var critTitle = document.createElement('h4');
      critTitle.className = 'matrix-criterion-title';
      critTitle.textContent = (cIdx + 1) + '. ' + crit.title;
      critWrap.appendChild(critTitle);
      // Description
      var critDesc = document.createElement('div');
critDesc.className = 'matrix-description';
critDesc.style.fontWeight = 'normal';
critDesc.textContent = crit.description || '';

      // Table
      var table = document.createElement('table');
      table.className = 'matrix-table';
      var thead = document.createElement('thead');
      var trHead = document.createElement('tr');

      var thName = document.createElement('th');
      thName.textContent = 'Student';
      thName.style.textAlign = 'left';
      trHead.appendChild(thName);

      // columns 1..7
      for (var k = 1; k <= 7; k++) {
        var th = document.createElement('th');
        th.textContent = String(k);
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
        tr.appendChild(tdName);

        for (var score = 1; score <= 7; score++) {
          var td = document.createElement('td');
          td.style.textAlign = 'center';

          var input = document.createElement('input');
          input.type = 'radio';
          // name convention: rating-<criterionIndex>-<studentIndex>
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
          label.appendChild(input);

          td.appendChild(label);
          tr.appendChild(td);
        }

        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      critWrap.appendChild(table);

      // add a small spacer
      var hr = document.createElement('div');
      hr.style.height = '12px';
      critWrap.appendChild(hr);

      matrixContainer.appendChild(critWrap);
    });

    // Comment area (single for the project)
    // First remove any existing comment section in DOM then add fresh
    var existingComment = document.querySelector('.section.section-comment');
    if (existingComment) {
      existingComment.parentNode && existingComment.parentNode.removeChild(existingComment);
    }
    var commentSec = document.createElement('div');
    commentSec.className = 'section section-comment';

    var commentWrap = document.createElement('div');
    commentWrap.className = 'project-comment-wrap';
    var commentLabel = document.createElement('label');
    commentLabel.setAttribute('for', 'project-comment');
    commentLabel.textContent = 'Optional project comment';
    var commentTA = document.createElement('textarea');
    commentTA.id = 'project-comment';
    commentTA.placeholder = 'Any additional feedback for the students or instructor...';

    // restore any staged comment
    var staged = stagedRatings[currentProject] && stagedRatings[currentProject]._comment;
    if (staged) commentTA.value = staged;

    commentWrap.appendChild(commentLabel);
    commentWrap.appendChild(commentTA);
    commentSec.appendChild(commentWrap);

    // Insert comment section after matrix container (match your HTML structure)
    matrixContainer.parentNode.insertBefore(commentSec, matrixContainer.nextSibling);

    // Add event listeners for auto-saving staged ratings
    matrixContainer.addEventListener('change', saveDraftHandler);
    matrixContainer.addEventListener('input', saveDraftHandler);
    commentTA.addEventListener('input', saveDraftHandler);

    // Update visibility helpers if present
    if (typeof updateSectionVisibility === 'function') updateSectionVisibility();
    if (typeof removeEmptySections === 'function') removeEmptySections();
  }

  /* -------------------------
     Draft saving handler
     ------------------------- */
  function saveDraftHandler() {
    if (!currentProject) return;
    if (!stagedRatings[currentProject]) stagedRatings[currentProject] = {};

    var students = sponsorProjects[currentProject] || [];
    // for each student/criterion, read selected radio
    for (var s = 0; s < students.length; s++) {
      if (!stagedRatings[currentProject][s]) stagedRatings[currentProject][s] = {};
      for (var c = 0; c < RUBRIC.length; c++) {
        var sel = document.querySelector('input[name="rating-' + c + '-' + s + '"]:checked');
        if (sel) {
          stagedRatings[currentProject][s][c] = parseInt(sel.value, 10);
        } else {
          // do not delete existing; keep null if empty
          if (stagedRatings[currentProject][s][c] === undefined) stagedRatings[currentProject][s][c] = null;
        }
      }
    }
    // store comment
    var ta = document.getElementById('project-comment');
    if (ta) stagedRatings[currentProject]._comment = ta.value || '';

    saveProgress();
  }

  /* -------------------------
     Submit current project (collect all criteria)
     ------------------------- */
  function submitCurrentProject() {
    if (!currentProject) { setStatus('No project is loaded.', 'red'); return; }
    var students = sponsorProjects[currentProject] || [];
    if (!students.length) { setStatus('No students to submit.', 'red'); return; }

    // Build rows: for each student, collect ratings for each criterion
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

    var anyRated = rows.some(function (r) {
      return Object.keys(r.ratings).some(function (k) { return r.ratings[k] != null; });
    });
    if (!anyRated) { setStatus('Please rate at least one student before submitting.', 'red'); return; }

    var payload = {
      sponsorName: currentName || (nameInput ? nameInput.value.trim() : ''),
      sponsorEmail: currentEmail || (emailInput ? emailInput.value.trim() : ''),
      project: currentProject,
      rubric: RUBRIC.map(function (r) { return r.title; }), // include rubric titles for clarity
      responses: rows,
      timestamp: new Date().toISOString()
    };

    setStatus('Submitting...', 'black');
    if (submitProjectBtn) submitProjectBtn.disabled = true;

    var form = new FormData();
    form.append('payload', JSON.stringify(payload));

    fetch(ENDPOINT_URL, { method: 'POST', body: form }).then(function (resp) {
      if (!resp.ok) {
        return resp.text().then(function (txt) {
          throw new Error('Server error ' + resp.status + ': ' + txt);
        });
      }
      return resp.json().catch(function () { return {}; });
    }).then(function (data) {
      console.log('Saved', data);
      setStatus('Submission saved. Thank you!', 'green');

      // mark completed and save
      completedProjects[currentProject] = true;
      if (stagedRatings && stagedRatings[currentProject]) delete stagedRatings[currentProject];
      saveProgress();

      // update project list entry to completed
      if (projectListEl) {
        var li = projectListEl.querySelector('li[data-project="' + CSS.escape(currentProject) + '"]');
        if (li) {
          li.classList.add('completed');
          li.classList.remove('active');
          li.innerHTML = '<strong>' + escapeHtml(currentProject) + '</strong> <span class="meta">(completed)</span>';
        }
      }

      // clear matrix and comment DOM (remove nodes to avoid blank leftover)
      if (matrixContainer) matrixContainer.innerHTML = '';
      var commentSection = document.querySelector('.section.section-comment');
      if (commentSection) {
        commentSection.parentNode && commentSection.parentNode.removeChild(commentSection);
      }

      // remove the small header if present
      var headerEl = document.querySelector('.current-project-header');
      if (headerEl && headerEl.parentNode) headerEl.parentNode.removeChild(headerEl);

      // hide/clear the #matrix-info block so description disappears
      var matrixInfoBlock = document.getElementById('matrix-info');
      if (matrixInfoBlock) {
        var hdr = matrixInfoBlock.querySelector('.current-project-header');
        var desc = matrixInfoBlock.querySelector('.matrix-description');
        if (hdr) hdr.textContent = '';
        if (desc) desc.textContent = '';
        matrixInfoBlock.style.display = 'none';
      }

      currentProject = '';
      if (typeof updateSectionVisibility === 'function') updateSectionVisibility();
      if (typeof removeEmptySections === 'function') removeEmptySections();

      if (hasCompletedAllProjects()) {
        showThankyouStage();
      }
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
    if (!all || all.length === 0) return false;
    for (var i = 0; i < all.length; i++) {
      if (!completedProjects[all[i]]) return false;
    }
    return true;
  }

  /* -------------------------
     Event wiring (identity / nav / submit)
     ------------------------- */
  if (identitySubmit) {
    identitySubmit.addEventListener('click', function () {
      var name = nameInput ? nameInput.value.trim() : '';
      var email = emailInput ? (emailInput.value || '').toLowerCase().trim() : '';
      if (!name) { setStatus('Please enter your name.', 'red'); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setStatus('Please enter a valid email.', 'red'); return; }

      currentName = name;
      currentEmail = email;
      saveProgress();

      if (!sponsorData[email]) {
        setStatus('No projects found for that email.', 'red');
        return;
      }
      showProjectsStage();
      populateProjectListFor(email);
    });
  }

  if (backToIdentity) {
    backToIdentity.addEventListener('click', function () { showIdentityStage(); });
  }

  if (submitProjectBtn) {
    submitProjectBtn.addEventListener('click', function () { submitCurrentProject(); });
  }

  if (finishStartOverBtn) {
    finishStartOverBtn.addEventListener('click', function () {
      completedProjects = {};
      stagedRatings = {};
      saveProgress();
      currentProject = '';
      if (matrixContainer) matrixContainer.innerHTML = '';
      var commentSection = document.querySelector('.section.section-comment');
      if (commentSection) { commentSection.parentNode && commentSection.parentNode.removeChild(commentSection); }
      showIdentityStage();
    });
  }

  /* -------------------------
     Show/hide stage helpers (these keep your current behavior)
     ------------------------- */
  function showIdentityStage() {
    if (stageIdentity) stageIdentity.style.display = '';
    if (stageProjects) stageProjects.style.display = 'none';
    if (stageThankyou) stageThankyou.style.display = 'none';
    if (welcomeBlock) welcomeBlock.style.display = '';
    if (underTitle) underTitle.style.display = '';
    setStatus('');
  }

  function showProjectsStage() {
    if (stageIdentity) stageIdentity.style.display = 'none';
    if (stageProjects) stageProjects.style.display = '';
    if (stageThankyou) stageThankyou.style.display = 'none';
    if (welcomeBlock) welcomeBlock.style.display = 'none';
    if (underTitle) underTitle.style.display = 'none';
  }

  function showThankyouStage() {
    if (stageIdentity) stageIdentity.style.display = 'none';
    if (stageProjects) stageProjects.style.display = 'none';
    if (stageThankyou) stageThankyou.style.display = '';
    if (welcomeBlock) welcomeBlock.style.display = 'none';
    if (underTitle) underTitle.style.display = 'none';
  }

  /* -------------------------
     CSV fetch + boot
     ------------------------- */
  function tryFetchCSV() {
    fetch(CSV_FILENAME, { cache: 'no-store' }).then(function (resp) {
      if (!resp.ok) throw new Error('CSV fetch failed: ' + resp.status);
      return resp.text();
    }).then(function (txt) {
      var rows = parseCSV(txt);
      sponsorData = buildSponsorMap(rows);
      setStatus('Project data loaded. Enter your email to continue.', 'green');
      loadProgress();
      if (currentEmail && sponsorData[currentEmail]) {
        showProjectsStage();
        populateProjectListFor(currentEmail);
      }
    }).catch(function (err) {
      console.debug('CSV fetch failed', err);
      setStatus('Project data not found. Ensure data.csv is present.');
    });
  }

  // Boot
  showIdentityStage();
  tryFetchCSV();

  // small debug helpers
  window.__sponsorDebug = {
    sponsorData: sponsorData,
    stagedRatings: stagedRatings,
    completedProjects: completedProjects,
    reloadCSV: tryFetchCSV
  };
})();





