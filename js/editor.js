/* Moteur de l'éditeur blocky */

const Editor = (() => {
  let _blocks = [];
  let _root = null;
  let _onChange = null;

  function init(rootEl, onChange) {
    _root = rootEl;
    _onChange = onChange;
    _root.addEventListener('click', _onToolbarClick);
    _render();
  }

  function load(blocks) {
    _blocks = blocks || [];
    _render();
  }

  function getBlocks() {
    return _serializeAll();
  }

  function addBlock(type, data = {}) {
    _blocks.push(Blocks.create(type, data));
    _render();
    _notify();
  }

  function _serializeAll() {
    return [..._root.querySelectorAll('.block[data-id]')].map(el => {
      const block = _blocks.find(b => b.id === el.dataset.id);
      return block ? Blocks.serialize(el, block) : null;
    }).filter(Boolean);
  }

  function _render() {
    _root.innerHTML = '';
    _blocks.forEach(b => {
      const el = Blocks.render(b);
      _root.appendChild(el);
      _attachContentListeners(el, b);
    });
    _root.appendChild(_addBlockBar());
  }

  function _attachContentListeners(el, block) {
    const editable = el.querySelector('[contenteditable]');
    if (editable) {
      editable.addEventListener('input', () => _notify());
    }
    el.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => _notify());
    });
  }

  function _onToolbarClick(e) {
    const id = e.target.dataset.id;
    if (!id) return;

    if (e.target.classList.contains('btn-block-delete')) {
      _blocks = _serializeAll().filter(b => b.id !== id);
      _render();
      _notify();
    } else if (e.target.classList.contains('btn-block-up')) {
      const idx = _blocks.findIndex(b => b.id === id);
      if (idx > 0) {
        _blocks = _serializeAll();
        [_blocks[idx - 1], _blocks[idx]] = [_blocks[idx], _blocks[idx - 1]];
        _render();
        _notify();
      }
    } else if (e.target.classList.contains('btn-block-down')) {
      const idx = _blocks.findIndex(b => b.id === id);
      if (idx < _blocks.length - 1) {
        _blocks = _serializeAll();
        [_blocks[idx], _blocks[idx + 1]] = [_blocks[idx + 1], _blocks[idx]];
        _render();
        _notify();
      }
    }
  }

  function _addBlockBar() {
    const bar = document.createElement('div');
    bar.className = 'add-block-bar';
    bar.innerHTML = `
      <span class="add-block-label">+ Ajouter</span>
      <button data-type="${Blocks.TYPES.HEADING}">Titre</button>
      <button data-type="${Blocks.TYPES.PARAGRAPH}">Texte</button>
      <button data-type="${Blocks.TYPES.LIST_UL}">Liste •</button>
      <button data-type="${Blocks.TYPES.LIST_OL}">Liste 1.</button>
      <button data-type="${Blocks.TYPES.CHECKLIST}">Cases</button>
      <button data-type="${Blocks.TYPES.SEPARATOR}">Séparateur</button>
    `;
    bar.querySelectorAll('button[data-type]').forEach(btn => {
      btn.addEventListener('click', () => addBlock(btn.dataset.type));
    });
    return bar;
  }

  function _notify() {
    if (_onChange) _onChange(_serializeAll());
  }

  return { init, load, addBlock, getBlocks };
})();
