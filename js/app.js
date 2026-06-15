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
var LS_GH_TOKEN   = 'muf_ri_taxo_token';

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
   AUTH GITHUB — PAT (Personal Access Token)
   ===================================================== */
var tokenInput  = document.getElementById('gh-token-input');
var tokenForget = document.getElementById('gh-token-forget');

/* Le PAT est conserve en localStorage (persiste entre les sessions) : poste
   personnel, persistance demandee par l'utilisateur. Migration douce depuis
   l'ancien stockage sessionStorage si une valeur y subsiste. */
(function migrerTokenDepuisSession() {
  if (localStorage.getItem(LS_GH_TOKEN)) return;
  var legacy = sessionStorage.getItem(LS_GH_TOKEN);
  if (legacy) {
    localStorage.setItem(LS_GH_TOKEN, legacy);
    sessionStorage.removeItem(LS_GH_TOKEN);
  }
})();

function getToken() { return localStorage.getItem(LS_GH_TOKEN) || ''; }

function majStatutAuth() {
  var tok = getToken();
  var statusEl = document.getElementById('gh-auth-status');
  var labelEl  = document.getElementById('gh-auth-label');
  if (tok) {
    statusEl.className = 'gh-auth-status connected';
    labelEl.textContent = 'Token actif';
  } else {
    statusEl.className = 'gh-auth-status disconnected';
    labelEl.textContent = 'Aucun token';
  }
}

if (tokenInput) {
  tokenInput.value = getToken();
  tokenInput.addEventListener('input', function () {
    var val = tokenInput.value.trim();
    if (val) {
      localStorage.setItem(LS_GH_TOKEN, val);
    } else {
      localStorage.removeItem(LS_GH_TOKEN);
    }
    majStatutAuth();
  });
}

if (tokenForget) {
  tokenForget.addEventListener('click', function () {
    localStorage.removeItem(LS_GH_TOKEN);
    if (tokenInput) tokenInput.value = '';
    majStatutAuth();
    showToast('Token GitHub oublié', 'info');
  });
}

