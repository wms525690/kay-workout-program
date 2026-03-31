/* ================================================
   KAY — WORKOUT PROGRAM APP
   Firebase Firestore + localStorage fallback
   Date-aware daily reset + weekly analytics
   ================================================

   SETUP CHECKLIST — change these values for each athlete:
   1. FIREBASE_CONFIG — create a new Firebase project or reuse
   2. ATHLETE_DOC — unique Firestore document path
   3. STORAGE_KEY — unique localStorage key
   4. PIN_CODE — athlete's editing PIN
   5. WEEKLY_TARGET_MULTIPLIERS — per-section weekly goals
   6. SECTION_MAP — must match your nav tabs / exercise ID prefixes
   ================================================ */

(function () {
  'use strict';

  // ============ ATHLETE CONFIG — EDIT THESE ============
  var firebaseConfig = {
    apiKey: "AIzaSyDuD9sL5mkmBKExepL0UZ_vpEH7J9ChocE",
    authDomain: "justus-workout-program.firebaseapp.com",
    projectId: "justus-workout-program",
    storageBucket: "justus-workout-program.firebasestorage.app",
    messagingSenderId: "704428705442",
    appId: "1:704428705442:web:6fb1c8262925068732b9fb"
  };

  var ATHLETE_DOC = 'kay';  // Firestore: athletes/kay
  // ============ END ATHLETE CONFIG ============

  firebase.initializeApp(firebaseConfig);
  var db = firebase.firestore();
  var DOC_REF = db.collection('athletes').doc(ATHLETE_DOC);
  var firestoreReady = false;

  // ---------- Date Helpers ----------
  function todayKey() {
    return new Date().toISOString().slice(0, 10); // "2026-03-29"
  }

  function getMonday(dateStr) {
    var d = new Date(dateStr + 'T00:00:00');
    var day = d.getDay();
    var diff = (day === 0 ? -6 : 1) - day; // Monday = 1
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  }

  function addDays(dateStr, n) {
    var d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function formatDate(dateStr) {
    var d = new Date(dateStr + 'T00:00:00');
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return days[d.getDay()] + ' ' + months[d.getMonth()] + ' ' + d.getDate();
  }

  function formatWeekRange(mondayStr) {
    var sunday = addDays(mondayStr, 6);
    var thisMon = getMonday(todayKey());
    if (mondayStr === thisMon) return 'This Week';
    return formatDate(mondayStr) + ' – ' + formatDate(sunday);
  }

  // ---------- State ----------
  var STORAGE_KEY = ATHLETE_DOC + '-workout';  // auto-generated from athlete name

  // One-time data reset — clean slate on deploy
  if (!localStorage.getItem('kay-reset-v1')) {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.setItem('kay-reset-v1', '1');
  }
  var needsFirestoreReset = false;

  function emptyDay() {
    return { checks: {}, notes: {}, ratings: {}, actuals: {} };
  }

  function loadLocalState() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  }

  function saveLocalState(s) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  }

  // Migrate old flat state → date-keyed state
  function migrateIfNeeded(raw) {
    if (raw.checks || raw.notes || raw.ratings || raw.actuals) {
      var key = raw.lastUpdated ? raw.lastUpdated.slice(0, 10) : todayKey();
      var migrated = {};
      migrated[key] = {
        checks: raw.checks || {},
        notes: raw.notes || {},
        ratings: raw.ratings || {},
        actuals: raw.actuals || {}
      };
      saveLocalState(migrated);
      return migrated;
    }
    return raw;
  }

  var allState = migrateIfNeeded(loadLocalState());

  // Today's working state
  function getTodayState() {
    var key = todayKey();
    if (!allState[key]) allState[key] = emptyDay();
    return allState[key];
  }

  var state = getTodayState();

  // Sync to Firestore (full history)
  function syncToFirestore() {
    if (!firestoreReady) return;
    DOC_REF.set({
      days: allState,
      lastUpdated: new Date().toISOString()
    }, { merge: true }).catch(function (err) {
      console.warn('Firestore sync failed, data saved locally:', err);
    });
  }

  // Load from Firestore
  function initFirestore() {
    // If a reset was triggered, wipe Firestore before loading
    if (needsFirestoreReset) {
      needsFirestoreReset = false;
      DOC_REF.set({ days: {}, lastUpdated: new Date().toISOString() }).then(function () {
        firestoreReady = true;
        console.log('Firestore reset complete');
      }).catch(function (err) {
        console.warn('Firestore reset failed:', err);
        firestoreReady = false;
      });
      return;
    }

    DOC_REF.get().then(function (snapshot) {
      if (snapshot.exists) {
        var remote = snapshot.data();
        if (remote.days) {
          // Merge remote days with local
          Object.keys(remote.days).forEach(function (dateKey) {
            if (!allState[dateKey]) {
              allState[dateKey] = remote.days[dateKey];
            } else {
              // Merge each field
              var rd = remote.days[dateKey];
              var ld = allState[dateKey];
              ld.checks = Object.assign({}, ld.checks, rd.checks || {});
              ld.notes = Object.assign({}, ld.notes, rd.notes || {});
              ld.ratings = Object.assign({}, ld.ratings, rd.ratings || {});
              ld.actuals = Object.assign({}, ld.actuals, rd.actuals || {});
            }
          });
        } else if (remote.checks) {
          // Remote is still in old flat format — migrate it
          var key = remote.lastUpdated ? remote.lastUpdated.slice(0, 10) : todayKey();
          if (!allState[key]) allState[key] = emptyDay();
          allState[key].checks = Object.assign({}, allState[key].checks, remote.checks || {});
          allState[key].notes = Object.assign({}, allState[key].notes, remote.notes || {});
          allState[key].ratings = Object.assign({}, allState[key].ratings, remote.ratings || {});
          allState[key].actuals = Object.assign({}, allState[key].actuals, remote.actuals || {});
        }
        state = getTodayState();
        saveLocalState(allState);
        restoreUI();
      } else {
        DOC_REF.set({ days: allState, lastUpdated: new Date().toISOString() });
      }
      firestoreReady = true;

      // Real-time listener
      DOC_REF.onSnapshot(function (snap) {
        if (snap.exists && snap.data().days) {
          var remoteDays = snap.data().days;
          Object.keys(remoteDays).forEach(function (dk) {
            allState[dk] = remoteDays[dk];
          });
          state = getTodayState();
          saveLocalState(allState);
          restoreUI();
        }
      });

      console.log('Firebase connected');
    }).catch(function (err) {
      console.warn('Firebase unavailable, using localStorage:', err);
      firestoreReady = false;
    });
  }

  // ---------- Navigation ----------
  var navButtons = document.querySelectorAll('.nav-btn');
  var sections = document.querySelectorAll('.program-section');

  navButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.dataset.section;

      navButtons.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');

      sections.forEach(function (s) {
        s.classList.remove('active');
        if (s.id === 'section-' + target) {
          s.classList.add('active');
        }
      });

      if (target === 'stats') renderStats();
    });
  });

  // ---------- Checkboxes ----------
  var checkboxes = document.querySelectorAll('.exercise-card input[type="checkbox"]');

  function setupCheckboxes() {
    checkboxes.forEach(function (cb) {
      var card = cb.closest('.exercise-card');
      var id = card.dataset.id;

      if (state.checks[id]) {
        cb.checked = true;
        card.classList.add('completed');
      } else {
        cb.checked = false;
        card.classList.remove('completed');
      }
    });
  }

  checkboxes.forEach(function (cb) {
    var card = cb.closest('.exercise-card');
    var id = card.dataset.id;

    cb.addEventListener('change', function () {
      state.checks[id] = cb.checked;
      card.classList.toggle('completed', cb.checked);
      saveLocalState(allState);
      syncToFirestore();
      updateStats();
    });
  });

  setupCheckboxes();

  // ---------- Notes Modal ----------
  var modal = document.getElementById('notesModal');
  var modalTitle = document.getElementById('modalTitle');
  var modalInput = document.getElementById('modalNoteInput');
  var modalClose = document.getElementById('modalClose');
  var modalSave = document.getElementById('modalSave');
  var ratingButtons = document.querySelectorAll('.rating-btn');
  var setRepsInputs = document.querySelectorAll('.set-reps');
  var setTimeInputs = document.querySelectorAll('.set-time');
  var activeExerciseId = null;
  var activeRating = null;

  document.querySelectorAll('.exercise-note-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var card = btn.closest('.exercise-card');
      activeExerciseId = card.dataset.id;
      var exerciseName = card.querySelector('h4').textContent;

      modalTitle.textContent = exerciseName;
      modalInput.value = state.notes[activeExerciseId] || '';
      activeRating = state.ratings[activeExerciseId] || null;

      // Restore actuals per set
      var actual = state.actuals[activeExerciseId] || { sets: [] };
      var sets = actual.sets || [];
      setRepsInputs.forEach(function (input, i) { input.value = (sets[i] && sets[i].reps) || ''; });
      setTimeInputs.forEach(function (input, i) { input.value = (sets[i] && sets[i].time) || ''; });

      ratingButtons.forEach(function (rb) {
        rb.classList.toggle('selected', rb.dataset.rating === activeRating);
      });

      modal.classList.add('open');
    });
  });

  ratingButtons.forEach(function (rb) {
    rb.addEventListener('click', function () {
      if (activeRating === rb.dataset.rating) {
        activeRating = null;
        rb.classList.remove('selected');
      } else {
        activeRating = rb.dataset.rating;
        ratingButtons.forEach(function (b) { b.classList.remove('selected'); });
        rb.classList.add('selected');
      }
    });
  });

  function closeModal() {
    modal.classList.remove('open');
    activeExerciseId = null;
    activeRating = null;
  }

  modalClose.addEventListener('click', closeModal);

  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeModal();
  });

  modalSave.addEventListener('click', function () {
    if (!activeExerciseId) return;

    var noteText = modalInput.value.trim();
    state.notes[activeExerciseId] = noteText;
    state.ratings[activeExerciseId] = activeRating;

    var sets = [];
    setRepsInputs.forEach(function (input, i) {
      var r = input.value ? parseInt(input.value, 10) : null;
      var t = setTimeInputs[i].value ? parseInt(setTimeInputs[i].value, 10) : null;
      sets.push({ reps: r, time: t });
    });
    state.actuals[activeExerciseId] = { sets: sets };

    saveLocalState(allState);
    syncToFirestore();

    var card = document.querySelector('[data-id="' + activeExerciseId + '"]');
    if (card) {
      var noteBtn = card.querySelector('.exercise-note-btn');
      var hasSetData = sets.some(function (s) { return s.reps || s.time; });
      noteBtn.classList.toggle('has-note', noteText.length > 0 || !!activeRating || hasSetData);
    }

    closeModal();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal.classList.contains('open')) {
      closeModal();
    }
  });

  // ---------- Restore UI ----------
  function restoreNoteButtons() {
    document.querySelectorAll('.exercise-card').forEach(function (card) {
      var id = card.dataset.id;
      if (id) {
        var noteBtn = card.querySelector('.exercise-note-btn');
        if (noteBtn) {
          var actualData = state.actuals[id];
          var hasActual = actualData && actualData.sets && actualData.sets.some(function (s) { return s && (s.reps || s.time); });
          noteBtn.classList.toggle('has-note', !!(state.notes[id] || state.ratings[id] || hasActual));
        }
      }
    });
  }

  function restoreUI() {
    setupCheckboxes();
    restoreNoteButtons();
    updateStats();
  }

  restoreNoteButtons();

  // ---------- Hero Stats ----------
  function updateStats() {
    var total = checkboxes.length;
    var done = Object.values(state.checks).filter(Boolean).length;
    var pct = total > 0 ? Math.round((done / total) * 100) : 0;

    var completionEl = document.getElementById('completionRate');
    if (completionEl) completionEl.textContent = pct + '%';

    // Day streak
    var streakEl = document.getElementById('streakCount');
    if (streakEl) streakEl.textContent = calcStreak();
  }

  function calcStreak() {
    // Total work days all-time (any day with at least 1 check)
    var total = 0;
    Object.keys(allState).forEach(function (d) {
      var dayData = allState[d];
      if (dayData && dayData.checks) {
        var anyChecked = Object.values(dayData.checks).some(Boolean);
        if (anyChecked) total++;
      }
    });
    return total;
  }

  function calcStreak_legacy() {
    var streak = 0;
    var d = todayKey();
    while (true) {
      var dayData = allState[d];
      if (dayData && dayData.checks) {
        var anyChecked = Object.values(dayData.checks).some(Boolean);
        if (anyChecked) {
          streak++;
          d = addDays(d, -1);
        } else {
          break;
        }
      } else {
        break;
      }
    }
    return streak;
  }

  updateStats();

  // ---------- Weekly Stats Page ----------
  var statsWeekOffset = 0; // 0 = this week, -1 = last week, etc.

  var prevWeekBtn = document.getElementById('statsPrevWeek');
  var nextWeekBtn = document.getElementById('statsNextWeek');

  if (prevWeekBtn) {
    prevWeekBtn.addEventListener('click', function () {
      statsWeekOffset--;
      renderStats();
    });
  }

  if (nextWeekBtn) {
    nextWeekBtn.addEventListener('click', function () {
      if (statsWeekOffset < 0) {
        statsWeekOffset++;
        renderStats();
      }
    });
  }

  // Section metadata for breakdown
  var sectionMap = {
    'd1': 'Day 1 — Pull / Lower Focus',
    'd2': 'Day 2 — Push / Upper Focus',
    'd3': 'Day 3 — Pull / Upper Focus',
    'd4': 'Day 4 — Push / Lower Focus'
  };

  function getSectionKey(exerciseId) {
    if (exerciseId.startsWith('d1-')) return 'd1';
    if (exerciseId.startsWith('d2-')) return 'd2';
    if (exerciseId.startsWith('d3-')) return 'd3';
    if (exerciseId.startsWith('d4-')) return 'd4';
    return 'other';
  }

  function getWeekDays(offset) {
    var thisMon = getMonday(todayKey());
    var monday = addDays(thisMon, offset * 7);
    var days = [];
    for (var i = 0; i < 7; i++) {
      days.push(addDays(monday, i));
    }
    return days;
  }

  function renderStats() {
    var weekDays = getWeekDays(statsWeekOffset);
    var monday = weekDays[0];

    // Week label
    var label = document.getElementById('statsWeekLabel');
    if (label) label.textContent = formatWeekRange(monday);

    // Disable next button if on current week
    if (nextWeekBtn) {
      nextWeekBtn.disabled = (statsWeekOffset >= 0);
      nextWeekBtn.style.opacity = statsWeekOffset >= 0 ? '0.3' : '1';
    }

    // Gather week data
    var totalExercises = checkboxes.length;
    var daysActive = 0;
    var totalChecksWeek = 0;
    var completionPerDay = [];
    var sectionTotals = {};
    var ratingCounts = { easy: 0, right: 0, hard: 0, pain: 0 };
    var painFlags = [];
    var touchedExercises = {}; // track unique exercises completed at least once

    weekDays.forEach(function (dayStr) {
      var dayData = allState[dayStr];
      if (!dayData) {
        completionPerDay.push({ date: dayStr, count: 0, total: totalExercises });
        return;
      }

      var dayChecks = dayData.checks || {};
      var dayCount = Object.values(dayChecks).filter(Boolean).length;

      if (dayCount > 0) daysActive++;
      totalChecksWeek += dayCount;
      completionPerDay.push({ date: dayStr, count: dayCount, total: totalExercises });

      // Section breakdown + unique exercise tracking
      Object.keys(dayChecks).forEach(function (exId) {
        if (dayChecks[exId]) {
          var sk = getSectionKey(exId);
          sectionTotals[sk] = (sectionTotals[sk] || 0) + 1;
          touchedExercises[exId] = true;
        }
      });

      // Ratings
      var dayRatings = dayData.ratings || {};
      Object.keys(dayRatings).forEach(function (exId) {
        var r = dayRatings[exId];
        if (r && ratingCounts.hasOwnProperty(r)) ratingCounts[r]++;
      });

      // Pain flags
      Object.keys(dayRatings).forEach(function (exId) {
        if (dayRatings[exId] === 'pain') {
          var note = (dayData.notes || {})[exId] || '';
          var card = document.querySelector('[data-id="' + exId + '"]');
          var name = card ? card.querySelector('h4').textContent : exId;
          painFlags.push({ date: dayStr, exercise: name, note: note });
        }
      });
    });

    // % of unique exercises touched at least once this week
    var touchedCount = Object.keys(touchedExercises).length;
    var touchedPct = totalExercises > 0 ? Math.round((touchedCount / totalExercises) * 100) : 0;

    // Target pace: what % of weekly targets should be done by now vs what's actually done
    // EDIT THESE — times per week each section's exercises should be completed
    var weeklyTargetMultipliers = { d1: 1, d2: 1, d3: 1, d4: 1 };
    var sectionExCounts = {};
    checkboxes.forEach(function (cb) {
      var card = cb.closest('.exercise-card');
      var sk = getSectionKey(card.dataset.id);
      sectionExCounts[sk] = (sectionExCounts[sk] || 0) + 1;
    });

    // How far through the week are we? (days elapsed including today / 7)
    var today = todayKey();
    var daysElapsed = 0;
    for (var di = 0; di < weekDays.length; di++) {
      if (weekDays[di] <= today) daysElapsed++;
    }
    // For past weeks, full 7 days
    if (statsWeekOffset < 0) daysElapsed = 7;
    var weekFraction = daysElapsed / 7;

    var totalTarget = 0;
    var totalDone = 0;
    var sectionOrder = ['d1', 'd2', 'd3', 'd4'];
    sectionOrder.forEach(function (sk) {
      totalTarget += Math.ceil((sectionExCounts[sk] || 0) * (weeklyTargetMultipliers[sk] || 2));
      totalDone += (sectionTotals[sk] || 0);
    });
    var expectedByNow = Math.round(totalTarget * weekFraction);
    var onPacePct = expectedByNow > 0 ? Math.round((totalDone / expectedByNow) * 100) : (totalDone > 0 ? 100 : 0);

    // Count finished workouts this week (from workout data)
    var finishedWorkouts = 0;
    var totalDuration = 0;
    weekDays.forEach(function (dayStr) {
      var dayData = allState[dayStr];
      if (dayData && dayData.workouts) {
        var dayWorkouts = Object.values(dayData.workouts);
        dayWorkouts.forEach(function (w) {
          if (w && w.completedAt) {
            finishedWorkouts++;
            totalDuration += (w.duration || 0);
          }
        });
      }
    });
    var avgDuration = finishedWorkouts > 0 ? Math.round(totalDuration / finishedWorkouts) : 0;
    var avgMins = Math.floor(avgDuration / 60);
    var avgSecs = avgDuration % 60;
    var avgTimeStr = finishedWorkouts > 0 ? avgMins + ':' + (avgSecs < 10 ? '0' : '') + avgSecs : '—';

    // Update summary cards
    setEl('statsDaysActive', Math.min(finishedWorkouts, 4) + '/3');
    setEl('statsTotalChecks', touchedPct + '%');
    setEl('statsAvgCompletion', avgTimeStr);
    setEl('statsCurrentStreak', calcStreak());

    // Daily breakdown grid — per-tab bars for each day
    var dayGrid = document.getElementById('statsDayGrid');
    if (dayGrid) {
      dayGrid.innerHTML = '';
      completionPerDay.forEach(function (day) {
        var isToday = day.date === todayKey();
        var isFuture = day.date > todayKey();
        var dayData = allState[day.date];
        var dayChecks = (dayData && dayData.checks) ? dayData.checks : {};

        // Count completed per section for this day
        var daySectionDone = {};
        Object.keys(dayChecks).forEach(function (exId) {
          if (dayChecks[exId]) {
            var sk = getSectionKey(exId);
            daySectionDone[sk] = (daySectionDone[sk] || 0) + 1;
          }
        });

        var div = document.createElement('div');
        div.className = 'stats-day-card' + (isToday ? ' today' : '') + (isFuture ? ' future' : '');

        var barsHtml = '<div class="stats-day-name">' + formatDate(day.date) + '</div>';
        var sectionOrder = ['d1', 'd2', 'd3', 'd4'];
        sectionOrder.forEach(function (sk) {
          var done = daySectionDone[sk] || 0;
          var total = sectionExCounts[sk] || 0;
          var pct = total > 0 ? Math.round((done / total) * 100) : 0;
          barsHtml +=
            '<div class="stats-day-section-row">' +
              '<div class="stats-day-section-label">' + sectionMap[sk] + '</div>' +
              '<div class="stats-day-bar-track"><div class="stats-day-bar-fill section-' + sk + '" style="width:' + (isFuture ? 0 : pct) + '%"></div></div>' +
              '<div class="stats-day-pct">' + (isFuture ? '—' : done + '/' + total) + '</div>' +
            '</div>';
        });

        div.innerHTML = barsHtml;
        dayGrid.appendChild(div);
      });
    }

    // Weekly Targets
    var targetsEl = document.getElementById('statsWeeklyTargets');
    if (targetsEl) {
      targetsEl.innerHTML = '';
      var sectionOrder = ['d1', 'd2', 'd3', 'd4'];
      sectionOrder.forEach(function (sk) {
        var exCount = sectionExCounts[sk] || 0;
        var target = Math.ceil(exCount * (weeklyTargetMultipliers[sk] || 2));
        var done = sectionTotals[sk] || 0;
        var pct = target > 0 ? Math.min(Math.round((done / target) * 100), 100) : 0;
        var rawPct = target > 0 ? done / target : 0;

        // Red-to-green gradient: 0% = red, 50% = yellow, 100% = green
        var r, g;
        if (rawPct <= 0.5) {
          r = 220;
          g = Math.round(180 * (rawPct / 0.5));
        } else {
          r = Math.round(220 * (1 - ((rawPct - 0.5) / 0.5)));
          g = 180;
        }
        if (rawPct >= 1) { r = 50; g = 200; }
        var barColor = 'rgb(' + r + ',' + g + ',50)';

        var div = document.createElement('div');
        div.className = 'stats-target-row';
        div.innerHTML =
          '<div class="stats-target-label">' + sectionMap[sk] + '</div>' +
          '<div class="stats-target-bar-track"><div class="stats-target-bar-fill" style="width:' + pct + '%;background:' + barColor + '"></div></div>' +
          '<div class="stats-target-value">' + done + ' / ' + target + '</div>';
        targetsEl.appendChild(div);
      });
    }

    // Rating summary
    var ratingSummary = document.getElementById('statsRatingSummary');
    if (ratingSummary) {
      var totalRatings = ratingCounts.easy + ratingCounts.right + ratingCounts.hard + ratingCounts.pain;
      if (totalRatings === 0) {
        ratingSummary.innerHTML = '<p class="stats-empty">No ratings logged this week.</p>';
      } else {
        ratingSummary.innerHTML =
          '<div class="stats-rating-row"><span class="stats-rating-dot easy"></span> Easy <strong>' + ratingCounts.easy + '</strong></div>' +
          '<div class="stats-rating-row"><span class="stats-rating-dot right"></span> Just Right <strong>' + ratingCounts.right + '</strong></div>' +
          '<div class="stats-rating-row"><span class="stats-rating-dot hard"></span> Hard <strong>' + ratingCounts.hard + '</strong></div>' +
          '<div class="stats-rating-row"><span class="stats-rating-dot pain"></span> Pain/Discomfort <strong>' + ratingCounts.pain + '</strong></div>';
      }
    }

    // Pain flags
    var flagList = document.getElementById('statsFlagList');
    if (flagList) {
      if (painFlags.length === 0) {
        flagList.innerHTML = '<p class="stats-empty">No pain flags this week. Keep it up.</p>';
      } else {
        flagList.innerHTML = '';
        painFlags.forEach(function (pf) {
          var div = document.createElement('div');
          div.className = 'stats-flag-item';
          div.innerHTML =
            '<div class="stats-flag-exercise">' + pf.exercise + '</div>' +
            '<div class="stats-flag-date">' + formatDate(pf.date) + '</div>' +
            (pf.note ? '<div class="stats-flag-note">' + pf.note + '</div>' : '');
          flagList.appendChild(div);
        });
      }
    }
  }

  function setEl(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // ---------- Week Tracker Boxes (per exercise card) ----------
  var dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  function injectWeekTrackers() {
    document.querySelectorAll('.exercise-card').forEach(function (card) {
      var id = card.dataset.id;
      if (!id) return;

      // Only inject once
      if (card.querySelector('.week-tracker')) return;

      var tracker = document.createElement('div');
      tracker.className = 'week-tracker';
      for (var i = 0; i < 7; i++) {
        var box = document.createElement('div');
        box.className = 'week-tracker-day';
        box.setAttribute('data-day-index', i);
        box.innerHTML = '<span class="week-tracker-label">' + dayLabels[i] + '</span>';
        tracker.appendChild(box);
      }
      card.appendChild(tracker);
    });
  }

  function updateWeekTrackers() {
    var weekDays = getWeekDays(0); // Always current week

    document.querySelectorAll('.exercise-card').forEach(function (card) {
      var id = card.dataset.id;
      if (!id) return;
      var boxes = card.querySelectorAll('.week-tracker-day');

      boxes.forEach(function (box, i) {
        var dayStr = weekDays[i];
        var dayData = allState[dayStr];
        var completed = dayData && dayData.checks && dayData.checks[id];
        var isFuture = dayStr > todayKey();
        var isToday = dayStr === todayKey();

        box.classList.toggle('done', !!completed);
        box.classList.toggle('future', isFuture);
        box.classList.toggle('current', isToday);
      });
    });
  }

  injectWeekTrackers();
  updateWeekTrackers();

  // Patch restoreUI to also refresh trackers
  var _origRestoreUI = restoreUI;
  restoreUI = function () {
    _origRestoreUI();
    updateWeekTrackers();
  };

  // Also update trackers when a checkbox changes
  checkboxes.forEach(function (cb) {
    cb.addEventListener('change', function () {
      updateWeekTrackers();
    });
  });

  // ---------- Sticky Nav Shadow on Scroll ----------
  var nav = document.getElementById('programNav');

  if (nav) {
    var observer = new IntersectionObserver(
      function (entries) {
        nav.style.boxShadow = entries[0].isIntersecting ? 'none' : '0 4px 20px rgba(0,0,0,0.3)';
      },
      { threshold: 0, rootMargin: '-60px 0px 0px 0px' }
    );

    var hero = document.querySelector('.hero');
    if (hero) observer.observe(hero);
  }

  // ---------- Hero Photo Fallback ----------
  var heroPhoto = document.getElementById('heroPhoto');
  if (heroPhoto) {
    heroPhoto.addEventListener('error', function () {
      heroPhoto.style.display = 'none';
      var ring = document.querySelector('.hero-photo-ring');
      if (ring) ring.style.display = 'none';
      var container = document.querySelector('.hero-photo');
      if (container) {
        container.innerHTML = '<div style="width:100%;height:100%;border-radius:50%;background:var(--blue);display:flex;align-items:center;justify-content:center;font-family:var(--font-display);font-size:3.5rem;font-weight:900;color:var(--red);">JP</div>';
      }
    });
  }

  // ---------- Video Links (mobile fix) ----------
  document.querySelectorAll('.video-link').forEach(function (link) {
    link.addEventListener('click', function (e) {
      var href = link.getAttribute('href');
      if (href && href.indexOf('http') === 0) {
        e.preventDefault();
        e.stopPropagation();
        window.open(href, '_blank');
      }
    });
  });

  // ---------- PIN Lock ----------
  var PIN_CODE = '2009';
  var PIN_SESSION_KEY = 'jw-pin-unlocked';

  var pinLockBtn = document.getElementById('pinLockBtn');
  var pinOverlay = document.getElementById('pinOverlay');
  var pinInput = document.getElementById('pinInput');
  var pinError = document.getElementById('pinError');
  var pinSubmit = document.getElementById('pinSubmit');
  var pinCancel = document.getElementById('pinCancel');

  function unlockApp() {
    document.body.classList.remove('app-locked');
    sessionStorage.setItem(PIN_SESSION_KEY, '1');
    pinLockBtn.innerHTML = '&#128275;';
    pinLockBtn.classList.add('unlocked');
    pinLockBtn.title = 'Editing unlocked';
  }

  function lockApp() {
    document.body.classList.add('app-locked');
    sessionStorage.removeItem(PIN_SESSION_KEY);
    pinLockBtn.innerHTML = '&#128274;';
    pinLockBtn.classList.remove('unlocked');
    pinLockBtn.title = 'Unlock editing';
  }

  if (sessionStorage.getItem(PIN_SESSION_KEY) === '1') {
    unlockApp();
  }

  pinLockBtn.addEventListener('click', function () {
    if (!document.body.classList.contains('app-locked')) {
      lockApp();
      return;
    }
    pinOverlay.classList.add('open');
    pinInput.value = '';
    pinError.classList.remove('visible');
    setTimeout(function () { pinInput.focus(); }, 100);
  });

  pinSubmit.addEventListener('click', function () {
    if (pinInput.value === PIN_CODE) {
      pinOverlay.classList.remove('open');
      unlockApp();
    } else {
      pinError.classList.add('visible');
      pinInput.value = '';
      pinInput.focus();
      setTimeout(function () { pinError.classList.remove('visible'); }, 2000);
    }
  });

  pinInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') pinSubmit.click();
  });

  pinCancel.addEventListener('click', function () {
    pinOverlay.classList.remove('open');
  });

  pinOverlay.addEventListener('click', function (e) {
    if (e.target === pinOverlay) pinOverlay.classList.remove('open');
  });

  // ---------- Start / Finish Workout + Timer ----------
  var activeWorkoutDay = null;
  var workoutStartTime = null;
  var workoutTimerInterval = null;

  document.querySelectorAll('.start-workout-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var day = btn.dataset.day;
      activeWorkoutDay = day;
      workoutStartTime = Date.now();

      // Show timer, hide start button, show finish button
      btn.classList.add('active');
      btn.textContent = 'Workout In Progress...';
      var timerEl = document.getElementById('timer-' + day);
      if (timerEl) timerEl.style.display = 'block';

      var finishBtn = btn.closest('.program-section').querySelector('.finish-workout-btn');
      if (finishBtn) finishBtn.style.display = 'block';

      // Start timer
      var timerValue = timerEl ? timerEl.querySelector('.timer-value') : null;
      workoutTimerInterval = setInterval(function () {
        var elapsed = Math.floor((Date.now() - workoutStartTime) / 1000);
        var mins = Math.floor(elapsed / 60);
        var secs = elapsed % 60;
        if (timerValue) timerValue.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
      }, 1000);

      // Save start time to state
      state.workoutStart = state.workoutStart || {};
      state.workoutStart[day] = workoutStartTime;
      saveLocalState(allState);
    });
  });

  document.querySelectorAll('.finish-workout-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var day = btn.dataset.day;
      clearInterval(workoutTimerInterval);

      var elapsed = workoutStartTime ? Math.floor((Date.now() - workoutStartTime) / 1000) : 0;
      var mins = Math.floor(elapsed / 60);
      var secs = elapsed % 60;
      var timeStr = mins + ':' + (secs < 10 ? '0' : '') + secs;

      // Show difficulty modal
      var overlay = document.getElementById('finishOverlay');
      var finishTimeEl = document.getElementById('finishTime');
      var slider = document.getElementById('difficultySlider');
      var valueEl = document.getElementById('difficultyValue');

      if (finishTimeEl) finishTimeEl.textContent = 'Total time: ' + timeStr;
      if (slider) slider.value = 5;
      if (valueEl) valueEl.textContent = '5';
      overlay.classList.add('open');
      overlay.dataset.day = day;
      overlay.dataset.elapsed = elapsed;
    });
  });

  // Difficulty slider live update
  var diffSlider = document.getElementById('difficultySlider');
  var diffValue = document.getElementById('difficultyValue');
  if (diffSlider && diffValue) {
    diffSlider.addEventListener('input', function () {
      diffValue.textContent = diffSlider.value;
    });
  }

  // Save difficulty and close
  var finishSave = document.getElementById('finishSave');
  var finishOverlay = document.getElementById('finishOverlay');
  if (finishSave) {
    finishSave.addEventListener('click', function () {
      var day = finishOverlay.dataset.day;
      var elapsed = parseInt(finishOverlay.dataset.elapsed) || 0;
      var difficulty = parseInt(diffSlider.value) || 5;

      // Save to state
      state.workouts = state.workouts || {};
      state.workouts[day] = {
        duration: elapsed,
        difficulty: difficulty,
        completedAt: new Date().toISOString()
      };
      saveLocalState(allState);
      if (firestoreReady) syncToFirestore();

      // Reset UI
      finishOverlay.classList.remove('open');
      var startBtn = document.querySelector('.start-workout-btn[data-day="' + day + '"]');
      if (startBtn) {
        startBtn.textContent = 'Workout Logged!';
        startBtn.style.opacity = '0.5';
      }
      var timerEl = document.getElementById('timer-' + day);
      if (timerEl) timerEl.style.display = 'none';
      var finishBtn = document.querySelector('.finish-workout-btn[data-day="' + day + '"]');
      if (finishBtn) finishBtn.style.display = 'none';

      activeWorkoutDay = null;
      workoutStartTime = null;
    });
  }

  // ---------- Boot ----------
  initFirestore();

})();
