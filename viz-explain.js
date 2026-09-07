  /* 소스에서 이름의 출신을 읽는다.
   *
   * 감사해 보니 설명 없는 블록이 159개였다 — 절반 넘는 그림이 이름만 달고 있었다.
   * 그런데 상당수는 코드에 답이 적혀 있다.
   *   arr = [5, 3, 8, 1]     <- 문제가 준 데이터. 안 변한다
   *   def merge_sort(a):     <- a 는 이 함수가 받은 값
   * input() 만 "주어진 값"으로 치면, 예제 코드가 대부분 리터럴이라 다 놓친다. */
  function fixedNames(source) {
    const out = new Set();
    if (!source) return out;
    // 들여쓰기 없는 줄에서 한 번 만들어지는 이름. 리터럴이든 계산이든 상관없다 —
    // words = text.split() 도 알고리즘 입장에서는 "주어진 것"이다.
    // (안 변한다는 조건은 값의 움직임으로 따로 확인한다)
    for (const m of source.matchAll(/^([A-Za-z_]\w*)\s*=[^=]/gm)) out.add(m[1]);
    return out;
  }

  function paramNames(source) {
    const out = new Set();
    if (!source) return out;
    for (const m of source.matchAll(/\bdef\s+\w+\s*\(([^)]*)\)/g)) {
      for (const part of m[1].split(",")) {
        const nm = part.split("=")[0].trim().replace(/^[*]+/, "");
        if (/^[A-Za-z_]\w*$/.test(nm)) out.add(nm);
      }
    }
    return out;
  }

/* algoviz — 그림 옆에 붙는 **말**을 만든다.
 *
 * 그림은 "지금 상태"를 보여주지만, 그것만으로는 뭐가 어디서 적용됐는지가 안 읽힌다.
 * 여기는 그 빈자리를 메우는 네 가지를 만든다.
 *
 *   findNotes     선언 옆 주석 -> 이 그림이 무엇인가       (사용자가 쓴 말이 이긴다)
 *   findSections  홀로 선 주석 -> 지금 몇 번째 단계인가
 *   findRoles     값의 움직임  -> 정렬 중 / 입력값 / 채우는 표 / 쌓는 곳
 *   findSpans     두 포인터    -> 지금 보고 있는 구간
 *
 * 판정(viz-detect)과는 독립이다. 여기를 고쳐도 **어떤 그림을 그릴지는 안 바뀌고**
 * 그림에 붙는 설명만 바뀐다. index.html 에서 util 다음, detect 앞에 읽는다.
 */
