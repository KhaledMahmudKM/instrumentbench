// audio-engine.js
// Web Audio synthesis for Instrument Lab. Unlike Note Bench, every function
// here takes a full instrument *profile object* rather than a key into a
// fixed registry — that's what lets the keyboard preview live edits from the
// composer before (or without ever) saving them anywhere.

window.NB = window.NB || {};

NB.audio = (function (theory) {
  "use strict";

  var audioCtx = null;
  var analyser = null;
  var noiseBuffer = null;
  var activeNodes = [];
  var playEndTime = 0;

  function ensureContext() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.55;
      analyser.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function getNoiseBuffer() {
    if (noiseBuffer) return noiseBuffer;
    var len = audioCtx.sampleRate * 2;
    var buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noiseBuffer = buf;
    return buf;
  }

  function stopActive() {
    activeNodes.forEach(function (n) {
      try { n.stop && n.stop(); } catch (e) {}
      try { n.disconnect(); } catch (e) {}
    });
    activeNodes = [];
  }

  function buildVoice(profile, freq, destination, now, holdSeconds, release) {
    var vibratoLfo = null, vibratoGain = null;
    if (profile.vibrato) {
      vibratoLfo = audioCtx.createOscillator();
      vibratoLfo.frequency.value = profile.vibrato.rate;
      vibratoGain = audioCtx.createGain();
      vibratoGain.gain.value = freq * profile.vibrato.depth;
      vibratoLfo.connect(vibratoGain);
      vibratoLfo.start(now);
      activeNodes.push(vibratoLfo, vibratoGain);
    }

    theory.harmonicSeries(profile, freq).forEach(function (h) {
      if (h.freq <= 0 || h.amp <= 0) return;
      var osc = audioCtx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = h.freq;

      var g = audioCtx.createGain();
      g.gain.value = h.amp;

      osc.connect(g);
      g.connect(destination);

      if (vibratoGain) {
        var vGain = audioCtx.createGain();
        vGain.gain.value = h.ratio;
        vibratoGain.connect(vGain);
        vGain.connect(osc.frequency);
        activeNodes.push(vGain);
      }

      osc.start(now);
      osc.stop(now + holdSeconds + release + 0.1);
      activeNodes.push(osc, g);
    });

    if (profile.breath) {
      var noiseSrc = audioCtx.createBufferSource();
      noiseSrc.buffer = getNoiseBuffer();
      noiseSrc.loop = true;
      var bp = audioCtx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = freq * 2;
      bp.Q.value = 0.8;
      var ng = audioCtx.createGain();
      ng.gain.value = profile.breath;
      noiseSrc.connect(bp); bp.connect(ng); ng.connect(destination);
      noiseSrc.start(now);
      noiseSrc.stop(now + holdSeconds + release + 0.1);
      activeNodes.push(noiseSrc, bp, ng);
    }
  }

  function buildEnvelope(profile, holdSeconds) {
    var now = audioCtx.currentTime;
    var env = profile.envelope;
    var attack = env.attack, decay = env.decay, release = env.release;

    var ad = attack + decay;
    if (ad > holdSeconds * 0.9 && ad > 0) {
      var scale = (holdSeconds * 0.9) / ad;
      attack *= scale; decay *= scale;
    }

    var master = audioCtx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.linearRampToValueAtTime(1, now + Math.max(attack, 0.001));
    master.gain.linearRampToValueAtTime(Math.max(env.sustain, 0.0001), now + attack + decay);
    master.gain.setValueAtTime(Math.max(env.sustain, 0.0001), now + holdSeconds);
    master.gain.linearRampToValueAtTime(0.0001, now + holdSeconds + Math.max(release, 0.02));

    return { master: master, now: now, release: release };
  }

  // profile: a full instrument profile object (see music-theory.js)
  function playNote(profile, freq, holdSeconds) {
    ensureContext();
    stopActive();

    var env = buildEnvelope(profile, holdSeconds);
    var output = audioCtx.createGain();
    output.gain.value = 0.8;
    env.master.connect(output);
    output.connect(analyser);
    activeNodes.push(env.master, output);

    buildVoice(profile, freq, env.master, env.now, holdSeconds, env.release);

    playEndTime = env.now + holdSeconds + env.release + 0.1;
  }

  function playChord(profile, freqList, holdSeconds) {
    ensureContext();
    stopActive();

    var env = buildEnvelope(profile, holdSeconds);
    var output = audioCtx.createGain();
    output.gain.value = 0.85 / Math.sqrt(Math.max(1, freqList.length));
    env.master.connect(output);
    output.connect(analyser);
    activeNodes.push(env.master, output);

    freqList.forEach(function (freq) {
      buildVoice(profile, freq, env.master, env.now, holdSeconds, env.release);
    });

    playEndTime = env.now + holdSeconds + env.release + 0.1;
  }

  return {
    ensureContext: ensureContext,
    playNote: playNote,
    playChord: playChord,
    getAnalyser: function () { return analyser; },
    getAudioCtx: function () { return audioCtx; },
    getPlayEndTime: function () { return playEndTime; }
  };
})(NB.theory);
