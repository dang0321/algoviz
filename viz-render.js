/* algoviz — 화면에 만들고, 프레임마다 갱신한다.
 *
 * 절대 깨면 안 되는 규칙: **DOM 을 매 프레임 새로 만들지 않는다.**
 * 속성만 바꿔야 CSS 트랜지션이 살아서 막대가 "스르륵" 움직인다.
 * 새로 만들면 뚝뚝 끊기고, 그러면 이 도구의 존재 이유가 사라진다.
 */
const VizRender = (() => {
  const { isNum, isNumList, isNumGrid, adjOf, edgeKey, charCells, visitedNodes,
          trieNodes, objLabel, deref, argText, fmt, resolveArgs, dictKey } = VizUtil;
  const { el, svg, treeOf, treePositions, dagLayers, layerPositions,
          circlePositions } = VizLayout;
  let plan = null, root = null, nodes = null;

  /* ---------- 방금 무슨 일이 있었나 ----------
   * 그림은 "지금 상태"를 보여주지만 "방금 뭐가 어디서 바뀌었는지"는 안 보여준다.
   * 코드 줄과 그림 사이가 비어 있으면, 예쁘긴 한데 읽히지가 않는다.
   * 직전 프레임과 비교해 바뀐 것 하나를 골라 한 줄로 쓴다.
   *
   * 여러 개가 동시에 바뀌면 구조(배열·표)를 스칼라보다 먼저 고른다.
   * 사람이 눈으로 좇는 것도 그쪽이다. */
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // 몇 번째 줄의 원문. 아무것도 안 바뀐 프레임에서 "지금 뭘 보고 있나"를 쓰려고 둔다.
  let srcCache = null, srcCacheFor = null;
  function srcLine(n) {
    const src = (plan && plan.source) || "";
    if (srcCacheFor !== src) { srcCache = src.split("\n"); srcCacheFor = src; }
    return srcCache[n - 1] || "";
  }

  function idxLabel(i) { return "[" + i + "]"; }

  function describeArray(name, before, now) {
    if (!Array.isArray(before) || !Array.isArray(now)) return null;
    if (before.length !== now.length) {
      if (now.length === before.length + 1) {
        const tailNew = eq(before, now.slice(0, before.length));
        return { text: name + " 에 " + fmt(now[now.length - 1]) + " 넣음" +
                       (tailNew ? "" : " (앞쪽)"), owner: name };
      }
      if (now.length === before.length - 1) {
        const fromEnd = eq(now, before.slice(0, now.length));
        return { text: name + " 에서 " + fmt(before[fromEnd ? before.length - 1 : 0]) +
                       " 꺼냄" + (fromEnd ? " (뒤)" : " (앞)"), owner: name };
      }
      return { text: name + " 길이 " + before.length + " → " + now.length, owner: name };
    }
    const diff = [];
    for (let i = 0; i < now.length && diff.length <= 2; i++) {
      if (!eq(before[i], now[i])) diff.push(i);
    }
    if (!diff.length) return null;
    if (diff.length === 2) {
      const [x, y] = diff;
      if (eq(before[x], now[y]) && eq(before[y], now[x])) {
        return { text: name + idxLabel(x) + " ↔ " + name + idxLabel(y) +
                       "  (" + fmt(now[y]) + ", " + fmt(now[x]) + " 자리 바꿈)", owner: name };
      }
    }
    const i = diff[0];
    return { text: name + idxLabel(i) + "  " + fmt(before[i]) + " → " + fmt(now[i]),
             owner: name };
  }

  function describeGrid(name, before, now) {
    if (!Array.isArray(before) || !Array.isArray(now)) return null;
    if (before.length !== now.length) {
      // 행이 하나 늘거나 줄었으면 "새로 만듦"이 아니라 넣거나 뺀 것이다.
      // 우선순위 큐에 (거리, 노드) 를 밀어넣는 장면이 통째로 "새로 만듦"으로 나왔다.
      // 힙은 넣은 걸 위로 올려붙이므로 맨 끝만 봐서는 안 되고, 무엇이 늘고
      // 무엇이 줄었는지를 개수로 대조해야 한다.
      const bag = new Map();
      const key = (r) => JSON.stringify(r);
      for (const r of before) bag.set(key(r), (bag.get(key(r)) || 0) + 1);
      const added = [];
      for (const r of now) {
        const k = key(r);
        if (bag.get(k)) bag.set(k, bag.get(k) - 1); else added.push(r);
      }
      const gone = [];
      for (const [k, n] of bag) for (let i = 0; i < n; i++) gone.push(JSON.parse(k));
      const asText = (r) => Array.isArray(r) ? "(" + r.map(fmt).join(", ") + ")" : fmt(r);
      if (now.length === before.length + 1 && added.length === 1 && !gone.length)
        return { text: name + " 에 " + asText(added[0]) + " 넣음", owner: name };
      if (now.length === before.length - 1 && gone.length === 1 && !added.length)
        return { text: name + " 에서 " + asText(gone[0]) + " 꺼냄", owner: name };
      return { text: name + " 줄 수 " + before.length + " → " + now.length, owner: name };
    }
    for (let r = 0; r < now.length; r++) {
      if (!Array.isArray(before[r]) || !Array.isArray(now[r])) continue;
      for (let c = 0; c < now[r].length; c++) {
        if (!eq(before[r][c], now[r][c])) {
          return { text: name + "[" + r + "][" + c + "]  " +
                         fmt(before[r][c]) + " → " + fmt(now[r][c]), owner: name };
        }
      }
    }
    return null;
  }

  function describeChange(frame, prev) {
    if (!prev) return { text: "시작", owner: null };
    if (frame.event === "call") {
      return { text: frame.func + "(" + argText(resolveArgs(frame.args || frame.vars, frame.objs)) +
                     ") 호출", owner: null };
    }
    if (frame.event === "return") {
      return { text: frame.func + " 끝  → " + fmt(deref(frame.ret, frame.objs)) + " 반환",
               owner: null };
    }
    const V = frame.vars, P = prev.vars;
    const structural = [], scalar = [];
    for (const k of Object.keys(V)) {
      const b = V[k], a = P[k];
      if (a === undefined) {
        if (Array.isArray(b)) {
          const grid = b.length && Array.isArray(b[0]);
          structural.push({ text: k + " 만듦 (" + b.length + (grid ? "행" : "칸") + ")", owner: k });
          continue;
        }
        if (b && typeof b === "object") continue;
        scalar.push({ text: k + " = " + fmt(b), owner: k });
        continue;
      }
      if (eq(a, b)) continue;
      if (Array.isArray(b) && Array.isArray(a)) {
        const grid = b.length && Array.isArray(b[0]);
        const d = grid ? describeGrid(k, a, b) : describeArray(k, a, b);
        if (d) structural.push(d);
        continue;
      }
      if (b && typeof b === "object" && Array.isArray(b.__set__)) {
        const was = new Set((a && a.__set__) || []);
        const added = b.__set__.filter((x) => !was.has(x));
        structural.push({ text: added.length
          ? k + " 에 " + added.map(fmt).join(", ") + " 추가"
          : k + " 에서 뺌", owner: k });
        continue;
      }
      if (b && typeof b === "object" && Array.isArray(b.__dict__)) {
        const was = {};
        for (const [kk, vv] of ((a && a.__dict__) || [])) was[String(kk)] = vv;
        for (const [kk, vv] of b.__dict__) {
          const key = String(kk);
          if (!eq(was[key], vv)) {
            structural.push({ text: k + "[" + fmt(kk) + "]  " +
              (was[key] === undefined ? "새로 " + fmt(vv) : fmt(was[key]) + " → " + fmt(vv)),
              owner: k });
            break;
          }
        }
        continue;
      }
      if (typeof b === "string" && typeof a === "string") {
        structural.push({ text: k + "  " + fmt(a) + " → " + fmt(b), owner: k });
        continue;
      }
      scalar.push({ text: k + "  " + fmt(deref(a, prev.objs)) + " → " +
                          fmt(deref(b, frame.objs)), owner: k });
    }
    if (structural.length) {
      // 여러 개가 같이 바뀌면 앞의 것 하나만 쓰고 나머지는 개수만 알린다
      const more = structural.length - 1;
      return { text: structural[0].text + (more ? "   (외 " + more + "개)" : ""),
               owner: structural[0].owner };
    }
    if (scalar.length) {
      const more = scalar.length - 1;
      return { text: scalar[0].text + (more ? "   (외 " + more + "개)" : ""),
               owner: scalar[0].owner };
    }
    return { text: "", owner: null };
  }

  function titleOf(b, demote) {
    const tag = (t) => " <span>· " + t + "</span>";
    // 사용자가 선언 옆에 써 둔 말이 있으면 그게 이 그림의 이름이다.
    // 내가 유추한 역할("채우는 표")보다 언제나 정확하므로 그쪽을 덮는다.
    // 어떤 그림으로 그렸는지(0/1 지도 등)는 판정 검증용이라 늘 남긴다.
    const note = b.note ? ' <span class="note">· ' + b.note + "</span>" : "";
    if (b.note) demote = false;
    switch (b.kind) {
      case "series":    return "<b>값 변화</b>" + note + tag("시간에 따른 " + b.name);
      case "container": return "<b>" + b.name + "</b>" + note + tag(b.mode === "stack" ? "스택" : "큐");
      case "heap":      return "<b>" + b.name + "</b>" + note + tag(b.isMin ? "최소힙" : "최대힙");
      case "pairheap":  return "<b>" + b.name + "</b>" + note + tag("우선순위 큐 · (값, 대상)");
      case "segtree":   return "<b>" + b.name + "</b>" + note + tag(b.op + " 트리");
      case "intervals": return "<b>" + b.name + "</b>" + note + tag("구간 " + b.rows + "개");
      // 같은 화살표 그림이지만 뜻이 다르다. 유니온 파인드는 "부모"고,
      // KMP 실패함수·LCA 부모 배열은 "여기로 돌아간다"는 표시다.
      case "forest":    return "<b>" + b.name + "</b>" + note +
                               tag(b.rooted ? "가리키는 곳" : "부모 포인터");
      case "objects":   return "<b>" + b.name + "</b>" + note;
      case "flags":     return "<b>" + b.name + "</b>" + note + tag("참/거짓 " + b.len + "칸");
      case "counts":    return "<b>" + b.name + "</b>" + note + tag("세는 딕셔너리");
      case "scatter":   return "<b>" + b.name + "</b>" + note + tag("좌표 " + b.rows + "개");
      case "records":   return "<b>" + b.name + "</b>" + note +
                               tag(b.rows + "줄 · " + b.cols + "칸짜리 묶음");
      case "sequence":  return "<b>" + b.name + "</b>" + note + tag("나온 순서");
      case "pairs":     return "<b>" + b.name + "</b>" + note + tag("쌍 " + b.rows + "개");
      case "memogrid":  return "<b>" + b.name + "</b>" + note +
                               tag("메모 표 " + b.rows + "x" + b.cols + " · 키 (i, j)");
      case "setblock":  return "<b>" + b.name + "</b>" + note + tag("집합");
      case "chargrid":  return "<b>" + b.name + "</b>" + note +
                               tag(b.rows + "x" + b.cols + " 문자 격자" +
                                   (b.mark ? " · " + b.mark + " 강조" : ""));
      case "trie":      return "<b>" + b.name + "</b>" + note + tag("트리 " + b.nodes.length + "칸");
      case "stack":     return "<b>호출 스택</b>";
      case "calltree":  return "<b>호출 트리</b>" +
                               tag(b.func + " 를 " + b.nodes.length + "번 부름 · 깊이 " + b.deepest);
      default: {
        // 같은 배열·격자라도 코드가 어떻게 쓰느냐에 따라 그림이 달라진다.
        // 무슨 그림으로 그렸는지 제목에 밝혀야 사용자가 판정을 검증할 수 있다.
        const how = b.binary ? tag(b.kind === "grid" ? "0/1 지도" : "0/1 배열")
                  : (b.kind === "array" && b.len > 40) ? tag(b.len + "칸")
                  : "";
        // 역할을 알아냈으면 그걸 쓴다. "안 변함"은 사실이긴 해도 쓸모가 없다.
        // 주석이 있으면 역할 꼬리표는 안 붙인다. 같은 자리를 두 번 설명하는
        // 셈이고, 제목만 길어진다. 사용자가 쓴 말이 이긴다.
        // "안 변함"은 막대·표·글자칸에서만 뜻이 있다. 그림 자체가 무엇인지
        // 말해 주는 종류(그래프 등)에 붙이면 제목만 길어지고 알려주는 건 없다.
        const bare = ["array", "grid", "chars"].includes(b.kind);
        const why = b.note ? ""
                  : b.role ? tag(b.role)
                  : (bare && demote && b.changes === 0 ? tag("안 변함") : "");
        return "<b>" + b.name + "</b>" + note + how + why;
      }
    }
  }

  function mountBody(block, b, demote) {
    switch (b.kind) {
      case "intervals": {
        const wrap = el("div", "iv-wrap", block);
        nodes.intervals[b.name] = { block, wrap, spec: b, rows: -1, bars: [] };
        return;
      }
      case "container": {
        const head = el("div", "cont-head", block);
        head.textContent = b.mode === "stack"
          ? "뒤에서 넣고 뒤에서 뺀다" : "뒤로 넣고 앞에서 뺀다";
        const row = el("div", "cont-row", block);
        nodes.containers[b.name] = { block, row, spec: b, len: -1, cells: [] };
        return;
      }
      case "objects": return mountObjects(block, b);
      case "chargrid": {
        const table = el("table", "grid chargrid", block);
        nodes.charGrids[b.name] = { block, table, cells: [], rows: -1, cols: -1, spec: b };
        return;
      }
      case "flags": {
        const wrap = el("div", "flags-wrap", block);
        wrap.style.maxWidth = Math.min(560, b.len * 26) + "px";
        const row = el("div", "flag-row", wrap);
        const ptrRow = el("div", "ptrs", wrap);
        nodes.flags[b.name] = { block, row, ptrRow, cells: [], len: -1 };
        return;
      }
      case "counts": {
        const wrap = el("div", "cnt-wrap", block);
        const rows = {};
        for (const key of b.keys) {
          const line = el("div", "cnt-line", wrap);
          el("span", "cnt-key", line).textContent = key;
          const track = el("span", "cnt-track", line);
          const bar = el("span", "cnt-bar", track);
          const val = el("span", "cnt-val", line);
          rows[key] = { line, bar, val };
        }
        nodes.counts[b.name] = { block, rows, spec: b };
        return;
      }
      case "memogrid": {
        // 첫 줄·첫 칸은 키(i, j) 눈금이다. 어느 칸이 계산됐는지를 좌표로
        // 읽을 수 있어야 "왜 이 순서로 채워지나"를 따라갈 수 있다.
        const table = el("table", "grid memo", block);
        const head = el("tr", null, table);
        el("th", "memo-corner", head).textContent = "i\j";
        for (let c = 0; c < b.cols; c++) el("th", null, head).textContent = b.c0 + c;
        const cells = [];
        for (let r = 0; r < b.rows; r++) {
          const tr = el("tr", null, table);
          el("th", null, tr).textContent = b.r0 + r;
          const row = [];
          for (let c = 0; c < b.cols; c++) row.push(el("td", "empty", tr));
          cells.push(row);
        }
        nodes.memoGrids[b.name] = { block, cells, spec: b };
        return;
      }
      case "pairheap": {
        const head = el("div", "cont-head", block);
        head.textContent = "맨 앞이 다음에 꺼낼 것";
        const row = el("div", "cont-row", block);
        nodes.pairHeaps[b.name] = { block, row, len: -1, cells: [] };
        return;
      }
      case "scatter": {
        const W = 460, H = 280, PAD = 26;
        const s = svg("svg", { class: "gviz scatter", viewBox: "0 0 " + W + " " + H }, block);
        svg("line", { class: "axis", x1: PAD, y1: H - PAD, x2: W - 6, y2: H - PAD }, s);
        svg("line", { class: "axis", x1: PAD, y1: 6, x2: PAD, y2: H - PAD }, s);
        // 눈금은 양 끝만. 촘촘히 찍으면 점보다 눈금이 눈에 띈다.
        const t = (x, y, txt, cls) => {
          svg("text", { class: cls, x, y }, s).textContent = txt;
        };
        t(PAD, H - PAD + 14, b.xlo, "sxlab");
        t(W - 10, H - PAD + 14, b.xhi, "sxlab");
        t(PAD - 5, H - PAD, b.ylo, "sylab");
        t(PAD - 5, 12, b.yhi, "sylab");
        const gDots = svg("g", {}, s);
        nodes.scatters[b.name] = { block, svg: s, gDots, dots: [], len: -1, spec: b,
                                   W, H, PAD };
        return;
      }
      case "records": {
        const table = el("table", "grid records", block);
        const cells = [];
        for (let r = 0; r < b.rows; r++) {
          const tr = el("tr", null, table);
          el("th", null, tr).textContent = r;
          const row = [];
          for (let c = 0; c < b.cols; c++) row.push(el("td", null, tr));
          cells.push({ tr, row });
        }
        nodes.records[b.name] = { block, table, cells, spec: b };
        return;
      }
      case "sequence": {
        // 값이 이름표라 높이에 뜻이 없다. 순서대로 늘어놓고 방금 들어온 걸 짚는다.
        const head = el("div", "cont-head", block);
        head.textContent = "왼쪽부터 나온 차례";
        const row = el("div", "cont-row", block);
        nodes.sequences[b.name] = { block, row, len: -1, cells: [] };
        return;
      }
      case "pairs": {
        // 쌍이 쌓이는 자리. 값의 크기가 아니라 "무엇이 언제 들어왔나"가 전부다.
        const head2 = el("div", "cont-head", block);
        head2.textContent = "왼쪽부터 쌓인 차례";
        const row2 = el("div", "cont-row", block);
        nodes.pairs[b.name] = { block, row: row2, len: -1, cells: [] };
        return;
      }
      case "setblock": {
        const row = el("div", "set-row", block);
        nodes.sets[b.name] = { block, row, seen: new Set() };
        return;
      }
      case "trie":    return mountTrie(block, b);
      case "graph":   return mountGraph(block, b);
      case "forest":  return mountForest(block, b);
      case "series":  return mountSeries(block, b);
      case "heap": {
        const wrap = el("div", "heap-wrap", block);
        nodes.heaps[b.name] = { block, wrap, len: -1, cells: [], svg: null };
        return;
      }
      case "segtree": {
        const wrap = el("div", "heap-wrap", block);
        nodes.segtrees[b.name] = { block, wrap, len: -1, cells: [], circles: [] };
        return;
      }
      case "stack": {
        nodes.stack = { block, list: el("div", "callstack", block), spec: b };
        return;
      }
      case "calltree": return mountCallTree(block, b);
      case "chars": {
        // 칸·인덱스·포인터 세 줄이 같은 폭 안에 있어야 세로로 안 어긋난다.
        // 칸에만 max-width 를 주면 인덱스 줄이 화면 끝까지 퍼져서 칩이 딴 데 붙는다.
        const wrap = el("div", "chars-wrap", block);
        // 긴 문자열은 칸을 좁힌다. 한 칸 18px 를 고집하면 50글자가 900px 를 먹어서
        // 화면 밖으로 삐져나간다 (막대의 dense 와 같은 이유).
        if (b.len > 30) wrap.classList.add("dense");
        // 패턴은 텍스트와 같은 칸 폭을 써야 겹쳐 놨을 때 세로가 맞는다.
        const al = b.alignTo;
        wrap.style.maxWidth = (al ? al.hostLen * al.cw
                                  : b.len * Math.max(46, 14 + b.elem * 9)) + "px";
        const row = el("div", "cells", wrap);
        if (al) {
          row.classList.add("aligned");
          row.style.width = (b.len * al.cw) + "px";
        }
        const idxRow = el("div", "ptrs", wrap);
        const ptrRow = el("div", "ptrs", wrap);
        if (al) {
          // 밀어 놓은 패턴은 칸 줄만 폭을 정해 주면 인덱스·포인터 줄이
          // 남는 자리까지 퍼져서 한 칸이 더 넓어진다. 세 줄 다 같은 폭이어야 한다.
          idxRow.style.width = ptrRow.style.width = (b.len * al.cw) + "px";
        }
        nodes.chars[b.name] = { block, row, idxRow, ptrRow, cells: [], len: -1, spec: b };
        return;
      }
      case "range": {
        const line = el("div", "nline", block);
        const track = el("div", "nline-track", line);
        el("span", "nline-end left", track).textContent = b.gmin;
        el("span", "nline-end right", track).textContent = b.gmax;
        const band = el("div", "nline-band", line);
        const loM = el("div", "nline-mark lo", line);
        const hiM = el("div", "nline-mark hi", line);
        const midM = b.mid ? el("div", "nline-mark mid", line) : null;
        nodes.ranges[b.lo + "|" + b.hi] = { block, band, loM, hiM, midM, spec: b };
        return;
      }
      case "array": {
        const bars = el("div", "bars", block);
        // 입력 배열은 낮게. 셋째 막대부터도 낮게 (한 화면에 다 들어오게).
        if ((demote && b.changes === 0) || b.rank2 >= 2) bars.classList.add("small");
        if (b.binary) bars.classList.add("binary");                   // 켜짐/꺼짐만 본다
        if (b.len > 40) bars.classList.add("dense");                  // 라벨 떼고 얇게
        const idxRow = el("div", "ptrs", block);
        const ptrRow = el("div", "ptrs", block);
        nodes.arrays[b.name] = { block, bars, idxRow, ptrRow, cols: [], len: -1, spec: b };
        return;
      }
      default: {
        const table = el("table", "grid", block);
        nodes.grids[b.name] = { block, table, cells: [], rows: -1, cols: -1 };
      }
    }
  }

  function mount(stageEl, p) {
    plan = p;
    if (root !== stageEl) watchScroll(stageEl);
    root = stageEl;
    root.innerHTML = "";
    nodes = { callTree: null, scatters: {}, records: {}, sequences: {}, pairs: {}, arrays: {}, grids: {}, ranges: {}, graphs: {}, chars: {}, forests: {}, heaps: {}, objects: null, containers: {}, intervals: {}, trie: null,
      flags: {}, counts: {}, memoGrids: {}, pairHeaps: {}, sets: {}, charGrids: {}, segtrees: {}, series: [], stack: null };

    // blocks 는 "많이 변한 순"이라, 화면 맨 위에 그 코드의 주인공이 온다.
    // 블록이 하나뿐이면 그게 주인공이다. 안 변한다고 작게 그리면 안 된다.
    const stepBar = el("div", "step", root);
    const whatBar = el("div", "what", root);
    const demote = plan.blocks.length > 1;
    const blockOf = {};
    // 막대 블록이 넷씩 되면 다 제 키로 그려봐야 한 화면에 안 들어온다
    // (병합정렬이 1933px 이었다). 앞의 둘만 제 키로 두고 나머지는 낮게 그린다.
    // 순서는 이미 "변화량 순"이라 앞의 둘이 그 코드의 주인공이다.
    let barsSoFar = 0;
    for (const b of plan.blocks) {
      const block = el("div", "viz-block", root);
      blockOf[b.name] = block;
      if (b.kind === "array") b.rank2 = barsSoFar++;
      // 제목과 내용을 따로 만든다. 예전엔 두 일이 한 if 체인에 섞여 있어서
      // 새 블록 종류를 넣을 때마다 어떤 블록이 제목을 통째로 못 받았다.
      el("div", "viz-title", block).innerHTML = titleOf(b, demote);
      mountBody(block, b, demote);
    }

    const sblock = el("div", "viz-block", root);
    el("div", "viz-title", sblock).textContent = "변수";
    nodes.scalarBox = el("div", "scalars", sblock);
    nodes.scalarBlock = sblock;
    nodes.what = whatBar;
    nodes.blockOf = blockOf;
    nodes.step = stepBar;
  }

  /* 호출 트리를 한 번만 만든다. 프레임마다 다시 그리면 트랜지션이 죽는다.
   * 자리는 전체 실행의 합집합으로 잡고, 프레임마다 상태(아직/진행중/끝)만 바꾼다. */
  function mountCallTree(block, b) {
    const NW = Math.max(34, Math.min(64, Math.floor(520 / Math.max(1, b.cols))));
    const W = Math.max(320, (b.cols + 1) * NW);
    const RH = 46;
    const H = (b.deepest + 1) * RH + 10;
    const s = svg("svg", { class: "gviz calltree", viewBox: "0 0 " + W + " " + H }, block);
    const gEdges = svg("g", {}, s);
    const gNodes = svg("g", {}, s);
    const xy = (n) => ({ x: (n.col + 1) * (W / (b.cols + 1)), y: (n.depth - 0.5) * RH + 20 });

    const items = [];
    for (const n of b.nodes) {
      const p = xy(n);
      let line = null;
      if (n.parent >= 0) {
        const q = xy(b.nodes[n.parent]);
        line = svg("line", { class: "cedge", x1: q.x, y1: q.y + 9, x2: p.x, y2: p.y - 9 }, gEdges);
      }
      const g = svg("g", { class: "cnode" }, gNodes);
      svg("rect", { class: "cbox", x: p.x - NW / 2 + 3, y: p.y - 10, width: NW - 6, height: 20, rx: 4 }, g);
      const label = Object.values(n.args || {}).map(fmt).join(", ");
      svg("text", { class: "clabel", x: p.x, y: p.y + 4 }, g).textContent = label || n.func;
      const ret = svg("text", { class: "cret", x: p.x, y: p.y + 19 }, g);
      items.push({ spec: n, g, line, ret });
    }
    nodes.callTree = { block, items, spec: b };
  }

  function mountGraph(block, g) {
    // 배치는 세 가지. 트리면 계층, 방향 있고 순환 없으면 층, 나머지는 원형.
    // 위상정렬을 원형으로 그리면 "무엇이 먼저인가"가 아예 안 보인다.
    const t = treeOf(g);
    // 간선 리스트에서 만든 그래프(크루스칼)는 (a, b) 의 방향이 아무 뜻이 없다.
    // 층으로 눕히면 "a 가 b 보다 먼저"라는, 코드에 없는 말을 지어내게 된다.
    const dag = (t || g.fromEdges) ? null : dagLayers(g);
    const W = 460;
    const H = t ? Math.min(320, 90 + 62 * Math.max(...Object.values(t.depth)))
            : dag ? Math.min(340, 90 + 62 * dag.depth)
            : 300;
    const pos = t ? treePositions(t, W, H)
              : dag ? layerPositions(dag, g, W, H)
              : circlePositions(g, W, H);
    const title = block.querySelector(".viz-title");
    if (title) {
      title.innerHTML += t
        ? ' <span>· 트리 (뿌리 ' + t.root + ')</span>'
        : dag
        ? ' <span>· 앞뒤 관계 ' + (dag.depth + 1) + '단</span>'
        : ' <span>· 노드 ' + g.nodes.length + '개</span>';
    }

    const s = svg("svg", { class: "gviz", viewBox: "0 0 " + W + " " + H }, block);
    const gEdges = svg("g", {}, s);
    const gNodes = svg("g", {}, s);

    const lines = {};
    const drawn = new Set();
    for (const [a, b] of g.edges) {
      const key = edgeKey(a, b);
      if (drawn.has(key)) continue;
      drawn.add(key);
      lines[key] = svg("line", {
        class: "gedge", x1: pos[a].x, y1: pos[a].y, x2: pos[b].x, y2: pos[b].y,
      }, gEdges);
      // 가중치가 있으면 간선 한가운데에 숫자를 적는다. 없으면 안 그린다.
      const w = g.weights && g.weights[key];
      if (w !== undefined) {
        const t = svg("text", {
          class: "gweight",
          x: (pos[a].x + pos[b].x) / 2,
          y: (pos[a].y + pos[b].y) / 2 - 3,
        }, gEdges);
        t.textContent = w;
      }
    }

    const circles = {}, labels = {}, chips = {};
    for (const id of g.nodes) {
      const p = pos[id];
      // 노드 이름이 "서울" 처럼 글자면 15px 동그라미에 안 들어간다
      const rr = Math.min(30, Math.max(15, 7 + String(id).length * 5));
      circles[id] = svg("circle", { class: "gnode", cx: p.x, cy: p.y, r: rr }, gNodes);
      const t = svg("text", { class: "glabel", x: p.x, y: p.y + 4 }, gNodes);
      t.textContent = id;
      labels[id] = t;
      const c = svg("text", { class: "gchip", x: p.x, y: p.y - rr - 7 }, gNodes);
      chips[id] = c;
    }
    nodes.graphs[g.name] = { block, lines, circles, chips, spec: g };
  }

  /* 칸을 한 줄로 놓고 i -> parent[i] 를 위쪽 곡선으로 그린다.
   * 칸 위치는 고정이고 곡선만 프레임마다 바뀐다 — DOM 을 새로 만들지 않으므로
   * 유니온이 일어날 때 화살이 스르륵 옮겨 붙는다. */
  /* 연결리스트면 가로 한 줄, 트리면 계층, 나머지는 원형.
   * 한 노드가 자식을 하나만 갖는 구조(= 연결리스트)를 세로로 그리면
   * 화면만 길어지고 "줄줄이 이어진다"는 느낌이 안 산다. */
  function mountTrie(block, spec) {
    const g = { nodes: spec.nodes, edges: spec.edges.map(([a, b]) => [a, b]) };
    const t = treeOf(g);
    const W = 480;
    const H = t ? Math.min(340, 90 + 62 * Math.max(...Object.values(t.depth))) : 300;
    const pos = t ? treePositions(t, W, H) : circlePositions(g, W, H);

    const sv = svg("svg", { class: "oviz", viewBox: "0 0 " + W + " " + H }, block);
    const gE = svg("g", {}, sv), gN = svg("g", {}, sv);
    const lines = {};
    for (const [a, b] of spec.edges) {
      lines[a + ">" + b] = svg("line", {
        class: "oedge", x1: pos[a].x, y1: pos[a].y, x2: pos[b].x, y2: pos[b].y,
      }, gE);
    }
    const circles = {}, labels = {};
    spec.nodes.forEach((id, i) => {
      circles[id] = svg("circle", {
        class: "tnode" + (spec.meta[i].terminal ? " term" : ""),
        cx: pos[id].x, cy: pos[id].y, r: 14,
      }, gN);
      const tx = svg("text", { class: "olabel", x: pos[id].x, y: pos[id].y + 4 }, gN);
      tx.textContent = spec.meta[i].key;
      labels[id] = tx;
    });
    nodes.trie = { block, spec, lines, circles };
  }

  function mountObjects(block, spec) {
    const g = { nodes: spec.nodes, edges: spec.edges.map(([a, b]) => [a, b]) };
    const outdeg = {};
    for (const id of g.nodes) outdeg[id] = 0;
    for (const [a] of g.edges) outdeg[a]++;
    const isChain = Math.max(0, ...Object.values(outdeg)) <= 1;

    const W = 480;
    let pos, H, mode;
    if (isChain) {
      // 들어오는 간선이 없는 데서 시작해 쭉 따라간다
      const indeg = {};
      for (const id of g.nodes) indeg[id] = 0;
      for (const [, b] of g.edges) indeg[b]++;
      const nextOf = {};
      for (const [a, b] of g.edges) nextOf[a] = b;
      let cur = g.nodes.find((id) => indeg[id] === 0);
      const order = [], seenId = new Set();
      while (cur !== undefined && !seenId.has(cur)) {
        order.push(cur); seenId.add(cur); cur = nextOf[cur];
      }
      for (const id of g.nodes) if (!seenId.has(id)) order.push(id);   // 끊긴 것들
      H = 74;
      pos = {};
      order.forEach((id, i) => {
        pos[id] = { x: ((i + 0.5) / order.length) * W, y: 34 };
      });
      mode = "연결리스트";
    } else {
      const t = treeOf(g);
      H = t ? Math.min(320, 90 + 62 * Math.max(...Object.values(t.depth))) : 300;
      pos = t ? treePositions(t, W, H) : circlePositions(g, W, H);
      mode = t ? "트리" : "객체 그래프";
    }

    const title = block.querySelector(".viz-title");
    if (title) title.innerHTML += ' <span>· ' + mode + "</span>";

    const sv = svg("svg", { class: "oviz", viewBox: "0 0 " + W + " " + H }, block);
    const gE = svg("g", {}, sv), gN = svg("g", {}, sv);
    const lines = {}, elabels = {};
    for (const [a, b, fk] of spec.edges) {
      const key = a + ">" + b;
      lines[key] = svg("line", {
        class: "oedge", x1: pos[a].x, y1: pos[a].y, x2: pos[b].x, y2: pos[b].y,
      }, gE);
      const t = svg("text", {
        class: "oefield",
        x: (pos[a].x + pos[b].x) / 2,
        y: (pos[a].y + pos[b].y) / 2 - 4,
      }, gE);
      t.textContent = fk;
      elabels[key] = t;
    }
    const circles = {}, labels = {}, chips = {};
    for (const id of g.nodes) {
      circles[id] = svg("circle", { class: "onode", cx: pos[id].x, cy: pos[id].y, r: 16 }, gN);
      labels[id] = svg("text", { class: "olabel", x: pos[id].x, y: pos[id].y + 4 }, gN);
      chips[id] = svg("text", { class: "ochip", x: pos[id].x, y: pos[id].y - 23 }, gN);
    }
    nodes.objects = { block, spec, lines, elabels, circles, labels, chips, ids: g.nodes };
  }

  function mountForest(block, spec) {
    const n = spec.len;
    const W = 480, ARC = 62, H = ARC + 46;
    const step = W / n;
    const cx = (i) => step * i + step / 2;
    const y = ARC + 16;

    const s = svg("svg", { class: "fviz", viewBox: "0 0 " + W + " " + H }, block);
    const gArcs = svg("g", {}, s);
    const gNodes = svg("g", {}, s);
    const arcs = [], circles = [], labels = [], idxs = [];
    for (let i = 0; i < n; i++) {
      arcs.push(svg("path", { class: "farc", d: "" }, gArcs));
    }
    for (let i = 0; i < n; i++) {
      circles.push(svg("circle", { class: "fnode", cx: cx(i), cy: y, r: 13 }, gNodes));
      const t = svg("text", { class: "flabel", x: cx(i), y: y + 4 }, gNodes);
      labels.push(t);
      const ix = svg("text", { class: "fidx", x: cx(i), y: y + 30 }, gNodes);
      ix.textContent = i;
      idxs.push(ix);
    }
    nodes.forests[spec.name] = { block, arcs, circles, labels, cx, y, n, arcH: ARC };
  }

  function mountSeries(block, sp) {
    const W = 460, H = 110, PAD = 6;
    const s = svg("svg", { class: "sviz", viewBox: "0 0 " + W + " " + H,
                           preserveAspectRatio: "none" }, block);
    const lo = Math.min(0, sp.lo), hi = Math.max(sp.hi, lo + 1);
    const x = (t) => (sp.n <= 1 ? 0 : (t / (sp.n - 1)) * W);
    const y = (v) => H - PAD - ((v - lo) / (hi - lo)) * (H - PAD * 2);

    for (const l of sp.lines) {
      // 값이 없는 구간(변수가 아직 없을 때)에서 선을 끊는다
      let d = "", pen = false;
      for (let t = 0; t < sp.n; t++) {
        const v = l.values[t];
        if (v === undefined) { pen = false; continue; }
        d += (pen ? "L" : "M") + x(t).toFixed(1) + " " + y(v).toFixed(1) + " ";
        pen = true;
      }
      svg("path", { class: "sline", d, stroke: l.color }, s);
    }
    const cursor = svg("line", { class: "scursor", x1: 0, y1: 0, x2: 0, y2: H }, s);
    const dots = sp.lines.map((l) =>
      svg("circle", { class: "sdot", r: 3.5, fill: l.color, cx: -10, cy: -10 }, s));

    const legend = el("div", "slegend", block);
    const vals = sp.lines.map((l) => {
      const item = el("span", "sitem", legend);
      item.innerHTML = '<i style="background:' + l.color + '"></i>' +
                       '<span class="sname">' + l.name + '</span> <b></b>';
      return item.querySelector("b");
    });
    nodes.series.push({ spec: sp, cursor, dots, vals, x, y });
  }

  function buildBars(n, arr) {
    n.bars.innerHTML = "";
    n.idxRow.innerHTML = "";
    n.cols = [];
    // 칸이 많으면 숫자 라벨과 인덱스가 서로 겹쳐서 오히려 안 읽힌다. 떼어낸다.
    const dense = arr.length > 40;
    for (let i = 0; i < arr.length; i++) {
      const col = el("div", "bar-col", n.bars);
      const val = dense ? null : el("div", "bar-val", col);
      const bar = el("div", "bar", col);
      if (!dense) el("div", "ptr-cell", n.idxRow).textContent = i;
      n.cols.push({ bar, val });
    }
    n.len = arr.length;
  }

  function buildGrid(n, g) {
    n.table.innerHTML = "";
    n.cells = [];
    for (let r = 0; r < g.length; r++) {
      const tr = el("tr", null, n.table);
      const row = [];
      for (let c = 0; c < g[r].length; c++) row.push(el("td", null, tr));
      n.cells.push(row);
    }
    n.rows = g.length;
    n.cols = g[0].length;
  }

  /* ---------- 프레임 갱신 ---------- */
  /* 지금 살아 있는 구간을 칠한다. 포인터 칩만으로는 "어디부터 어디까지"가
   * 눈에 안 들어온다. 투 포인터·슬라이딩 윈도우는 그 구간이 이야기의 전부다.
   * 막대(bar-col)든 글자칸(cell)이든 같은 표시를 쓴다. */
  function paintSpan(name, V, cells) {
    const sp = (plan.spanOf || {})[name];
    if (!sp) return;
    const lo = V[sp.lo], hi = V[sp.hi];
    const on = Number.isInteger(lo) && Number.isInteger(hi) && lo <= hi;
    for (let i = 0; i < cells.length; i++) {
      cells[i].classList.toggle("in-span", on && i >= lo && i <= hi);
    }
  }

  /* dr[d], dc[d] 를 읽어 각도를 낸다. 위가 0도, 시계 방향.
   * dr = -1 이면 위로 가는 것이므로 -dr 을 세로 성분으로 쓴다. */
  function faceAngle(V, f) {
    const dr = V[f.dr], dc = V[f.dc], d = V[f.d];
    if (!Array.isArray(dr) || !Array.isArray(dc)) return null;
    if (!Number.isInteger(d) || d < 0 || d >= dr.length || d >= dc.length) return null;
    const a = dr[d], b = dc[d];
    if (!a && !b) return null;
    return Math.round(Math.atan2(b, -a) * 180 / Math.PI);
  }

  /* `visited = {(0,0), (1,2)}` 같은 좌표 집합을 빠른 조회용으로 바꾼다.
   * 파이썬 격자 BFS 의 표준 꼴인데, 지금까지 칩 목록으로만 보이고
   * 정작 격자에는 아무 표시가 없었다. */
  function visitKeys(V, name) {
    const v = name ? V[name] : null;
    if (!v || !Array.isArray(v.__set__)) return null;
    const out = new Set();
    for (const m of v.__set__) {
      if (Array.isArray(m) && m.length === 2) out.add(m[0] + "," + m[1]);
    }
    return out;
  }

  /* True/False 표를 1/0 표로. 그리는 쪽은 0/1 지도와 똑같이 다룬다. */
  function toBinGrid(v) {
    if (!Array.isArray(v) || !v.length || !Array.isArray(v[0])) return v;
    if (typeof v[0][0] !== "boolean") return v;
    return v.map((row) => row.map((x) => (x ? 1 : 0)));
  }

  /* 지금 실행하려는 줄에 **값을 대입해서** 보여준다.
   *
   * 원문만 되풀이하면 코드 창을 다시 읽으라는 소리다. 같은 줄이 수십 번 도는데
   * 지금이 몇 번째인지, 무슨 값으로 도는지가 안 보였다.
   *
   *     9줄 · count[w] = 1            <- 그래서 지금 무슨 단어?
   *     9줄 · count["fox"] = 1        <- 이게 답이다
   *     9줄 · d[3][2] = d[3][1] + d[1][2]   <- 3중 루프가 이걸로 읽힌다
   *
   * 바꾸는 자리는 **첨자 안**과 **range(...) 안**뿐이다. 뜻이 안 흔들리는 곳만.
   * 리스트·딕셔너리 값은 안 넣는다 (한 줄에 배열이 통째로 들어오면 못 읽는다). */
  function fillLine(text, V) {
    const simple = (v) => typeof v === "number" || typeof v === "string" ||
                          typeof v === "boolean";
    const sub = (n) => (n in V && simple(V[n])) ? fmt(V[n]) : null;
    const swap = (str) => str.replace(/\b([A-Za-z_]\w*)\b/g,
      (m, n) => { const v = sub(n); return v === null ? m : v; });

    // 1) 첨자 안:  count[w] -> count["fox"],  d[i][j] -> d[3][2]
    let out = text.replace(/\[([A-Za-z_]\w*)\]/g,
      (m, n) => { const v = sub(n); return v === null ? m : "[" + v + "]"; });
    // 2) range(...) 안:  for j in range(n) -> range(4)
    out = out.replace(/\brange\(([^()]*)\)/g,
      (m, args) => "range(" + swap(args) + ")");

    // 3) 대입의 **오른쪽**:  mid = (lo + hi) // 2  ->  mid = (0 + 8) // 2
    //    왼쪽(정해질 이름)은 절대 안 건드린다. 오른쪽은 읽는 값이라 안전하다.
    const at = assignAt(out);
    if (at >= 0) out = out.slice(0, at) + swap(out.slice(at));
    // 4) 대입이 없으면 괄호 안:  q.append((nr, nc)) -> q.append((2, 3))
    else out = out.replace(/\(([^()]*)\)/g, (m, a2) => "(" + swap(a2) + ")");

    // 너무 길어지면 원문이 낫다. 한 줄 띠에 안 들어가면 아무것도 못 읽는다.
    return out.length > 78 ? text : out;
  }

  /* 대입 연산자(=, +=, //= ...)가 시작하는 자리. ==, !=, <=, >= 는 아니다. */
  function assignAt(s) {
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
      else if (c === "=" && depth === 0) {
        if (s[i + 1] === "=") { i++; continue; }
        if ("=!<>".includes(s[i - 1])) continue;
        return i + 1;
      }
    }
    return -1;
  }

  /* 지금 존재하지 않는 값의 블록은 제목만 남기고 접는다.
   *
   * 예전엔 흐리게만 했는데, 흐린 채로 자리는 그대로 차지했다. 병합정렬처럼
   * 함수 안 지역변수가 넷이면 대부분의 프레임에서 빈 막대칸 네 개가
   * 화면을 700px 씩 먹었다 — 정작 지금 살아 있는 게 뭔지는 안 보였다.
   *
   * 접는 건 정보를 감추는 게 아니라 **지금 이 변수는 없다**는 사실을 그리는 것이다.
   * 함수 밖으로 나오면 지역변수가 사라진다는 걸 눈으로 보게 된다.
   * 높이만 줄이므로(제목은 남는다) 무엇이 있었는지는 계속 보인다. */
  /* 방금 바뀐 블록이 화면 밖이면 거기까지 굴린다.
   * 화면이 넘치지 않으면 아무것도 안 한다. 보이는 블록도 건드리지 않는다 —
   * "필요한 만큼만" 이어야 재생 중에 화면이 덜컹거리지 않는다. */
  let selfScrollAt = 0, userScrollAt = 0;

  /* 사용자가 직접 굴렸으면 잠시 손을 뗀다.
   * 뭔가 보려고 내렸는데 다음 프레임이 도로 끌어올리면 아무것도 못 본다. */
  function watchScroll(el) {
    el.addEventListener("scroll", () => {
      if (Date.now() - selfScrollAt > 120) userScrollAt = Date.now();
    }, { passive: true });
  }

  function scrollToBlock(blk) {
    if (!blk || !root) return;
    if (root.scrollHeight <= root.clientHeight + 20) return;
    if (Date.now() - userScrollAt < 4000) return;   // 직접 굴린 직후엔 가만히 둔다
    const PAD = 44;                       // 위에 붙어 있는 설명 띠 높이만큼 띄운다
    const top = blk.offsetTop, bot = top + blk.offsetHeight;
    const vt = root.scrollTop, vb = vt + root.clientHeight;
    let want = null;
    if (top < vt + PAD) want = Math.max(0, top - PAD);
    else if (bot > vb) want = Math.min(bot - root.clientHeight + 12, root.scrollHeight);
    if (want === null || Math.abs(want - vt) < 2) return;
    selfScrollAt = Date.now();
    root.scrollTop = want;
  }

  function gone(block) { block.classList.add("absent"); }
  function here(block) { block.classList.remove("absent"); }

  function drawPointers(ptrRow, len, V, names) {
    const at = {};
    for (const p of (names || plan.pointers)) {
      const v = V[p];
      if (Number.isInteger(v) && v >= 0 && v < len) (at[v] || (at[v] = [])).push(p);
    }
    ptrRow.innerHTML = "";
    for (let i = 0; i < len; i++) {
      const cell = el("div", "ptr-cell", ptrRow);
      if (at[i]) {
        cell.innerHTML = at[i].map((p) => '<span class="ptr-chip">' + p + "</span>").join(" ");
      }
    }
  }

  function refreshStepBar(V, P, frame, prev, idx) {
      if (nodes.step) {
        // 코드에 적힌 주석이 곧 단계 이름이다. 사람이 쓴 설명보다 정확한 게 없다.
        const secs = plan.sections || [];
        const cur = secs.filter((s) => frame.line >= s.line && frame.line <= s.end).pop();
        nodes.step.textContent = cur
          ? cur.no + "/" + secs.length + "단계   " + cur.label : "";
        nodes.step.hidden = !cur;
      }
  }

  function refreshNarration(V, P, frame, prev, idx) {
      if (nodes.what) {
        const d = describeChange(frame, prev);
        if (d.text) {
          // 효과는 그 줄을 실행한 **다음** 프레임에 보인다. 원인 줄을 앞에 붙여야
          // "어느 줄이 이걸 했는지" 가 연결된다.
          const cause = prev ? prev.line : frame.line;
          nodes.what.textContent = cause + "줄  ·  " + d.text;
        } else {
          // 바뀐 게 없으면 지금 무슨 줄을 보고 있는지라도 알려준다 (조건 검사 등).
          // 조건 줄이면 **결과까지** 붙인다 — "왜 이 줄로 갔나"의 답이 그거다.
          const cur = (srcLine(frame.line) || "").trim();
          const yn = plan.branches ? plan.branches[idx] : null;
          nodes.what.textContent = cur
            ? frame.line + "줄  ·  " + fillLine(cur, V) + (yn ? "   →  " + yn : "") : "";
        }
        nodes.what.classList.toggle("idle", !d.text);
        // 바뀐 변수의 블록을 짚어준다. 어느 그림을 봐야 하는지가 바로 보이게.
        for (const [name, blk] of Object.entries(nodes.blockOf || {})) {
          blk.classList.toggle("touched", name === d.owner);
        }
        // 그림이 많아 화면 밖으로 나가면, 짚어봐야 안 보인다.
        // 방금 바뀐 블록이 화면 밖이면 거기까지만 굴린다 (필요한 만큼만).
        // 이미 보이는 블록이면 아무것도 안 한다 — 안 그러면 재생 내내 덜컹거린다.
        scrollToBlock(nodes.blockOf ? nodes.blockOf[d.owner] : null);
      }
  }

  function refreshCallStack(V, P, frame, prev, idx) {
      if (nodes.stack) {
        const st = nodes.stack.spec.stacks.frames[idx] || [];
        const list = nodes.stack.list;
        list.innerHTML = "";
        if (!st.length) {
          el("div", "cs-empty", list).textContent = "(모듈 최상단 — 호출 중인 함수 없음)";
        }
        // 가장 안쪽 호출을 맨 위에 둔다. 재귀가 깊어질수록 위로 쌓인다.
        for (let i = st.length - 1; i >= 0; i--) {
          const row = el("div", "cs-row", list);
          if (i === st.length - 1) row.classList.add("top");
          row.style.marginLeft = (i * 14) + "px";
          const ret = st[i].ret !== undefined
            ? '<span class="cs-ret">-> ' + fmt(st[i].ret) + "</span>" : "";
          const ln = st[i].line !== undefined
            ? '<span class="cs-line">' + st[i].line + "줄</span>" : "";
          row.innerHTML = '<span class="cs-fn">' + st[i].func + "</span>(" +
                          '<span class="cs-args">' + argText(st[i].args) + "</span>)" + ln + ret;
        }
      }
  }

  function refreshTrie(V, P, frame, prev, idx) {
      if (nodes.trie) {
        const sp = nodes.trie.spec;
        const cur = V[sp.name];
        // 지금 존재하는 경로만 진하게. 아직 안 만들어진 가지는 흐리게 둔다.
        const live = { nodes: new Map(), edges: new Map(), dicts: 0 };
        if (cur) trieNodes(cur, "", 0, live);
        for (const [key, line] of Object.entries(nodes.trie.lines)) {
          const [a, b] = key.split(">").map(Number);
          const pa = sp.paths[sp.nodes.indexOf(a)], pb = sp.paths[sp.nodes.indexOf(b)];
          line.classList.toggle("on", live.nodes.has(pb) || pb === "");
          void pa;
        }
        sp.nodes.forEach((id, i) => {
          const here = sp.paths[i] === "" || live.nodes.has(sp.paths[i]);
          nodes.trie.circles[id].classList.toggle("gone", !here);
        });
      }
  }

  function refreshSegTrees(V, P, frame, prev, idx) {
      for (const sg of plan.segtrees) {
        const n = nodes.segtrees[sg.name];
        const cur = V[sg.name];
        if (!isNumList(cur)) { gone(n.block); continue; }
        here(n.block);
        if (n.len !== cur.length) {
          n.wrap.innerHTML = "";
          n.cells = [];
          n.circles = [];
          // 1번이 뿌리인 트리. 0번 칸은 안 쓴다.
          const depth = Math.floor(Math.log2(Math.max(1, cur.length - 1))) + 1;
          const W = 480, H = depth * 56 + 14;
          const sv = svg("svg", { class: "hviz", viewBox: "0 0 " + W + " " + H }, n.wrap);
          const gE = svg("g", {}, sv), gN = svg("g", {}, sv);
          const posOf = (i) => {
            const d = Math.floor(Math.log2(i));
            const slot = i - Math.pow(2, d);
            return { x: ((slot + 0.5) / Math.pow(2, d)) * W, y: d * 56 + 24 };
          };
          for (let i = 2; i < cur.length; i++) {
            const a = posOf(i >> 1), b2 = posOf(i);
            svg("line", { class: "hedge", x1: a.x, y1: a.y, x2: b2.x, y2: b2.y }, gE);
          }
          n.cells[0] = null;
          for (let i = 1; i < cur.length; i++) {
            const pt = posOf(i);
            n.circles[i] = svg("circle", { class: "hnode", cx: pt.x, cy: pt.y, r: 15 }, gN);
            n.cells[i] = svg("text", { class: "hlabel", x: pt.x, y: pt.y + 4 }, gN);
          }
          n.len = cur.length;
        }
        // 지금 어느 노드를 보고 있나, 어느 노드 값이 방금 바뀌었나.
        // 세그먼트 트리는 "이 질의가 어느 노드를 훑나"가 전부인데 그게 안 보였다.
        const at = new Set();
        for (const c of (sg.cursors || [])) {
          const v = V[c];
          if (Number.isInteger(v) && v >= 1 && v < cur.length) at.add(v);
        }
        const before = isNumList(P[sg.name]) ? P[sg.name] : null;
        for (let i = 1; i < cur.length; i++) {
          if (n.cells[i]) n.cells[i].textContent = cur[i];
          if (n.circles[i]) {
            n.circles[i].classList.toggle("on", at.has(i));
            n.circles[i].classList.toggle("hot", !!before && before[i] !== cur[i]);
          }
        }
      }
  }

  function refreshCharGrids(V, P, frame, prev, idx) {
      for (const cg of plan.charGrids) {
        const n = nodes.charGrids[cg.name];
        const cur = V[cg.name];
        const shaped = Array.isArray(cur) && cur.length && cur.every((r) => Array.isArray(r));
        if (!shaped) { gone(n.block); continue; }
        here(n.block);
        if (n.rows !== cur.length || n.cols !== cur[0].length) {
          n.table.innerHTML = ""; n.cells = [];
          for (let r = 0; r < cur.length; r++) {
            const tr = el("tr", null, n.table);
            const row = [];
            for (let c = 0; c < cur[r].length; c++) row.push(el("td", null, tr));
            n.cells.push(row);
          }
          n.rows = cur.length; n.cols = cur[0].length;
        }
        const before = Array.isArray(P[cg.name]) ? P[cg.name] : null;
        // 글자는 늘 보여준다. 거기에 더해 "적게 나오는 글자"를 칠해서 지도처럼 읽히게 한다.
        const mark = cg.mark;
        const been = visitKeys(V, cg.visitSet);
        for (let r = 0; r < cur.length; r++) {
          for (let c = 0; c < cur[r].length; c++) {
            const td = n.cells[r][c];
            const v = cur[r][c];
            td.textContent = v;
            td.title = String(v);
            td.classList.toggle("marked", mark !== null && v === mark);
            td.classList.toggle("changed", !!before && before[r] && before[r][c] !== v);
            td.classList.toggle("cursor",
              !!cg.cursor && V[cg.cursor.row] === r && V[cg.cursor.col] === c);
            td.classList.toggle("been", !!been && been.has(r + "," + c));
          }
        }
      }
  }

  function refreshFlags(V, P, frame, prev, idx) {
      for (const fl of plan.flags) {
        const n = nodes.flags[fl.name];
        const cur = V[fl.name];
        if (!Array.isArray(cur)) { gone(n.block); continue; }
        here(n.block);
        if (n.len !== cur.length) {
          n.row.innerHTML = ""; n.cells = [];
          for (let i = 0; i < cur.length; i++) {
            const cell = el("div", "flag", n.row);
            cell.title = String(i);
            n.cells.push(cell);
          }
          n.len = cur.length;
        }
        const before = Array.isArray(P[fl.name]) ? P[fl.name] : null;
        for (let i = 0; i < cur.length; i++) {
          n.cells[i].classList.toggle("on", cur[i] === true);
          n.cells[i].classList.toggle("just", !!before && before[i] !== cur[i]);
        }
        drawPointers(n.ptrRow, cur.length, V, plan.pointerOf[fl.name] || []);
      }
  }

  function refreshCounts(V, P, frame, prev, idx) {
      for (const ct of plan.counts) {
        const n = nodes.counts[ct.name];
        const cur = V[ct.name];
        if (!cur || !Array.isArray(cur.__dict__)) { gone(n.block); continue; }
        here(n.block);
        const now = {};
        for (const [key, val] of cur.__dict__) {
          now[String(key && typeof key === "object" ? (key.__repr__ || "?") : key)] = val;
        }
        const span = (ct.hi - ct.lo) || 1;
        for (const key of ct.keys) {
          const r = n.rows[key];
          const v = now[key];
          if (v === undefined) { r.line.style.opacity = 0.2; r.val.textContent = ""; continue; }
          r.line.style.opacity = 1;
          r.bar.style.width = Math.max(2, ((v - ct.lo) / span) * 100) + "%";
          r.val.textContent = v;
        }
      }
  }

  function refreshMemoGrids(V, P, frame, prev, idx) {
      for (const m of (plan.memoGrids || [])) {
        const n = nodes.memoGrids[m.name];
        const cur = V[m.name];
        if (!cur || !Array.isArray(cur.__dict__)) { gone(n.block); continue; }
        here(n.block);
        // 직전 프레임에 없던 키가 이번에 생겼으면 그 칸이 방금 계산된 칸이다.
        const was = prev && prev.vars[m.name] && Array.isArray(prev.vars[m.name].__dict__)
          ? new Set(prev.vars[m.name].__dict__.map(([k]) => dictKey(k))) : null;
        const now = new Set();
        for (const [key, val] of cur.__dict__) {
          const r = key[0] - m.r0, c = key[1] - m.c0;
          if (r < 0 || c < 0 || r >= m.rows || c >= m.cols) continue;
          const td = n.cells[r][c];
          td.textContent = val;
          td.classList.remove("empty");
          td.classList.toggle("changed", !!was && !was.has(dictKey(key)));
          now.add(r + "," + c);
        }
        // 되돌아간 프레임에서 예전 값이 남아 있으면 안 된다
        for (let r = 0; r < m.rows; r++) {
          for (let c = 0; c < m.cols; c++) {
            if (now.has(r + "," + c)) continue;
            const td = n.cells[r][c];
            td.textContent = "";
            td.classList.add("empty");
            td.classList.remove("changed");
          }
        }
      }
  }

  function refreshPairHeaps(V, P, frame, prev, idx) {
      for (const h of (plan.pairHeaps || [])) {
        const n = nodes.pairHeaps[h.name];
        const cur = V[h.name];
        if (!Array.isArray(cur)) { gone(n.block); continue; }
        here(n.block);
        // 길이가 그대로면 칸을 다시 만들지 않는다. 만들면 트랜지션이 죽는다.
        if (cur.length !== n.len) {
          n.row.innerHTML = "";
          n.cells = [];
          for (let i = 0; i < cur.length; i++) n.cells.push(el("div", "cont-cell", n.row));
          n.len = cur.length;
          if (!cur.length) el("div", "cont-empty", n.row).textContent = "비었음";
        }
        for (let i = 0; i < cur.length; i++) {
          n.cells[i].textContent = "(" + cur[i][0] + ", " + cur[i][1] + ")";
          n.cells[i].classList.toggle("head", i === 0);
        }
      }
  }

  function refreshCallTree(V, P, frame, prev, idx) {
      if (nodes.callTree) {
        const n = nodes.callTree;
        // 지금 열려 있는 호출(= 호출 스택)을 굵게. 그 위는 아직 안 불린 것,
        // 아래는 이미 끝나서 값이 정해진 것이다.
        for (const it of n.items) {
          const s = it.spec;
          const state = idx < s.start ? "todo" : (idx < s.end ? "live" : "done");
          it.g.setAttribute("class", "cnode " + state);
          if (it.line) it.line.setAttribute("class", "cedge " + state);
          it.ret.textContent = (state === "done" && s.ret !== undefined && s.ret !== null)
            ? fmt(s.ret) : "";
        }
      }
  }

  function refreshScatters(V, P, frame, prev, idx) {
      for (const sc of (plan.scatters || [])) {
        const n = nodes.scatters[sc.name];
        // 다른 그림이 같은 이름을 가져가 블록이 안 붙었을 수 있다.
        // 없는 걸 만지면 이 프레임부터 재생이 통째로 멈춘다.
        if (!n) continue;
        const cur = V[sc.name];
        if (!isNumGrid(cur) || !cur.length || cur[0].length !== 2) { gone(n.block); continue; }
        here(n.block);
        const { W, H, PAD } = n;
        const sx = (x) => PAD + ((x - sc.xlo) / ((sc.xhi - sc.xlo) || 1)) * (W - PAD - 14);
        const sy = (y) => (H - PAD) - ((y - sc.ylo) / ((sc.yhi - sc.ylo) || 1)) * (H - PAD - 14);
        if (cur.length !== n.len) {
          n.gDots.innerHTML = "";
          n.dots = [];
          for (let i = 0; i < cur.length; i++) {
            const g = svg("g", { class: "pdot" }, n.gDots);
            n.dots.push({ c: svg("circle", { r: 5, cx: 0, cy: 0 }, g), g,
                          t: svg("text", { class: "pdlab", x: 0, y: 0 }, g) });
          }
          n.len = cur.length;
        }
        const at = {};
        for (const c of sc.cursors) {
          const v = V[c];
          if (Number.isInteger(v) && v >= 0 && v < cur.length) (at[v] || (at[v] = [])).push(c);
        }
        for (let i = 0; i < cur.length; i++) {
          const x = sx(cur[i][0]), y = sy(cur[i][1]);
          n.dots[i].c.setAttribute("cx", x);
          n.dots[i].c.setAttribute("cy", y);
          n.dots[i].t.setAttribute("x", x + 8);
          n.dots[i].t.setAttribute("y", y - 6);
          n.dots[i].t.textContent = at[i] ? at[i].join(",") : "";
          n.dots[i].g.setAttribute("class", "pdot" + (at[i] ? " on" : ""));
        }
      }
  }

  function refreshRecords(V, P, frame, prev, idx) {
      for (const rc of (plan.records || [])) {
        const n = nodes.records[rc.name];
        const cur = V[rc.name];
        if (!Array.isArray(cur)) { gone(n.block); continue; }
        here(n.block);
        const before = Array.isArray(P[rc.name]) ? P[rc.name] : null;
        const at = new Set();
        for (const c of rc.cursors) {
          const v = V[c];
          if (Number.isInteger(v) && v >= 0 && v < cur.length) at.add(v);
        }
        for (let r = 0; r < n.cells.length; r++) {
          const row = cur[r];
          const cellRow = n.cells[r];
          cellRow.tr.hidden = !row;
          if (!row) continue;
          // 정렬로 줄 전체가 바뀌었으면 그 줄을 짚어준다.
          // 값 하나만 고친 것과 줄이 통째로 옮겨간 것은 뜻이 다르다.
          const moved = !!before && before[r] &&
                        JSON.stringify(before[r]) !== JSON.stringify(row);
          cellRow.tr.classList.toggle("changed", moved);
          cellRow.tr.classList.toggle("cursor", at.has(r));
          for (let c = 0; c < cellRow.row.length; c++) {
            cellRow.row[c].textContent = row[c] === undefined ? "" : fmt(row[c]);
          }
        }
      }
  }

  function refreshSequences(V, P, frame, prev, idx) {
        for (const sq of (plan.sequences || [])) {
        const n = nodes.sequences[sq.name];
        const cur = V[sq.name];
        if (!Array.isArray(cur)) { gone(n.block); continue; }
        here(n.block);
        // 길이가 그대로면 칸을 다시 만들지 않는다. 만들면 트랜지션이 죽는다.
        if (cur.length !== n.len) {
          n.row.innerHTML = "";
          n.cells = [];
          for (let i = 0; i < cur.length; i++) n.cells.push(el("div", "cont-cell", n.row));
          n.len = cur.length;
          if (!cur.length) el("div", "cont-empty", n.row).textContent = "아직 없음";
        }
        const before = Array.isArray(P[sq.name]) ? P[sq.name].length : -1;
        for (let i = 0; i < cur.length; i++) {
          n.cells[i].textContent = fmt(cur[i]);
          n.cells[i].classList.toggle("head", before >= 0 && i >= before);
        }
      }
  }

  function refreshPairs(V, P, frame, prev, idx) {
    for (const pl of (plan.pairLists || [])) {
      const n = nodes.pairs[pl.name];
      if (!n) continue;
      const cur = V[pl.name];
      if (!Array.isArray(cur)) { gone(n.block); continue; }
      here(n.block);
      // 길이가 그대로면 칸을 다시 만들지 않는다. 만들면 트랜지션이 죽는다.
      if (cur.length !== n.len) {
        n.row.innerHTML = "";
        n.cells = [];
        for (let i = 0; i < cur.length; i++) n.cells.push(el("div", "cont-cell", n.row));
        n.len = cur.length;
        if (!cur.length) el("div", "cont-empty", n.row).textContent = "아직 없음";
      }
      const before = Array.isArray(P[pl.name]) ? P[pl.name].length : -1;
      for (let i = 0; i < cur.length; i++) {
        const p2 = cur[i];
        n.cells[i].textContent = Array.isArray(p2)
          ? "(" + fmt(p2[0]) + ", " + fmt(p2[1]) + ")" : fmt(p2);
        n.cells[i].classList.toggle("head", before >= 0 && i >= before);
      }
    }
  }

  function refreshSets(V, P, frame, prev, idx) {
    for (const st of plan.sets) {
        const n = nodes.sets[st.name];
        const cur = V[st.name];
        if (!cur || !Array.isArray(cur.__set__)) { gone(n.block); continue; }
        here(n.block);
        const members = cur.__set__.slice().sort((a, b2) =>
          (isNum(a) && isNum(b2)) ? a - b2 : String(a).localeCompare(String(b2)));
        const beforeSet = new Set((P[st.name] && P[st.name].__set__) || []);
        n.row.innerHTML = "";
        if (!members.length) el("span", "set-empty", n.row).textContent = "(빈 집합)";
        for (const m of members) {
          const chip = el("span", "set-chip", n.row);
          chip.textContent = fmt(m);
          if (!beforeSet.has(m)) chip.classList.add("just");   // 방금 들어온 것
        }
        el("span", "set-size", n.row).textContent = members.length + "개";
      }
  }

  function refreshIntervals(V, P, frame, prev, idx) {
      for (const iv of plan.intervals) {
        const n = nodes.intervals[iv.name];
        const cur = V[iv.name];
        if (!isNumGrid(cur)) { gone(n.block); continue; }
        here(n.block);
        if (n.rows !== cur.length) {
          n.wrap.innerHTML = "";
          n.bars = [];
          for (let i = 0; i < cur.length; i++) {
            const row = el("div", "iv-row", n.wrap);
            const bar = el("div", "iv-bar", row);
            n.bars.push(bar);
          }
          n.rows = cur.length;
        }
        const span = (iv.hi - iv.lo) || 1;
        const before = isNumGrid(P[iv.name]) ? P[iv.name] : null;
        for (let i = 0; i < cur.length; i++) {
          const [a, b] = cur[i];
          const bar = n.bars[i];
          bar.style.left = (((a - iv.lo) / span) * 100) + "%";
          bar.style.width = Math.max(1.5, ((b - a) / span) * 100) + "%";
          bar.textContent = a + " ~ " + b;
          // 정렬되면 줄 순서가 통째로 바뀐다. 바뀐 줄을 짚어준다.
          bar.classList.toggle("moved",
            !!before && before[i] && (before[i][0] !== a || before[i][1] !== b));
        }
      }
  }

  function refreshContainers(V, P, frame, prev, idx) {
      for (const c of plan.containers) {
        const n = nodes.containers[c.name];
        const cur = V[c.name];
        if (!Array.isArray(cur)) { gone(n.block); continue; }
        here(n.block);
        if (n.len !== cur.length) {
          n.row.innerHTML = "";
          n.cells = [];
          if (!cur.length) {
            el("div", "cont-empty", n.row).textContent = "(비어 있음)";
          }
          for (let i = 0; i < cur.length; i++) {
            const cell = el("div", "cont-cell", n.row);
            // 스택은 뒤가, 큐는 앞이 다음에 나올 자리다
            const active = c.mode === "stack" ? i === cur.length - 1 : i === 0;
            if (active) cell.classList.add("next");
            n.cells.push(cell);
          }
          n.len = cur.length;
        }
        for (let i = 0; i < cur.length; i++) n.cells[i].textContent = fmt(cur[i]);
      }
  }

  function refreshObjects(V, P, frame, prev, idx) {
      if (nodes.objects) {
        const n = nodes.objects;
        const live = frame.objs || {};
        // 지금 존재하는 참조만 진하게. 아직 안 이어진 간선은 흐리게 둔다.
        const here = new Set();
        for (const [id, rec] of Object.entries(live)) {
          if (!rec) continue;
          for (const fv of Object.values(rec.fields || {})) {
            if (fv && typeof fv === "object" && fv.__ref__ !== undefined) {
              here.add(id + ">" + fv.__ref__);
            }
          }
        }
        for (const [key, line] of Object.entries(n.lines)) {
          const on = here.has(key);
          line.classList.toggle("on", on);
          if (n.elabels[key]) n.elabels[key].style.opacity = on ? 1 : 0.25;
        }
        // 어떤 변수가 이 노드를 가리키고 있나 (head, cur 같은 것)
        const pointsTo = {};
        for (const [k, v] of Object.entries(V)) {
          if (v && typeof v === "object" && !Array.isArray(v) && v.__ref__ !== undefined) {
            (pointsTo[v.__ref__] || (pointsTo[v.__ref__] = [])).push(k);
          }
        }
        for (const id of n.ids) {
          const rec = live[id];
          n.circles[id].classList.toggle("gone", !rec);
          n.circles[id].classList.toggle("current", !!pointsTo[id]);
          n.labels[id].textContent = rec ? objLabel(rec) : "";
          n.chips[id].textContent = pointsTo[id] ? pointsTo[id].join(",") : "";
        }
      }
  }

  function refreshHeaps(V, P, frame, prev, idx) {
      for (const hp of plan.heaps) {
        const n = nodes.heaps[hp.name];
        const cur = V[hp.name];
        if (!isNumList(cur)) { gone(n.block); continue; }
        here(n.block);
        // 길이가 바뀌면 트리 모양이 통째로 달라지므로 다시 그린다.
        if (n.len !== cur.length) {
          n.wrap.innerHTML = "";
          n.cells = [];
          const depth = Math.floor(Math.log2(cur.length)) + 1;
          const W = 480, H = depth * 56 + 14;
          const sv = svg("svg", { class: "hviz", viewBox: "0 0 " + W + " " + H }, n.wrap);
          const gE = svg("g", {}, sv), gN = svg("g", {}, sv);
          const posOf = (i) => {
            const d = Math.floor(Math.log2(i + 1));          // 몇 번째 층인가
            const slot = i - (Math.pow(2, d) - 1);           // 그 층에서 몇 번째인가
            return { x: ((slot + 0.5) / Math.pow(2, d)) * W, y: d * 56 + 24 };
          };
          for (let i = 1; i < cur.length; i++) {
            const a = posOf(Math.floor((i - 1) / 2)), b2 = posOf(i);
            svg("line", { class: "hedge", x1: a.x, y1: a.y, x2: b2.x, y2: b2.y }, gE);
          }
          for (let i = 0; i < cur.length; i++) {
            const pt = posOf(i);
            svg("circle", { class: "hnode", cx: pt.x, cy: pt.y, r: 15 }, gN);
            const t = svg("text", { class: "hlabel", x: pt.x, y: pt.y + 4 }, gN);
            n.cells.push(t);
          }
          n.len = cur.length;
        }
        for (let i = 0; i < cur.length; i++) n.cells[i].textContent = cur[i];
      }
  }

  function refreshForests(V, P, frame, prev, idx) {
      for (const fo of plan.forests) {
        const n = nodes.forests[fo.name];
        const cur = V[fo.name];
        if (!isNumList(cur)) { gone(n.block); continue; }
        here(n.block);
        for (let i = 0; i < n.n; i++) {
          const p = cur[i];
          const isRoot = p === i;
          n.circles[i].classList.toggle("root", isRoot);
          n.labels[i].textContent = isRoot ? i : p;
          if (isRoot || p === undefined) {
            n.arcs[i].setAttribute("d", "");
            n.arcs[i].style.opacity = 0;
          } else {
            const x1 = n.cx(i), x2 = n.cx(p);
            const lift = Math.min(n.arcH, 14 + Math.abs(x2 - x1) * 0.42);
            n.arcs[i].setAttribute("d",
              "M" + x1 + " " + (n.y - 13) +
              " Q " + ((x1 + x2) / 2) + " " + (n.y - 13 - lift) +
              " " + x2 + " " + (n.y - 13));
            n.arcs[i].style.opacity = 1;
          }
        }
      }
  }

  function refreshChars(V, P, frame, prev, idx) {
      for (const c of plan.chars) {
        const n = nodes.chars[c.name];
        const cur = charCells(V[c.name]);
        if (!cur) { gone(n.block); continue; }
        here(n.block);
        if (n.len !== cur.cells.length) {
          n.row.innerHTML = ""; n.idxRow.innerHTML = ""; n.cells = [];
          for (let i = 0; i < cur.cells.length; i++) {
            n.cells.push(el("div", "cell", n.row));
            el("div", "ptr-cell", n.idxRow).textContent = i;
          }
          n.len = cur.cells.length;
        }
        const before = charCells(P[c.name]);
        for (let i = 0; i < cur.cells.length; i++) {
          n.cells[i].textContent = cur.cells[i];
          n.cells[i].classList.toggle("changed",
            !!before && before.cells[i] !== cur.cells[i]);
        }
        // 패턴을 i - j 칸만큼 밀어 텍스트에 맞춘다.
        // **세 줄을 다 같이 밀어야 한다.** 칸만 밀었더니 인덱스와 포인터 칩이
        // 제자리에 남아서 j 가 엉뚱한 칸을 가리켰다 (128px 어긋남).
        if (c.alignTo) {
          const off = V[c.alignTo.hostPtr] - V[c.alignTo.selfPtr];
          const px = (Number.isInteger(off) ? Math.max(0, off) * c.alignTo.cw : 0) + "px";
          n.row.style.marginLeft = px;
          n.idxRow.style.marginLeft = px;
          n.ptrRow.style.marginLeft = px;
        }
        paintSpan(c.name, V, n.cells);
        drawPointers(n.ptrRow, cur.cells.length, V, plan.pointerOf[c.name] || []);
      }
  }

  function refreshGraphs(V, P, frame, prev, idx) {
      for (const g of plan.graphs) {
        const n = nodes.graphs[g.name];
        const here = new Set();
        if (g.fromEdges) {
          // 간선 리스트는 줄어들지 않으므로 "지금 살아 있는 간선" 같은 게 없다.
          // 대신 커서 둘이 가리키는 간선을 켠다 — 지금 보고 있는 그 간선이다.
          const now = g.cursors.map((c) => V[c]).filter(Number.isInteger);
          for (const [x, y] of g.edges) {
            if (now.includes(x) && now.includes(y)) here.add(edgeKey(x, y));
          }
        } else {
          const live = adjOf(V[g.name], true);   // 만들어지는 중이어도 읽는다
          if (live) for (const [a2, b2] of live.edges) here.add(edgeKey(a2, b2));
        }
        // 고른 간선(MST)은 굵게 남긴다. "지금 보는 중"과 "골랐다"는 다른 상태다.
        const chosen = new Set();
        if (g.chosenFrom) {
          const cv = V[g.chosenFrom];
          if (isNumGrid(cv)) for (const row of cv) chosen.add(edgeKey(row[0], row[1]));
        }
        for (const [key, line] of Object.entries(n.lines)) {
          line.classList.toggle("on", here.has(key));
          line.classList.toggle("picked", chosen.has(key));
        }
        const vis = g.visited ? visitedNodes(V[g.visited]) : new Set();
        const at = {};
        for (const c of g.cursors) {
          const v = V[c];
          if (Number.isInteger(v)) (at[v] || (at[v] = [])).push(c);
        }
        // color[v] 를 노드에 직접 칠한다. 막대의 인덱스를 눈으로 그래프에
        // 옮겨 그리지 않아도 되게. 처음 값(보통 -1)은 "아직 안 칠함"이다.
        const col = g.colorOf ? V[g.colorOf.name] : null;
        const palette = new Map();
        for (const id of g.nodes) {
          if (g.colorOf && Array.isArray(col) && Number.isInteger(col[id]) &&
              col[id] !== g.colorOf.base) {
            if (!palette.has(col[id])) palette.set(col[id], palette.size % 6);
          }
          for (let ci = 0; ci < 6; ci++) n.circles[id].classList.remove("col" + ci);
          if (g.colorOf && Array.isArray(col) && palette.has(col[id])) {
            n.circles[id].classList.add("col" + palette.get(col[id]));
          }
          n.circles[id].classList.toggle("visited", vis.has(id));
          n.circles[id].classList.toggle("current", !!at[id]);
          n.chips[id].textContent = at[id] ? at[id].join(",") : "";
        }
      }
  }

  function refreshSeries(V, P, frame, prev, idx) {
      for (const s of nodes.series) {
        const px = s.x(idx);
        s.cursor.setAttribute("x1", px);
        s.cursor.setAttribute("x2", px);
        s.spec.lines.forEach((l, i) => {
          const v = l.values[idx];
          if (v === undefined) {
            s.dots[i].setAttribute("cx", -10);
            s.vals[i].textContent = "—";
          } else {
            s.dots[i].setAttribute("cx", px);
            s.dots[i].setAttribute("cy", s.y(v));
            // 비트 연산에 쓰이는 값은 2진수가 훨씬 잘 읽힌다 (13 보다 1101).
            // 변수 상자에서는 그렇게 하고 있었는데, 꺾은선으로 간 mask 는 놓치고 있었다.
            const bin = plan.bitmasks && plan.bitmasks.has(l.name) &&
                        Number.isInteger(v) && v >= 0 && v < (1 << 20);
            s.vals[i].textContent = bin ? v + " (" + v.toString(2) + ")" : v;
          }
        });
      }
  }

  function refreshRanges(V, P, frame, prev, idx) {
      for (const r of plan.ranges) {
        const n = nodes.ranges[r.lo + "|" + r.hi];
        const lo = V[r.lo], hi = V[r.hi];
        if (typeof lo !== "number" || typeof hi !== "number") { gone(n.block); continue; }
        here(n.block);
        const span = (r.gmax - r.gmin) || 1;
        const pos = (v) => ((v - r.gmin) / span) * 100;
        const a = pos(lo), b = pos(hi);
        n.band.style.left = Math.min(a, b) + "%";
        n.band.style.width = Math.abs(b - a) + "%";
        setMark(n.loM, a, r.lo, lo);
        setMark(n.hiM, b, r.hi, hi);
        if (n.midM) {
          const m = V[r.mid];
          if (typeof m === "number") {
            n.midM.style.display = "";
            setMark(n.midM, pos(m), r.mid, m);
          } else {
            n.midM.style.display = "none";
          }
        }
      }
  }

  function refreshArrays(V, P, frame, prev, idx) {
      for (const a of plan.arrays) {
        const n = nodes.arrays[a.name];
        const cur = V[a.name];
        if (!isNumList(cur)) { gone(n.block); continue; }
        here(n.block);
        if (n.len !== cur.length) buildBars(n, cur);

        const lo = Math.min(0, a.gmin);
        const hi = Math.max(a.cap !== undefined ? a.cap : a.gmax, lo + 1);
        const span = (hi - lo) || 1;
        const before = isNumList(P[a.name]) ? P[a.name] : null;

        // 자리바꿈(swap)인지 그냥 덮어쓴 건지 구별한다. 정렬 코드에서 이 둘은
        // 의미가 전혀 다른데 지금까지 똑같이 반짝였다.
        let swapped = null;
        if (before && before.length === cur.length) {
          const diff = [];
          for (let i = 0; i < cur.length && diff.length <= 2; i++) {
            if (before[i] !== cur[i]) diff.push(i);
          }
          if (diff.length === 2) {
            const [x, y] = diff;
            if (before[x] === cur[y] && before[y] === cur[x]) swapped = diff;
          }
        }

        for (let i = 0; i < cur.length; i++) {
          const c = n.cols[i];
          const over = cur[i] > hi;
          const pct = over ? 100 : Math.max(2, ((cur[i] - lo) / span) * 100);
          c.bar.style.height = a.binary ? (cur[i] ? "100%" : "8%") : pct + "%";
          c.bar.classList.toggle("over", over);
          if (a.binary) c.bar.classList.toggle("off", !cur[i]);
          if (c.val) {
            c.val.textContent = over ? "∞" : cur[i];
            c.val.title = String(cur[i]);
          }
          const isSwap = !!swapped && swapped.includes(i);
          c.bar.classList.toggle("swap", isSwap);
          c.bar.classList.toggle("changed", !isSwap && !!before && before[i] !== cur[i]);
        }

        paintSpan(a.name, V, n.cols.map((c) => c.bar.parentElement));

        drawPointers(n.ptrRow, cur.length, V, plan.pointerOf[a.name] || []);
      }
  }

  function refreshGrids(V, P, frame, prev, idx) {
      for (const g of plan.grids) {
        const n = nodes.grids[g.name];
        // 참/거짓 표는 0/1 로 바꿔서 같은 길로 보낸다. 그려지는 모습이
        // "찼나 비었나"로 똑같으므로 그리는 코드를 따로 둘 이유가 없다.
        const cur = g.boolean ? toBinGrid(V[g.name]) : V[g.name];
        if (!isNumGrid(cur)) { gone(n.block); continue; }
        here(n.block);
        if (n.rows !== cur.length || n.cols !== cur[0].length) buildGrid(n, cur);
        const pv = g.boolean ? toBinGrid(P[g.name]) : P[g.name];
        const before = isNumGrid(pv) ? pv : null;
        // 커서가 지나온 자취. DP 역추적(LCS)은 "표를 거슬러 올라간 경로"가 답
        // 그 자체인데, 커서 한 칸만 보이면 그 경로가 안 보인다.
        // 재생하며 쌓지 않고 미리 계산해 둔 자취를 되짚는다 (되감아도 맞아야 한다).
        const been = visitKeys(V, g.visitSet);
        const trail = new Set();
        if (g.track) {
          for (let t = idx - 1; t >= 0 && idx - t <= 60 && trail.size < 12; t--) {
            const at = g.track[t];
            if (at) trail.add(at[0] + "," + at[1]);
          }
        }
        const via = g.via !== null && g.via !== undefined ? V[g.via] : null;
        const capG = g.cap !== undefined ? g.cap : g.gmax;
        const hi = Math.max(Math.abs(capG), Math.abs(g.gmin)) || 1;
        for (let r = 0; r < cur.length; r++) {
          for (let c = 0; c < cur[r].length; c++) {
            const td = n.cells[r][c];
            const v = cur[r][c];
            const over = v > capG;
            const isCur = !!g.cursor && V[g.cursor.row] === r && V[g.cursor.col] === c;
            td.classList.toggle("cursor", isCur);
            // 지금 보고 있는 방향을 커서 칸 안에 삼각형으로 얹는다.
            // 이모지·화살표 글자는 이 환경에서 네모로 깨지므로 CSS 로 그린다.
            if (g.facing) {
              const want = isCur ? faceAngle(V, g.facing) : null;
              if (want === null) { if (td.dataset.dir) { td.removeAttribute("data-dir"); td.style.removeProperty("--dir"); } }
              else { td.dataset.dir = "1"; td.style.setProperty("--dir", want + "deg"); }
            }
            td.classList.toggle("trail", trail.has(r + "," + c));
            // 경유지(플로이드의 k)는 행과 열을 통째로 띠로 표시한다
            td.classList.toggle("via", Number.isInteger(via) && (r === via || c === via));
            td.classList.toggle("been", !!been && been.has(r + "," + c));
            td.title = String(v);
            td.classList.toggle("over", over);
            if (g.binary) {
              // 0/1 지도는 숫자를 읽는 게 아니라 찼나 비었나를 본다
              td.textContent = "";
              td.classList.toggle("filled", v === 1);
              td.style.background = "";
            } else {
              td.textContent = over ? "∞" : v;
              const t = Math.min(1, Math.abs(v) / hi);
              td.style.background = "rgba(94,200,248," + (t * 0.34).toFixed(3) + ")";
            }
            // 줄 수가 늘어나는 표(백트래킹 결과 모음)는 직전 프레임에 그 줄이 없다.
            // before[r] 을 안 확인하면 거기서 터진다.
            td.classList.toggle("changed", !!before && !!before[r] && before[r][c] !== v);
          }
        }
      }
  }

  function refreshScalars(V, P, frame, prev, idx) {
      const box = nodes.scalarBox;
      box.innerHTML = "";
      let any = false;
      for (const k of plan.scalars) {
        if (!(k in V)) continue;
        any = true;
        const d = el("div", "scalar", box);
        if (prev && (k in P) && JSON.stringify(P[k]) !== JSON.stringify(V[k])) {
          d.classList.add("changed");
        }
        const raw = V[k];
        let shown = fmt(deref(raw, frame.objs));
        // 비트 연산에 쓰이는 값은 2진수가 훨씬 잘 읽힌다 (13 보다 1101)
        if (plan.bitmasks && plan.bitmasks.has(k) &&
            Number.isInteger(raw) && raw >= 0 && raw < (1 << 20)) {
          shown += ' <i class="bin">' + raw.toString(2) + "</i>";
        }
        d.innerHTML = '<span class="k">' + k + '</span> <span class="v">' + shown + "</span>";
      }
      nodes.scalarBlock.style.display = any ? "" : "none";
  }


  const REFRESH = [
    refreshStepBar,
    refreshNarration,
    refreshCallStack,
    refreshTrie,
    refreshSegTrees,
    refreshCharGrids,
    refreshFlags,
    refreshCounts,
    refreshMemoGrids,
    refreshPairHeaps,
    refreshCallTree,
    refreshScatters,
    refreshRecords,
    refreshSequences,
    refreshPairs,
    refreshSets,
    refreshIntervals,
    refreshContainers,
    refreshObjects,
    refreshHeaps,
    refreshForests,
    refreshChars,
    refreshGraphs,
    refreshSeries,
    refreshRanges,
    refreshArrays,
    refreshGrids,
    refreshScalars,
  ];

  /* 프레임 하나를 화면에 반영한다.
   *
   * 예전엔 이 함수 하나가 700줄이었다. 새 유형을 넣을 때마다 여기에 for 문이
   * 하나씩 붙어서, 어디를 고쳐야 하는지 앵커가 흐려졌다 (실제로 줄 범위로
   * 자르다가 옆 함수를 통째로 날린 적이 있다).
   * 지금은 그림 종류마다 refresh* 함수 하나씩이고, 여기는 부르는 순서만 남긴다.
   * **순서를 바꾸지 말 것** — 설명 줄(refreshNarration)이 블록 강조를 켜고,
   * 나머지가 그 위에 그린다. */
  function update(frame, prev, idx) {
    const V = frame.vars;
    const P = prev ? prev.vars : {};
    for (const step of REFRESH) step(V, P, frame, prev, idx);
  }

  function setMark(node, pct, name, value) {
    node.style.left = pct + "%";
    node.innerHTML = '<span class="nline-chip">' + name + " " + value + "</span>";
  }

  return { mount, update };
})();
