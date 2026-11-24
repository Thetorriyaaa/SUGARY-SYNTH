(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  const S = {
    keyNotes: new Map(),
    waveA: "triangle",
    waveB: "sine",
    ctx: null,
    master: null,
    voices: {},
    lfo: null,
    lfoFilter: {},
    notes: new Map(),
    held: new Set(),
    playing: false,
    step: 0,
    track: "A",
    timer: null,
    octave: 4,
    taps: [],
    animation: null,
    pattern: {
      A: Array(16).fill(false),
      B: Array(16).fill(false)
    },
    noteValues: {
      A: Array(16).fill(0),
      B: Array(16).fill(2)
    }
  };

  const defaults = {
    octA: 0, tuneA: 0, levelA: 70, panA: -45,
    octB: 1, tuneB: 7, levelB: 48, panB: 45,
    cutoff: 4200, resonance: 2.5, drive: 8,
    glide: 0.04, tone: 0, scale: 1,
    lfoRate: 2.4, lfoDepth: 25,
    delayTime: 0.28, feedback: 0.32, delayMix: 22,
    room: 0.68, damp: 42, reverbMix: 28
  };

  const V = { ...defaults };

  const scales = [
    [0, 2, 4, 5, 7, 9, 11],
    [0, 2, 3, 5, 7, 8, 10],
    [0, 3, 5, 7, 10]
  ];

  const noteNames = [
    "C", "C#", "D", "D#", "E", "F",
    "F#", "G", "G#", "A", "A#", "B"
  ];

  const presetPatterns = {
    dream: {
      A: [1,0,0,1,0,0,1,0,1,0,0,1,0,1,0,0],
      B: [0,0,1,0,0,0,0,1,0,0,1,0,0,0,1,0]
    },
    candy: {
      A: [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],
      B: [0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1]
    },
    night: {
      A: [1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0],
      B: [0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0]
    },
    pulse: {
      A: [1,0,1,1,0,1,0,1,1,0,1,0,1,0,1,0],
      B: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0]
    }
  };



  function format(key, value) {
    if (key.startsWith("pan")) {
      return value === 0 ? "C" :
        value < 0 ? "L " + Math.abs(value) : "R " + value;
    }

    if (key === "cutoff") {
      return value >= 1000 ?
        (value / 1000).toFixed(1) + "k" :
        Math.round(value);
    }

    if (["levelA","levelB","drive","lfoDepth",
         "delayMix","reverbMix","damp"].includes(key)) {
      return Math.round(value) + "%";
    }

    if (key === "scale") {
      return ["MAJOR","MINOR","PENTA"][Math.round(value)];
    }

    if (["octA","octB","tone"].includes(key)) {
      return value > 0 ? "+" + value : String(value);
    }

    if (key === "tuneA" || key === "tuneB") {
      return String(Math.round(value));
    }

    return Number(value).toFixed(2)
      .replace(/0+$/, "").replace(/\.$/, "");
  }

  function setKnob(el, value) {
    const key = el.dataset.target;
    const min = Number(el.dataset.min);
    const max = Number(el.dataset.max);

    value = Math.max(min, Math.min(max, value));

    if (["octA","octB","tone","scale"].includes(key)) {
      value = Math.round(value);
    }

    if (["tuneA","tuneB","levelA","levelB",
         "panA","panB","drive","lfoDepth",
         "damp","delayMix","reverbMix","cutoff"].includes(key)) {
      value = Math.round(value);
    }

    if (["resonance","glide","lfoRate","delayTime",
         "feedback","room"].includes(key)) {
      value = Math.round(value * 100) / 100;
    }

    const progress = (value - min) / (max - min);
    const angle = -135 + progress * 270;

    el.dataset.value = value;
    el.style.setProperty("--angle", angle + "deg");

    V[key] = value;
    el.querySelector("output").textContent = format(key, value);
  }

  document.querySelectorAll(".knob").forEach(el => {
    const key = el.dataset.target;

    setKnob(el, Number(el.dataset.value));

    let startY = 0;
    let startValue = 0;
    let dragging = false;

    el.addEventListener("pointerdown", e => {
      dragging = true;
      startY = e.clientY;
      startValue = Number(el.dataset.value);
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener("pointermove", e => {
      if (!dragging) return;

      const min = Number(el.dataset.min);
      const max = Number(el.dataset.max);
      const speed = (max - min) / 150;

      setKnob(el, startValue + (startY - e.clientY) * speed);
      applyAudio();
    });

    el.addEventListener("pointerup", () => {
      dragging = false;
    });

    el.addEventListener("pointercancel", () => {
      dragging = false;
    });

    el.addEventListener("wheel", e => {
      e.preventDefault();

      const min = Number(el.dataset.min);
      const max = Number(el.dataset.max);
      const direction = e.deltaY < 0 ? 1 : -1;

      setKnob(
        el,
        Number(el.dataset.value) + direction * (max - min) / 100
      );

      applyAudio();
    }, { passive: false });

    el.addEventListener("dblclick", () => {
      setKnob(el, defaults[key]);
      applyAudio();
    });
  });



  function makeImpulse(ctx, room, damp) {
    const seconds = 1.2 + room * 3.5;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);

    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let previous = 0;

      for (let i = 0; i < length; i++) {
        const noise = Math.random() * 2 - 1;
        const filtered = noise * (1 - damp / 100) +
          previous * (damp / 100);

        previous = filtered;

        data[i] = filtered *
          Math.pow(1 - i / length, 1.8 + room * 2);
      }
    }

    return buffer;
  }

  function makeDrive(amount) {
    const samples = 44100;
    const curve = new Float32Array(samples);
    const intensity = 1 + amount * 0.16;

    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = Math.tanh(x * intensity);
    }

    return curve;
  }

  function createDelay(ctx, voice) {
    const delay = ctx.createDelay(1);
    const feedback = ctx.createGain();
    const wet = ctx.createGain();

    delay.delayTime.value = V.delayTime;
    feedback.gain.value = V.feedback;
    wet.gain.value = V.delayMix / 100;

    voice.output.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(voice.pan);

    return { delay, feedback, wet };
  }

  function createReverb(ctx, voice) {
    const convolver = ctx.createConvolver();
    const wet = ctx.createGain();

    convolver.buffer = makeImpulse(ctx, V.room, V.damp);
    wet.gain.value = V.reverbMix / 100;

    voice.output.connect(convolver);
    convolver.connect(wet);
    wet.connect(voice.pan);

    return { convolver, wet };
  }



  function initAudio() {
    if (S.ctx) {
      if (S.ctx.state === "suspended") S.ctx.resume();
      return true;
    }

    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      toast("AUDIO NOT SUPPORTED");
      return false;
    }

    const ctx = new AudioContextClass();
    S.ctx = ctx;

    S.master = ctx.createGain();
    S.master.gain.value = 0.78;
    S.master.connect(ctx.destination);



    const splitter = ctx.createChannelSplitter(2);

    S.analyserL = ctx.createAnalyser();
    S.analyserR = ctx.createAnalyser();

    S.analyserL.fftSize = 256;
    S.analyserR.fftSize = 256;

    S.master.connect(splitter);
    splitter.connect(S.analyserL, 0);
    splitter.connect(S.analyserR, 1);



    S.lfo = ctx.createOscillator();
    S.lfo.type = "sine";
    S.lfo.frequency.value = V.lfoRate;
    S.lfo.start();



    ["A", "B"].forEach(name => {
      const input = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      const shaper = ctx.createWaveShaper();
      const output = ctx.createGain();
      const pan = ctx.createStereoPanner();

      filter.type = $("filterType").value;
      filter.frequency.value = V.cutoff;
      filter.Q.value = V.resonance;

      shaper.curve = makeDrive(V.drive);
      shaper.oversample = "4x";

      input.connect(filter);
      filter.connect(shaper);
      shaper.connect(output);

      output.connect(pan);
      pan.connect(S.master);

      const voice = {
        input,
        filter,
        shaper,
        output,
        pan,
        delay: null,
        reverb: null,
        lfoFilter: ctx.createGain()
      };

      voice.delay = createDelay(ctx, voice);
      voice.reverb = createReverb(ctx, voice);

      voice.lfoFilter.gain.value = 0;
      S.lfo.connect(voice.lfoFilter);
      voice.lfoFilter.connect(filter.frequency);

      S.voices[name] = voice;
    });

    applyAudio();
    updateMeters();

    return true;
  }



  function applyAudio() {
    if (!S.ctx) return;

    const ctx = S.ctx;
    const now = ctx.currentTime;

    S.master.gain.setTargetAtTime(
      Number($("master").value) / 100,
      now, 0.025
    );

    const width = Number($("width").value) / 100;

    ["A", "B"].forEach(name => {
      const voice = S.voices[name];
      const enabled = $("on" + name).checked;

      const mixer = Number($("mix" + name).value) / 100;
      const level = V["level" + name] / 100;

      voice.input.gain.setTargetAtTime(
        enabled ? level * mixer : 0,
        now, 0.025
      );

      voice.pan.pan.setTargetAtTime(
        V["pan" + name] / 100 * width,
        now, 0.025
      );

      voice.filter.type = $("filterType").value;

      voice.filter.frequency.setTargetAtTime(
        V.cutoff, now, 0.025
      );

      voice.filter.Q.setTargetAtTime(
        V.resonance, now, 0.025
      );

      voice.shaper.curve = makeDrive(V.drive);

      voice.delay.delay.delayTime.setTargetAtTime(
        V.delayTime, now, 0.025
      );

      voice.delay.feedback.gain.setTargetAtTime(
        $("delayOn").checked ? V.feedback : 0,
        now, 0.025
      );

      voice.delay.wet.gain.setTargetAtTime(
        $("delayOn").checked ? V.delayMix / 100 : 0,
        now, 0.025
      );

      voice.reverb.wet.gain.setTargetAtTime(
        $("reverbOn").checked ? V.reverbMix / 100 : 0,
        now, 0.025
      );

      voice.lfoFilter.gain.setTargetAtTime(
        $("lfoDest").value === "filter"
          ? V.cutoff * V.lfoDepth / 100 * 0.45
          : 0,
        now, 0.025
      );
    });

    S.lfo.frequency.setTargetAtTime(
      V.lfoRate, now, 0.025
    );



    S.notes.forEach(note => updateNoteMod(note));
  }



  function updateNoteMod(note) {
    if (!S.ctx || !note || note.released) return;

    const destination = $("lfoDest").value;
    const depth = V.lfoDepth / 100;
    const ctx = S.ctx;
    const now = ctx.currentTime;

    note.mod.gain.cancelScheduledValues(now);
    note.mod.disconnect();

    if (destination === "pitch") {
      note.mod.gain.setValueAtTime(depth * 18, now);
      S.lfo.connect(note.mod);
      note.mod.connect(note.osc.detune);
    } else if (destination === "volume") {
      note.mod.gain.setValueAtTime(
        depth * 0.35 * note.velocity, now
      );
      S.lfo.connect(note.mod);
      note.mod.connect(note.amp.gain);
    }
  }



  function midiFrequency(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function noteOn(midi, voiceName = "A", velocity = 0.8) {
    if (!initAudio()) return null;
    if (!$("on" + voiceName).checked) return null;

    const ctx = S.ctx;
    const now = ctx.currentTime;
    const voice = S.voices[voiceName];

    const finalMidi = midi +
      V.tone + V["oct" + voiceName] * 12;

    const freq = midiFrequency(finalMidi);

    const osc = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const amp = ctx.createGain();
    const subAmp = ctx.createGain();
    const mod = ctx.createGain();

    const previous = voice.lastFrequency;

    osc.type = S["wave" + voiceName];

    if (previous && V.glide > 0) {
      osc.frequency.setValueAtTime(previous, now);
      osc.frequency.setTargetAtTime(freq, now, Math.max(.005, V.glide));
    } else {
      osc.frequency.setValueAtTime(freq, now);
    }

    osc.detune.value = V["tune" + voiceName];

    voice.lastFrequency = freq;

    sub.type = "sine";
    sub.frequency.setValueAtTime(freq / 2, now);
    subAmp.gain.value = $("sub" + voiceName).checked ? 0.16 : 0;

    const attack = Number($("attack").value);
    const decay = Number($("decay").value);
    const sustain = Number($("sustain").value);

    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.linearRampToValueAtTime(
      velocity, now + attack
    );
    amp.gain.linearRampToValueAtTime(
      Math.max(0.0001, velocity * sustain),
      now + attack + decay
    );

    osc.connect(amp);
    sub.connect(subAmp);
    subAmp.connect(amp);
    amp.connect(voice.input);

    osc.start(now);
    sub.start(now);

    const note = {
      osc, sub, amp, mod,
      voiceName, velocity,
      released: false
    };

    updateNoteMod(note);

    S.notes.set(note, note);

    return note;
  }

  function noteOff(note) {
    if (!note || note.released || !S.ctx) return;

    note.released = true;

    const ctx = S.ctx;
    const now = ctx.currentTime;
    const release = Number($("release").value);

    note.amp.gain.cancelScheduledValues(now);
    note.amp.gain.setTargetAtTime(
      0.0001, now, Math.max(0.008, release / 4)
    );

    const stopTime = now + release + 0.12;

    note.osc.stop(stopTime);
    note.sub.stop(stopTime);

    setTimeout(() => {
      try {
        note.osc.disconnect();
        note.sub.disconnect();
        note.amp.disconnect();
        note.mod.disconnect();
      } catch (e) {}

      S.notes.delete(note);
    }, (release + 0.3) * 1000);
  }

  function playNote(midi, voiceName, duration, velocity = 0.8) {
    const note = noteOn(midi, voiceName, velocity);
    if (!note) return;

    setTimeout(() => noteOff(note), Math.max(40, duration * 1000));
  }



  ["A", "B"].forEach(name => {
    const group = $("wave" + name);
    const voice = { wave: name === "A" ? "triangle" : "sine" };

    if (S.voices[name]) {
      S.voices[name].wave = voice.wave;
    }

    group.querySelectorAll("button").forEach(button => {
      button.addEventListener("click", () => {
        group.querySelectorAll("button").forEach(b => {
          b.classList.remove("active");
        });

        button.classList.add("active");

        S["wave" + name] = button.dataset.wave;

if (S.voices[name]) {
  S.voices[name].wave = button.dataset.wave;
}
      });
    });
  });



function renderSteps() {
  const container = $("steps");
  container.innerHTML = "";

  for (let i = 0; i < 16; i++) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "step";


    button.dataset.track = S.track;
    button.dataset.index = i;

    button.classList.toggle("active", S.pattern[S.track][i]);
    button.classList.toggle(
      "current",
      S.playing && S.step === i
    );

    button.innerHTML = `
      <small>${String(i + 1).padStart(2, "0")}</small>
      <span class="step-dot"></span>
    `;

    button.addEventListener("click", () => {
      S.pattern[S.track][i] = !S.pattern[S.track][i];

      if (S.pattern[S.track][i]) {
        S.noteValues[S.track][i] =
          Number($("noteSelect").value);
      }

      button.classList.toggle(
        "active",
        S.pattern[S.track][i]
      );
    });

    container.appendChild(button);
  }
}


