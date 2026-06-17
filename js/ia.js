(function () {
'use strict';

/* =====================================================
   GEMINI API
   ===================================================== */
/* Modèle Gemini par défaut. `gemini-flash-latest` est l'alias officiel qui
   pointe toujours vers le modèle Flash courant (couvert par le free tier).
   L'ancien `gemini-2.0-flash` a été déprécié (févr. 2026) puis retiré le
   3 mars 2026 → il ne sert plus aucune requête (quota limit:0). Le modèle est
   désormais configurable (localStorage GEMINI_MODEL_LS_KEY) pour absorber les
   futures dépréciations Google sans toucher au code. */
var GEMINI_DEFAULT_MODEL = 'gemini-flash-latest';
var GEMINI_LS_KEY        = 'muf_ri_gemini_key';
var GEMINI_MODEL_LS_KEY  = 'muf_ri_gemini_model';

/* La cle Gemini est conservee en localStorage (persiste entre les sessions) :
   poste personnel, persistance demandee par l'utilisateur. Migration douce
   depuis l'ancien stockage sessionStorage si une valeur y subsiste. */
(function migrerCleDepuisSession() {
  if (localStorage.getItem(GEMINI_LS_KEY)) return;
  var legacy = sessionStorage.getItem(GEMINI_LS_KEY);
  if (legacy) {
    localStorage.setItem(GEMINI_LS_KEY, legacy);
    sessionStorage.removeItem(GEMINI_LS_KEY);
  }
})();

function getApiKey() { return localStorage.getItem(GEMINI_LS_KEY) || ''; }

/* Modèle IA configuré (fallback sur le défaut si absent/vide). */
function getModel() {
  var m = (localStorage.getItem(GEMINI_MODEL_LS_KEY) || '').trim();
  return m || GEMINI_DEFAULT_MODEL;
}

async function callGemini(prompt) {
  var key = getApiKey();
  if (!key) throw new Error('Clé API Gemini manquante — saisissez-la dans ⚙ Config');

  var resp = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + getModel() + ':generateContent?key=' + key,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: 'application/json', temperature: 0.2 }
      })
    }
  );

  if (!resp.ok) {
    var errData = {};
    try { errData = await resp.json(); } catch (_) {}
    var msg = (errData.error && errData.error.message) || 'Erreur Gemini ' + resp.status;
    /* Quota / modèle introuvable ou retiré : oriente vers le réglage Config. */
    if (resp.status === 429 || resp.status === 404 || resp.status === 400 || /quota|model/i.test(msg)) {
      msg += ' (Vérifiez le modèle IA dans ⚙ Config)';
    }
    throw new Error(msg);
  }

  var data = await resp.json();
  var text = data.candidates && data.candidates[0] &&
             data.candidates[0].content && data.candidates[0].content.parts &&
             data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
  if (!text) throw new Error('Réponse vide de Gemini');
  return JSON.parse(text);
}

/* =====================================================
   BASE DE CONNAISSANCES MULTIVAC (grounding)
   Récupère la doc de référence depuis le dépôt PRIVÉ
   nitroks14/muf-knowledge via l'API GitHub + le PAT déjà saisi
   par l'utilisateur (window._getGithubToken, exposé par app.js).
   Cache local par fichier + repli silencieux si indisponible :
   les Suggestions continuent de fonctionner sans grounding.
   ===================================================== */
var KB_REPO    = 'nitroks14/muf-knowledge';
var KB_BRANCH  = 'main';
var KB_LS_PREFIX = 'muf_kb_';

/* Description des familles : fichier source + clé de cache localStorage. */
var KB_FAMILLES = {
  C: { file: 'knowledge-serie-C.json', ls: KB_LS_PREFIX + 'serie_C' },
  T: { file: 'knowledge-serie-T.json', ls: KB_LS_PREFIX + 'serie_T' },
  R: { file: 'knowledge-serie-R.json', ls: KB_LS_PREFIX + 'serie_R' }
};

