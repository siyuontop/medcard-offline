(function(){
  'use strict';

  var state = {
    currentDeck: null,
    currentCollection: null, // {type:'deck'|'category', value:name}
    dueQueue: [],
    studyIndex: 0,
    flipped: false,
    quizCards: [],
    quizIndex: 0,
    quizScore: 0,
    quizAnswered: false,
    editingId: null,
    referensi: null,
    ruteSelected: '',
    importCandidates: []
  };

  function $(sel){ return document.querySelector(sel); }
  function $all(sel){ return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function escapeHtml(s){
    return (s || '').replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function initials(name){
    name = (name || '').trim();
    if (!name) return '?';
    var parts = name.replace(/^dr\.?\s*/i, '').split(/\s+/).filter(Boolean);
    if (!parts.length) return name[0].toUpperCase();
    if (parts.length === 1) return parts[0].slice(0,2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function showToast(msg){
    var t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(t._timer);
    t._timer = setTimeout(function(){ t.classList.add('hidden'); }, 2200);
  }

  // ---------- LOADING OVERLAY (animasi kapsul lucu) ----------
  var loadingDepth = 0;
  var loadingShownAt = 0;
  var loadingHideTimer = null;
  var loadingMessages = [
    'Meracik data...',
    'Menghitung dosis...',
    'Mengaduk-aduk kartu obat...',
    'Menyiapkan resep...',
    'Sabar ya, lagi diracik...',
    'Membolak-balik kartu...'
  ];

  function showLoadingOverlay(){
    loadingDepth++;
    if (loadingDepth === 1){
      clearTimeout(loadingHideTimer);
      $('#loadingOverlayText').textContent = loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
      $('#loadingOverlay').classList.remove('js-hidden');
      loadingShownAt = Date.now();
    }
  }
  function hideLoadingOverlay(){
    loadingDepth = Math.max(0, loadingDepth - 1);
    if (loadingDepth === 0){
      var elapsed = Date.now() - loadingShownAt;
      var minShow = 260; // ms — biar animasi sempat kelihatan & tidak kedip-kedip
      var wait = Math.max(0, minShow - elapsed);
      clearTimeout(loadingHideTimer);
      loadingHideTimer = setTimeout(function(){
        $('#loadingOverlay').classList.add('js-hidden');
      }, wait);
    }
  }

  function withLoading(promiseFn, onSuccess, onError){
    showLoadingOverlay();
    promiseFn(
      function(result){ hideLoadingOverlay(); onSuccess(result); },
      function(err){
        hideLoadingOverlay();
        console.error(err);
        showToast('Terjadi kesalahan: ' + (err && err.message ? err.message : err));
        if (onError) onError(err);
      }
    );
  }

  // ---------- DARK MODE ----------
  function applyDarkPreference(){
    var pref = null;
    try { pref = localStorage.getItem('medcard_theme'); } catch(e){}
    if (pref === 'dark') document.documentElement.classList.add('dark');
    updateDarkIcon();
  }
  function updateDarkIcon(){
    var isDark = document.documentElement.classList.contains('dark');
    $('#darkToggleIcon').textContent = isDark ? 'light_mode' : 'dark_mode';
  }
  $('#btnDarkToggle').addEventListener('click', function(){
    document.documentElement.classList.toggle('dark');
    var isDark = document.documentElement.classList.contains('dark');
    try { localStorage.setItem('medcard_theme', isDark ? 'dark' : 'light'); } catch(e){}
    updateDarkIcon();
  });
  applyDarkPreference();

  // ---------- SUARA (Kuis Cepat) ----------
  state.soundMuted = false;
  function applyMutePreference(){
    var pref = null;
    try { pref = localStorage.getItem('medcard_muted'); } catch(e){}
    state.soundMuted = pref === 'true';
    updateMuteIcon();
  }
  function updateMuteIcon(){
    $('#muteToggleIcon').textContent = state.soundMuted ? 'volume_off' : 'volume_up';
  }
  $('#btnMuteToggle').addEventListener('click', function(){
    state.soundMuted = !state.soundMuted;
    try { localStorage.setItem('medcard_muted', state.soundMuted ? 'true' : 'false'); } catch(e){}
    updateMuteIcon();
  });
  applyMutePreference();

  var audioCtx = null;
  function getAudioCtx(){
    if (!audioCtx){
      var Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
    }
    return audioCtx;
  }

  /** Jawaban benar: mainkan satu efek suara secara acak dari koleksi. */
  function playCorrectSound(){
    if (state.soundMuted) return;
    var sounds = (window.MEDCARD_SOUNDS && window.MEDCARD_SOUNDS.correct) || [];
    if (!sounds.length) return;
    try {
      var pick = sounds[Math.floor(Math.random() * sounds.length)];
      var audio = new Audio(pick);
      audio.volume = 0.85;
      audio.play().catch(function(){});
    } catch(e){}
  }

  /** Jawaban salah: bunyi buzzer "tet-tot" disintesis langsung (tanpa file). */
  function playWrongSound(){
    if (state.soundMuted) return;
    try {
      var ctx = getAudioCtx();
      var now = ctx.currentTime;
      playBuzzTone(ctx, now, 340, 0.16);
      playBuzzTone(ctx, now + 0.17, 220, 0.22);
    } catch(e){}
  }

  function playBuzzTone(ctx, startTime, freq, duration){
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, startTime);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.25, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  // ---------- NAVIGATION ----------
  function setActiveNav(view){
    $all('.nav-link').forEach(function(btn){
      var active = btn.dataset.view === view;
      btn.classList.toggle('is-active', active);
      btn.classList.toggle('text-on-surface-variant', !active);
      btn.classList.toggle('text-primary', active);
    });
  }

  function showView(name){
    $all('.view').forEach(function(v){ v.classList.add('hidden'); });
    var el = document.getElementById('view-' + name);
    if (el) el.classList.remove('hidden');
    setActiveNav(name);
    window.scrollTo(0,0);
  }

  // Semua elemen dengan [data-view] (nav sidebar, bottom nav, kartu shortcut
  // di dashboard, tombol profil) dibuatkan satu handler navigasi yang sama.
  $all('[data-view]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var v = btn.dataset.view;
      if (v === 'search'){ openSearch(); return; }
      showView(v);
      if (v === 'dashboard') loadDashboard();
      if (v === 'stats') loadStats();
      if (v === 'referensi') loadReferensi();
      if (v === 'kategori') loadCategories();
      if (v === 'import') loadImportView();
      if (v === 'profil') loadProfileView();
    });
  });

  $all('[data-back]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var target = btn.dataset.back;
      if (target === 'deck' && state.currentCollection){
        openCollection(state.currentCollection.type, state.currentCollection.value);
      } else {
        showView('dashboard');
        loadDashboard();
      }
    });
  });

  $all('[data-back-kategori]').forEach(function(btn){
    btn.addEventListener('click', function(){ showView('kategori'); loadCategories(); });
  });

  $('#btnFabAdd').addEventListener('click', function(){ openCardForm(null); });
  $('#btnFabAddDesktop').addEventListener('click', function(){ openCardForm(null); });
  $('#btnOpenReferensi').addEventListener('click', function(){ showView('referensi'); loadReferensi(); });
  $('#btnStartStudyHero').addEventListener('click', function(){
    state.currentCollection = { type: 'deck', value: 'Semua' };
    startStudySession();
  });
  $('#btnQuizHero').addEventListener('click', function(){
    state.currentCollection = { type: 'deck', value: 'Semua' };
    openQuizIntro();
  });
  $('#btnProfileMobile').addEventListener('click', function(){ showView('profil'); loadProfileView(); });

  // ---------- DASHBOARD ----------
  function loadDashboard(){
    state.staged = null;
    withLoading(function(ok, fail){ google.script.run.withSuccessHandler(ok).withFailureHandler(fail).getDashboardData(); },
      function(data){
        $('#sumDue').textContent = data.totalDue;
        $('#sumTotal').textContent = data.totalCards;
        $('#sumMastered').textContent = data.totalMastered;
        $('#sumNew').textContent = data.totalNew;

        $('#heroDueCount').textContent = data.totalDue + ' Kartu';
        if (data.totalDue > 0){
          var estMin = Math.max(1, Math.round(data.totalDue * 0.5));
          $('#heroSubtext').textContent = 'Estimasi waktu: ~' + estMin + ' menit untuk menyelesaikan semua due hari ini.';
        } else {
          $('#heroSubtext').textContent = 'Tidak ada kartu due. Semua sudah direview hari ini!';
        }

        renderDeckGrid('#deckList', data.decks);
        renderSidebarDecks(data.decks);
      });
  }

  function renderDeckGrid(containerSel, decks){
    var wrap = $(containerSel);
    wrap.innerHTML = '';
    if (!decks.length){
      wrap.innerHTML = '<p class="font-body-sm text-body-sm text-on-surface-variant col-span-full">Belum ada deck. Ketuk tombol + untuk menambah kartu obat pertama Anda.</p>';
      return;
    }
    decks.forEach(function(d){
      var pct = d.total ? Math.round((d.mastered / d.total) * 100) : 0;
      var card = document.createElement('button');
      card.className = 'text-left flex flex-col gap-space-xs p-space-md rounded-xl bg-surface-container-low hover:bg-surface-container transition-colors border border-outline-variant/30';
      card.innerHTML =
        '<div class="flex items-center justify-between gap-space-sm">' +
          '<span class="font-headline-sm text-headline-sm text-on-surface truncate">' + escapeHtml(d.name) + '</span>' +
          (d.due > 0 ? '<span class="shrink-0 bg-error-container text-on-error-container font-label-sm text-label-sm px-space-xs py-0.5 rounded-full">' + d.due + ' due</span>' : '') +
        '</div>' +
        '<div class="w-full h-1.5 rounded-full bg-surface-container-highest overflow-hidden"><div class="h-full bg-secondary" style="width:' + pct + '%"></div></div>' +
        '<span class="font-body-sm text-body-sm text-on-surface-variant">' + d.total + ' kartu &middot; ' + d.mastered + ' dikuasai</span>';
      card.addEventListener('click', function(){ openCollection('deck', d.name); });
      wrap.appendChild(card);
    });
  }

  function renderSidebarDecks(decks){
    var wrap = $('#sidebarDeckList');
    wrap.innerHTML = '';
    decks.slice(0, 8).forEach(function(d){
      var a = document.createElement('button');
      a.className = 'flex flex-col text-left px-space-sm py-space-xs rounded-lg bg-surface-container hover:bg-surface-container-high transition-colors';
      a.innerHTML =
        '<span class="font-body-sm text-body-sm font-medium text-on-surface truncate">' + escapeHtml(d.name) + '</span>' +
        '<div class="flex justify-between items-center mt-0.5">' +
          '<span class="font-mono-sm text-mono-sm text-on-surface-variant">' + d.total + ' kartu</span>' +
          (d.due > 0 ? '<span class="font-mono-sm text-mono-sm text-error">' + d.due + ' due</span>' : '<span class="font-mono-sm text-mono-sm text-secondary">up to date</span>') +
        '</div>';
      a.addEventListener('click', function(){ openCollection('deck', d.name); });
      wrap.appendChild(a);
    });
  }

  // ---------- KOLEKSI (DECK / KATEGORI) ----------
  function statusDotClass(status){ return 'dot-' + (status || 'New'); }

  function cardRowHtml(c){
    var dose = c.dosisDewasa || c.dosisAnak || '-';
    return (
      '<div class="flex items-center gap-space-sm p-space-sm rounded-xl bg-surface-container-low hover:bg-surface-container transition-colors">' +
        '<span class="w-2.5 h-2.5 rounded-full shrink-0 ' + statusDotClass(c.status) + '"></span>' +
        '<div class="flex-1 min-w-0">' +
          '<div class="font-label-lg text-label-lg text-on-surface truncate">' + escapeHtml(c.namaObat) + '</div>' +
          '<div class="font-body-sm text-body-sm text-on-surface-variant truncate">' + escapeHtml(dose) + '</div>' +
        '</div>' +
        '<span class="material-symbols-outlined text-on-surface-variant text-[18px]">chevron_right</span>' +
      '</div>'
    );
  }

  function openCollection(type, value){
    state.currentCollection = { type: type, value: value };
    if (type === 'category'){
      $('#kategoriTitle').textContent = value;
      showView('kategori-detail');
      withLoading(function(ok, fail){ google.script.run.withSuccessHandler(ok).withFailureHandler(fail).getCardsByCategory(value); },
        function(cards){ renderCollectionCards('#cardListInKategori', cards, openCardForm); });
    } else {
      state.currentDeck = value;
      $('#deckTitle').textContent = value;
      showView('deck');
      withLoading(function(ok, fail){ google.script.run.withSuccessHandler(ok).withFailureHandler(fail).getCardsByDeck(value); },
        function(cards){ renderCollectionCards('#cardListInDeck', cards, openCardForm); });
    }
  }

  function renderCollectionCards(containerSel, cards, onClickCard){
    var wrap = $(containerSel);
    wrap.innerHTML = '';
    if (!cards.length){
      wrap.innerHTML = '<p class="font-body-sm text-body-sm text-on-surface-variant col-span-full">Belum ada kartu di sini.</p>';
      return;
    }
    cards.forEach(function(c){
      var wrapper = document.createElement('button');
      wrapper.className = 'text-left';
      wrapper.innerHTML = cardRowHtml(c);
      wrapper.addEventListener('click', function(){ onClickCard(c.id); });
      wrap.appendChild(wrapper);
    });
  }

  $('#btnStartStudyFromDeck').addEventListener('click', function(){ startStudySession(); });
  $('#btnQuizFromDeck').addEventListener('click', function(){ openQuizIntro(); });
  $('#btnStartStudyFromKategori').addEventListener('click', function(){ startStudySession(); });
  $('#btnQuizFromKategori').addEventListener('click', function(){ openQuizIntro(); });

  function openQuizIntro(){
    state.staged = null;
    showView('quiz');
    $('#quizIntro').classList.remove('hidden');
    $('#quizArea').classList.add('hidden');
    $('#quizResult').classList.add('js-hidden');
  }

  // ---------- KATEGORI (LIST) ----------
  function loadCategories(){
    withLoading(function(ok, fail){ google.script.run.withSuccessHandler(ok).withFailureHandler(fail).getCategories(); },
      function(cats){
        var wrap = $('#categoryList');
        wrap.innerHTML = '';
        if (!cats.length){
          wrap.innerHTML = '<p class="font-body-sm text-body-sm text-on-surface-variant col-span-full">Belum ada kategori. Isi field "Golongan" saat menambah kartu untuk mengelompokkan obat.</p>';
          return;
        }
        cats.forEach(function(c){
          var card = document.createElement('button');
          card.className = 'text-left flex items-center gap-space-sm p-space-md rounded-xl bg-surface-container-low hover:bg-surface-container transition-colors border border-outline-variant/30';
          card.innerHTML =
            '<span class="w-11 h-11 rounded-full bg-tertiary-container/30 text-on-tertiary-fixed-variant flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-[20px]">category</span></span>' +
            '<div class="flex-1 min-w-0">' +
              '<div class="font-label-lg text-label-lg text-on-surface truncate">' + escapeHtml(c.name) + '</div>' +
              '<div class="font-body-sm text-body-sm text-on-surface-variant">' + c.total + ' kartu</div>' +
            '</div>';
          card.addEventListener('click', function(){ openCollection('category', c.name); });
          wrap.appendChild(card);
        });
      });
  }

  // ---------- FORM TAMBAH / EDIT KARTU ----------
  function openCardForm(id){
    state.editingId = id;
    $('#cardForm').reset();
    state.ruteSelected = '';
    $all('#ruteChips .chip-toggle').forEach(function(c){ c.classList.remove('is-active'); });
    $('#btnDeleteCard').classList.toggle('hidden', !id);

    withLoading(function(ok, fail){ google.script.run.withSuccessHandler(ok).withFailureHandler(fail).getAllDeckNames(); },
      function(decks){
        var dl = $('#deckOptions');
        dl.innerHTML = '';
        decks.forEach(function(d){
          var opt = document.createElement('option');
          opt.value = d;
          dl.appendChild(opt);
        });
      });

    if (id){
      $('#formTitle').textContent = 'Edit Kartu Obat';
      withLoading(function(ok, fail){ google.script.run.withSuccessHandler(ok).withFailureHandler(fail).getCardById(id); },
        function(c){
          $('#f_id').value = c.id;
          $('#f_deck').value = c.deck || '';
          $('#f_namaObat').value = c.namaObat || '';
          $('#f_namaDagang').value = c.namaDagang || '';
          $('#f_golongan').value = c.golongan || '';
          $('#f_indikasi').value = c.indikasi || '';
          $('#f_dosisDewasa').value = c.dosisDewasa || '';
          $('#f_dosisAnak').value = c.dosisAnak || '';
          $('#f_kontraindikasi').value = c.kontraindikasi || '';
          $('#f_efekSamping').value = c.efekSamping || '';
          $('#f_catatan').value = c.catatan || '';
          $('#f_tag').value = c.tag || '';
          $('#f_sumber').value = c.sumber || '';
          state.ruteSelected = c.rute || '';
          $('#f_rute').value = state.ruteSelected;
          $all('#ruteChips .chip-toggle').forEach(function(chip){
            chip.classList.toggle('is-active', chip.dataset.rute === state.ruteSelected);
          });
        });
    } else {
      $('#formTitle').textContent = 'Tambah Kartu Obat';
      $('#f_id').value = '';
      if (state.currentDeck && state.currentDeck !== 'Semua') $('#f_deck').value = state.currentDeck;
    }
    showView('form');
  }

  $all('#ruteChips .chip-toggle').forEach(function(chip){
    chip.addEventListener('click', function(){
      var isActive = chip.classList.contains('is-active');
      $all('#ruteChips .chip-toggle').forEach(function(c){ c.classList.remove('is-active'); });
      state.ruteSelected = isActive ? '' : chip.dataset.rute;
      if (!isActive) chip.classList.add('is-active');
      $('#f_rute').value = state.ruteSelected;
    });
  });

  $('#cardForm').addEventListener('submit', function(e){
    e.preventDefault();
    var payload = {
      deck: $('#f_deck').value.trim(),
      namaObat: $('#f_namaObat').value.trim(),
      namaDagang: $('#f_namaDagang').value.trim(),
      golongan: $('#f_golongan').value.trim(),
      indikasi: $('#f_indikasi').value.trim(),
      dosisDewasa: $('#f_dosisDewasa').value.trim(),
      dosisAnak: $('#f_dosisAnak').value.trim(),
      rute: state.ruteSelected,
      kontraindikasi: $('#f_kontraindikasi').value.trim(),
      efekSamping: $('#f_efekSamping').value.trim(),
      catatan: $('#f_catatan').value.trim(),
      tag: $('#f_tag').value.trim(),
      sumber: $('#f_sumber').value.trim()
    };
    if (!payload.deck || !payload.namaObat){
      showToast('Nama deck dan nama obat wajib diisi');
      return;
    }
    var id = $('#f_id').value;
    var btn = $('#btnSaveCard');
    btn.disabled = true; btn.textContent = 'Menyimpan...';

    var handler = id
      ? function(ok, fail){ google.script.run.withSuccessHandler(ok).withFailureHandler(fail).updateCard(id, payload); }
      : function(ok, fail){ google.script.run.withSuccessHandler(ok).withFailureHandler(fail).addCard(payload); };

    withLoading(handler, function(){
      btn.disabled = false; btn.textContent = 'Simpan Kartu';
      showToast('Kartu tersimpan');
      showView('dashboard');
      loadDashboard();
    }, function(){
      btn.disabled = false; btn.textContent = 'Simpan Kartu';
    });
  });

  $('#btnDeleteCard').addEventListener('click', function(){
    var id = $('#f_id').value;
    if (!id) return;
    if (!confirm('Hapus kartu ini?')) return;
    withLoading(function(ok, fail){ google.script.run.withSuccessHandler(ok).withFailureHandler(fail).deleteCard(id); },
      function(){
        showToast('Kartu dihapus');
        showView('dashboard');
        loadDashboard();
      });
  });

  // ---------- SESI BELAJAR BERTAHAP (5 obat -> kuis -> gerbang 100%) ----------
  var STAGED_BATCH_SIZE = 5;

  function currentStagedBatch(){
    var s = state.staged;
    if (!s) return [];
    return s.all.slice(s.batchIndex * s.batchSize, s.batchIndex * s.batchSize + s.batchSize);
  }

  function startStudySession(){
    var coll = state.currentCollection || { type: 'deck', value: 'Semua' };
    showView('study');
    $('#studyEmpty').classList.add('js-hidden');
    $('#studyCardWrap').classList.remove('hidden');
    $('#srsDock').classList.add('js-hidden');
    withLoading(function(ok, fail){ google.script.run.withSuccessHandler(ok).withFailureHandler(fail).getDueCardsByFilter(coll.type, coll.value); },
      function(cards){
        state.staged = { all: cards, batchIndex: 0, batchSize: STAGED_BATCH_SIZE, stage: 1 };
        beginBatchReview();
      });
  }

  function beginBatchReview(){
    var batch = currentStagedBatch();
    showView('study');
    if (!batch.length){
      var totalBatches = Math.ceil((state.staged ? state.staged.all.length : 0) / STAGED_BATCH_SIZE);
      $('#studyCardWrap').classList.add('hidden');
      $('#srsDock').classList.add('js-hidden');
      $('#studyEmpty').classList.remove('js-hidden');
      $('#studyEmpty h3').textContent = totalBatches ? 'Semua tuntas!' : 'Semua kartu sudah direview!';
      $('#studyEmpty p').textContent = totalBatches
        ? 'Semua obat yang due di koleksi ini sudah direview dan lulus kuis 100%. Kerja bagus!'
        : 'Tidak ada kartu yang due untuk koleksi ini hari ini.';
      $('#studyProgressText').textContent = '0 / 0';
      $('#studyProgressFill').style.width = '0%';
      return;
    }
    state.dueQueue = batch;
    state.studyIndex = 0;
    $('#studyEmpty').classList.add('js-hidden');
    $('#studyCardWrap').classList.remove('hidden');
    renderStudyCard();
  }

  function renderStudyCard(){
    var total = state.dueQueue.length;
    var idx = state.studyIndex;
    var batchNum = state.staged ? (state.staged.batchIndex + 1) : 1;
    $('#studyProgressText').textContent = 'Grup ' + batchNum + ' — kartu ' + Math.min(idx + 1, total) + ' / ' + total;
    $('#studyProgressFill').style.width = Math.round((idx/total)*100) + '%';

    if (idx >= total){
      // Selesai flashcard untuk grup 5 obat ini -> lanjut otomatis ke kuis grup ini.
      beginBatchQuiz();
      return;
    }

    var c = state.dueQueue[idx];
    state.flipped = false;
    var fc = $('#flashcard');
    fc.classList.remove('is-flipped');
    $('#srsDock').classList.add('js-hidden');

    $('#cardFrontName').textContent = c.namaObat;
    $('#cardFrontBrand').textContent = c.namaDagang || '';
    var chips = '';
    if (c.rute) chips += '<span class="bg-primary-fixed text-on-primary-fixed font-label-sm text-label-sm px-space-xs py-0.5 rounded-full uppercase">' + escapeHtml(c.rute) + '</span>';
    if (c.golongan) chips += '<span class="bg-surface-container-high text-on-surface-variant font-label-sm text-label-sm px-space-xs py-0.5 rounded-full uppercase">' + escapeHtml(c.golongan) + '</span>';
    $('#cardFrontChips').innerHTML = chips;

    $('#cardBackName').textContent = c.namaObat + (c.namaDagang ? ' (' + c.namaDagang + ')' : '');
    $('#rowDewasa').style.display = c.dosisDewasa ? 'flex' : 'none';
    $('#rowAnak').style.display = c.dosisAnak ? 'flex' : 'none';
    $('#cardBackDewasa').textContent = c.dosisDewasa || '-';
    $('#cardBackAnak').textContent = c.dosisAnak || '-';
    $('#infoIndikasi').textContent = c.indikasi ? ('Indikasi: ' + c.indikasi) : '';
    $('#infoKontraindikasi').textContent = c.kontraindikasi || '';
    $('#infoKontraindicaWrap').style.display = c.kontraindikasi ? 'flex' : 'none';
    $('#infoCatatan').textContent = c.catatan ? ('Catatan: ' + c.catatan) : '';
  }

  $('#flashcard').addEventListener('click', function(){
    if (state.flipped) return;
    state.flipped = true;
    $('#flashcard').classList.add('is-flipped');
    $('#srsDock').classList.remove('js-hidden');
  });

  $all('#srsDock .srs-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      var rating = btn.dataset.rating;
      var c = state.dueQueue[state.studyIndex];
      btn.disabled = true;
      withLoading(function(ok, fail){ google.script.run.withSuccessHandler(ok).withFailureHandler(fail).reviewCard(c.id, rating); },
        function(){
          btn.disabled = false;
          state.studyIndex++;
          renderStudyCard();
        }, function(){ btn.disabled = false; });
    });
  });

  // ---------- KUIS CEPAT ----------
  state.quizMode = 'obat-dosis';
  var quizModeHints = {
    'obat-dosis': 'Diberi nama obat, pilih dosis yang benar.',
    'indikasi-obat': 'Diberi indikasi/kondisi klinis, pilih obat yang sesuai. (Hanya obat dengan field Indikasi terisi yang akan muncul.)',
    'benar-salah': 'Sebuah pernyataan dosis ditampilkan — tentukan pernyataan itu benar atau salah.',
    'isian': 'Ketik sendiri dosisnya, lalu nilai sendiri jawaban Anda (self-check, seperti flashcard).'
  };

  var quizModeHints = {
    'obat-dosis': 'Diberi nama obat, pilih dosis yang benar.',
    'indikasi-obat': 'Diberi indikasi/kondisi klinis, pilih obat yang sesuai. (Hanya obat dengan field Indikasi terisi yang akan muncul.)',
    'benar-salah': 'Sebuah pernyataan dosis ditampilkan — tentukan pernyataan itu benar atau salah.',
    'isian': 'Ketik sendiri dosisnya, lalu nilai sendiri jawaban Anda (self-check, seperti flashcard).',
    'campuran': 'Tiap soal jenisnya diacak (Obat→Dosis, Indikasi→Obat, Benar/Salah, Isian) — cocok supaya tidak hafal pola soal.'
  };

  $all('#quizModeChips .chip-toggle').forEach(function(chip){
    chip.addEventListener('click', function(){
      $all('#quizModeChips .chip-toggle').forEach(function(c){ c.classList.remove('is-active'); });
      chip.classList.add('is-active');
      state.quizMode = chip.dataset.mode;
      $('#quizModeHint').textContent = quizModeHints[state.quizMode];
    });
  });

  function hideAllQuizWidgets(){
    $('#quizOptions').classList.add('js-hidden');
    $('#quizTrueFalseArea').classList.add('js-hidden');
    $('#quizFillArea').classList.add('js-hidden');
  }

  /** Konfigurasi 4 tahap kesulitan kuis per grup 5 obat — harus 100% baru naik tahap. */
  var QUIZ_STAGES = [
    { label: 'Tahap 1 — Mudah', short: 'Mudah', modes: ['obat-dosis'] },
    { label: 'Tahap 2 — Sedang', short: 'Sedang', modes: ['obat-dosis', 'indikasi-obat'] },
    { label: 'Tahap 3 — Sulit', short: 'Sulit', modes: ['isian'] },
    { label: 'Tahap 4 — FINAL STAGE (Sangat Sulit)', short: 'Final Stage', modes: ['obat-dosis', 'indikasi-obat', 'benar-salah', 'isian'] }
  ];

  /** Pilih satu jenis soal secara acak yang relevan untuk kartu ini (dipakai mode Campuran & mode Belajar Bertahap). */
  function pickRandomQuizMode(card){
    var pool = ['obat-dosis', 'benar-salah', 'isian'];
    if (card.indikasi && card.indikasi.trim()) pool.push('indikasi-obat');
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /** Sama seperti di atas, tapi dibatasi ke daftar mode milik satu tahap kesulitan tertentu. */
  function pickModeForStage(card, stageModes){
    var applicable = stageModes.filter(function(m){
      if (m === 'indikasi-obat') return card.indikasi && card.indikasi.trim();
      return true;
    });
    if (!applicable.length) applicable = ['obat-dosis'];
    return applicable[Math.floor(Math.random() * applicable.length)];
  }

  $('#btnStartQuiz').addEventListener('click', function(){
    state.staged = null; // pastikan kuis manual tidak ketiban status mode Belajar Bertahap sebelumnya
    var coll = state.currentCollection || { type: 'deck', value: 'Semua' };
    var count = parseInt($('#quizCount').value, 10) || 10;
    var mode = state.quizMode;
    // Untuk mode Indikasi->Obat kita perlu ambil pool lebih besar dulu, baru
    // disaring ke kartu yang field Indikasi-nya terisi, baru dipotong sesuai jumlah soal.
    var fetchCount = (mode === 'indikasi-obat') ? 500 : count;

    withLoading(function(ok, fail){ google.script.run.withSuccessHandler(ok).withFailureHandler(fail).getQuizCardsByFilter(coll.type, coll.value, fetchCount); },
      function(cards){
        if (mode === 'indikasi-obat'){
          cards = cards.filter(function(c){ return c.indikasi && c.indikasi.trim(); }).slice(0, count);
        }
        if (cards.length < 2){
          showToast(mode === 'indikasi-obat'
            ? 'Belum cukup kartu dengan field Indikasi terisi. Lengkapi field Indikasi dulu, atau pilih mode lain.'
            : 'Minimal butuh 2 kartu di sini untuk membuat kuis');
          return;
        }
        state.quizCards = cards;
        state.quizIndex = 0;
        state.quizScore = 0;
        $('#quizIntro').classList.add('hidden');
        $('#quizResult').classList.add('js-hidden');
        $('#quizArea').classList.remove('hidden');
        renderQuizQuestion();
      });
  });

  /** Dipanggil otomatis setelah flashcard 5-obat selesai, ATAU saat naik/mengulang tahap kesulitan. */
  function beginBatchQuiz(){
    var batch = currentStagedBatch();
    state.quizCards = batch.slice();
    for (var i = state.quizCards.length - 1; i > 0; i--){
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = state.quizCards[i]; state.quizCards[i] = state.quizCards[j]; state.quizCards[j] = tmp;
    }
    state.quizIndex = 0;
    state.quizScore = 0;
    showView('quiz');
    $('#quizIntro').classList.add('hidden');
    $('#quizResult').classList.add('js-hidden');
    $('#quizArea').classList.remove('hidden');

    if (state.staged){
      var stageConfig = QUIZ_STAGES[state.staged.stage - 1];
      $('#quizStageLabelWrap').classList.remove('hidden');
      $('#quizStageLabelWrap').classList.add('flex');
      $('#quizStageLabel').textContent = stageConfig.label;
    } else {
      $('#quizStageLabelWrap').classList.add('hidden');
      $('#quizStageLabelWrap').classList.remove('flex');
    }

    renderQuizQuestion();
  }

  function renderQuizQuestion(){
    state.quizAnswered = false;
    var total = state.quizCards.length;
    var idx = state.quizIndex;
    $('#quizProgressText').textContent = (idx+1) + ' / ' + total;
    $('#quizProgressFill').style.width = Math.round((idx/total)*100) + '%';

    if (idx >= total){
      finishQuiz(total);
      return;
    }

    hideAllQuizWidgets();
    var current = state.quizCards[idx];
    var mode;
    if (state.staged){
      mode = pickModeForStage(current, QUIZ_STAGES[state.staged.stage - 1].modes);
    } else if (state.quizMode === 'campuran'){
      mode = pickRandomQuizMode(current);
    } else {
      mode = state.quizMode;
    }

    if (mode === 'benar-salah'){
      renderQuizTrueFalse(current);
    } else if (mode === 'isian'){
      renderQuizFill(current);
    } else if (mode === 'indikasi-obat'){
      renderQuizMultipleChoice(current, 'drug');
    } else {
      renderQuizMultipleChoice(current, 'dose');
    }
  }

  function finishQuiz(total){
    $('#quizArea').classList.add('hidden');
    $('#quizResult').classList.remove('js-hidden');
    $('#quizScoreText').textContent = 'Skor: ' + state.quizScore + ' / ' + total;

    if (state.staged){
      var stageIdx = state.staged.stage - 1; // 0-based
      var stageConfig = QUIZ_STAGES[stageIdx];
      var isLastStage = state.staged.stage >= QUIZ_STAGES.length;

      $('#quizStandardActions').classList.add('js-hidden');
      $('#quizStagedActions').classList.remove('js-hidden');
      $('#btnStagedNext').classList.add('js-hidden');
      $('#btnStagedRetryQuiz').classList.add('js-hidden');
      $('#btnStagedReviewAgain').classList.add('js-hidden');
      $('#quizStagedMessage').classList.remove('hidden');

      if (state.quizScore === total){
        $('#quizResultIcon').textContent = isLastStage ? 'celebration' : 'workspace_premium';
        $('#btnStagedNext').classList.remove('js-hidden');

        if (!isLastStage){
          var nextStageConfig = QUIZ_STAGES[stageIdx + 1];
          $('#quizStagedMessage').textContent = 'Lulus ' + stageConfig.label + ' — 100%! Siap naik ke ' + nextStageConfig.label + '?';
          $('#btnStagedNext').textContent = 'Lanjut ke ' + nextStageConfig.label;
        } else {
          var hasMoreBatch = ((state.staged.batchIndex + 1) * state.staged.batchSize) < state.staged.all.length;
          $('#quizStagedMessage').textContent = hasMoreBatch
            ? 'FINAL STAGE LULUS 100%! 5 obat ini sudah benar-benar nempel. Lanjut ke grup berikutnya?'
            : 'FINAL STAGE LULUS 100%! Semua grup di koleksi ini sudah tuntas total. Luar biasa!';
          $('#btnStagedNext').textContent = hasMoreBatch ? 'Lanjut ke 5 Obat Berikutnya' : 'Selesai — Kembali ke Deck';
        }
      } else {
        $('#quizResultIcon').textContent = 'refresh';
        $('#quizStagedMessage').textContent = 'Belum 100% di ' + stageConfig.label + ' (' + state.quizScore + '/' + total + ') — ulangi dulu ya supaya makin nempel.';
        $('#btnStagedRetryQuiz').classList.remove('js-hidden');
        $('#btnStagedRetryQuiz').textContent = 'Ulangi Kuis ' + stageConfig.label;
        $('#btnStagedReviewAgain').classList.remove('js-hidden');
      }
    } else {
      $('#quizStandardActions').classList.remove('js-hidden');
      $('#quizStagedActions').classList.add('js-hidden');
      $('#quizStagedMessage').classList.add('hidden');
      $('#quizStageLabelWrap').classList.add('hidden');
      $('#quizStageLabelWrap').classList.remove('flex');
      $('#quizResultIcon').textContent = 'military_tech';
    }
  }

  $('#btnStagedNext').addEventListener('click', function(){
    if (!state.staged) return;
    var isLastStage = state.staged.stage >= QUIZ_STAGES.length;

    if (!isLastStage){
      // Lulus tahap ini -> naik satu tahap kesulitan, kuis lagi dengan 5 obat yang sama.
      state.staged.stage++;
      beginBatchQuiz();
      return;
    }

    // Final Stage baru saja lulus -> grup ini benar-benar tuntas, lanjut ke grup berikutnya.
    var hasMore = ((state.staged.batchIndex + 1) * state.staged.batchSize) < state.staged.all.length;
    if (hasMore){
      state.staged.batchIndex++;
      state.staged.stage = 1;
      beginBatchReview();
    } else {
      state.staged = null;
      if (state.currentCollection) openCollection(state.currentCollection.type, state.currentCollection.value);
      else { showView('dashboard'); loadDashboard(); }
    }
  });
  $('#btnStagedRetryQuiz').addEventListener('click', function(){ beginBatchQuiz(); });
  $('#btnStagedReviewAgain').addEventListener('click', function(){ beginBatchReview(); });
  $('#btnStagedExit').addEventListener('click', function(){
    state.staged = null;
    if (state.currentCollection) openCollection(state.currentCollection.type, state.currentCollection.value);
    else { showView('dashboard'); loadDashboard(); }
  });

  function renderQuizMultipleChoice(current, kind){
    $('#quizOptions').classList.remove('js-hidden');
    var correctAnswer, getValue, fallbackText;
    if (kind === 'drug'){
      correctAnswer = current.namaObat;
      getValue = function(c){ return c.namaObat; };
      fallbackText = 'Obat lain';
      $('#quizQuestion').textContent = 'Obat apa yang sesuai indikasi: "' + current.indikasi + '"?';
    } else {
      correctAnswer = current.dosisDewasa || current.dosisAnak || '-';
      getValue = function(c){ return c.dosisDewasa || c.dosisAnak || '-'; };
      fallbackText = 'Tidak ada data lain';
      $('#quizQuestion').textContent = 'Berapa dosis untuk ' + current.namaObat + '?';
    }

    var pool = state.quizCards.filter(function(c){ return c.id !== current.id; });
    var wrongOptions = [];
    var seen = {};
    for (var i = pool.length - 1; i > 0 && wrongOptions.length < 3; i--){
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    pool.forEach(function(c){
      if (wrongOptions.length >= 3) return;
      var v = getValue(c);
      if (v && v !== correctAnswer && !seen[v]){
        seen[v] = true;
        wrongOptions.push(v);
      }
    });
    while (wrongOptions.length < 3){ wrongOptions.push(fallbackText + ' ' + (wrongOptions.length + 1)); }

    var options = wrongOptions.concat([correctAnswer]);
    for (var k = options.length - 1; k > 0; k--){
      var l = Math.floor(Math.random() * (k + 1));
      var t = options[k]; options[k] = options[l]; options[l] = t;
    }

    var wrap = $('#quizOptions');
    wrap.innerHTML = '';
    options.forEach(function(opt){
      var btn = document.createElement('button');
      btn.className = 'quiz-opt text-left px-space-md py-space-sm rounded-xl border border-outline-variant bg-surface-container-lowest font-body-md text-body-md text-on-surface transition-colors';
      btn.textContent = opt;
      btn.addEventListener('click', function(){
        if (state.quizAnswered) return;
        state.quizAnswered = true;
        var isCorrect = opt === correctAnswer;
        if (isCorrect){
          btn.classList.add('is-correct');
          state.quizScore++;
          playCorrectSound();
        } else {
          btn.classList.add('is-wrong');
          playWrongSound();
          $all('#quizOptions .quiz-opt').forEach(function(b){
            if (b.textContent === correctAnswer) b.classList.add('is-correct');
          });
        }
        setTimeout(function(){
          state.quizIndex++;
          renderQuizQuestion();
        }, 900);
      });
      wrap.appendChild(btn);
    });
  }

  function renderQuizTrueFalse(current){
    $('#quizTrueFalseArea').classList.remove('js-hidden');
    $('#quizQuestion').textContent = 'Benar atau salah, dosis di bawah ini?';
    var correctDose = current.dosisDewasa || current.dosisAnak || '-';
    var showTrue = Math.random() < 0.5;
    var shownDose = correctDose;

    if (!showTrue){
      var pool = state.quizCards.filter(function(c){
        var d = c.dosisDewasa || c.dosisAnak;
        return c.id !== current.id && d && d !== correctDose;
      });
      if (pool.length){
        var decoy = pool[Math.floor(Math.random() * pool.length)];
        shownDose = decoy.dosisDewasa || decoy.dosisAnak;
      } else {
        showTrue = true; // tidak ada decoy valid, tampilkan pernyataan yang benar saja
      }
    }

    $('#quizStatementDrug').textContent = current.namaObat + (current.namaDagang ? ' (' + current.namaDagang + ')' : '');
    $('#quizStatementDose').textContent = shownDose;
    state._tfCorrectAnswer = showTrue;
    $('#quizStatementBox').className = 'p-space-lg rounded-xl bg-surface-container-low text-center transition-colors duration-300';
  }

  function answerTrueFalse(userSaysTrue){
    if (state.quizAnswered) return;
    state.quizAnswered = true;
    var isRight = (userSaysTrue === state._tfCorrectAnswer);
    if (isRight){ state.quizScore++; playCorrectSound(); } else { playWrongSound(); }
    var box = $('#quizStatementBox');
    box.classList.add(isRight ? 'bg-secondary-container/40' : 'bg-error-container/50');
    setTimeout(function(){
      state.quizIndex++;
      renderQuizQuestion();
    }, 900);
  }
  $('#btnTF_Benar').addEventListener('click', function(){ answerTrueFalse(true); });
  $('#btnTF_Salah').addEventListener('click', function(){ answerTrueFalse(false); });

  function renderQuizFill(current){
    $('#quizFillArea').classList.remove('js-hidden');
    $('#quizQuestion').textContent = 'Ketik dosis untuk obat berikut:';
    $('#quizFillDrug').textContent = current.namaObat + (current.namaDagang ? ' (' + current.namaDagang + ')' : '');
    $('#quizFillInput').value = '';
    $('#quizFillReveal').classList.add('js-hidden');
    $('#btnCheckFill').classList.remove('hidden');
    state._fillCorrectAnswer = current.dosisDewasa || current.dosisAnak || '-';
  }

  $('#btnCheckFill').addEventListener('click', function(){
    $('#quizFillCorrectAnswer').textContent = state._fillCorrectAnswer;
    $('#quizFillReveal').classList.remove('js-hidden');
    $('#btnCheckFill').classList.add('hidden');
  });

  function answerFill(isRight){
    if (state.quizAnswered) return;
    state.quizAnswered = true;
    if (isRight){ state.quizScore++; playCorrectSound(); } else { playWrongSound(); }
    state.quizIndex++;
    renderQuizQuestion();
  }
  $('#btnFillCorrect').addEventListener('click', function(){ answerFill(true); });
  $('#btnFillWrong').addEventListener('click', function(){ answerFill(false); });

  $('#btnQuizAgain').addEventListener('click', function(){
    $('#quizResult').classList.add('js-hidden');
    $('#quizIntro').classList.remove('hidden');
  });

  // ---------- STATISTIK ----------
  function barRow(label, count, max){
    return '<div class="flex items-center gap-space-sm">' +
      '<span class="font-body-sm text-body-sm text-on-surface w-32 truncate shrink-0">' + escapeHtml(label) + '</span>' +
      '<div class="flex-1 h-2.5 rounded-full bg-surface-container-highest overflow-hidden"><div class="h-full bg-gradient-to-r from-primary to-secondary" style="width:' + Math.round((count/max)*100) + '%"></div></div>' +
      '<span class="font-mono-sm text-mono-sm text-on-surface-variant w-6 text-right">' + count + '</span>' +
    '</div>';
  }

  function loadStats(){
    withLoading(function(ok, fail){ google.script.run.withSuccessHandler(ok).withFailureHandler(fail).getStats(); },
      function(stats){
        var statusLabels = {New:'Baru', Learning:'Belajar', Review:'Review', Mastered:'Dikuasai'};
        var statusColorClass = {New:'text-outline', Learning:'text-[#E07A5F]', Review:'text-primary', Mastered:'text-secondary'};
        var grid = $('#statStatusGrid');
        grid.innerHTML = '';
        Object.keys(statusLabels).forEach(function(key){
          var box = document.createElement('div');
          box.className = 'p-space-md rounded-xl bg-surface-container-low';
          box.innerHTML =
            '<span class="font-label-caps text-label-caps text-outline uppercase tracking-wider">' + statusLabels[key] + '</span>' +
            '<div class="font-display-lg text-display-lg mt-space-xxs ' + statusColorClass[key] + '">' + (stats.byStatus[key] || 0) + '</div>';
          grid.appendChild(box);
        });

        var deckMax = Math.max.apply(null, Object.keys(stats.byDeck).map(function(k){ return stats.byDeck[k]; }).concat([1]));
        $('#statDeckBars').innerHTML = Object.keys(stats.byDeck).map(function(k){ return barRow(k, stats.byDeck[k], deckMax); }).join('');

        var catMax = Math.max.apply(null, Object.keys(stats.byCategory).map(function(k){ return stats.byCategory[k]; }).concat([1]));
        $('#statCategoryBars').innerHTML = Object.keys(stats.byCategory).map(function(k){ return barRow(k, stats.byCategory[k], catMax); }).join('');
      });

    withLoading(function(ok, fail){ google.script.run.withSuccessHandler(ok).withFailureHandler(fail).getStudyHistory(14); },
      function(hist){
        $('#statTotalReviews').textContent = hist.totalReviews + ' review sepanjang waktu';
        var max = Math.max.apply(null, hist.counts.concat([1]));
        var barsWrap = $('#statHistoryBars');
        var labelsWrap = $('#statHistoryLabels');
        barsWrap.innerHTML = '';
        labelsWrap.innerHTML = '';
        hist.labels.forEach(function(label, i){
          var count = hist.counts[i];
          var heightPct = Math.max(4, Math.round((count / max) * 100));
          var bar = document.createElement('div');
          bar.className = 'flex-1 rounded-t-md ' + (count > 0 ? 'bg-primary' : 'bg-surface-container-highest');
          bar.style.height = heightPct + '%';
          bar.title = label + ': ' + count + ' review';
          barsWrap.appendChild(bar);

          if (i % Math.ceil(hist.labels.length / 5) === 0 || i === hist.labels.length - 1){
            var lbl = document.createElement('span');
            lbl.className = 'font-mono-sm text-mono-sm text-on-surface-variant';
            lbl.textContent = label.slice(5); // "MM-DD"
            labelsWrap.appendChild(lbl);
          }
        });
      });
  }

  // ---------- REFERENSI ANAK ----------
  function loadReferensi(){
    if (state.referensi){ renderReferensiTables(); return; }
    withLoading(function(ok, fail){ google.script.run.withSuccessHandler(ok).withFailureHandler(fail).getRujukanAnak(); },
      function(data){
        state.referensi = data;
        renderReferensiTables();
      });
  }

  function refRowHtml(r){
    return '<tr><td class="py-space-xs pr-space-md font-label-lg text-label-lg text-on-surface whitespace-nowrap">' + escapeHtml(r.bbLabel) + '</td><td class="py-space-xs font-body-sm text-body-sm text-on-surface-variant">' + escapeHtml(r.keterangan) + '</td></tr>';
  }

  function renderReferensiTables(){
    $('#tablePulvBody').innerHTML = state.referensi.pulv.map(refRowHtml).join('');
    $('#tableCairanBody').innerHTML = state.referensi.cairan.map(refRowHtml).join('');
  }

  function parseRange(label){
    label = label.toLowerCase().replace('kg','').replace('an','').trim();
    if (label.indexOf('>') !== -1){ return { min: parseFloat(label.replace('>','').trim()), max: Infinity }; }
    if (label.indexOf('<') !== -1){ return { min: 0, max: parseFloat(label.replace('<','').trim()) }; }
    if (label.indexOf('-') !== -1){
      var parts = label.split('-').map(function(s){ return parseFloat(s.trim()); });
      return { min: parts[0], max: parts[1] };
    }
    var single = parseFloat(label.trim());
    return { min: single, max: single };
  }

  $('#calcBB').addEventListener('input', function(){
    var bb = parseFloat(this.value);
    var resultBox = $('#calcResult');
    if (isNaN(bb) || !state.referensi){
      resultBox.classList.add('js-hidden');
      return;
    }
    var pulvMatch = state.referensi.pulv.find(function(r){ var rg = parseRange(r.bbLabel); return bb >= rg.min && bb <= rg.max; });
    var cairanMatch = state.referensi.cairan.find(function(r){ var rg = parseRange(r.bbLabel); return bb >= rg.min && bb <= rg.max; });
    $('#calcPulvResult').textContent = pulvMatch ? pulvMatch.keterangan : 'Di luar tabel';
    $('#calcCairanResult').textContent = cairanMatch ? cairanMatch.keterangan : 'Di luar tabel';
    resultBox.classList.remove('js-hidden');
  });

  // ---------- IMPORT DARI FOTO/PDF (AI) ----------
  function loadImportView(){
    $('#importResults').classList.add('hidden');
    $('#importCandidateList').innerHTML = '';
    withLoading(function(ok, fail){ google.script.run.withSuccessHandler(ok).withFailureHandler(fail).getGeminiKeyStatus(); },
      function(status){
        $('#geminiKeyStatus').textContent = status.hasKey
          ? ('API key tersimpan: ' + status.masked)
          : 'Belum ada API key tersimpan.';
      });
    withLoading(function(ok, fail){ google.script.run.withSuccessHandler(ok).withFailureHandler(fail).getAllDeckNames(); },
      function(decks){
        var dl = $('#deckOptions');
        dl.innerHTML = '';
        decks.forEach(function(d){ var opt = document.createElement('option'); opt.value = d; dl.appendChild(opt); });
        if (decks.length && !$('#importDeck').value) $('#importDeck').value = decks[0];
      });
  }

  $('#btnSaveGeminiKey').addEventListener('click', function(){
    var key = $('#geminiKeyInput').value.trim();
    if (!key){ showToast('Isi API key terlebih dahulu'); return; }
    withLoading(function(ok, fail){ google.script.run.withSuccessHandler(ok).withFailureHandler(fail).saveGeminiApiKey(key); },
      function(){
        showToast('API key tersimpan');
        $('#geminiKeyInput').value = '';
        loadImportView();
      });
  });

  function fileToBase64(file){
    return new Promise(function(resolve, reject){
      var reader = new FileReader();
      reader.onload = function(){
        var result = reader.result; // data:<mime>;base64,<data>
        var base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  $('#btnProcessImport').addEventListener('click', function(){
    var fileInput = $('#importFile');
    var file = fileInput.files && fileInput.files[0];
    if (!file){ showToast('Pilih foto atau file PDF terlebih dahulu'); return; }
    if (!$('#importDeck').value.trim()){ showToast('Isi nama deck tujuan terlebih dahulu'); return; }

    var btn = $('#btnProcessImport');
    btn.disabled = true;
    $('#importLoadingText').classList.remove('hidden');

    fileToBase64(file).then(function(base64){
      withLoading(function(ok, fail){ google.script.run.withSuccessHandler(ok).withFailureHandler(fail).extractCardsFromFile(base64, file.type); },
        function(cards){
          btn.disabled = false;
          $('#importLoadingText').classList.add('hidden');
          state.importCandidates = cards.map(function(c){
            c._include = true;
            return c;
          });
          renderImportCandidates();
        },
        function(){
          btn.disabled = false;
          $('#importLoadingText').classList.add('hidden');
        });
    }).catch(function(){
      btn.disabled = false;
      $('#importLoadingText').classList.add('hidden');
      showToast('Gagal membaca file');
    });
  });

  function renderImportCandidates(){
    var wrap = $('#importCandidateList');
    wrap.innerHTML = '';
    $('#importResults').classList.remove('hidden');
    $('#importResultCount').textContent = state.importCandidates.length + ' obat ditemukan';

    if (!state.importCandidates.length){
      wrap.innerHTML = '<p class="font-body-sm text-body-sm text-on-surface-variant">Tidak ada obat yang berhasil dikenali. Coba foto yang lebih jelas.</p>';
      return;
    }

    state.importCandidates.forEach(function(c, idx){
      var row = document.createElement('div');
      row.className = 'p-space-sm rounded-xl bg-surface-container-low flex flex-col gap-space-xxs';
      row.innerHTML =
        '<label class="flex items-center gap-space-xs">' +
          '<input type="checkbox" data-idx="' + idx + '" class="import-check w-4 h-4" ' + (c._include ? 'checked' : '') + '>' +
          '<input type="text" class="import-nama field-input flex-1 px-space-sm py-1 border border-outline-variant rounded-lg bg-surface-container-lowest font-label-lg text-label-lg" data-idx="' + idx + '" value="' + escapeHtml(c.namaObat || '') + '" placeholder="Nama obat">' +
        '</label>' +
        '<input type="text" class="import-dewasa field-input px-space-sm py-1 border border-outline-variant rounded-lg bg-surface-container-lowest font-body-sm text-body-sm" data-idx="' + idx + '" value="' + escapeHtml(c.dosisDewasa || '') + '" placeholder="Dosis dewasa">' +
        '<input type="text" class="import-anak field-input px-space-sm py-1 border border-outline-variant rounded-lg bg-surface-container-lowest font-body-sm text-body-sm" data-idx="' + idx + '" value="' + escapeHtml(c.dosisAnak || '') + '" placeholder="Dosis anak">';
      wrap.appendChild(row);
    });

    $all('.import-check').forEach(function(el){
      el.addEventListener('change', function(){ state.importCandidates[+el.dataset.idx]._include = el.checked; });
    });
    $all('.import-nama').forEach(function(el){
      el.addEventListener('input', function(){ state.importCandidates[+el.dataset.idx].namaObat = el.value; });
    });
    $all('.import-dewasa').forEach(function(el){
      el.addEventListener('input', function(){ state.importCandidates[+el.dataset.idx].dosisDewasa = el.value; });
    });
    $all('.import-anak').forEach(function(el){
      el.addEventListener('input', function(){ state.importCandidates[+el.dataset.idx].dosisAnak = el.value; });
    });
  }

  $('#btnSaveImported').addEventListener('click', function(){
    var deck = $('#importDeck').value.trim();
    var selected = state.importCandidates.filter(function(c){ return c._include && c.namaObat; });
    if (!selected.length){ showToast('Pilih minimal satu obat untuk disimpan'); return; }
    var btn = $('#btnSaveImported');
    btn.disabled = true; btn.textContent = 'Menyimpan...';
    withLoading(function(ok, fail){ google.script.run.withSuccessHandler(ok).withFailureHandler(fail).bulkAddCards(deck, selected); },
      function(result){
        btn.disabled = false; btn.textContent = 'Simpan Kartu Terpilih';
        showToast(result.count + ' kartu berhasil disimpan ke deck "' + deck + '"');
        state.importCandidates = [];
        $('#importResults').classList.add('hidden');
        $('#importFile').value = '';
      }, function(){ btn.disabled = false; btn.textContent = 'Simpan Kartu Terpilih'; });
  });

  // ---------- PROFIL ----------
  state.currentPhotoUrl = '';

  /** Isi satu elemen avatar dengan foto (kalau ada) atau inisial nama (kalau tidak). */
  function applyAvatarVisual(el, name, photoUrl){
    if (!el) return;
    if (photoUrl){
      el.innerHTML = '<img src="' + escapeHtml(photoUrl) + '" alt="" class="w-full h-full object-cover">';
    } else {
      el.textContent = initials(name);
    }
  }

  function applyProfileToChrome(profile){
    var name = profile.name || '';
    var title = profile.title || '';
    state.currentPhotoUrl = profile.photoUrl || '';
    applyAvatarVisual($('#sidebarAvatarInitials'), name, state.currentPhotoUrl);
    applyAvatarVisual($('#btnProfileMobile'), name, state.currentPhotoUrl);
    $('#sidebarProfileName').textContent = name || 'Atur Profil';
    $('#sidebarProfileTitle').textContent = title || 'Belum diisi';
  }

  function loadProfileView(){
    withLoading(function(ok, fail){ google.script.run.withSuccessHandler(ok).withFailureHandler(fail).getProfile(); },
      function(profile){
        $('#profileNameInput').value = profile.name || '';
        $('#profileTitleInput').value = profile.title || '';
        $('#profileDisplayName').textContent = profile.name || 'Belum ada nama';
        $('#profileDisplayTitle').textContent = profile.title || 'Atur nama & gelar Anda di bawah';
        applyAvatarVisual($('#profileAvatarBig'), profile.name, profile.photoUrl);
        $('#btnRemovePhoto').classList.toggle('hidden', !profile.photoUrl);
        applyProfileToChrome(profile);
      });
  }

  $('#btnSaveProfile').addEventListener('click', function(){
    var profile = { name: $('#profileNameInput').value.trim(), title: $('#profileTitleInput').value.trim() };
    withLoading(function(ok, fail){ google.script.run.withSuccessHandler(ok).withFailureHandler(fail).saveProfile(profile); },
      function(saved){
        showToast('Profil tersimpan');
        $('#profileDisplayName').textContent = saved.name || 'Belum ada nama';
        $('#profileDisplayTitle').textContent = saved.title || 'Atur nama & gelar Anda di bawah';
        applyAvatarVisual($('#profileAvatarBig'), saved.name, saved.photoUrl);
        applyProfileToChrome(saved);
      });
  });

  function loadProfileForChrome(){
    withLoading(function(ok, fail){ google.script.run.withSuccessHandler(ok).withFailureHandler(fail).getProfile(); },
      function(profile){ applyProfileToChrome(profile); });
  }

  // ---------- GANTI FOTO PROFIL ----------
  /** Baca file gambar, crop ke bujur sangkar dari tengah, lalu kompres ke JPEG — supaya upload cepat & rapi. */
  function resizeImageFileToSquareBase64(file, targetSize){
    return new Promise(function(resolve, reject){
      var reader = new FileReader();
      reader.onload = function(e){
        var img = new Image();
        img.onload = function(){
          var size = Math.min(img.width, img.height);
          var sx = (img.width - size) / 2;
          var sy = (img.height - size) / 2;
          var canvas = document.createElement('canvas');
          canvas.width = targetSize;
          canvas.height = targetSize;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, sx, sy, size, size, 0, 0, targetSize, targetSize);
          var dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          resolve(dataUrl.split(',')[1]);
        };
        img.onerror = function(){ reject(new Error('Gagal membaca gambar')); };
        img.src = e.target.result;
      };
      reader.onerror = function(){ reject(new Error('Gagal membaca file')); };
      reader.readAsDataURL(file);
    });
  }

  $('#btnChangePhoto').addEventListener('click', function(){ $('#profilePhotoInput').click(); });
  $('#btnUploadPhotoText').addEventListener('click', function(){ $('#profilePhotoInput').click(); });

  $('#profilePhotoInput').addEventListener('change', function(){
    var file = this.files && this.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)){
      showToast('File harus berupa gambar');
      return;
    }
    $('#photoUploadStatus').classList.remove('hidden');
    $('#photoUploadStatus').textContent = 'Mengunggah...';

    resizeImageFileToSquareBase64(file, 320).then(function(base64){
      withLoading(function(ok, fail){ google.script.run.withSuccessHandler(ok).withFailureHandler(fail).saveProfilePhoto(base64, 'image/jpeg'); },
        function(result){
          $('#photoUploadStatus').classList.add('hidden');
          showToast('Foto profil tersimpan');
          applyAvatarVisual($('#profileAvatarBig'), $('#profileNameInput').value, result.photoUrl);
          $('#btnRemovePhoto').classList.remove('hidden');
          state.currentPhotoUrl = result.photoUrl;
          applyAvatarVisual($('#sidebarAvatarInitials'), $('#profileNameInput').value, result.photoUrl);
          applyAvatarVisual($('#btnProfileMobile'), $('#profileNameInput').value, result.photoUrl);
        },
        function(){ $('#photoUploadStatus').classList.add('hidden'); });
    }).catch(function(){
      $('#photoUploadStatus').classList.add('hidden');
      showToast('Gagal memproses gambar, coba file lain');
    });

    this.value = ''; // reset supaya file yang sama bisa dipilih ulang nanti
  });

  $('#btnRemovePhoto').addEventListener('click', function(){
    if (!confirm('Hapus foto profil?')) return;
    withLoading(function(ok, fail){ google.script.run.withSuccessHandler(ok).withFailureHandler(fail).removeProfilePhoto(); },
      function(){
        showToast('Foto profil dihapus');
        $('#btnRemovePhoto').classList.add('hidden');
        state.currentPhotoUrl = '';
        var name = $('#profileNameInput').value;
        applyAvatarVisual($('#profileAvatarBig'), name, '');
        applyAvatarVisual($('#sidebarAvatarInitials'), name, '');
        applyAvatarVisual($('#btnProfileMobile'), name, '');
      });
  });

  // ---------- LOGO / BRAND -> KEMBALI KE DASHBOARD ----------
  function goToDashboard(){
    showView('dashboard');
    loadDashboard();
  }
  $('#sidebarBrandBtn').addEventListener('click', goToDashboard);
  $('#mobileBrandBtn').addEventListener('click', goToDashboard);

  // ---------- SEARCH ----------
  $('#btnSearchToggleMobile').addEventListener('click', function(){
    $('#searchBarMobile').classList.toggle('hidden');
    if (!$('#searchBarMobile').classList.contains('hidden')) $('#searchInputMobile').focus();
  });

  function openSearch(){
    showView('search');
    setActiveNav('search');
    $('#searchResults').innerHTML = '<p class="font-body-sm text-body-sm text-on-surface-variant col-span-full">Ketik untuk mencari obat...</p>';
    if (window.innerWidth >= 1024){
      $('#searchInputDesktop').focus();
    } else {
      $('#searchBarMobile').classList.remove('hidden');
      $('#searchInputMobile').focus();
    }
  }

  var searchDebounce;
  function doSearch(query){
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(function(){
      withLoading(function(ok, fail){ google.script.run.withSuccessHandler(ok).withFailureHandler(fail).searchCards(query, 'Semua'); },
        function(cards){
          var wrap = $('#searchResults');
          wrap.innerHTML = '';
          if (!query){
            wrap.innerHTML = '<p class="font-body-sm text-body-sm text-on-surface-variant col-span-full">Ketik untuk mencari obat...</p>';
            return;
          }
          if (!cards.length){
            wrap.innerHTML = '<p class="font-body-sm text-body-sm text-on-surface-variant col-span-full">Tidak ada hasil untuk "' + escapeHtml(query) + '"</p>';
            return;
          }
          cards.forEach(function(c){
            var wrapper = document.createElement('button');
            wrapper.className = 'text-left';
            var dose = c.dosisDewasa || c.dosisAnak || '-';
            wrapper.innerHTML =
              '<div class="flex items-center gap-space-sm p-space-sm rounded-xl bg-surface-container-low hover:bg-surface-container transition-colors">' +
                '<span class="w-2.5 h-2.5 rounded-full shrink-0 ' + statusDotClass(c.status) + '"></span>' +
                '<div class="flex-1 min-w-0">' +
                  '<div class="font-label-lg text-label-lg text-on-surface truncate">' + escapeHtml(c.namaObat) + ' <span class="font-body-sm text-body-sm text-on-surface-variant font-normal">&middot; ' + escapeHtml(c.deck) + '</span></div>' +
                  '<div class="font-body-sm text-body-sm text-on-surface-variant truncate">' + escapeHtml(dose) + '</div>' +
                '</div>' +
              '</div>';
            wrapper.addEventListener('click', function(){ openCardForm(c.id); });
            wrap.appendChild(wrapper);
          });
        });
    }, 300);
  }

  $('#searchInputDesktop').addEventListener('input', function(){
    if (document.getElementById('view-search').classList.contains('hidden')){
      showView('search'); setActiveNav('search');
    }
    doSearch(this.value.trim());
  });
  $('#searchInputMobile').addEventListener('input', function(){ doSearch(this.value.trim()); });

  // ---------- INIT ----------
  function init(){
    loadDashboard();
    loadProfileForChrome();
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive'){
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }

})();
