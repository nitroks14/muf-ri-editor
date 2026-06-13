(function () {
'use strict';

/* =====================================================
   CONSTANTES DÉPÔT
   ===================================================== */
var TAXONOMY_OWNER  = 'nitroks14';
var TAXONOMY_REPO   = 'muf-ri-taxonomy';
var TAXONOMY_BRANCH = 'main';
var TAXONOMY_FILE   = 'taxonomy.json';
var VERSION_FILE    = 'version.json';

/* =====================================================
   ÉTAT LOCAL
   ===================================================== */
var LS_KEY        = 'muf_ri_taxo_draft';
var LS_GH         = 'muf_ri_taxo_github';
var SS_GH_TOKEN   = 'muf_ri_taxo_token';

var taxo = null;
var workspace = null;
var activeMachineKey = null;
var chargementEnCours = false;
var injectionDiv = null;
var onInjectionClick = null;
var dernierRepliId = null;
var dernierRepliTs = 0;

var CLES_RESERVEES = ['version', 'actionLabels', '_etats', '_etatsDefauts'];
function estCleReservee(k) { return CLES_RESERVEES.indexOf(k) !== -1; }
function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
function machineKeys() {
  return Object.keys(taxo).filter(function(k) { return !estCleReservee(k); });
}

/* =====================================================
   TOAST
   ===================================================== */
var toastEl = document.getElementById('te-toast');
var toastTimer = null;
function showToast(msg, type) {
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.className = 'te-toast ' + (type || 'info');
  toastEl.classList.add('show');
  toastTimer = setTimeout(function() { toastEl.classList.remove('show'); }, 3000);
}

/* =====================================================
   MIGRATION
   ===================================================== */
function migrerSiNecessaire(t) {
  CLES_RESERVEES.forEach(function(k) {
    if (Object.prototype.hasOwnProperty.call(t, k)) { delete t[k]; }
  });
  Object.keys(t).forEach(function(mk) {
    if (estCleReservee(mk)) return;
    (t[mk].stations || []).forEach(function(s) {
      (s.subcats || []).forEach(function(sc) {
        sc.elements = (sc.elements || []).map(function(e) {
          if (typeof e === 'string') return { label: e, actions: [{ type: 'controle' }, { type: 'nettoyage' }, { type: 'remplacement' }] };
          e.actions = (e.actions || []).map(function(a) {
            if (typeof a === 'string') return { type: a };
            if (Array.isArray(a.etats)) {
              var s = a.etats.map(function(x){ return String(x).trim(); }).filter(Boolean).join('/');
              if (s) { a.etats = s; } else { delete a.etats; }
            } else if (typeof a.etats === 'string' && !a.etats.trim()) {
              delete a.etats;
            }
            return a;
          });
          return e;
        });
      });
    });
  });
  return t;
}

/* =====================================================
   CHARGEMENT / SAUVEGARDE (localStorage + fetch GitHub)
   ===================================================== */
function sauvegarder() {
  localStorage.setItem(LS_KEY, JSON.stringify(taxo));
}

async function charger() {
  /* 1. Cache local d'abord */
  var saved = localStorage.getItem(LS_KEY);
  if (saved) {
    try { taxo = migrerSiNecessaire(JSON.parse(saved)); } catch(e) { taxo = null; }
  }

  /* 2. Fetch depuis muf-ri-taxonomy (raw GitHub) */
  var url = 'https://raw.githubusercontent.com/' + TAXONOMY_OWNER + '/' + TAXONOMY_REPO + '/' + TAXONOMY_BRANCH + '/' + TAXONOMY_FILE;
  try {
    var resp = await fetch(url + '?_=' + Date.now());
    if (resp.ok) {
      var data = await resp.json();
      /* Extraire uniquement les machines (ignorer version, actionLabels) */
      var machines = {};
      Object.keys(data).forEach(function(k) {
        if (!estCleReservee(k) && k !== 'machines') machines[k] = data[k];
      });
      /* Support format {machines:{...}} ou format plat */
      if (data.machines) {
        Object.keys(data.machines).forEach(function(k) { machines[k] = data.machines[k]; });
      }
      if (Object.keys(machines).length) {
        taxo = migrerSiNecessaire(machines);
        sauvegarder();
        showToast('Taxonomie chargée depuis GitHub', 'success');
      }
    }
  } catch (_) {
    if (!taxo) showToast('Hors ligne — aucun cache disponible', 'error');
    else showToast('Hors ligne — brouillon local utilisé', 'info');
  }

  if (!taxo) taxo = {};
}

/* =====================================================
   AUTH GITHUB — DEVICE FLOW (sans token manuel)
   ===================================================== */
var GH_CLIENT_ID = '178c6fc778ccc68e1d6a'; /* client_id public gh CLI */
var _pollTimer = null;

function getToken() { return sessionStorage.getItem(SS_GH_TOKEN) || ''; }

function setToken(token) {
  sessionStorage.setItem(SS_GH_TOKEN, token);
  majStatutAuth(true);
}

function clearToken() {
  sessionStorage.removeItem(SS_GH_TOKEN);
  majStatutAuth(false);
}

function majStatutAuth(connecte) {
  var statusEl = document.getElementById('gh-auth-status');
  var labelEl  = document.getElementById('gh-auth-label');
  var btnLogin  = document.getElementById('gh-btn-login');
  var btnLogout = document.getElementById('gh-btn-logout');

  if (connecte) {
    statusEl.className = 'gh-auth-status connected';
    labelEl.textContent = 'Connecté à GitHub ✓';
    btnLogin.style.display  = 'none';
    btnLogout.style.display = 'block';
    document.getElementById('gh-device-box').classList.remove('open');
  } else {
    statusEl.className = 'gh-auth-status disconnected';
    labelEl.textContent = 'Non connecté';
    btnLogin.style.display  = 'block';
    btnLogout.style.display = 'none';
  }
}

async function lancerDeviceFlow() {
  var statusEl = document.getElementById('gh-auth-status');
  var labelEl  = document.getElementById('gh-auth-label');
  statusEl.className = 'gh-auth-status pending';
  labelEl.textContent = 'Demande du code…';

  try {
    var resp = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'client_id=' + GH_CLIENT_ID + '&scope=repo'
    });
    var data = await resp.json();

    document.getElementById('gh-device-code').textContent = data.user_code;
    document.getElementById('gh-device-link').href = data.verification_uri || 'https://github.com/login/device';
    document.getElementById('gh-device-box').classList.add('open');
    labelEl.textContent = 'En attente d\'autorisation…';

    /* Polling toutes les data.interval secondes */
    var interval = (data.interval || 5) * 1000;
    var deviceCode = data.device_code;

    clearTimeout(_pollTimer);
    (function poll() {
      _pollTimer = setTimeout(async function() {
        try {
          var pResp = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'client_id=' + GH_CLIENT_ID + '&device_code=' + deviceCode +
                  '&grant_type=urn:ietf:params:oauth:grant-type:device_code'
          });
          var pData = await pResp.json();
          if (pData.access_token) {
            setToken(pData.access_token);
            showToast('Connecté à GitHub ✓', 'success');
          } else if (pData.error === 'authorization_pending') {
            poll(); /* continuer */
          } else if (pData.error === 'slow_down') {
            interval += 5000; poll();
          } else {
            majStatutAuth(false);
            showToast('Erreur : ' + (pData.error_description || pData.error), 'error');
          }
        } catch(e) { majStatutAuth(false); showToast('Erreur réseau', 'error'); }
      }, interval);
    })();

  } catch(e) {
    majStatutAuth(false);
    showToast('Impossible de contacter GitHub', 'error');
  }
}

