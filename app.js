/* Pyodide 로 사용자 코드를 추적 실행하고, 그 타임라인을 재생한다. */

const $ = (id) => document.getElementById(id);
const codeEl = $("code");
const gutterEl = $("gutter");
const lineHl = $("lineHl");
const statusEl = $("status");
const consoleEl = $("console");
const stageEl = $("stage");
const playerEl = $("player");
const scrubEl = $("scrub");
const speedBtns = $("speedBtns");
const frameLabel = $("frameLabel");
const runBtn = $("run");
const playBtn = $("playPause");

let pyodide = null;
let tracerSrc = null;
let run = null;      // { timeline, stdout, error, truncated }
let plan = null;
let idx = 0;
let playing = false;
let timer = null;
let outEl = null;
let speed = 15;      // 줄/초
let stopLine = 0;    // 0 = 끝까지. 줄 번호를 클릭하면 여기까지만 실행한다

const SPEEDS = [1, 2, 4, 8, 15, 30, 60, 100];

const LINE_H = 20;   // style.css 의 --lh 와 같아야 한다

/* ---------- 에디터 ---------- */
function syncGutter() {
  const lines = codeEl.value.split("\n").length;
  if (gutterEl.childElementCount !== lines) {
    gutterEl.innerHTML = "";
    for (let i = 1; i <= lines; i++) {
      const d = document.createElement("div");
      d.textContent = i;
      d.dataset.line = i;
      gutterEl.appendChild(d);
    }
    if (stopLine > lines) setStopLine(0);
  }
  gutterEl.scrollTop = codeEl.scrollTop;
  positionHighlight();
  paintStopLine();
}

/* 여기까지 실행: 줄 번호를 누르면 그 줄까지만 돌린다. 같은 줄을 다시 누르면 해제. */
function setStopLine(line) {
  stopLine = (line === stopLine) ? 0 : line;
  paintStopLine();
  saveDraft();
  if (!runBtn.disabled) doRun(false);
}

function paintStopLine() {
  for (const d of gutterEl.children) {
    d.classList.toggle("stop", Number(d.dataset.line) === stopLine);
  }
  $("stopTag").hidden = !stopLine;
  $("stopTagLine").textContent = stopLine;
  const dz = $("deadZone");
  if (!stopLine) { dz.style.display = "none"; return; }
  dz.style.display = "block";
  dz.style.top = (stopLine * LINE_H + 10 - codeEl.scrollTop) + "px";
}

gutterEl.addEventListener("click", (e) => {
  const line = Number(e.target.dataset && e.target.dataset.line);
  if (line) setStopLine(line);
});
$("stopClear").onclick = () => setStopLine(0);

function positionHighlight() {
  if (!run || !run.timeline.length) { lineHl.style.display = "none"; return; }
  const line = run.timeline[idx].line;
  lineHl.style.display = "block";
  lineHl.style.top = ((line - 1) * LINE_H + 10 - codeEl.scrollTop) + "px";
  for (let i = 0; i < gutterEl.children.length; i++) {
    gutterEl.children[i].classList.toggle("on", i === line - 1);
  }
}

codeEl.addEventListener("input", () => { syncGutter(); });
codeEl.addEventListener("scroll", () => {
  gutterEl.scrollTop = codeEl.scrollTop;
  positionHighlight();
  paintStopLine();
});
codeEl.addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    const s = codeEl.selectionStart, t = codeEl.selectionEnd;
    codeEl.value = codeEl.value.slice(0, s) + "    " + codeEl.value.slice(t);
    codeEl.selectionStart = codeEl.selectionEnd = s + 4;
    syncGutter();
  }
});

/* ---------- 파이썬 준비 ---------- */
async function boot() {
  try {
    // no-store 가 없으면 브라우저가 tracer.py 를 캐시해서, 고쳐도 옛 버전이 돈다.
    // 새로고침해도 안 바뀌는 유령 버그가 되므로 반드시 필요하다.
    tracerSrc = await (await fetch("tracer.py", { cache: "no-store" })).text();
    pyodide = await loadPyodide();
    pyodide.runPython(tracerSrc);
    statusEl.textContent = "준비 완료";
    statusEl.className = "status ready";
    runBtn.disabled = false;
  } catch (e) {
    statusEl.textContent = "파이썬 로딩 실패: " + e.message;
    statusEl.className = "status err";
  }
}

