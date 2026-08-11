// instrument-store.js
// Persistence for user-composed instruments. Three layers, from most to
// least automatic:
//   1. localStorage   - always used, works in every browser, "just there"
//                        again on the next run of the app.
//   2. A real folder  - via the File System Access API (Chrome/Edge only).
//                        Saves also write a .json file into a folder you
//                        connect once; the app re-scans it on load if the
//                        browser still remembers permission, or after you
//                        click "Reconnect".
//   3. Manual export/import - a plain JSON download / file-picker upload,
//                        works everywhere, good for backups or moving
//                        instruments between machines.

window.NB = window.NB || {};

NB.store = (function (theory) {
  "use strict";

  var LS_KEY = "instrumentLab.customInstruments";
  var IDB_NAME = "instrument-lab-db";
  var IDB_STORE = "kv";
  var IDB_HANDLE_KEY = "customFolderHandle";

  var supportsFS = "showDirectoryPicker" in window;
  var customInstruments = [];   // in-memory cache, mirrors localStorage
  var folderHandle = null;      // FileSystemDirectoryHandle, once connected
  var folderName = null;

  // ---------- localStorage ----------
  function loadFromLocalStorage() {
    try {
      var raw = window.localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveToLocalStorage() {
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(customInstruments));
    } catch (e) {
      // localStorage can be unavailable (private browsing, quota) - the
      // in-memory list still works for the current session.
    }
  }

  // ---------- tiny IndexedDB helper (for storing the directory handle) ----------
  function idbOpen() {
    return new Promise(function (resolve, reject) {
      var req = window.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbGet(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, "readonly");
        var req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbSet(key, value) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  // ---------- id helpers ----------
  function slugify(label) {
    var s = (label || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
    return s || "instrument";
  }

  function isIdTaken(id) {
    if (theory.BUILTIN_INSTRUMENTS[id]) return true;
    return customInstruments.some(function (p) { return p.id === id; });
  }

  function uniqueId(label) {
    var base = slugify(label);
    var id = base, n = 2;
    while (isIdTaken(id)) { id = base + "-" + n; n++; }
    return id;
  }

  // ---------- folder scanning / writing ----------
  function scanFolder(dirHandle) {
    var found = [];
    var iterate = (dirHandle.entries ? dirHandle : null);
    if (!iterate) return Promise.resolve(found);

    return (async function () {
      for await (var pair of dirHandle.entries()) {
        var name = pair[0], handle = pair[1];
        if (handle.kind === "file" && /\.json$/i.test(name)) {
          try {
            var file = await handle.getFile();
            var text = await file.text();
            var profile = JSON.parse(text);
            if (profile && profile.harmonics && profile.envelope) {
              profile.builtin = false;
              profile.id = profile.id || slugify(profile.label || name.replace(/\.json$/i, ""));
              found.push(profile);
            }
          } catch (e) {
            // skip unreadable / non-instrument JSON files
          }
        }
      }
      return found;
    })();
  }

  function mergeIntoCustomList(profiles) {
    profiles.forEach(function (p) {
      var existingIdx = customInstruments.findIndex(function (c) { return c.id === p.id; });
      if (existingIdx >= 0) customInstruments[existingIdx] = p;
      else customInstruments.push(p);
    });
    saveToLocalStorage();
  }

  function writeToFolder(profile) {
    if (!folderHandle) return Promise.resolve(false);
    return (async function () {
      try {
        var fileHandle = await folderHandle.getFileHandle(profile.id + ".json", { create: true });
        var writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(profile, null, 2));
        await writable.close();
        return true;
      } catch (e) {
        return false;
      }
    })();
  }

  function removeFromFolder(id) {
    if (!folderHandle) return Promise.resolve(false);
    return folderHandle.removeEntry(id + ".json").then(function () { return true; }).catch(function () { return false; });
  }

  // ---------- public API ----------

  // Call once on startup. Loads localStorage synchronously into memory, and
  // (if the browser remembers a folder handle) reports whether it still has
  // permission or needs the user to click "Reconnect".
  function init() {
    customInstruments = loadFromLocalStorage();
    if (!supportsFS) {
      return Promise.resolve({ customInstruments: customInstruments, folderSupported: false, folderConnected: false, needsReconnect: false });
    }
    return idbGet(IDB_HANDLE_KEY).then(function (handle) {
      if (!handle) {
        return { customInstruments: customInstruments, folderSupported: true, folderConnected: false, needsReconnect: false };
      }
      return handle.queryPermission({ mode: "readwrite" }).then(function (perm) {
        if (perm === "granted") {
          folderHandle = handle;
          folderName = handle.name;
          return scanFolder(handle).then(function (found) {
            mergeIntoCustomList(found);
            return { customInstruments: customInstruments, folderSupported: true, folderConnected: true, folderName: folderName, needsReconnect: false };
          });
        }
        // Permission needs a user gesture to re-request; surface that.
        return { customInstruments: customInstruments, folderSupported: true, folderConnected: false, needsReconnect: true, folderName: handle.name };
      });
    }).catch(function () {
      return { customInstruments: customInstruments, folderSupported: true, folderConnected: false, needsReconnect: false };
    });
  }

  // Must be called from a click handler (user-gesture requirement).
  function connectFolder() {
    if (!supportsFS) return Promise.reject(new Error("File System Access API not supported in this browser."));
    return window.showDirectoryPicker({ mode: "readwrite" }).then(function (handle) {
      folderHandle = handle;
      folderName = handle.name;
      return idbSet(IDB_HANDLE_KEY, handle).then(function () {
        return scanFolder(handle);
      }).then(function (found) {
        mergeIntoCustomList(found);
        return { customInstruments: customInstruments, folderName: folderName };
      });
    });
  }

  // Must also be called from a click handler.
  function reconnectFolder() {
    if (!supportsFS) return Promise.reject(new Error("File System Access API not supported in this browser."));
    return idbGet(IDB_HANDLE_KEY).then(function (handle) {
      if (!handle) return Promise.reject(new Error("No remembered folder."));
      return handle.requestPermission({ mode: "readwrite" }).then(function (perm) {
        if (perm !== "granted") return Promise.reject(new Error("Permission not granted."));
        folderHandle = handle;
        folderName = handle.name;
        return scanFolder(handle).then(function (found) {
          mergeIntoCustomList(found);
          return { customInstruments: customInstruments, folderName: folderName };
        });
      });
    });
  }

  function getCustomInstruments() {
    return customInstruments.slice();
  }

  function isFolderConnected() {
    return !!folderHandle;
  }

  function getFolderName() {
    return folderName;
  }

  function folderSupported() {
    return supportsFS;
  }

  // Saves (creates or updates) a custom instrument. Assigns an id from the
  // label if it doesn't have one yet. Always mirrors to localStorage; also
  // writes to the connected folder if there is one.
  function saveInstrument(profile) {
    var p = theory.cloneProfile(profile);
    p.builtin = false;
    if (!p.id || (isIdTaken(p.id) && customInstruments.every(function (c) { return c.id !== p.id; }))) {
      p.id = uniqueId(p.label);
    }
    p.savedAt = new Date().toISOString();

    var existingIdx = customInstruments.findIndex(function (c) { return c.id === p.id; });
    if (existingIdx >= 0) customInstruments[existingIdx] = p;
    else customInstruments.push(p);
    saveToLocalStorage();

    return writeToFolder(p).then(function () { return p; });
  }

  function deleteInstrument(id) {
    customInstruments = customInstruments.filter(function (c) { return c.id !== id; });
    saveToLocalStorage();
    return removeFromFolder(id);
  }

  function exportInstrument(profile) {
    var blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = (profile.id || slugify(profile.label)) + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // fileList: a FileList from an <input type="file" multiple accept=".json">
  function importFiles(fileList) {
    var files = Array.prototype.slice.call(fileList);
    return Promise.all(files.map(function (file) {
      return file.text().then(function (text) {
        var profile = JSON.parse(text);
        if (!profile || !profile.harmonics || !profile.envelope) {
          throw new Error("'" + file.name + "' doesn't look like an instrument file.");
        }
        profile.builtin = false;
        if (!profile.id || isIdTaken(profile.id)) profile.id = uniqueId(profile.label || file.name.replace(/\.json$/i, ""));
        var existingIdx = customInstruments.findIndex(function (c) { return c.id === profile.id; });
        if (existingIdx >= 0) customInstruments[existingIdx] = profile;
        else customInstruments.push(profile);
        return profile;
      });
    })).then(function (imported) {
      saveToLocalStorage();
      return imported;
    });
  }

  return {
    init: init,
    connectFolder: connectFolder,
    reconnectFolder: reconnectFolder,
    getCustomInstruments: getCustomInstruments,
    isFolderConnected: isFolderConnected,
    getFolderName: getFolderName,
    folderSupported: folderSupported,
    saveInstrument: saveInstrument,
    deleteInstrument: deleteInstrument,
    exportInstrument: exportInstrument,
    importFiles: importFiles,
    uniqueId: uniqueId
  };
})(NB.theory);