document.getElementById('gh-btn-login').addEventListener('click', lancerDeviceFlow);

document.getElementById('gh-btn-logout').addEventListener('click', function() {
  clearTimeout(_pollTimer);
  clearToken();
  showToast('Déconnecté', 'info');
});

/* =====================================================
   CONFIG GITHUB (owner / repo / branch)
   ===================================================== */
function chargerConfig() {
  var saved = localStorage.getItem(LS_GH);
  if (!saved) return;
  var cfg;
  try { cfg = JSON.parse(saved); } catch(e) { return; }
  if (cfg.owner)  document.getElementById('gh-owner').value  = cfg.owner;
  if (cfg.repo)   document.getElementById('gh-repo').value   = cfg.repo;
  if (cfg.branch) document.getElementById('gh-branch').value = cfg.branch;
}

function lireConfig() {
  return {
    token:  getToken(),
    owner:  document.getElementById('gh-owner').value.trim(),
    repo:   document.getElementById('gh-repo').value.trim(),
    branch: document.getElementById('gh-branch').value.trim() || 'main'
  };
}

document.getElementById('gh-save-config').addEventListener('click', function() {
  var cfg = lireConfig();
  localStorage.setItem(LS_GH, JSON.stringify({ owner: cfg.owner, repo: cfg.repo, branch: cfg.branch }));
  showToast('Config sauvegardée', 'success');
  document.getElementById('te-sidebar').classList.remove('open');
});