/* ---------- 실행 ---------- */
/* 입력을 지어내서 구조만 보는 모드.
 *
 * 백준·SWEA 풀이는 첫 줄부터 input() 이라, 테스트케이스가 없으면 그림이
 * 아예 안 나온다. "케이스 찾아오기 전에 구조부터 보고 싶다"는 요구가 흔하다.
 * 지어낸 입력은 **입력 칸에 그대로 채워 보여준다** — 무엇을 먹였는지 안 보이면
 * 그건 거짓말하는 그림이다. 채워 놓으면 고쳐서 다시 돌릴 수도 있다. */
function doRun(auto) {
  if (!pyodide) return;
  stop();
  consoleEl.innerHTML = "";
  const src = codeEl.value;

  let raw;
  try {
    pyodide.globals.set("__src", src);
    pyodide.globals.set("__stdin", $("stdin").value);
    pyodide.globals.set("__end", stopLine);
    pyodide.globals.set("__auto", !!auto);
    raw = pyodide.runPython("run(__src, __stdin, __end, __auto)");
  } catch (e) {
    log("추적기 자체가 터졌습니다: " + e.message, "err");
    return;
  }

  run = JSON.parse(raw);

  // 지어낸 줄이 있으면 입력 칸에 채워 넣는다. 이제 이 칸이 사실이다.
  if (run.made && run.made.length) {
    const before = $("stdin").value.replace(/\s*$/, "");
    const NL = "\n";
    $("stdin").value = (before ? before + NL : "") + run.made.join(NL) + NL;
    saveDraft();
    log("입력 " + run.made.length + "줄을 지어내 넣었습니다. 입력 칸에서 고쳐 다시 실행할 수 있습니다.", "note");
  }

  if (run.error) {
    const at = run.error.line ? " (" + run.error.line + "번째 줄)" : "";
    log(run.error.type + ": " + run.error.msg + at, "err");
    // 입력이 없어서 멈춘 거라면, 길이 있다는 걸 그 자리에서 알려준다.
    // 도움말은 막힌 순간에 보여야 읽는다.
    //
    // 오류 종류로 가리면 안 된다. `input = sys.stdin.readline` 을 쓰는 코드는
    // 입력이 떨어져도 EOFError 가 아니라 빈 문자열을 받아 ValueError 로 터진다.
    // 진짜 신호는 "입력을 읽는 코드인데 입력 칸이 비어 있다" 는 것이다.
    const needsInput = /input\s*\(|stdin/.test(src);
    if (!auto && needsInput && !$("stdin").value.trim()) {
      const d = document.createElement("div");
      d.className = "note";
      d.innerHTML = '입력 없이 구조만 보려면 ' +
        '<b class="linky" id="tryAuto">샘플 입력으로 실행</b> 을 누르세요.';
      consoleEl.appendChild(d);
      const t = document.getElementById("tryAuto");
      if (t) t.onclick = () => doRun(true);
    }
  }
  if (run.truncated) {
    log("스텝이 너무 많아 앞부분만 기록했습니다. 무한루프거나 입력이 큽니다.", "note");
  }
  if (stopLine && run.endLine && run.endLine !== stopLine) {
    // 블록 한가운데를 잘라서 문법이 깨지면 될 때까지 뒤로 물러난다
    log(stopLine + "줄은 블록 한가운데라 " + run.endLine + "줄까지만 실행했습니다.", "note");
  }
  // print 출력은 재생 시점에 맞춰 조금씩 드러낸다 (한꺼번에 다 보여주면
  // "지금 어디까지 찍혔나"를 알 수 없다).
  outEl = document.createElement("div");
  outEl.className = "stdout-live";
  consoleEl.appendChild(outEl);

  if (!run.timeline.length) {
    stageEl.innerHTML = '<div class="empty">기록된 실행 단계가 없습니다.</div>';
    playerEl.hidden = true;
    return;
  }

  plan = Viz.analyze(run.timeline, src);
  Viz.mount(stageEl, plan);
  playerEl.hidden = false;
  scrubEl.max = run.timeline.length - 1;

  if (run.error && run.error.line) {
    // 터진 줄로 바로 데려간다. 처음부터 재생시키면 원인을 찾으러 되돌아와야 한다.
    let at = run.timeline.length - 1;
    for (let t = run.timeline.length - 1; t >= 0; t--) {
      if (run.timeline[t].line === run.error.line) { at = t; break; }
    }
    seek(at);
    return;
  }
  seek(0);
  play();
}

function log(text, cls) {
  const d = document.createElement("div");
  if (cls) d.className = cls;
  d.textContent = text;
  consoleEl.appendChild(d);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

/* ---------- 재생 ---------- */
function seek(i) {
  if (!run) return;
  idx = Math.max(0, Math.min(run.timeline.length - 1, i));
  scrubEl.value = idx;
  frameLabel.textContent = (idx + 1) + " / " + run.timeline.length + "  ·  " + run.timeline[idx].line + "번째 줄";
  if (outEl) outEl.textContent = run.stdout.slice(0, run.timeline[idx].out || 0);
  Viz.update(run.timeline[idx], idx > 0 ? run.timeline[idx - 1] : null, idx);
  positionHighlight();
}

function tick() {
  if (idx >= run.timeline.length - 1) { stop(); return; }
  seek(idx + 1);
}

function play() {
  if (!run) return;
  if (idx >= run.timeline.length - 1) seek(0);
  playing = true;
  playBtn.textContent = "❚❚";
  clearInterval(timer);
  timer = setInterval(tick, 1000 / speed);
}

/* 속도는 슬라이더 대신 버튼. 마우스로 한 번에 집을 수 있어야 한다. */
function buildSpeedButtons() {
  speedBtns.innerHTML = "";
  for (const v of SPEEDS) {
    const b = document.createElement("button");
    b.textContent = v;
    b.dataset.v = v;
    b.onclick = () => setSpeed(v);
    speedBtns.appendChild(b);
  }
  markSpeed();
}

function setSpeed(v) {
  speed = v;
  markSpeed();
  if (playing) play();   // 재생 중이면 즉시 반영
}

function markSpeed() {
  for (const b of speedBtns.children) {
    b.classList.toggle("on", Number(b.dataset.v) === speed);
  }
}

function stop() {
  playing = false;
  playBtn.textContent = "▶";
  clearInterval(timer);
  timer = null;
}

runBtn.onclick = () => doRun(false);
$("autoInput").onclick = () => doRun(true);
playBtn.onclick = () => (playing ? stop() : play());
$("stepFwd").onclick = () => { stop(); seek(idx + 1); };
$("stepBack").onclick = () => { stop(); seek(idx - 1); };
$("toStart").onclick = () => { stop(); seek(0); };
$("toEnd").onclick = () => { stop(); seek(run.timeline.length - 1); };
scrubEl.oninput = () => { stop(); seek(Number(scrubEl.value)); };

document.addEventListener("keydown", (e) => {
  if (e.target === codeEl) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doRun(); }
    return;
  }
  if (!run) return;
  if (e.key === " ") { e.preventDefault(); playing ? stop() : play(); }
  if (e.key === "ArrowRight") { stop(); seek(idx + 1); }
  if (e.key === "ArrowLeft") { stop(); seek(idx - 1); }
  if (e.key === "[" || e.key === "]") {
    const i = SPEEDS.indexOf(speed);
    setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + (e.key === "]" ? 1 : -1)))]);
  }
});

