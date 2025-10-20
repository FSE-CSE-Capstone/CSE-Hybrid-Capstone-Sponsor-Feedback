// scripts.js — hybrid UI: descriptor columns + per-student collapsible comments + draft autosave
(function () {
  'use strict';

  // -------------- CONFIG --------------
  var ENDPOINT_URL = 'https://csehybridsponsors.sbecerr7.workers.dev/';      // <-- change to your submission worker URL
  var DATA_LOADER_URL = 'https://data-loader.sbecerr7.workers.dev/';// <-- change to your data-loader URL
  var STORAGE_KEY = 'sponsor_progress_v1';

  // -------------- RUBRIC (fallback if not provided by server) --------------
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

  // -------------- DOM refs --------------
  var stageIdentity = document.getElementById('stage-identity');
  var stageProjects = document.getElementById('stage-projects');
  var stageThankyou = document.getElementById('stage-thankyou');
  var identitySubmit = document.getElementById('identitySubmit');
  var backToIdentity = document.getElementById('backToIdentity');
  var nameInput = document.getElementById('fullName');
  var emailInput = document.getElementById('email');
  var projectListEl = document.getElementById('project-list');
  var matrixContainer = document.getElementById('matrix-container');
  var studentCommentsWrapper = document.getElementById('student-comments-wrapper');
  var currentProjectHeader = document.getElementById('current-project-header');
  var matrixInfoBlock = document.getElementById('matrix-info');
  var submitProjectBtn = document.getElementById('submitProject');
  var finishStartOverBtn = document.getElementById('finishStartOver');
  var formStatus = document.getElementById('form-status');
  var submitStatus = document.getElementById('submit-status');

  // -------------- State --------------
  var sponsorData = {};     // { email: { projects: { name: [students...] } } }
  var currentEmail = '';
  var currentName = '';
  var currentProject = '';
  var sponsorProjects = {};
  var completedProjects = {};
  var stagedRatings = {}; // stagedRatings[project][rowIndex][criterionIndex], _comment_shared/_comment_instructor

  // -------------- Helpers --------------
  function setStatus(msg, color) {
    if (!formStatus) return;
    formStatus.textContent = msg || '';
    formStatus.style.color = color || '';
  }
  function setSubmitStatus(msg, color) {
    if (!submitStatus) return;
    submitStatus.textContent = msg || '';
    submitStatus.style.color = color || '';
  }

  function saveProgress() {
    try {
      var payload = {
        name: currentName,
        email: currentEmail,
        completedProjects: completedProjects,
        stagedRatings: stagedRatings
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.warn('saveProgress error', e);
    }
  }

  function loadProgress() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var obj = JSON.parse(raw);
      if (!obj) return;
      currentName = obj.name || '';
      currentEmail = obj.email || '';
      completedProjects = obj.completedProjects || {};
      stagedRatings = obj.stagedRatings || {};
      if (nameInput) nameInput.value = currentName;
      if (emailInput) emailInput.value = currentEmail;
    } catch (e) {
      console.warn('loadProgress error', e);
    }
  }

  // Build sponsor map from rows returned by data-loader
  function buildSponsorMap(rows) {
    var map = {};
    if (!Array.isArray(rows)) return map;
    rows.forEach(function (r) {
      var email = (r.sponsorEmail || r.email || '').toLowerCase().trim();
      var project = (r.project || '').trim();
      var student = (r.student || '').trim();
      if (!email || !project) return;
      if (!map[email]) map[email] = { projects: {} };
      if (!map[email].projects[project]) map[email].projects[project] = [];
      if (student && map[email].projects[project].indexOf(student) === -1) {
        map[email].projects[project].push(student);
      }
    });
    return map;
  }

  // -------------- Project list UI --------------
  function populateProjectListFor(email) {
    if (!projectListEl) return;
    projectListEl.innerHTML = '';
    sponsorProjects = {};
    var entry = sponsorData[email];
    if (!entry || !entry.projects) {
      setStatus('No projects found for that email.', 'red');
      return;
    }
    var projNames = Object.keys(entry.projects).slice();
    projNames.sort();
    projNames.forEach(function (p) {
      var li = document.createElement('li');
      li.className = 'project-item';
      li.setAttribute('data-project', p);
      li.textContent = p;
      if (completedProjects[p]) {
        li.classList.add('completed');
        li.textContent = p + ' (completed)';
      }
      li.addEventListener('click', function () {
        if (completedProjects[p]) { setStatus('This project is already completed.', 'red'); return; }
        var active = projectListEl.querySelectorAll('.project-item.active');
        active.forEach(function (a) { a.classList.remove('active'); });
        li.classList.add('active');
        loadProjectIntoMatrix(p, entry.projects[p].slice());
        setStatus('');
      });
      projectListEl.appendChild(li);
      sponsorProjects[p] = entry.projects[p].slice();
    });
    setStatus('');
  }

  // -------------- Matrix rendering --------------
  function loadProjectIntoMatrix(projectName, students) {
    currentProject = projectName || '';
    if (!matrixContainer) return;

    matrixContainer.innerHTML = '';
    studentCommentsWrapper.innerHTML = '';
    if (currentProjectHeader) currentProjectHeader.textContent = currentProject || '';
    if (matrixInfoBlock) matrixInfoBlock.style.display = 'block';

    if (!students) students = [];

    if (!stagedRatings[currentProject]) stagedRatings[currentProject] = {};

    RUBRIC.forEach(function (crit, cIdx) {
      var card = document.createElement('div');
      card.className = 'matrix-card';

      var title = document.createElement('h4');
      title.className = 'matrix-criterion-title';
      title.textContent = (cIdx + 1) + '. ' + (crit.title || '');
      card.appendChild(title);

      var desc = document.createElement('div');
      desc.className = 'matrix-criterion-desc';
      desc.textContent = crit.description || '';
      card.appendChild(desc);

      var table = document.createElement('table');
      table.className = 'matrix-table';

      var thead = document.createElement('thead');
      var trHead = document.createElement('tr');

      // Student name header
      var thName = document.createElement('th'); thName.textContent = 'Student';
      trHead.appendChild(thName);

      // left descriptor column header (Far Below)
      var thDescLeft = document.createElement('th'); thDescLeft.className = 'col-descriptor';
      thDescLeft.innerHTML = '<div>Far Below Expectations (Fail)</div>';
      trHead.appendChild(thDescLeft);

      // numeric columns 1..7
      for (var k = 1; k <= 7; k++) {
        var th = document.createElement('th'); th.className = 'col-num'; th.textContent = String(k);
        trHead.appendChild(th);
      }

      // right descriptor column header (Exceeds)
      var thDescRight = document.createElement('th'); thDescRight.className = 'col-descriptor';
      thDescRight.style.textAlign = 'right';
      thDescRight.innerHTML = '<div>Exceeds Expectations (A+)</div>';
      trHead.appendChild(thDescRight);

      thead.appendChild(trHead);
      table.appendChild(thead);

      var tbody = document.createElement('tbody');

      students.forEach(function (studentName, sIdx) {
        var tr = document.createElement('tr');
        tr.setAttribute('data-student-index', String(sIdx));

        var tdName = document.createElement('td');
        tdName.textContent = studentName;
        tr.appendChild(tdName);

        // left descriptor empty cell
        var tdDescLeft = document.createElement('td'); tdDescLeft.className = 'col-descriptor'; tdDescLeft.innerHTML = '';
        tr.appendChild(tdDescLeft);

        for (var score = 1; score <= 7; score++) {
          var td = document.createElement('td'); td.className = 'col-num';
          var input = document.createElement('input');
          input.type = 'radio';
          input.name = 'rating-' + cIdx + '-' + sIdx;
          input.value = String(score);
          input.id = 'rating-' + cIdx + '-' + sIdx + '-' + score;

          var stagedVal = (stagedRatings[currentProject] && stagedRatings[currentProject][sIdx] && stagedRatings[currentProject][sIdx][cIdx]) || null;
          if (stagedVal && String(stagedVal) === String(score)) input.checked = true;

          td.appendChild(input);
          tr.appendChild(td);
        }

        var tdDescRight = document.createElement('td'); tdDescRight.className = 'col-descriptor'; tdDescRight.style.textAlign = 'right'; tdDescRight.innerHTML = '';
        tr.appendChild(tdDescRight);

        tbody.appendChild(tr);
      });

      // team row
      var teamIdx = students.length;
      var trTeam = document.createElement('tr');
      trTeam.className = 'team-row';
      trTeam.setAttribute('data-student-index', String(teamIdx));

      var tdTeamName = document.createElement('td');
      tdTeamName.textContent = 'Evaluating group as a whole';
      tdTeamName.style.fontWeight = '700';
      trTeam.appendChild(tdTeamName);

      var tdTeamDescLeft = document.createElement('td'); tdTeamDescLeft.className = 'col-descriptor'; tdTeamDescLeft.innerHTML = ''; trTeam.appendChild(tdTeamDescLeft);

      for (var ts = 1; ts <= 7; ts++) {
        var tdT = document.createElement('td'); tdT.className = 'col-num';
        var inputT = document.createElement('input');
        inputT.type = 'radio';
        inputT.name = 'rating-' + cIdx + '-' + teamIdx;
        inputT.value = String(ts);
        inputT.id = 'rating-' + cIdx + '-team-' + ts;

        var stagedTeamVal = (stagedRatings[currentProject] && stagedRatings[currentProject][teamIdx] && stagedRatings[currentProject][teamIdx][cIdx]) || null;
        if (stagedTeamVal && String(stagedTeamVal) === String(ts)) inputT.checked = true;

        tdT.appendChild(inputT);
        trTeam.appendChild(tdT);
      }

      var tdTeamDescRight = document.createElement('td'); tdTeamDescRight.className = 'col-descriptor'; tdTeamDescRight.style.textAlign = 'right'; tdTeamDescRight.innerHTML = '';
      trTeam.appendChild(tdTeamDescRight);

      tbody.appendChild(trTeam);
      table.appendChild(tbody);
      card.appendChild(table);

      matrixContainer.appendChild(card);
    });

    // build per-student comment panels
    buildPerStudentCommentPanels(currentProject, students);

    // wire rating changes to autosave (use delegation)
    matrixContainer.removeEventListener && matrixContainer.removeEventListener('change', handleDraftSave);
    matrixContainer.addEventListener('change', handleDraftSave);
  }

  // -------------- Per-student collapsible panels --------------
  function buildPerStudentCommentPanels(projectKey, students) {
    if (!studentCommentsWrapper) return;
    studentCommentsWrapper.innerHTML = '';

    var title = document.createElement('div');
    title.className = 'comment-title';
    title.textContent = 'Add your additional comments';
    studentCommentsWrapper.appendChild(title);

    if (!stagedRatings[projectKey]) stagedRatings[projectKey] = {};

    students.forEach(function (studentName, sIdx) {
      var item = document.createElement('div');
      item.className = 'student-comment-item';
      item.setAttribute('data-student-index', String(sIdx));

      var header = document.createElement('div'); header.className = 'student-comment-header';
      var name = document.createElement('div'); name.className = 'student-comment-name'; name.textContent = studentName;
      var toggleBtn = document.createElement('button'); toggleBtn.type = 'button'; toggleBtn.className = 'toggle-comment-btn'; toggleBtn.innerHTML = '<span class="chev">▾</span> Add comment';
      header.appendChild(name); header.appendChild(toggleBtn);
      item.appendChild(header);

      var body = document.createElement('div'); body.className = 'student-comment-body';

      var sharedLabel = document.createElement('label'); sharedLabel.textContent = 'Comments to be SHARED WITH THE STUDENT';
      var sharedTa = document.createElement('textarea'); sharedTa.id = 'student-' + projectKey + '-shared-' + sIdx; sharedTa.placeholder = 'Comments to share with the student';
      sharedTa.value = (stagedRatings[projectKey] && stagedRatings[projectKey][sIdx] && stagedRatings[projectKey][sIdx]._comment_shared) ? stagedRatings[projectKey][sIdx]._comment_shared : '';
      body.appendChild(sharedLabel); body.appendChild(sharedTa);

      var instrLabel = document.createElement('label'); instrLabel.style.marginTop = '8px'; instrLabel.textContent = 'Comments to be SHARED ONLY WITH THE INSTRUCTOR';
      var instrTa = document.createElement('textarea'); instrTa.id = 'student-' + projectKey + '-instr-' + sIdx; instrTa.placeholder = 'Private comments for instructor';
      instrTa.value = (stagedRatings[projectKey] && stagedRatings[projectKey][sIdx] && stagedRatings[projectKey][sIdx]._comment_instructor) ? stagedRatings[projectKey][sIdx]._comment_instructor : '';
      body.appendChild(instrLabel); body.appendChild(instrTa);

      item.appendChild(body);

      header.addEventListener('click', function () {
        var isOpen = item.classList.toggle('open');
        body.style.display = isOpen ? 'block' : 'none';
      });

      // save inputs into stagedRatings
      sharedTa.addEventListener('input', function () {
        if (!stagedRatings[projectKey]) stagedRatings[projectKey] = {};
        if (!stagedRatings[projectKey][sIdx]) stagedRatings[projectKey][sIdx] = {};
        stagedRatings[projectKey][sIdx]._comment_shared = sharedTa.value || '';
        saveProgress();
      });
      instrTa.addEventListener('input', function () {
        if (!stagedRatings[projectKey]) stagedRatings[projectKey] = {};
        if (!stagedRatings[projectKey][sIdx]) stagedRatings[projectKey][sIdx] = {};
        stagedRatings[projectKey][sIdx]._comment_instructor = instrTa.value || '';
        saveProgress();
      });

      studentCommentsWrapper.appendChild(item);
    });

    // Team item
    var teamIdx = students.length;
    var teamItem = document.createElement('div');
    teamItem.className = 'student-comment-item';
    teamItem.setAttribute('data-student-index', String(teamIdx));

    var teamHeader = document.createElement('div'); teamHeader.className = 'student-comment-header';
    var teamName = document.createElement('div'); teamName.className = 'student-comment-name'; teamName.textContent = 'Comments for Evaluating group as a whole';
    var teamToggle = document.createElement('button'); teamToggle.type = 'button'; teamToggle.className = 'toggle-comment-btn'; teamToggle.innerHTML = '<span class="chev">▾</span> Add comment';
    teamHeader.appendChild(teamName); teamHeader.appendChild(teamToggle);
    teamItem.appendChild(teamHeader);

    var teamBody = document.createElement('div'); teamBody.className = 'student-comment-body';

    var teamSharedLabel = document.createElement('label'); teamSharedLabel.textContent = 'Comments to be SHARED WITH THE STUDENT';
    var teamSharedTa = document.createElement('textarea'); teamSharedTa.id = 'student-' + projectKey + '-shared-team'; teamSharedTa.placeholder = 'Comments to share with the team-level evaluation';
    teamSharedTa.value = (stagedRatings[projectKey] && stagedRatings[projectKey][teamIdx] && stagedRatings[projectKey][teamIdx]._comment_shared) ? stagedRatings[projectKey][teamIdx]._comment_shared : '';
    teamBody.appendChild(teamSharedLabel); teamBody.appendChild(teamSharedTa);

    var teamInstrLabel = document.createElement('label'); teamInstrLabel.style.marginTop = '8px'; teamInstrLabel.textContent = 'Comments to be SHARED ONLY WITH THE INSTRUCTOR';
    var teamInstrTa = document.createElement('textarea'); teamInstrTa.id = 'student-' + projectKey + '-instr-team'; teamInstrTa.placeholder = 'Private comments for instructor (team-level)';
    teamInstrTa.value = (stagedRatings[projectKey] && stagedRatings[projectKey][teamIdx] && stagedRatings[projectKey][teamIdx]._comment_instructor) ? stagedRatings[projectKey][teamIdx]._comment_instructor : '';
    teamBody.appendChild(teamInstrLabel); teamBody.appendChild(teamInstrTa);

    teamItem.appendChild(teamBody);

    teamHeader.addEventListener('click', function () {
      var isOpen = teamItem.classList.toggle('open');
      teamBody.style.display = isOpen ? 'block' : 'none';
    });

    teamSharedTa.addEventListener('input', function () {
      if (!stagedRatings[currentProject]) stagedRatings[currentProject] = {};
      if (!stagedRatings[currentProject][teamIdx]) stagedRatings[currentProject][teamIdx] = {};
      stagedRatings[currentProject][teamIdx]._comment_shared = teamSharedTa.value || '';
      saveProgress();
    });
    teamInstrTa.addEventListener('input', function () {
      if (!stagedRatings[currentProject]) stagedRatings[currentProject] = {};
      if (!stagedRatings[currentProject][teamIdx]) stagedRatings[currentProject][teamIdx] = {};
      stagedRatings[currentProject][teamIdx]._comment_instructor = teamInstrTa.value || '';
      saveProgress();
    });

    studentCommentsWrapper.appendChild(teamItem);
  }

  // -------------- Draft saving for ratings + ensure comments exist --------------
  function handleDraftSave() {
    if (!currentProject) return;
    if (!sponsorProjects[currentProject]) return;

    var students = sponsorProjects[currentProject] || [];
    var totalRows = students.length + 1; // includes team
    if (!stagedRatings[currentProject]) stagedRatings[currentProject] = {};

    for (var r = 0; r < totalRows; r++) {
      if (!stagedRatings[currentProject][r]) stagedRatings[currentProject][r] = {};
      for (var c = 0; c < RUBRIC.length; c++) {
        var sel = document.querySelector('input[name="rating-' + c + '-' + r + '"]:checked');
        if (sel) stagedRatings[currentProject][r][c] = parseInt(sel.value, 10);
        else stagedRatings[currentProject][r][c] = stagedRatings[currentProject][r][c] || null;
      }
      // comments saved by textarea input handlers; ensure keys exist
      stagedRatings[currentProject][r]._comment_shared = (stagedRatings[currentProject][r] && stagedRatings[currentProject][r]._comment_shared) || '';
      stagedRatings[currentProject][r]._comment_instructor = (stagedRatings[currentProject][r] && stagedRatings[currentProject][r]._comment_instructor) || '';
    }

    saveProgress();
  }

  // -------------- Submit --------------
  function submitCurrentProject() {
    if (!currentProject) { setSubmitStatus('No project selected.', 'red'); return; }
    if (!sponsorProjects[currentProject] || sponsorProjects[currentProject].length === 0) { setSubmitStatus('No students found for this project.', 'red'); return; }

    var students = sponsorProjects[currentProject].slice();
    var totalRows = students.length + 1;
    var responses = [];

    for (var r = 0; r < totalRows; r++) {
      var isTeam = (r === students.length);
      var studentLabel = isTeam ? 'Evaluating group as a whole' : students[r];
      var ratingMap = {};
      for (var c = 0; c < RUBRIC.length; c++) {
        var sel = document.querySelector('input[name="rating-' + c + '-' + r + '"]:checked');
        ratingMap[RUBRIC[c].title] = sel ? parseInt(sel.value, 10) : null;
      }

      // fetch comments from stagedRatings if available (fallback to DOM)
      var commentShared = '';
      var commentInstructor = '';
      if (stagedRatings[currentProject] && stagedRatings[currentProject][r]) {
        commentShared = stagedRatings[currentProject][r]._comment_shared || '';
        commentInstructor = stagedRatings[currentProject][r]._comment_instructor || '';
      } else {
        var sharedEl = document.getElementById('student-' + currentProject + '-shared-' + (isTeam ? 'team' : r));
        var instrEl = document.getElementById('student-' + currentProject + '-instr-' + (isTeam ? 'team' : r));
        commentShared = sharedEl ? sharedEl.value : '';
        commentInstructor = instrEl ? instrEl.value : '';
      }

      responses.push({
        student: studentLabel,
        ratings: ratingMap,
        commentShared: commentShared,
        commentInstructor: commentInstructor,
        isTeam: isTeam
      });
    }

    var payload = {
      sponsorName: currentName || (nameInput ? nameInput.value.trim() : ''),
      sponsorEmail: currentEmail || (emailInput ? emailInput.value.trim() : ''),
      project: currentProject,
      rubric: RUBRIC.map(function (r) { return r.title; }),
      responses: responses,
      timestamp: new Date().toISOString()
    };

    setSubmitStatus('Submitting...', 'black');
    if (submitProjectBtn) submitProjectBtn.disabled = true;

    fetch(ENDPOINT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (resp) {
      if (!resp.ok) {
        return resp.text().then(function (t) { throw new Error('Server error: ' + resp.status + ' ' + t); });
      }
      return resp.json().catch(function () { return {}; });
    }).then(function (res) {
      setSubmitStatus('Submission saved — thank you!', 'green');
      completedProjects[currentProject] = true;
      if (stagedRatings && stagedRatings[currentProject]) delete stagedRatings[currentProject];
      saveProgress();

      // mark project completed in UI
      try {
        var li = projectListEl.querySelector('li[data-project="' + CSS.escape(currentProject) + '"]');
        if (li) {
          li.classList.add('completed');
          li.classList.remove('active');
          li.textContent = currentProject + ' (completed)';
        }
      } catch (e) {}

      matrixContainer.innerHTML = '';
      studentCommentsWrapper.innerHTML = '';
      if (currentProjectHeader) currentProjectHeader.textContent = '';
      if (matrixInfoBlock) matrixInfoBlock.style.display = 'none';
      currentProject = '';

      if (hasCompletedAllProjects()) showThankyouStage();
    }).catch(function (err) {
      console.error(err);
      setSubmitStatus('Submission failed. Please try again.', 'red');
    }).finally(function () {
      if (submitProjectBtn) submitProjectBtn.disabled = false;
    });
  }

  // -------------- Misc helpers --------------
  function hasCompletedAllProjects() {
    if (!currentEmail) return false;
    var entry = sponsorData[currentEmail] || {};
    var all = Object.keys(entry.projects || {});
    if (!all.length) return true;
    for (var i = 0; i < all.length; i++) if (!completedProjects[all[i]]) return false;
    return true;
  }

  function onIdentitySubmit() {
    var name = nameInput ? nameInput.value.trim() : '';
    var email = emailInput ? (emailInput.value || '').toLowerCase().trim() : '';
    if (!name) { setStatus('Please enter your name.', 'red'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setStatus('Please enter a valid email.', 'red'); return; }

    currentName = name; currentEmail = email;
    saveProgress();

    if (!sponsorData || Object.keys(sponsorData).length === 0) {
      setStatus('Loading project data...', 'black');
      fetchData(function () {
        if (!sponsorData[currentEmail]) {
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

  // -------------- Data fetching (with local fallback) --------------
  function fetchData(callback) {
    fetch(DATA_LOADER_URL, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('Data loader returned ' + r.status);
        return r.json();
      })
      .then(function (rows) {
        sponsorData = buildSponsorMap(rows || []);
        loadProgress();
        if (typeof callback === 'function') callback();
      })
      .catch(function (err) {
        // fallback sample data (so UI can be tested locally)
        console.warn('Data fetch failed, falling back to sample data:', err);
        var sampleRows = [
          { sponsorEmail: 'sponsor@example.com', project: 'Project A', student: 'Alice Johnson' },
          { sponsorEmail: 'sponsor@example.com', project: 'Project A', student: 'Bob Smith' },
          { sponsorEmail: 'sponsor@example.com', project: 'Project B', student: 'Carlos Gomez' }
        ];
        sponsorData = buildSponsorMap(sampleRows);
        loadProgress();
        if (typeof callback === 'function') callback();
      });
  }

  function showIdentityStage() {
    if (stageIdentity) stageIdentity.style.display = '';
    if (stageProjects) stageProjects.style.display = 'none';
    if (stageThankyou) stageThankyou.style.display = 'none';
    setStatus('');
  }
  function showProjectsStage() {
    if (stageIdentity) stageIdentity.style.display = 'none';
    if (stageProjects) stageProjects.style.display = '';
    if (stageThankyou) stageThankyou.style.display = 'none';
    setStatus('');
  }
  function showThankyouStage() {
    if (stageIdentity) stageIdentity.style.display = 'none';
    if (stageProjects) stageProjects.style.display = 'none';
    if (stageThankyou) stageThankyou.style.display = '';
    setStatus('');
  }

  // -------------- Events --------------
  identitySubmit && identitySubmit.addEventListener('click', onIdentitySubmit);
  backToIdentity && backToIdentity.addEventListener('click', function () { showIdentityStage(); });
  submitProjectBtn && submitProjectBtn.addEventListener('click', submitCurrentProject);
  finishStartOverBtn && finishStartOverBtn.addEventListener('click', function () {
    completedProjects = {};
    stagedRatings = {};
    saveProgress();
    currentProject = '';
    matrixContainer.innerHTML = '';
    studentCommentsWrapper.innerHTML = '';
    showIdentityStage();
  });

  matrixContainer && matrixContainer.addEventListener('change', handleDraftSave);
  window.addEventListener('beforeunload', saveProgress);

  // -------------- Boot --------------
  loadProgress();
  showIdentityStage();
  fetchData();

  // debug
  window.__sponsorDebug = {
    sponsorData: sponsorData,
    stagedRatings: stagedRatings,
    completedProjects: completedProjects,
    reloadData: function (cb) { fetchData(cb); }
  };

})();