/* =====================================================
   SIDEBAR CONFIG
   ===================================================== */
function positionnerSidebars() {
  var toolbar = document.querySelector('.te-toolbar');
  if (!toolbar) return;
  var top = Math.max(0, Math.round(toolbar.getBoundingClientRect().bottom));
  document.querySelectorAll('.te-sidebar').forEach(function(p) { p.style.top = top + 'px'; });
}

document.getElementById('te-config-btn').addEventListener('click', function() {
  positionnerSidebars();
  document.getElementById('te-sidebar').classList.toggle('open');
});
window.addEventListener('resize', positionnerSidebars);

/* =====================================================
   PUSH GITHUB → muf-ri-taxonomy
   ===================================================== */
var pushEnCours = false;

function decoderBase64UTF8(b64) {
  var bin = atob((b64 || '').replace(/\n/g, ''));
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

function encoderUTF8Base64(str) {
  var bytes = new TextEncoder().encode(str);
  var bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function lireFichierGitHub(apiBase, headers, branch) {
  var resp = await fetch(apiBase + '?ref=' + encodeURIComponent(branch), { headers: headers });
  if (!resp.ok) throw new Error('Lecture GitHub : ' + resp.status);
  var data = await resp.json();
  return { sha: data.sha, content: decoderBase64UTF8(data.content) };
}

async function putFichierGitHub(apiBase, headers, content, sha, branch, message) {
  return fetch(apiBase, {
    method: 'PUT',
    headers: headers,
    body: JSON.stringify({ message: message, content: encoderUTF8Base64(content), sha: sha, branch: branch })
  });
}

async function gererPush() {
  if (pushEnCours) return;
  pushEnCours = true;
  var btn = document.getElementById('te-push');
  btn.disabled = true; btn.style.opacity = '0.6';

  try {
    var cfg = lireConfig();
    if (!cfg.token) { showToast('Non connecté à GitHub — cliquez sur ⚙ Config', 'error'); return; }

    var apiBase = 'https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo + '/contents/';
    var headers = {
      'Authorization': 'token ' + cfg.token,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    };

    showToast('Push en cours…', 'info');

    /* 1. Lire taxonomy.json actuel (sha requis pour le PUT) */
    var taxoApi = apiBase + TAXONOMY_FILE;
    var fichier = await lireFichierGitHub(taxoApi, headers, cfg.branch);
    var ancienneVersion = '1.0.0';
    try {
      var ancien = JSON.parse(fichier.content);
      if (ancien.version) ancienneVersion = ancien.version;
    } catch(_) {}

    /* 2. Construire le nouveau JSON avec les machines + les métadonnées */
    var newVersion = bumperVersion(ancienneVersion);
    var newTaxonomy = { version: newVersion, actionLabels: { controle: 'Contrôle', nettoyage: 'Nettoyage', remplacement: 'Remplacement', graissage: 'Graissage', lubrification: 'Lubrification', reglage: 'Réglage' }, machines: taxo };
    var newContent = JSON.stringify(newTaxonomy, null, 2);

    /* 3. PUT taxonomy.json */
    var put1 = await putFichierGitHub(taxoApi, headers, newContent, fichier.sha, cfg.branch, 'chore(taxonomy): mise à jour via éditeur PWA');
    if (put1.status === 409) {
      var frais = await lireFichierGitHub(taxoApi, headers, cfg.branch);
      put1 = await putFichierGitHub(taxoApi, headers, newContent, frais.sha, cfg.branch, 'chore(taxonomy): mise à jour via éditeur PWA');
    }
    if (!put1.ok) {
      var err = {}; try { err = await put1.json(); } catch(_) {}
      throw new Error('taxonomy.json : ' + put1.status + ' — ' + (err.message || put1.statusText));
    }

    /* 4. Mettre à jour version.json */
    var vApi = apiBase + VERSION_FILE;
    var vFichier = await lireFichierGitHub(vApi, headers, cfg.branch);
    var newVContent = JSON.stringify({ version: newVersion, date: new Date().toISOString().slice(0, 10), changelog: 'Mise à jour via éditeur PWA' }, null, 2);
    var put2 = await putFichierGitHub(vApi, headers, newVContent, vFichier.sha, cfg.branch, 'chore(taxonomy): bump version ' + newVersion);
    if (!put2.ok) { showToast('taxonomy.json poussé, version.json échoué', 'error'); return; }

    /* 5. Mettre à jour le cache local */
    sauvegarder();
    showToast('Push réussi — v' + newVersion, 'success');

  } catch(err) {
    console.error('[MUF-RI-Editor] Push error:', err);
    showToast('Erreur : ' + err.message, 'error');
  } finally {
    pushEnCours = false;
    btn.disabled = false; btn.style.opacity = '';
  }
}

function bumperVersion(v) {
  var parts = (v || '1.0.0').split('.').map(Number);
  parts[2] = (parts[2] || 0) + 1;
  return parts.join('.');
}

var btnPush = document.getElementById('te-push');
if (btnPush && !btnPush.dataset.bound) {
  btnPush.dataset.bound = '1';
  btnPush.addEventListener('click', gererPush);
}

/* =====================================================
   TOOLBAR — Copier JSON, Reset
   ===================================================== */
document.getElementById('te-copy-json').addEventListener('click', function() {
  navigator.clipboard.writeText(JSON.stringify(taxo, null, 2)).then(function() {
    showToast('JSON copié', 'success');
  });
});

document.getElementById('te-reset').addEventListener('click', function() {
  if (!confirm('Réinitialiser depuis GitHub ? Les modifications non poussées seront perdues.')) return;
  localStorage.removeItem(LS_KEY);
  taxo = {};
  charger().then(function() {
    activeMachineKey = null;
    renderTabs();
    if (machineKeys().length) switchMachine(machineKeys()[0]);
    showToast('Taxonomie rechargée depuis GitHub', 'info');
  });
});

/* =====================================================
   IMPORT JSON
   ===================================================== */
var importOverlay = document.getElementById('te-import-overlay');
var importTextarea = document.getElementById('te-import-textarea');

document.getElementById('te-import-json').addEventListener('click', function() {
  importTextarea.value = '';
  importOverlay.classList.add('open');
  setTimeout(function() { importTextarea.focus(); }, 50);
});
document.getElementById('te-import-cancel').addEventListener('click', function() {
  importOverlay.classList.remove('open');
});
importOverlay.addEventListener('click', function(e) {
  if (e.target === importOverlay) importOverlay.classList.remove('open');
});
document.getElementById('te-import-confirm').addEventListener('click', function() {
  var brut = (importTextarea.value || '').trim();
  if (!brut) { showToast('Aucun contenu', 'error'); return; }
  var result;
  try { result = JSON.parse(brut); } catch(e) { showToast('JSON invalide : ' + e.message, 'error'); return; }
  /* Support format enveloppé {machines:{...}} ou plat */
  if (result.machines) result = result.machines;
  var machines = Object.keys(result).filter(function(k) { return !estCleReservee(k); });
  if (!machines.length) { showToast('Aucune machine trouvée', 'error'); return; }
  taxo = migrerSiNecessaire(result);
  sauvegarder();
  activeMachineKey = null;
  renderTabs();
  switchMachine(machineKeys()[0]);
  importOverlay.classList.remove('open');
  showToast('Taxonomie importée', 'success');
});

/* =====================================================
   BLOCKLY — DÉFINITIONS DES BLOCS
   ===================================================== */
var blockDefs = [
  {
    type: 'taxo_station',
    message0: 'Station: %1',
    args0: [{ type: 'field_input', name: 'LABEL', text: 'Nouvelle station' }],
    message1: 'sous-catégories %1',
    args1: [{ type: 'input_statement', name: 'SUBCATS', check: 'SUBCAT' }],
    previousStatement: 'STATION', nextStatement: 'STATION',
    colour: 150, tooltip: 'Bloc Station (niveau 2)'
  },
  {
    type: 'taxo_subcat',
    message0: 'Sous-cat: %1',
    args0: [{ type: 'field_input', name: 'LABEL', text: 'Nouvelle sous-catégorie' }],
    message1: 'éléments %1',
    args1: [{ type: 'input_statement', name: 'ELEMENTS', check: 'ELEMENT' }],
    previousStatement: 'SUBCAT', nextStatement: 'SUBCAT',
    colour: 30, tooltip: 'Bloc Sous-catégorie (niveau 3)'
  },
  {
    type: 'taxo_element',
    message0: '⚙ Élément: %1',
    args0: [{ type: 'field_input', name: 'LABEL', text: 'Nouvel élément' }],
    message1: 'actions %1',
    args1: [{ type: 'input_statement', name: 'ACTIONS', check: 'ACTION' }],
    previousStatement: 'ELEMENT', nextStatement: 'ELEMENT',
    colour: 0, tooltip: 'Élément de maintenance (niveau 4)'
  },
  {
    type: 'taxo_action',
    message0: '%1 note %2 états (/) %3',
    args0: [
      { type: 'field_dropdown', name: 'ACTION_TYPE', options: [
        ['✓ Contrôle','controle'], ['🧹 Nettoyage','nettoyage'],
        ['🔄 Remplacement','remplacement'], ['🟡 Graissage','graissage'],
        ['💧 Lubrification','lubrification'], ['⚙ Réglage','reglage']
      ]},
      { type: 'field_input', name: 'NOTE', text: '' },
      { type: 'field_input', name: 'ETATS', text: '' }
    ],
    inputsInline: true,
    previousStatement: 'ACTION', nextStatement: 'ACTION',
    colour: 65,
    tooltip: "Action. note = précision libre ; états (/) = liste Bon/Moyen/Dégradé → menu déroulant dans le rapport."
  }
];

var toolbox = {
  kind: 'flyoutToolbox',
  contents: [
    { kind: 'label', text: 'Niveaux taxonomie' },
    { kind: 'block', type: 'taxo_station' },
    { kind: 'block', type: 'taxo_subcat' },
    { kind: 'block', type: 'taxo_element' },
    { kind: 'label', text: 'Actions' },
    { kind: 'block', type: 'taxo_action' }
  ]
};

var FOLD_ICON_SRC = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><path d="M3 5l4 4 4-4z" fill="white"/></svg>'
);
var TYPES_REPLIABLES = ['taxo_station', 'taxo_subcat'];

/* =====================================================
   BLOCKLY — INIT
   ===================================================== */
function initBlockly() {
  blockDefs.forEach(function(def) {
    var repliable = TYPES_REPLIABLES.indexOf(def.type) !== -1;
    Blockly.Blocks[def.type] = {
      init: function() {
        this.jsonInit(def);
        if (repliable) {
          var self = this;
          var icon = new Blockly.FieldImage(FOLD_ICON_SRC, 14, 14, '▾ plier', function() {
            dernierRepliId = self.id;
            dernierRepliTs = Date.now();
            self.setCollapsed(true);
          });
          this.inputList[0].insertFieldAt(0, icon, 'FOLD_ICON');
        }
      }
    };
  });

  var theme = (Blockly.Themes && Blockly.Themes.Zelos)
    ? Blockly.Themes.Zelos
    : (Blockly.Themes && Blockly.Themes.Classic ? Blockly.Themes.Classic : undefined);

  var cfg = { toolbox: toolbox, scrollbars: true, trashcan: true, collapse: true,
    move: { scrollbars: true, drag: true, wheel: true },
    zoom: { controls: true, wheel: true, startScale: 0.9 } };
  if (theme) cfg.theme = theme;

  workspace = Blockly.inject('te-workspace', cfg);

  renderTabs();
  if (machineKeys().length) switchMachine(machineKeys()[0]);

  workspace.addChangeListener(function(event) {
    if (chargementEnCours || event.isUiEvent) return;
    if (!activeMachineKey) return;
    taxo[activeMachineKey].stations = extraireStations(workspace);
    sauvegarder();
  });

  injectionDiv = workspace.getInjectionDiv();
  onInjectionClick = function(e) {
    var blocks = workspace.getAllBlocks(false);
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (TYPES_REPLIABLES.indexOf(b.type) === -1 || !b.isCollapsed()) continue;
      var root = b.getSvgRoot && b.getSvgRoot();
      if (root && root.contains(e.target)) {
        if (b.id === dernierRepliId && (Date.now() - dernierRepliTs) < 500) return;
        b.setCollapsed(false);
        return;
      }
    }
  };
  injectionDiv.addEventListener('click', onInjectionClick);
}