/* Normalise une chaîne pour un matching robuste (minuscule, sans accents). */
function kbNorm(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/* Mappe une machine (clé + label) vers une famille (C / T / R) ou null. */
function detecterFamille(machineKey, machineLabel) {
  var s = kbNorm(machineKey) + ' ' + kbNorm(machineLabel);
  if (/cloche|serie c\b|serie-c\b/.test(s)) return 'C';
  if (/operculeuse|traysealer|serie t\b|serie-t\b/.test(s)) return 'T';
  if (/thermoform|serie r\b|serie-r\b/.test(s)) return 'R';
  return null;
}

/* Lit le contenu en cache pour une famille (objet parsé) ou null. */
function lireCacheConnaissances(fam) {
  var desc = KB_FAMILLES[fam];
  if (!desc) return null;
  try {
    var raw = localStorage.getItem(desc.ls);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

/* Fetch le fichier de connaissances d'une famille via l'API GitHub (dépôt privé).
   Renvoie l'objet parsé, ou null en cas d'absence de PAT / erreur (repli). */
async function fetchConnaissances(fam) {
  var desc = KB_FAMILLES[fam];
  if (!desc) return null;

  var token = (typeof window._getGithubToken === 'function') ? window._getGithubToken() : '';
  if (!token) { console.warn('[KB] Pas de PAT GitHub — grounding désactivé.'); return null; }

  try {
    var resp = await fetch(
      'https://api.github.com/repos/' + KB_REPO + '/contents/' + desc.file + '?ref=' + KB_BRANCH,
      { headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github.raw' } }
    );
    if (!resp.ok) { console.warn('[KB] Échec fetch ' + desc.file + ' (' + resp.status + ') — repli sans grounding.'); return null; }
    var text = await resp.text();
    var obj  = JSON.parse(text);
    try { localStorage.setItem(desc.ls, text); } catch (_) {}
    return obj;
  } catch (e) {
    console.warn('[KB] Erreur réseau/parse pour ' + desc.file + ' — repli sans grounding.', e);
    return null;
  }
}

/* Charge les connaissances de la famille active.
   Stratégie : sert le cache immédiatement s'il existe (et rafraîchit en
   arrière-plan, best-effort) ; sinon fetch synchrone. Repli → null. */
async function chargerConnaissances(fam) {
  if (!KB_FAMILLES[fam]) return null;
  var cached = lireCacheConnaissances(fam);
  if (cached) {
    /* Rafraîchissement best-effort, sans bloquer ni propager d'erreur. */
    fetchConnaissances(fam).catch(function () {});
    return cached;
  }
  return await fetchConnaissances(fam);
}

/* Construit un bloc de contexte condensé à partir des entrées d'une famille.
   Privilégie les domaines pertinents puis complète ; tronque à ~12000 car. */
function construireContexteConnaissances(kb) {
  if (!kb || !Array.isArray(kb.entries) || !kb.entries.length) return '';
  var PRIORITAIRES = { structure: 1, maintenance: 1, lubrification: 1, process: 1 };
  var entries = kb.entries.slice().sort(function (a, b) {
    var pa = PRIORITAIRES[kbNorm(a.domaine)] ? 0 : 1;
    var pb = PRIORITAIRES[kbNorm(b.domaine)] ? 0 : 1;
    return pa - pb;
  });

  var MAX = 12000;
  var lignes = [];
  var taille = 0;
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var parts = [];
    if (e.sujet)   parts.push(e.sujet);
    if (e.contenu) parts.push(e.contenu);
    if (e.periodicite) parts.push('[périodicité : ' + e.periodicite + ']');
    if (!parts.length) continue;
    var prefixe = [];
    if (e.station)   prefixe.push(e.station);
    if (e.composant) prefixe.push(e.composant);
    var entete = (e.domaine ? '(' + e.domaine + ') ' : '') + (prefixe.length ? prefixe.join(' › ') + ' — ' : '');
    var ligne = '- ' + entete + parts.join(' : ');
    if (taille + ligne.length > MAX) break;
    lignes.push(ligne);
    taille += ligne.length + 1;
  }
  return lignes.join('\n');
}

/* =====================================================
   HELPERS TAXONOMIE
   ===================================================== */
/* Applique les remplacements de texte UNIQUEMENT à l'intérieur de l'objet
   `node` fourni (ex. la machine active). Évite qu'un libellé identique présent dans
   une autre machine soit modifié par erreur. */
function applyTextReplacementsInNode(node, map) {
  function walk(obj) {
    if (typeof obj === 'string') return map[obj] !== undefined ? map[obj] : obj;
    if (Array.isArray(obj)) { for (var i = 0; i < obj.length; i++) obj[i] = walk(obj[i]); return obj; }
    if (obj && typeof obj === 'object') {
      var keys = Object.keys(obj);
      for (var k = 0; k < keys.length; k++) obj[keys[k]] = walk(obj[keys[k]]);
    }
    return obj;
  }
  return walk(node);
}

/* Extrait les libellés/notes d'UNE seule machine (objet machine), pas de toute la taxo. */
function extractMachineTexts(machine) {
  var list = [];
  if (machine.label) list.push(machine.label);
  (machine.stations || []).forEach(function (s) {
    if (s.label) list.push(s.label);
    (s.subcats || []).forEach(function (sc) {
      if (sc.label) list.push(sc.label);
      (sc.elements || []).forEach(function (e) {
        if (e.label) list.push(e.label);
        (e.actions || []).forEach(function (a) { if (a.note) list.push(a.note); });
      });
    });
  });
  return list;
}

/* =====================================================
   MODAL IA
   ===================================================== */
var modal = document.getElementById('ia-modal');
var modalTitle   = document.getElementById('ia-modal-title');
var modalSpinner = document.getElementById('ia-modal-spinner');
var modalResults = document.getElementById('ia-modal-results');
var modalActions = document.getElementById('ia-modal-actions');
var btnAccept    = document.getElementById('ia-btn-accept');
var btnReject    = document.getElementById('ia-btn-reject');

var _pendingApply = null;

function openModal(title) {
  modalTitle.textContent   = title;
  modalSpinner.style.display = 'flex';
  modalResults.innerHTML   = '';
  modalResults.style.display = 'none';
  modalActions.classList.remove('visible');
  _pendingApply = null;
  var actionsView = document.getElementById('ia-actions-view');
  if (actionsView) actionsView.style.display = 'none';
  modal.classList.add('open');
}

function showResults(html, onAccept) {
  modalSpinner.style.display   = 'none';
  modalResults.innerHTML       = html;
  modalResults.style.display   = 'block';
  if (onAccept) modalActions.classList.add('visible');
  else modalActions.classList.remove('visible');
  _pendingApply = onAccept || null;
}

/* Bouton « Tout cocher / Tout décocher » : HTML à insérer en tête d'une liste à cases.
   `selector` cible les cases concernées dans #ia-modal-results. */
function toggleAllButtonHtml() {
  return '<button type="button" class="ia-toggle-all" data-toggle-all>Tout décocher</button>';
}

/* Câble le(s) bouton(s) « tout cocher/décocher » présents dans la zone de résultats.
   Bascule toutes les cases `selector` selon leur état majoritaire courant. */
function wireToggleAll(selector) {
  modalResults.querySelectorAll('[data-toggle-all]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var boxes = modalResults.querySelectorAll(selector);
      var anyUnchecked = Array.prototype.some.call(boxes, function (b) { return !b.checked; });
      boxes.forEach(function (b) { b.checked = anyUnchecked; });
      btn.textContent = anyUnchecked ? 'Tout décocher' : 'Tout cocher';
    });
  });
}

