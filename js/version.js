/* Single source of truth for the application version.
   Classic script: loaded by index.html (<script>) and by the service worker (importScripts). */
(function (g) {
  g.APP_VERSION = Object.freeze({
    appName: 'Local NPC Chat RPG',
    version: '0.1.0-build.002',
    releaseDate: '2026-10-17',
    copyright: '© 2026 egoaid',
    rights: 'All rights reserved.'
  });
})(typeof self !== 'undefined' ? self : globalThis);
