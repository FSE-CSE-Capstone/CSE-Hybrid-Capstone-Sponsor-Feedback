// Full updated scripts.js (HYBRID site)
// - multi-email parsing, reliable comment section creation, remove empty placeholder cards
// - ADDED: descriptor columns, per-student + team collapsible comment panels (shared + instructor),
//   persisted to stagedRatings in localStorage, submission includes commentShared/commentInstructor/isTeam
(function () {
  'use strict';

  // --- Configuration (Cloudflare Workers endpoints) ---
  var ENDPOINT_URL = 'https://csehybridsponsors.sbecerr7.workers.dev/';  // POST submissions here
  var DATA_LOADER_URL = 'https://data-loader.sbecerr7.workers.dev/';    // HYBRID worker URL (reads hybrid sheet)
  var STORAGE_KEY = 'sponsor_progress_v1';
  var DATA_SOURCE = ''; // blank for hybrid

  // --- RUBRIC (5 items) ---
  var RUBRIC = [
    { title: "Student has contributed an appropriate amount of development effort towards this project", description: "Development effort should be balanced between all team members; student should commit to a fair amount of development effort on each sprint." },
    { title: "Student's level of contribution and participation in meetings", description: "Students are expected to be proactive. Contributions and participation in meetings help ensure the student is aware of project goals." },
    { title: "Student's understanding of your project/problem", description: "Students are expected to understand important details of the project and be able to explain it from different stakeholder perspectives." },
    { title: "Quality of student's work product", description: "Students should complete assigned work to a high quality: correct, documented, and self-explanatory where appropriate." },
    { title: "Quality and frequency of student's communications", description: "Students are expected to be in regular communication and maintain professionalism when interacting with the sponsor." }
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

  // --- Small constants (ADDED) ---
  var TEAM_KEY_LABEL = "__TEAM__"; /* ADDED: team row name used in payload */
  var LEFT_DESCRIPTOR = "Far Below Expectations (Fail)"; /* ADDED */
  var RIGHT_DESCRIPTOR = "Exceeds Expectations (A+)";   /* ADDED */

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

  // --- remove empty placeholder cards that cause the "empty card" gap ---
  function removeEmptyPlaceholderCards() {
    if (!projectListEl) return;
    var container = projectListEl.parentNode;
    if (!container) return;

    var cards = Array.prototype.slice.call(container.querySelectorAll('.card'));
    cards.forEach(function (c) {
      var hasControls = c.querySelector('input, textarea, select, button, table, label');
      var text = (c.textContent || '').replace(/\s+/g, '');
      if (!hasControls && text.length === 0) {
        if (!c.classList.contains('matrix-card') && !c.classList.contains('persistent-placeholder')) {
          c.parentNode && c.parentNode.removeChild(c);
        }
      }
    });
  }

  // -------------------------
  // Robust mapping from data-loader rows to sponsorData
  // Accepts varied header names, trims values, and supports multiple emails per sponsor cell.
  // -------------------------
  function buildSponsorMap(rows) {
    var map = {};
    if (!Array.isArray(rows) || rows.length === 0) return map;

    var emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

    function cleanToken(tok) {
      if (!tok) return '';
      tok = tok.replace(/^[\s"'`([{]+|[\s"'`)\]}.,:;]+$/g, '').replace(/\u00A0/g, ' ').trim();
      if (tok.indexOf('@') !== -1 && tok.indexOf(' ') !== -1) {
        tok = tok.split(' ').join('');
      }
      return tok;
    }

    rows.forEach(function (rawRow) {
      var project = '';
      var student = '';
      var sponsorCell = '';

      Object.keys(rawRow || {}).forEach(function (rawKey) {
        var keyNorm = String(rawKey || '').trim().toLowerCase();
        var rawVal = (rawRow[rawKey] || '').toString();
        var val = rawVal.replace(/\u00A0/g, ' ').trim();

        if (!project && (keyNorm === 'project' || keyNorm === 'project name' || keyNorm === 'project_title' || keyNorm === 'group_name' || keyNorm === 'projectname')) {
          project = val;
        } else if (!student && (keyNorm === 'student' || keyNorm === 'student name' || keyNorm === 'students' || keyNorm === 'name' || keyNorm === 'student_name')) {
          student = val;
        } else if (!sponsorCell && (keyNorm === 'sponsoremail' || keyNorm === 'sponsor email' || keyNorm === 'sponsor' || keyNorm === 'email' || keyNorm === 'login_id' || keyNorm === 'sponsor_email')) {
          sponsorCell = val;
        }
      });

      project = (project || '').trim();
      student = (student || '').trim();

      if (!sponsorCell) {
        var fallbackEmails = [];
        Object.keys(rawRow || {}).forEach(function (k) {
          var rv = (rawRow[k] || '').toString();
          var found = rv.match(emailRegex);
          if (found && found.length) fallbackEmails = fallbackEmails.concat(found);
        });
        if (fallbackEmails.length) sponsorCell = fallbackEmails.join(', ');
      }

      if (!sponsorCell || !project || !student) return;

      // Split on common separators first
      var tokens = sponsorCell.split(/[,;\/|]+/);
      var foundEmails = [];

      tokens.forEach(function (t) {
        var cleaned = cleanToken(t);
        if (!cleaned) return;
        var m = cleaned.match(emailRegex);
        if (m && m.length) {
          m.forEach(function (em) { foundEmails.push(em.toLowerCase().trim()); });
          return;
        }
        var m2 = t.match(emailRegex);
        if (m2 && m2.length) {
          m2.forEach(function (em) { foundEmails.push(em.toLowerCase().trim()); });
          return;
        }
        if (t.indexOf('@') !== -1) {
          var nospace = t.replace(/\s+/g, '');
          var m3 = nospace.match(emailRegex);
          if (m3 && m3.length) m3.forEach(function (em) { foundEmails.push(em.toLowerCase().trim()); });
        }
      });

      // dedupe & sanity-check
      var uniqueEmails = [];
      foundEmails.forEach(function (em) {
        var e = (em || '').toLowerCase().trim();
        if (!e) return;
        if (e.indexOf('@') === -1) return;
        var parts = e.split('@');
        if (parts.length !== 2 || parts[1].indexOf('.') === -1) return;
        if (uniqueEmails.indexOf(e) === -1) uniqueEmails.push(e);
      });

      if (!uniqueEmails.length) return;

      uniqueEmails.forEach(function (email) {
        if (!map[email]) map[email] = { projects: {} };
        if (!map[email].projects[project]) map[email].projects[project] = [];
        if (map[email].projects[project].indexOf(student) === -1) {
          map[email].projects[project].push(student);
        }
      });
    });

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
    var payload = { name: currentName, email: currentEmail, completedProjects: completedProjects, stagedRatings: stagedRatings };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch (e) { console.warn('Could not save progress', e); }
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
    } catch (e) { console.warn('Could not load progress', e); }
  }

  // -------------------------
  // Project list builder
  // -------------------------
  function populateProjectListFor(email) {
    if (!projectListEl) return;
    projectListEl.innerHTML = '';
    sponsorProjects = {};
    var entry = sponsorData[email];
    if (!entry || !entry.projects) { setStatus('No projects found for that email.', 'red'); return; }
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
        if (completedProjects[p]) { setStatus('This project is already completed.', 'red'); return; }
        var act = projectListEl.querySelectorAll('.project-item.active');
        for (var ai = 0; ai < act.length; ai++) act[ai].classList.remove('active');
        li.classList.add('active');
        loadProjectIntoMatrix(p, entry.projects[p]);
        setStatus('');
      });

      projectListEl.appendChild(li);
      sponsorProjects[p] = entry.projects[p].slice();
    });

    // remove any leftover empty placeholder cards under the project list
    removeEmptyPlaceholderCards();
    setStatus('');
  }

  // -------------------------
  // Render matrix for a project (stacked rubric; each criterion in its own card)
  // This function builds into a temporary container, swaps children, then creates the comment section after the matrix.
  // -------------------------
  function loadProjectIntoMatrix(projectName, students) {
    currentProject = projectName;
    if (!matrixContainer) return;

    // Remove any previously injected matrix-info to avoid duplicates
    var oldInfo = document.getElementById('matrix-info');
    if (oldInfo && oldInfo.parentNode) oldInfo.parentNode.removeChild(oldInfo);

    // Remove any old comment section first (we'll re-create it)
    var oldComment = document.querySelector('.section.section-comment');
    if (oldComment && oldComment.parentNode) oldComment.parentNode.removeChild(oldComment);

    // Create matrix-info header and insert before matrixContainer if possible
    var info = document.createElement('div');
    info.id = 'matrix-info';
    var hdr = document.createElement('div'); hdr.className = 'current-project-header'; hdr.textContent = projectName || '';
    hdr.style.display = 'block'; hdr.style.marginBottom = '6px'; hdr.style.fontWeight = '600';
    var topDesc = document.createElement('div'); topDesc.className = 'matrix-info-desc';
    topDesc.textContent = 'Please evaluate the students using the rubric below (scale 1–7).';
    topDesc.style.display = 'block'; topDesc.style.color = '#0b1228'; topDesc.style.fontWeight = '400';
    topDesc.style.fontSize = '14px'; topDesc.style.marginBottom = '12px';
    info.appendChild(hdr); info.appendChild(topDesc);

    if (matrixContainer.parentNode) matrixContainer.parentNode.insertBefore(info, matrixContainer);
    else document.body.insertBefore(info, matrixContainer);

    if (!students || !students.length) {
      matrixContainer.textContent = 'No students found for this project.';
      return;
    }

    if (!stagedRatings[currentProject]) stagedRatings[currentProject] = {};

    var tempContainer = document.createElement('div');

    RUBRIC.forEach(function (crit, cIdx) {
      var card = document.createElement('div');
      card.className = 'card matrix-card';
      card.style.marginBottom = '20px';
      card.style.padding = card.style.padding || '18px';

      var critWrap = document.createElement('div'); critWrap.className = 'matrix-criterion';

      var critTitle = document.createElement('h4'); critTitle.className = 'matrix-criterion-title';
      critTitle.textContent = (cIdx + 1) + '. ' + (crit.title || ''); critTitle.style.margin = '0 0 8px 0'; critTitle.style.fontWeight = '600';
      critWrap.appendChild(critTitle);

      var critDesc = document.createElement('div'); critDesc.className = 'matrix-criterion-desc';
      critDesc.textContent = crit.description || ''; critDesc.style.display = 'block'; critDesc.style.color = '#0b1228';
      critDesc.style.fontWeight = '400'; critDesc.style.fontSize = '14px'; critDesc.style.lineHeight = '1.3'; critDesc.style.margin = '0 0 12px 0';
      critWrap.appendChild(critDesc);

      var table = document.createElement('table'); table.className = 'matrix-table'; table.style.width = '100%'; table.style.borderCollapse = 'collapse';
      var thead = document.createElement('thead'); var trHead = document.createElement('tr');

      /* MODIFIED: add left descriptor header column */
      var thLeftDesc = document.createElement('th'); thLeftDesc.textContent = LEFT_DESCRIPTOR; thLeftDesc.style.padding = '8px'; thLeftDesc.style.textAlign = 'center';
      trHead.appendChild(thLeftDesc);

      var thName = document.createElement('th'); thName.textContent = 'Student'; thName.style.textAlign = 'left'; thName.style.padding = '8px';
      trHead.appendChild(thName);

      for (var k = 1; k <= 7; k++) {
        var th = document.createElement('th'); th.textContent = String(k); th.style.padding = '8px'; th.style.textAlign = 'center'; trHead.appendChild(th);
      }

      /* MODIFIED: add right descriptor header column */
      var thRightDesc = document.createElement('th'); thRightDesc.textContent = RIGHT_DESCRIPTOR; thRightDesc.style.padding = '8px'; thRightDesc.style.textAlign = 'center';
      trHead.appendChild(thRightDesc);

      thead.appendChild(trHead); table.appendChild(thead);

      var tbody = document.createElement('tbody');

      students.forEach(function (studentName, sIdx) {
        var tr = document.createElement('tr');

        /* MODIFIED: left descriptor cell placeholder */
        var tdLeft = document.createElement('td'); tdLeft.className = 'descriptor-left-cell'; tdLeft.style.padding = '8px'; tdLeft.style.textAlign = 'center';
        tr.appendChild(tdLeft);

        var tdName = document.createElement('td'); tdName.textContent = studentName; tdName.style.padding = '8px 10px'; tdName.style.verticalAlign = 'middle';
        tr.appendChild(tdName);

        for (var score = 1; score <= 7; score++) {
          var td = document.createElement('td'); td.style.textAlign = 'center'; td.style.padding = '8px';
          var input = document.createElement('input'); input.type = 'radio'; input.name = 'rating-' + cIdx + '-' + sIdx; input.value = String(score);
          input.id = 'rating-' + cIdx + '-' + sIdx + '-' + score;

          var stagedForProject = stagedRatings[currentProject] || {};
          var stagedForStudent = stagedForProject[sIdx] || {};
          if (stagedForStudent[cIdx] && String(stagedForStudent[cIdx]) === String(score)) input.checked = true;

          var label = document.createElement('label'); label.setAttribute('for', input.id); label.style.cursor = 'pointer'; label.style.display = 'inline-block'; label.style.padding = '2px';
          label.appendChild(input);
          td.appendChild(label); tr.appendChild(td);
        }

        /* MODIFIED: right descriptor cell placeholder */
        var tdRight = document.createElement('td'); tdRight.className = 'descriptor-right-cell'; tdRight.style.padding = '8px'; tdRight.style.textAlign = 'center';
        tr.appendChild(tdRight);

        tbody.appendChild(tr);
      });

      /* MODIFIED: add a team row in the table body (team ratings for whole group) */
      var teamIndex = students.length; // use this index for team entries in stagedRatings
      // ensure stagedRatings structure exists for team
      if (!stagedRatings[currentProject]) stagedRatings[currentProject] = {};
      if (!stagedRatings[currentProject][teamIndex]) stagedRatings[currentProject][teamIndex] = stagedRatings[currentProject][teamIndex] || {};
      var teamTr = document.createElement('tr');

      var tdLeftTeam = document.createElement('td'); tdLeftTeam.className = 'descriptor-left-cell'; tdLeftTeam.style.padding = '8px'; tdLeftTeam.style.textAlign = 'center';
      teamTr.appendChild(tdLeftTeam);

      var tdTeamName = document.createElement('td'); tdTeamName.textContent = 'Team (group as a whole)'; tdTeamName.style.padding = '8px 10px'; tdTeamName.style.fontStyle = 'italic';
      teamTr.appendChild(tdTeamName);

      for (var scoreT = 1; scoreT <= 7; scoreT++) {
        var tdT = document.createElement('td'); tdT.style.textAlign = 'center'; tdT.style.padding = '8px';
        var inputT = document.createElement('input'); inputT.type = 'radio'; inputT.name = 'rating-' + cIdx + '-' + teamIndex; inputT.value = String(scoreT);
        inputT.id = 'rating-' + cIdx + '-' + teamIndex + '-' + scoreT;

        var stagedForProjectT = stagedRatings[currentProject] || {};
        var stagedForStudentT = stagedForProjectT[teamIndex] || {};
        if (stagedForStudentT[cIdx] && String(stagedForStudentT[cIdx]) === String(scoreT)) inputT.checked = true;

        var labelT = document.createElement('label'); labelT.setAttribute('for', inputT.id); labelT.style.cursor = 'pointer'; labelT.style.display = 'inline-block'; labelT.style.padding = '2px';
        labelT.appendChild(inputT);
        tdT.appendChild(labelT); teamTr.appendChild(tdT);
      }

      var tdRightTeam = document.createElement('td'); tdRightTeam.className = 'descriptor-right-cell'; tdRightTeam.style.padding = '8px'; tdRightTeam.style.textAlign = 'center';
      teamTr.appendChild(tdRightTeam);

      tbody.appendChild(teamTr);

      table.appendChild(tbody); critWrap.appendChild(table); card.appendChild(critWrap); tempContainer.appendChild(card);
    });

    // Replace matrixContainer children with built content
    while (matrixContainer.firstChild) matrixContainer.removeChild(matrixContainer.firstChild);
    while (tempContainer.firstChild) matrixContainer.appendChild(tempContainer.firstChild);

    // -------------------------
    // Create per-student collapsible comment panels (ADDED)
    // Each student gets two textareas: commentShared and commentInstructor. Team row also gets the same pair.
    // Store them in stagedRatings[currentProject][studentIndex]._shared and _instructor
    // -------------------------
    var commentSec = document.createElement('div');
    commentSec.className = 'section section-comment';
    commentSec.style.marginTop = '12px';
    commentSec.style.display = 'block'; // explicit display to avoid CSS hiding

    var titleH = document.createElement('h3'); titleH.textContent = 'Add your additional comments'; titleH.style.marginTop = '0'; titleH.style.marginBottom = '8px';
    commentSec.appendChild(titleH);

    var commentWrapAll = document.createElement('div'); commentWrapAll.className = 'project-comment-wrap';

    // helper to ensure stagedRatings entries exist for an index
    function ensureStagedForIndex(idx) {
      if (!stagedRatings[currentProject]) stagedRatings[currentProject] = {};
      if (!stagedRatings[currentProject][idx]) stagedRatings[currentProject][idx] = {};
    }

    students.forEach(function (studentName, sIdx) {
      ensureStagedForIndex(sIdx);
      var panel = document.createElement('div'); panel.className = 'card comment-card'; panel.style.padding = '12px'; panel.style.marginBottom = '8px';
      var header = document.createElement('button'); header.type = 'button'; header.className = 'collapsible-toggle'; header.textContent = studentName + ' ▾';
      header.style.fontWeight = '600'; header.style.width = '100%'; header.style.textAlign = 'left'; header.style.cursor = 'pointer'; header.style.border = 'none'; header.style.background = 'transparent';
      panel.appendChild(header);

      var body = document.createElement('div'); body.className = 'comment-body collapsed'; body.style.display = 'none'; body.style.marginTop = '8px';

      var lblShared = document.createElement('label'); lblShared.textContent = 'Comments to be SHARED WITH THE STUDENT'; lblShared.style.display = 'block'; lblShared.style.fontWeight = '600';
      var taShared = document.createElement('textarea'); taShared.id = 'comment-shared-' + sIdx; taShared.className = 'comment-shared'; taShared.rows = 4; taShared.placeholder = 'Optional comments that the student will see.';
      taShared.style.width = '100%'; taShared.style.boxSizing = 'border-box'; taShared.style.marginTop = '6px';
      taShared.value = (stagedRatings[currentProject][sIdx] && stagedRatings[currentProject][sIdx]._shared) ? stagedRatings[currentProject][sIdx]._shared : '';
      body.appendChild(lblShared); body.appendChild(taShared);

      var lblInst = document.createElement('label'); lblInst.textContent = 'Comments to be SHARED ONLY WITH THE INSTRUCTOR'; lblInst.style.display = 'block'; lblInst.style.fontWeight = '600'; lblInst.style.marginTop = '8px';
      var taInst = document.createElement('textarea'); taInst.id = 'comment-inst-' + sIdx; taInst.className = 'comment-inst'; taInst.rows = 4; taInst.placeholder = 'Private comments for the instructor only.';
      taInst.style.width = '100%'; taInst.style.boxSizing = 'border-box'; taInst.style.marginTop = '6px';
      taInst.value = (stagedRatings[currentProject][sIdx] && stagedRatings[currentProject][sIdx]._instructor) ? stagedRatings[currentProject][sIdx]._instructor : '';
      body.appendChild(lblInst); body.appendChild(taInst);

      // event listeners to save to stagedRatings
      taShared.addEventListener('input', function (ev) {
        ensureStagedForIndex(sIdx);
        stagedRatings[currentProject][sIdx]._shared = ev.target.value || '';
        saveProgress();
      });
      taInst.addEventListener('input', function (ev) {
        ensureStagedForIndex(sIdx);
        stagedRatings[currentProject][sIdx]._instructor = ev.target.value || '';
        saveProgress();
      });

      // toggle
      header.addEventListener('click', function () {
        if (body.style.display === 'none') { body.style.display = 'block'; header.textContent = studentName + ' ▴'; }
        else { body.style.display = 'none'; header.textContent = studentName + ' ▾'; }
      });

      panel.appendChild(body);
      commentWrapAll.appendChild(panel);
    });

    // Team panel (use students.length index)
    var teamIdx = students.length;
    ensureStagedForIndex(teamIdx);
    var teamPanel = document.createElement('div'); teamPanel.className = 'card comment-card'; teamPanel.style.padding = '12px'; teamPanel.style.marginBottom = '8px';
    var teamHeader = document.createElement('button'); teamHeader.type = 'button'; teamHeader.className = 'collapsible-toggle'; teamHeader.textContent = 'Team (group as a whole) ▾';
    teamHeader.style.fontWeight = '600'; teamHeader.style.width = '100%'; teamHeader.style.textAlign = 'left'; teamHeader.style.cursor = 'pointer'; teamHeader.style.border = 'none'; teamHeader.style.background = 'transparent';
    teamPanel.appendChild(teamHeader);

    var teamBody = document.createElement('div'); teamBody.className = 'comment-body collapsed'; teamBody.style.display = 'none'; teamBody.style.marginTop = '8px';

    var teamLblShared = document.createElement('label'); teamLblShared.textContent = 'Comments to be SHARED WITH THE STUDENT'; teamLblShared.style.display = 'block'; teamLblShared.style.fontWeight = '600';
    var teamTaShared = document.createElement('textarea'); teamTaShared.id = 'comment-shared-' + teamIdx; teamTaShared.className = 'comment-shared'; teamTaShared.rows = 4; teamTaShared.placeholder = 'Team comments that are shared with students.';
    teamTaShared.style.width = '100%'; teamTaShared.style.boxSizing = 'border-box'; teamTaShared.style.marginTop = '6px';
    teamTaShared.value = (stagedRatings[currentProject][teamIdx] && stagedRatings[currentProject][teamIdx]._shared) ? stagedRatings[currentProject][teamIdx]._shared : '';
    teamBody.appendChild(teamLblShared); teamBody.appendChild(teamTaShared);

    var teamLblInst = document.createElement('label'); teamLblInst.textContent = 'Comments to be SHARED ONLY WITH THE INSTRUCTOR'; teamLblInst.style.display = 'block'; teamLblInst.style.fontWeight = '600'; teamLblInst.style.marginTop = '8px';
    var teamTaInst = document.createElement('textarea'); teamTaInst.id = 'comment-inst-' + teamIdx; teamTaInst.className = 'comment-inst'; teamTaInst.rows = 4; teamTaInst.placeholder = 'Private comments for the instructor only (team).';
    teamTaInst.style.width = '100%'; teamTaInst.style.boxSizing = 'border-box'; teamTaInst.style.marginTop = '6px';
    teamTaInst.value = (stagedRatings[currentProject][teamIdx] && stagedRatings[currentProject][teamIdx]._instructor) ? stagedRatings[currentProject][teamIdx]._instructor : '';
    teamBody.appendChild(teamLblInst); teamBody.appendChild(teamTaInst);

    teamTaShared.addEventListener('input', function (ev) {
      stagedRatings[currentProject][teamIdx]._shared = ev.target.value || '';
      saveProgress();
    });
    teamTaInst.addEventListener('input', function (ev) {
      stagedRatings[currentProject][teamIdx]._instructor = ev.target.value || '';
      saveProgress();
    });

    teamHeader.addEventListener('click', function () {
      if (teamBody.style.display === 'none') { teamBody.style.display = 'block'; teamHeader.textContent = 'Team (group as a whole) ▴'; }
      else { teamBody.style.display = 'none'; teamHeader.textContent = 'Team (group as a whole) ▾'; }
    });

    teamPanel.appendChild(teamBody);
    commentWrapAll.appendChild(teamPanel);

    commentSec.appendChild(commentWrapAll);

    if (matrixContainer && matrixContainer.parentNode) {
      if (matrixContainer.nextSibling) matrixContainer.parentNode.insertBefore(commentSec, matrixContainer.nextSibling);
      else matrixContainer.parentNode.appendChild(commentSec);
    } else {
      document.body.appendChild(commentSec);
    }

    // tidy up remaining placeholders
    removeEmptyPlaceholderCards();

    // Attach event listeners (avoid duplicates)
    try {
      matrixContainer.removeEventListener && matrixContainer.removeEventListener('change', saveDraftHandler);
      matrixContainer.removeEventListener && matrixContainer.removeEventListener('input', saveDraftHandler);
    } catch (e) {}
    matrixContainer.addEventListener('change', saveDraftHandler);
    matrixContainer.addEventListener('input', saveDraftHandler);

    // Note: we no longer create a single #project-comment textarea; removed in favor of per-student panels.

    if (typeof updateSectionVisibility === 'function') updateSectionVisibility();
    if (typeof removeEmptySections === 'function') removeEmptySections();
  }

  // -------------------------
  // Draft saving handler (MODIFIED)
  // - now saves ratings per student index and also leaves per-student _shared/_instructor fields
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
      // capture per-student textareas if present (shared + instructor)
      var taShared = document.getElementById('comment-shared-' + s);
      if (taShared) stagedRatings[currentProject][s]._shared = taShared.value || '';
      var taInst = document.getElementById('comment-inst-' + s);
      if (taInst) stagedRatings[currentProject][s]._instructor = taInst.value || '';
    }

    // team index
    var teamIndex = students.length;
    if (!stagedRatings[currentProject][teamIndex]) stagedRatings[currentProject][teamIndex] = stagedRatings[currentProject][teamIndex] || {};
    for (var c2 = 0; c2 < RUBRIC.length; c2++) {
      var selT = document.querySelector('input[name="rating-' + c2 + '-' + teamIndex + '"]:checked');
      if (selT) stagedRatings[currentProject][teamIndex][c2] = parseInt(selT.value, 10);
    }
    var taTeamShared = document.getElementById('comment-shared-' + teamIndex);
    if (taTeamShared) stagedRatings[currentProject][teamIndex]._shared = taTeamShared.value || '';
    var taTeamInst = document.getElementById('comment-inst-' + teamIndex);
    if (taTeamInst) stagedRatings[currentProject][teamIndex]._instructor = taTeamInst.value || '';

    saveProgress();
  }

  // -------------------------
  // Submit current project (collect all criteria) (MODIFIED)
  // Now builds responses array with commentShared, commentInstructor, and isTeam for team row.
  // -------------------------
  function submitCurrentProject() {
    if (!currentProject) { setStatus('No project is loaded.', 'red'); return; }
    var students = sponsorProjects[currentProject] || [];
    if (!students.length) { setStatus('No students to submit.', 'red'); return; }

    var rows = [];
    // ensure stagedRatings exist
    if (!stagedRatings[currentProject]) stagedRatings[currentProject] = {};

    // iterate student indices 0..students.length-1
    for (var s = 0; s < students.length; s++) {
      var ratingsObj = {};
      for (var c = 0; c < RUBRIC.length; c++) {
        var val = (stagedRatings[currentProject][s] && stagedRatings[currentProject][s][c] !== undefined) ? stagedRatings[currentProject][s][c] : null;
        ratingsObj[RUBRIC[c].title] = val;
      }
      // pull shared/instructor comments if present
      var commentShared = (stagedRatings[currentProject][s] && stagedRatings[currentProject][s]._shared) ? stagedRatings[currentProject][s]._shared : '';
      var commentInstructor = (stagedRatings[currentProject][s] && stagedRatings[currentProject][s]._instructor) ? stagedRatings[currentProject][s]._instructor : '';
      rows.push({ student: students[s], ratings: ratingsObj, commentShared: commentShared, commentInstructor: commentInstructor, isTeam: "" });
    }

    // team row
    var teamIndex = students.length;
    var teamRatingsObj = {};
    for (var cc = 0; cc < RUBRIC.length; cc++) {
      var tv = (stagedRatings[currentProject][teamIndex] && stagedRatings[currentProject][teamIndex][cc] !== undefined) ? stagedRatings[currentProject][teamIndex][cc] : null;
      teamRatingsObj[RUBRIC[cc].title] = tv;
    }
    var teamCommentShared = (stagedRatings[currentProject][teamIndex] && stagedRatings[currentProject][teamIndex]._shared) ? stagedRatings[currentProject][teamIndex]._shared : '';
    var teamCommentInstructor = (stagedRatings[currentProject][teamIndex] && stagedRatings[currentProject][teamIndex]._instructor) ? stagedRatings[currentProject][teamIndex]._instructor : '';
    rows.push({ student: TEAM_KEY_LABEL, ratings: teamRatingsObj, commentShared: teamCommentShared, commentInstructor: teamCommentInstructor, isTeam: "TRUE" });

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
        var selector = 'li[data-project="' + CSS.escape(currentProject) + '"]';
        var li = projectListEl.querySelector(selector);
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

  // -------------------------
  // Secure data fetch (replaces CSV)
  // -------------------------
  function tryFetchData(callback) {
    var loaderUrl = DATA_LOADER_URL;
    if (DATA_SOURCE) {
      loaderUrl += (loaderUrl.indexOf('?') === -1 ? '?source=' + encodeURIComponent(DATA_SOURCE) : '&source=' + encodeURIComponent(DATA_SOURCE));
    }
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


// --- small UI fixes: hide first-page submit, inject footer, wrap project list if missing ---
document.addEventListener('DOMContentLoaded', function () {
  // Hide the "Submit ratings for project" button on the identity/intro page
  var allButtons = Array.from(document.querySelectorAll('button'));
  allButtons.forEach(function(btn){
    if (btn.textContent && btn.textContent.trim() === 'Submit ratings for project') {
      var identityStage = document.querySelector('[data-stage="identity"]') || document.querySelector('.stage-identity');
      if (identityStage && identityStage.contains(btn)) {
        btn.style.display = 'none';
      }
      // also attempt hiding if the btn is top-level but page is identity
      if (!identityStage) {
        // if your site uses a visible-stage class on body or similar, toggle here:
        if (document.body.classList.contains('stage-identity') || document.querySelector('.stage-identity')) {
          btn.style.display = 'none';
        }
      }
    }
  });

  // Inject persistent footer (if not present)
  if (!document.querySelector('.site-footer-fixed')) {
    var footer = document.createElement('div');
    footer.className = 'site-footer-fixed';
    footer.textContent = 'Built for your course. Data saved to Google Sheets.';
    document.body.appendChild(footer);
  }

  // Wrap project-list in a card if not already wrapped
  var projectList = document.getElementById('project-list');
  if (projectList && !projectList.closest('.project-list-card')) {
    var wrapper = document.createElement('section');
    wrapper.className = 'project-list-card';
    // Move the header if there's an h2 right before projectList
    var possibleHeading = projectList.previousElementSibling;
    if (possibleHeading && possibleHeading.tagName === 'H2') {
      wrapper.appendChild(possibleHeading);
    }
    projectList.parentNode.insertBefore(wrapper, projectList);
    wrapper.appendChild(projectList);
  }

  // Optional: add a bit more vertical space above the matrix container (if it exists)
  var rubricContainer = document.getElementById('rubric-container') || document.querySelector('.rubric-stage');
  if (rubricContainer) {
    rubricContainer.style.marginTop = rubricContainer.style.marginTop || '28px';
  }
});



