/**
 * =========================================================
 *  OFFLINE-EXTRAS — Fitur tambahan khusus versi offline
 * =========================================================
 * Dipisah dari app.js supaya logic utama (yang sama persis dengan versi
 * Apps Script) tidak perlu disentuh. File ini hanya menambah satu hal yang
 * TIDAK ADA di versi Apps Script: backup/restore manual, karena versi
 * offline tidak punya Google Sheets sebagai tempat data "nebeng".
 * =========================================================
 */
(function () {
  'use strict';

  function $(sel) { return document.querySelector(sel); }

  function showStatus(msg, isError) {
    var el = $('#backupStatus');
    if (!el) return;
    el.textContent = msg;
    el.className = 'font-body-sm text-body-sm ' + (isError ? 'text-error' : 'text-secondary');
  }

  function formatDateForFilename(d) {
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes());
  }

  var btnExport = $('#btnExportBackup');
  if (btnExport) {
    btnExport.addEventListener('click', function () {
      MedCardDB.exportAllData().then(function (data) {
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'medcard-backup-' + formatDateForFilename(new Date()) + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        showStatus('Cadangan berhasil diunduh (' + data.cards.length + ' kartu).', false);
      }).catch(function (err) {
        console.error(err);
        showStatus('Gagal membuat cadangan: ' + (err && err.message ? err.message : err), true);
      });
    });
  }

  var btnImport = $('#btnImportBackup');
  var fileInput = $('#backupFileInput');
  if (btnImport && fileInput) {
    btnImport.addEventListener('click', function () { fileInput.click(); });

    fileInput.addEventListener('change', function () {
      var file = this.files && this.files[0];
      if (!file) return;
      this.value = '';

      var replace = confirm(
        'Pulihkan dari cadangan ini?\n\n' +
        'OK = GANTI semua data saat ini dengan isi file cadangan.\n' +
        'Batal = GABUNG saja (data lama tetap ada, data dari cadangan ditambahkan).'
      );

      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var data = JSON.parse(e.target.result);
          MedCardDB.importAllData(data, replace ? 'replace' : 'merge').then(function (result) {
            showStatus('Berhasil memulihkan ' + result.count + ' kartu. Memuat ulang...', false);
            setTimeout(function () { window.location.reload(); }, 1200);
          }).catch(function (err) {
            console.error(err);
            showStatus('Gagal memulihkan: ' + (err && err.message ? err.message : err), true);
          });
        } catch (err) {
          showStatus('File bukan cadangan MedCard yang valid.', true);
        }
      };
      reader.readAsText(file);
    });
  }
})();
