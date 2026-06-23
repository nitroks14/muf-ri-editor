/**
 * muf-ri-editor — UI de connexion Supabase (minimale)
 *
 * Pilote la section « Compte Multivac » de la sidebar de configuration :
 *   - formulaire email / mot de passe (connexion uniquement)
 *   - état connecté (email + bouton se déconnecter)
 *   - réaction aux changements de session via window.Auth.onChange
 *
 * Le JWT obtenu sert au grounding IA (ia.js → Cerveau /v1/context). Aucune
 * inscription ici : les comptes @multivac.fr sont créés depuis MUF-WebApp
 * (même projet Supabase).
 *
 * Expose window.MUF_LOGIN.demanderConnexion() : ouvre la sidebar et met le
 * focus sur le champ email — utilisé par ia.js pour inviter à se connecter
 * quand une suggestion nécessite le Cerveau.
 */

'use strict';

(function () {

  function $(id) { return document.getElementById(id); }

  var form        = $('auth-login-form');
  var emailInput  = $('auth-email');
  var pwdInput    = $('auth-password');
  var submitBtn   = $('auth-login-btn');
  var errorBox    = $('auth-error');
  var statusBox   = $('auth-status');        /* conteneur "connecté" */
  var statusEmail = $('auth-status-email');
  var logoutBtn   = $('auth-logout-btn');
  var formWrap    = $('auth-form-wrap');     /* conteneur "déconnecté" */
  var sidebar     = $('te-sidebar');

  /* Toast réutilisé de l'app (présent dans index.html). */
  function toast(msg, type) {
    var t = $('te-toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'te-toast ' + (type || 'info');
    t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 3000);
  }

  function afficherErreur(msg) {
    if (!errorBox) return;
    errorBox.textContent = msg || '';
    errorBox.style.display = msg ? 'block' : 'none';
  }

  /* Bascule l'affichage selon l'état de session. */
  function rendre(user) {
    var connecte = !!(window.Auth && window.Auth.isAuthenticated());
    if (formWrap)  formWrap.style.display  = connecte ? 'none' : 'block';
    if (statusBox) statusBox.style.display = connecte ? 'block' : 'none';
    if (connecte && statusEmail) {
      statusEmail.textContent = (user && user.email) || '';
    }
    if (!connecte) afficherErreur('');
  }

  /* Réagit aux changements de session (login, logout, refresh, démarrage). */
  if (window.Auth && typeof window.Auth.onChange === 'function') {
    window.Auth.onChange(function (user) { rendre(user); });
  }

  if (form) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      afficherErreur('');
      var email = (emailInput && emailInput.value) || '';
      var pwd   = (pwdInput && pwdInput.value) || '';
      if (!email || !pwd) {
        afficherErreur('Renseignez votre email et votre mot de passe.');
        return;
      }
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Connexion…'; }
      try {
        var res = await window.Auth.login(email, pwd);
        if (!res.ok) {
          afficherErreur(res.error || 'Connexion impossible.');
        } else {
          if (pwdInput) pwdInput.value = '';
          toast('Connecté à Multivac', 'success');
        }
      } catch (err) {
        afficherErreur('Connexion impossible.');
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Se connecter'; }
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async function () {
      await window.Auth.logout();
      toast('Déconnecté', 'info');
    });
  }

  /* API publique : ouvre la sidebar de config et met le focus sur l'email.
     Appelée par ia.js quand une action IA exige une connexion. */
  window.MUF_LOGIN = {
    demanderConnexion: function () {
      if (sidebar && !sidebar.classList.contains('open')) {
        sidebar.classList.add('open');
      }
      if (emailInput) {
        try { emailInput.focus(); } catch (_) {}
      }
    },
  };

})();