function updateStepDisplay() {
  document.querySelectorAll(".step").forEach(button => {
    const index = Number(button.dataset.index);

    button.classList.toggle(
      "current",
      S.playing && index === S.step
    );
  });
}


  document.querySelectorAll(".track-btn").forEach(button => {
    button.addEventListener("click", () => {
      S.track = button.dataset.track;

      document.querySelectorAll(".track-btn").forEach(b => {
        b.classList.toggle("active", b === button);
      });

      renderSteps();
    });
  });

  function getStepMidi(i, track) {
    const root = noteNames.indexOf($("rootNote").value);
    const scale = scales[V.scale];
    const index = S.noteValues[track][i] % scale.length;
    const octave = Math.floor(S.noteValues[track][i] / scale.length);

    return 48 + root + scale[index] + octave * 12;
  }

  function tick() {
    if (!S.playing) return;

    const bpm = Number($("tempo").value);
    const interval = 60000 / bpm / 4;
    const i = S.step;

    const swing = Number($("swing").value) / 100;
    const gate = Number($("gate").value) / 100;
    const humanize = Number($("humanize").value) / 100;

    ["A", "B"].forEach(track => {
      if (!S.pattern[track][i]) return;

      const offset = i % 2 ? interval * swing : 0;
      const variation = (Math.random() - 0.5) * humanize * 0.06;

      setTimeout(() => {
        if (!S.playing) return;

        const note = getStepMidi(i, track);
        const duration = Math.max(
          0.04,
          interval / 1000 * gate + variation
        );

        playNote(note, track, duration, 0.8);
      }, offset);
    });

    $("stepReadout").textContent =
      String(i + 1).padStart(2, "0") + " / 16";

    S.step = (S.step + 1) % 16;
    renderSteps();

    S.timer = setTimeout(tick, interval);
  }

  function play() {
    if (!initAudio() || S.playing) return;

    S.playing = true;
    $("statusLed").classList.remove("off");
    $("statusText").textContent = "PLAYING";

    if (!S.animation) updateMeters();

    tick();
  }

  function stop() {
    S.playing = false;
    clearTimeout(S.timer);

    S.step = 0;

    $("statusLed").classList.add("off");
    $("statusText").textContent = "READY";
    $("stepReadout").textContent = "01 / 16";

    renderSteps();
  }

  $("playBtn").addEventListener("click", play);
  $("stopBtn").addEventListener("click", stop);



  $("randomBtn").addEventListener("click", () => {
    ["A", "B"].forEach(track => {
      const chance = track === "A" ? 0.55 : 0.35;

      S.pattern[track] = Array.from(
        { length: 16 },
        () => Math.random() < chance
      );

      S.noteValues[track] = Array.from(
        { length: 16 },
        () => Math.floor(Math.random() * 7)
      );
    });

    renderSteps();
    toast("NEW PATTERN ✳");
  });

  $("clearBtn").addEventListener("click", () => {
    S.pattern.A.fill(false);
    S.pattern.B.fill(false);
    renderSteps();
    toast("CLEARED");
  });



  function loadPreset(name) {
    const preset = presetPatterns[name];
    if (!preset) return;

    S.pattern.A = preset.A.map(Boolean);
    S.pattern.B = preset.B.map(Boolean);

    S.noteValues.A = Array(16).fill(0);
    S.noteValues.B = Array(16).fill(2);

    renderSteps();
  }

  $("preset").addEventListener("change", e => {
    loadPreset(e.target.value);
    toast("PRESET LOADED ♡");
  });

  $("savePreset").addEventListener("click", () => {
    const data = {
      pattern: S.pattern,
      notes: S.noteValues,
      preset: $("preset").value
    };

    try {
      localStorage.setItem("sugary-synth-save", JSON.stringify(data));
      toast("SAVED ♡");
    } catch (e) {
      toast("SAVE ERROR");
    }
  });

  try {
    const saved = localStorage.getItem("sugary-synth-save");

    if (saved) {
      const data = JSON.parse(saved);

      if (
        data.pattern?.A?.length === 16 &&
        data.pattern?.B?.length === 16
      ) {
        S.pattern.A = data.pattern.A.map(Boolean);
        S.pattern.B = data.pattern.B.map(Boolean);

        if (data.notes?.A?.length === 16) {
          S.noteValues.A = data.notes.A;
        }

        if (data.notes?.B?.length === 16) {
          S.noteValues.B = data.notes.B;
        }

        if (data.preset && presetPatterns[data.preset]) {
          $("preset").value = data.preset;
        }
      }
    } else {
      loadPreset("dream");
    }
  } catch (e) {
    loadPreset("dream");
  }



  const rangeIds = [
    "master", "mixA", "mixB", "width",
    "tempo", "gate", "swing", "humanize",
    "attack", "decay", "sustain", "release"
  ];

  rangeIds.forEach(id => {
    $(id).addEventListener("input", () => {
      if (id === "master") {
        $("masterValue").textContent = $(id).value;
      }

      if (id === "tempo") {
        $("tempoValue").textContent = $(id).value;
      }

      if (id === "humanize") {
        $("humanizeValue").textContent = $(id).value + "%";
      }

      if (id === "mixA" || id === "mixB") {
        $(id + "Out").textContent = $(id).value;
      }

      if (["attack","decay","sustain","release"].includes(id)) {
        $(id + "Out").textContent = Number($(id).value).toFixed(2);
      }

      applyAudio();
    });
  });

  [
    "onA","onB","subA","subB",
    "filterType","delayOn","reverbOn","lfoDest"
  ].forEach(id => {
    $(id).addEventListener("change", applyAudio);
  });



  function refreshReverb() {
    if (!S.ctx) return;

    ["A", "B"].forEach(name => {
      S.voices[name].reverb.convolver.buffer =
        makeImpulse(S.ctx, V.room, V.damp);
    });
  }

  document.querySelectorAll(".knob").forEach(el => {
    if (el.dataset.target !== "room" &&
        el.dataset.target !== "damp") return;

    el.addEventListener("pointerup", refreshReverb);
    el.addEventListener("dblclick", refreshReverb);
    el.addEventListener("wheel", refreshReverb);
  });



  const keyboardMap = {
    q: 0, w: 2, e: 4, r: 5, t: 7,
    y: 9, u: 11, i: 12, o: 14, p: 16
  };

  function isTyping() {
    return ["INPUT","SELECT","TEXTAREA"].includes(
      document.activeElement.tagName
    );
  }

