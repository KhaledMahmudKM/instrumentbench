// music-theory.js
// Pure music-domain data and math for Instrument Lab: note <-> frequency
// conversion, the harmonic-series generator, and the built-in instrument
// library. No DOM access and no Web Audio calls live here.
//
// Instrument "profile" shape (also the JSON save format used by
// instrument-store.js):
//   {
//     id: "piano",                 // unique slug
//     label: "Piano",
//     builtin: true|false,
//     harmonics: [{ ratio, amp }],  // ratio: multiple of the fundamental
//                                   // (need not be an integer)
//     envelope: { attack, decay, sustain, release },  // seconds / 0..1
//     inharmonicity: 0,             // partial-stretching coefficient
//     vibrato: { rate, depth } | null,
//     breath: 0..~0.15 | 0
//   }

window.NB = window.NB || {};

NB.theory = (function () {
  "use strict";

  var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var OCTAVE_RANGE = [2, 3, 4, 5, 6];

  function midiFromNoteOctave(noteName, octave) {
    var idx = NOTE_NAMES.indexOf(noteName);
    return (octave + 1) * 12 + idx;
  }

  function noteOctaveFromMidi(midi) {
    var idx = ((midi % 12) + 12) % 12;
    var octave = Math.floor(midi / 12) - 1;
    return { note: NOTE_NAMES[idx], octave: octave };
  }

  function frequencyFromMidi(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // Standard equal-temperament conversion: A4 (MIDI 69) = 440 Hz.
  function noteFrequency(noteName, octave) {
    return frequencyFromMidi(midiFromNoteOctave(noteName, octave));
  }

  // Given a full instrument profile object and a fundamental frequency,
  // returns the resolved harmonic series: [{ ratio, freq, amp }, ...] where
  // amp is normalized so the set sums to 1 (matches what actually gets
  // synthesized, so any "harmonic plot" stays truthful).
  function harmonicSeries(profile, fundamental) {
    var b = profile.inharmonicity || 0;
    var ampSum = profile.harmonics.reduce(function (s, h) { return s + h.amp; }, 0) || 1;
    return profile.harmonics.map(function (h) {
      var freq = fundamental * h.ratio * Math.sqrt(1 + b * h.ratio * h.ratio);
      return { ratio: h.ratio, freq: freq, amp: h.amp / ampSum };
    });
  }

  // Deep clone so editing a "draft" never mutates a stored/built-in profile.
  function cloneProfile(profile) {
    return JSON.parse(JSON.stringify(profile));
  }

  function blankProfile(label) {
    return {
      id: null,
      label: label || "New Instrument",
      builtin: false,
      harmonics: [{ ratio: 1, amp: 1 }],
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.3 },
      inharmonicity: 0,
      vibrato: null,
      breath: 0
    };
  }

  // The standard library, shared with Note Bench's instrument set but
  // reshaped into the { ratio, amp } schema so partials can later be edited
  // to non-integer ratios (e.g. a drum-like stretched overtone series).
  var BUILTIN_INSTRUMENTS = {
    piano: {
      id: "piano", label: "Piano", builtin: true,
      harmonics: [
        { ratio: 1, amp: 1 }, { ratio: 2, amp: .62 }, { ratio: 3, amp: .36 },
        { ratio: 4, amp: .22 }, { ratio: 5, amp: .15 }, { ratio: 6, amp: .10 },
        { ratio: 7, amp: .06 }, { ratio: 8, amp: .04 }
      ],
      envelope: { attack: .006, decay: .35, sustain: .22, release: .35 },
      inharmonicity: .00045,
      vibrato: null,
      breath: 0
    },
    guitar: {
      id: "guitar", label: "Guitar", builtin: true,
      harmonics: [
        { ratio: 1, amp: 1 }, { ratio: 2, amp: .52 }, { ratio: 3, amp: .30 },
        { ratio: 4, amp: .16 }, { ratio: 5, amp: .09 }, { ratio: 6, amp: .05 }
      ],
      envelope: { attack: .005, decay: .55, sustain: .16, release: .3 },
      inharmonicity: .00012,
      vibrato: null,
      breath: 0
    },
    violin: {
      id: "violin", label: "Violin", builtin: true,
      harmonics: [
        { ratio: 1, amp: .8 }, { ratio: 2, amp: .9 }, { ratio: 3, amp: .7 },
        { ratio: 4, amp: .5 }, { ratio: 5, amp: .42 }, { ratio: 6, amp: .32 },
        { ratio: 7, amp: .22 }, { ratio: 8, amp: .16 }, { ratio: 9, amp: .11 }, { ratio: 10, amp: .08 }
      ],
      envelope: { attack: .16, decay: .10, sustain: .85, release: .22 },
      inharmonicity: 0,
      vibrato: { rate: 5.4, depth: .006 },
      breath: 0
    },
    flute: {
      id: "flute", label: "Flute", builtin: true,
      harmonics: [
        { ratio: 1, amp: 1 }, { ratio: 2, amp: .14 }, { ratio: 3, amp: .08 },
        { ratio: 4, amp: .04 }, { ratio: 5, amp: .02 }
      ],
      envelope: { attack: .09, decay: .06, sustain: .9, release: .16 },
      inharmonicity: 0,
      vibrato: null,
      breath: .028
    },
    trumpet: {
      id: "trumpet", label: "Trumpet", builtin: true,
      harmonics: [
        { ratio: 1, amp: .45 }, { ratio: 2, amp: .6 }, { ratio: 3, amp: .8 },
        { ratio: 4, amp: .9 }, { ratio: 5, amp: .7 }, { ratio: 6, amp: .5 },
        { ratio: 7, amp: .35 }, { ratio: 8, amp: .25 }, { ratio: 9, amp: .16 }, { ratio: 10, amp: .10 }
      ],
      envelope: { attack: .035, decay: .06, sustain: .85, release: .15 },
      inharmonicity: 0,
      vibrato: null,
      breath: 0
    },
    organ: {
      id: "organ", label: "Organ", builtin: true,
      harmonics: [
        { ratio: 1, amp: 1 }, { ratio: 2, amp: .5 }, { ratio: 3, amp: .33 },
        { ratio: 4, amp: .25 }, { ratio: 5, amp: .2 }, { ratio: 6, amp: .15 }, { ratio: 8, amp: .1 }
      ],
      envelope: { attack: .012, decay: 0, sustain: 1, release: .06 },
      inharmonicity: 0,
      vibrato: null,
      breath: 0
    }
  };

  return {
    NOTE_NAMES: NOTE_NAMES,
    OCTAVE_RANGE: OCTAVE_RANGE,
    BUILTIN_INSTRUMENTS: BUILTIN_INSTRUMENTS,
    noteFrequency: noteFrequency,
    midiFromNoteOctave: midiFromNoteOctave,
    noteOctaveFromMidi: noteOctaveFromMidi,
    frequencyFromMidi: frequencyFromMidi,
    harmonicSeries: harmonicSeries,
    cloneProfile: cloneProfile,
    blankProfile: blankProfile
  };
})();
