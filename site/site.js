// SeeRead site: OS-aware download label, read-aloud timecodes and the demo teleprompter.
// The demo is a scripted simulation; it never asks for the microphone.

const WPM = 150;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function detectOs() {
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod/.test(ua)) return null;
  if (/Windows/.test(ua)) return "Windows";
  // iPadOS reports itself as a Mac; touch points give it away.
  if (/Macintosh/.test(ua)) return navigator.maxTouchPoints > 1 ? null : "macOS";
  if (/Linux|X11/.test(ua)) return "Linux";
  return null;
}

const os = detectOs();
if (os) {
  for (const link of document.querySelectorAll("[data-download]")) {
    link.textContent = `Download for ${os}`;
  }
  document.querySelector(`[data-os="${os}"]`)?.classList.add("current");
}

// Each section's timecode is when it starts if the page is read aloud at WPM.
const countWords = (el) => (el.textContent.match(/\S+/g) || []).length;
const pad = (n, size = 2) => String(n).padStart(size, "0");
const timecode = (seconds) => {
  const ms = Math.round(seconds * 1000);
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)},${pad(ms % 1000, 3)}`;
};

const sections = [...document.querySelectorAll("main .sec")];
const counts = sections.map(countWords);
let spokenSoFar = countWords(document.querySelector(".hero"));
sections.forEach((section, i) => {
  section.querySelector("[data-tc]").textContent = timecode((spokenSoFar * 60) / WPM);
  spokenSoFar += counts[i];
});
const readtime = document.querySelector("[data-readtime]");
if (readtime) {
  readtime.textContent = ` Read aloud at ${WPM} words a minute, this page takes about ${Math.round(spokenSoFar / WPM)} minutes.`;
}

// Demo teleprompter
const demo = document.getElementById("demo");
if (demo) setUpDemo(demo);

function setUpDemo(demo) {
  const prompter = demo.querySelector(".prompter");
  const win = demo.querySelector(".prompter-window");
  const guide = demo.querySelector(".guide");
  const text = demo.querySelector("[data-script]");
  const status = demo.querySelector("[data-status]");
  const heard = demo.querySelector("[data-heard]");
  const playBtn = demo.querySelector("[data-play]");
  const modeBtns = demo.querySelectorAll("[data-mode-btn]");

  // Wrap spoken words in spans. Stage directions stay as they are: never spoken.
  const words = [];
  const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.parentElement.closest(".ann")) continue;
    const frag = document.createDocumentFragment();
    for (const part of node.textContent.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        frag.append(part);
        continue;
      }
      const span = document.createElement("span");
      span.className = "w";
      span.textContent = part;
      frag.append(span);
      words.push(span);
    }
    node.replaceWith(frag);
  }

  // Indexes of words that come straight after a stage direction.
  const afterDirection = new Set();
  for (const ann of text.querySelectorAll(".ann")) {
    const next = words.findIndex(
      (w) => ann.compareDocumentPosition(w) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    if (next > -1) afterDirection.add(next);
  }

  const spokenForm = (w) => w.textContent.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
  const delayAfter = (w) => {
    const t = w.textContent;
    let ms = 250 + t.length * 22;
    if (/[.!?]$/.test(t)) ms += 420;
    else if (/,$/.test(t)) ms += 180;
    if (t === "think,") ms += 2400;
    return ms;
  };

  const AUTO_SPEED = 44; // px per second
  let mode = "voice";
  let playing = false;
  let userPaused = reduceMotion;
  let visible = false;
  let index = -1;
  let offset = 0;
  let timer = 0;
  let frame = 0;
  let lastTime = 0;
  let heardWords = [];
  let tops = [];
  let lineHeight = 0;

  const measure = () => {
    lineHeight = parseFloat(getComputedStyle(text).lineHeight);
    tops = words.map((w) => w.offsetTop - (lineHeight - w.offsetHeight) / 2);
  };

  const setStatus = (msg) => {
    status.textContent = msg;
  };

  const idleStatus = () =>
    mode === "voice" ? "Voice · simulated, mic off" : `Auto-scroll · ${AUTO_SPEED} px/s`;

  const showHeard = (partial) => {
    heard.replaceChildren(heardWords.slice(-12).join(" ") + (partial ? " " : ""));
    if (partial) {
      const span = document.createElement("span");
      span.className = "partial";
      span.textContent = partial;
      heard.append(span);
    }
  };

  const moveTo = (y) => {
    offset = y;
    text.style.transform = `translateY(${y}px)`;
  };

  const highlight = (i) => {
    words.forEach((w, j) => {
      w.classList.toggle("read", j < i);
      w.classList.toggle("cur", j === i);
    });
  };

  // Voice: put the line holding word i on the reading guide.
  const follow = (i) => {
    index = i;
    highlight(i);
    moveTo(guide.offsetTop - tops[i]);
  };

  const voiceStep = () => {
    const next = index + 1;
    if (next >= words.length) {
      setStatus("Voice · end of script");
      timer = setTimeout(restart, 2600);
      return;
    }
    const w = words[next];
    const said = spokenForm(w);
    showHeard(said.slice(0, Math.ceil(said.length * 0.6)));
    timer = setTimeout(() => {
      heardWords.push(said);
      showHeard("");
      follow(next);
      if (afterDirection.has(next)) setStatus("Voice · stage direction skipped");
      else if (w.textContent === "think,") setStatus("Voice · silence, holding your place");
      else setStatus(idleStatus());
      timer = setTimeout(voiceStep, delayAfter(w));
    }, 140);
  };

  // Auto-scroll: move at a steady pace; words above the guide count as read.
  const autoFrame = (now) => {
    const dt = lastTime ? (now - lastTime) / 1000 : 0;
    lastTime = now;
    moveTo(offset - AUTO_SPEED * dt);
    const guideTop = guide.offsetTop;
    let read = 0;
    while (read < words.length && tops[read] + offset + lineHeight <= guideTop + 1) read++;
    index = read - 1;
    words.forEach((w, j) => {
      w.classList.toggle("read", j < read);
      w.classList.remove("cur");
    });
    if (read >= words.length) {
      stopTimers();
      timer = setTimeout(restart, 2000);
      return;
    }
    frame = requestAnimationFrame(autoFrame);
  };

  const stopTimers = () => {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    lastTime = 0;
  };

  const run = () => {
    stopTimers();
    if (!playing) return;
    setStatus(idleStatus());
    if (mode === "voice") voiceStep();
    else frame = requestAnimationFrame(autoFrame);
  };

  const setPlaying = (on) => {
    playing = on;
    playBtn.textContent = on ? "Pause" : "Play";
    if (on) run();
    else {
      stopTimers();
      setStatus("Paused");
    }
  };

  const restart = () => {
    stopTimers();
    heardWords = [];
    showHeard("");
    index = -1;
    highlight(-1);
    moveTo(0);
    if (playing) timer = setTimeout(run, 600);
    else setStatus(idleStatus());
  };

  // Switching modes keeps the reader's place, as the app does.
  const setMode = (next) => {
    if (next === mode) return;
    mode = next;
    prompter.dataset.mode = mode;
    modeBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.modeBtn === mode)));
    if (mode === "voice") {
      if (index >= 0) follow(index);
    } else {
      highlight(-1);
      words.forEach((w, j) => w.classList.toggle("read", j <= index));
    }
    if (playing) run();
    else setStatus(idleStatus());
  };

  // Clicking a word continues from there, as in the app.
  text.addEventListener("click", (event) => {
    const w = event.target.closest(".w");
    if (!w) return;
    const i = words.indexOf(w);
    if (mode === "voice") follow(i);
    else moveTo(guide.offsetTop - tops[i]);
    if (playing) run();
  });

  playBtn.addEventListener("click", () => {
    userPaused = playing;
    setPlaying(!playing);
  });
  demo.querySelector("[data-restart]").addEventListener("click", restart);
  modeBtns.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.modeBtn)));

  document.querySelector("[data-try-auto]")?.addEventListener("click", () => {
    setMode("auto");
    userPaused = false;
    demo.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    setPlaying(true);
  });

  new ResizeObserver(() => {
    measure();
    if (mode === "voice" && index >= 0) follow(index);
  }).observe(win);

  // Play only while on screen, and not before the headline has painted on.
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (!visible && playing) setPlaying(false);
    else if (visible && !playing && !userPaused) setPlaying(true);
  }).observe(win);

  measure();
  document.fonts.ready.then(() => {
    measure();
    if (index >= 0) follow(index);
  });
  setStatus(idleStatus());
  if (!reduceMotion) {
    userPaused = true;
    setTimeout(() => {
      userPaused = false;
      if (visible) setPlaying(true);
    }, 1600);
  }
}