function closeModal() {
  modal.classList.remove('open');
  _pendingApply = null;
  var actionsView = document.getElementById('ia-actions-view');
  if (actionsView) actionsView.style.display = '';
  var picker = document.getElementById('ia-transfert-picker');
  var grid   = document.querySelector('.ia-actions-grid');
  if (picker) picker.style.display = 'none';
  if (grid)   grid.style.display = '';
}

document.getElementById('ia-modal-close').addEventListener('click', closeModal);
modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });

btnReject.addEventListener('click', closeModal);
btnAccept.addEventListener('click', function () {
  if (_pendingApply) _pendingApply();
  closeModal();
});

/* =====================================================
   1. CORRECTION ORTHOGRAPHIQUE
   ===================================================== */
document.getElementById('ia-btn-ortho').addEventListener('click', async function () {
  openModal('Correction orthographique');
  try {
    var taxo = window._getTaxo();
    var machineKey = window._getMachineKey();
    if (!machineKey || !taxo[machineKey]) {
      showResults('<p class="ia-error">Aucune machine active sélectionnée.</p>', null);
      return;
    }
    var machine = taxo[machineKey];
    var uniques = Array.from(new Set(extractMachineTexts(machine))).filter(Boolean);

    var prompt = 'Tu es un expert en français technique industriel (maintenance de machines d\'emballage alimentaire).\n' +
      'Voici une liste de libellés et notes issus d\'une taxonomie de maintenance. ' +
      'Corrige UNIQUEMENT les fautes d\'orthographe, de grammaire et les accents manquants. ' +
      'Ne change pas le sens technique, les abréviations connues, les acronymes ou les noms propres. ' +
      'Si un libellé est déjà correct, retourne-le identique.\n\n' +
      'Libellés :\n' + uniques.map(function (t, i) { return (i + 1) + '. ' + t; }).join('\n') + '\n\n' +
      'Retourne un JSON avec exactement ce format :\n' +
      '{"corrections": [{"original": "libellé original", "corrected": "libellé corrigé"}]}';

    var result = await callGemini(prompt);
    var corrections = (result.corrections || []).filter(function (c) { return c.original !== c.corrected; });

    if (!corrections.length) {
      showResults('<p class="ia-empty">✅ Aucune faute détectée pour cette machine.</p>', null);
      return;
    }

    var html = '<p class="ia-count">' + corrections.length + ' correction(s) proposée(s) pour <strong>' + esc(machine.label) + '</strong> :</p>' +
      toggleAllButtonHtml() +
      '<ul class="ia-list ia-checklist">' +
      corrections.map(function (c, i) {
        return '<li class="ia-check-item"><input type="checkbox" class="ia-chk-ortho" data-idx="' + i + '" checked /> ' +
          '<span><span class="ia-old">' + esc(c.original) + '</span> → <span class="ia-new">' + esc(c.corrected) + '</span></span></li>';
      }).join('') + '</ul>';

    showResults(html, function () {
      var map = {};
      var checked = modalResults.querySelectorAll('.ia-chk-ortho:checked');
      checked.forEach(function (chk) {
        var c = corrections[parseInt(chk.dataset.idx, 10)];
        map[c.original] = c.corrected;
      });
      var n = Object.keys(map).length;
      if (!n) { showToastIA('Aucune correction cochée', 'info'); return; }
      applyTextReplacementsInNode(taxo[machineKey], map);
      window._saveTaxo();
      window._reloadWorkspace();
      showToastIA('Corrections appliquées (' + n + ')', 'success');
    });
    wireToggleAll('.ia-chk-ortho');
  } catch (e) {
    showResults('<p class="ia-error">❌ ' + esc(e.message) + '</p>', null);
  }
});