majStatutAuth();

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
   VERROU DE DEPLACEMENT DES BLOCS (ergonomie tactile)
   -----------------------------------------------------
   Defaut : VERROUILLE. Persiste en localStorage (muf_ri_lock_blocs).
   Verrouille  -> les blocs existants ne peuvent plus etre DEPLACES
                  (block.setMovable(false)). L'edition des champs
                  (LABEL/NOTE/ETATS/menu ACTION_TYPE) et le repli/depli
                  restent fonctionnels (setMovable n'affecte que le drag).
   Deverrouille -> blocs deplacables/reorganisables normalement.

   Ajout / reorganisation : pour ajouter un bloc depuis la toolbox ou
   reorganiser l'arborescence, l'utilisateur DEVERROUILLE (un clic). C'est
   l'integration la plus simple et la plus previsible au tactile : pas de
   "fenetre" ambigue ou un bloc serait a moitie figé. Le verrou se reapplique
   a tous les blocs au prochain switchMachine / rechargement (ia.js) et au
   clic sur le bouton, donc l'etat est toujours coherent.
   ===================================================== */
var LS_LOCK = 'muf_ri_lock_blocs';

function estVerrouille() {
  var v = localStorage.getItem(LS_LOCK);
  return v === null ? true : v === '1'; // defaut verrouille si absent
}

function appliquerVerrou() {
  if (!workspace) return;
  var locked = estVerrouille();
  var blocks = workspace.getAllBlocks(false);
  for (var i = 0; i < blocks.length; i++) {
    blocks[i].setMovable(!locked);
  }
}

function majBoutonVerrou() {
  var btn = document.getElementById('te-lock');
  if (!btn) return;
  if (estVerrouille()) {
    btn.classList.remove('is-unlocked');
    btn.innerHTML = '🔒 Blocs verrouillés';
    btn.title = 'Les blocs ne peuvent pas être déplacés (édition des champs OK). Cliquer pour déverrouiller.';
  } else {
    btn.classList.add('is-unlocked');
    btn.innerHTML = '🔓 Blocs libres';
    btn.title = 'Les blocs sont déplaçables / réorganisables. Cliquer pour verrouiller.';
  }
}

document.getElementById('te-lock').addEventListener('click', function() {
  var nouvelEtat = !estVerrouille();
  localStorage.setItem(LS_LOCK, nouvelEtat ? '1' : '0');
  appliquerVerrou();
  majBoutonVerrou();
  showToast(
    nouvelEtat
      ? '🔒 Blocs verrouillés — déplacement bloqué (édition des champs OK)'
      : '🔓 Blocs libres — déplacement et ajout possibles',
    'info'
  );
});

majBoutonVerrou();

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

  /* Ergonomie tactile (iPad) : Blockly demarre un glisser des ~5 px de mouvement
     (Blockly.config.dragRadius, defaut 5). Au doigt, le moindre frolement/scroll
     depasse ce seuil et deplace les blocs par accident. On releve le seuil a 22 px :
     un glisser volontaire (le doigt parcourt une vraie distance) fonctionne toujours,
     mais un tap/scroll/frolement ne deplace plus rien.
     flyoutDragRadius (defaut 10) gere le glisser depuis la toolbox -> releve a 22 aussi
     pour la coherence. Ces valeurs sont lues "en direct" par Blockly, mais on les pose
     avant l'injection par securite. */
  if (Blockly.config) {
    Blockly.config.dragRadius = 22;
    Blockly.config.flyoutDragRadius = 22;
  }

  var cfg = { toolbox: toolbox, scrollbars: true, trashcan: true, collapse: true,
    move: { scrollbars: true, drag: true, wheel: true },
    zoom: { controls: true, wheel: true, startScale: 0.9 } };
  if (theme) cfg.theme = theme;

  workspace = Blockly.inject('te-workspace', cfg);

  appliquerVerrou();

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
  appliquerVerrou();
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
   SYNC ENTRE APPAREILS — export / import chiffré par PIN
   -----------------------------------------------------
   Permet de transférer les accès (PAT GitHub + clé Gemini + config
   owner/repo/branch) d'un appareil à l'autre sans backend ni re-saisie.
   La sortie est une chaîne texte copiable (AirDrop/Notes/mail).

   Schéma cryptographique (Web Crypto SubtleCrypto, aucune lib externe) :
     - Dérivation de clé : PBKDF2(PIN, sel, 150000 itérations, SHA-256)
       → clé AES-GCM 256 bits.
     - Chiffrement : AES-GCM avec IV aléatoire de 12 octets ; le tag
       d'authentification est inclus par l'API (intégrité vérifiée au
       déchiffrement → un PIN faux échoue proprement).
     - Sel aléatoire de 16 octets (crypto.getRandomValues).

   Format de la chaîne exportée :
     "MUFRI1." + base64url( sel[16] || iv[12] || ciphertext )
     - Préfixe de version "MUFRI1." pour détecter un format inconnu.
     - base64url : variante URL-safe ('+'→'-', '/'→'_', sans '='),
       robuste au copier/coller (pas de retour à la ligne, mail-safe).
     - Le payload clair (avant chiffrement) est un JSON :
         { v:1, token?:<PAT>, gemini?:<cléGemini>, gh?:{owner,repo,branch} }
       Les secrets absents sont omis. Aucun secret n'apparaît en clair
       dans la chaîne finale.
   ===================================================== */
var SYNC_PREFIX = 'MUFRI1.';
var SYNC_PBKDF2_ITER = 150000;

/* Uint8Array → base64url (URL-safe, sans padding). */
function bytesToB64url(bytes) {
  var bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* base64url → Uint8Array. */
function b64urlToBytes(b64) {
  var s = String(b64 || '').replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  while (s.length % 4) s += '=';
  var bin = atob(s);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/* Dérive une clé AES-GCM 256 bits à partir du PIN et d'un sel. */
async function deriverCleSync(pin, sel) {
  var baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pin), { name: 'PBKDF2' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: sel, iterations: SYNC_PBKDF2_ITER, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/* Chiffre le payload (objet) avec le PIN → chaîne "MUFRI1.<base64url>". */
async function chiffrerSync(payload, pin) {
  var sel = crypto.getRandomValues(new Uint8Array(16));
  var iv  = crypto.getRandomValues(new Uint8Array(12));
  var cle = await deriverCleSync(pin, sel);
  var clair = new TextEncoder().encode(JSON.stringify(payload));
  var chiffreBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, cle, clair);
  var chiffre = new Uint8Array(chiffreBuf);
  var concat = new Uint8Array(sel.length + iv.length + chiffre.length);
  concat.set(sel, 0);
  concat.set(iv, sel.length);
  concat.set(chiffre, sel.length + iv.length);
  return SYNC_PREFIX + bytesToB64url(concat);
}

/* Déchiffre une chaîne "MUFRI1.<base64url>" avec le PIN → objet payload.
   Lève une erreur si préfixe inconnu, chaîne malformée ou PIN incorrect. */
async function dechiffrerSync(chaine, pin) {
  var s = String(chaine || '').trim();
  if (s.indexOf(SYNC_PREFIX) !== 0) throw new Error('Préfixe inconnu');
  var concat = b64urlToBytes(s.slice(SYNC_PREFIX.length));
  if (concat.length < 16 + 12 + 1) throw new Error('Chaîne malformée');
  var sel = concat.slice(0, 16);
  var iv  = concat.slice(16, 28);
  var chiffre = concat.slice(28);
  var cle = await deriverCleSync(pin, sel);
  var clairBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, cle, chiffre);
  return JSON.parse(new TextDecoder().decode(clairBuf));
}

/* ---- UI Export ---- */
var syncExportOverlay  = document.getElementById('sync-export-overlay');
var syncExportPin      = document.getElementById('sync-export-pin');
var syncExportField    = document.getElementById('sync-export-result-field');
var syncExportTextarea = document.getElementById('sync-export-textarea');
var syncExportConfirm  = document.getElementById('sync-export-confirm');
var syncExportCopy     = document.getElementById('sync-export-copy');

function resetSyncExport() {
  syncExportPin.value = '';
  syncExportTextarea.value = '';
  syncExportField.style.display = 'none';
  syncExportCopy.style.display = 'none';
  syncExportConfirm.style.display = '';
}

document.getElementById('sync-export-btn').addEventListener('click', function () {
  resetSyncExport();
  syncExportOverlay.classList.add('open');
  setTimeout(function () { syncExportPin.focus(); }, 50);
});
document.getElementById('sync-export-cancel').addEventListener('click', function () {
  syncExportOverlay.classList.remove('open');
});
syncExportOverlay.addEventListener('click', function (e) {
  if (e.target === syncExportOverlay) syncExportOverlay.classList.remove('open');
});

syncExportConfirm.addEventListener('click', async function () {
  var pin = (syncExportPin.value || '').trim();
  if (!pin) { showToast('Saisissez un PIN', 'error'); return; }

  /* Construire le payload, en omettant proprement les secrets absents. */
  var payload = { v: 1 };
  var tok = getToken();
  if (tok) payload.token = tok;
  var gemini = (window.IA && window.IA.getKey) ? window.IA.getKey() : '';
  if (gemini) payload.gemini = gemini;
  var cfg = lireConfig();
  if (cfg.owner || cfg.repo || cfg.branch) {
    payload.gh = { owner: cfg.owner, repo: cfg.repo, branch: cfg.branch };
  }
  if (!payload.token && !payload.gemini) {
    showToast('Aucun accès à exporter', 'error');
    return;
  }

  try {
    var chaine = await chiffrerSync(payload, pin);
    syncExportTextarea.value = chaine;
    syncExportField.style.display = '';
    syncExportCopy.style.display = '';
    syncExportConfirm.style.display = 'none';
    showToast('Accès chiffrés ✓', 'success');
    setTimeout(function () { syncExportTextarea.focus(); syncExportTextarea.select(); }, 50);
  } catch (err) {
    console.error('[MUF-RI-Editor] Export error:', err);
    showToast('Échec du chiffrement', 'error');
  }
});

syncExportCopy.addEventListener('click', function () {
  navigator.clipboard.writeText(syncExportTextarea.value).then(function () {
    showToast('Chaîne copiée', 'success');
  }).catch(function () {
    syncExportTextarea.select();
    showToast('Copiez manuellement la sélection', 'info');
  });
});

/* ---- UI Import ---- */
var syncImportOverlay  = document.getElementById('sync-import-overlay');
var syncImportTextarea = document.getElementById('sync-import-textarea');
var syncImportPin      = document.getElementById('sync-import-pin');

document.getElementById('sync-import-btn').addEventListener('click', function () {
  syncImportTextarea.value = '';
  syncImportPin.value = '';
  syncImportOverlay.classList.add('open');
  setTimeout(function () { syncImportTextarea.focus(); }, 50);
});
document.getElementById('sync-import-cancel').addEventListener('click', function () {
  syncImportOverlay.classList.remove('open');
});
syncImportOverlay.addEventListener('click', function (e) {
  if (e.target === syncImportOverlay) syncImportOverlay.classList.remove('open');
});

document.getElementById('sync-import-confirm').addEventListener('click', async function () {
  var chaine = (syncImportTextarea.value || '').trim();
  var pin    = (syncImportPin.value || '').trim();
  if (!chaine || !pin) { showToast('Chaîne et PIN requis', 'error'); return; }

  var payload;
  try {
    payload = await dechiffrerSync(chaine, pin);
  } catch (err) {
    showToast('PIN incorrect ou données invalides', 'error');
    return;
  }
  if (!payload || typeof payload !== 'object') {
    showToast('PIN incorrect ou données invalides', 'error');
    return;
  }

  /* Appliquer le PAT GitHub. */
  if (payload.token) {
    localStorage.setItem(LS_GH_TOKEN, payload.token);
    if (tokenInput) tokenInput.value = payload.token;
  }
  /* Appliquer la clé Gemini via l'API exposée par ia.js. */
  if (payload.gemini && window.IA && window.IA.setKey) {
    window.IA.setKey(payload.gemini);
  }
  /* Appliquer la config GitHub si présente. */
  if (payload.gh && typeof payload.gh === 'object') {
    var gh = payload.gh;
    if (gh.owner)  document.getElementById('gh-owner').value  = gh.owner;
    if (gh.repo)   document.getElementById('gh-repo').value   = gh.repo;
    if (gh.branch) document.getElementById('gh-branch').value = gh.branch;
    localStorage.setItem(LS_GH, JSON.stringify({
      owner: document.getElementById('gh-owner').value.trim(),
      repo: document.getElementById('gh-repo').value.trim(),
      branch: document.getElementById('gh-branch').value.trim() || 'main'
    }));
  }

  /* Rafraîchir les statuts UI. */
  majStatutAuth();

  syncImportOverlay.classList.remove('open');
  showToast('Accès importés ✓', 'success');
});

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
  appliquerVerrou();
};

charger().then(function() {
  chargerConfig();
  majStatutAuth();
  if (window.Blockly) {
    initBlockly();
  } else {
    document.getElementById('te-workspace').innerHTML =
      '<p style="color:red;padding:20px;">Erreur : Blockly non chargé.</p>';
  }
});

})();