/* =====================================================
   ONGLETS MACHINES
   ===================================================== */
function slugifyKey(label) {
  var base = String(label).toLowerCase()
    .replace(/[àâä]/g,'a').replace(/[éèêë]/g,'e').replace(/[îï]/g,'i')
    .replace(/[ôö]/g,'o').replace(/[ùûü]/g,'u').replace(/[ç]/g,'c')
    .replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'') || 'machine';
  var existing = Object.keys(taxo).filter(function(k) { return !estCleReservee(k); });
  if (existing.indexOf(base) === -1) return base;
  var n = 2;
  while (existing.indexOf(base + '_' + n) !== -1) n++;
  return base + '_' + n;
}

function renderTabs() {
  var tabsEl = document.getElementById('te-tabs');
  if (!tabsEl) return;
  tabsEl.innerHTML = '';
  machineKeys().forEach(function(key) {
    var tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'te-tab' + (key === activeMachineKey ? ' active' : '');

    var lbl = document.createElement('span');
    lbl.textContent = taxo[key].label || key;
    lbl.addEventListener('click', function() { switchMachine(key); });

    var btnR = document.createElement('button');
    btnR.type = 'button'; btnR.className = 'te-tab-rename'; btnR.textContent = '✎'; btnR.title = 'Renommer';
    btnR.addEventListener('click', function(e) { e.stopPropagation(); renommerMachine(key); });

    var btnD = document.createElement('button');
    btnD.type = 'button'; btnD.className = 'te-tab-del'; btnD.textContent = '✕'; btnD.title = 'Supprimer';
    btnD.addEventListener('click', function(e) { e.stopPropagation(); supprimerMachine(key); });

    tab.appendChild(lbl); tab.appendChild(btnR); tab.appendChild(btnD);
    tabsEl.appendChild(tab);
  });
  var btnAdd = document.createElement('button');
  btnAdd.type = 'button'; btnAdd.className = 'te-tab-add'; btnAdd.textContent = '+ Machine';
  btnAdd.addEventListener('click', ajouterMachine);
  tabsEl.appendChild(btnAdd);
}