/* =====================================================
   2. SUGGESTIONS CONTEXTUELLES
   ===================================================== */
document.getElementById('ia-btn-suggestions').addEventListener('click', async function () {
  openModal('Suggestions pour la machine active');
  try {
    var taxo = window._getTaxo();
    var machineKey = window._getMachineKey();
    if (!machineKey || !taxo[machineKey]) {
      showResults('<p class="ia-error">Aucune machine active sélectionnée.</p>', null);
      return;
    }
    var machine = taxo[machineKey];

    /* Grounding optionnel : connaissances Multivac de la famille active.
       Repli silencieux si pas de PAT / fetch en échec / famille inconnue. */
    var blocConnaissances = '';
    try {
      var fam = detecterFamille(machineKey, machine.label);
      if (fam) {
        var kb = await chargerConnaissances(fam);
        blocConnaissances = construireContexteConnaissances(kb);
      }
    } catch (_) { blocConnaissances = ''; }

    var groundingPrompt = '';
    if (blocConnaissances) {
      groundingPrompt =
        'CONNAISSANCES MULTIVAC DE RÉFÉRENCE (issues des notices officielles, à utiliser ' +
        'en priorité pour des suggestions réalistes et spécifiques à cette machine) :\n' +
        blocConnaissances + '\n\n' +
        'Base tes suggestions en PRIORITÉ sur ces connaissances Multivac réelles ET sur la ' +
        'taxonomie existante. Propose des éléments/actions cohérents avec la doc (composants, ' +
        'périodicités, points de graissage, etc.). N\'invente pas d\'éléments hors de ce cadre ' +
        'quand c\'est possible.\n\n';
    }

    var prompt = 'Tu es un expert en maintenance préventive de machines d\'emballage alimentaire industriel.\n' +
      groundingPrompt +
      'Voici la taxonomie actuelle de la machine "' + machine.label + '" :\n\n' +
      JSON.stringify(machine, null, 2) + '\n\n' +
      'Identifie les éléments de maintenance manquants ou les actions manquantes selon les bonnes pratiques industrielles. ' +
      'Propose des ajouts pertinents uniquement (ne répète pas l\'existant).\n\n' +
      'Retourne un JSON avec ce format :\n' +
      '{"suggestions": [{"station": "nom station", "subcat": "nom sous-cat", "element": "nom élément", "actions": ["controle","nettoyage"], "raison": "explication courte"}]}';

    var result = await callGemini(prompt);
    var suggestions = result.suggestions || [];

    if (!suggestions.length) {
      showResults('<p class="ia-empty">✅ La taxonomie semble complète pour cette machine.</p>', null);
      return;
    }

    var html = '<p class="ia-count">' + suggestions.length + ' suggestion(s) pour <strong>' + esc(machine.label) + '</strong> :</p>' +
      toggleAllButtonHtml() +
      '<div class="ia-suggestions">' +
      suggestions.map(function (s, i) {
        return '<div class="ia-suggestion-item" data-idx="' + i + '">' +
          '<label class="ia-suggestion-check"><input type="checkbox" class="ia-chk" data-idx="' + i + '" checked /> ' +
          '<strong>' + esc(s.station) + '</strong> › ' + esc(s.subcat) + ' › ' + esc(s.element) + '</label>' +
          '<div class="ia-suggestion-detail">Actions : ' + (s.actions || []).join(', ') + '</div>' +
          '<div class="ia-suggestion-raison">' + esc(s.raison) + '</div></div>';
      }).join('') + '</div>';

    showResults(html, function () {
      var checked = modalResults.querySelectorAll('.ia-chk:checked');
      var added = 0;
      checked.forEach(function (chk) {
        var idx = parseInt(chk.dataset.idx, 10);
        var s = suggestions[idx];
        var m = taxo[machineKey];
        var station = (m.stations || []).find(function (st) { return st.label === s.station; });
        if (!station) { station = { label: s.station, subcats: [] }; m.stations.push(station); }
        var subcat = (station.subcats || []).find(function (sc) { return sc.label === s.subcat; });
        if (!subcat) { subcat = { label: s.subcat, elements: [] }; station.subcats.push(subcat); }
        var exists = (subcat.elements || []).some(function (e) { return e.label === s.element; });
        if (!exists) {
          subcat.elements.push({ label: s.element, actions: (s.actions || []).map(function (a) { return { type: a }; }) });
          added++;
        }
      });
      window._saveTaxo();
      window._reloadWorkspace();
      showToastIA(added + ' élément(s) ajouté(s)', 'success');
    });
    wireToggleAll('.ia-chk');
  } catch (e) {
    showResults('<p class="ia-error">❌ ' + esc(e.message) + '</p>', null);
  }
});

