/* 회귀 확인. 예제를 전부 돌려서 다음을 본다.
 *   - 추적기가 터지지 않는가
 *   - 블록마다 제목이 붙었는가 (블록 수 + 1 = 제목 수, 마지막은 "변수")
 *   - 블록마다 그림이 들어갔는가 (제목만 있고 속이 빈 블록이 없는가)
 *   - 같은 변수가 블록 두 개로 나오지 않는가
 *   - 프레임을 훑는 동안 update() 가 터지거나 설명 줄이 비지 않는가
 * 함수 안 프레임(depth > 0)도 반드시 훑는다. 예전에 전역만 보다가
 * "함수 안에서 화면이 텅 빈다"를 22개 예제 통과시키며 놓쳤다. */
window.SWEEP = (SET) => {
  const stage = document.getElementById("stage");
  const lines = []; let bad = 0;
  for (const k of Object.keys(SET)) {
    const s = SET[k];
    const src = typeof s === "string" ? s : s.code;
    const stdin = typeof s === "string" ? "" : (s.stdin || "");
    let r;
    try {
      pyodide.globals.set("__src", src); pyodide.globals.set("__stdin", stdin); pyodide.globals.set("__end", 0);
      r = JSON.parse(pyodide.runPython("run(__src, __stdin, __end)"));
    } catch (e) { lines.push("X " + k + " :: 터짐 " + e.message); bad++; continue; }
    if (r.error) { lines.push("X " + k + " :: 실패 " + r.error.type + " " + r.error.msg); bad++; continue; }
    let p;
    try { p = Viz.analyze(r.timeline, src); }
    catch (e) { lines.push("X " + k + " :: analyze터짐 " + e.message); bad++; continue; }
    try { Viz.mount(stage, p); }
    catch (e) { lines.push("X " + k + " :: mount터짐 " + e.message); bad++; continue; }
    const w = [];
    const titles = stage.querySelectorAll(".viz-title").length;
    if (titles !== p.blocks.length + 1) w.push("제목" + titles + "/" + (p.blocks.length + 1));
    let empt = 0;
    stage.querySelectorAll(".viz-block").forEach((b, i) => { if (i < p.blocks.length && b.children.length < 2) empt++; });
    if (empt) w.push("그림없음x" + empt);
    if (!p.blocks.length) w.push("블록0");
    const names = p.blocks.map((b) => b.name);
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    if (dup.length) w.push("이름겹침:" + [...new Set(dup)].join("/"));
    const T = r.timeline, picks = new Set();
    for (let q = 1; q <= 9; q++) picks.add(Math.floor((T.length - 1) * q / 10));
    for (let t = 0; t < T.length; t++) if (T[t].depth > 0) { picks.add(t); if (picks.size > 20) break; }
    let blank = 0, err = "";
    for (const t of picks) {
      try { Viz.update(T[t], t > 0 ? T[t - 1] : null, t); }
      catch (e) { err = "update터짐:" + e.message; break; }
      if (!document.querySelector(".what").textContent.trim()) blank++;
    }
    if (err) w.push(err);
    if (blank) w.push("서술빔x" + blank);
    // 가로로 삐져나가면 코드 창까지 같이 밀린다.
    // 단, 창 자체가 좁으면(브라우저 패널이 접혔을 때) 무엇을 그려도 넘치므로
    // 그때는 이 검사를 건너뛴다 — 안 그러면 전 케이스가 똑같이 실패로 나온다.
    if (stage.clientWidth >= 420) {
      let widest = 0;
      stage.querySelectorAll(".viz-block").forEach((b2) => {
        widest = Math.max(widest, b2.scrollWidth - b2.clientWidth);
      });
      const hs = stage.scrollWidth - stage.clientWidth;
      // 블록 안에서만 스크롤되는 건 괜찮다(그러라고 만든 것). 페이지가 밀리면 안 된다.
      if (hs > 4) w.push("가로넘침" + hs + "px");
    }
    // 칸·인덱스·포인터 세 줄이 세로로 맞는지 (KMP 패턴을 밀 때 어긋났다)
    let skew = 0;
    stage.querySelectorAll(".chars-wrap").forEach((wr) => {
      const cs = [...wr.querySelectorAll(".cell")].map((e) => e.getBoundingClientRect().left);
      wr.querySelectorAll(".ptrs").forEach((pr) => {
        [...pr.children].forEach((e, i2) => {
          if (i2 < cs.length) skew = Math.max(skew, Math.abs(cs[i2] - e.getBoundingClientRect().left));
        });
      });
    });
    if (skew > 2) w.push("세로어긋남" + skew.toFixed(0) + "px");
    // 설명 띠(sticky)가 첫 블록 제목을 덮으면 안 된다. 실제로 덮고 있었다.
    // 단 **맨 위로 올라와 있을 때만** 본다. 스크롤을 내리면 sticky 띠가 내용을
    // 덮는 건 당연한 일이라, 그걸 흠으로 세면 자동 스크롤이 될 때마다 거짓 경보가 뜬다.
    const whatEl = stage.querySelector(".what");
    const t0 = stage.querySelector(".viz-title");
    if (whatEl && t0 && stage.clientWidth >= 420 && stage.scrollTop === 0) {
      const wb = whatEl.getBoundingClientRect(), tb = t0.getBoundingClientRect();
      if (tb.top < wb.bottom - 1 && tb.bottom > wb.top + 1) w.push("제목가림");
    }
    if (w.length) bad++;
    lines.push((w.length ? "X " : "  ") + k.padEnd(12) + " " +
      p.blocks.map((b) => b.name + "[" + b.kind + (b.role ? ":" + b.role : "") + "]").join(" ") +
      (w.length ? "   << " + w.join(",") : ""));
  }
  return "문제 " + bad + "개 / " + Object.keys(SET).length + "\n" + lines.join("\n");
};
"sweep ready"