function switchMachine(key) {
  if (!key) return;
  if (activeMachineKey && !chargementEnCours && taxo[activeMachineKey]) {
    taxo[activeMachineKey].stations = extraireStations(workspace);
    sauvegarder();
  }
  activeMachineKey = key;
  chargementEnCours = true;
  workspace.clear();
  chargerMachineEnBlocs(workspace, key);
  chargementEnCours = false;
  renderTabs();
}

function ajouterMachine() {
  var nom = prompt('Nom de la nouvelle machine :');
  if (!nom || !nom.trim()) return;
  var key = slugifyKey(nom.trim());
  taxo[key] = { label: nom.trim(), stations: [] };
  sauvegarder();
  switchMachine(key);
}

function renommerMachine(key) {
  var nv = prompt('Nouveau nom :', taxo[key].label);
  if (nv && nv.trim()) { taxo[key].label = nv.trim(); sauvegarder(); renderTabs(); }
}

function supprimerMachine(key) {
  if (machineKeys().length <= 1) { showToast('Impossible de supprimer la dernière machine', 'error'); return; }
  if (!confirm('Supprimer "' + taxo[key].label + '" ?')) return;
  delete taxo[key];
  sauvegarder();
  activeMachineKey = null;
  switchMachine(machineKeys()[0]);
}

