// scripts.js — Full merged version with welcome-block toggle and tryFetchCSV present
(function () {
  'use strict';

  // Configuration
  var ENDPOINT_URL = 'https://csesponsors.sbecerr7.workers.dev/';
  var CSV_FILENAME = 'data.csv';
  var SCALE = ['Terrible', 'Poor', 'Average', 'Good', 'Excellent'];
  var STORAGE_KEY = 'sponsor_progress_v1';

  // DOM nodes (guarded)
  var stageIdentity = document.getElementById('stage-identity');
  var stageProjects = document.getElementById('stage-projects');
  var stageThankyou = document.getElementById('stage-thankyou'); // optional
  var identitySubmit = document.getElementById('identitySubmit');
  var backToIdentity = document.getElementById('backToIdentity');
  var nameInput = document.getElementById('fullName');
  var emailInput = document.getElementById('email');
  var projectListEl = document.getElementById('project-list');
  var projectHeadingOutside = document.getElementById('projects-heading-outside');
  var matrixContainer = document.getElementById('matrix-container');
  var formStatus = document.getElementById('form-status');
  var submitProjectBtn = document.getElementById('submitProject');
  var matrixInfo = document.getElementById('matrix-info'); // may be created later
  var finishStartOverBtn = document.getElementById('finishStartOver');

  // NEW: welcome block shown only on identity stage
  var welcomeBlock = document.getElementById('welcome-block');

  // State
  var sponsorData = {};
  var sponsorProjects = {};
  var currentEmail = '';
  var currentName = '';
  var currentProject = '';
  var completedProjects = {};
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
    return String(s).replace(/[&<>"']/g, function (m) { return map[m]; });
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

  // Improved updateSectionVisibility() to hide empty "section" boxes across browsers
  function updateSectionVisibility() {
    var sections = document.querySelectorAll('.section');

    function hasMeaningfulContent(node) {
      if (!node) return false;
      if (node.nodeType === Node.TEXT_NODE) {
        return (node.textContent || '').trim().length > 0;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        var tag = node.tagName ? node.tagName.toUpperCase() : '';
        var meaningfulTags = ['TABLE','UL','OL','LI','INPUT','TEXTAREA','SELECT','BUTTON','LABEL','P','H1','H2','H3','H4','IMG','SVG','CANVAS','A','STRONG','EM','SPAN'];
        if (meaningfulTags.indexOf(tag) !== -1) {
          try {
            if (node.offsetParent !== null) return true;
          } catch (e) {
            return true;
          }
        }
        if (node.getAttribute && (node.getAttribute('aria-label') || node.getAttribute('role') || node.getAttribute('alt'))) {
          try {
            if (node.offsetParent !== null) return true;
          } catch (e) { return true; }
        }
        var children = node.childNodes || [];
        for (var i = 0; i < children.length; i++) {
          if (hasMeaningfulContent(children[i])) return true;
        }
      }
      return false;
    }

    sections.forEach(function (s) {
      try {
        var meaningful = hasMeaningfulContent(s);

        if (!meaningful) {
          var rect = s.getBoundingClientRect();
          if (rect.height < 8 || (rect.width === 0 && rect.height === 0)) {
            s.style.display = 'none';
            return;
          }

          var cs = window.getComputedStyle(s);
          var innerText = (s.innerText || '').trim();
          if (!innerText && (cs.paddingTop === cs.paddingBottom && cs.paddingLeft === cs.paddingRight)) {
            var hasDescendants = false;
            var ch = s.querySelectorAll('*');
            for (var k = 0; k < ch.length; k++) {
              if (hasMeaningfulContent(ch[k])) { hasDescendants = true; break; }
            }
            if (!hasDescendants) {
              s.style.display = 'none';
              return;
            }
          }
        }

        s.style.display = meaningful ? '' : '';
      } catch (err) {
        s.style.display = '';
        console.warn('updateSectionVisibility error', err);
      }
    });
  }

  // New helper: remove truly-empty .section placeholders that cause visible empty boxes
  function removeEmptySections() {
    try {
      var sections = document.querySelectorAll('.section');
      for (var i = 0; i < sections.length; i++) {
        var s = sections[i];
        var text = (s.textContent || '').trim();
        var children = s.querySelectorAll('*');
        var hasMeaningfulChild = false;
        for (var j = 0; j < children.length; j++) {
          var ch = children[j];
          if (!ch.tagName) continue;
          var tag = ch.tagName.toUpperCase();
          // treat interactive/form elements and container elements as meaningful
          if (['INPUT','TEXTAREA','SELECT','BUTTON','TABLE','UL','OL','LI','IMG','CANVAS','SVG'].indexOf(tag) !== -1) {
            hasMeaningfulChild = true;
            break;
          }
          if ((ch.textContent || '').trim().length > 0) { hasMeaningfulChild = true; break; }
        }
        if (!text && !hasMeaningfulChild) {
          // hide placeholder section to avoid blank bubble being rendered
          s.style.display = 'none';
        }
      }
    } catch (e) {
      console.warn('removeEmptySections failed', e);
    }
  }

  /* -------------------------
     CSV fetch + init
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
      updateSectionVisibility();
      removeEmptySections(); // ensure no empty placeholders remain
    }).catch(function (err) {
      console.debug('CSV fetch failed', err);
      setStatus('Project data not found. Ensure data.csv is present.');
      updateSectionVisibility();
      removeEmptySections();
    });
  }

  /* -------------------------
     Stage switching
     ------------------------- */
  function showIdentityStage() {
    if (stageIdentity) stageIdentity.style.display = '';
    if (stageProjects) stageProjects.style.display = 'none';
    if (stageThankyou) stageThankyou.style.display = 'none';
    if (projectHeadingOutside) projectHeadingOutside.style.display = 'none';
    // show welcome block for identity
    if (welcomeBlock) welcomeBlock.style.display = '';
    setStatus('');
    updateSectionVisibility();
    removeEmptySections();
  }

  function showProjectsStage() {
    if (stageIdentity) stageIdentity.style.display = 'none';
    if (stageProjects) stageProjects.style.display = '';
    if (stageThankyou) stageThankyou.style.display = 'none';
    if (projectHeadingOutside) projectHeadingOutside.style.display = '';
    // hide welcome block on project stage
    if (welcomeBlock) welcomeBlock.style.display = 'none';
    updateSectionVisibility();
    removeEmptySections();
  }

  function showThankyouStage() {
    if (stageIdentity) stageIdentity.style.display = 'none';
    if (stageProjects) stageProjects.style.display = 'none';
    if (stageThankyou) stageThankyou.style.display = '';
    if (projectHeadingOutside) projectHeadingOutside.style.display = 'none';
    // hide welcome block on thankyou
    if (welcomeBlock) welcomeBlock.style.display = 'none';
    updateSectionVisibility();
    removeEmptySections();
  }

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
      updateSectionVisibility();
      removeEmptySections();
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
    updateSectionVisibility();
    removeEmptySections();
  }

  /* -------------------------
     Render matrix for a project
     ------------------------- */
  function loadProjectIntoMatrix(projectName, students) {
    currentProject = projectName;
    if (!matrixContainer) return;
    matrixContainer.innerHTML = '';

    // ensure matrix info block exists above matrix
    var info = matrixInfo;
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
      matrixInfo = info;
    }

    // project name above description
    var headerEl = info.querySelector('.current-project-header');
    var descEl = info.querySelector('.matrix-description');
    if (headerEl) headerEl.textContent = projectName;
    if (descEl) descEl.textContent = 'Please evaluate the students on Communication';
    info.style.display = ''; // ensure visible

    if (!students || !students.length) {
      matrixContainer.textContent = 'No students found for this project.';
      updateSectionVisibility();
      removeEmptySections();
      return;
    }

    var table = document.createElement('table');
    table.className = 'matrix-table';
    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    var thStudent = document.createElement('th');
    thStudent.textContent = '';
    headRow.appendChild(thStudent);
    for (var j = 0; j < SCALE.length; j++) {
      var th = document.createElement('th');
      th.textContent = SCALE[j];
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    var draft = stagedRatings[projectName] || { ratings: {}, comment: '' };

    for (var sIdx = 0; sIdx < students.length; sIdx++) {
      var student = students[sIdx];
      var tr = document.createElement('tr');
      var tdName = document.createElement('td');
      tdName.textContent = student;
      tr.appendChild(tdName);

      for (var colIdx = 0; colIdx < SCALE.length; colIdx++) {
        var td = document.createElement('td');
        td.style.textAlign = 'center';
        var wrapper = document.createElement('div');
        wrapper.className = 'rating-row';
        var id = 'rating-' + encodeURIComponent(projectName) + '-' + sIdx + '-' + colIdx;
        var input = document.createElement('input');
        input.type = 'radio';
        input.name = 'rating-' + sIdx;
        input.value = String(colIdx + 1);
        input.id = id;
        if (draft.ratings && draft.ratings[student] && String(draft.ratings[student]) === String(colIdx + 1)) {
          input.checked = true;
        }
        var label = document.createElement('label');
        label.htmlFor = id;
        label.textContent = '';
        wrapper.appendChild(input);
        wrapper.appendChild(label);
        td.appendChild(wrapper);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    matrixContainer.appendChild(table);

    // comment section (dedicated .section.section-comment)
    var commentSection = document.querySelector('.section.section-comment');
    if (!commentSection) {
      commentSection = document.createElement('div');
      commentSection.className = 'section section-comment';
      matrixContainer.parentNode.insertBefore(commentSection, matrixContainer.nextSibling);
    }
    commentSection.innerHTML = '';

    var commentWrap = document.createElement('div');
    commentWrap.className = 'project-comment-wrap';
    var lbl = document.createElement('label');
    lbl.htmlFor = 'project-comment';
    lbl.textContent = 'Comments about this project (optional)';
    var ta = document.createElement('textarea');
    ta.id = 'project-comment';
    ta.rows = 4;
    ta.style.width = '100%';
    ta.value = (draft && draft.comment) ? draft.comment : '';
    commentWrap.appendChild(lbl);
    commentWrap.appendChild(ta);
    commentSection.appendChild(commentWrap);

    // explicitly show comment section (override any CSS that hid it)
    commentSection.style.display = '';
    commentSection.style.visibility = 'visible';

    // Save draft handler
    function saveDraftHandler() {
      var rows = [];
      for (var ii = 0; ii < students.length; ii++) {
        var sel = document.querySelector('input[name="rating-' + ii + '"]:checked');
        rows.push({ student: students[ii], rating: sel ? parseInt(sel.value, 10) : null });
      }
      var commentVal = '';
      var taEl = document.getElementById('project-comment');
      if (taEl) commentVal = taEl.value || '';
      var draftObj = { ratings: {}, comment: commentVal };
      rows.forEach(function (r) { if (r.rating != null) draftObj.ratings[r.student] = r.rating; });
      stagedRatings[projectName] = draftObj;
      saveProgress();
    }

    // replace matrixContainer node to clear old listeners, then reattach
    var newMatrix = matrixContainer.cloneNode(true);
    matrixContainer.parentNode.replaceChild(newMatrix, matrixContainer);
    matrixContainer = newMatrix;

    matrixContainer.addEventListener('change', saveDraftHandler);
    matrixContainer.addEventListener('input', saveDraftHandler);
    commentSection.addEventListener('input', saveDraftHandler);

    updateSectionVisibility();
    removeEmptySections();
  }

  /* -------------------------
     Submit current project
     ------------------------- */
  function submitCurrentProject() {
    if (!currentProject) { setStatus('No project is loaded.', 'red'); return; }
    var students = sponsorProjects[currentProject] || [];
    if (!students.length) { setStatus('No students to submit.', 'red'); return; }

    var rows = [];
    for (var i = 0; i < students.length; i++) {
      var sel = document.querySelector('input[name="rating-' + i + '"]:checked');
      var commentVal = '';
      var taEl = document.getElementById('project-comment');
      if (taEl) commentVal = taEl.value || '';
      rows.push({ student: students[i], rating: sel ? parseInt(sel.value, 10) : null, comment: commentVal });
    }

    var anyRated = rows.some(function (r) { return r.rating != null; });
    if (!anyRated) { setStatus('Please rate at least one student before submitting.', 'red'); return; }

    var payload = {
      sponsorName: currentName || (nameInput ? nameInput.value.trim() : ''),
      sponsorEmail: currentEmail || (emailInput ? emailInput.value.trim() : ''),
      project: currentProject,
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
      return resp.json();
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

      // clear matrix and comment DOM
      if (matrixContainer) matrixContainer.innerHTML = '';
      var commentSection = document.querySelector('.section.section-comment');
      if (commentSection) {
        commentSection.innerHTML = '';
        commentSection.style.display = 'none';
      }

      // remove the small header if present
      var headerEl = document.querySelector('.current-project-header');
      if (headerEl) headerEl.parentNode.removeChild(headerEl);

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
      updateSectionVisibility();
      removeEmptySections();

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
     Events
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
      if (commentSection) { commentSection.innerHTML = ''; commentSection.style.display = 'none'; }
      showIdentityStage();
    });
  }

  /* -------------------------
     Boot
     ------------------------- */
  showIdentityStage();
  tryFetchCSV();

  // expose small debug helpers
  window.__sponsorDebug = {
    sponsorData: sponsorData,
    stagedRatings: stagedRatings,
    completedProjects: completedProjects,
    reloadCSV: tryFetchCSV,
    updateSectionVisibility: updateSectionVisibility,
    removeEmptySections: removeEmptySections
  };
})();