/* =====================================================
   3. DÉTECTION DE DOUBLONS
   ===================================================== */
document.getElementById('ia-btn-doublons').addEventListener('click', async function () {
  openModal('Détection de doublons');
  try {
    var taxo = window._getTaxo();

    var prompt = 'Tu analyses une taxonomie de maintenance industrielle en JSON.\n\n' +
      JSON.stringify(taxo, null, 2) + '\n\n' +
      'Identifie les doublons ou quasi-doublons (libellés très similaires ou identiques) entre :\n' +
      '- stations de machines différentes\n- éléments de sous-catégories différentes\n- actions en double sur un même élément\n\n' +
      'Ne signale que les vrais doublons problématiques, pas les ressemblances normales entre machines similaires.\n\n' +
      'Retourne un JSON :\n' +
      '{"doublons": [{"type": "élément|station|action", "occurrences": ["chemin1", "chemin2"], "suggestion": "conseil pour résoudre"}]}';

    var result = await callGemini(prompt);
    var doublons = result.doublons || [];

    if (!doublons.length) {
      showResults('<p class="ia-empty">✅ Aucun doublon détecté dans la taxonomie.</p>', null);
      return;
    }

    var html = '<p class="ia-count">' + doublons.length + ' doublon(s) détecté(s) :</p><div class="ia-list-doublons">' +
      doublons.map(function (d) {
        return '<div class="ia-doublon-item">' +
          '<span class="ia-doublon-type">' + esc(d.type) + '</span>' +
          '<ul>' + (d.occurrences || []).map(function (o) { return '<li>' + esc(o) + '</li>'; }).join('') + '</ul>' +
          '<p class="ia-suggestion-raison">' + esc(d.suggestion) + '</p></div>';
      }).join('') + '</div>';

    showResults(html, null);
  } catch (e) {
    showResults('<p class="ia-error">❌ ' + esc(e.message) + '</p>', null);
  }
});