function computerDown(key) {
  key = key.toLowerCase();

  if (!(key in keyboardMap)) return;
  if (S.held.has(key)) return;

  const midi = 12 * (S.octave + 1) + keyboardMap[key];
  const note = noteOn(midi, "A", 0.8);

  if (!note) return;

  S.keyNotes.set(key, note);
  S.held.add(key);

  if (S.hold) {
    S.notes.set("held-" + key, note);
  }
}

function computerUp(key) {
  key = key.toLowerCase();

  const note = S.keyNotes.get(key);
  if (!note) return;

  S.keyNotes.delete(key);
  S.held.delete(key);

  if (!S.hold) {
    noteOff(note);
  } else {
    S.notes.set("held-" + key, note);
  }
}

  window.addEventListener("keydown", e => {
    if (e.repeat || isTyping()) return;

    if (e.code === "Space") {
      e.preventDefault();
      S.playing ? stop() : play();
      return;
    }

    computerDown(e.key);
  });

  window.addEventListener("keyup", e => {
    computerUp(e.key);
  });



  $("holdBtn").addEventListener("change", e => {
    const enabled = e.target.checked;

    if (!enabled) {
      S.notes.forEach((note, key) => {
        if (typeof key === "string" && key.startsWith("held-")) {
          noteOff(note);
          S.notes.delete(key);
        }
      });
    }

    toast(enabled ? "HOLD ON" : "HOLD OFF");
  });

  Object.defineProperty(S, "hold", {
    get() {
      return $("holdBtn").checked;
    }
  });



  $("tapBtn").addEventListener("click", () => {
    const now = Date.now();

    S.taps = S.taps.filter(t => now - t < 2200);
    S.taps.push(now);

    if (S.taps.length > 1) {
      const intervals = [];

      for (let i = 1; i < S.taps.length; i++) {
        intervals.push(S.taps[i] - S.taps[i - 1]);
      }

      const avg = intervals.reduce((a, b) => a + b, 0) /
        intervals.length;

      const bpm = Math.round(60000 / avg);

      $("tempo").value = Math.max(55, Math.min(180, bpm));
      $("tempo").dispatchEvent(new Event("input"));
    }
  });



  function updateMeters() {
    if (!S.ctx) return;

    const left = new Uint8Array(S.analyserL.fftSize);
    const right = new Uint8Array(S.analyserR.fftSize);

    S.analyserL.getByteTimeDomainData(left);
    S.analyserR.getByteTimeDomainData(right);

    function rms(data) {
      let sum = 0;

      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }

      return Math.sqrt(sum / data.length);
    }

    $("meterL").style.height =
      Math.min(100, rms(left) * 300) + "%";

    $("meterR").style.height =
      Math.min(100, rms(right) * 300) + "%";

    S.animation = requestAnimationFrame(updateMeters);
  }



  let toastTimer;

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      el.classList.remove("show");
    }, 1400);
  }



  $("statusLed").classList.add("off");

  renderSteps();

  $("masterValue").textContent = $("master").value;
  $("tempoValue").textContent = $("tempo").value;
  $("humanizeValue").textContent = $("humanize").value + "%";

})();


