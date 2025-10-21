// Full corrected scripts.js - replace your existing file wholesale
(function () {
  'use strict';

  // --- Configuration (Cloudflare Workers endpoints) ---
  var ENDPOINT_URL = 'https://csehybridsponsors.sbecerr7.workers.dev/';  // POST submissions here
  var DATA_LOADER_URL = 'https://data-loader.sbecerr7.workers.dev/';    // HYBRID worker URL (reads hybrid sheet)
  var STORAGE_KEY = 'sponsor_progress_v1';

  // --- RUBRIC (5 items) ---
  var RUBRIC = [
    { title: "Effort", description: "Development effort should be balanced between all team members; student should commit to a fair amount of development effort on each sprint." },
    { title: "Meetings", description: "Students are expected to be proactive. Contributions and participation in meetings help ensure the student is aware of project goals." },
    { title: "Understanding", description: "Students are expected to understand important details of the project and be able to explain it from different stakeholder perspectives." },
    { title: "Quality", description: "Students should complete assigned work to a high quality: correct, documented, and self-explanatory where appropriate." },
    { title: "Communication", description: "Students are expected to be in regular communication and maintain professionalism when interacting with the sponsor." }
  ];

  // --- DOM nodes (cached) ---
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
  var stagedRatings = {}; // structured: stagedRatings[project][studentIndex][criterionIndex] etc.

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

  // build sponsor map (simple loader mapping - keep robust)
  function buildSponsorMap(rows) {
    var map = {};
    if (!Array.isArray(rows)) return map;
    rows.forEach(function (r) {
      var email = (r.sponsorEmail || r.email || r.SponsorEmail || r.emailAddress || '').toString().toLowerCase().trim();
      var project = (r.project || r.Project || r['Project Name'] || '').toString().trim();
      var student = (r.student || r.Student || r['Student Name'] || '').toString().trim();
      if (!email || !project || !student) return;
      if (!map[email]) map[email] = { projects: {} };
      if (!map[email].projects[project]) map[email].projects[project] = [];
      if (map[email].projects[project].indexOf(student) === -1) map[email].projects[project].push(student);
    });
    return map;
  }

  // local progress save/load
  function saveProgress() {
    var payload = { name: currentName, email: currentEmail, completedProjects: completedProjects, stagedRatings: stagedRatings };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch (e) { /* ignore */ }
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
    } catch (e) { /* ignore */ }
  }

  // remove empty placeholder cards left behind by generators
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

    removeEmptyPlaceholderCards();
    setStatus('');
  }

  // -------------------------
  // Matrix + comments renderer
  // -------------------------
  function loadProjectIntoMatrix(projectName, students) {
    currentProject = projectName || '';

    if (!matrixContainer) return;

    // Remove any previously injected matrix-info / header left behind (ensures only current title)
    var previousHeaders = Array.from(document.querySelectorAll('.current-project-header'));
    previousHeaders.forEach(function(h){ if (h && h.parentNode) h.parentNode.removeChild(h); });

    // Remove any old matrix-info wrapper (id=matrix-info)
    var oldInfo = document.getElementById('matrix-info');
    if (oldInfo && oldInfo.parentNode) oldInfo.parentNode.removeChild(oldInfo);

    // Clear container and remove old comment section
    matrixContainer.innerHTML = '';
    var oldComment = document.querySelector('.section.section-comment');
    if (oldComment && oldComment.parentNode) oldComment.parentNode.removeChild(oldComment);

    // Ensure list of students includes final "Evaluating group as a whole" row (if not present, append)
    var studentsCopy = (students || []).slice();
    var groupLabel = 'Evaluating group as a whole';
    var hasGroupRow = studentsCopy.some(function(s){ return (s||'').toString().toLowerCase().indexOf('evaluating group') !== -1; });
    if (!hasGroupRow) studentsCopy.push(groupLabel);

    // Create matrix-info header
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

    if (!studentsCopy || !studentsCopy.length) {
      matrixContainer.textContent = 'No students found for this project.';
      return;
    }

    // restore staged ratings structure if not present
    if (!stagedRatings[currentProject]) stagedRatings[currentProject] = {};

    // Build a stacked card per rubric criterion
    studentsCopy.forEach(function(s){ /* ensure indexing stable */ });

    RUBRIC.forEach(function (crit, cIdx) {
      var card = document.createElement('div');
      card.className = 'card matrix-card';
      card.style.marginBottom = '20px';
      card.style.padding = card.style.padding || '18px';

      var critWrap = document.createElement('div'); critWrap.className = 'matrix-criterion';

      var critTitle = document.createElement('h4'); critTitle.className = 'matrix-criterion-title';
      critTitle.textContent = (cIdx + 1) + '. ' + (crit.title || '');
      critTitle.style.margin = '0 0 8px 0'; critTitle.style.fontWeight = '600';
      critWrap.appendChild(critTitle);

      var critDesc = document.createElement('div'); critDesc.className = 'matrix-criterion-desc';
      critDesc.textContent = crit.description || ''; critDesc.style.display = 'block'; critDesc.style.color = '#0b1228';
      critDesc.style.fontWeight = '400'; critDesc.style.fontSize = '14px'; critDesc.style.lineHeight = '1.3'; critDesc.style.margin = '0 0 12px 0';
      critWrap.appendChild(critDesc);

      // table
      var table = document.createElement('table');
      table.className = 'matrix-table';
      table.style.width = '100%';
      table.style.borderCollapse = 'collapse';
      table.style.tableLayout = 'fixed';

      var thead = document.createElement('thead');
      var trHead = document.createElement('tr');

      // Student header
      var thName = document.createElement('th');
      thName.textContent = 'Student';
      thName.style.textAlign = 'left';
      thName.style.padding = '8px';
      trHead.appendChild(thName);

      // descriptor left (Far Below)
      var thFar = document.createElement('th');
      thFar.textContent = 'Far Below\nExpectations\n(Fail)';
      thFar.style.whiteSpace = 'normal';
      thFar.style.padding = '8px';
      thFar.style.textAlign = 'center';
      thFar.className = 'col-descriptor';
      trHead.appendChild(thFar);

      // numeric headers 1..7
      for (var k = 1; k <= 7; k++) {
        var th = document.createElement('th');
        th.textContent = String(k);
        th.style.padding = '8px';
        th.style.textAlign = 'center';
        th.className = 'col-scale';
        trHead.appendChild(th);
      }

      var thEx = document.createElement('th');
      thEx.textContent = 'Exceeds\nExpectations\n(A+)';
      thEx.style.whiteSpace = 'normal';
      thEx.style.padding = '8px';
      thEx.style.textAlign = 'center';
      thEx.className = 'col-descriptor';
      trHead.appendChild(thEx);

      thead.appendChild(trHead);
      table.appendChild(thead);

      var tbody = document.createElement('tbody');

      studentsCopy.forEach(function (studentName, sIdx) {
        var tr = document.createElement('tr');

        // Student name
        var tdName = document.createElement('td');
        tdName.textContent = studentName;
        tdName.style.padding = '12px 18px';
        tdName.style.verticalAlign = 'middle';
        tdName.style.fontWeight = (studentName && studentName.toLowerCase().indexOf('evaluating group') !== -1) ? '600' : '600';
        tr.appendChild(tdName);

        // left descriptor cell (no radios)
        var tdLeft = document.createElement('td');
        tdLeft.className = 'col-descriptor';
        tdLeft.style.padding = '8px';
        tr.appendChild(tdLeft);

        // radio cells (1..7)
        for (var score = 1; score <= 7; score++) {
          var td = document.createElement('td');
          td.style.textAlign = 'center';
          td.style.padding = '8px';

          var input = document.createElement('input');
          input.type = 'radio';
          input.name = 'rating-' + cIdx + '-' + sIdx;
          input.value = String(score);
          input.id = 'rating-' + cIdx + '-' + sIdx + '-' + score;

          var stagedForProject = stagedRatings[currentProject] || {};
          var stagedForStudent = stagedForProject[sIdx] || {};
          if (stagedForStudent && stagedForStudent[cIdx] && String(stagedForStudent[cIdx]) === String(score)) {
            input.checked = true;
          }

          var label = document.createElement('label');
          label.setAttribute('for', input.id);
          label.style.cursor = 'pointer';
          label.style.display = 'inline-block';
          label.style.padding = '2px';
          label.appendChild(input);

          // Do not show radios for the left descriptor column; we already left that empty above
          td.appendChild(label);
          tr.appendChild(td);
        }

        // right descriptor cell (no radios)
        var tdRight = document.createElement('td');
        tdRight.className = 'col-descriptor';
        tdRight.style.padding = '8px';
        tr.appendChild(tdRight);

        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      critWrap.appendChild(table);
      card.appendChild(critWrap);
      matrixContainer.appendChild(card);
    });

    // Render the comment panels (per-student collapsible + group panel)
    renderCommentPanels(projectName, studentsCopy);

    // Replace matrixContainer events safely (prevent double-listeners)
    (function attachListeners(){
      try {
        matrixContainer.removeEventListener && matrixContainer.removeEventListener('change', saveDraftHandler);
        matrixContainer.removeEventListener && matrixContainer.removeEventListener('input', saveDraftHandler);
      } catch (e) {}
      matrixContainer.addEventListener('change', saveDraftHandler);
      matrixContainer.addEventListener('input', saveDraftHandler);

      var groupPub = document.getElementById('comment-group-public');
      var groupPriv = document.getElementById('comment-group-private');
      var projectTA = document.getElementById('project-comment');

      if (groupPub) groupPub.removeEventListener && groupPub.removeEventListener('input', saveDraftHandler);
      if (groupPriv) groupPriv.removeEventListener && groupPriv.removeEventListener('input', saveDraftHandler);
      if (projectTA) projectTA.removeEventListener && projectTA.removeEventListener('input', saveDraftHandler);

      if (groupPub) groupPub.addEventListener('input', saveDraftHandler);
      if (groupPriv) groupPriv.addEventListener('input', saveDraftHandler);
      if (projectTA) projectTA.addEventListener('input', saveDraftHandler);
    })();

    if (typeof updateSectionVisibility === 'function') updateSectionVisibility();
    if (typeof removeEmptySections === 'function') removeEmptySections();

    // ensure accessibility focus
    var firstRadio = matrixContainer.querySelector('input[type="radio"]');
    if (firstRadio) firstRadio.setAttribute('aria-label', 'rating option');
  }

  // Render per-student collapsible comment panels and a group panel below the matrix
  function renderCommentPanels(projectName, students) {
    // base remove any existing
    var existing = document.querySelector('.section.section-comment');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    var commentSec = document.createElement('div');
    commentSec.className = 'section section-comment';
    commentSec.style.marginTop = '12px';

    var header = document.createElement('h3');
    header.textContent = 'Add your additional comments';
    header.className = 'section-title';
    header.style.margin = '0 0 12px 0';
    commentSec.appendChild(header);

    // helper to build each student panel
    function buildStudentPanel(name, idx) {
      var wrapper = document.createElement('div');
      wrapper.className = 'student-comment-panel';
      wrapper.style.border = '1px solid rgba(10,12,30,0.05)';
      wrapper.style.borderRadius = '8px';
      wrapper.style.padding = '10px';
      wrapper.style.marginBottom = '10px';
      wrapper.style.background = '#fff';

      var headerRow = document.createElement('div');
      headerRow.style.display = 'flex';
      headerRow.style.justifyContent = 'space-between';
      headerRow.style.alignItems = 'center';
      headerRow.style.marginBottom = '8px';

      var nameEl = document.createElement('div');
      nameEl.textContent = name;
      nameEl.style.fontWeight = '600';
      headerRow.appendChild(nameEl);

      var toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'btn btn-mini comment-toggle';
      toggleBtn.textContent = '▾ Add comment';
      toggleBtn.style.fontSize = '0.9rem';
      toggleBtn.style.padding = '6px 8px';
      toggleBtn.style.cursor = 'pointer';
      toggleBtn.style.background = 'white';
      toggleBtn.style.border = '1px solid rgba(10,12,30,0.06)';
      toggleBtn.style.borderRadius = '6px';
      headerRow.appendChild(toggleBtn);

      wrapper.appendChild(headerRow);

      var content = document.createElement('div');
      content.className = 'student-comment-content';
      content.style.display = 'none';

      var lblPublic = document.createElement('div');
      lblPublic.textContent = 'Comments to be SHARED WITH THE STUDENT';
      lblPublic.style.margin = '6px 0 4px 0';
      content.appendChild(lblPublic);

      var taPublic = document.createElement('textarea');
      taPublic.id = 'comment-public-' + idx;
      taPublic.placeholder = 'Comments to share with student';
      taPublic.style.width = '100%';
      taPublic.style.minHeight = '60px';
      taPublic.style.padding = '8px';
      taPublic.style.boxSizing = 'border-box';
      taPublic.style.marginBottom = '8px';
      content.appendChild(taPublic);

      var lblPrivate = document.createElement('div');
      lblPrivate.textContent = 'Comments to be SHARED ONLY WITH THE INSTRUCTOR';
      lblPrivate.style.margin = '6px 0 4px 0';
      content.appendChild(lblPrivate);

      var taPrivate = document.createElement('textarea');
      taPrivate.id = 'comment-private-' + idx;
      taPrivate.placeholder = 'Private comments for instructor';
      taPrivate.style.width = '100%';
      taPrivate.style.minHeight = '60px';
      taPrivate.style.padding = '8px';
      taPrivate.style.boxSizing = 'border-box';
      content.appendChild(taPrivate);

      wrapper.appendChild(content);

      toggleBtn.addEventListener('click', function () {
        if (content.style.display === 'none') {
          content.style.display = 'block';
          toggleBtn.textContent = '▴ Hide comment';
        } else {
          content.style.display = 'none';
          toggleBtn.textContent = '▾ Add comment';
        }
      });

      // prefill from stagedRatings if present
      var staged = stagedRatings[projectName] && stagedRatings[projectName]._studentComments;
      if (staged && staged[name]) {
        if (staged[name].public) taPublic.value = staged[name].public;
        if (staged[name].private) taPrivate.value = staged[name].private;
        if ((staged[name].public && staged[name].public.length) || (staged[name].private && staged[name].private.length)) {
          content.style.display = 'block';
          toggleBtn.textContent = '▴ Hide comment';
        }
      }

      return wrapper;
    }

    // Add a panel for each student (including the Evaluating group as row)
    for (var si = 0; si < (students || []).length; si++) {
      var name = students[si];
      var p = buildStudentPanel(name, si);
      commentSec.appendChild(p);
    }

    // Group-level panel
    var groupWrap = document.createElement('div');
    groupWrap.className = 'student-comment-panel';
    groupWrap.style.border = '1px solid rgba(10,12,30,0.05)';
    groupWrap.style.borderRadius = '8px';
    groupWrap.style.padding = '10px';
    groupWrap.style.marginBottom = '10px';
    groupWrap.style.background = '#fff';

    var groupHd = document.createElement('div');
    groupHd.style.display = 'flex';
    groupHd.style.justifyContent = 'space-between';
    groupHd.style.alignItems = 'center';
    groupHd.style.marginBottom = '8px';

    var groupTitle = document.createElement('div');
    groupTitle.textContent = 'Comments for Evaluating group as a whole';
    groupTitle.style.fontWeight = '600';
    groupHd.appendChild(groupTitle);

    var groupToggle = document.createElement('button');
    groupToggle.type = 'button';
    groupToggle.className = 'btn btn-mini comment-toggle';
    groupToggle.textContent = '▾ Add comment';
    groupToggle.style.fontSize = '0.9rem';
    groupToggle.style.padding = '6px 8px';
    groupToggle.style.cursor = 'pointer';
    groupToggle.style.background = 'white';
    groupToggle.style.border = '1px solid rgba(10,12,30,0.06)';
    groupToggle.style.borderRadius = '6px';
    groupHd.appendChild(groupToggle);
    groupWrap.appendChild(groupHd);

    var groupContent = document.createElement('div');
    groupContent.style.display = 'none';

    var gpLbl = document.createElement('div');
    gpLbl.textContent = 'Comments for Evaluating group as a whole (shared with student by default)';
    gpLbl.style.margin = '6px 0';
    groupContent.appendChild(gpLbl);

    var taGroupPublic = document.createElement('textarea');
    taGroupPublic.id = 'comment-group-public';
    taGroupPublic.placeholder = 'Comments for evaluating group as a whole';
    taGroupPublic.style.width = '100%';
    taGroupPublic.style.minHeight = '80px';
    taGroupPublic.style.padding = '8px';
    taGroupPublic.style.boxSizing = 'border-box';
    groupContent.appendChild(taGroupPublic);

    var gpLblPrivate = document.createElement('div');
    gpLblPrivate.textContent = 'Private comments about the group (instructor only)';
    gpLblPrivate.style.margin = '8px 0 4px 0';
    groupContent.appendChild(gpLblPrivate);

    var taGroupPrivate = document.createElement('textarea');
    taGroupPrivate.id = 'comment-group-private';
    taGroupPrivate.placeholder = 'Private comments for instructor about the group';
    taGroupPrivate.style.width = '100%';
    taGroupPrivate.style.minHeight = '60px';
    taGroupPrivate.style.padding = '8px';
    taGroupPrivate.style.boxSizing = 'border-box';
    groupContent.appendChild(taGroupPrivate);

    groupWrap.appendChild(groupContent);
    groupToggle.addEventListener('click', function () {
      if (groupContent.style.display === 'none') {
        groupContent.style.display = 'block';
        groupToggle.textContent = '▴ Hide comment';
      } else {
        groupContent.style.display = 'none';
        groupToggle.textContent = '▾ Add comment';
      }
    });

    // restore staged group comments if present
    var stagedGroup = (stagedRatings[currentProject] && stagedRatings[currentProject]._groupComments) || {};
    if (stagedGroup) {
      if (stagedGroup.public) taGroupPublic.value = stagedGroup.public;
      if (stagedGroup.private) taGroupPrivate.value = stagedGroup.private;
      if ((stagedGroup.public && stagedGroup.public.length) || (stagedGroup.private && stagedGroup.private.length)) {
        groupContent.style.display = 'block';
        groupToggle.textContent = '▴ Hide comment';
      }
    }

    commentSec.appendChild(groupWrap);

    // Also keep the legacy project-comment textarea for compatibility/backwards saving
    var legacyWrap = document.createElement('div');
    legacyWrap.className = 'project-comment-wrap';
    legacyWrap.style.marginTop = '12px';
    var legacyLabel = document.createElement('label');
    legacyLabel.setAttribute('for', 'project-comment');
    legacyLabel.textContent = 'Optional project comment (legacy)';
    legacyLabel.style.display = 'block';
    legacyLabel.style.marginBottom = '6px';
    var legacyTA = document.createElement('textarea');
    legacyTA.id = 'project-comment';
    legacyTA.placeholder = 'Any additional feedback for the students or instructor...';
    legacyTA.style.width = '100%';
    legacyTA.style.minHeight = '80px';
    legacyTA.style.padding = '8px';
    legacyWrap.appendChild(legacyLabel);
    legacyWrap.appendChild(legacyTA);

    // restore legacy comment if present
    var stagedLegacy = stagedRatings[currentProject] && stagedRatings[currentProject]._comment;
    if (stagedLegacy) legacyTA.value = stagedLegacy;

    commentSec.appendChild(legacyWrap);

    // attach below matrixContainer
    if (matrixContainer && matrixContainer.parentNode) {
      if (matrixContainer.nextSibling) matrixContainer.parentNode.insertBefore(commentSec, matrixContainer.nextSibling);
      else matrixContainer.parentNode.appendChild(commentSec);
    } else {
      document.body.appendChild(commentSec);
    }
  }

  // -------------------------
  // Draft saving handler
  // -------------------------
  function saveDraftHandler() {
    if (!currentProject) return;
    if (!stagedRatings[currentProject]) stagedRatings[currentProject] = {};

    var students = sponsorProjects[currentProject] || [];
    // we included an extra group row in the UI; stagedRatings index must align with displayed rows
    // We'll iterate through displayed rows (based on DOM) for correctness
    var tableRows = Array.from(document.querySelectorAll('.matrix-table tbody tr'));
    tableRows.forEach(function (tr, sIdx) {
      if (!stagedRatings[currentProject][sIdx]) stagedRatings[currentProject][sIdx] = {};
      for (var c = 0; c < RUBRIC.length; c++) {
        var sel = document.querySelector('input[name="rating-' + c + '-' + sIdx + '"]:checked');
        if (sel) stagedRatings[currentProject][sIdx][c] = parseInt(sel.value, 10);
        else delete stagedRatings[currentProject][sIdx][c];
      }
    });

    // per-student comment capture
    if (!stagedRatings[currentProject]._studentComments) stagedRatings[currentProject]._studentComments = stagedRatings[currentProject]._studentComments || {};
    tableRows.forEach(function (tr, sIdx) {
      var nameCell = tr.querySelector('td');
      var studentName = nameCell ? nameCell.textContent.trim() : ('student-' + sIdx);
      var pub = document.getElementById('comment-public-' + sIdx);
      var priv = document.getElementById('comment-private-' + sIdx);
      if (!stagedRatings[currentProject]._studentComments[studentName]) stagedRatings[currentProject]._studentComments[studentName] = { public: '', private: '' };
      if (pub) stagedRatings[currentProject]._studentComments[studentName].public = pub.value || '';
      if (priv) stagedRatings[currentProject]._studentComments[studentName].private = priv.value || '';
    });

    // group comments
    if (!stagedRatings[currentProject]._groupComments) stagedRatings[currentProject]._groupComments = { public: '', private: '' };
    var gpPub = document.getElementById('comment-group-public');
    var gpPriv = document.getElementById('comment-group-private');
    if (gpPub) stagedRatings[currentProject]._groupComments.public = gpPub.value || '';
    if (gpPriv) stagedRatings[currentProject]._groupComments.private = gpPriv.value || '';

    // legacy project comment
    var legacy = document.getElementById('project-comment');
    if (legacy) stagedRatings[currentProject]._comment = legacy.value || '';

    saveProgress();
  }

  // -------------------------
  // Submit current project (collect all criteria and comments)
  // -------------------------
  function submitCurrentProject() {
    if (!currentProject) { setStatus('No project is loaded.', 'red'); return; }
    var students = sponsorProjects[currentProject] || [];
    // gather rows from displayed table (ensures correct indexing)
    var tableRows = Array.from(document.querySelectorAll('.matrix-table tbody tr'));
    if (!tableRows.length) { setStatus('No students to submit.', 'red'); return; }

    var responses = [];

    // per-row (student or "Evaluating group as a whole") responses
    tableRows.forEach(function (tr, sIdx) {
      var nameCell = tr.querySelector('td');
      var studentName = nameCell ? nameCell.textContent.trim() : ('student-' + sIdx);

      var ratingsObj = {};
      for (var c = 0; c < RUBRIC.length; c++) {
        var sel = document.querySelector('input[name="rating-' + c + '-' + sIdx + '"]:checked');
        ratingsObj[RUBRIC[c].title] = sel ? parseInt(sel.value, 10) : null;
      }

      // per-student staged comments
      var pubEl = document.getElementById('comment-public-' + sIdx);
      var privEl = document.getElementById('comment-private-' + sIdx);
      var commentShared = (pubEl && pubEl.value) ? pubEl.value : '';
      var commentInstructor = (privEl && privEl.value) ? privEl.value : '';

      // group detection: if it's the group row or the name text matches
      var isTeam = /evaluating\s+group/i.test(studentName);

      // include this row if any rating present OR if any comments present OR if it's the team row (we want a team row to be submitted)
      var anyRating = Object.keys(ratingsObj).some(function (k) { return ratingsObj[k] !== null && ratingsObj[k] !== ''; });
      if (anyRating || commentShared || commentInstructor || isTeam) {
        responses.push({
          student: studentName,
          ratings: ratingsObj,
          commentShared: commentShared,
          commentInstructor: commentInstructor,
          isTeam: isTeam
        });
      }
    });

    // ALSO ensure group-level panel comment is included as a separate row IF it wasn't already represented above
    var gpPub = document.getElementById('comment-group-public');
    var gpPriv = document.getElementById('comment-group-private');
    var gpPublicVal = gpPub ? gpPub.value.trim() : '';
    var gpPrivateVal = gpPriv ? gpPriv.value.trim() : '';

    var groupAlready = responses.some(function (r) { return /evaluating\s+group/i.test((r.student||'').toString()); });
    if ((gpPublicVal || gpPrivateVal) && !groupAlready) {
      // include a dedicated team row
      var emptyRatings = {};
      RUBRIC.forEach(function (r) { emptyRatings[r.title] = null; });
      responses.push({
        student: 'Evaluating group as a whole',
        ratings: emptyRatings,
        commentShared: gpPublicVal || '',
        commentInstructor: gpPrivateVal || '',
        isTeam: true
      });
    }

    if (!responses.length) {
      setStatus('Please rate at least one student or provide a group comment.', 'red');
      return;
    }

    // Build payload
    var payload = {
      sponsorName: currentName || (nameInput ? nameInput.value.trim() : ''),
      sponsorEmail: currentEmail || (emailInput ? emailInput.value.trim() : ''),
      project: currentProject,
      rubric: RUBRIC.map(function (r) { return r.title; }),
      responses: responses,
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

      // mark completed and clear staged rating for that project
      completedProjects[currentProject] = true;
      if (stagedRatings && stagedRatings[currentProject]) delete stagedRatings[currentProject];
      saveProgress();

      // update project list UI
      if (projectListEl) {
        var li = projectListEl.querySelector('li[data-project="' + CSS.escape(currentProject) + '"]');
        if (li) {
          li.classList.add('completed');
          li.classList.remove('active');
          li.innerHTML = '<strong>' + escapeHtml(currentProject) + '</strong> <span class="meta">(completed)</span>';
        }
      }

      // remove matrix and comment blocks and current header
      if (matrixContainer) matrixContainer.innerHTML = '';
      var commentSection = document.querySelector('.section.section-comment');
      if (commentSection && commentSection.parentNode) commentSection.parentNode.removeChild(commentSection);

      var headerEl = document.querySelector('.current-project-header');
      if (headerEl && headerEl.parentNode) headerEl.parentNode.removeChild(headerEl);

      var matrixInfoBlock = document.getElementById('matrix-info');
      if (matrixInfoBlock && matrixInfoBlock.parentNode) matrixInfoBlock.parentNode.removeChild(matrixInfoBlock);

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
  // Events / wiring
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
    if (commentSection && commentSection.parentNode) commentSection.parentNode.removeChild(commentSection);
    showIdentityStage();
  });

  // -------------------------
  // Stage helpers
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
  // Data fetch
  // -------------------------
  function tryFetchData(callback) {
    var loaderUrl = DATA_LOADER_URL;
    fetch(loaderUrl, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('Data loader returned ' + r.status);
        return r.json();
      })
      .then(function (rows) {
        sponsorData = buildSponsorMap(rows || []);
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

  // debug helper
  window.__sponsorDebug = {
    sponsorData: sponsorData,
    stagedRatings: stagedRatings,
    completedProjects: completedProjects,
    reloadData: function (cb) { tryFetchData(cb); }
  };

  window.__submitCurrentProject = submitCurrentProject;

})();




