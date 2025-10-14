(function () {
  'use strict';

  // Configuration (unchanged)
  var ENDPOINT_URL = 'https://csesponsors.sbecerr7.workers.dev/';
  var CSV_FILENAME = 'data.csv';
  var SCALE = ['Terrible', 'Poor', 'Average', 'Good', 'Excellent'];
  var STORAGE_KEY = 'sponsor_progress_v1';

  // DOM nodes
  var stageIdentity = document.getElementById('stage-identity');
  var stageProjects = document.getElementById('stage-projects');
  var stageThankyou = document.getElementById('stage-thankyou');
  var identitySubmit = document.getElementById('identitySubmit');
  var backToIdentity = document.getElementById('backToIdentity');
  var nameInput = document.getElementById('fullName');
  var emailInput = document.getElementById('email');
  var projectListEl = document.getElementById('project-list');
  var projectHeadingOutside = document.getElementById('projects-heading-outside');
  var matrixContainer = document.getElementById('matrix-container');
  var formStatus = document.getElementById('form-status');
  var submitProjectBtn = document.getElementById('submitProject');
  var matrixInfo = document.getElementById('matrix-info');
  var finishStartOverBtn = document.getElementById('finishStartOver');

  // NEW: welcome block element (shown only on identity stage)
  var welcomeBlock = document.getElementById('welcome-block');

  // State
  var sponsorData = {};
  var sponsorProjects = {};
  var currentEmail = '';
  var currentName = '';
  var currentProject = '';
  var completedProjects = {};
  var stagedRatings = {};

  function setStatus(msg, color) {
    if (!formStatus) return;
    formStatus.textContent = msg || '';
    formStatus.style.color = color || '';
  }

  function escapeHtml(s) {
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(s).replace(/[&<>"']/g, function (m) { return map[m]; });
  }

  /* CSV parsing, buildSponsorMap, save/load progress and other helpers remain unchanged... */
  // --- (omitted here for brevity in this snippet; keep your existing parseCSV, buildSponsorMap, saveProgress, loadProgress functions) ---

  // For clarity: paste your original parseCSV, buildSponsorMap, saveProgress, loadProgress, updateSectionVisibility, removeEmptySections, and other helpers here unchanged.
  // (In your real file, preserve all those functions exactly as they were.)

  /* -------------------------
     Stage switching (modified to show/hide welcome block)
     ------------------------- */
  function showIdentityStage() {
    if (stageIdentity) stageIdentity.style.display = '';
    if (stageProjects) stageProjects.style.display = 'none';
    if (stageThankyou) stageThankyou.style.display = 'none';
    if (projectHeadingOutside) projectHeadingOutside.style.display = 'none';
    // Show welcome block on identity stage
    if (welcomeBlock) welcomeBlock.style.display = '';
    setStatus('');
    try { updateSectionVisibility(); removeEmptySections(); } catch (e) { /* ignore */ }
  }

  function showProjectsStage() {
    if (stageIdentity) stageIdentity.style.display = 'none';
    if (stageProjects) stageProjects.style.display = '';
    if (stageThankyou) stageThankyou.style.display = 'none';
    if (projectHeadingOutside) projectHeadingOutside.style.display = '';
    // Hide welcome block when viewing projects
    if (welcomeBlock) welcomeBlock.style.display = 'none';
    try { updateSectionVisibility(); removeEmptySections(); } catch (e) { /* ignore */ }
  }

  function showThankyouStage() {
    if (stageIdentity) stageIdentity.style.display = 'none';
    if (stageProjects) stageProjects.style.display = 'none';
    if (stageThankyou) stageThankyou.style.display = '';
    if (projectHeadingOutside) projectHeadingOutside.style.display = 'none';
    // Hide welcome block on thank-you page
    if (welcomeBlock) welcomeBlock.style.display = 'none';
    try { updateSectionVisibility(); removeEmptySections(); } catch (e) { /* ignore */ }
  }

  /* -------------------------
     Event wiring (identitySubmit/backToIdentity/etc.)
     ------------------------- */
  if (identitySubmit) {
    identitySubmit.addEventListener('click', function () {
      var name = nameInput ? (nameInput.value || '').trim() : '';
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
     Boot: show identity stage and load CSV
     ------------------------- */
  showIdentityStage();
  tryFetchCSV();

  // expose debug helpers if desired (unchanged)
  window.__sponsorDebug = {
    sponsorData: sponsorData,
    stagedRatings: stagedRatings,
    completedProjects: completedProjects,
    reloadCSV: tryFetchCSV,
    updateSectionVisibility: function () { try { updateSectionVisibility(); } catch(e) {} },
    removeEmptySections: function () { try { removeEmptySections(); } catch(e) {} }
  };
})();



