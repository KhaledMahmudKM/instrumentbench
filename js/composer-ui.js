// composer-ui.js
// Renders the editable "composition" for an instrument profile: the
// harmonics table (fundamental + partials, each with a ratio and an
// amplitude) and the other synthesis parameters (envelope, inharmonicity,
// vibrato, breath). Field edits mutate the profile object directly and call
// back so the host can react (e.g. nothing needed for most edits — the next
// note played just reads the live object). Adding/removing a harmonic row
// requires a full re-render since the DOM structure changes.

window.NB = window.NB || {};

NB.composer = (function () {
  "use strict";

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === "class") node.className = attrs[k];
      else if (k === "text") node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  function numberField(labelText, value, opts, onInput) {
    opts = opts || {};
    var input = el("input", {
      type: "number",
      value: String(value),
      step: opts.step != null ? opts.step : "0.01",
      min: opts.min != null ? opts.min : "0"
    });
    if (opts.max != null) input.setAttribute("max", opts.max);
    input.addEventListener("input", function () {
      var v = parseFloat(input.value);
      onInput(isNaN(v) ? 0 : v);
    });
    var wrap = el("label", { class: "param-field" }, [
      el("span", { class: "param-label", text: labelText }),
      input
    ]);
    return { wrap: wrap, input: input };
  }

  // Renders the harmonics table into `container`. `onStructureChange` is
  // called after a row is added/removed (caller should re-render).
  function renderHarmonicsTable(container, profile, onStructureChange) {
    container.innerHTML = "";

    var table = el("div", { class: "harmonics-table" });
    var header = el("div", { class: "harmonics-row harmonics-header" }, [
      el("span", { text: "#" }),
      el("span", { text: "Ratio (\u00d7 fundamental)" }),
      el("span", { text: "Amplitude" }),
      el("span", { text: "" })
    ]);
    table.appendChild(header);

    profile.harmonics.forEach(function (h, idx) {
      var ratioInput = el("input", { type: "number", step: "0.01", min: "0.01", value: String(h.ratio) });
      ratioInput.addEventListener("input", function () {
        var v = parseFloat(ratioInput.value);
        h.ratio = isNaN(v) || v <= 0 ? 0.01 : v;
      });

      var ampInput = el("input", { type: "number", step: "0.01", min: "0", max: "2", value: String(h.amp) });
      ampInput.addEventListener("input", function () {
        var v = parseFloat(ampInput.value);
        h.amp = isNaN(v) || v < 0 ? 0 : v;
      });

      var removeBtn = el("button", { class: "row-remove", type: "button", text: "\u2715", title: "Remove this partial" });
      removeBtn.disabled = profile.harmonics.length <= 1;
      removeBtn.addEventListener("click", function () {
        if (profile.harmonics.length <= 1) return;
        profile.harmonics.splice(idx, 1);
        onStructureChange();
      });

      var row = el("div", { class: "harmonics-row" }, [
        el("span", { class: "harmonic-index", text: idx === 0 ? "f\u2080" : String(idx + 1) }),
        ratioInput,
        ampInput,
        removeBtn
      ]);
      table.appendChild(row);
    });

    container.appendChild(table);

    var addBtn = el("button", { class: "add-partial-btn", type: "button", text: "+ Add Partial" });
    addBtn.addEventListener("click", function () {
      var lastRatio = profile.harmonics.length ? profile.harmonics[profile.harmonics.length - 1].ratio : 0;
      profile.harmonics.push({ ratio: Math.round((lastRatio + 1) * 100) / 100, amp: 0.1 });
      onStructureChange();
    });
    container.appendChild(addBtn);
  }

  // Renders the envelope / inharmonicity / vibrato / breath controls.
  function renderParamsForm(container, profile) {
    container.innerHTML = "";

    var envSection = el("div", { class: "param-group" }, [
      el("div", { class: "param-group-title", text: "ENVELOPE (seconds, sustain 0\u20131)" })
    ]);
    var envGrid = el("div", { class: "param-grid" });
    ["attack", "decay", "release"].forEach(function (key) {
      envGrid.appendChild(numberField(key.toUpperCase(), profile.envelope[key], { step: 0.005, min: 0, max: 4 }, function (v) {
        profile.envelope[key] = v;
      }).wrap);
    });
    envGrid.appendChild(numberField("SUSTAIN", profile.envelope.sustain, { step: 0.01, min: 0, max: 1 }, function (v) {
      profile.envelope.sustain = Math.max(0, Math.min(1, v));
    }).wrap);
    envSection.appendChild(envGrid);
    container.appendChild(envSection);

    var otherSection = el("div", { class: "param-group" }, [
      el("div", { class: "param-group-title", text: "TIMBRE" })
    ]);
    var otherGrid = el("div", { class: "param-grid" });
    otherGrid.appendChild(numberField("INHARMONICITY", profile.inharmonicity || 0, { step: 0.0001, min: 0, max: 0.01 }, function (v) {
      profile.inharmonicity = v;
    }).wrap);
    otherGrid.appendChild(numberField("BREATH (NOISE)", profile.breath || 0, { step: 0.005, min: 0, max: 0.2 }, function (v) {
      profile.breath = v;
    }).wrap);
    otherSection.appendChild(otherGrid);
    container.appendChild(otherSection);

    var vibratoSection = el("div", { class: "param-group" }, [
      el("div", { class: "param-group-title", text: "VIBRATO" })
    ]);
    var vibratoEnabled = !!profile.vibrato;
    var enableLabel = el("label", { class: "toggle" });
    var enableCheckbox = el("input", { type: "checkbox" });
    enableCheckbox.checked = vibratoEnabled;
    enableLabel.appendChild(enableCheckbox);
    enableLabel.appendChild(el("span", { text: "Enable vibrato" }));
    vibratoSection.appendChild(enableLabel);

    var vibratoGrid = el("div", { class: "param-grid" });
    var rateField = numberField("RATE (Hz)", (profile.vibrato && profile.vibrato.rate) || 5, { step: 0.1, min: 0.1, max: 12 }, function (v) {
      if (profile.vibrato) profile.vibrato.rate = v;
    });
    var depthField = numberField("DEPTH", (profile.vibrato && profile.vibrato.depth) || 0.006, { step: 0.001, min: 0, max: 0.05 }, function (v) {
      if (profile.vibrato) profile.vibrato.depth = v;
    });
    vibratoGrid.appendChild(rateField.wrap);
    vibratoGrid.appendChild(depthField.wrap);
    vibratoSection.appendChild(vibratoGrid);
    container.appendChild(vibratoSection);

    function syncVibratoDisabled() {
      rateField.input.disabled = !enableCheckbox.checked;
      depthField.input.disabled = !enableCheckbox.checked;
    }
    syncVibratoDisabled();

    enableCheckbox.addEventListener("change", function () {
      if (enableCheckbox.checked) {
        profile.vibrato = { rate: parseFloat(rateField.input.value) || 5, depth: parseFloat(depthField.input.value) || 0.006 };
      } else {
        profile.vibrato = null;
      }
      syncVibratoDisabled();
    });
  }

  // Renders the full composer (harmonics table + params form) into two
  // container elements. Re-renders the harmonics table on add/remove.
  function render(harmonicsContainer, paramsContainer, profile) {
    function renderHarmonics() {
      renderHarmonicsTable(harmonicsContainer, profile, renderHarmonics);
    }
    renderHarmonics();
    renderParamsForm(paramsContainer, profile);
  }

  return { render: render };
})();