const envelopePath = document.getElementById("envelopePath");
const envelopeFillPath = document.getElementById("envelopeFillPath");
const envelopePoint = document.getElementById("envelopePoint");
const envelopeGlow = document.getElementById("envelopeGlow");

function updateEnvelopeGraphic() {
    if (!envelopePath) return;

    const attack = Number(document.getElementById("attack").value);
    const decay = Number(document.getElementById("decay").value);
    const sustain = Number(document.getElementById("sustain").value);
    const release = Number(document.getElementById("release").value);

    const startX = 8;
    const attackX = startX + 15 + (attack / 1.5) * 45;
    const decayX = attackX + 12 + (decay / 1.5) * 35;
    const sustainX = 190;
    const releaseX = 232;

    const topY = 8;
    const bottomY = 78;
    const sustainY = bottomY - sustain * (bottomY - topY);

    const d = `
        M ${startX} ${bottomY}
        L ${attackX} ${topY}
        L ${decayX} ${sustainY}
        L ${sustainX} ${sustainY}
        Q ${sustainX + 15} ${sustainY} ${releaseX} ${bottomY}
    `;

    envelopePath.setAttribute("d", d);

    envelopeFillPath.setAttribute(
        "d",
        `${d} L ${startX} ${bottomY} Z`
    );

    envelopePoint.setAttribute("cx", attackX);
    envelopePoint.setAttribute("cy", topY);
    envelopeGlow.setAttribute("cx", attackX);
    envelopeGlow.setAttribute("cy", topY);
}

["attack", "decay", "sustain", "release"].forEach(id => {
    document.getElementById(id).addEventListener("input", updateEnvelopeGraphic);
});

updateEnvelopeGraphic();