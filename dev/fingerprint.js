/* 리팩터 전후 대조용 지문.
 * 예제마다 프레임 다섯 군데를 그린 뒤 무대 DOM 전체를 해시한다.
 * 동작을 안 바꿨다면 해시가 한 글자도 안 달라야 한다.
 * (문법 통과나 "문제 0개"는 동작이 같다는 근거가 못 된다) */
window.FINGERPRINT = (SETS) => {
  const stage = document.getElementById("stage");
  const h = (s) => {
    let x = 5381;
    for (let i = 0; i < s.length; i++) x = ((x * 33) ^ s.charCodeAt(i)) >>> 0;
    return x.toString(16).padStart(8, "0");
  };
  const out = [];
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
      } catch (e) { out.push(k + " 터짐"); continue; }
      if (r.error || !r.timeline.length) { out.push(k + " 실패"); continue; }
      let p;
      try { p = Viz.analyze(r.timeline, src); Viz.mount(stage, p); }
      catch (e) { out.push(k + " mount:" + e.message); continue; }
      const parts = [];
      for (let q = 1; q <= 5; q++) {
        const t = Math.floor((r.timeline.length - 1) * q / 6);
        try { Viz.update(r.timeline[t], t > 0 ? r.timeline[t - 1] : null, t); }
        catch (e) { parts.push("ERR:" + e.message); break; }
        parts.push(h(stage.innerHTML));
      }
      out.push(k + " " + parts.join(" "));
    }
  }
  return out.join("\n");
};

/* 저장해 둔 지문과 대조한다. 리팩터 전후로 한 줄도 안 달라야 한다.
 * 문법 통과나 "문제 0개"는 동작이 같다는 근거가 못 된다. 이게 근거다. */
window.COMPARE = async (SETS) => {
  const res = await fetch("/dev/baseline.txt", { cache: "no-store" });
  const want = (await res.text()).trim().split("\n");
  const got = FINGERPRINT(SETS).split("\n");
  const diff = [];
  const wm = new Map(want.map((l) => [l.split(" ")[0], l]));
  for (const l of got) {
    const k = l.split(" ")[0];
    if (!wm.has(k)) { diff.push("새 예제 " + k); continue; }
    if (wm.get(k) !== l) diff.push("달라짐 " + k + " | 전 " + wm.get(k) + " | 후 " + l);
    wm.delete(k);
  }
  for (const k of wm.keys()) diff.push("사라진 예제 " + k);
  return diff.length ? diff.join("\n") : "지문 " + got.length + "개 전부 같음";
};
/* 지금 지문을 새 베이스라인으로 굳힌다.
 * **동작을 일부러 바꿨을 때만** 부를 것. 안 그러면 회귀를 스스로 덮어쓰는 셈이다. */
window.SAVE_BASELINE = async (SETS) => {
  const body = FINGERPRINT(SETS) + "\n";
  const r = await fetch("/dev/baseline.txt", { method: "POST", body });
  return await r.text();
};
"fingerprint ready"
