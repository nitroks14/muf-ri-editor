/**
 * muf-ri-editor — Client Supabase partagé
 *
 * Crée UNE SEULE instance du client supabase-js v2 et l'expose globalement.
 *
 * supabase-js est VENDORISÉ en local (libs/supabase.umd.js, build UMD officiel
 * v2.107.0, copié depuis MUF-WebApp) et chargé AVANT ce script via une balise
 * <script> classique. Il expose le global `window.supabase` (avec createClient).
 * Aucun import CDN : l'éditeur (PWA) peut démarrer hors-ligne ; l'auth réseau
 * (login) reste best-effort.
 *
 * Ce fichier publie :
 *   window.MUF_SUPABASE        → le client
 *   window.MUF_SUPABASE_READY  → Promise<SupabaseClient> à attendre avant tout
 *                                appel auth (auth.js l'attend déjà).
 *
 * Aucune URL / clé n'est hardcodée ici : tout vient de window.MUF_CONFIG
 * (js/config.js), chargé avant ce script.
 */

'use strict';

(function () {

  var cfg = window.MUF_CONFIG || {};

  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    console.error(
      '[Supabase] Configuration manquante : vérifiez SUPABASE_URL / SUPABASE_ANON_KEY dans js/config.js.'
    );
  }

  /* Le bundle UMD vendorisé expose le global `window.supabase`. */
  var lib = window.supabase;
  if (!lib || typeof lib.createClient !== 'function') {
    console.error(
      '[Supabase] Librairie supabase-js introuvable : vérifiez que ' +
      'libs/supabase.umd.js est bien chargé AVANT js/supabase-client.js.'
    );
    return;
  }

  var client = lib.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: {
      /* Persistance de session en localStorage (multi-appareils → même compte).
         getSession() est alors purement LOCAL : indispensable pour ouvrir
         l'éditeur hors-ligne sur une session déjà établie. */
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  window.MUF_SUPABASE = client;

  /* Signal de disponibilité consommé par js/auth.js */
  window.MUF_SUPABASE_READY = Promise.resolve(client);

  try {
    window.dispatchEvent(new CustomEvent('muf-supabase-ready', { detail: client }));
  } catch (e) {
    /* CustomEvent indisponible : non bloquant (auth.js lit MUF_SUPABASE_READY). */
  }

})();
