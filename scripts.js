// Sponsor hybrid site script (cleaned & de-duplicated)
(function () {
  'use strict';

  // CONFIG
  var ENDPOINT_URL = 'https://csehybridsponsors.sbecerr7.workers.dev/';
  var DATA_LOADER_URL = 'https://data-loader.sbecerr7.workers.dev/';
  var STORAGE_KEY = 'sponsor_progress_v1';

  // Rubric
  var RUBRIC = [
    { title: "Student has contributed an appropriate amount of development effort towards this project:", description: "Development effort should be balanced between all team members; student should commit to a fair amount of development effort on each sprint." },
    { title: "Student's level of contribution and participation in meetings:", description: "Students are expected to be proactive. Contributions and participation in meetings help ensure the student is aware of project goals." },
    { title: "Student's understanding of your project/problem:", description: "Students are expected to understand important details of the project and be able to explain it from different stakeholder perspectives." },
    { title: "Quality of student's work product:", description: "Students should complete assigned work to a high quality: correct, documented, and self-explanatory where appropriate." },
    { title: "Quality and frequency of students' communications:", description: "Students are expected to be in regular communication and maintain professionalism when interacting with the sponsor." }
  ];

  // DOM refs
  var $ = function (id) { return document.getElementById(id); };
  var stageIdentity = $('stage-identity');
  var stageProjects = $('stage-projects');
  var stageThankyou = $('stage-thankyou');
  var identitySubmit = $('identitySubmit');
  var backToIdentity = $('backToIdentity');
  var nameInput = $('fullName');
  var emailInput = $('email');
  var projectListEl = $('project-list');
  var matrixContainer = $('matrix-container');
  var formStatus = $('form-status');
  var submitProjectBtn = $('submitProject');
  var finishStartOverBtn = $('finishStartOver');
  var welcomeBlock = $('welcome-block');
  var underTitle = $('under-title');

  // State
  var sponsorData = {};
  var sponsorProjects = {};
  var currentEmail = '';
  var currentName = '';
  var currentProject = '';
  var completedProjects = {};
  var stagedRatings = {};

  // ------- Helpers -------
  function setStatus(msg, color) {
    if (!formStatus) return;
    formStatus.textContent = msg || '';
    formStatus.style.color = color || '';
  }
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
    });
  }

  // element builder utility to reduce repetition
  function el(tag, props, children) {
    var n = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        if (k === 'class') n.className = props[k];
        else if (k === 'html') n.innerHTML = props[k];
        else if (k === 'text') n.textContent = props[k];
        else if (k === 'style') Object.assign(n.style, props[k]);
        else n.setAttribute(k, props[k]);
      });
    }
    if (children) children.forEach(function (c) { if (typeof c === 'string') n.appendChild(document.createTextNode(c)); else n.appendChild(c); });
    return n;
  }

  // Clean tokens and build sponsor map
  function buildSponsorMap(rows) {
    var map = {};
    if (!Array.isArray(rows)) return map;
    var emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    function cleanToken(tok) {
      if (!tok) return '';
      return tok.replace(/^[\s"'`([{]+|[\s"'`)\]}.,:;]+$/g, '').replace(/\u00A0/g, ' ').trim();
    }
    rows.forEach(function (rawRow) {
      var project = '', student = '', sponsorCell = '';
      Object.keys(rawRow || {}).forEach(function (rawKey) {
        var keyNorm = String(rawKey || '').trim().toLowerCase();
        var rawVal = (rawRow[rawKey] || '').toString().replace(/\u00A0/g, ' ').trim();
        if (!project && /^(project|project name|project_title|group_name|projectname)$/.test(keyNorm)) project = rawVal;
        else if (!student && /^(student|student name|students|name|student_name)$/.test(keyNorm)) student = rawVal;
        else if (!sponsorCell && /^(sponsoremail|sponsor email|sponsor|email|login_id|sponsor_email)$/.test(keyNorm)) sponsorCell = rawVal;
      });

      // fallback: extract emails from any cell
      if (!sponsorCell) {
        var fallback = [];
        Object.keys(rawRow || {}).forEach(function (k) {
          var rv = (rawRow[k] || '').toString();
          var found = rv.match(emailRegex);
          if (found) fallback = fallback.concat(found);
        });
        if (fallback.length) sponsorCell = fallback.join(', ');
      }

      project = (project || '').trim(); student = (student || '').trim();
      if (!sponsorCell || !project || !student) return;

      var tokens = sponsorCell.split(/[,;\/|]+/);
      var foundEmails = [];
      tokens.forEach(function (t) {
        var cleaned = cleanToken(t);
        if (!cleaned) return;
        var matches = cleaned.match(emailRegex) || t.match(emailRegex) || (t.replace(/\s+/g, '').match(emailRegex) || []);
        if (matches) matches.forEach(function (em) { foundEmails.push(em.toLowerCase().trim()); });
      });

      var unique = [];
      foundEmails.forEach(function (e) {
        if (!e || e.indexOf('@') === -1) return;
        var parts = e.split('@');
        if (parts.length !== 2 || parts[1].indexOf('.') === -1) return;
        if (unique.indexOf(e) === -1) unique.push(e);
      });
      if (!unique.length) return;
      unique.forEach(function (email) {
        if (!map[email]) map[email] = { projects: {} };
        if (!map[email].projects[project]) map[email].projects[project] = [];
        if (map[email].projects[project].indexOf(student) === -1) map[email].projects[project].push(student);
      });
    });
    return map;
  }

  // Persistence
  function sav



