// scripts.js - full replacement
// Sponsor hybrid site script (ready to drop in).
(function () {
  'use strict';

  // CONFIG
  var ENDPOINT_URL = 'https://csehybridsponsors.sbecerr7.workers.dev/';
  var DATA_LOADER_URL = 'https://data-loader.sbecerr7.workers.dev/';
  var STORAGE_KEY = 'sponsor_progress_v1';

  // Rubric titles & descriptions (used to build matrix)
  var RUBRIC = [
    { title: "Effort", description: "Development effort should be balanced between all team members; student should commit to a fair amount of development effort on each sprint." },
    { title: "Meetings", description: "Students are expected to be proactive. Contributions and participation in meetings help ensure the student is aware of project goals." },
    { title: "Understanding", description: "Students are expected to understand important details of the project and be able to explain it from different stakeholder perspectives." },
    { title: "Quality", description: "Students should complete assigned work to a high quality: correct, documented, and self-explanatory where appropriate." },
    { title: "Communication", description: "Students are expected to be in regular communication and maintain professionalism when interacting with the sponsor." }
  ];

  // DOM references (expected to exist in your HTML)
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

  // State
  var sponsorData = {};
  var sponsorProjects = {};
  var currentEmail = '';
  var currentName = '';
  var currentProject = '';
  var completedProjects = {};
  var stagedRatings = {};

  // Helpers
  function setStatus(msg, color) {
    if (!formStatus) return;
    formStatus.textContent = msg || '';
    formStatus.style.color = color || '';
  }
  function escapeHtml(s) {
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(s || '').replace(/[&<>"']/g, function (m) { return map[m]; });
  }

  // Remove empty placeholder cards (defensive)
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

  // Build sponsor map from data-loader rows (robust)
  function buildSponsorMap(rows) {
    var map = {};
    if (!Array.isArray(rows) || rows.length === 0) return map;
    var emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    function cleanToken(tok) {
      if (!tok) return '';
      tok = tok.replace(/^[\s"'`([{]+|[\s"'`)\]}.,:;]+$/g, '').replace(/\u00A0/g, ' ').trim();
      if (tok.indexOf('@') !== -1 && tok.indexOf(' ') !== -1) tok = tok.split(' ').join('');
      return tok;
    }
    rows.forEach(function (rawRow) {
      var project = '', student = '', sponsorCell = '';
      Object.keys(rawRow || {}).forEach(function (rawKey) {
        var keyNorm = String(rawKey || '').trim().toLowerCase();
        var rawVal = (rawRow[rawKey] || '').toString();
        var val = rawVal.replace(/\u00A0/g, ' ').trim();
        if (!project && (keyNorm === 'project' || keyNorm === 'project name' || keyNorm === 'project_title' || keyNorm === 'group_name' || keyNorm === 'projectname')) project = val;
        else if (!student && (keyNorm === 'student' || keyNorm === 'student name' || keyNorm === 'students' || keyNorm === 'name' || keyNorm === 'student_name')) student = val;
        else if (!sponsorCell && (keyNorm === 'sponsoremail' || keyNorm === 'sponsor email' || keyNorm === 'sponsor' || keyNorm === 'email' || keyNorm === 'login_id' || keyNorm === 'sponsor_email')) sponsorCell = val;
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
      var tokens = sponsorCell.split(/[,;\/|]+/);
      var foundEmails = [];
      tokens.forEach(function (t) {
        var cleaned = cleanToken(t);
        if (!cleaned) return;
        var m = cleaned.match(emailRegex);
        if (m && m.length) { m.forEach(function (em) { foundEmails.push(em.toLowerCase().trim()); }); return; }
        var m2 = t.match(emailRegex);
        if (m2 && m2.length) { m2.forEach(function (em) { foundEmails.push(em.toLowerCase().trim()); }); return; }
        if (t.indexOf('@') !== -1) {
          var nospace = t.replace(/\s+/g, '');
          var m3 = nospace.match(emailRegex);
          if (m3 && m3.length) m3.forEach(function (em) { foundEmails.push(em.toLowerCase().trim()); });
        }
      });
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
        if (map[email].projects[project].indexOf(student) === -1) map[email].projects[project].push(student);
      });
    });
    return map;
  }

  // Save / load progress
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
      }
    } catch (e) { console.warn('Could not load progress', e); }
  }

  // Populate list of projects for the sponsor email
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
        currentProject = p;
        loadProjectIntoMatrix(p, entry.projects[p]);
        setStatus('');
      });
      projectListEl.appendChild(li);
      sponsorProjects[p] = entry.projects[p].slice();
    });
    removeEmptyPlaceholderCards();
    setStatus('');
  }

  // Build matrix + comments for a project
  function loadProjectIntoMatrix(projectName, students) {
    if (!projectName) return;
    currentProject = projectName;

    // remove previous matrix-info/header if present
    var existingInfo = document.getElementById('matrix-info');
    if (existingInfo && existingInfo.parentNode) existingInfo.parentNode.removeChild(existingInfo);
    var oldHdrs = Array.prototype.slice.call(document.querySelectorAll('.current-project-header'));
    oldHdrs.forEach(function (h) { if (h && h.parentNode) h.parentNode.removeChild(h); });

    // remove any old comment section first
    var oldComment = document.querySelector('.section.section-comment');
    if (oldComment && oldComment.parentNode) oldComment.parentNode.removeChild(oldComment);

    // header/info above matrix
    var info = document.createElement('div');
    info.id = 'matrix-info';
    var hdr = document.createElement('div'); hdr.className = 'current-project-header'; hdr.textContent = projectName || '';
    hdr.style.display = 'block'; hdr.style.marginBottom = '6px'; hdr.style.fontWeight = '600';
    var topDesc = document.createElement('div'); topDesc.className = 'matrix-info-desc';
    topDesc.textContent = 'Please evaluate the students using the rubric below (scale 1–7).';
    topDesc.style.display = 'block'; topDesc.style.color = '#0b1228'; topDesc.style.fontWeight = '400';
    topDesc.style.fontSize = '14px'; topDesc.style.marginBottom = '12px';
    info.appendChild(hdr); info.appendChild(topDesc);
    if (matrixContainer && matrixContainer.parentNode) matrixContainer.parentNode.insertBefore(info, matrixContainer);
    else if (matrixContainer) document.body.insertBefore(info, matrixContainer);

    if (!students || !students.length) {
      if (matrixContainer) matrixContainer.textContent = 'No students found for this project.';
      return;
    }

    // prepare stagedRatings for this project
    if (!stagedRatings[currentProject]) stagedRatings[currentProject] = {};

    // build matrix cards
    var tempContainer = document.createElement('div');
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
      var table = document.createElement('table'); table.className = 'matrix-table';
      table.style.width = '100%'; table.style.borderCollapse = 'collapse';

      // thead
      var thead = document.createElement('thead'); var trHead = document.createElement('tr');
      var thName = document.createElement('th'); thName.textContent = 'Student'; thName.style.textAlign = 'left'; thName.style.padding = '8px';
      trHead.appendChild(thName);

      // ----------------------
// REPLACE the existing header-building block with this:
// ----------------------

// left descriptor (no radios)
var thLeftDesc = document.createElement('th');
thLeftDesc.className = 'header-descriptor';
/* Use innerHTML with a <div> so we can control wrapping visually.
   The content will wrap naturally according to CSS max-width. */
thLeftDesc.innerHTML = '<div class="hd-line">Far Below Expectations</div><div class="hd-sub">(Fail)</div>';
thLeftDesc.style.textAlign = 'center';
thLeftDesc.style.padding = '8px';
trHead.appendChild(thLeftDesc);

// numeric headers 1..7
for (var k = 1; k <= 7; k++) {
  var th = document.createElement('th');
  th.textContent = String(k);
  th.style.padding = '8px';
  th.style.textAlign = 'center';
  trHead.appendChild(th);
}

// right descriptor
var thRightDesc = document.createElement('th');
thRightDesc.className = 'header-descriptor';
thRightDesc.innerHTML = '<div class="hd-line">Exceeds Expectations</div><div class="hd-sub">(A+)</div>';
thRightDesc.style.textAlign = 'center';
thRightDesc.style.padding = '8px';
trHead.appendChild(thRightDesc);

thead.appendChild(trHead);
table.appendChild(thead);


      // tbody - student rows
      var tbody = document.createElement('tbody');
      students.forEach(function (studentName, sIdx) {
        var tr = document.createElement('tr');
        var tdName = document.createElement('td'); tdName.textContent = studentName; tdName.style.padding = '8px 10px'; tdName.style.verticalAlign = 'middle'; tdName.style.textAlign = 'left';
        tr.appendChild(tdName);

        // left descriptor cell (empty; no radios)
        var tdLeft = document.createElement('td'); tdLeft.className = 'col-descriptor'; tdLeft.style.padding = '8px';
        tr.appendChild(tdLeft);

        // radio cells (1..7)
        for (var score = 1; score <= 7; score++) {
          var td = document.createElement('td'); td.style.textAlign = 'center'; td.style.padding = '8px';
          var input = document.createElement('input'); input.type = 'radio';
          input.name = 'rating-' + cIdx + '-' + sIdx; input.value = String(score);
          input.id = 'rating-' + cIdx + '-' + sIdx + '-' + score;
          var stagedForProject = stagedRatings[currentProject] || {};
          var stagedForStudent = stagedForProject[sIdx] || {};
          if (stagedForStudent[cIdx] && String(stagedForStudent[cIdx]) === String(score)) input.checked = true;
          var label = document.createElement('label'); label.setAttribute('for', input.id); label.style.cursor = 'pointer'; label.style.display = 'inline-block'; label.style.padding = '2px';
          label.appendChild(input); td.appendChild(label); tr.appendChild(td);
        }

        var tdRight = document.createElement('td'); tdRight.className = 'col-descriptor'; tdRight.style.padding = '8px'; tr.appendChild(tdRight);
        tbody.appendChild(tr);
      });

      // Add final 'Evaluating group as a whole' row (team evaluation row)
      var trTeam = document.createElement('tr');
      var tdTeamName = document.createElement('td'); tdTeamName.textContent = 'Evaluating group as a whole'; tdTeamName.style.padding = '8px 10px'; tdTeamName.style.verticalAlign = 'middle'; tdTeamName.style.textAlign = 'left';
      trTeam.appendChild(tdTeamName);
      var tdTeamLeft = document.createElement('td'); tdTeamLeft.className = 'col-descriptor'; tdTeamLeft.style.padding = '8px'; trTeam.appendChild(tdTeamLeft);
      for (var sScore = 1; sScore <= 7; sScore++) {
        var tdT = document.createElement('td'); tdT.style.textAlign = 'center'; tdT.style.padding = '8px';
        var inputT = document.createElement('input'); inputT.type = 'radio';
        // name uses 'team' sentinel so saveDraftHandler can read from it
        inputT.name = 'rating-' + cIdx + '-team'; inputT.value = String(sScore);
        inputT.id = 'rating-' + cIdx + '-team-' + sScore;
        // restore staged if present
        var stagedTeam = (stagedRatings[currentProject] && stagedRatings[currentProject].team) || {};
        if (stagedTeam[cIdx] && String(stagedTeam[cIdx]) === String(sScore)) inputT.checked = true;
        var lblT = document.createElement('label'); lblT.setAttribute('for', inputT.id); lblT.style.cursor = 'pointer'; lblT.style.display = 'inline-block'; lblT.style.padding = '2px';
        lblT.appendChild(inputT); tdT.appendChild(lblT); trTeam.appendChild(tdT);
      }
      var tdTeamRight = document.createElement('td'); tdTeamRight.className = 'col-descriptor'; tdTeamRight.style.padding = '8px'; trTeam.appendChild(tdTeamRight);
      tbody.appendChild(trTeam);

      table.appendChild(tbody); critWrap.appendChild(table); card.appendChild(critWrap); tempContainer.appendChild(card);
    });

    // Replace existing matrix content
    if (matrixContainer) {
      while (matrixContainer.firstChild) matrixContainer.removeChild(matrixContainer.firstChild);
      while (tempContainer.firstChild) matrixContainer.appendChild(tempContainer.firstChild);
    }

    // Render per-student + group comment panels (below matrix)
    renderCommentSection(projectName, students);

    // Attach change/input handlers once
    attachMatrixListeners();
  }

  // Render comment UI (per-student public/private and group)
  function renderCommentSection(projectName, students) {
    // remove old comment area
    var oldComment = document.querySelector('.section.section-comment');
    if (oldComment && oldComment.parentNode) oldComment.parentNode.removeChild(oldComment);

    // wrapper
    var commentSec = document.createElement('div'); commentSec.className = 'section section-comment'; commentSec.style.marginTop = '12px'; commentSec.style.display = 'block';
    var h = document.createElement('h3'); h.textContent = 'Add your additional comments'; h.style.margin = '0 0 12px 0'; h.style.fontSize = '1rem'; h.style.fontWeight = '700';
    commentSec.appendChild(h);

    // staged existing comments
    var staged = (stagedRatings[projectName] && stagedRatings[projectName]._studentComments) || {};
    // per-student panels
    (students || []).forEach(function (studentName, sIdx) {
      var wrapper = document.createElement('div'); wrapper.className = 'student-comment-panel'; wrapper.style.border = '1px solid rgba(10,12,30,0.05)'; wrapper.style.borderRadius = '8px'; wrapper.style.padding = '10px'; wrapper.style.marginBottom = '10px'; wrapper.style.background = '#fff';
      var headerRow = document.createElement('div'); headerRow.style.display = 'flex'; headerRow.style.justifyContent = 'space-between'; headerRow.style.alignItems = 'center'; headerRow.style.marginBottom = '8px';
      var nameEl = document.createElement('div'); nameEl.textContent = studentName; nameEl.style.fontWeight = '600'; headerRow.appendChild(nameEl);
      var toggleBtn = document.createElement('button'); toggleBtn.type = 'button'; toggleBtn.className = 'btn btn-mini comment-toggle'; toggleBtn.textContent = '▾ Add comment'; toggleBtn.style.fontSize = '0.85rem'; toggleBtn.style.padding = '6px 8px'; toggleBtn.style.cursor = 'pointer'; toggleBtn.style.background = 'white'; toggleBtn.style.border = '1px solid rgba(10,12,30,0.06)'; toggleBtn.style.borderRadius = '6px'; headerRow.appendChild(toggleBtn);
      wrapper.appendChild(headerRow);
      var content = document.createElement('div'); content.className = 'student-comment-content'; content.style.display = 'none';
      var lblPublic = document.createElement('div'); lblPublic.textContent = 'Comments to be SHARED WITH THE STUDENT'; lblPublic.style.fontSize = '0.9rem'; lblPublic.style.margin = '4px 0'; content.appendChild(lblPublic);
      var taPublic = document.createElement('textarea'); taPublic.id = 'comment-public-' + sIdx; taPublic.placeholder = 'Comments to share with student'; taPublic.style.width = '100%'; taPublic.style.minHeight = '60px'; taPublic.style.padding = '8px'; taPublic.style.boxSizing = 'border-box'; taPublic.style.marginBottom = '8px'; content.appendChild(taPublic);
      var lblPrivate = document.createElement('div'); lblPrivate.textContent = 'Comments to be SHARED ONLY WITH THE INSTRUCTOR'; lblPrivate.style.fontSize = '0.9rem'; lblPrivate.style.margin = '4px 0'; content.appendChild(lblPrivate);
      var taPrivate = document.createElement('textarea'); taPrivate.id = 'comment-private-' + sIdx; taPrivate.placeholder = 'Private comments for instructor'; taPrivate.style.width = '100%'; taPrivate.style.minHeight = '60px'; taPrivate.style.padding = '8px'; taPrivate.style.boxSizing = 'border-box'; content.appendChild(taPrivate);
      toggleBtn.addEventListener('click', function () {
        if (content.style.display === 'none') { content.style.display = 'block'; toggleBtn.textContent = '▴ Hide comment'; } else { content.style.display = 'none'; toggleBtn.textContent = '▾ Add comment'; }
      });
      // prefill staged
      var st = staged && staged[studentName];
      if (st) {
        if (st.public) taPublic.value = st.public;
        if (st.private) taPrivate.value = st.private;
        if ((st.public && st.public.length) || (st.private && st.private.length)) {
          content.style.display = 'block'; toggleBtn.textContent = '▴ Hide comment';
        }
      }
      wrapper.appendChild(content);
      commentSec.appendChild(wrapper);
    });

    // Group-level panel
    var groupWrap = document.createElement('div'); groupWrap.className = 'student-comment-panel'; groupWrap.style.border = '1px solid rgba(10,12,30,0.05)'; groupWrap.style.borderRadius = '8px'; groupWrap.style.padding = '10px'; groupWrap.style.marginBottom = '10px'; groupWrap.style.background = '#fff';
    var groupHeader = document.createElement('div'); groupHeader.style.display = 'flex'; groupHeader.style.justifyContent = 'space-between'; groupHeader.style.alignItems = 'center'; groupHeader.style.marginBottom = '8px';
    var groupTitle = document.createElement('div'); groupTitle.textContent = 'Comments for Evaluating group as a whole'; groupTitle.style.fontWeight = '600'; groupHeader.appendChild(groupTitle);
    var groupToggle = document.createElement('button'); groupToggle.type = 'button'; groupToggle.className = 'btn btn-mini comment-toggle'; groupToggle.textContent = '▾ Add comment'; groupToggle.style.fontSize = '0.85rem'; groupToggle.style.padding = '6px 8px'; groupToggle.style.cursor = 'pointer'; groupToggle.style.background = 'white'; groupToggle.style.border = '1px solid rgba(10,12,30,0.06)'; groupToggle.style.borderRadius = '6px'; groupHeader.appendChild(groupToggle);
    groupWrap.appendChild(groupHeader);
    var groupContent = document.createElement('div'); groupContent.style.display = 'none';
    var groupLbl = document.createElement('div'); groupLbl.textContent = 'Comments for Evaluating group as a whole (shared with student by default)'; groupLbl.style.margin = '4px 0'; groupContent.appendChild(groupLbl);
    var taGroup = document.createElement('textarea'); taGroup.id = 'comment-group-public'; taGroup.placeholder = 'Comments for evaluating group as a whole'; taGroup.style.width = '100%'; taGroup.style.minHeight = '80px'; taGroup.style.padding = '8px'; taGroup.style.boxSizing = 'border-box'; groupContent.appendChild(taGroup);
    var groupLblPrivate = document.createElement('div'); groupLblPrivate.textContent = 'Private comments about the group (instructor only)'; groupLblPrivate.style.margin = '8px 0 4px 0'; groupContent.appendChild(groupLblPrivate);
    var taGroupPrivate = document.createElement('textarea'); taGroupPrivate.id = 'comment-group-private'; taGroupPrivate.placeholder = 'Private comments for instructor about the group'; taGroupPrivate.style.width = '100%'; taGroupPrivate.style.minHeight = '60px'; taGroupPrivate.style.padding = '8px'; taGroupPrivate.style.boxSizing = 'border-box'; groupContent.appendChild(taGroupPrivate);
    groupToggle.addEventListener('click', function () {
      if (groupContent.style.display === 'none') { groupContent.style.display = 'block'; groupToggle.textContent = '▴ Hide comment'; } else { groupContent.style.display = 'none'; groupToggle.textContent = '▾ Add comment'; }
    });
    // prefill staged group
    var stagedGroup = (stagedRatings[currentProject] && stagedRatings[currentProject]._groupComments) || {};
    if (stagedGroup) {
      if (stagedGroup.public) taGroup.value = stagedGroup.public;
      if (stagedGroup.private) taGroupPrivate.value = stagedGroup.private;
      if ((stagedGroup.public && stagedGroup.public.length) || (stagedGroup.private && stagedGroup.private.length)) { groupContent.style.display = 'block'; groupToggle.textContent = '▴ Hide comment'; }
    }
    groupWrap.appendChild(groupContent);
    commentSec.appendChild(groupWrap);

    // attach below matrixContainer
    if (matrixContainer && matrixContainer.parentNode) {
      if (matrixContainer.nextSibling) matrixContainer.parentNode.insertBefore(commentSec, matrixContainer.nextSibling);
      else matrixContainer.parentNode.appendChild(commentSec);
    } else document.body.appendChild(commentSec);
  }

  // Attach handlers for matrix changes (save draft)
  function attachMatrixListeners() {
    // remove existing to avoid duplicates
    try {
      if (matrixContainer) { matrixContainer.removeEventListener && matrixContainer.removeEventListener('change', saveDraftHandler); matrixContainer.removeEventListener && matrixContainer.removeEventListener('input', saveDraftHandler); }
    } catch (e) { /* ignore */ }
    if (matrixContainer) { matrixContainer.addEventListener('change', saveDraftHandler); matrixContainer.addEventListener('input', saveDraftHandler); }

    // textareas inside comments section
    var commentSec = document.querySelector('.section.section-comment');
    if (commentSec) {
      Array.from(commentSec.querySelectorAll('textarea')).forEach(function (ta) {
        try { ta.removeEventListener && ta.removeEventListener('input', saveDraftHandler); } catch (e) {}
        ta.addEventListener('input', saveDraftHandler);
      });
    }
  }

  // Save draft: ratings + per-student comments + group comments + team ratings
  function saveDraftHandler() {
    if (!currentProject) return;
    if (!stagedRatings[currentProject]) stagedRatings[currentProject] = {};

    var students = sponsorProjects[currentProject] || [];
    // student ratings
    for (var s = 0; s < students.length; s++) {
      if (!stagedRatings[currentProject][s]) stagedRatings[currentProject][s] = {};
      for (var c = 0; c < RUBRIC.length; c++) {
        var sel = document.querySelector('input[name="rating-' + c + '-' + s + '"]:checked');
        if (sel) stagedRatings[currentProject][s][c] = parseInt(sel.value, 10);
        else if (stagedRatings[currentProject][s] && stagedRatings[currentProject][s][c] !== undefined) {
          // leave existing if no selection (do not delete)
        } else stagedRatings[currentProject][s][c] = null;
      }
    }

    // team ratings (if any)
    stagedRatings[currentProject].team = stagedRatings[currentProject].team || {};
    for (var ct = 0; ct < RUBRIC.length; ct++) {
      var selT = document.querySelector('input[name="rating-' + ct + '-team"]:checked');
      if (selT) stagedRatings[currentProject].team[ct] = parseInt(selT.value, 10);
      else if (stagedRatings[currentProject].team && stagedRatings[currentProject].team[ct] !== undefined) { /* keep */ }
      else stagedRatings[currentProject].team[ct] = null;
    }

    // per-student comments
    if (!stagedRatings[currentProject]._studentComments) stagedRatings[currentProject]._studentComments = {};
    for (var i = 0; i < students.length; i++) {
      var sName = students[i];
      var pubEl = document.getElementById('comment-public-' + i);
      var privEl = document.getElementById('comment-private-' + i);
      stagedRatings[currentProject]._studentComments[sName] = stagedRatings[currentProject]._studentComments[sName] || { public: '', private: '' };
      if (pubEl) stagedRatings[currentProject]._studentComments[sName].public = pubEl.value || '';
      if (privEl) stagedRatings[currentProject]._studentComments[sName].private = privEl.value || '';
    }

    // group comments
    stagedRatings[currentProject]._groupComments = stagedRatings[currentProject]._groupComments || { public: '', private: '' };
    var gpPub = document.getElementById('comment-group-public');
    var gpPriv = document.getElementById('comment-group-private');
    if (gpPub) stagedRatings[currentProject]._groupComments.public = gpPub.value || '';
    if (gpPriv) stagedRatings[currentProject]._groupComments.private = gpPriv.value || '';

    // Backwards-compat: store generic _comment too if present in UI (legacy)
    var legacyTa = document.getElementById('project-comment');
    if (legacyTa && legacyTa.value) stagedRatings[currentProject]._comment = legacyTa.value;

    saveProgress();
  }

  // Collect and submit current project
  function submitCurrentProject() {
    if (!currentProject) { setStatus('No project is loaded.', 'red'); return; }
    var students = sponsorProjects[currentProject] || [];
    if (!students.length) { setStatus('No students to submit.', 'red'); return; }

    // Build responses array expected by worker: each response = { student, ratings, commentShared, commentInstructor, isTeam }
    var responses = [];

    // per-student responses
    for (var s = 0; s < students.length; s++) {
      var ratingsObj = {};
      for (var c = 0; c < RUBRIC.length; c++) {
        var sel = document.querySelector('input[name="rating-' + c + '-' + s + '"]:checked');
        ratingsObj[RUBRIC[c].title || ('C' + c)] = sel ? parseInt(sel.value, 10) : null;
      }
      var commentShared = (document.getElementById('comment-public-' + s) || {}).value || '';
      var commentInstructor = (document.getElementById('comment-private-' + s) || {}).value || '';
      responses.push({ student: students[s], ratings: ratingsObj, commentShared: commentShared, commentInstructor: commentInstructor, isTeam: false });
    }

    // Team response (if any team ratings chosen OR group comment exists)
    var teamRatingsChosen = false;
    var teamRatingsObj = {};
    for (var tc = 0; tc < RUBRIC.length; tc++) {
      var teamSel = document.querySelector('input[name="rating-' + tc + '-team"]:checked');
      teamRatingsObj[RUBRIC[tc].title || ('C' + tc)] = teamSel ? parseInt(teamSel.value, 10) : null;
      if (teamSel) teamRatingsChosen = true;
    }
    var groupCommentShared = (document.getElementById('comment-group-public') || {}).value || '';
    var groupCommentInstructor = (document.getElementById('comment-group-private') || {}).value || '';
    if (teamRatingsChosen || groupCommentShared || groupCommentInstructor) {
      responses.push({ student: 'Evaluating group as a whole', ratings: teamRatingsObj, commentShared: groupCommentShared, commentInstructor: groupCommentInstructor, isTeam: true });
    }

    // If responses array empty (shouldn't be) block
    if (!responses.length) { setStatus('Nothing to submit.', 'red'); return; }

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
      setStatus('Submission saved. Thank you!', 'green');

      completedProjects[currentProject] = true;
      if (stagedRatings && stagedRatings[currentProject]) delete stagedRatings[currentProject];
      saveProgress();

      if (projectListEl) {
        var selector = 'li[data-project="' + CSS.escape(currentProject) + '"]';
        var li = projectListEl.querySelector(selector);
        if (li) {
          li.classList.add('completed'); li.classList.remove('active');
          li.innerHTML = '<strong>' + escapeHtml(currentProject) + '</strong> <span class="meta">(completed)</span>';
        }
      }

      // remove matrix and comment blocks and header
      if (matrixContainer) matrixContainer.innerHTML = '';
      var commentSection = document.querySelector('.section.section-comment');
      if (commentSection) commentSection.parentNode.removeChild(commentSection);
      var headerEl = document.querySelector('.current-project-header');
      if (headerEl && headerEl.parentNode) headerEl.parentNode.removeChild(headerEl);
      var matrixInfoBlock = document.getElementById('matrix-info');
      if (matrixInfoBlock) matrixInfoBlock.style.display = 'none';
      currentProject = '';
      if (hasCompletedAllProjects()) showThankyouStage();
    }).catch(function (err) {
      console.error('Submission failed', err);
      setStatus('Submission failed. See console.', 'red');
    }).finally(function () { if (submitProjectBtn) submitProjectBtn.disabled = false; });
  }

  function hasCompletedAllProjects() {
    var entry = sponsorData[currentEmail] || {};
    var all = Object.keys(entry.projects || {});
    for (var i = 0; i < all.length; i++) if (!completedProjects[all[i]]) return false;
    return true;
  }

  // Event wiring
  function onIdentitySubmit() {
    var name = nameInput ? nameInput.value.trim() : '';
    var email = emailInput ? (emailInput.value || '').toLowerCase().trim() : '';
    if (!name) { setStatus('Please enter your name.', 'red'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setStatus('Please enter a valid email.', 'red'); return; }

    currentName = name; currentEmail = email; saveProgress();
    if (!sponsorData || Object.keys(sponsorData).length === 0) {
      setStatus('Loading project data, please wait...', 'black');
      tryFetchData(function () {
        if (!sponsorData || !sponsorData[currentEmail]) { setStatus('No projects found for that email.', 'red'); return; }
        showProjectsStage(); populateProjectListFor(currentEmail);
      });
    } else {
      if (!sponsorData[currentEmail]) { setStatus('No projects found for that email.', 'red'); return; }
      showProjectsStage(); populateProjectListFor(currentEmail);
    }
  }

  if (identitySubmit) identitySubmit.addEventListener('click', onIdentitySubmit);
  if (backToIdentity) backToIdentity.addEventListener('click', function () { showIdentityStage(); });
  if (submitProjectBtn) submitProjectBtn.addEventListener('click', submitCurrentProject);
  if (finishStartOverBtn) finishStartOverBtn.addEventListener('click', function () {
    completedProjects = {}; stagedRatings = {}; saveProgress(); currentProject = '';
    if (matrixContainer) matrixContainer.innerHTML = '';
    var commentSection = document.querySelector('.section.section-comment'); if (commentSection) commentSection.parentNode.removeChild(commentSection);
    showIdentityStage();
  });

  // Stage display helpers
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

  // Fetch sponsor data from worker
  function tryFetchData(callback) {
    var loaderUrl = DATA_LOADER_URL;
    console.info('tryFetchData: requesting', loaderUrl);
    fetch(loaderUrl, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('Data loader returned ' + r.status);
        return r.json();
      })
      .then(function (rows) {
        sponsorData = buildSponsorMap(rows || []);
        setStatus('Project data loaded securely.', 'green');
        loadProgress();
        if (currentEmail && sponsorData[currentEmail]) { showProjectsStage(); populateProjectListFor(currentEmail); }
        if (typeof callback === 'function') callback();
      })
      .catch(function (err) {
        console.error('Data fetch failed', err);
        setStatus('Project data not found. Please try again later.', 'red');
        if (typeof callback === 'function') callback();
      });
  }

  // Hide auto footer and identity submit button on identity stage (UI tweaks)
  document.addEventListener('DOMContentLoaded', function () {
    var autoFooter = document.querySelector('.site-footer-fixed');
    if (autoFooter) autoFooter.parentNode.removeChild(autoFooter);
    // hide "Submit ratings for project" inside identity stage (if generated by site)
    var identityStage = document.querySelector('[data-stage="identity"]') || document.getElementById('stage-identity');
    if (identityStage) {
      var btns = Array.from(identityStage.querySelectorAll('button'));
      btns.forEach(function (b) {
        if (b.textContent && b.textContent.trim() === 'Submit ratings for project') b.style.display = 'none';
      });
    }
  });

  // Boot
  showIdentityStage();
  tryFetchData();

  // Debug helper (expose some state for console)
  window.__sponsorDebug = { sponsorData: sponsorData, stagedRatings: stagedRatings, completedProjects: completedProjects, reloadData: tryFetchData };
  window.__submitCurrentProject = submitCurrentProject;

})();




