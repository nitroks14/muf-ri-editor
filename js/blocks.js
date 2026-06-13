/* Définition et rendu des blocs de l'éditeur */

const BLOCK_TYPES = {
  HEADING:   'heading',
  PARAGRAPH: 'paragraph',
  LIST_UL:   'list_ul',
  LIST_OL:   'list_ol',
  SEPARATOR: 'separator',
  MACHINE:   'machine',
  CHECKLIST: 'checklist',
};

const Blocks = (() => {

  function create(type, data = {}) {
    return { id: crypto.randomUUID(), type, data };
  }

  function render(block) {
    const el = document.createElement('div');
    el.className = 'block block--' + block.type;
    el.dataset.id = block.id;

    switch (block.type) {
      case BLOCK_TYPES.HEADING:
        el.innerHTML = `<div class="block-toolbar">${_toolbar(block)}</div>
          <div class="block-content" contenteditable="true" data-placeholder="Titre...">${_esc(block.data.text || '')}</div>`;
        break;

      case BLOCK_TYPES.PARAGRAPH:
        el.innerHTML = `<div class="block-toolbar">${_toolbar(block)}</div>
          <div class="block-content block-rich" contenteditable="true" data-placeholder="Texte...">${block.data.html || ''}</div>`;
        break;

      case BLOCK_TYPES.LIST_UL:
        el.innerHTML = `<div class="block-toolbar">${_toolbar(block)}</div>
          <ul class="block-list" contenteditable="true">${_listItems(block.data.items)}</ul>`;
        break;

      case BLOCK_TYPES.LIST_OL:
        el.innerHTML = `<div class="block-toolbar">${_toolbar(block)}</div>
          <ol class="block-list" contenteditable="true">${_listItems(block.data.items)}</ol>`;
        break;

      case BLOCK_TYPES.SEPARATOR:
        el.innerHTML = '<hr class="block-sep" />';
        break;

      case BLOCK_TYPES.CHECKLIST:
        el.innerHTML = `<div class="block-toolbar">${_toolbar(block)}</div>
          <div class="block-checklist">${_checklistItems(block.data.items)}</div>`;
        break;

      default:
        el.textContent = '[bloc inconnu]';
    }

    return el;
  }

  function serialize(el, block) {
    switch (block.type) {
      case BLOCK_TYPES.HEADING:
        return { ...block, data: { text: el.querySelector('.block-content').textContent } };
      case BLOCK_TYPES.PARAGRAPH:
        return { ...block, data: { html: el.querySelector('.block-rich').innerHTML } };
      case BLOCK_TYPES.LIST_UL:
      case BLOCK_TYPES.LIST_OL:
        return { ...block, data: { items: [...el.querySelectorAll('li')].map(li => li.innerHTML) } };
      case BLOCK_TYPES.CHECKLIST:
        return { ...block, data: { items: [...el.querySelectorAll('.checklist-item')].map(item => ({
          text: item.querySelector('.checklist-label').textContent,
          checked: item.querySelector('input').checked,
        })) } };
      default:
        return block;
    }
  }

  function _esc(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function _toolbar(block) {
    return `<button class="btn-block-delete" data-id="${block.id}" title="Supprimer">✕</button>
            <button class="btn-block-up" data-id="${block.id}" title="Monter">↑</button>
            <button class="btn-block-down" data-id="${block.id}" title="Descendre">↓</button>`;
  }

  function _listItems(items = []) {
    if (!items.length) return '<li><br></li>';
    return items.map(i => `<li>${i}</li>`).join('');
  }

  function _checklistItems(items = []) {
    if (!items.length) return '<label class="checklist-item"><input type="checkbox" /><span class="checklist-label">Élément</span></label>';
    return items.map(i => `<label class="checklist-item">
      <input type="checkbox" ${i.checked ? 'checked' : ''} />
      <span class="checklist-label">${_esc(i.text)}</span>
    </label>`).join('');
  }

  return { create, render, serialize, TYPES: BLOCK_TYPES };
})();