/* 작성 중인 코드는 브라우저에 남긴다. 새로고침 한 번에 날아가면
 * 매일 쓰는 도구로 못 쓴다. (Pyodide 로딩 때문에 새로고침이 잦다) */
const SAVE_KEY = "algoviz.draft";

function saveDraft() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      code: codeEl.value, stdin: $("stdin").value, stopLine,
    }));
  } catch (e) { /* 사생활 보호 모드 등에서 막힐 수 있다. 저장 실패는 무시한다 */ }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (!d || typeof d.code !== "string" || !d.code.trim()) return false;
    codeEl.value = d.code;
    $("stdin").value = d.stdin || "";
    stopLine = Number(d.stopLine) || 0;
    return true;
  } catch (e) { return false; }
}

let saveTimer = null;
const scheduleSave = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 400);
};
codeEl.addEventListener("input", scheduleSave);
$("stdin").addEventListener("input", scheduleSave);

$("preset").onchange = (e) => {
  const s = SAMPLES[e.target.value];
  if (!s) return;
  const obj = typeof s === "string" ? { code: s, stdin: "" } : s;
  codeEl.value = obj.code;
  $("stdin").value = obj.stdin || "";
  syncGutter();
  e.target.value = "";
  saveDraft();
  if (!runBtn.disabled) doRun(false);
};

if (!loadDraft()) codeEl.value = SAMPLES.bubble;
syncGutter();
buildSpeedButtons();
boot();
