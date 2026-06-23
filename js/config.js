/**
 * muf-ri-editor — Configuration globale
 *
 * Centralise la configuration publique de l'éditeur de taxonomie.
 *
 * Les valeurs Supabase sont PUBLIQUES (URL + clé "publishable" anon) : elles
 * sont conçues pour vivre côté navigateur. La sécurité repose sur les Row Level
 * Security policies de Supabase, jamais sur le secret de cette clé. Ce sont les
 * MÊMES que celles de MUF-WebApp (même projet Supabase) : un compte unique vaut
 * pour les deux applications.
 *
 * BRAIN_URL est l'endpoint du Cerveau Multivac (RAG) qui sert le grounding
 * /v1/context (voir js/ia.js). Il est exposé via le tailnet Tailscale.
 *
 * Ne jamais dupliquer ces valeurs ailleurs : tout le monde lit window.MUF_CONFIG.
 */

'use strict';

(function () {
  window.MUF_CONFIG = {
    /** URL du projet Supabase (sans slash final). Identique à MUF-WebApp. */
    SUPABASE_URL: 'https://uzvoihrglczwdnlnsrvf.supabase.co',

    /**
     * Clé "publishable" (anon) Supabase — publique par conception.
     * Format sb_publishable_... : nécessite supabase-js v2 récent.
     */
    SUPABASE_ANON_KEY: 'sb_publishable_-XTtMQlv_ePEPly8NFjAFA_LuUscg36',

    /** Domaine email autorisé à la connexion (garde-fou frontend). */
    ALLOWED_EMAIL_DOMAIN: 'multivac.fr',

    /**
     * Endpoint du Cerveau Multivac (RAG), sans slash final.
     * Le grounding IA interroge {BRAIN_URL}/v1/context avec le JWT Supabase.
     */
    BRAIN_URL: 'https://vm-pc.tail1b2aa8.ts.net',
  };
})();
