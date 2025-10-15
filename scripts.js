// Full updated scripts.js (HYBRID site)
(function () {
  'use strict';

  // --- Configuration (Cloudflare Workers endpoints) ---
  var ENDPOINT_URL = 'https://csehybridsponsors.sbecerr7.workers.dev/';  // POST submissions here (change if hybrid uses different endpoint)
  var DATA_LOADER_URL = 'https://data-loader.sbecerr7.workers.dev/'; // HYBRID worker URL (reads hybrid sheet)
  var STORAGE_KEY = 'sponsor_progress_v1';
  // for hybrid deployment keep DATA_SOURCE blank so no ?source param appended
  var DATA_SOURCE = '';

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

  // -------------------------
  // Robust mapping from data-loader rows to sponsorData
  // Accepts varied header names, trims values, and supports multiple emails per sponsor cell.
  // -------------------------
  function buildSponsorMap(rows) {
    var map = {};
    if (!Array.isArray(rows) || rows.length === 0) return map;

    // regex to match typical email addresses
    var emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

    rows.forEach(function (rawRow) {
      // collect canonical values per row
      var project = '';
      var student = '';
      var sponsorCell = '';

      Object.keys(rawRow || {}).forEach(function (rawKey) {
        var keyNorm = String(rawKey || '').trim().toLowerCase();
        var rawVal = (rawRow[rawKey] || '').toString();
        var val = rawVal.replace(/\u00A0/g, ' ').trim(); // replace NBSP, trim

        if (keyNorm === 'project' || keyNorm === 'project name' || keyNorm === 'project_title' || keyNorm === 'group_name' || keyNorm === 'projectname') {
          if (!project) project = val;
        } else if (keyNorm === 'student' || keyNorm === 'student name' || keyNorm === 'students' || keyNorm === 'name' || keyNorm === 'student_name') {
          if (!student) student = val;
        } else if (keyNorm === 'sponsoremail' || keyNorm === 'sponsor email' || keyNorm === 'sponsor' || keyNorm === 'email' || keyNorm === 'login_id' || keyNorm === 'sponsor_email') {
          if (!sponsorCell) sponsorCell = val;
        } else {
          // ignore other columns
        }
      });

      project = (project || '').trim();
      student = (student || '').trim();

      if (!sponsorCell || !project || !student) {
        // if sponsorCell empty but there might be alternate email-like column names, attempt fallback:
        // fallback: scan all row values for any email-like strings
        if (!sponsorCell) {
          var fallbackEmails = [];
          Object.keys(rawRow || {}).forEach(function (k) {
            var rv = (rawRow[k] || '').toString();
            var found = rv.match(emailRegex);
            if (found && found.length) fallbackEmails = fallbackEmails.concat(found);
          });
          if (fallbackEmails.length) sponsorCell = fallbackEmails.join(', ');
        }
        // still skip if missing critical data
        if (!sponsorCell || !project || !student) return;
      }

      // extract emails from sponsorCell
      var foundEmails = (sponsorCell.match(emailRegex) || []).map(function (e) { return e.toLowerCase().trim(); });

      // if regex didn't find any emails, try splitting by common separators (comma, semicolon, slash, pipe, space)
      if (!foundEmails.length) {
        var parts = sponsorCell.split(/[,;\/|]+/);
        parts = parts.map(function (p) { return p.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
        parts.forEach(function (p) {
          var match = (p.match(emailRegex) || [])[0];
          if (match) foundEmails.push(match.toLowerCase().trim());
        });
      }

      // final cleanup & dedupe
      var uniqueEmails = [];
      foundEmails.forEach(function (em) {
        var e = (em || '').toLowerCase().trim();
        if (!e) return;
        // simple sanity check: must contain '@' and a dot after '@'
        if (e.indexOf('@') === -1) return;
        if (uniqueEmails.indexOf(e) === -1) uniqueEmails.push(e);
      });

      if (!uniqueEmails.length) return; // nothing to map

      // map each email to the project / student
      uniqueEmails.forEach(function (email) {
        if (!map[email]) map[email] = { projects: {} };
        if (!map[email].projects[project]) map[email].projects[project] = [];
        // avoid duplicate student entry
        if (map[email].projects[project].indexOf(student) === -1) {
          map[email].projects[project].push(student);
        }
      });
    });

    // debug summary
    try {
      var sponsorCount = Object.keys(map).length;
      var projectCount = Object.keys(map).reduce(function (acc, e) {
        return acc + Object.keys(map[e].projects || {}).length;
      }, 0);
      console.info('buildSponsorMap: mapped', sponsorCount, 'sponsors and', projectCount, 'projects total');
    } catch (e) {}

    return map;
  }

  // -------------------------
  // Save / load progress
  // -------------------------
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
        console.info('loadProgress: restored', currentEmail || '(none)');
      }
    } catch (e) {
      console.warn('Could not load progress', e);
    }
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
    var loaderUrl = DATA_LOADER_URL;
    if (DATA_SOURCE) {
      loaderUrl += (loaderUrl.indexOf('?') === -1
        ? '?source=' + encodeURIComponent(DATA_SOURCE)
        : '&source=' + encodeURIComponent(DATA_SOURCE));
    }
    // debug log of the exact URL requested
    console.info('tryFetchData: requesting', loaderUrl);

    fetch(loaderUrl, { cache: 'no-store' })
      .then(function (r) {
        console.info('tryFetchData: response status', r.status, r.statusText);
        if (!r.ok) throw new Error('Data loader returned ' + r.status);
        return r.json();
      })
      .then(function (rows) {
        console.info('tryFetchData: rows received length=', Array.isArray(rows) ? rows.length : typeof rows);
        sponsorData = buildSponsorMap(rows || []);
        // update debug pointer to the fresh object (fixes stale reference)
        window.__sponsorDebug && (window.__sponsorDebug.sponsorData = sponsorData);

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





