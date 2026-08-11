// keyboard.js
// Renders a clickable piano keyboard (SVG) covering a fixed 3-octave range,
// and exposes a small API for highlighting the currently-sounding key.
// Knows nothing about audio or synthesis — it just reports which note/octave
// was clicked and lets the caller tell it which key to light up.

window.NB = window.NB || {};

NB.keyboard = (function () {
  "use strict";

  var OCTAVES = [3, 4, 5]; // 3-octave range: C3 – B5
  var WHITE_NOTES = ["C", "D", "E", "F", "G", "A", "B"];
  // Maps a white key to the black key that sits just after it; E and B have none.
  var BLACK_AFTER = { C: "C#", D: "D#", F: "F#", G: "G#", A: "A#" };

  var WHITE_W = 42, WHITE_H = 150, BLACK_W = 26, BLACK_H = 92;
  var SVG_NS = "http://www.w3.org/2000/svg";

  var keyElements = {};   // "C#4" -> <rect>
  var pressHandlers = [];

  function keyId(note, octave) { return note + octave; }

  function build(containerEl) {
    keyElements = {};
    containerEl.innerHTML = "";

    var totalWhite = OCTAVES.length * 7;
    var width = totalWhite * WHITE_W;
    var height = WHITE_H;

    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.classList.add("keyboard-svg");

    var whiteGroup = document.createElementNS(SVG_NS, "g");
    var blackGroup = document.createElementNS(SVG_NS, "g");

    OCTAVES.forEach(function (oct) {
      var octIdx = OCTAVES.indexOf(oct);
      var x0 = octIdx * 7 * WHITE_W;

      WHITE_NOTES.forEach(function (note, i) {
        var x = x0 + i * WHITE_W;
        var rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("x", x);
        rect.setAttribute("y", 0);
        rect.setAttribute("width", WHITE_W - 1);
        rect.setAttribute("height", WHITE_H);
        rect.setAttribute("rx", 3);
        rect.setAttribute("class", "key key-white");
        rect.dataset.note = note;
        rect.dataset.octave = oct;
        whiteGroup.appendChild(rect);
        keyElements[keyId(note, oct)] = rect;

        if (note === "C") {
          var label = document.createElementNS(SVG_NS, "text");
          label.setAttribute("x", x + WHITE_W / 2);
          label.setAttribute("y", WHITE_H - 10);
          label.setAttribute("text-anchor", "middle");
          label.setAttribute("class", "key-label");
          label.textContent = "C" + oct;
          whiteGroup.appendChild(label);
        }
      });

      Object.keys(BLACK_AFTER).forEach(function (whiteNote) {
        var blackNote = BLACK_AFTER[whiteNote];
        var i = WHITE_NOTES.indexOf(whiteNote);
        var x = x0 + (i + 1) * WHITE_W - BLACK_W / 2;
        var rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("x", x);
        rect.setAttribute("y", 0);
        rect.setAttribute("width", BLACK_W);
        rect.setAttribute("height", BLACK_H);
        rect.setAttribute("rx", 2);
        rect.setAttribute("class", "key key-black");
        rect.dataset.note = blackNote;
        rect.dataset.octave = oct;
        blackGroup.appendChild(rect);
        keyElements[keyId(blackNote, oct)] = rect;
      });
    });

    svg.appendChild(whiteGroup);
    svg.appendChild(blackGroup);
    containerEl.appendChild(svg);

    svg.addEventListener("click", function (e) {
      var t = e.target;
      if (t && t.classList && t.classList.contains("key")) {
        var note = t.dataset.note;
        var octave = parseInt(t.dataset.octave, 10);
        pressHandlers.forEach(function (h) { h(note, octave); });
      }
    });
  }

  // notes: array of { note, octave } to light up simultaneously (a chord).
  function highlightMultiple(notes) {
    clearHighlight();
    (notes || []).forEach(function (n) {
      var el = keyElements[keyId(n.note, n.octave)];
      if (el) el.classList.add("active");
    });
  }

  function highlight(note, octave) {
    highlightMultiple([{ note: note, octave: octave }]);
  }

  function clearHighlight() {
    Object.keys(keyElements).forEach(function (k) {
      keyElements[k].classList.remove("active");
    });
  }

  function onPress(handler) {
    pressHandlers.push(handler);
  }

  return {
    OCTAVES: OCTAVES,
    build: build,
    highlight: highlight,
    highlightMultiple: highlightMultiple,
    clearHighlight: clearHighlight,
    onPress: onPress
  };
})();
