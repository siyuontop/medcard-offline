/**
 * =========================================================
 *  GS-SHIM — Peniru google.script.run untuk versi offline
 * =========================================================
 * Di versi Apps Script, app.js (dulu JavaScript.html) memanggil backend
 * lewat pola:
 *
 *   google.script.run.withSuccessHandler(ok).withFailureHandler(fail).namaFungsi(arg1, arg2)
 *
 * File ini membuat ulang API yang SAMA PERSIS bentuknya, tapi alih-alih
 * mengirim request ke server Google, langsung memanggil fungsi yang
 * senama di MedCardDB (db.js) yang berjalan 100% lokal di browser.
 *
 * Dengan begini, app.js tidak perlu diubah sama sekali — semua fungsi
 * (getDashboardData, addCard, reviewCard, dst) otomatis "tersambung"
 * ke database lokal, bukan ke Google Sheets.
 *
 * WAJIB dimuat SETELAH db.js dan SEBELUM app.js.
 * =========================================================
 */
(function () {
  'use strict';

  function makeRunner(onSuccess, onFailure) {
    return new Proxy({}, {
      get: function (_target, prop) {
        if (prop === 'withSuccessHandler') {
          return function (fn) { return makeRunner(fn, onFailure); };
        }
        if (prop === 'withFailureHandler') {
          return function (fn) { return makeRunner(onSuccess, fn); };
        }
        // Properti lain dianggap sebagai nama fungsi backend yang dipanggil.
        return function () {
          var args = Array.prototype.slice.call(arguments);
          var fn = window.MedCardDB && window.MedCardDB[prop];
          if (typeof fn !== 'function') {
            var err = new Error('Fungsi backend tidak dikenal: ' + prop);
            console.error(err);
            if (onFailure) onFailure(err);
            return;
          }
          Promise.resolve()
            .then(function () { return fn.apply(window.MedCardDB, args); })
            .then(function (result) { if (onSuccess) onSuccess(result); })
            .catch(function (err) {
              console.error(err);
              if (onFailure) onFailure(err);
            });
        };
      }
    });
  }

  window.google = {
    script: {
      run: makeRunner(null, null)
    }
  };
})();
