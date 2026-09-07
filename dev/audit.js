/* 품질 감사 — "터지지 않는가"가 아니라 "잘 읽히는가"를 잰다.
 *
 * 회귀 검사(sweep)는 그림이 나오는지만 본다. 여기는 그 그림이 **쓸모 있는지**를 잰다.
 * 잴 수 있는 것만 잰다. 재는 잣대가 없으면 "좋아졌다"는 말은 느낌일 뿐이다.
 *
 *   블록수    그림이 여덟 개면 어느 걸 봐야 할지 모른다
 *   무설명    이름만 있고 주석도 역할도 없는 블록 (뭐 하는 값인지 모른다)
 *   안변함    재생 내내 가만히 있는 블록 (자리만 차지한다)
 *   높이      한 화면에 안 들어오면 스크롤하며 봐야 한다
 *   맹탕서술  "N줄 · <그 줄 원문>" 뿐인 프레임 비율 (바뀐 게 없어 할 말이 없었다)
 *   변수      변수 상자에 남은 스칼라 개수
 */
window.AUDIT = (SETS) => {
  const stage = document.getElementById("stage");
  const rows = [];
  for (const SET of SETS) {
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
      } catch (e) { continue; }
      if (r.error || !r.timeline.length) continue;
      const p = Viz.analyze(r.timeline, src);
      Viz.mount(stage, p);
      const real = p.blocks.filter((b) => b.kind !== "series");
      // 제목이 스스로 뭔지 말하는 종류(스택·힙·구간·트라이…)는 무설명이 아니다.
      // 이름만 덩그러니 있는 건 막대·표·글자칸 셋뿐이다.
      const bare = ["array", "grid", "chars"];
      const noWord = real.filter((b) => !b.note && !b.role && bare.includes(b.kind));
      // 안 변하는 것 자체는 흠이 아니다 (문제가 준 데이터가 그렇다).
      // 문제는 **안 변하는데 뭔지도 안 알려주는** 블록이다. 그것만 센다.
      const still = real.filter((b) => b.changes === 0 && !b.note && !b.role &&
                                       bare.includes(b.kind));
      let flat = 0;
      const T = r.timeline;
      const srcLines = src.split("\n").map((l) => l.trim());
      const picks = [];
      for (let q = 1; q <= 12; q++) picks.push(Math.floor((T.length - 1) * q / 13));
      for (const t of picks) {
        Viz.update(T[t], t > 0 ? T[t - 1] : null, t);
        const w = document.querySelector(".what");
        // 맹탕 = 소스 원문을 그대로 되풀이한 줄. 값을 대입했거나(count["fox"])
        // 조건 결과를 붙였으면(→ 거짓) 코드 창에 없는 걸 알려준 것이므로 맹탕이 아니다.
        const said = (w ? w.textContent : "").split("·").slice(1).join("·").trim();
        if (said && srcLines.includes(said)) flat++;
      }
      rows.push({
        name: k,
        blocks: real.length,
        noWord: noWord.length,
        still: still.length,
        height: Math.round(stage.scrollHeight),
        flat: Math.round((flat / picks.length) * 100),
        scalars: (p.scalars || []).length,
        names: real.map((b) => b.name + (b.note ? "*" : b.role ? "+" : "")).join(" "),
        noWordNames: noWord.map((b) => b.name + "[" + b.kind + "]"),
      });
    }
  }
  return rows;
};

/* 설명이 안 붙은 블록만 뽑아 본다. 무엇을 못 붙였는지 알아야 고칠 수 있다. */
window.NOWORD = (SETS) => {
  const rows = AUDIT(SETS);
  const out = [];
  for (const r of rows) {
    if (!r.noWordNames || !r.noWordNames.length) continue;
    out.push(r.name.padEnd(14) + r.noWordNames.join(", "));
  }
  return "설명 없는 블록 " + rows.reduce((a2, r) => a2 + r.noWord, 0) + "개\n" + out.join("\n");
};

window.AUDIT_REPORT = (SETS) => {
  const rows = AUDIT(SETS);
  const num = (f) => rows.map(f).sort((a, b) => a - b);
  const med = (a) => a[Math.floor(a.length / 2)];
  const out = [];
  out.push("전체 " + rows.length + "개");
  out.push("블록수  중앙값 " + med(num((r) => r.blocks)) + "  최대 " + Math.max(...rows.map((r) => r.blocks)));
  out.push("높이    중앙값 " + med(num((r) => r.height)) + "px  최대 " + Math.max(...rows.map((r) => r.height)) + "px");
  out.push("무설명  총 " + rows.reduce((a, r) => a + r.noWord, 0) + "개 블록");
  out.push("안변함  총 " + rows.reduce((a, r) => a + r.still, 0) + "개 블록");
  out.push("맹탕서술 중앙값 " + med(num((r) => r.flat)) + "%");
  const worst = (label, f, n) => {
    const top = rows.slice().sort((a, b) => f(b) - f(a)).slice(0, n);
    out.push("\n[" + label + "]");
    for (const r of top) {
      out.push("  " + r.name.padEnd(14) + " 블록" + r.blocks + " 무설명" + r.noWord +
               " 안변함" + r.still + " 높이" + r.height + " 맹탕" + r.flat + "% 변수" + r.scalars +
               "  " + r.names);
    }
  };
  worst("블록이 많은 코드", (r) => r.blocks, 8);
  worst("설명 없는 블록이 많은 코드", (r) => r.noWord, 8);
  worst("화면이 긴 코드", (r) => r.height, 6);
  worst("맹탕 서술이 많은 코드", (r) => r.flat, 6);
  return out.join("\n");
};
"audit ready"