/* =====================================================
   4. NORMALISATION DES LIBELLÉS
   ===================================================== */
document.getElementById('ia-btn-normaliser').addEventListener('click', async function () {
  openModal('Normalisation des libellés');
  try {
    var taxo = window._getTaxo();
    var machineKey = window._getMachineKey();
    if (!machineKey || !taxo[machineKey]) {
      showResults('<p class="ia-error">Aucune machine active sélectionnée.</p>', null);
      return;
    }
    var machine = taxo[machineKey];
    var uniques = Array.from(new Set(extractMachineTexts(machine))).filter(Boolean);

    var prompt = 'Tu es un expert en terminologie de maintenance industrielle française.\n' +
      'Normalise ces libellés selon ces règles :\n' +
      '1. Première lettre en majuscule, reste en minuscule (sauf noms propres/acronymes)\n' +
      '2. Accents corrects (é, è, ê, à, ù, ô, î, û, ç)\n' +
      '3. Formulation cohérente (ex: toujours "Vanne de" pas "Vanne du/de la" de façon inconsistante)\n' +
      '4. Supprime les espaces superflus\n' +
      '5. Ne change pas le sens technique\n\n' +
      'Libellés :\n' + uniques.map(function (t, i) { return (i + 1) + '. ' + t; }).join('\n') + '\n\n' +
      'Retourne UNIQUEMENT les libellés qui changent vraiment :\n' +
      '{"normalisations": [{"original": "avant", "normalise": "après", "raison": "règle appliquée"}]}';

    var result = await callGemini(prompt);
    var normas = (result.normalisations || []).filter(function (n) { return n.original !== n.normalise; });

    if (!normas.length) {
      showResults('<p class="ia-empty">✅ Tous les libellés de cette machine sont déjà normalisés.</p>', null);
      return;
    }

    var html = '<p class="ia-count">' + normas.length + ' normalisation(s) proposée(s) pour <strong>' + esc(machine.label) + '</strong> :</p>' +
      toggleAllButtonHtml() +
      '<ul class="ia-list ia-checklist">' +
      normas.map(function (n, i) {
        return '<li class="ia-check-item"><input type="checkbox" class="ia-chk-norm" data-idx="' + i + '" checked /> ' +
          '<span><span class="ia-old">' + esc(n.original) + '</span> → <span class="ia-new">' + esc(n.normalise) + '</span>' +
          (n.raison ? '<span class="ia-raison"> — ' + esc(n.raison) + '</span>' : '') + '</span></li>';
      }).join('') + '</ul>';

    showResults(html, function () {
      var map = {};
      var checked = modalResults.querySelectorAll('.ia-chk-norm:checked');
      checked.forEach(function (chk) {
        var n = normas[parseInt(chk.dataset.idx, 10)];
        map[n.original] = n.normalise;
      });
      var cnt = Object.keys(map).length;
      if (!cnt) { showToastIA('Aucune normalisation cochée', 'info'); return; }
      applyTextReplacementsInNode(taxo[machineKey], map);
      window._saveTaxo();
      window._reloadWorkspace();
      showToastIA('Normalisation appliquée (' + cnt + ' libellés)', 'success');
    });
    wireToggleAll('.ia-chk-norm');
  } catch (e) {
    showResults('<p class="ia-error">❌ ' + esc(e.message) + '</p>', null);
  }
});

/* =====================================================
   5. TRANSFERT INTER-MACHINES
   ===================================================== */
var transfertPicker = document.getElementById('ia-transfert-picker');
var sourceSelect    = document.getElementById('ia-source-machine');
var targetSelect    = document.getElementById('ia-target-machine');
var iaActionsGrid   = document.querySelector('.ia-actions-grid');