/* =====================================================
   BLOCKLY — CHARGEMENT / EXTRACTION
   ===================================================== */
function chargerMachineEnBlocs(ws, key) {
  var machine = taxo[key];
  if (!machine) return;
  var prevS = null;
  (machine.stations || []).forEach(function(station) {
    var sB = ws.newBlock('taxo_station');
    sB.setFieldValue(station.label, 'LABEL'); sB.initSvg(); sB.render();
    if (!prevS) sB.moveBy(20, 20);
    else if (prevS.nextConnection && sB.previousConnection) prevS.nextConnection.connect(sB.previousConnection);
    var prevSC = null;
    (station.subcats || []).forEach(function(subcat) {
      var scB = ws.newBlock('taxo_subcat');
      scB.setFieldValue(subcat.label, 'LABEL'); scB.initSvg(); scB.render();
      var conn = !prevSC ? sB.getInput('SUBCATS').connection : prevSC.nextConnection;
      if (conn && scB.previousConnection) conn.connect(scB.previousConnection);
      var prevE = null;
      (subcat.elements || []).forEach(function(elem) {
        var eB = ws.newBlock('taxo_element');
        eB.setFieldValue(elem.label || '', 'LABEL'); eB.initSvg(); eB.render();
        var eConn = !prevE ? scB.getInput('ELEMENTS').connection : prevE.nextConnection;
        if (eConn && eB.previousConnection) eConn.connect(eB.previousConnection);
        var prevA = null;
        (elem.actions || []).forEach(function(action) {
          var aType  = typeof action === 'string' ? action : (action.type || 'controle');
          var aNote  = typeof action === 'object' && action.note  ? action.note  : '';
          var aEtats = typeof action === 'object' ? (
            Array.isArray(action.etats) ? action.etats.join('/') : (action.etats || '')
          ) : '';
          var aB = ws.newBlock('taxo_action');
          aB.setFieldValue(aType, 'ACTION_TYPE');
          if (aNote)  aB.setFieldValue(aNote,  'NOTE');
          if (aEtats) aB.setFieldValue(aEtats, 'ETATS');
          aB.initSvg(); aB.render();
          var aConn = !prevA ? eB.getInput('ACTIONS').connection : prevA.nextConnection;
          if (aConn && aB.previousConnection) aConn.connect(aB.previousConnection);
          prevA = aB;
        });
        prevE = eB;
      });
      prevSC = scB;
    });
    prevS = sB;
  });
  ws.scrollCenter();
}

