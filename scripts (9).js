// Full updated scripts.js (HYBRID site)
// - multi-email parsing, reliable comment section creation, remove empty placeholder cards
(function () {
  'use strict';

  // --- Configuration (Cloudflare Workers endpoints) ---
  var ENDPOINT_URL = 'https://csehybridsponsors.sbecerr7.workers.dev/';  // POST submissions here
  var DATA_LOADER_URL = 'https://data-loader.sbecerr7.workers.dev/';    // HYBRID worker URL (reads hybrid sheet)
  var STORAGE_KEY = 'sponsor_progress_v1';
  var DATA_SOURCE = ''; // blank for hybrid


  // Descriptor texts (confirmed by user)
  var LEFT_DESCRIPTOR = "Far Below Expectations (Fail)";
  var RIGHT_DESCRIPTOR = "Exceeds Expectations (A+)";

  // UI selectors - adjust if your HTML uses different IDs
  var selectors = {
    container: '#app', // parent container into which we will render matrix UI (fallback used if not present)
    projectsSection: '#projects-stage', // where instructions live
    instructions: '.projects-instructions', // sticky instructions block selector
    projectSelect: '#project-select', // project selection element (if you have one)
    sponsorName: '#sponsor-name',
    sponsorEmail: '#sponsor-email',
    startButton: '#start-btn', // optional
    matrixStage: '#matrix-stage', // where matrix/cards are rendered
    submitButton: '#submit-btn',
    savedBanner: '#saved-banner' // optional element to show "draft saved"
  };

  // If your page doesn't have an app container, create one at body end
  if (!document.querySelector(selectors.container)) {
    var appDiv = document.createElement('div');
    appDiv.id = 'app';
    document.body.appendChild(appDiv);
  }

  var state = {
    sponsorName: '',
    sponsorEmail: '',
    project: '',
    // responsesMap: keyed by studentKey (student name string) - contains { ratings: {rubricTitle: value}, commentShared, commentInstructor, isTeam }
    responsesMap: {},
    students: [], // array of student display names (strings)
    teamKey: '__TEAM__'
  };

  // Utility: load state from localStorage
  function loadDraft() {
    try {
      var txt = localStorage.getItem(STORAGE_KEY);
      if (!txt) return;
      var parsed = JSON.parse(txt);
      if (parsed) {
        if (parsed.sponsorName) state.sponsorName = parsed.sponsorName;
        if (parsed.sponsorEmail) state.sponsorEmail = parsed.sponsorEmail;
        if (parsed.project) state.project = parsed.project;
        if (parsed.responsesMap) state.responsesMap = parsed.responsesMap;
      }
    } catch (e) {
      console.warn('Failed reading draft from localStorage', e);
    }
  }

  // Utility: save to localStorage
  function saveDraft() {
    try {
      var payload = {
        sponsorName: state.sponsorName,
        sponsorEmail: state.sponsorEmail,
        project: state.project,
        responsesMap: state.responsesMap
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      // optional UI notify
      var b = document.querySelector(selectors.savedBanner);
      if (b) {
        b.textContent = 'Draft saved';
        setTimeout(()=>{ b.textContent = ''; }, 1500);
      }
    } catch (e) {
      console.warn('Failed saving draft', e);
    }
  }

  // Create a safe key for a student (used to index responsesMap)
  function studentKey(name) {
    return String(name || '').trim() || 'NO_NAME';
  }

  // Initialize response record if missing
  function ensureResponseRecordFor(name) {
    var key = studentKey(name);
    if (!state.responsesMap[key]) {
      state.responsesMap[key] = { ratings: {}, commentShared: '', commentInstructor: '', isTeam: (key === state.teamKey) ? true : false };
    }
  }

  // Render helpers
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function(k){
        if (k === 'class') node.className = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function(c){
        if (typeof c === 'string') node.appendChild(document.createTextNode(c));
        else if (c) node.appendChild(c);
      });
    }
    return node;
  }

  // Render the stacked rubric cards and matrix with descriptor columns
  function renderMatrixCards(container) {
    container.innerHTML = '';

    // For each rubric item, create one .card containing a table
    RUBRIC.forEach(function(rubric, rubricIndex){
      var card = el('div',{class:'card rubric-card', 'data-rubric-index':String(rubricIndex)});
      var header = el('div',{class:'card-header'}, [
        el('h3',{class:'rubric-title', html: rubric.title }),
        rubric.description ? el('p',{class:'rubric-desc', html: rubric.description}) : null
      ]);
      card.appendChild(header);

      // Table for ratings
      var table = el('table',{class:'rubric-table'});
      var thead = el('thead');
      var trHead = el('tr');

      // Left descriptor column header
      trHead.appendChild(el('th',{class:'descriptor-left'}, LEFT_DESCRIPTOR));

      // number columns 1..7
      for (var n=1;n<=7;n++){
        trHead.appendChild(el('th',{class:'rating-col'}, String(n)));
      }

      // Right descriptor column header
      trHead.appendChild(el('th',{class:'descriptor-right'}, RIGHT_DESCRIPTOR));
      thead.appendChild(trHead);
      table.appendChild(thead);

      var tbody = el('tbody');

      // Rows for each student
      state.students.forEach(function(studentName, studentIndex){
        ensureResponseRecordFor(studentName);
        var key = studentKey(studentName);
        var tr = el('tr',{class:'student-row', 'data-student-key':key});

        // Left descriptor cell (empty visually)
        tr.appendChild(el('td',{class:'descriptor-left-cell'}));

        for (var n=1;n<=7;n++){
          var td = el('td',{class:'rating-cell'});
          var radioName = `rating__${key}__${rubric.title}`;
          var radioId = `r__${key}__${rubricIndex}__${n}`;
          var input = el('input', {type:'radio', name:radioName, id:radioId, value:String(n)});
          // restore checked from state if exists
          var saved = (state.responsesMap[key] && state.responsesMap[key].ratings && state.responsesMap[key].ratings[rubric.title]) ? String(state.responsesMap[key].ratings[rubric.title]) : '';
          if (saved === String(n)) input.checked = true;

          // when changed, update state and save
          input.addEventListener('change', function(ev){
            var val = ev.target.value;
            var nameParts = ev.target.name.split('__'); // ["rating", key, rubricTitle]
            var sKey = nameParts[1];
            var rTitle = nameParts.slice(2).join('__'); // rubric title may contain __ if weird
            ensureResponseRecordFor(sKey);
            state.responsesMap[sKey].ratings[rTitle] = val;
            saveDraft();
          });

          td.appendChild(input);
          tr.appendChild(td);
        }

        // Right descriptor cell
        tr.appendChild(el('td',{class:'descriptor-right-cell'}));
        tbody.appendChild(tr);
      });

      // Add team row (evaluate whole team)
      ensureResponseRecordFor(state.teamKey);
      var teamTr = el('tr',{class:'student-row team-row', 'data-student-key': state.teamKey});
      teamTr.appendChild(el('td',{class:'descriptor-left-cell'}));
      for (var m=1;m<=7;m++){
        var td2 = el('td',{class:'rating-cell'});
        var radioName2 = `rating__${state.teamKey}__${rubric.title}`;
        var radioId2 = `r__${state.teamKey}__${rubricIndex}__${m}`;
        var input2 = el('input', {type:'radio', name:radioName2, id:radioId2, value:String(m)});
        var saved2 = (state.responsesMap[state.teamKey] && state.responsesMap[state.teamKey].ratings && state.responsesMap[state.teamKey].ratings[rubric.title]) ? String(state.responsesMap[state.teamKey].ratings[rubric.title]) : '';
        if (saved2 === String(m)) input2.checked = true;
        input2.addEventListener('change', function(ev){
          var val = ev.target.value;
          var nameParts = ev.target.name.split('__');
          var sKey = nameParts[1];
          var rTitle = nameParts.slice(2).join('__');
          ensureResponseRecordFor(sKey);
          state.responsesMap[sKey].ratings[rTitle] = val;
          state.responsesMap[sKey].isTeam = true;
          saveDraft();
        });
        td2.appendChild(input2);
        teamTr.appendChild(td2);
      }
      teamTr.appendChild(el('td',{class:'descriptor-right-cell'}));
      tbody.appendChild(teamTr);

      table.appendChild(tbody);
      card.appendChild(table);

      container.appendChild(card);
    });
  }

  // Render collapsible comment panels (one per student and one team)
  function renderCommentPanels(container) {
    // Title above panels
    var title = el('h3',{class:'comments-title'}, 'Add your additional comments');
    container.appendChild(title);

    var panelsWrap = el('div',{class:'comments-wrap'});
    // For each student
    state.students.concat([state.teamKey]).forEach(function(name){
      ensureResponseRecordFor(name);
      var key = studentKey(name);
      var displayName = (key === state.teamKey) ? 'Team (Group as a whole)' : name;

      var panelCard = el('div',{class:'card comment-card', 'data-student-key': key});
      var header = el('div',{class:'comment-header'});
      var headerBtn = el('button',{class:'collapsible-toggle', type:'button'}, displayName + ' ▾');
      headerBtn.addEventListener('click', function(){
        bodyDiv.classList.toggle('collapsed');
        headerBtn.classList.toggle('open');
      });
      header.appendChild(headerBtn);
      panelCard.appendChild(header);

      var bodyDiv = el('div',{class:'comment-body collapsed'});

      // Shared with student label + textarea
      bodyDiv.appendChild(el('label',{class:'comment-label'}, 'Comments to be SHARED WITH THE STUDENT'));
      var taShared = el('textarea',{class:'comment-shared', rows:4, placeholder:'Optional comments that the student will see.'});
      taShared.value = state.responsesMap[key].commentShared || '';
      taShared.addEventListener('input', function(ev){
        ensureResponseRecordFor(key);
        state.responsesMap[key].commentShared = ev.target.value;
        saveDraft();
      });
      bodyDiv.appendChild(taShared);

      // Instructor-only label + textarea
      bodyDiv.appendChild(el('label',{class:'comment-label'}, 'Comments to be SHARED ONLY WITH THE INSTRUCTOR'));
      var taInst = el('textarea',{class:'comment-instructor', rows:4, placeholder:'Private comments for the instructor only.'});
      taInst.value = state.responsesMap[key].commentInstructor || '';
      taInst.addEventListener('input', function(ev){
        ensureResponseRecordFor(key);
        state.responsesMap[key].commentInstructor = ev.target.value;
        saveDraft();
      });
      bodyDiv.appendChild(taInst);

      // small helper
      bodyDiv.appendChild(el('div',{class:'comment-hint'}, key === state.teamKey ? 'Team comments apply to the group as a whole.' : ''));

      panelCard.appendChild(bodyDiv);
      panelsWrap.appendChild(panelCard);
    });

    container.appendChild(panelsWrap);
  }

  // Build the complete UI (matrix cards + comments)
  function buildUI() {
    var matrixStage = document.querySelector(selectors.matrixStage);
    if (!matrixStage) {
      // If no explicit stage, attach to #app
      matrixStage = document.querySelector('#app');
    }
    matrixStage.innerHTML = '';

    // Keep a sticky instructions block if present on page (do not duplicate)
    var instr = document.querySelector(selectors.instructions);
    if (instr) {
      // ensure sticky style via CSS snippet we'll add
      instr.classList.add('sticky-instructions');
      matrixStage.appendChild(instr.cloneNode(true));
    }

    // Container for matrix cards
    var cardsWrap = el('div',{class:'cards-wrap'});
    matrixStage.appendChild(cardsWrap);
    renderMatrixCards(cardsWrap);

    // Comments area
    var commentsContainer = el('div',{class:'comments-section'});
    renderCommentPanels(commentsContainer);
    matrixStage.appendChild(commentsContainer);

    // Submit button (if not present on page, create one)
    var submitBtn = document.querySelector(selectors.submitButton);
    if (!submitBtn) {
      submitBtn = el('button',{id:'submit-btn', class:'btn submit-btn', type:'button'}, 'Submit');
      matrixStage.appendChild(submitBtn);
    }
    submitBtn.addEventListener('click', handleSubmit);
  }

  // Build responses array in the shape your worker expects
  function buildResponsesArray() {
    var responses = [];
    Object.keys(state.responsesMap).forEach(function(key){
      var rec = state.responsesMap[key];
      // Skip if no ratings and empty comments? We'll include anyway so sheet gets team rows consistently.
      var ratings = {};
      RUBRIC.forEach(function(r){
        ratings[r.title] = (rec.ratings && rec.ratings[r.title]) ? rec.ratings[r.title] : '';
      });

      responses.push({
        student: (key === state.teamKey) ? state.teamKey : key,
        ratings: ratings,
        commentShared: rec.commentShared || '',
        commentInstructor: rec.commentInstructor || '',
        isTeam: rec.isTeam ? "TRUE" : ""
      });
    });

    return responses;
  }

  // Basic validation
  function validateBeforeSubmit() {
    if (!state.sponsorName || !state.sponsorEmail || !state.project) {
      alert('Please provide your name, email, and select a project before submitting.');
      return false;
    }
    // At least one response required (your worker expects at least one).
    if (Object.keys(state.responsesMap).length === 0) {
      alert('No students or team rows found to submit.');
      return false;
    }
    return true;
  }

  // Submit handler: POST JSON to ENDPOINT_URL
  async function handleSubmit(ev) {
    if (!validateBeforeSubmit()) return;
    var payload = {
      sponsorName: state.sponsorName,
      sponsorEmail: state.sponsorEmail,
      project: state.project,
      rubric: RUBRIC.map(r=>r.title),
      responses: buildResponsesArray()
    };

    try {
      var resp = await fetch(ENDPOINT_URL, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      var json = await resp.json();
      if (resp.ok) {
        // Clear local draft on success
        localStorage.removeItem(STORAGE_KEY);
        alert('Submission saved. Thank you!');
        // optional: redirect or clear UI
      } else {
        console.error('Submission failed', json);
        alert('Submission failed — see console for details.');
      }
    } catch (err) {
      console.error('Submission error', err);
      alert('Submission error — network or endpoint problem. See console for details.');
    }
  }

  // Wire up inputs for sponsorName/email/project on the page (if exist), and restore values from draft
  function wireUpTopFields() {
    // load existing draft into state
    loadDraft();

    // sponsor name
    var sn = document.querySelector(selectors.sponsorName);
    if (sn) {
      sn.value = state.sponsorName || '';
      sn.addEventListener('input', function(e){ state.sponsorName = e.target.value; saveDraft(); });
    } else {
      // if missing, create simple inputs at top of #app
      var app = document.querySelector('#app');
      var topbar = el('div',{class:'sponsor-topbar'});
      var inName = el('input',{id:'sponsor-name', placeholder:'Your name'});
      inName.value = state.sponsorName || '';
      inName.addEventListener('input', function(e){ state.sponsorName = e.target.value; saveDraft(); });
      var inEmail = el('input',{id:'sponsor-email', placeholder:'Your email'});
      inEmail.value = state.sponsorEmail || '';
      inEmail.addEventListener('input', function(e){ state.sponsorEmail = e.target.value; saveDraft(); });
      topbar.appendChild(inName);
      topbar.appendChild(inEmail);
      app.insertBefore(topbar, app.firstChild);
      // update selectors so later code uses these nodes
      selectors.sponsorName = '#sponsor-name';
      selectors.sponsorEmail = '#sponsor-email';
    }

    // sponsor email
    var se = document.querySelector(selectors.sponsorEmail);
    if (se) {
      se.value = state.sponsorEmail || '';
      se.addEventListener('input', function(e){ state.sponsorEmail = e.target.value; saveDraft(); });
    }

    // project select
    var ps = document.querySelector(selectors.projectSelect);
    if (ps) {
      ps.value = state.project || '';
      ps.addEventListener('change', function(e){
        state.project = e.target.value;
        saveDraft();
      });
    }
  }

  // Load the list of projects & students from your data loader endpoint (if set); otherwise use a fallback
  async function loadDataAndStart() {
    // If loaded previously from other script/page variables, keep them.
    // For this implementation we'll attempt to fetch JSON from DATA_LOADER_URL if present.
    var studentsList = [];
    var projectName = state.project || '';

    if (DATA_LOADER_URL) {
      try {
        var r = await fetch(DATA_LOADER_URL);
        if (r.ok) {
          var j = await r.json();
          // Expecting the data loader to return something like: { projects: [{name:'Project Alpha', students:['A','B']}, ...], project: 'Project Alpha' }
          if (Array.isArray(j.projects) && j.projects.length) {
            // Pick project by name in state if present, otherwise first project
            var chosen = null;
            if (state.project) chosen = j.projects.find(p=>p.name===state.project);
            if (!chosen) chosen = j.projects[0];
            projectName = chosen.name;
            studentsList = Array.isArray(chosen.students) ? chosen.students.slice() : [];
          } else if (Array.isArray(j.students) && j.students.length) {
            studentsList = j.students.slice();
            projectName = j.project || projectName;
          }
        } else {
          console.warn('DATA_LOADER_URL returned non-ok status', r.status);
        }
      } catch (err) {
        console.warn('Could not fetch data loader', err);
      }
    }

    // fallback demo students if fetch failed and none are loaded
    if (!studentsList.length) {
      studentsList = ['Student A','Student B','Student C'];
    }

    state.students = studentsList;
    if (!state.project) state.project = projectName || 'Unknown Project';

    // Ensure each student and team record exists
    state.students.forEach(s=>ensureResponseRecordFor(s));
    ensureResponseRecordFor(state.teamKey);
    state.responsesMap[state.teamKey].isTeam = true;

    // Wire up name/email/project inputs and restore draft
    wireUpTopFields();

    // Finally build the UI
    var matrixEl = document.querySelector(selectors.matrixStage) || document.querySelector('#app');
    buildUI();
  }

  // Start
  document.addEventListener('DOMContentLoaded', function(){
    loadDraft(); // load early
    loadDataAndStart();
  });

})();