document.getElementById('ia-btn-transfert').addEventListener('click', function () {
  var taxo = window._getTaxo();
  var machineKeys = Object.keys(taxo).filter(function (k) {
    return ['version', 'actionLabels', '_etats', '_etatsDefauts'].indexOf(k) === -1;
  });

  if (machineKeys.length < 2) {
    openModal('Transfert inter-machines');
    showResults('<p class="ia-error">Il faut au moins 2 machines dans la taxonomie pour utiliser cette fonction.</p>', null);
    return;
  }

  sourceSelect.innerHTML = machineKeys.map(function (k) {
    return '<option value="' + esc(k) + '">' + esc(taxo[k].label || k) + '</option>';
  }).join('');
  targetSelect.innerHTML = machineKeys.map(function (k) {
    return '<option value="' + esc(k) + '">' + esc(taxo[k].label || k) + '</option>';
  }).join('');
  if (machineKeys.length >= 2) targetSelect.value = machineKeys[1];

  if (iaActionsGrid) iaActionsGrid.style.display = 'none';
  transfertPicker.style.display = 'block';
});

document.getElementById('ia-btn-transfert-run').addEventListener('click', async function () {
  var taxo = window._getTaxo();
  var srcKey = sourceSelect.value;
  var tgtKey = targetSelect.value;

  if (!srcKey || !tgtKey) {
    alert('Sélectionnez une machine source et une machine cible.');
    return;
  }
  if (srcKey === tgtKey) {
    alert('La machine source et la machine cible doivent être différentes.');
    return;
  }

  var srcMachine = taxo[srcKey];
  var tgtMachine = taxo[tgtKey];

  transfertPicker.style.display = 'none';
  if (iaActionsGrid) iaActionsGrid.style.display = '';

  openModal('Transfert : ' + (srcMachine.label || srcKey) + ' → ' + (tgtMachine.label || tgtKey));

  try {
    var prompt = 'Tu es un expert en maintenance industrielle de machines d\'emballage alimentaire.\n' +
      'Machine SOURCE ("' + (srcMachine.label || srcKey) + '") :\n' +
      JSON.stringify(srcMachine, null, 2) + '\n\n' +
      'Machine CIBLE ("' + (tgtMachine.label || tgtKey) + '") :\n' +
      JSON.stringify(tgtMachine, null, 2) + '\n\n' +
      'Identifie les éléments de maintenance de la machine SOURCE qui seraient pertinents pour la machine CIBLE ' +
      '(même type d\'action, même composant ou composant équivalent). ' +
      'Ne propose que les éléments vraiment transférables (ignoré s\'ils existent déjà dans la cible). ' +
      'Adapte les libellés si nécessaire pour correspondre à la nomenclature de la machine cible.\n\n' +
      'Retourne un JSON :\n' +
      '{"transferts": [{"station": "nom station cible", "subcat": "nom sous-cat cible", ' +
      '"element": "libellé élément adapté", "actions": [{"type": "type action", "note": "note optionnelle"}], ' +
      '"raison": "pourquoi cet élément est pertinent pour la cible"}]}';

    var result = await callGemini(prompt);
    var transferts = result.transferts || [];

    if (!transferts.length) {
      showResults('<p class="ia-empty">✅ Aucun élément transférable identifié entre ces deux machines.</p>', null);
      return;
    }

    var html = '<p class="ia-count">' + transferts.length + ' élément(s) transférable(s) de <strong>' +
      esc(srcMachine.label || srcKey) + '</strong> vers <strong>' + esc(tgtMachine.label || tgtKey) + '</strong> :</p>' +
      toggleAllButtonHtml() +
      '<div class="ia-suggestions">' +
      transferts.map(function (t, i) {
        var actionsStr = (t.actions || []).map(function (a) { return a.type + (a.note ? ' (' + a.note + ')' : ''); }).join(', ');
        return '<div class="ia-suggestion-item" data-idx="' + i + '">' +
          '<label class="ia-suggestion-check"><input type="checkbox" class="ia-chk-tr" data-idx="' + i + '" checked /> ' +
          '<strong>' + esc(t.station) + '</strong> › ' + esc(t.subcat) + ' › ' + esc(t.element) + '</label>' +
          (actionsStr ? '<div class="ia-suggestion-detail">Actions : ' + esc(actionsStr) + '</div>' : '') +
          '<div class="ia-suggestion-raison">' + esc(t.raison) + '</div></div>';
      }).join('') + '</div>';

    showResults(html, function () {
      var checked = modalResults.querySelectorAll('.ia-chk-tr:checked');
      var added = 0;
      checked.forEach(function (chk) {
        var idx = parseInt(chk.dataset.idx, 10);
        var t = transferts[idx];
        var m = taxo[tgtKey];
        if (!m.stations) m.stations = [];
        var station = m.stations.find(function (st) { return st.label === t.station; });
        if (!station) { station = { label: t.station, subcats: [] }; m.stations.push(station); }
        if (!station.subcats) station.subcats = [];
        var subcat = station.subcats.find(function (sc) { return sc.label === t.subcat; });
        if (!subcat) { subcat = { label: t.subcat, elements: [] }; station.subcats.push(subcat); }
        if (!subcat.elements) subcat.elements = [];
        var exists = subcat.elements.some(function (e) { return e.label === t.element; });
        if (!exists) {
          subcat.elements.push({
            label: t.element,
            actions: (t.actions || []).map(function (a) {
              var act = { type: a.type };
              if (a.note) act.note = a.note;
              return act;
            })
          });
          added++;
        }
      });
      window._saveTaxo();
      window._reloadWorkspace();
      showToastIA(added + ' élément(s) transféré(s) vers ' + (tgtMachine.label || tgtKey), 'success');
    });
    wireToggleAll('.ia-chk-tr');
  } catch (e) {
    showResults('<p class="ia-error">❌ ' + esc(e.message) + '</p>', null);
  }
});