function extraireStations(ws) {
  var stations = [];
  ws.getTopBlocks(true).forEach(function(block) {
    var sB = block;
    while (sB) {
      if (sB.type === 'taxo_station') {
        var subcats = [];
        var subcatsInput = sB.getInput('SUBCATS');
        if (subcatsInput && subcatsInput.connection && subcatsInput.connection.targetBlock()) {
          var scB = subcatsInput.connection.targetBlock();
          while (scB) {
            if (scB.type === 'taxo_subcat') {
              var elements = [];
              var elemsInput = scB.getInput('ELEMENTS');
              if (elemsInput && elemsInput.connection && elemsInput.connection.targetBlock()) {
                var eB = elemsInput.connection.targetBlock();
                while (eB) {
                  if (eB.type === 'taxo_element') {
                    var actions = [];
                    var actInput = eB.getInput('ACTIONS');
                    if (actInput && actInput.connection && actInput.connection.targetBlock()) {
                      var aB = actInput.connection.targetBlock();
                      while (aB) {
                        if (aB.type === 'taxo_action') {
                          var obj = { type: aB.getFieldValue('ACTION_TYPE') };
                          var note = (aB.getFieldValue('NOTE') || '').trim();
                          var etats = (aB.getFieldValue('ETATS') || '').trim();
                          if (note)  obj.note  = note;
                          if (etats) obj.etats = etats;
                          actions.push(obj);
                        }
                        aB = aB.nextConnection && aB.nextConnection.targetBlock();
                      }
                    }
                    elements.push({ label: eB.getFieldValue('LABEL') || '', actions: actions });
                  }
                  eB = eB.nextConnection && eB.nextConnection.targetBlock();
                }
              }
              subcats.push({ label: scB.getFieldValue('LABEL') || '', elements: elements });
            }
            scB = scB.nextConnection && scB.nextConnection.targetBlock();
          }
        }
        stations.push({ label: sB.getFieldValue('LABEL') || '', subcats: subcats });
      }
      sB = sB.nextConnection && sB.nextConnection.targetBlock();
    }
  });
  return stations;
}

