// Ambient sound for driftpad.
// A slow generative drone that fades in while you draw and fades out when you stop.
// Everything is synthesised with Web Audio; there are no audio files to load.
//
// window.driftAmbient.drawStart()  call when a stroke begins
// window.driftAmbient.drawEnd()    call when a stroke ends
// window.driftAmbient.setEnabled(bool) / isEnabled()

(function () {
  'use strict';

  const STORAGE_KEY = 'driftpad-sound';
  const LEVEL = 0.5;        // master level while drawing
  const FADE_IN = 1.2;      // seconds, time constant
  const FADE_OUT = 2.2;     // seconds, time constant
  const LINGER = 2500;      // ms the sound holds after a stroke before fading
  const SLEEP_AFTER = 15000; // ms of silence before the audio engine is suspended

  // D major pentatonic, low and open. Frequencies in Hz.
  const DRONE = [73.42, 110.0, 146.83, 220.0, 293.66];           // D2 A2 D3 A3 D4
  const BELLS = [293.66, 329.63, 369.99, 440.0, 493.88, 587.33, 659.25]; // D4 E4 F#4 A4 B4 D5 E5

  let ctx = null;
  let master = null;   // gain that follows drawing
  let wet = null;      // send into the echo
  let enabled = readEnabled();
  let drawing = false;
  let lingerTimer = null;
  let sleepTimer = null;
  let bellTimer = null;

  function readEnabled() {
    try { return localStorage.getItem(STORAGE_KEY) !== 'off'; } catch (e) { return true; }
  }

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 0;

    // Gentle limiter so stacked voices never clip.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    master.connect(comp);
    comp.connect(ctx.destination);

    // A soft echo stands in for a room: two delays feeding each other through a low-pass.
    wet = ctx.createGain();
    wet.gain.value = 0.5;
    const d1 = ctx.createDelay(2);
    const d2 = ctx.createDelay(2);
    d1.delayTime.value = 0.37;
    d2.delayTime.value = 0.53;
    const fb = ctx.createGain();
    fb.gain.value = 0.55;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 1400;
    wet.connect(d1);
    d1.connect(d2);
    d2.connect(damp);
    damp.connect(fb);
    fb.connect(d1);
    d1.connect(master);
    d2.connect(master);

    // The drone: each note is two slightly detuned oscillators whose level drifts on its own slow cycle.
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 900;
    tone.Q.value = 0.3;
    tone.connect(master);
    tone.connect(wet);

    DRONE.forEach(function (freq, i) {
      const voice = ctx.createGain();
      const base = 0.11 / (1 + i * 0.35); // higher notes sit quieter
      voice.gain.value = base;
      voice.connect(tone);

      [-4, 4].forEach(function (cents) {
        const osc = ctx.createOscillator();
        osc.type = i < 2 ? 'sine' : 'triangle';
        osc.frequency.value = freq;
        osc.detune.value = cents + (Math.random() * 2 - 1);
        osc.connect(voice);
        osc.start();
      });

      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.03 + Math.random() * 0.06; // one breath every 11 to 33 seconds
      const depth = ctx.createGain();
      depth.gain.value = base * 0.7;
      lfo.connect(depth);
      depth.connect(voice.gain);
      lfo.start();
    });

    return true;
  }

  // One soft bell note, picked from the scale.
  function bell() {
    if (!ctx || !drawing || !enabled) return;
    const now = ctx.currentTime;
    const freq = BELLS[Math.floor(Math.random() * BELLS.length)];
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.05, now + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 5);
    osc.connect(g);
    g.connect(master);
    g.connect(wet);
    osc.start(now);
    osc.stop(now + 5.2);
  }

  function scheduleBell() {
    clearTimeout(bellTimer);
    bellTimer = setTimeout(function () {
      bell();
      if (drawing) scheduleBell();
    }, 1800 + Math.random() * 3600);
  }

  function fadeTo(level, timeConstant) {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setTargetAtTime(level, now, timeConstant);
  }

  function drawStart() {
    if (!enabled) return;
    if (!ctx && !build()) return;
    // Browsers only allow sound after a touch or click; a stroke is one.
    if (ctx.state !== 'running') ctx.resume().catch(function () {});
    clearTimeout(lingerTimer);
    clearTimeout(sleepTimer);
    if (drawing) return; // the canvas fires several start events per press
    drawing = true;
    fadeTo(LEVEL, FADE_IN);
    scheduleBell();
  }

  function drawEnd() {
    if (!ctx) return;
    // On touch screens the engine may only unlock when the finger lifts.
    if (enabled && ctx.state !== 'running') ctx.resume().catch(function () {});
    if (!drawing) return;
    clearTimeout(lingerTimer);
    lingerTimer = setTimeout(quiet, LINGER);
  }

  function quiet() {
    drawing = false;
    clearTimeout(bellTimer);
    if (!ctx) return;
    fadeTo(0, FADE_OUT);
    clearTimeout(sleepTimer);
    sleepTimer = setTimeout(function () {
      if (!drawing && ctx.state === 'running') ctx.suspend().catch(function () {});
    }, SLEEP_AFTER);
  }

  function setEnabled(on) {
    enabled = !!on;
    try { localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off'); } catch (e) {}
    if (!enabled) {
      clearTimeout(lingerTimer);
      if (ctx) { drawing = true; quiet(); }
    }
    syncButton();
  }

  function syncButton() {
    const btn = document.getElementById('sound-btn');
    if (!btn) return;
    btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    btn.title = enabled ? 'Sound on while drawing' : 'Sound off';
  }

  function init() {
    const btn = document.getElementById('sound-btn');
    if (btn) {
      btn.addEventListener('click', function () { setEnabled(!enabled); });
    }
    syncButton();
    // Never keep playing in a hidden tab.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && ctx && drawing) { clearTimeout(lingerTimer); quiet(); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.driftAmbient = {
    drawStart: drawStart,
    drawEnd: drawEnd,
    setEnabled: setEnabled,
    isEnabled: function () { return enabled; },
    // For checking in the console: { state, level, drawing }
    status: function () {
      return { state: ctx ? ctx.state : 'not started', level: master ? master.gain.value : 0, drawing: drawing, enabled: enabled };
    }
  };
})();
