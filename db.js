/**
 * =========================================================
 *  MEDCARD DB — Database Lokal (IndexedDB via Dexie.js)
 * =========================================================
 * Ini pengganti Code.gs + Google Sheets dari versi Apps Script.
 * Semua data (kartu obat, riwayat belajar, profil) hidup 100% di
 * browser/HP ini sendiri — tidak ada data yang dikirim ke server
 * mana pun, kecuali saat Anda sengaja memakai fitur "Import Foto/PDF"
 * (yang itu pun hanya mengirim gambar ke Gemini API, bukan ke MedCard).
 *
 * Setiap fungsi di sini meniru persis nama & bentuk hasil dari fungsi
 * Code.gs versi Apps Script, supaya app.js tinggal ganti cara
 * memanggilnya (dari google.script.run menjadi MedCardDB.xxx()),
 * tanpa perlu mengubah logic tampilan sama sekali.
 * =========================================================
 */

var MedCardDB = (function () {
  'use strict';

  var db = new Dexie('MedCardDB');
  db.version(1).stores({
    cards: 'id, deck, golongan, status, dueDate, createdAt',
    reviewLog: '++rowId, timestamp, cardId',
    settings: 'key'
  });

  // ---------- UTIL ----------
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  function nowIso() { return new Date().toISOString(); }

  async function getSetting(key, fallback) {
    var row = await db.settings.get(key);
    return row ? row.value : (fallback !== undefined ? fallback : null);
  }
  async function setSetting(key, value) {
    await db.settings.put({ key: key, value: value });
  }

  // ---------- DATA BAWAAN (SEED) ----------
  var GOLONGAN_MAP = {
    'Acyclovir': 'Antivirus',
    'Albendazol': 'Antelmintik (Antiparasit)',
    'Amoxicillin': 'Antibiotik (Penisilin)',
    'Ampicilin': 'Antibiotik (Penisilin)',
    'Ampicilin Sulbactam': 'Antibiotik (Penisilin + Inhibitor Beta-laktamase)',
    'Antivirus Isoprinosine': 'Antivirus / Imunomodulator',
    'Apialys': 'Suplemen Vitamin',
    'Asam Valproat': 'Antikonvulsan',
    'Cefadroxil': 'Antibiotik (Sefalosporin Gen-1)',
    'Cefixime': 'Antibiotik (Sefalosporin Gen-3)',
    'Cefotaxime': 'Antibiotik (Sefalosporin Gen-3)',
    'Ceftriaxon': 'Antibiotik (Sefalosporin Gen-3)',
    'Cetirizine': 'Antihistamin',
    'Cotrimoxazole': 'Antibiotik (Sulfonamid)',
    'Dexamethason': 'Kortikosteroid',
    'Fenobarbital': 'Antikonvulsan / Sedatif',
    'Gentamisin': 'Antibiotik (Aminoglikosida)',
    'Ibuprofen': 'NSAID (Analgesik-Antipiretik)',
    'Ketokonazol': 'Antijamur',
    'Loratadine': 'Antihistamin',
    'Metronidazole': 'Antibiotik / Antiprotozoa',
    'Metilprednisolon': 'Kortikosteroid',
    'Ondansetron': 'Antiemetik',
    'Paracetamol': 'Analgesik-Antipiretik',
    'Ranitidine': 'Antagonis H2',
    'Salbutamol': 'Bronkodilator (Beta-2 Agonis)',
    'Vitamin A': 'Suplemen Vitamin',
    'Zinc': 'Suplemen Mineral'
  };

  var SEED_RAW = [
    ['Acyclovir', '', '20 mg/kgBB (dosis tinggi)', '10-15 mg/kgBB tiap dosis, sehari 4 dosis // 20mg/kgBB'],
    ['Albendazol', '', '', '10-15 mg/kgBB/hari dibagi 2 dosis'],
    ['Amoxicillin', '', '', '25mg/kgbb/hr dibagi 3 dosis (125mg/5cc)'],
    ['Ampicilin', '', '', '100mg/kgBB/hari (100-150mg)'],
    ['Ampicilin Sulbactam', '', '', '100mg/kgBB/hari'],
    ['Antivirus Isoprinosine', '', '', '50mg/kgbb/hari bagi 3-4 dosis (250mg/5cc)'],
    ['Apialys', '', '', '<1th 0,3cc, 1-3th 0,6cc, >2th 5cc'],
    ['Asam Valproat', '', '', '<20kg: 20-30mg/kgbb/hr bagi 2 dosis; >20kg: 400mg/hr bagi 2 dosis (250mg/5cc)'],
    ['Cefadroxil', '', '', '30-50mg/kgBB/hari, dibagi 2 dosis'],
    ['Cefixime', '', '', '<10th: 8mg/kgbb/hr bagi 1-2 dosis (100mg/5cc)'],
    ['Cefotaxime', '', '', '100mg/kgBB/hari (80-160 mg)'],
    ['Ceftriaxon', '', '', '75 mg/kgBB/hari (50-80 mg)'],
    ['Cetirizine', '', '', '2-6th: 2,5mg; 6-12th: 5mg (5mg/5cc)'],
    ['Cotrimoxazole', '', '', '10mg/kgbb/hr bagi 2 dosis'],
    ['Dexamethason', '', '', '0.1mg/kgBB/hari (0.02 - 0.3mg)'],
    ['Fenobarbital', '', '', '0,3-0,5mg/kgbb/hr bagi 2 dosis (20mg/5cc)(tab 30mg)'],
    ['Gentamisin', '', '', '5mg/kgBB/hari (3-7 mg)'],
    ['Ibuprofen', '', '', '10mg/kgbb 3-4x (maks 40mg/hr) (100mg/5cc), forte 200mg'],
    ['Ketokonazol', '', '', '3.3 - 6.6 mg/kgBB 1x1'],
    ['Loratadine', '', '', '<30kg: 5mg; >30kg: 10mg (5mg/5cc)'],
    ['Metronidazole', '', '', '10mg/kgbb 3x (amoeba/disentri); giardiasis: 5mg/kgbb 3x'],
    ['Metilprednisolon', '', '', '0,5-1,7mg/kg/hr dibagi 2-4 dosis (4mg/5cc)'],
    ['Ondansetron', '', '', '0.1mg/kgBB/8 jam kp'],
    ['Paracetamol', '', '', '10-15mg/kgBB/6-8 jam kp'],
    ['Ranitidine', '', '', '1mg/kgBB/8-12 jam'],
    ['Salbutamol', '', '', '0.1mg/kgBB/kali, 3 kali sehari (0.8-1.5mg)'],
    ['Vitamin A', '', '', '6bln: 50.000 IU; 6-11bln: 100.000 IU; 1-5th: 200.000 IU (H1, H2, plus 2 minggu)'],
    ['Zinc', '', '', '6bln: 10mg; >6bln: 20mg (20mg/5cc)']
  ];

  var RUJUKAN_PULV = [
    { bbLabel: '3 - 4 kg', keterangan: '1 tab = 10 bungkus' },
    { bbLabel: '4 - 6 kg', keterangan: '2 tab = 15 bungkus' },
    { bbLabel: '7 - 8 kg', keterangan: '2 tab = 11 bungkus' },
    { bbLabel: '9 - 11 kg', keterangan: '3 tab = 12 bungkus / 1/4 tab' },
    { bbLabel: '12 kg', keterangan: '3 tab = 10 bungkus' },
    { bbLabel: '13 - 14 kg', keterangan: '4 tab = 12 bungkus' },
    { bbLabel: '15 - 16 kg', keterangan: '4 tab = 10 bungkus' },
    { bbLabel: '17 - 18 kg', keterangan: '5 tab = 12 bungkus' },
    { bbLabel: '19 - 22 kg', keterangan: '5 tab = 10 bungkus / 1/2 tab' },
    { bbLabel: '23 - 25 kg', keterangan: '6 tab = 10 bungkus' },
    { bbLabel: '26 - 28 kg', keterangan: '7 tab = 10 bungkus' },
    { bbLabel: '29 - 35 kg', keterangan: '3/4 tab' },
    { bbLabel: '> 36 kg', keterangan: '1 tab' }
  ];
  var RUJUKAN_CAIRAN = [
    { bbLabel: '< 10 kg', keterangan: 'x 4 cc/kgBB' },
    { bbLabel: '10 - 15 kg', keterangan: 'x 3.5 cc/kgBB' },
    { bbLabel: '15 - 20 kg', keterangan: 'x 3 cc/kgBB' },
    { bbLabel: '20 - 30 kg', keterangan: 'x 2 cc/kgBB' },
    { bbLabel: '45 kg an', keterangan: '80cc/jam atau 20 tpm' }
  ];

  async function seedIfEmpty() {
    var count = await db.cards.count();
    if (count > 0) return;
    var now = nowIso();
    var rows = SEED_RAW.map(function (item) {
      return {
        id: uuid(), deck: 'Obat Anak', namaObat: item[0], namaDagang: '',
        golongan: GOLONGAN_MAP[item[0]] || '', indikasi: item[1],
        dosisDewasa: item[2], dosisAnak: item[3], rute: '', kontraindikasi: '',
        efekSamping: '', catatan: '', tag: 'Anak', sumber: 'Input manual pengguna',
        easeFactor: 2.5, interval: 0, repetitions: 0, dueDate: now, lastReviewed: '',
        status: 'New', createdAt: now
      };
    });
    await db.cards.bulkAdd(rows);
  }

  // ---------- DASHBOARD ----------
  async function getDashboardData() {
    var cards = await db.cards.toArray();
    var today = new Date(); today.setHours(23, 59, 59, 999);
    var deckMap = {};
    cards.forEach(function (c) {
      if (!deckMap[c.deck]) deckMap[c.deck] = { name: c.deck, total: 0, due: 0, mastered: 0, learning: 0, neu: 0 };
      var d = deckMap[c.deck];
      d.total++;
      if (c.status === 'Mastered') d.mastered++;
      else if (c.status === 'New') d.neu++;
      else d.learning++;
      var due = c.dueDate ? new Date(c.dueDate) : null;
      if (due && due <= today) d.due++;
    });
    var decks = Object.keys(deckMap).map(function (k) { return deckMap[k]; });
    return {
      decks: decks,
      totalDue: decks.reduce(function (s, d) { return s + d.due; }, 0),
      totalCards: cards.length,
      totalMastered: cards.filter(function (c) { return c.status === 'Mastered'; }).length,
      totalNew: cards.filter(function (c) { return c.status === 'New'; }).length
    };
  }

  // ---------- CARDS CRUD ----------
  async function getCardsByDeck(deck) {
    var cards = await db.cards.toArray();
    if (!deck || deck === 'Semua') return cards;
    return cards.filter(function (c) { return c.deck === deck; });
  }

  async function getAllDeckNames() {
    var cards = await db.cards.toArray();
    var set = {};
    cards.forEach(function (c) { if (c.deck) set[c.deck] = true; });
    return Object.keys(set);
  }

  async function getCategories() {
    var cards = await db.cards.toArray();
    var map = {};
    cards.forEach(function (c) {
      var cat = c.golongan || 'Tanpa Kategori';
      if (!map[cat]) map[cat] = { name: cat, total: 0 };
      map[cat].total++;
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.total - a.total; });
  }

  async function getCardsByCategory(category) {
    var cards = await db.cards.toArray();
    if (category === 'Tanpa Kategori') return cards.filter(function (c) { return !c.golongan; });
    return cards.filter(function (c) { return c.golongan === category; });
  }

  async function getCardsByFilter(type, value) {
    return type === 'category' ? getCardsByCategory(value) : getCardsByDeck(value);
  }

  async function getDueCardsByFilter(type, value) {
    var cards = await getCardsByFilter(type, value);
    var today = new Date(); today.setHours(23, 59, 59, 999);
    return cards.filter(function (c) {
      var due = c.dueDate ? new Date(c.dueDate) : new Date(0);
      return due <= today;
    }).sort(function (a, b) { return new Date(a.dueDate) - new Date(b.dueDate); });
  }

  async function getQuizCardsByFilter(type, value, count) {
    var cards = (await getCardsByFilter(type, value)).slice();
    for (var i = cards.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = cards[i]; cards[i] = cards[j]; cards[j] = tmp;
    }
    return cards.slice(0, count || 10);
  }

  async function searchCards(query, deck) {
    query = (query || '').toLowerCase();
    var cards = (deck && deck !== 'Semua') ? await getCardsByDeck(deck) : await db.cards.toArray();
    if (!query) return cards;
    return cards.filter(function (c) {
      return (c.namaObat || '').toLowerCase().indexOf(query) !== -1 ||
        (c.namaDagang || '').toLowerCase().indexOf(query) !== -1 ||
        (c.indikasi || '').toLowerCase().indexOf(query) !== -1 ||
        (c.golongan || '').toLowerCase().indexOf(query) !== -1 ||
        (c.tag || '').toLowerCase().indexOf(query) !== -1;
    });
  }

  async function getCardById(id) {
    return (await db.cards.get(id)) || null;
  }

  async function addCard(cardObj) {
    var now = nowIso();
    var row = {
      id: uuid(),
      deck: cardObj.deck || '', namaObat: cardObj.namaObat || '', namaDagang: cardObj.namaDagang || '',
      golongan: cardObj.golongan || '', indikasi: cardObj.indikasi || '',
      dosisDewasa: cardObj.dosisDewasa || '', dosisAnak: cardObj.dosisAnak || '',
      rute: cardObj.rute || '', kontraindikasi: cardObj.kontraindikasi || '',
      efekSamping: cardObj.efekSamping || '', catatan: cardObj.catatan || '',
      tag: cardObj.tag || '', sumber: cardObj.sumber || '',
      easeFactor: 2.5, interval: 0, repetitions: 0, dueDate: now, lastReviewed: '',
      status: 'New', createdAt: now
    };
    await db.cards.add(row);
    return row;
  }

  async function bulkAddCards(deckName, cardsArray) {
    var count = 0;
    for (var i = 0; i < (cardsArray || []).length; i++) {
      var c = cardsArray[i];
      if (!c || !c.namaObat) continue;
      await addCard({
        deck: deckName, namaObat: c.namaObat || '', namaDagang: c.namaDagang || '',
        golongan: c.golongan || '', indikasi: c.indikasi || '',
        dosisDewasa: c.dosisDewasa || '', dosisAnak: c.dosisAnak || '',
        rute: c.rute || '', kontraindikasi: c.kontraindikasi || '',
        efekSamping: c.efekSamping || '', catatan: c.catatan || '',
        tag: c.tag || '', sumber: 'Import AI'
      });
      count++;
    }
    return { success: true, count: count };
  }

  async function updateCard(id, cardObj) {
    var existing = await db.cards.get(id);
    if (!existing) throw new Error('Kartu tidak ditemukan');
    var editableFields = ['deck', 'namaObat', 'namaDagang', 'golongan', 'indikasi',
      'dosisDewasa', 'dosisAnak', 'rute', 'kontraindikasi', 'efekSamping',
      'catatan', 'tag', 'sumber'];
    var patch = {};
    editableFields.forEach(function (f) { patch[f] = cardObj[f] || ''; });
    await db.cards.update(id, patch);
    return db.cards.get(id);
  }

  async function deleteCard(id) {
    var existing = await db.cards.get(id);
    if (!existing) throw new Error('Kartu tidak ditemukan');
    await db.cards.delete(id);
    return { success: true };
  }

  async function duplicateCard(id) {
    var card = await db.cards.get(id);
    if (!card) throw new Error('Kartu tidak ditemukan');
    return addCard(card);
  }

  // ---------- BELAJAR (SPACED REPETITION) ----------
  async function getDueCards(deck) { return getDueCardsByFilter('deck', deck); }

  /** rating: 1=Lupa, 2=Ragu, 3=Ingat, 4=Mudah — identik dengan algoritma versi Apps Script. */
  async function reviewCard(id, rating) {
    var card = await db.cards.get(id);
    if (!card) throw new Error('Kartu tidak ditemukan');

    var ease = parseFloat(card.easeFactor) || 2.5;
    var interval = parseFloat(card.interval) || 0;
    var reps = parseInt(card.repetitions, 10) || 0;
    rating = parseInt(rating, 10);

    if (rating === 1) {
      reps = 0; interval = 0; ease = Math.max(1.3, ease - 0.20);
    } else if (rating === 2) {
      interval = Math.max(1, Math.round(interval * 1.2)) || 1;
      ease = Math.max(1.3, ease - 0.15); reps++;
    } else if (rating === 3) {
      if (reps === 0) interval = 1;
      else if (reps === 1) interval = 6;
      else interval = Math.round(interval * ease);
      reps++;
    } else if (rating === 4) {
      if (reps === 0) interval = 4;
      else interval = Math.round(interval * ease * 1.3) || 4;
      ease = ease + 0.15; reps++;
    }

    var now = new Date();
    var dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + interval);

    var status = 'Learning';
    if (rating === 1) status = 'Learning';
    else if (interval >= 21 || reps >= 5) status = 'Mastered';
    else if (reps >= 2) status = 'Review';

    await db.cards.update(id, {
      easeFactor: ease, interval: interval, repetitions: reps,
      dueDate: dueDate.toISOString(), lastReviewed: now.toISOString(), status: status
    });

    try {
      await db.reviewLog.add({ timestamp: now.toISOString(), cardId: id, namaObat: card.namaObat, rating: rating, intervalBaru: interval });
    } catch (e) { /* jangan gagalkan review utama kalau log gagal ditulis */ }

    return { id: id, interval: interval, ease: ease, repetitions: reps, dueDate: dueDate.toISOString(), status: status };
  }

  // ---------- KUIS CEPAT ----------
  async function getQuizCards(deck, count) { return getQuizCardsByFilter('deck', deck, count); }

  // ---------- STATISTIK ----------
  async function getStats() {
    var cards = await db.cards.toArray();
    var byStatus = { New: 0, Learning: 0, Review: 0, Mastered: 0 };
    cards.forEach(function (c) {
      var s = c.status || 'New';
      if (byStatus[s] === undefined) byStatus[s] = 0;
      byStatus[s]++;
    });
    var byDeck = {};
    cards.forEach(function (c) { byDeck[c.deck] = (byDeck[c.deck] || 0) + 1; });
    var byCategory = {};
    cards.forEach(function (c) {
      var cat = c.golongan || 'Tanpa Kategori';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    });
    return { total: cards.length, byStatus: byStatus, byDeck: byDeck, byCategory: byCategory };
  }

  async function getStudyHistory(days) {
    days = days || 14;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var buckets = {}; var order = [];
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(today); d.setDate(d.getDate() - i);
      var key = d.toISOString().slice(0, 10);
      buckets[key] = 0; order.push(key);
    }
    var log = await db.reviewLog.toArray();
    log.forEach(function (row) {
      var key = (row.timestamp || '').slice(0, 10);
      if (buckets[key] !== undefined) buckets[key]++;
    });
    return { labels: order, counts: order.map(function (k) { return buckets[k]; }), totalReviews: log.length };
  }

  // ---------- RUJUKAN DOSIS ANAK (statis) ----------
  async function getRujukanAnak() {
    return { pulv: RUJUKAN_PULV, cairan: RUJUKAN_CAIRAN };
  }

  // ---------- IMPORT DARI FOTO/PDF (Gemini AI) — tetap butuh internet saat dipakai ----------
  async function saveGeminiApiKey(key) {
    await setSetting('geminiApiKey', (key || '').trim());
    return { success: true };
  }

  async function getGeminiKeyStatus() {
    var key = await getSetting('geminiApiKey', '');
    if (!key) return { hasKey: false, masked: '' };
    var masked = key.length > 8 ? (key.slice(0, 4) + '••••••••' + key.slice(-4)) : '••••••••';
    return { hasKey: true, masked: masked };
  }

  async function extractCardsFromFile(base64Data, mimeType) {
    var apiKey = await getSetting('geminiApiKey', '');
    if (!apiKey) {
      throw new Error('API key belum diisi. Masukkan API key Gemini terlebih dahulu (gratis dari aistudio.google.com/apikey).');
    }
    if (!navigator.onLine) {
      throw new Error('Fitur Import AI butuh koneksi internet (hanya untuk mengirim gambar ke Gemini). Sambungkan internet dulu, atau tambah kartu manual.');
    }

    var prompt = 'Anda membaca gambar atau dokumen berisi daftar obat dan dosisnya ' +
      '(catatan medis/farmakologi berbahasa Indonesia, bisa berupa tabel atau daftar bertulisan tangan/cetak). ' +
      'Ekstrak SETIAP obat yang tampak menjadi sebuah array JSON. Untuk setiap obat buat objek dengan field: ' +
      '"namaObat" (wajib, nama generik obat), "dosisDewasa" (string, kosongkan jika tidak ada info dosis dewasa), ' +
      '"dosisAnak" (string, kosongkan jika tidak ada info dosis anak/pediatrik), ' +
      '"indikasi" (string, boleh kosong), "golongan" (string golongan/kelas obat jika bisa disimpulkan, boleh kosong), ' +
      '"rute" (string, boleh kosong), "catatan" (string untuk info tambahan seperti sediaan/konsentrasi/keterangan lain, boleh kosong). ' +
      'Jika suatu bagian berupa tabel konversi (misalnya per berat badan) dan bukan nama obat spesifik, ' +
      'buat SATU entri dengan namaObat = judul tabel tersebut dan catatan = ringkasan isi tabel per baris. ' +
      'PENTING: salin angka dan satuan dosis PERSIS seperti yang tertulis di sumber, jangan mengubah atau mengoreksi nilainya. ' +
      'Jika tulisan tidak terbaca jelas, lewati baris tersebut daripada menebak. ' +
      'HANYA kembalikan JSON array yang valid, tanpa teks penjelasan lain, tanpa markdown code fence.';

    var payload = {
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Data } }] }],
      generationConfig: { temperature: 0.1 }
    };

    var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + encodeURIComponent(apiKey);
    var resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    var body = await resp.text();
    if (!resp.ok) {
      throw new Error('Gagal memproses dengan AI (kode ' + resp.status + '). Periksa API key Anda. Detail: ' + body.substring(0, 250));
    }

    var json = JSON.parse(body);
    var text = json.candidates && json.candidates[0] && json.candidates[0].content &&
      json.candidates[0].content.parts && json.candidates[0].content.parts[0] &&
      json.candidates[0].content.parts[0].text;
    if (!text) throw new Error('AI tidak mengembalikan hasil. Coba gambar/file lain yang lebih jelas.');

    text = text.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
    var cards;
    try { cards = JSON.parse(text); }
    catch (e) { throw new Error('Hasil AI tidak berupa JSON yang valid. Coba lagi, atau gunakan foto yang lebih jelas/tidak buram.'); }
    if (!Array.isArray(cards)) throw new Error('Format hasil AI tidak sesuai (bukan array).');
    return cards;
  }

  // ---------- PROFIL ----------
  async function getProfile() {
    var name = await getSetting('profileName', '');
    var title = await getSetting('profileTitle', '');
    var photoUrl = await getSetting('profilePhoto', '');
    return { name: name, title: title, photoUrl: photoUrl };
  }

  async function saveProfile(profile) {
    await setSetting('profileName', (profile.name || '').trim());
    await setSetting('profileTitle', (profile.title || '').trim());
    return getProfile();
  }

  /** Foto disimpan sebagai data: URL langsung di IndexedDB — tidak ada batas 9KB seperti di PropertiesService. */
  async function saveProfilePhoto(base64Data, mimeType) {
    var dataUrl = 'data:' + (mimeType || 'image/jpeg') + ';base64,' + base64Data;
    await setSetting('profilePhoto', dataUrl);
    return { success: true, photoUrl: dataUrl };
  }

  async function removeProfilePhoto() {
    await setSetting('profilePhoto', '');
    return { success: true };
  }

  // ---------- EXPORT / IMPORT BACKUP (khusus versi offline) ----------
  /** Backup semua data jadi satu file JSON yang bisa disimpan/dipindah manual antar device. */
  async function exportAllData() {
    var cards = await db.cards.toArray();
    var reviewLog = await db.reviewLog.toArray();
    var profile = await getProfile();
    return {
      exportedAt: nowIso(),
      app: 'MedCard Offline',
      version: 1,
      cards: cards,
      reviewLog: reviewLog,
      profile: { name: profile.name, title: profile.title } // foto sengaja tidak diikutkan, biar file backup tetap kecil
    };
  }

  async function importAllData(data, mode) {
    if (!data || !Array.isArray(data.cards)) throw new Error('File backup tidak valid.');
    if (mode === 'replace') {
      await db.cards.clear();
      await db.reviewLog.clear();
    }
    await db.cards.bulkPut(data.cards);
    if (Array.isArray(data.reviewLog)) await db.reviewLog.bulkPut(data.reviewLog);
    if (data.profile) await saveProfile(data.profile);
    return { success: true, count: data.cards.length };
  }

  // ---------- JAMIN DATA AWAL SUDAH TER-SEED SEBELUM DIPAKAI ----------
  // seedIfEmpty() dijalankan SEKALI saat db.js dimuat. Setiap fungsi publik
  // menunggu promise ini selesai dulu sebelum jalan, supaya dashboard tidak
  // sempat menampilkan "0 kartu" sesaat sebelum data bawaan selesai ditulis.
  var readyPromise = seedIfEmpty();

  function withReady(fn) {
    return async function () {
      await readyPromise;
      return fn.apply(null, arguments);
    };
  }

  return {
    ready: readyPromise,
    seedIfEmpty: seedIfEmpty,
    getDashboardData: withReady(getDashboardData),
    getCardsByDeck: withReady(getCardsByDeck),
    getAllDeckNames: withReady(getAllDeckNames),
    getCategories: withReady(getCategories),
    getCardsByCategory: withReady(getCardsByCategory),
    getCardsByFilter: withReady(getCardsByFilter),
    getDueCardsByFilter: withReady(getDueCardsByFilter),
    getQuizCardsByFilter: withReady(getQuizCardsByFilter),
    searchCards: withReady(searchCards),
    getCardById: withReady(getCardById),
    addCard: withReady(addCard),
    bulkAddCards: withReady(bulkAddCards),
    updateCard: withReady(updateCard),
    deleteCard: withReady(deleteCard),
    duplicateCard: withReady(duplicateCard),
    getDueCards: withReady(getDueCards),
    reviewCard: withReady(reviewCard),
    getQuizCards: withReady(getQuizCards),
    getStats: withReady(getStats),
    getStudyHistory: withReady(getStudyHistory),
    getRujukanAnak: withReady(getRujukanAnak),
    saveGeminiApiKey: withReady(saveGeminiApiKey),
    getGeminiKeyStatus: withReady(getGeminiKeyStatus),
    extractCardsFromFile: withReady(extractCardsFromFile),
    getProfile: withReady(getProfile),
    saveProfile: withReady(saveProfile),
    saveProfilePhoto: withReady(saveProfilePhoto),
    removeProfilePhoto: withReady(removeProfilePhoto),
    exportAllData: withReady(exportAllData),
    importAllData: withReady(importAllData)
  };
})();