/* =====================================================
   CONFIG CLÉ GEMINI
   ===================================================== */
var keyInput  = document.getElementById('ia-gemini-key');
var keyForget = document.getElementById('ia-gemini-forget');
if (keyInput) {
  keyInput.value = getApiKey();
  keyInput.addEventListener('input', function () {
    var val = keyInput.value.trim();
    if (val) {
      localStorage.setItem(GEMINI_LS_KEY, val);
    } else {
      localStorage.removeItem(GEMINI_LS_KEY);
    }
  });
}
if (keyForget) {
  keyForget.addEventListener('click', function () {
    localStorage.removeItem(GEMINI_LS_KEY);
    if (keyInput) keyInput.value = '';
    showToastIA('Clé Gemini oubliée', 'info');
  });
}

/* Champ « Modèle IA » : réglage non secret, persistant en localStorage.
   Vide → fallback sur le défaut (le placeholder le rappelle). */
var modelInput = document.getElementById('ia-gemini-model');
if (modelInput) {
  modelInput.value = (localStorage.getItem(GEMINI_MODEL_LS_KEY) || '').trim();
  modelInput.addEventListener('input', function () {
    var val = modelInput.value.trim();
    if (val) {
      localStorage.setItem(GEMINI_MODEL_LS_KEY, val);
    } else {
      localStorage.removeItem(GEMINI_MODEL_LS_KEY);
    }
  });
}

/* =====================================================
   API PUBLIQUE — accès à la clé Gemini (sync entre appareils)
   La clé Gemini est encapsulée ici (GEMINI_LS_KEY). On expose des
   accesseurs propres pour qu'app.js puisse l'inclure dans l'export
   chiffré et la restaurer à l'import sans dupliquer la constante.
   ===================================================== */
window.IA = window.IA || {};
window.IA.getKey = function () { return getApiKey(); };
window.IA.setKey = function (val) {
  val = (val || '').trim();
  if (val) {
    localStorage.setItem(GEMINI_LS_KEY, val);
  } else {
    localStorage.removeItem(GEMINI_LS_KEY);
  }
  if (keyInput) keyInput.value = val;
};
/* Modèle IA (réglage non secret) — exposé pour l'inclure dans le sync chiffré.
   getModel() renvoie toujours une valeur effective (fallback sur le défaut) ;
   getModelRaw() renvoie la valeur stockée brute ('' si non personnalisée) afin
   de n'exporter que les modèles réellement choisis par l'utilisateur. */
window.IA.getModel    = function () { return getModel(); };
window.IA.getModelRaw = function () { return (localStorage.getItem(GEMINI_MODEL_LS_KEY) || '').trim(); };
window.IA.setModel = function (val) {
  val = (val || '').trim();
  if (val) {
    localStorage.setItem(GEMINI_MODEL_LS_KEY, val);
  } else {
    localStorage.removeItem(GEMINI_MODEL_LS_KEY);
  }
  if (modelInput) modelInput.value = val;
};

/* =====================================================
   UTILITAIRES
   ===================================================== */
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToastIA(msg, type) {
  var t = document.getElementById('te-toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'te-toast ' + (type || 'info');
  t.classList.add('show');
  setTimeout(function () { t.classList.remove('show'); }, 3000);
}

})();
