/* 안 보이는 값 찾기.
 *
 * sweep 은 "그림이 나오는가", audit 은 "그 그림이 읽히는가"를 본다.
 * 여기는 **그림이 아예 안 나온 값**을 찾는다. 구조를 담고 있는데 블록이
 * 없으면 사용자는 그 값이 있는 줄도 모른다 — 가장 나쁜 종류의 실패다.
 *
 * 판정: 마지막에서 세어 보아 "볼 만한 구조"인데 블록도 없고 변수 상자에도
 * 못 들어간 이름. 볼 만한 구조란
 *   - 원소 3개 이상인 리스트
 *   - 키 3개 이상인 딕셔너리
 * 를 말한다. 짧은 것은 변수 상자에 그대로 나오므로 뺀다.
 */
window.BLIND = (SET) => {
  const stage = document.getElementById("stage");
  const lines = [];
  let total = 0;
  for (const k of Object.keys(SET)) {
    const s = SET[k];
    const src = typeof s === "string" ? s : s.code;
    const stdin = typeof s === "string" ? "" : (s.stdin || "");
    let r;
    try {
      pyodide.globals.set("__src", src);
      pyodide.globals.set("__stdin", stdin);
      pyodide.globals.set("__end", 0);
      r = JSON.parse(pyodide.runPython("run(__src, __stdin, __end)"));
    } catch (e) { lines.push("X " + k + " 터짐"); continue; }
    if (r.error || !r.timeline.length) { lines.push("X " + k + " 실패"); continue; }
    let p;
    try { p = Viz.analyze(r.timeline, src); Viz.mount(stage, p); }
    catch (e) { lines.push("X " + k + " analyze"); continue; }

    const shown = new Set(p.blocks.map((b) => b.name));
    for (const b of p.blocks) {
      // 값 변화(series) 블록은 이름을 여러 개 묶어 담는다
      if (b.names) for (const n of b.names) shown.add(n);
    }
    // 변수 상자에 든 이름도 보인 것으로 친다
    const boxed = new Set();
    stage.querySelectorAll(".var-chip, .vbox .chip, .vars .chip").forEach((c) => {
      const t = (c.textContent || "").trim().split(/\s/)[0];
      if (t) boxed.add(t);
    });

    // 가장 값이 많이 담긴 프레임에서 본다 (마지막은 이미 비워졌을 수 있다)
    let best = null, bestN = -1;
    for (const f of r.timeline) {
      let n = 0;
      for (const key of Object.keys(f.vars)) {
        const v = f.vars[key];
        if (Array.isArray(v)) n += v.length;
        else if (v && typeof v === "object") n += Object.keys(v).length;
      }
      if (n > bestN) { bestN = n; best = f; }
    }
    if (!best) continue;

    const blind = [];
    for (const key of Object.keys(best.vars)) {
      if (shown.has(key) || boxed.has(key)) continue;
      const v = best.vars[key];
      let size = -1, what = "";
      if (Array.isArray(v)) { size = v.length; what = "리스트"; }
      else if (v && typeof v === "object" && !v.__obj && !v.__ref) {
        size = Object.keys(v).length; what = "딕셔너리";
      }
      if (size >= 3) blind.push(key + "(" + what + size + ")");
    }
    if (blind.length) { lines.push(k + "  " + blind.join(" ")); total += blind.length; }
  }
  return "안 보이는 값 " + total + "개 / " + Object.keys(SET).length + " 예제\n" + lines.join("\n");
};
"blind ready"
