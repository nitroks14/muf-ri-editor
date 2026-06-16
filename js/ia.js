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
   HELPERS TAXONOMIE
   ===================================================== */
function extractAllTexts(taxo) {
  var list = [];
  Object.keys(taxo).forEach(function (mk) {
    var m = taxo[mk];
    if (m.label) list.push({ path: mk + '.label', value: m.label });
    (m.stations || []).forEach(function (s, si) {
      if (s.label) list.push({ path: mk + '.stations[' + si + '].label', value: s.label });
      (s.subcats || []).forEach(function (sc, sci) {
        if (sc.label) list.push({ path: mk + '.stations[' + si + '].subcats[' + sci + '].label', value: sc.label });
        (sc.elements || []).forEach(function (e, ei) {
          if (e.label) list.push({ path: mk + '.stations[' + si + '].subcats[' + sci + '].elements[' + ei + '].label', value: e.label });
          (e.actions || []).forEach(function (a, ai) {
            if (a.note) list.push({ path: mk + '.stations[' + si + '].subcats[' + sci + '].elements[' + ei + '].actions[' + ai + '].note', value: a.note });
          });
        });
      });
    });
  });
  return list;
}

function applyTextReplacements(taxo, map) {
  function walk(obj) {
    if (typeof obj === 'string') return map[obj] !== undefined ? map[obj] : obj;
    if (Array.isArray(obj)) { for (var i = 0; i < obj.length; i++) obj[i] = walk(obj[i]); return obj; }
    if (obj && typeof obj === 'object') {
      var keys = Object.keys(obj);
      for (var k = 0; k < keys.length; k++) obj[keys[k]] = walk(obj[keys[k]]);
    }
    return obj;
  }
  Object.keys(taxo).forEach(function (mk) { taxo[mk] = walk(taxo[mk]); });
  return taxo;
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
    var texts = extractAllTexts(taxo);
    var uniques = Array.from(new Set(texts.map(function (t) { return t.value; }))).filter(Boolean);

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
      showResults('<p class="ia-empty">✅ Aucune faute détectée — la taxonomie est correcte.</p>', null);
      return;
    }

    var html = '<p class="ia-count">' + corrections.length + ' correction(s) proposée(s) :</p><ul class="ia-list">' +
      corrections.map(function (c) {
        return '<li><span class="ia-old">' + esc(c.original) + '</span> → <span class="ia-new">' + esc(c.corrected) + '</span></li>';
      }).join('') + '</ul>';

    showResults(html, function () {
      var map = {};
      corrections.forEach(function (c) { map[c.original] = c.corrected; });
      applyTextReplacements(taxo, map);
      window._saveTaxo();
      window._reloadWorkspace();
      showToastIA('Corrections appliquées (' + corrections.length + ')', 'success');
    });
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

    var prompt = 'Tu es un expert en maintenance préventive de machines d\'emballage alimentaire industriel.\n' +
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
    var texts = extractAllTexts(taxo);
    var uniques = Array.from(new Set(texts.map(function (t) { return t.value; }))).filter(Boolean);

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
      showResults('<p class="ia-empty">✅ Tous les libellés sont déjà normalisés.</p>', null);
      return;
    }

    var html = '<p class="ia-count">' + normas.length + ' normalisation(s) proposée(s) :</p><ul class="ia-list">' +
      normas.map(function (n) {
        return '<li><span class="ia-old">' + esc(n.original) + '</span> → <span class="ia-new">' + esc(n.normalise) + '</span>' +
          (n.raison ? '<span class="ia-raison"> — ' + esc(n.raison) + '</span>' : '') + '</li>';
      }).join('') + '</ul>';

    showResults(html, function () {
      var map = {};
      normas.forEach(function (n) { map[n.original] = n.normalise; });
      applyTextReplacements(taxo, map);
      window._saveTaxo();
      window._reloadWorkspace();
      showToastIA('Normalisation appliquée (' + normas.length + ' libellés)', 'success');
    });
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
