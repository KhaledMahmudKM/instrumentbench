// ui.js
// Top-level wiring for Instrument Lab: the instrument library list, loading
// a selection into an editable "draft" profile, wiring the keyboard to
// preview that draft live, and the save/reset/export/import/delete/folder
// controls. This is the only file that touches the DOM directly.

(function (theory, audio, keyboard, store, composer) {
  "use strict";

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    var lamp = document.getElementById("lamp");
    var lampText = document.getElementById("lampText");
    var folderStatus = document.getElementById("folderStatus");
    var newInstrumentBtn = document.getElementById("newInstrumentBtn");
    var importBtn = document.getElementById("importBtn");
    var importInput = document.getElementById("importInput");
    var connectFolderBtn = document.getElementById("connectFolderBtn");
    var reconnectFolderBtn = document.getElementById("reconnectFolderBtn");
    var libraryList = document.getElementById("libraryList");
    var instrumentKindTag = document.getElementById("instrumentKindTag");
    var instrumentNameInput = document.getElementById("instrumentName");
    var resetBtn = document.getElementById("resetBtn");
    var exportBtn = document.getElementById("exportBtn");
    var deleteBtn = document.getElementById("deleteBtn");
    var saveBtn = document.getElementById("saveBtn");
    var harmonicsContainer = document.getElementById("harmonicsContainer");
    var paramsContainer = document.getElementById("paramsContainer");
    var keyboardContainer = document.getElementById("keyboardContainer");
    var noteLengthSlider = document.getElementById("noteLength");
    var noteLengthReadout = document.getElementById("noteLengthReadout");
    var rNote = document.getElementById("rNote");
    var rFreq = document.getElementById("rFreq");

    var currentProfile = null;
    var currentSourceId = null; // id of the profile currentProfile was loaded from (null if brand-new/unsaved)
    var playTimeoutId = null;

    // ---------- small DOM helper ----------
    function el(tag, attrs, text) {
      var node = document.createElement(tag);
      if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
      if (text != null) node.textContent = text;
      return node;
    }

    // ---------- playback ----------
    function setPlayingUI(playing) {
      lamp.classList.toggle("on", playing);
      lampText.textContent = playing ? "ACTIVE" : "STANDBY";
    }

    function triggerNote(note, octave) {
      var freq = theory.noteFrequency(note, octave);
      var holdSeconds = parseFloat(noteLengthSlider.value);

      audio.ensureContext();
      audio.playNote(currentProfile, freq, holdSeconds);
      keyboard.highlight(note, octave);

      rNote.textContent = note + octave;
      rFreq.textContent = freq.toFixed(2) + " Hz";
      setPlayingUI(true);

      if (playTimeoutId) clearTimeout(playTimeoutId);
      var release = (currentProfile.envelope && currentProfile.envelope.release) || 0.2;
      var totalMs = (holdSeconds + release + 0.1) * 1000;
      playTimeoutId = setTimeout(function () {
        setPlayingUI(false);
        keyboard.clearHighlight();
      }, totalMs);
    }

    // ---------- note-length slider ----------
    function updateNoteLengthReadout() {
      var min = parseFloat(noteLengthSlider.min), max = parseFloat(noteLengthSlider.max), val = parseFloat(noteLengthSlider.value);
      noteLengthSlider.style.setProperty("--fill", ((val - min) / (max - min)) * 100 + "%");
      noteLengthReadout.textContent = val.toFixed(1) + " s";
    }
    noteLengthSlider.addEventListener("input", updateNoteLengthReadout);

    // ---------- loading a profile into the composer ----------
    function loadProfile(sourceProfile) {
      currentProfile = theory.cloneProfile(sourceProfile);
      currentSourceId = currentProfile.id; // null for a brand-new, unsaved instrument

      var kind = currentProfile.builtin ? "standard" : (currentProfile.id ? "custom" : "new \u00b7 unsaved");
      instrumentKindTag.textContent = kind;
      instrumentNameInput.value = currentProfile.label;
      deleteBtn.hidden = !(currentProfile.id && !currentProfile.builtin);

      composer.render(harmonicsContainer, paramsContainer, currentProfile);
      refreshLibrary();
    }

    instrumentNameInput.addEventListener("input", function () {
      currentProfile.label = instrumentNameInput.value;
    });

    // ---------- library list ----------
    function makeLibraryItem(profile, deletable) {
      var row = el("div", { class: "library-item" + (currentSourceId === profile.id ? " active" : "") });
      row.appendChild(el("span", { class: "item-name" }, profile.label));
      if (deletable) {
        var del = el("button", { class: "item-del", type: "button", title: "Delete" }, "\u2715");
        del.addEventListener("click", function (e) {
          e.stopPropagation();
          if (!window.confirm('Delete "' + profile.label + '"? This cannot be undone.')) return;
          store.deleteInstrument(profile.id).then(function () {
            if (currentSourceId === profile.id) loadProfile(theory.BUILTIN_INSTRUMENTS.piano);
            refreshLibrary();
          });
        });
        row.appendChild(del);
      }
      row.addEventListener("click", function () { loadProfile(profile); });
      return row;
    }

    function refreshLibrary() {
      libraryList.innerHTML = "";
      libraryList.appendChild(el("div", { class: "library-group-title" }, "STANDARD"));
      Object.keys(theory.BUILTIN_INSTRUMENTS).forEach(function (id) {
        libraryList.appendChild(makeLibraryItem(theory.BUILTIN_INSTRUMENTS[id], false));
      });

      libraryList.appendChild(el("div", { class: "library-group-title" }, "CUSTOM"));
      var customs = store.getCustomInstruments();
      if (!customs.length) {
        libraryList.appendChild(el("div", { class: "library-item" }, "(none yet \u2014 edit & Save)"));
      } else {
        customs.forEach(function (p) { libraryList.appendChild(makeLibraryItem(p, true)); });
      }
    }

    // ---------- toolbar actions ----------
    newInstrumentBtn.addEventListener("click", function () {
      loadProfile(theory.blankProfile("New Instrument"));
    });

    resetBtn.addEventListener("click", function () {
      if (!currentSourceId) { loadProfile(theory.blankProfile("New Instrument")); return; }
      var source = theory.BUILTIN_INSTRUMENTS[currentSourceId] ||
        store.getCustomInstruments().filter(function (c) { return c.id === currentSourceId; })[0];
      loadProfile(source || theory.blankProfile("New Instrument"));
    });

    exportBtn.addEventListener("click", function () {
      currentProfile.label = instrumentNameInput.value || currentProfile.label;
      store.exportInstrument(currentProfile);
    });

    saveBtn.addEventListener("click", function () {
      currentProfile.label = instrumentNameInput.value || currentProfile.label;
      var toSave = theory.cloneProfile(currentProfile);
      // Editing a standard instrument creates a new custom copy rather than
      // overwriting the built-in; only a profile already saved as custom
      // keeps updating the same entry on repeated Save clicks.
      if (!toSave.id || theory.BUILTIN_INSTRUMENTS[toSave.id]) toSave.id = null;
      toSave.builtin = false;

      store.saveInstrument(toSave).then(function (saved) {
        currentProfile.id = saved.id;
        currentProfile.builtin = false;
        currentSourceId = saved.id;
        instrumentKindTag.textContent = "custom";
        deleteBtn.hidden = false;
        refreshLibrary();
      });
    });

    deleteBtn.addEventListener("click", function () {
      if (!currentSourceId || currentProfile.builtin) return;
      if (!window.confirm('Delete "' + currentProfile.label + '"? This cannot be undone.')) return;
      store.deleteInstrument(currentSourceId).then(function () {
        loadProfile(theory.BUILTIN_INSTRUMENTS.piano);
      });
    });

    importBtn.addEventListener("click", function () { importInput.click(); });
    importInput.addEventListener("change", function () {
      if (!importInput.files.length) return;
      store.importFiles(importInput.files).then(function (imported) {
        refreshLibrary();
        if (imported.length) loadProfile(imported[imported.length - 1]);
      }).catch(function (err) {
        window.alert("Import failed: " + err.message);
      }).then(function () {
        importInput.value = "";
      });
    });

    // ---------- folder connection ----------
    connectFolderBtn.addEventListener("click", function () {
      store.connectFolder().then(function (res) {
        folderStatus.textContent = "folder: " + res.folderName;
        connectFolderBtn.textContent = "Switch Folder";
        reconnectFolderBtn.hidden = true;
        refreshLibrary();
      }).catch(function (err) {
        window.alert("Could not connect a folder: " + err.message);
      });
    });

    reconnectFolderBtn.addEventListener("click", function () {
      store.reconnectFolder().then(function (res) {
        folderStatus.textContent = "folder: " + res.folderName;
        reconnectFolderBtn.hidden = true;
        connectFolderBtn.textContent = "Switch Folder";
        refreshLibrary();
      }).catch(function (err) {
        window.alert("Could not reconnect: " + err.message);
      });
    });

    // ---------- keyboard ----------
    keyboard.build(keyboardContainer);
    keyboard.onPress(function (note, octave) { triggerNote(note, octave); });

    // ---------- startup ----------
    updateNoteLengthReadout();

    if (!store.folderSupported()) connectFolderBtn.hidden = true;

    store.init().then(function (res) {
      if (!res.folderSupported) {
        folderStatus.textContent = "browser storage only (folder sync needs Chrome/Edge)";
      } else if (res.folderConnected) {
        folderStatus.textContent = "folder: " + res.folderName;
        connectFolderBtn.textContent = "Switch Folder";
      } else if (res.needsReconnect) {
        folderStatus.textContent = "folder: " + res.folderName + " (click Reconnect)";
        reconnectFolderBtn.hidden = false;
      } else {
        folderStatus.textContent = "browser storage only";
      }
      loadProfile(theory.BUILTIN_INSTRUMENTS.piano);
    });
  }
})(NB.theory, NB.audio, NB.keyboard, NB.store, NB.composer);
