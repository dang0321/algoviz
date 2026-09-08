/* algoviz — 공용 판별기와 포맷터.
 *
 * "이 값이 무엇처럼 생겼는가"만 답한다. 화면도 모르고 타임라인도 모른다.
 * 판정(viz-detect)과 그리기(viz-render) 양쪽에서 쓴다.
 */
const VizUtil = (() => {

  const isNum = (v) => typeof v === "number";
  const isNumList = (v) => Array.isArray(v) && v.length > 0 && v.every(isNum);
  const isNumGrid = (v) =>
    Array.isArray(v) && v.length > 0 && v.every(isNumList) &&
    v.every((r) => r.length === v[0].length);

  const NODE_MAX = 40;

  /* 인접구조인가? 맞으면 {nodes, edges}, 아니면 null.
   * 두 가지 모양을 받는다:
   *   - dict of list : {0: [1, 2], 1: [0, 3]}  (defaultdict(list) 포함)
   *   - 들쭉날쭉한 2차원 리스트 : [[1,2],[0],[0,3,4]]
   * 행 길이가 균일한 2차원 리스트는 DP 표로 보고 여기서 뺀다. */
  /* loose 는 "이게 그래프인가"를 묻는 게 아니라 "지금 어느 간선이 살아 있나"를
   * 물을 때 쓴다. 만들어지는 중이라 간선이 하나뿐인 프레임도 그대로 읽어야
   * 첫 간선이 이어지는 순간이 화면에 보인다. */
  function adjOf(v, loose) {
    const nodes = new Set(), edges = [];
    let weights = null;
    if (v && !Array.isArray(v) && typeof v === "object" && v.__dict__) {
      const rows = v.__dict__;
      if (!rows.length) return null;
      // 노드 번호가 꼭 숫자일 필요는 없다. 백준에는 도시 이름·단어를 노드로
      // 쓰는 그래프 문제가 흔한데, 지금까지 통째로 안 보였다.
      const nodeish = (x) => isNum(x) || (typeof x === "string" && x.length > 0 && x.length <= 14);
      if (!rows.every(([k, val]) => nodeish(k) && Array.isArray(val))) return null;
      const keys = new Set(rows.map(([k]) => k));

      // 이웃을 어떻게 읽을지 세 가지로 시도한다:
      //   [2, 3]          숫자가 곧 이웃
      //   [(2, 5), ...]   쌍의 앞이 이웃, 뒤가 가중치
      //   [(5, 2), ...]   쌍의 앞이 가중치, 뒤가 이웃
      // 어느 쪽이 노드 번호인지는 "키 집합에 있는가"로 가린다. 가중치는 보통
      // 노드 번호 범위를 벗어나므로 이 검사로 갈린다.
      const pair = (x) => Array.isArray(x) && x.length === 2;
      const modes = [
        (x) => (nodeish(x) ? { to: x } : null),
        (x) => (pair(x) && nodeish(x[0]) ? { to: x[0], w: x[1] } : null),
        (x) => (pair(x) && nodeish(x[1]) ? { to: x[1], w: x[0] } : null),
      ];
      let best = null;
      for (const pick of modes) {
        let ok = 0, bad = 0, broken = false;
        const es = [], ns = new Set(), ws = {};
        for (const [k, val] of rows) {
          ns.add(k);
          for (const x of val) {
            const got = pick(x);
            if (!got) { broken = true; break; }
            if (keys.has(got.to)) ok++; else bad++;
            ns.add(got.to);
            es.push([k, got.to]);
            if (isNum(got.w)) ws[edgeKey(k, got.to)] = got.w;
          }
          if (broken) break;
        }
        if (broken || ok === 0 || bad > ok) continue;
        const score = ok - bad;
        if (!best || score > best.score) best = { nodes: [...ns], edges: es, weights: ws, score };
      }
      if (!best) return null;
      for (const n of best.nodes) nodes.add(n);
      for (const e of best.edges) edges.push(e);
      weights = best.weights;
    } else if (Array.isArray(v) && v.length >= 3 && v.every((r) => Array.isArray(r))) {
      if (new Set(v.map((r) => r.length)).size < 2) return null;   // 균일하면 표
      // 이웃을 어떻게 읽을지 딕셔너리 쪽과 똑같이 세 가지로 시도한다.
      //   [2, 3]          숫자가 곧 이웃
      //   [(2, 5), ...]   쌍의 앞이 이웃, 뒤가 가중치
      //   [(5, 2), ...]   쌍의 앞이 가중치, 뒤가 이웃
      // 예전엔 숫자만 받아서, adj[a].append((b, w)) 로 만든 가중치 그래프가
      // 통째로 안 보였다 — 다익스트라·프림이 전부 그 꼴이다.
      const pair2 = (x) => Array.isArray(x) && x.length === 2 && isNum(x[0]) && isNum(x[1]);
      const inIdx = (x) => Number.isInteger(x) && x >= 0 && x < v.length;
      const modes = [
        (x) => (isNum(x) ? { to: x } : null),
        (x) => (pair2(x) ? { to: x[0], w: x[1] } : null),
        (x) => (pair2(x) ? { to: x[1], w: x[0] } : null),
      ];
      let best = null;
      for (const pick of modes) {
        let inRange = 0, outRange = 0, broken = false;
        const es = [], ws = {};
        for (let i = 0; i < v.length && !broken; i++) {
          for (const x of v[i]) {
            const got = pick(x);
            if (!got) { broken = true; break; }
            // 인접 리스트의 값은 **그 리스트의 인덱스**여야 한다. 이게 없으면
            // 기수 정렬의 bucket = [[170, 90], [45], ...] 이 그래프가 된다.
            if (inIdx(got.to)) inRange++; else outRange++;
            es.push([i, got.to]);
            if (isNum(got.w)) ws[edgeKey(i, got.to)] = got.w;
          }
        }
        if (broken) continue;
        // 간선 서넛은 있어야 그래프다. bucket 이 어쩌다 [[2], [], ...] 가 된
        // 순간에 "노드 10개 간선 1개 그래프"로 잡혔다.
        if ((!loose && inRange < 3) || !inRange || outRange > inRange * 0.1) continue;
        const score = inRange - outRange;
        if (!best || score > best.score) best = { es, ws, score };
      }
      if (!best) return null;
      for (let i = 0; i < v.length; i++) nodes.add(i);
      for (const e of best.es) { nodes.add(e[1]); edges.push(e); }
      // 가중치가 하나도 없으면 null 로 둔다. 빈 객체를 넘기면 그리는 쪽이
      // "가중치 있는 그래프"로 보고 빈 자리를 만든다.
      weights = Object.keys(best.ws).length ? best.ws : null;
    } else {
      return null;
    }
    if ((!loose && nodes.size < 3) || nodes.size > NODE_MAX) return null;
    if (!edges.length) return null;
    // 숫자면 숫자순, 글자면 사전순. 섞여 있으면 문자열로 견준다.
    const cmp = (a, b) => (isNum(a) && isNum(b)) ? a - b
                        : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
    return { nodes: [...nodes].sort(cmp), edges, weights };
  }

  /* INF 센티넬 때문에 눈금이 망가지는 걸 막는다.
   * dist = [10**9] * n 처럼 한 값만 터무니없이 크면 나머지 막대가 전부 바닥에
   * 깔려서 아무것도 못 읽는다. 하위 25% 값을 기준으로 "정상 범위"를 잡고,
   * 그 100배를 넘는 값은 센티넬로 보고 눈금에서 뺀다. 넘치는 막대는 따로 표시한다. */
  function robustMax(samples, gmax) {
    if (!samples || samples.length < 8) return gmax;
    const s = samples.slice().sort((a, b) => a - b);
    const ref = Math.max(Math.abs(s[Math.floor(s.length * 0.25)]), 1);
    let cap = -Infinity;
    for (const v of s) if (Math.abs(v) <= ref * 100) cap = Math.max(cap, v);
    if (!Number.isFinite(cap) || cap <= 0) return gmax;
    return gmax > cap * 8 ? cap : gmax;
  }

  const edgeKey = (a, b) => (a < b ? a + "-" + b : b + "-" + a);

  const CHAR_MAX = 64;

  /* 한 칸씩 그릴 만한 문자열인가. 두 모양을 받는다:
   *   - 문자열 그대로       s = "racecar"
   *   - 짧은 문자 리스트    arr = list(s)  ->  ['r','a','c',...]
   * 문자열 문제는 "몇 번째 글자를 보고 있나" 가 전부라 칸으로 그려야 읽힌다. */
  const CHAR_ELEM_MAX = 12;      // 한 칸에 들어갈 글자 수 상한. 단어 배열까지 받는다

  function charCells(v) {
    if (typeof v === "string") {
      if (v.length < 2 || v.length > CHAR_MAX) return null;
      return { cells: [...v], isList: false, elem: 1 };
    }
    if (Array.isArray(v) && v.length >= 2 && v.length <= CHAR_MAX &&
        v.every((x) => typeof x === "string" && x.length <= CHAR_ELEM_MAX)) {
      const elem = v.reduce((m, x) => Math.max(m, x.length), 1);
      return { cells: v.slice(), isList: true, elem };
    }
    return null;
  }

  /* 방문 표시로 쓸 만한 모양인가. 두 가지를 받는다:
   *   - 노드 번호를 담는 집합  visited = {0, 1, 3}
   *   - 노드 수만큼 긴 bool 리스트  visited = [True, False, ...] */
  function visitedShape(v) {
    if (v && !Array.isArray(v) && typeof v === "object" && Array.isArray(v.__set__)) {
      // 문자열 노드 그래프에서는 visited 도 문자열 집합이다.
      // 숫자만 받아주면 도시 이름 BFS 의 방문 표시가 통째로 안 보인다.
      const nums = v.__set__.filter(isNum);
      const strs = v.__set__.filter((x) => typeof x === "string");
      if (nums.length + strs.length !== v.__set__.length) return null;
      if (!v.__set__.length) return { kind: "set", min: Infinity, max: -Infinity, members: [] };
      if (strs.length) return { kind: "set", min: Infinity, max: -Infinity, members: v.__set__.slice() };
      return { kind: "set", min: Math.min(...nums), max: Math.max(...nums), members: nums.slice() };
    }
    if (Array.isArray(v) && v.length >= 3 && v.every((x) => typeof x === "boolean")) {
      return { kind: "bools", min: 0, max: v.length - 1 };
    }
    return null;
  }

  function visitedNodes(v) {
    const out = new Set();
    if (!v) return out;
    if (Array.isArray(v.__set__)) { for (const x of v.__set__) out.add(x); return out; }
    if (Array.isArray(v)) v.forEach((x, i) => { if (x === true) out.add(i); });
    return out;
  }

  /* 비트 연산과 함께 쓰이는 변수는 10진수보다 2진수가 읽힌다.
   * mask 13 보다 mask 1101 이 "어느 도시를 들렀나"를 바로 보여준다.
   * 소스에서 &, |, ^, <<, >> 옆에 붙어 있는 이름을 찾는다. */
  function bitmaskVars(source) {
    const out = new Set();
    if (!source) return out;
    const OPS = "(?:&|\\||\\^|<<|>>)";
    for (const re of [new RegExp("\\b(\\w+)\\s*" + OPS, "g"),
                      new RegExp(OPS + "\\s*(\\w+)\\b", "g")]) {
      let m;
      while ((m = re.exec(source))) out.add(m[1]);
    }
    return out;
  }

  function subscriptOwner(source, seqs, ptr) {
    if (!source) return null;
    // 변수 이름에 정규식 특수문자가 들어갈 일은 없지만, 있어도 안 깨지게 막아둔다
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // 같은 변수가 여러 배열의 첨자로 쓰이면(length[k] 와 def_idx[k]) 양쪽에 다 붙인다.
    // 하나만 고르면 나머지 배열에는 아무 표시도 안 남는다.
    const hits = {};
    let bestN = 0;
    for (const q of seqs) {
      const re = new RegExp("\\b" + esc(q.name) + "\\s*\\[\\s*" + esc(ptr) + "\\b", "g");
      const n = (source.match(re) || []).length;
      if (n > 0) { hits[q.name] = n; bestN = Math.max(bestN, n); }
    }
    // 횟수가 가장 많은 것만 남기면 length[k] 가 def_idx[k] 에 밀려서 사라진다.
    // 한 번이라도 첨자로 쓰였으면 그 배열에 붙인다.
    if (!bestN) return null;
    return Object.keys(hits);
  }

  /* ---------- 중첩 딕셔너리 트리 (트라이) ----------
   * trie = {"c": {"a": {"t": {"$": True}}}} 같은 구조. 딕셔너리 안에 딕셔너리가
   * 들어가면 그건 트리다. 변수 패널에 중괄호로 찍으면 아무것도 안 읽힌다.
   * 노드는 "경로"로 식별한다 — 자라나도 같은 노드가 같은 자리에 남는다. */
  const SEP = "\u0001";   // 경로 구분자. 변수명이나 키에 나올 일 없는 문자

  function trieNodes(v, path, depth, acc) {
    if (!v || Array.isArray(v) || typeof v !== "object" || !Array.isArray(v.__dict__)) return;
    if (depth > 8) return;
    for (const [k, val] of v.__dict__) {
      const key = String(k && typeof k === "object" ? (k.__repr__ || "?") : k);
      const child = path + SEP + key;
      const isDict = val && !Array.isArray(val) && typeof val === "object"
                     && Array.isArray(val.__dict__);
      acc.nodes.set(child, { key, terminal: !isDict });
      acc.edges.set(path + ">" + child, [path, child, key]);
      if (isDict) { acc.dicts++; trieNodes(val, child, depth + 1, acc); }
    }
  }

  const sameCell = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const VALUE_FIELDS = ["v", "val", "value", "data", "key", "item", "name"];

  function objGraph(frame) {
    const objs = frame && frame.objs;
    if (!objs) return null;
    const ids = Object.keys(objs).map(Number).filter((id) => objs[id]);
    if (ids.length < 2) return null;
    const edges = [];
    for (const id of ids) {
      const fields = objs[id].fields || {};
      for (const [fk, fv] of Object.entries(fields)) {
        if (fv && typeof fv === "object" && !Array.isArray(fv) && fv.__ref__ !== undefined) {
          if (objs[fv.__ref__]) edges.push([id, fv.__ref__, fk]);
        }
      }
    }
    if (!edges.length) return null;
    return { nodes: ids.sort((a, b) => a - b), edges, objs };
  }

  function objLabel(rec) {
    if (!rec) return "?";
    const f = rec.fields || {};
    for (const k of VALUE_FIELDS) {
      if (k in f && (isNum(f[k]) || typeof f[k] === "string")) return String(f[k]);
    }
    for (const [k, v] of Object.entries(f)) {
      if (isNum(v) || typeof v === "string") return String(v);
    }
    return rec.cls || "?";
  }

  function deref(v, objs) {
    if (v && typeof v === "object" && !Array.isArray(v) && v.__ref__ !== undefined) {
      const rec = objs && objs[v.__ref__];
      if (rec) return { __repr__: (rec.cls || "obj") + "(" + objLabel(rec) + ")" };
    }
    return v;
  }

  function resolveArgs(args, objs) {
    if (!args) return args;
    const out = {};
    for (const [k, v] of Object.entries(args)) {
      out[k] = deref(v, objs);
    }
    return out;
  }

  function argText(args) {
    const parts = [];
    for (const [k, v] of Object.entries(args || {})) {
      parts.push(k + "=" + fmt(v));
      if (parts.length >= 4) break;
    }
    return parts.join(", ");
  }

  /* ---------- 그래프 / 트리 ---------- */
  function nameAffinity(a, b) {
    // a.length > 1 이 없으면 한 글자 이름끼리는 slice(1) 이 둘 다 "" 라서
    // i 와 p 같은 남남이 짝으로 잡힌다.
    if (a.length > 1 && a.length === b.length && a.slice(1) === b.slice(1)) return true;
    const pairs = [["lo", "hi"], ["left", "right"], ["start", "end"], ["low", "high"], ["l", "r"], ["s", "e"]];
    for (const [x, y] of pairs) {
      if (a === x && b === y) return true;
      if (a.startsWith(x) && b.startsWith(y) && a.slice(x.length) === b.slice(y.length)) return true;
    }
    return false;
  }

  /* ---------- DOM 을 한 번만 만든다 ---------- */
  /* 딕셔너리 키를 사람이 읽는 한 줄로. 튜플 키 (i, j) 가 전부 "?" 로 뭉개져서
   * 메모이제이션 표가 통째로 안 보이던 적이 있다. 판정과 그리기가 같은 문자열을
   * 써야 짝이 맞으므로 여기 한 곳에 둔다. */
  function dictKey(k) {
    if (Array.isArray(k)) return "(" + k.map(dictKey).join(", ") + ")";
    if (k && typeof k === "object") return k.__repr__ || "?";
    return String(k);
  }

  /* ---------- 지금 보고 있는 "구간" ----------
   * 투 포인터, 슬라이딩 윈도우, 이분 탐색, 구간합 — 시험에 나오는 배열 문제의
   * 절반은 "배열 전체"가 아니라 **지금 살아 있는 구간**에 대한 이야기다.
   * 포인터 칩 두 개만 찍어주면 i 와 j 가 어디인지는 알겠는데
   * "그래서 지금 보는 게 어디부터 어디까지냐"가 눈에 안 들어온다. 칠해준다.
   *
   * 두 포인터가 한 배열에 붙어 있고, 늘 왼쪽 <= 오른쪽 이고, 사이 폭이
   * 실제로 여러 값을 가지면 구간으로 본다. 폭이 늘 같으면 그건 구간이 아니라
   * 그냥 나란히 가는 두 인덱스다 (i 와 i+1 처럼). */
  /* 코드가 두 변수를 "서로 견주고" 있는가.
   *
   * 값만 보면 두 정수가 한 배열의 인덱스 범위 안에서 논다는 것까지는 알 수 있지만,
   * 그게 **구간의 양 끝**인지 그냥 따로 노는 두 첨자인지는 못 가른다.
   * 위상정렬의 indeg[b], indeg[nx] 가 구간으로 칠해졌던 게 그 경우다.
   *
   * 코드에는 근거가 남아 있다. 진짜 구간이면 둘을 견주거나(while lo < hi),
   * 한쪽이 다른 쪽을 한계로 삼는다(for j in range(i)). 그 흔적만 인정한다. */
  function relatedPairs(source) {
    const set = new Set();
    if (!source) return set;
    const add = (a, b) => { set.add(a + SEP + b); set.add(b + SEP + a); };
    for (const m of source.matchAll(/\b([A-Za-z_]\w*)\s*(?:<=|>=|<|>)\s*([A-Za-z_]\w*)\b/g)) {
      add(m[1], m[2]);
    }
    // for j in range(i) / range(lo, hi) — 도는 변수와 그 한계도 짝이다
    for (const m of source.matchAll(/\bfor\s+(\w+)\s+in\s+range\s*\(([^)]*)\)/g)) {
      for (const t of m[2].matchAll(/[A-Za-z_]\w*/g)) add(m[1], t[0]);
    }
    return set;
  }

  function fmt(v) {
    if (v === null) return "None";
    if (v === true) return "True";
    if (v === false) return "False";
    if (typeof v === "string") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(fmt).join(", ") + "]";
    if (v && typeof v === "object") {
      // <__main__.Node object at 0x7f...> 같은 파이썬 기본 표기는 주소가 대부분이라
      // 읽을 게 없다. 클래스 이름만 남긴다.
      if (v.__repr__) {
        const m = /^<(?:[\w.]+\.)?(\w+) object at 0x[0-9a-f]+>$/.exec(v.__repr__);
        return m ? m[1] : v.__repr__;
      }
      if (v.__ref__ !== undefined) return "#" + v.__ref__;   // 표를 못 볼 때의 최소 표기
      if (v.__set__) return "{" + v.__set__.map(fmt).join(", ") + "}";
      if (v.__dict__) return "{" + v.__dict__.map((p) => fmt(p[0]) + ": " + fmt(p[1])).join(", ") + "}";
    }
    return String(v);
  }

  return { SEP, relatedPairs, isNum, isNumList, isNumGrid, adjOf, robustMax, edgeKey, charCells,
           visitedShape, visitedNodes, trieNodes, sameCell, objGraph, objLabel,
           deref, resolveArgs, argText, fmt, dictKey, subscriptOwner, nameAffinity,
           bitmaskVars };
})();
