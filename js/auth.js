/**
 * muf-ri-editor — Module Auth (Supabase)
 *
 * Authentification déléguée à Supabase Auth (supabase-js v2), sur le MÊME
 * projet Supabase que MUF-WebApp : un compte unique vaut pour les deux apps.
 * L'éditeur n'expose PAS d'inscription (les comptes @multivac.fr sont créés
 * depuis MUF-WebApp) ; il propose uniquement la connexion.
 *
 * Le JWT (access_token) ainsi obtenu est utilisé par js/ia.js pour interroger
 * le Cerveau Multivac (POST {BRAIN_URL}/v1/context, en-tête Bearer).
 *
 * API publique — window.Auth :
 *   .isAuthenticated()        → boolean (session présente)
 *   .getToken()               → string | null (access_token JWT)
 *   .getUser()                → { id, prenom, nom, email } | null
 *   .login(email, mdp)        → Promise<{ ok, error }>
 *   .logout()                 → Promise<void>
 *   .verifyToken()            → Promise<boolean>
 *   .ready()                  → Promise<SupabaseClient>
 *   .onChange(cb)             → void  (notifié à chaque changement de session)
 *
 * La session (access/refresh token) est entièrement gérée et persistée par
 * supabase-js dans localStorage : persistance au rechargement + rafraîchissement
 * automatique du token.
 */

'use strict';

(function () {

  var cfg = window.MUF_CONFIG || {};
  var DOMAINE_AUTORISE = (cfg.ALLOWED_EMAIL_DOMAIN || 'multivac.fr').toLowerCase();

  /* ----------------------------------------------------------
     Accès au client Supabase partagé (js/supabase-client.js)
     ---------------------------------------------------------- */
  function obtenirClientPret() {
    if (window.MUF_SUPABASE) return Promise.resolve(window.MUF_SUPABASE);
    if (window.MUF_SUPABASE_READY) return window.MUF_SUPABASE_READY;
    return new Promise(function (resolve) {
      window.addEventListener('muf-supabase-ready', function (e) {
        resolve(e.detail || window.MUF_SUPABASE);
      }, { once: true });
    });
  }

  /* ----------------------------------------------------------
     Cache synchrone de l'utilisateur / session courants
     getToken() / getUser() sont appelés de façon synchrone (ia.js),
     on maintient donc une vue mémoire mise à jour à chaque changement.
     ---------------------------------------------------------- */
  var _userCache = null;   /* { id, prenom, nom, email } | null */
  var _session   = null;   /* session supabase courante | null */
  var _listeners = [];     /* callbacks externes (onChange) */

  function mapperUser(supaUser) {
    if (!supaUser) return null;
    var meta = supaUser.user_metadata || {};
    return {
      id:     supaUser.id || '',
      prenom: meta.prenom || meta.first_name || '',
      nom:    meta.nom    || meta.last_name  || '',
      email:  supaUser.email || meta.email || '',
    };
  }

  function majSession(session) {
    _session   = session || null;
    var supaUser = session && session.user ? session.user : null;
    _userCache = supaUser ? mapperUser(supaUser) : null;
    _listeners.forEach(function (cb) {
      try { cb(_userCache, _session); } catch (e) { /* listener défaillant ignoré */ }
    });
  }

  /* Branche l'écoute des changements de session dès que le client est prêt. */
  obtenirClientPret().then(function (supabase) {
    supabase.auth.getSession().then(function (res) {
      majSession(res && res.data ? res.data.session : null);
    });
    supabase.auth.onAuthStateChange(function (_event, session) {
      majSession(session);
    });
  });

  /* ----------------------------------------------------------
     Normalisation des messages d'erreur Supabase → FR
     ---------------------------------------------------------- */
  function messageErreur(error) {
    if (!error) return 'Une erreur est survenue.';
    var m = (error.message || '').toLowerCase();
    if (m.includes('invalid login credentials')) {
      return 'Email ou mot de passe incorrect.';
    }
    if (m.includes('email not confirmed')) {
      return 'Votre email n\'a pas encore été confirmé. Vérifiez votre boîte de réception.';
    }
    if (m.includes('rate limit') || m.includes('too many requests') || m.includes('email rate limit')) {
      return 'Trop de tentatives. Patientez quelques minutes avant de réessayer.';
    }
    if (m.includes('failed to fetch') || m.includes('networkerror')) {
      return 'Impossible de joindre le service. Vérifiez votre connexion.';
    }
    return error.message || 'Une erreur est survenue.';
  }

  /* ----------------------------------------------------------
     API publique — window.Auth
     ---------------------------------------------------------- */
  var Auth = {

    /** Promesse résolue quand le client Supabase est prêt. */
    ready: function () {
      return obtenirClientPret();
    },

    /** S'abonner aux changements de session (appelé immédiatement avec l'état courant). */
    onChange: function (cb) {
      if (typeof cb !== 'function') return;
      _listeners.push(cb);
      cb(_userCache, _session);
    },

    /** Une session est-elle active ? (lecture synchrone du cache) */
    isAuthenticated: function () {
      return !!_session;
    },

    /** access_token (JWT) courant, ou null. Consommé par ia.js (Bearer). */
    getToken: function () {
      return _session && _session.access_token ? _session.access_token : null;
    },

    /** Profil courant { id, prenom, nom, email } ou null (synchrone). */
    getUser: function () {
      return _userCache;
    },

    /**
     * Connexion par email / mot de passe.
     * Garde-fou : seules les adresses @multivac.fr sont acceptées (la vraie
     * barrière reste côté Supabase).
     * @returns {Promise<{ok:boolean, error?:string}>}
     */
    login: async function (email, mdp) {
      try {
        var emailNorm = (email || '').trim().toLowerCase();
        if (!emailNorm.endsWith('@' + DOMAINE_AUTORISE)) {
          return { ok: false, error: 'Seules les adresses @' + DOMAINE_AUTORISE + ' sont autorisées.' };
        }
        var supabase = await obtenirClientPret();
        var resultat = await supabase.auth.signInWithPassword({
          email: emailNorm,
          password: mdp,
        });
        if (resultat.error) {
          return { ok: false, error: messageErreur(resultat.error) };
        }
        majSession(resultat.data ? resultat.data.session : null);
        return { ok: true };
      } catch (e) {
        console.error('[Auth] login :', e);
        return { ok: false, error: messageErreur(e) };
      }
    },

    /** Déconnexion. */
    logout: async function () {
      try {
        var supabase = await obtenirClientPret();
        await supabase.auth.signOut();
      } catch (e) {
        console.error('[Auth] logout :', e);
      } finally {
        majSession(null);
      }
    },

    /**
     * Vérifie qu'une session valide existe (au démarrage de l'éditeur).
     * supabase-js rafraîchit automatiquement le token si nécessaire.
     * @returns {Promise<boolean>}
     */
    verifyToken: async function () {
      try {
        var supabase = await obtenirClientPret();
        var res = await supabase.auth.getSession();
        var session = res && res.data ? res.data.session : null;
        majSession(session);
        return !!session;
      } catch (e) {
        console.warn('[Auth] verifyToken impossible (hors ligne ?) :', e);
        return !!_session;
      }
    },
  };

  window.Auth = Auth;

})();
