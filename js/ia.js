(function () {
'use strict';

/* =====================================================
   GEMINI API
   ===================================================== */
var GEMINI_MODEL   = 'gemini-2.0-flash';
var GEMINI_SS_KEY  = 'muf_ri_gemini_key';

function getApiKey() { return sessionStorage.getItem(GEMINI_SS_KEY) || ''; }

async function callGemini(prompt) {
  var key = getApiKey();
  if (!key) throw new Error('Clé API Gemini manquante — saisissez-la dans ⚙ Config');

  var resp = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + key,
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
    throw new Error((errData.error && errData.error.message) || 'Erreur Gemini ' + resp.status);
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
   CONFIG CLÉ GEMINI
   ===================================================== */
var keyInput = document.getElementById('ia-gemini-key');
if (keyInput) {
  keyInput.value = getApiKey();
  keyInput.addEventListener('input', function () {
    sessionStorage.setItem(GEMINI_SS_KEY, keyInput.value.trim());
  });
}

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
