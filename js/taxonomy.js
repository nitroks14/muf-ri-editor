/* Chargement et cache de la taxonomie depuis muf-ri-taxonomy */

const TAXONOMY_URL = 'https://raw.githubusercontent.com/nitroks14/muf-ri-taxonomy/main/taxonomy.json';
const TAXONOMY_VERSION_URL = 'https://raw.githubusercontent.com/nitroks14/muf-ri-taxonomy/main/version.json';
const CACHE_KEY = 'muf_ri_taxonomy';
const CACHE_VERSION_KEY = 'muf_ri_taxonomy_version';

const Taxonomy = (() => {
  let _data = null;

  async function load() {
    const cached = localStorage.getItem(CACHE_KEY);
    const cachedVersion = localStorage.getItem(CACHE_VERSION_KEY);

    if (cached) _data = JSON.parse(cached);

    try {
      const vRes = await fetch(TAXONOMY_VERSION_URL);
      const vData = await vRes.json();
      if (vData.version !== cachedVersion) {
        const res = await fetch(TAXONOMY_URL);
        _data = await res.json();
        localStorage.setItem(CACHE_KEY, JSON.stringify(_data));
        localStorage.setItem(CACHE_VERSION_KEY, vData.version);
      }
    } catch (_) {
      /* hors ligne — on utilise le cache */
    }

    if (!_data) throw new Error('Taxonomie indisponible (hors ligne et aucun cache)');
    return _data;
  }

  function get() { return _data; }

  return { load, get };
})();
