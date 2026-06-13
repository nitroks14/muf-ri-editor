/* Point d'entrée de la PWA éditeur */

(async () => {
  const root = document.getElementById('editor-root');
  let autosaveTimer = null;

  /* Chargement taxonomie */
  try {
    await Taxonomy.load();
  } catch (e) {
    alert('Taxonomie indisponible. Vérifiez votre connexion au premier lancement.');
  }

  /* Restauration brouillon */
  const draft = await Drafts.load();
  Editor.init(root, onEditorChange);
  if (draft && draft.blocks && draft.blocks.length) {
    if (confirm('Un brouillon existe. Le restaurer ?')) {
      Editor.load(draft.blocks);
    } else {
      await Drafts.clear();
    }
  }

  /* Auto-sauvegarde (1 s après la dernière modification) */
  function onEditorChange(blocks) {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(async () => {
      await Drafts.save({ blocks });
      showToast('Brouillon sauvegardé');
    }, 1000);
  }

  /* Bouton brouillon manuel */
  document.getElementById('btn-save-draft').addEventListener('click', async () => {
    await Drafts.save({ blocks: Editor.getBlocks() });
    showToast('Brouillon sauvegardé');
  });

  /* Bouton export */
  document.getElementById('btn-export').addEventListener('click', () => {
    window.print();
  });

  function showToast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  /* Service Worker */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