/* =====================================================
   SERVICE WORKER
   ===================================================== */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(function() {});
}

/* =====================================================
   DÉMARRAGE
   ===================================================== */
/* Bouton IA */
document.getElementById('te-ia-btn').addEventListener('click', function () {
  /* Réaffiche la vue accueil avant d'ouvrir */
  var actionsView = document.getElementById('ia-actions-view');
  if (actionsView) actionsView.style.display = '';
  document.getElementById('ia-modal-spinner').style.display  = 'none';
  document.getElementById('ia-modal-results').style.display  = 'none';
  document.getElementById('ia-modal-actions').style.display  = 'none';
  document.getElementById('ia-modal').classList.add('open');
});

/* =====================================================
   API PUBLIQUE pour ia.js
   ===================================================== */
window._getTaxo        = function () { return taxo; };
window._getMachineKey  = function () { return activeMachineKey; };
window._saveTaxo       = function () { sauvegarder(); };
window._reloadWorkspace = function () {
  if (!activeMachineKey || !workspace) return;
  chargementEnCours = true;
  workspace.clear();
  chargerMachineEnBlocs(workspace, activeMachineKey);
  chargementEnCours = false;
};

charger().then(function() {
  chargerConfig();
  majStatutAuth(!!getToken());
  if (window.Blockly) {
    initBlockly();
  } else {
    document.getElementById('te-workspace').innerHTML =
      '<p style="color:red;padding:20px;">Erreur : Blockly non chargé.</p>';
  }
});

})();