const VizExplain = (() => {
  const { isNumList, isNumGrid, SEP, relatedPairs } = VizUtil;

  /* ---------- 세그먼트 트리 / 펜윅 ----------
   * tree[i] = tree[2i] + tree[2i+1] 처럼 배열 하나가 사실은 트리인 경우.
   * 막대로 그리면 부모-자식 관계가 안 보여서 "왜 이 값이 여기 있나"를 못 읽는다.
   * 0번 칸은 안 쓰고 1번이 뿌리인 1-기반 트리다 (힙은 0-기반이라 따로 본다). */
  /* ---------- 이 그림은 무슨 역할인가 ----------
   * 그림만 덩그러니 있으면 "이게 뭐하는 배열이었지"를 매번 코드로 돌아가
   * 다시 읽어야 한다. 값이 어떻게 움직였는지만 보고 역할을 한 마디로 붙인다.
   * 이름은 안 본다 (dp 라고 이름 붙였다고 DP 표인 게 아니다).
   *
   *   정렬 중    원소 구성은 그대로인데 순서만 바뀌고, 끝에 가면 정렬돼 있다
   *   입력값     input() 으로 읽었고 그 뒤로 한 번도 안 변한다
   *   채우는 표   처음에 전부 0 이었다가 값이 들어찬다 (DP·누적합)
   *   쌓는 곳     길이가 늘기만 한다 (결과 모으기)
   *
   * 어느 쪽도 아니면 아무 말도 안 붙인다. 억지로 이름 붙이면 더 헷갈린다. */
  // 한 값이 배열을 얼마나 차지하나. [0,0,0,0] 이면 1, 전부 다르면 1/n.
  function topShare(a) {
    const c = new Map();
    let best = 0;
    for (const x of a) { const n = (c.get(x) || 0) + 1; c.set(x, n); if (n > best) best = n; }
    return best / a.length;
  }

  /* 원소 구성이 같은지 보려고 정렬해서 견준다.
   * 숫자 비교(x - y)만 쓰면 글자에서는 NaN 이 나와 정렬이 제멋대로가 된다 —
   * 문자열 뒤집기가 "구성이 바뀌었다"로 잘못 읽혀 자리 바꾸기를 못 알아봤다. */
  function sortedKey(a) {
    const nums = a.every((x) => typeof x === "number");
    return a.slice().sort(nums ? (x, y) => x - y
                               : (x, y) => (String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0))
            .join(",");
  }


  function sortedRun(a) {
    if (!a || a.length < 3) return false;
    let up = true, down = true;
    for (let i = 1; i < a.length; i++) {
      if (a[i] < a[i - 1]) up = false;
      if (a[i] > a[i - 1]) down = false;
    }
    return up || down;
  }

  function findRoles(timeline, source, inputNames) {
    const given = fixedNames(source);
    const params = paramNames(source);
    const st = {};
    for (const f of timeline) {
      for (const [k, v] of Object.entries(f.vars)) {
        // 글자도 값이고 참/거짓도 값이다. 숫자만 보면 문자열 배열과 bool 표에는
        // 역할이 아예 안 붙는다 — 이름만 달린 블록의 절반이 그것이었다.
        const text = typeof v === "string" ? v.split("")
                   : (Array.isArray(v) && v.length && v.every((x) => typeof x === "string"))
                     ? v : null;
        const bools = (!text && Array.isArray(v) && v.length && Array.isArray(v[0]) &&
                       v.every((r) => Array.isArray(r) && r.every((x) => typeof x === "boolean")))
                      ? [].concat.apply([], v).map((x) => (x ? 1 : 0)) : null;
        const flat = isNumList(v) ? v
                   : isNumGrid(v) ? [].concat.apply([], v)
                   : text || bools;
        if (!flat || !flat.length) continue;
        const s = st[k] || (st[k] = {
          first: flat, firstKey: flat.join(","), firstLen: flat.length,
          lastLen: flat.length, grew: false, shrank: false, reset: false,
          moved: false, mixed: false, maxKinds: 1,
          startShare: topShare(flat), minShare: 1, isText: !!text,
        });
        if (flat.length > s.lastLen) s.grew = true;
        // 길이가 0 이나 1 로 떨어지는 건 "빼낸 것"이 아니라 **다시 시작한 것**이다.
        // 함수가 다시 불려 지역 리스트가 초기화되는 게 이 모양이다
        // (병합정렬의 out, 부분집합 순회의 cur 이 여기서 걸려 역할을 못 받았다).
        if (flat.length < s.lastLen) { if (flat.length <= 1) s.reset = true; else s.shrank = true; }
        s.lastLen = flat.length;
        s.last = flat;
        if (flat.length >= 4) {
          s.minShare = Math.min(s.minShare, topShare(flat));
          s.maxKinds = Math.max(s.maxKinds, new Set(flat).size);
        }
        if (flat.length === s.firstLen && flat.join(",") !== s.firstKey) {
          s.moved = true;
          // 구성이 바뀌면 "자리를 바꾼 것"이 아니라 "값을 갈아끼운 것"이다
          if (sortedKey(flat) !== sortedKey(s.first)) s.mixed = true;
        }
      }
    }
    const roles = {};
    for (const [k, s] of Object.entries(st)) {
      const fixedShape = !s.grew && !s.shrank && !s.reset;
      if (s.moved && !s.mixed && fixedShape && sortedRun(s.last)) roles[k] = "정렬 중";
      // 원소 구성은 그대로인데 순서만 바뀐다 — 뒤집기·회전·섞기.
      // 끝에 정렬돼 있지 않을 뿐 "정렬 중"과 같은 종류의 움직임이다.
      else if (s.moved && !s.mixed && fixedShape) roles[k] = "자리 바꾸는 중";
      else if (inputNames.has(k) && !s.moved && fixedShape) roles[k] = "입력값";
      // [0]*n, [-1]*n, [INF]*n 로 시작해 값이 들어차면 그게 "채우는 표"다.
      // 0 만 특별 취급하면 다익스트라의 dist(=INF 로 시작)를 놓친다.
      // 한 값이 여전히 절반 넘게 차지해도(위쪽 삼각형만 채우는 구간 DP) 값의
      // 가짓수가 늘었으면 채우는 중이다.
      // 처음에 **완전히** 한 값이었다가 그게 깨졌으면 그건 채우는 중이다.
      // 0/1 짜리 참거짓 표는 값이 두 가지뿐이라 위의 두 조건에 절대 안 걸린다
      // (회문 표가 "고쳐 나가는 표"로 잘못 붙었다).
      else if (s.firstLen >= 4 && s.startShare >= 0.8 && !s.shrank &&
               (s.minShare <= 0.6 || s.maxKinds >= 3 ||
                (s.startShare === 1 && s.minShare < 1))) roles[k] = "채우는 표";
      else if (s.grew && !s.shrank) roles[k] = "쌓는 곳";
      // 글자는 자리를 바꾸는 게 아니라 잘려 나가는 경우가 많다.
      // s = s[1:-1] 처럼 줄어들기만 하면 그게 이 코드의 진행 방식 자체다.
      else if (s.isText && s.shrank && !s.grew) roles[k] = "줄어드는 중";
      // 바깥에서 한 번 만들고 그 뒤로 안 변하는 값. 리터럴이든 계산해서 만들었든
      // (words = text.split()) 알고리즘 입장에서는 똑같이 "주어진 것"이다.
      else if (given.has(k) && !s.moved && fixedShape) roles[k] = "주어진 값";
      else if (params.has(k)) roles[k] = "받은 값";
      // 어느 것도 아니면: 크기는 그대로인데 값이 계속 갈린다.
      // 플로이드의 거리표, 로봇 청소기의 판, 슬라이딩 윈도우의 카운트가 그렇다.
      // "쌓지도 채우지도 않고 제자리에서 고쳐 나간다"는 것 자체가 알려줄 만한 사실이다.
      else if (s.moved && s.mixed && !s.grew && !s.shrank) roles[k] = "고쳐 나가는 표";
    }
    return roles;
  }

  function findNotes(source) {
    if (!source) return {};

    // 문자열 안의 # 를 주석으로 착각하면 안 된다 (print("#1") 이 흔하다)
    const cut = (line) => {
      let q = null;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (q) { if (ch === q && line[i - 1] !== "\\") q = null; }
        else if (ch === '"' || ch === "'") q = ch;
        else if (ch === "#") return [line.slice(0, i), line.slice(i + 1).trim()];
      }
      return [line, null];
    };
    // "x = ...", "x, y = ...", "x += ..." 이 만드는 이름들
    const names = (code) => {
      const m = code.match(/^\s*([A-Za-z_][\w\s,]*?)\s*(?:\+|-|\*|\/|%|\|)?=[^=]/);
      if (!m) return [];
      return m[1].split(",").map((x) => x.trim())
                 .filter((x) => /^[A-Za-z_]\w*$/.test(x));
    };

    const out = {};
    const put = (who, note) => {
      if (!note || note.length > NOTE_MAX) return;
      for (const n of who) if (!(n in out)) out[n] = note;
    };

    let hold = null;                        // 홀로 선 주석. 다음 코드 줄을 기다린다
    let sawCode = false;
    for (const line of source.split("\n")) {
      const [code, note] = cut(line);
      if (!code.trim()) {
        if (note !== null) hold = note;     // 주석만 있는 줄
        continue;                           // 빈 줄이면 그대로 기다린다
      }
      // 코드보다 먼저 나온 주석은 파일 제목이지 어느 값의 설명이 아니다.
      // `# 세그먼트 트리 - 배열 하나가 사실은 트리다` 가 arr 의 설명으로 붙었다.
      if (!sawCode) { sawCode = true; hold = null; }
      const who = names(code);
      if (note !== null) put(who, note);    // 줄 끝 주석이 먼저다
      else if (hold) put(who, hold);
      hold = null;
    }
    return out;
  }

  /* ---------- 코드가 스스로 쓴 설명 (주석) ----------
   * 사람이 코드에 "# 각 층 블록 갯수" 라고 이미 써놨다. 그게 가장 정확한 설명이다.
   * 주석 한 줄이 그 아래 구역의 제목이 된다. 재생하면서 지금 어느 단계를
   * 지나는지 보여주면, 그림이 무엇을 하는 중인지가 붙는다.
   *
   * 주석이 없는 코드에서는 아무것도 안 만든다. 억지로 지어내지 않는다. */
  function findSections(source) {
    if (!source) return [];
    const src = source.split("\n");
    const out = [];
    let sawCode = false;
    for (let i = 0; i < src.length; i++) {
      const t = src[i].trim();
      if (!t.startsWith("#")) { if (t) sawCode = true; continue; }
      const label = t.replace(/^#+\s*/, "").trim();
      if (!label || label.length > 60) continue;
      // 코드보다 먼저 나온 주석은 파일 제목이지 "단계" 가 아니다
      if (!sawCode) continue;
      out.push({ line: i + 1, label });
    }
    if (out.length < 2) return [];      // 한 개뿐이면 "단계" 라고 부를 게 못 된다
    // 각 주석은 다음 주석 직전까지를 맡는다
    for (let i = 0; i < out.length; i++) {
      out[i].end = i + 1 < out.length ? out[i + 1].line - 1 : src.length;
      out[i].no = i + 1;
    }
    return out;
  }

  function findSpans(timeline, seqs, pointerOf, source) {
    const related = relatedPairs(source);
    const out = {};
    for (const q of seqs) {
      const ps = pointerOf[q.name] || [];
      if (ps.length < 2) continue;
      let best = null;
      for (let x = 0; x < ps.length; x++) {
        for (let y = 0; y < ps.length; y++) {
          if (x === y) continue;
          const lo = ps[x], hi = ps[y];
          if (!related.has(lo + SEP + hi)) continue;
          let ok = 0, bad = 0, widths = new Set(), sum = 0;
          for (const f of timeline) {
            const a = f.vars[lo], b = f.vars[hi];
            if (!Number.isInteger(a) || !Number.isInteger(b)) continue;
            const v = f.vars[q.name];
            const len = typeof v === "string" ? v.length : Array.isArray(v) ? v.length : null;
            if (len === null) continue;
            if (a < 0 || b >= len || a > b) { bad++; continue; }
            ok++; sum += b - a + 1;
            if (widths.size < 20) widths.add(b - a);
          }
          // 어긋난 프레임이 조금이라도 많으면 구간이 아니다. 잘못 칠하면
          // 없는 규칙을 있는 것처럼 가르치게 된다.
          if (ok < 4 || bad > ok * 0.15 || widths.size < 3) continue;
          const score = ok - sum / ok;             // 자주 맞고, 지나치게 넓지 않은 쪽
          if (!best || score > best.score) best = { lo, hi, score };
        }
      }
      if (best) out[q.name] = { lo: best.lo, hi: best.hi };
    }
    return out;
  }

  /* ---------- 조건이 참이었나 거짓이었나 ----------
   * 재생 프레임의 3분의 1은 아무것도 안 바뀐다. 대부분 조건을 검사하는 줄이다.
   * 지금은 그 줄의 원문만 되풀이해 보여줬다 — 코드를 다시 읽으라는 소리다.
   *
   *     9줄 · if s[left] != s[right]:          <- 그래서 어떻게 됐는데?
   *     9줄 · if s[left] != s[right]:  -> 거짓  <- 이게 답이다
   *
   * "왜 이 줄로 갔나"의 답이 바로 이거다. 알아내는 법은 간단하다:
   * 조건 줄 **다음에 실행된 줄**이 그 조건의 몸통 안(더 깊은 들여쓰기)이면 참,
   * 아니면 거짓. 파이썬은 들여쓰기가 곧 블록이라 이게 그대로 성립한다.
   *
   * 프레임을 앞뒤로 봐야 하므로 재생 중이 아니라 여기서 미리 다 계산해 둔다
   * (되감아도 맞아야 하니까 — 자취를 미리 계산해 두는 것과 같은 이유). */
  function branchOutcomes(timeline, source) {
    if (!source) return null;
    const src = source.split("\n");
    const indentOf = (i) => {
      const l = src[i];
      if (l === undefined) return -1;
      return l.length - l.replace(/^\s+/, "").length;
    };
    const cond = src.map((l) => /^\s*(if|elif|while)\b/.test(l));
    const out = new Array(timeline.length);
    let any = false;
    for (let t = 0; t + 1 < timeline.length; t++) {
      const f = timeline[t];
      if (f.event !== "line") continue;
      const L = f.line;
      if (!L || !cond[L - 1]) continue;
      const g = timeline[t + 1];
      // 다른 함수로 넘어갔으면(호출) 이 조건의 결과를 알 수 없다
      if (g.event === "call" || (g.depth || 0) !== (f.depth || 0)) continue;
      const M = g.line;
      if (!M) continue;
      out[t] = (M > L && indentOf(M - 1) > indentOf(L - 1)) ? "참" : "거짓";
      any = true;
    }
    return any ? out : null;
  }

  return { findRoles, findNotes, findSections, findSpans, branchOutcomes };
})();
