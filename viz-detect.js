/* algoviz — 타임라인을 보고 "무엇을 그릴지" 정한다.
 *
 * 이 파일이 이 프로젝트의 핵심이다. 새 알고리즘 유형을 추가한다는 건
 * 여기에 find*() 하나를 더하고 analyze() 에서 불러주는 일이다.
 *
 * 판정 원칙: 이름이 아니라 **쓰이는 방식**으로 가른다.
 * 성질을 만족한다고 그것인 게 아니다 (힙은 줄어들고, 부모 배열은 처음에
 * 모두 자기를 가리키고, 탐색 구간은 한 점으로 수렴한다).
 */
const VizDetect = (() => {
  // 실제 문제의 입력은 예제보다 훨씬 크다. 64 로 막아두면 n=100 짜리 배열이
  // 통째로 안 보인다. 길면 막대를 얇게 그리고 숫자 라벨을 뗀다.
  const ARRAY_MAX = 400;

  const { isNum, isNumList, isNumGrid, adjOf, robustMax, edgeKey, charCells,
          visitedShape, trieNodes, sameCell, objGraph, subscriptOwner,
          nameAffinity, resolveArgs, bitmaskVars, dictKey, SEP,
          relatedPairs } = VizUtil;
  const { findRoles, findNotes, findSections, findSpans,
          branchOutcomes } = VizExplain;
  /* 타임라인을 한 번 훑어 변수마다 통계를 낸다.
   *
   * 여기서 모은 seen[이름] 하나가 뒤따르는 판정 서른 몇 개의 재료가 된다.
   * "몇 번 변했나 / 얼마나 길었나 / 정수만 담았나 / 0과 1만 담았나" 같은 것들.
   * 판정을 하나 더할 때 여기에 세는 항목을 늘리는 경우가 많으니, 그때는
   * seen 초기값(아래 객체 리터럴)에도 같이 넣어야 한다. */
  function collectStats(timeline) {
    const seen = {};
    let prevVars = {};
      for (const f of timeline) {
        for (const [k, v] of Object.entries(f.vars)) {
          if (k === "_" || k.startsWith("_")) continue;   // 버리는 변수는 안 그린다
          const s = seen[k] || (seen[k] = {
            arr: 0, grid: 0, scalar: 0, gmin: Infinity, gmax: -Infinity,
            maxLen: 0, distinct: new Set(), changes: 0,
            numFrames: 0, allInt: true, adjHits: 0, bestAdj: null,
            visitFrames: 0, visitMin: Infinity, visitMax: -Infinity,
            charFrames: 0, charLen: 0, charIsList: false,
            gridRowSet: new Set(), gridColSet: new Set(), samples: [], minDepth: 99,
            onlyBinary: true,
          });
          s.minDepth = Math.min(s.minDepth, f.depth || 0);
          // 몇 번이나 변했는지 세어둔다. 이게 "얼마나 중요한가"의 대용이다.
          if (k in prevVars && prevVars[k] !== JSON.stringify(v)) s.changes++;
          prevVars[k] = JSON.stringify(v);
          const adj = adjOf(v);
          if (adj) {
            s.adjHits++;
            // 그래프는 보통 만들어지는 중이다. 가장 많이 자란 시점을 배치 기준으로 쓴다.
            if (!s.bestAdj || adj.edges.length > s.bestAdj.edges.length) s.bestAdj = adj;
          } else if (isNumGrid(v)) {
            s.grid++;
            s.maxLen = Math.max(s.maxLen, v.length);
            s.gridRowSet.add(v.length);
            s.gridColSet.add(v[0].length);
            for (const row of v) for (const x of row) {
              s.gmin = Math.min(s.gmin, x);
              s.gmax = Math.max(s.gmax, x);
              if (x !== 0 && x !== 1) s.onlyBinary = false;
              if (s.samples.length < 4000) s.samples.push(x);
            }
          } else if (isNumList(v)) {
            s.arr++;
            s.maxLen = Math.max(s.maxLen, v.length);
            for (const x of v) {
              s.gmin = Math.min(s.gmin, x);
              s.gmax = Math.max(s.gmax, x);
              if (x !== 0 && x !== 1) s.onlyBinary = false;
              if (s.samples.length < 4000) s.samples.push(x);
            }
          } else if (isNum(v)) {
            s.scalar++;
            s.numFrames++;
            if (!Number.isInteger(v)) s.allInt = false;
            if (s.distinct.size < 40) s.distinct.add(v);
            s.gmin = Math.min(s.gmin, v);
            s.gmax = Math.max(s.gmax, v);
          } else {
            s.scalar++;
            s.allInt = false;
            const cl = charCells(v);
            if (cl) {
              s.charFrames++;
              s.charLen = Math.max(s.charLen, cl.cells.length);
              s.charElem = Math.max(s.charElem || 1, cl.elem);
              s.charIsList = cl.isList;
            }
            const vs = visitedShape(v);
            if (vs) {
              s.visitFrames++;
              s.visitMin = Math.min(s.visitMin, vs.min);
              s.visitMax = Math.max(s.visitMax, vs.max);
            }
          }
        }
      }
    return seen;
  }

  function analyze(timeline, source) {
    const seen = collectStats(timeline);


    const arrays = [], grids = [];
    for (const [k, s] of Object.entries(seen)) {
      // 2열짜리는 표가 아니라 "쌍을 담아두는 그릇"일 때가 많다.
      // pq = [(거리, 노드), ...], moves = [(from, to), ...] 가 DP 표로 그려지던 문제.
      // 진짜 표와 구별되는 신호 두 가지:
      //   - 행 수가 계속 변한다 (큐·힙은 넣었다 뺐다 한다)
      //   - 거의 모든 프레임에 안 나온다 (전역 리스트는 모듈 프레임에만 보인다.
      //     반면 DP 표는 채우는 내내 프레임마다 등장한다)
      const twoCol = s.gridColSet.size === 1 && s.gridColSet.has(2);
      const pairBag = twoCol &&
                      (s.gridRowSet.size > 1 || s.grid < timeline.length * 0.1);
      if (s.grid > 0 && s.maxLen <= 30 && !pairBag) {
        grids.push({ kind: "grid", name: k, gmin: s.gmin, gmax: s.gmax,
                     cap: robustMax(s.samples, s.gmax),
                     // 0 과 1 만 쓰는 격자는 숫자를 읽는 표가 아니라 지도다.
                     // 미로의 벽, N퀸의 보드는 칸이 찼나 비었나가 전부다.
                     binary: s.onlyBinary,
                     changes: s.changes });
      } else if (s.arr >= 2 && s.maxLen >= 3 && s.maxLen <= ARRAY_MAX) {
        // 2칸짜리 결과 튜플 같은 걸 배열로 착각하면 화면을 통째로 차지한다.
        // "여러 프레임에 걸쳐 존재하고 3칸 이상"이어야 진짜 데이터 배열로 본다.
        arrays.push({ kind: "array", name: k, gmin: s.gmin, gmax: s.gmax,
                     cap: robustMax(s.samples, s.gmax),
                     // 0/1 만 담는 정수 배열은 값의 크기가 아니라 켜졌나 꺼졌나가
                     // 전부다. visited = [0]*n 이 대표적이다.
                     binary: s.onlyBinary && s.maxLen >= 4,
                     len: s.maxLen, frames: s.arr, changes: s.changes });
      }
    }
    // 방향 벡터(dr/dc, dx/dy)는 격자 문제마다 따라 나오는 상수 표다.
    // 한 번도 안 변하고, 값이 -1~1 이고, 길어야 여덟 칸.
    // 막대로 그려도 재생 내내 가만히 있어서 화면만 먹는다.
    const dirNames = [];
    for (let i = arrays.length - 1; i >= 0; i--) {
      const a = arrays[i];
      if (a.changes === 0 && a.len <= 8 && a.gmin >= -1 && a.gmax <= 1) {
        dirNames.push(a.name);      // 안 그리는 대신 "어느 쪽을 보나"에 쓴다
        arrays.splice(i, 1);
      }
    }

    // 2차원 참/거짓 표도 격자다 (회문 DP, 도달 가능성)
    for (const bg of findBoolGrids(timeline, seen)) grids.push(bg);

    const segtrees = findSegTrees(timeline, seen);
    const segNames = new Set(segtrees.map((t) => t.name));
    for (let i = arrays.length - 1; i >= 0; i--) {
      if (segNames.has(arrays[i].name)) arrays.splice(i, 1);
    }

    const charGrids = findCharGrids(timeline, seen);
    const charGridNames = new Set(charGrids.map((g) => g.name));

    const flags = findFlags(timeline, seen);
    const memoGrids = findMemoGrids(timeline, seen);
    const memoNames = new Set(memoGrids.map((m) => m.name));
    const counts = findCounts(timeline, seen).filter((c) => !memoNames.has(c.name));

    const tries = findTries(timeline, seen);
    const trieNames = new Set(tries.map((t) => t.name));

    const intervals = findIntervals(timeline, seen);
    const intervalNames = new Set(intervals.map((i) => i.name));
    for (let i = grids.length - 1; i >= 0; i--) {
      if (intervalNames.has(grids[i].name)) grids.splice(i, 1);
    }

    const containers = findContainers(timeline, seen);
    const containerNames = new Set(containers.map((c) => c.name));
    for (let i = arrays.length - 1; i >= 0; i--) {
      if (containerNames.has(arrays[i].name)) arrays.splice(i, 1);
    }

    // 컨테이너로 이미 그려지는 것을 우선순위 큐로 또 그리면 이름이 겹친다
    const pairHeaps = findPairHeaps(timeline, seen)
      .filter((h) => !containerNames.has(h.name));
    const pairHeapNames = new Set(pairHeaps.map((h) => h.name));

    const objects = findObjects(timeline);

    for (const g of charGrids) g.cursor = findGridCursor(timeline, seen, g.name, true);
    for (const g of grids) {
      g.cursor = findGridCursor(timeline, seen, g.name, !!g.boolean);
      g.track = g.cursor ? cursorTrack(timeline, g.cursor) : null;
      g.via = viaAxis(source, seen, g);
      g.facing = findFacing(timeline, seen, dirNames, g.cursor);
      if (!g.dims) {
        g.dims = null;
        for (const f of timeline) {
          const v = f.vars[g.name];
          if (isNumGrid(v)) { g.dims = v.length + "x" + v[0].length; break; }
        }
      }
    }
    // 안 변하는 격자는 값으로 커서를 못 찾는다. 두 가지를 이 순서로 시도한다.
    //   1) 소스에 적힌 첨자 (A[i][k] — 코드가 이미 답을 써 놨다)
    //   2) 같은 크기 격자의 커서를 빌리기 (미로 벽 지도처럼 단서가 아예 없을 때)
    // 순서를 바꾸면 행렬 곱셈에서 A, B 가 C 의 (i, j) 를 빌려 써서 엉뚱한 칸을 짚는다.
    for (const g of grids) {
      if (g.cursor) continue;
      g.cursor = sourceCursor(source, seen, g.name);
      if (g.cursor) g.track = cursorTrack(timeline, g.cursor);
    }
    for (const g of grids) {
      if (g.cursor || !g.dims) continue;
      const donor = grids.find((o) => o !== g && o.cursor && o.dims === g.dims);
      if (donor) { g.cursor = donor.cursor; g.track = donor.track; }
    }

    gridVisitSets(timeline, seen, grids, charGrids);

    const heaps = findHeaps(timeline, seen);
    const heapNames = new Set(heaps.map((h) => h.name));
    for (let i = arrays.length - 1; i >= 0; i--) {
      if (heapNames.has(arrays[i].name)) arrays.splice(i, 1);   // 막대로는 안 그린다
    }

    const forests = parentForests(timeline, seen, source);
    const forestNames = new Set(forests.map((f) => f.name));
    // 부모 배열이면서 동시에 세그먼트 트리일 수는 없다. 유니온 파인드의
    // parent = list(range(n)) 이 우연히 세그먼트 트리 관계까지 만족해서
    // 같은 이름 블록이 둘 떴다 (백준 2606 바이러스).
    // 부모 배열 쪽이 훨씬 센 신호다 — 처음에 모든 칸이 자기를 가리킨다.
    for (let i = segtrees.length - 1; i >= 0; i--) {
      if (forestNames.has(segtrees[i].name)) {
        segNames.delete(segtrees[i].name);
        segtrees.splice(i, 1);
      }
    }
    for (let i = arrays.length - 1; i >= 0; i--) {
      if (forestNames.has(arrays[i].name)) arrays.splice(i, 1);   // 막대로는 안 그린다
    }

    const chars = [];
    for (const [k, s] of Object.entries(seen)) {
      if (s.arr || s.grid || s.adjHits) continue;
      // 이미 다른 그림을 받은 변수를 글자로 또 그리면 같은 이름의 블록이 둘이 된다.
      // stack = [] 에 문자를 넣는 괄호 검사에서 stack 이 두 번 나왔다.
      if (containerNames.has(k) || trieNames.has(k) || heapNames.has(k)) continue;
      // 컴프리헨션의 x 처럼 잠깐 스치는 변수는 그리지 않는다.
      // 전체 프레임의 15% 이상 살아 있어야 화면을 내줄 값어치가 있다.
      // 두 글자짜리는 a, name = input().split() 의 a 처럼 파싱 부스러기다.
      // 칸 두 개를 그려봐야 아무것도 안 알려주면서 자리만 차지한다.
      if (s.charFrames >= 2 && s.charLen >= 3 && s.charFrames >= timeline.length * 0.15) {
        chars.push({ kind: "chars", name: k, len: s.charLen, frames: s.charFrames,
                     elem: s.charElem || 1, isList: s.charIsList, changes: s.changes });
      }
    }

    // 주 열(sequence) = 가장 긴 것. 포인터를 여기 붙이므로 "실제 데이터"가 와야 한다.
    // 문자열도 후보다 — 팰린드롬·투포인터는 배열이 아니라 문자열 위에서 돈다.
    // (많이 변하는 순으로 고르면 결과 변수 같은 게 뽑혀서 포인터가 다 어긋난다)
    arrays.sort((a, b) => (b.len - a.len) || (b.frames - a.frames));
    const records = findRecords(timeline, seen,
      new Set([...charGridNames, ...trieNames, ...containerNames, ...intervalNames,
               ...chars.map((c) => c.name)]));
    const recordNames = new Set(records.map((x) => x.name));

    /* `for row in board:` 의 row 는 board 의 한 조각이지 따로 볼 값이 아니다.
     * 그런데 지금까지 자기 블록을 하나 받아서, 격자를 출력하는 마지막 두 줄 때문에
     * 화면에 막대가 하나 더 붙었다. `for age, idx, name in people:` 도 마찬가지다.
     *
     * 이미 그린 자료에서 꺼낸 조각이면 안 그린다. 원본을 보면 되니까.
     * 안 그린 자료에서 꺼낸 것은 그대로 둔다 (그게 유일한 단서일 수 있다). */
    const pieceOf = {};
    if (source) {
      for (const m of source.matchAll(/\bfor\s+([\w\s,]+?)\s+in\s+([A-Za-z_]\w*)\s*[:\.]/g)) {
        for (const t of m[1].split(",")) {
          const v = t.trim();
          if (v) pieceOf[v] = m[2];
        }
      }
    }
    const shown = new Set([...arrays.map((a) => a.name), ...grids.map((g) => g.name),
                           ...charGrids.map((g) => g.name), ...chars.map((c) => c.name),
                           ...containerNames,
                           ...intervalNames, ...trieNames, ...heapNames,
                           ...counts.map((c) => c.name), ...forestNames,
                           ...segNames, ...memoNames, ...recordNames]);
    const isPiece = (k) => pieceOf[k] && shown.has(pieceOf[k]);
    for (let i = chars.length - 1; i >= 0; i--) if (isPiece(chars[i].name)) chars.splice(i, 1);
    for (let i = arrays.length - 1; i >= 0; i--) if (isPiece(arrays[i].name)) arrays.splice(i, 1);

    const blocks = [...arrays, ...grids, ...chars, ...forests, ...heaps, ...objects, ...containers, ...intervals, ...tries, ...flags, ...counts, ...memoGrids, ...pairHeaps, ...charGrids, ...segtrees];

    const seqs = [...arrays, ...chars]
      .sort((a, b) => (b.len - a.len) || (b.frames - a.frames));

    // 포인터: 값이 실제로 변하는 정수 변수 중, 어떤 열의 인덱스 범위 안에서 노는 것.
    // 안 변하는 건 (n = len(arr) 같은) 상수라 포인터가 아니다.
    //
    // 예전엔 "주 열" 하나에만 몰아 붙였는데, 그러면 병합정렬처럼 배열이 둘일 때
    // i 는 left 를, j 는 right 를 가리키는데도 둘 다 엉뚱한 데 붙었다.
    // 지금은 **가장 빠듯하게 맞는 열**에 각자 붙인다 — 범위가 0..2 인 변수는
    // 길이 3 짜리 배열의 인덱스이지, 길이 40 짜리 배열의 인덱스로 보긴 어렵다.
    // 이 코드가 배열 첨자를 쓰기는 하는가. 쓴다면 값 기반 추측을 끈다.
    // 이 코드가 "이름[변수]" 꼴 첨자를 쓰기는 하는가.
    // 쓴다면 코드가 이미 인덱스를 알려준 것이므로 값 기반 추측은 끈다.
    const anySubscript = !!(source && /\w\s*\[\s*[A-Za-z_]\w*\s*[\]\-+]/.test(source));
    // for k in range(...) 로 도는 변수는 그 자체로 인덱스다
    const loopVars = new Set();
    if (source) {
      for (const m of source.matchAll(/\bfor\s+(\w+)\s+in\s+range\s*\(/g)) loopVars.add(m[1]);
    }
    const primary = seqs[0] || null;
    const pointers = [];
    const pointerOf = {};                       // 열 이름 -> 거기 붙는 포인터들
    for (const q of seqs) pointerOf[q.name] = [];
    for (const [k, s] of Object.entries(seen)) {
      if (s.arr || s.grid || s.charFrames || s.adjHits) continue;
      if (s.distinct.size < 2) continue;
      if (!Number.isFinite(s.gmin) || !Number.isFinite(s.gmax)) continue;
      if (!Number.isInteger(s.gmin) || !Number.isInteger(s.gmax)) continue;
      if (s.gmin < -1) continue;

      // 값만으로는 두 배열을 훑는 i, j 를 못 가른다. 둘 다 양쪽 범위에 들어맞기
      // 때문이다. 그런데 코드에 a[i], b[j] 라고 **쓰여 있다.** 그게 가장 확실한 근거다.
      const byCode = subscriptOwner(source, seqs, k);
      if (byCode) {
        for (const name of byCode) pointerOf[name].push(k);
        pointers.push(k);
        continue;
      }
      // 첨자로 안 쓰였다면 "for k in range(...)" 로 도는 루프 변수만 인정한다.
      // result, fall, num 처럼 계산으로 값이 정해지는 변수는 우연히 범위에 들어도
      // 인덱스가 아니다. 값만 보면 이 둘이 안 갈린다 (둘 다 조금씩 변한다).
      if (anySubscript && !loopVars.has(k)) continue;

      // 코드에서 못 찾으면 값으로 추정한다. 프레임마다 그 배열 길이 안에 들어오고,
      // 여유가 가장 적은 열을 고른다.
      let fit = null;
      for (const q of seqs) {
        if (s.gmax * 2 < q.len) continue;        // 배열을 훑지 않으면 인덱스가 아니다
        let ok = 0, bad = 0, slack = 0;
        for (const f of timeline) {
          const pv = f.vars[k], qv = f.vars[q.name];
          if (!Number.isInteger(pv)) continue;
          const len = typeof qv === "string" ? qv.length
                    : Array.isArray(qv) ? qv.length : null;
          if (len === null) continue;
          if (pv >= -1 && pv <= len) { ok++; slack += len - pv; } else bad++;
        }
        if (ok < 2 || bad > 0) continue;
        const avgSlack = slack / ok;
        if (!fit || avgSlack < fit.slack) fit = { name: q.name, slack: avgSlack };
      }
      if (!fit) continue;
      pointerOf[fit.name].push(k);
      pointers.push(k);
    }

    /* 패턴을 텍스트 위에 맞춰 놓는다 (KMP 문자열 매칭).
     * 텍스트와 패턴을 따로 그리면 "지금 어디에 맞춰보고 있나"가 안 보인다.
     * 그게 KMP 의 전부인데. 짧은 쪽을 i - j 칸만큼 밀어서 겹쳐 놓으면
     * 어긋난 자리에서 패턴이 얼마나 미끄러지는지가 바로 보인다.
     *
     * 근거: 긴 문자열과 짧은 문자열에 각각 포인터가 붙어 있고,
     * (긴 쪽 포인터 - 짧은 쪽 포인터)가 음수가 안 되고 여러 값을 가진다. */
    for (const pat of chars) {
      const pj = (pointerOf[pat.name] || [])[0];
      if (!pj || pat.alignTo) continue;
      for (const host of chars) {
        if (host === pat || host.len < pat.len * 1.5) continue;
        const pi = (pointerOf[host.name] || [])[0];
        if (!pi || pi === pj) continue;
        let ok = 0, bad = 0;
        const offs = new Set();
        for (const f of timeline) {
          const a = f.vars[pi], b = f.vars[pj];
          if (!Number.isInteger(a) || !Number.isInteger(b)) continue;
          if (a - b < 0 || b > pat.len) bad++;
          else { ok++; if (offs.size < 20) offs.add(a - b); }
        }
        if (ok < 4 || bad > ok * 0.1 || offs.size < 3) continue;
        pat.alignTo = { host: host.name, hostLen: host.len,
                        hostPtr: pi, selfPtr: pj,
                        cw: Math.max(46, 14 + (host.elem || 1) * 9) };
        break;
      }
    }

    const spanOf = findSpans(timeline, seqs, pointerOf, source);

    // 배열 위 포인터로 이미 그려지는 짝이면 수직선은 군더더기다.
    const ranges = findRanges(timeline, seen, source)
      .filter((r) => !(pointers.includes(r.lo) && pointers.includes(r.hi)));
    for (const r of ranges) blocks.push(r);

    const graphs = findGraphs(seen, timeline);
    // 이분 그래프·컬러링의 color 배열은 노드에 직접 칠한다
    for (const g of graphs) g.colorOf = graphColorOf(timeline, seen, g);
    // 간선 리스트는 판정할 근거가 없으면 안 그린다. 부모 배열이 있으면
    // 그 근거가 생긴다 (아래 findEdgeGraphs 주석 참고).
    // 이미 그림을 받은 이름들. 여기 안 넣으면 같은 변수가 블록 둘로 나온다
    // (문자 격자 board 가 "레코드 표"로도 잡혔다 — 글자 리스트의 리스트니까).
    const drawnNames = new Set([...graphs.map((g) => g.name), ...intervalNames,
                                ...containerNames, ...pairHeapNames,
                                ...charGridNames, ...trieNames, ...memoNames,
                                ...chars.map((c) => c.name)]);
    for (const x of records) { blocks.push(x); drawnNames.add(x.name); }

    const scatters = findScatter(timeline, seen, source, drawnNames);
    const scatterNames = new Set(scatters.map((x) => x.name));
    for (const x of scatters) {
      blocks.push(x);
      for (let i = grids.length - 1; i >= 0; i--) {
        if (grids[i].name === x.name) { grids.splice(i, 1); break; }
      }
      for (let i = blocks.length - 2; i >= 0; i--) {
        if (blocks[i].name === x.name) { blocks.splice(i, 1); break; }
      }
    }

    // 인접 행렬은 표로 두지 않고 그래프로도 그린다 (표는 그대로 둔다 —
    // cost[u][v] 를 읽는 코드를 따라가려면 표도 있어야 한다).
    for (const mg of matrixGraphs(timeline, seen, grids, drawnNames)) {
      // 표와 그래프가 같은 이름이면 블록이 이름으로 겹친다.
      // 그래프 쪽은 "cost 연결" 로 따로 부른다.
      drawnNames.add(mg.name);
      mg.name = mg.name + " 연결";
      graphs.push(mg);
    }

    // 부모 배열 말고도, 소스에서 "쌍을 풀어 첨자로 쓰는" 배열이 증인이 된다
    const witnesses = [...forests, ...edgeWitnesses(source, seen, arrays)];
    const edgeGraphs = findEdgeGraphs(timeline, seen, witnesses, drawnNames);
    // 크루스칼은 간선 리스트가 둘이다 — 문제로 주어진 전체 간선과, 고른 간선(MST).
    // 고른 쪽을 따로 그리면 같은 그래프가 두 번 나오고, 게다가 답만 모아놨으니
    // 트리 모양이라 "연결리스트인가?" 싶은 그림이 된다.
    // 부분집합인 쪽은 지우고, 큰 쪽 위에 **굵게 겹쳐서** 표시한다.
    for (let i = edgeGraphs.length - 1; i >= 0; i--) {
      const small = edgeGraphs[i];
      const keys = new Set(small.edges.map(([x, y]) => edgeKey(x, y)));
      const host = edgeGraphs.find((o) => o !== small && o.edges.length > small.edges.length &&
        [...keys].every((kk) => o.edges.some(([x, y]) => edgeKey(x, y) === kk)));
      if (host) { host.chosenFrom = small.name; edgeGraphs.splice(i, 1); }
    }
    for (const g of edgeGraphs) {
      graphs.push(g);
      // 3열 표나 구간 막대로 이미 그려졌으면 뺀다
      for (let i = grids.length - 1; i >= 0; i--) if (grids[i].name === g.name) grids.splice(i, 1);
      for (let i = blocks.length - 1; i >= 0; i--) if (blocks[i].name === g.name) blocks.splice(i, 1);
    }
    // 그래프의 방문 표시로 이미 보이는 집합은 두 번 그리지 않는다
    const usedAsVisited = new Set(graphs.map((g) => g.visited).filter(Boolean));
    // 격자 위에 켜지는 좌표 집합은 칩으로 또 그리지 않는다. 같은 말을 두 번 한다.
    for (const g of [...grids, ...charGrids]) if (g.visitSet) usedAsVisited.add(g.visitSet);
    const sets = findSets(timeline, seen).filter((x) => !usedAsVisited.has(x.name));
    for (const g of graphs) blocks.push(g);
    for (const x of sets) blocks.push(x);

    const claimed = new Set();
    for (const g of grids) if (g.cursor) { claimed.add(g.cursor.row); claimed.add(g.cursor.col); }
    for (const g of [...grids, ...charGrids]) if (g.visitSet) claimed.add(g.visitSet);
    for (const r of ranges) { claimed.add(r.lo); claimed.add(r.hi); if (r.mid) claimed.add(r.mid); }
    for (const g of graphs) { if (g.visited) claimed.add(g.visited); for (const c of g.cursors) claimed.add(c); }

    const scalars = Object.keys(seen).filter(
      (k) => !arrays.some((a) => a.name === k) && !grids.some((g) => g.name === k) &&
             !graphs.some((g) => g.name === k) && !chars.some((c) => c.name === k) &&
             !forestNames.has(k) && !heapNames.has(k) && !containerNames.has(k) &&
             !intervalNames.has(k) && !trieNames.has(k) &&
             !flags.some((x) => x.name === k) && !counts.some((x) => x.name === k) &&
             !sets.some((x) => x.name === k) && !charGridNames.has(k) &&
             !segNames.has(k) && !memoNames.has(k) && !pairHeapNames.has(k) &&
             !scatterNames.has(k) && !recordNames.has(k) &&
             !claimed.has(k)
    ).sort();

    // 배열 위 포인터 칩으로 이미 보이는 값은 꺾은선으로 또 그리지 않는다.
    const bitmasks = bitmaskVars(source);
    const series = findSeries(timeline, seen, scalars.filter((k) => !pointers.includes(k)));
    for (const s of series) blocks.push(s);

    // 재귀·함수 호출이 있으면 호출 스택이 그 코드의 주인공이다.
    const stacks = buildStacks(timeline);
    if (stacks) {
      // 깊이 2 이상이면 재귀·중첩 호출이라 그 코드의 주인공이다.
      // 깊이 1 뿐이면 생성자나 헬퍼 한 번 부른 것이라, 대부분의 프레임에서 비어 있다.
      // 그런 걸 자료구조 그림 위에 올리면 화면 위쪽이 빈칸으로 낭비된다.
      const deepEnough = stacks.deepest >= 2;
      blocks.push({ kind: "stack", name: "호출 스택", stacks,
                    changes: deepEnough ? 1e9 : -0.5,   // 얕으면 자료구조 뒤로
                    rank: deepEnough ? 0 : 1 });
      // 갈라지는 재귀는 트리로도 그린다. 스택은 "지금 깊이",
      // 트리는 "전부 몇 번" — 다른 질문에 답하므로 둘 다 있어야 한다.
      const tree = deepEnough ? buildCallTree(timeline) : null;
      if (tree) blocks.push(tree);
    }

    // 화면 순서: 그래프가 있으면 그게 주인공이다 (BFS 에서 order 리스트가
    // 더 자주 변한다고 그래프를 밀어내면 안 된다). 그다음은 변화량 순,
    // 시간 그래프는 보조 자료라 늘 맨 아래.
    // 입력에서 바로 온 배열은 "문제가 준 데이터"라 그 코드의 주인공에 가깝다.
    // 중력 문제의 heights(스카이라인)가 변화량이 적다고 맨 아래로 밀리면 안 된다.
    const fromInput = new Set();
    if (source) {
      for (const m of source.matchAll(/^\s*(\w+)\s*=\s*.*input\s*\(/gm)) fromInput.add(m[1]);
    }
    const roles = findRoles(timeline, source, fromInput);
    // 값이 전부 그래프 노드인 "쌓는 곳"은 크기가 아니라 순서다. 막대를 뗀다.
    const sequences = labelSequences(timeline, arrays, graphs, roles);
    for (const a of sequences) {
      a.kind = "sequence";
      const i = arrays.indexOf(a);
      if (i >= 0) arrays.splice(i, 1);
    }
    for (const b of blocks) {
      // 글자 칸에도 역할을 붙인다. 예전엔 막대·표에만 붙여서
      // 문자열 블록이 죄다 이름만 달고 있었다.
      if (["array", "grid", "chars"].includes(b.kind) && roles[b.name]) b.role = roles[b.name];
    }
    // 같은 코드 안에 그래프가 이미 잡혔고, 어떤 "쌍 목록"의 숫자가 전부 그
    // 그래프의 노드라면 그건 구간이 아니라 간선 리스트다. 가로 막대로 눕히면
    // (2,3) 을 "2에서 3까지의 시간"으로 읽게 만들어서 오히려 틀리게 가르친다.
    if (graphs.length) {
      const gnodes = new Set();
      for (const g of graphs) for (const n of g.nodes) gnodes.add(Number(n));
      for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i];
        if (b.kind !== "intervals") continue;
        let all = true, cnt = 0;
        for (const f of timeline) {
          const v = f.vars[b.name];
          if (!isNumGrid(v)) continue;
          for (const row of v) for (const x of row) { cnt++; if (!gnodes.has(x)) all = false; }
          break;
        }
        if (!all || cnt < 4) continue;
        blocks.splice(i, 1);
        // 그리는 쪽은 plan.intervals 를 훑는다. 여기서도 빼지 않으면
        // 화면에 자리가 없는 걸 갱신하려다 터진다.
        const j = intervals.indexOf(b);
        if (j >= 0) intervals.splice(j, 1);
      }
    }
    // 사람이 선언 옆에 써 둔 말을 블록 제목에 붙인다.
    // 값 움직임으로 유추한 역할보다 이게 언제나 정확하다.
    const notes = findNotes(source);
    for (const b of blocks) {
      if (!b.name) continue;
      // 인접 행렬 그래프는 "cost 연결" 로 부르므로 원래 이름으로도 찾아본다
      b.note = notes[b.name] || notes[b.name.replace(/ 연결$/, "")] || undefined;
    }

    // 아무 그림도 못 받은 쌍 목록을 마지막에 줍는다 (위 findPairLists 주석 참고).
    const drawnAll = new Set(blocks.map((b) => b.name));
    const pairLists = findPairLists(timeline, seen, drawnAll, claimed);
    for (const x of pairLists) { blocks.push(x); drawnAll.add(x.name); }
    const buckets = findBuckets(timeline, seen, drawnAll, claimed);
    for (const x of buckets) blocks.push(x);

    const RANK = { objects: 0, stack: 0, graph: 0, trie: 0, series: 2 };
    for (const b of blocks) {
      if (b.rank === undefined) {
        b.rank = RANK[b.kind] !== undefined ? RANK[b.kind] : 1;
        if (b.rank === 1 && fromInput.has(b.name)) b.rank = 0.5;
      }
    }
    blocks.sort((a, b) => a.rank - b.rank || b.changes - a.changes);

    // 산점도로 뽑혔다가 나중에 다른 그림(간선 그래프)에 이름을 뺏긴 것은
    // 블록이 안 붙는다. 목록에 남겨두면 그리는 쪽이 없는 블록을 찾다 멈춘다.
    const liveNames = new Set(blocks.map((b) => b.name));
    const liveScatters = scatters.filter((x) => liveNames.has(x.name));

    return { arrays, grids, chars, forests, heaps, objects, containers, intervals, tries, pairLists, buckets,
             flags, counts, memoGrids, pairHeaps, scatters: liveScatters, records, sequences, sets, charGrids, segtrees, bitmasks, ranges, source,
             sections: findSections(source),
             branches: branchOutcomes(timeline, source),
             pointerOf, spanOf, graphs, series, blocks, pointers, scalars,
             primary: primary && primary.name };
  }




  /* ---------- 주석을 그림에 붙인다 ----------
   * 위쪽 초록 띠(단계 표시)는 "지금 어느 대목인가"를 말해 준다.
   * 그런데 그림이 여럿일 때 **어느 그림이 뭔지**는 여전히 안 붙어 있었다.
   *
   * 사람은 선언 바로 위나 옆에 그 답을 이미 써 놓는다.
   *     # 각 층 블록 갯수
   *     length = []
   *     def_idx = []      # 기존 블록 인덱스
   * 이 말이, 값 움직임으로 유추한 역할("채우는 표")보다 언제나 정확하다.
   * 사용자가 쓴 말이 이긴다.
   *
   * 붙이는 규칙은 둘.
   *   - 줄 끝 주석은 그 줄이 만든 변수의 것
   *   - 홀로 선 주석은 **바로 다음 코드 줄**이 만든 변수의 것 (빈 줄은 건너뛴다)
   * 다음 코드 줄이 대입이 아니면 아무 데도 안 붙인다 — 그건 그 대목의 제목이지
   * 어느 값의 설명이 아니다. 처음 붙은 것만 쓴다 (선언이 가장 정확하다). */
  const NOTE_MAX = 28;



  function findSegTrees(timeline, seen) {
    const out = [];
    for (const [k, st] of Object.entries(seen)) {
      // 세그먼트 트리는 tree = [0] * (2*n) 이라 길이가 짝수이고 넉넉하다.
      // 짧거나 홀수인 배열(dist, parent, cols, indeg)이 우연히 걸리는 걸 막는다.
      if (!st.arr || st.maxLen < 8 || st.maxLen > 64 || st.maxLen % 2 !== 0) continue;
      let best = null;
      for (const f of timeline) {
        const v = f.vars[k];
        if (!isNumList(v) || v.length < 6) continue;
        const half = Math.floor(v.length / 2);
        let sum = 0, mn = 0, mx = 0, testable = 0;
        for (let i = 1; i < half; i++) {
          const l = 2 * i, r = 2 * i + 1;
          if (r >= v.length) break;
          testable++;
          if (v[i] === v[l] + v[r]) sum++;
          if (v[i] === Math.min(v[l], v[r])) mn++;
          if (v[i] === Math.max(v[l], v[r])) mx++;
        }
        if (testable < 3) continue;
        // 값이 전부 같으면 min/max/sum 관계가 저절로 성립한다.
        // 0 으로 채워진 배열이 죄다 "구간최소 트리"로 잡히던 원인.
        if (new Set(v).size < 3) continue;
        const hit = Math.max(sum, mn, mx);
        if (!best || hit / testable > best.rate) {
          best = { rate: hit / testable, testable,
                   op: hit === sum ? "구간합" : hit === mn ? "구간최소" : "구간최대" };
        }
      }
      // 진짜 세그먼트 트리는 모든 내부 노드에서 관계가 정확히 성립한다.
      // 근사치를 받아주면 우연히 몇 개 맞는 배열이 통과한다.
      if (!best || best.rate < 1) continue;
      // 질의·갱신이 어느 노드를 훑는지가 세그먼트 트리의 전부다.
      // 트리 번호 범위(1 ~ len-1) 안에서 움직이는 정수를 커서로 본다.
      const cursors = [];
      for (const [k2, s2] of Object.entries(seen)) {
        if (k2 === k || s2.arr || s2.grid || s2.adjHits || s2.charFrames) continue;
        if (!s2.allInt || s2.numFrames < 4 || s2.distinct.size < 2) continue;
        if (s2.gmin < 1 || s2.gmax >= st.maxLen) continue;
        if (cursors.length < 3) cursors.push(k2);
      }
      out.push({ kind: "segtree", name: k, len: st.maxLen, op: best.op,
                 cursors, changes: st.changes });
    }
    return out;
  }

  /* ---------- 문자 격자 ----------
   * board = [['#','.','#'], ...] 또는 [list(s) for s in lines] 형태.
   * 한국 코테의 격자 문제는 숫자보다 문자로 주는 경우가 더 많은데, 문자 2차원
   * 리스트는 숫자 격자도 아니고 문자열도 아니라서 통째로 안 보였다. */
  function findCharGrids(timeline, seen) {
    const out = [];
    for (const k of Object.keys(seen)) {
      let frames = 0, rows = 0, cols = 0, ok = true, changed = false, prev = null;
      const tally = {};
      for (const f of timeline) {
        const v = f.vars[k];
        if (v === undefined) continue;
        // board = [] 로 시작해 append 로 한 줄씩 쌓는 꼴이 흔하다. 빈 칸일 때를
        // "격자가 아니다"로 보면 그 지도는 화면에 아예 안 나온다 (실제로 그랬다).
        if (Array.isArray(v) && v.length === 0) continue;
        const good = Array.isArray(v) && v.length >= 1 &&
          v.every((r) => Array.isArray(r) && r.length &&
                         r.length === v[0].length &&
                         r.every((x) => typeof x === "string" && x.length <= 2));
        if (!good) { ok = false; break; }
        frames++;
        rows = Math.max(rows, v.length);
        cols = Math.max(cols, v[0].length);
        for (const r of v) for (const x of r) tally[x] = (tally[x] || 0) + 1;
        const now = JSON.stringify(v);
        if (prev !== null && prev !== now) changed = true;
        prev = now;
      }
      if (!ok || frames < 2) continue;
      if (rows < 2 || rows > 40 || cols < 2 || cols > 40) continue;
      // 어느 글자가 "벽"인지는 사전순으로 정하면 안 된다 ('.' 가 '#' 보다 뒤라서
      // 길을 칠하고 벽을 비워버렸다). 적게 나오는 쪽이 표시할 것이다 —
      // 미로의 벽, 오목판의 돌 둘 다 그렇다. 글자는 그대로 보여주므로,
      // 이 추측이 틀려도 읽는 데는 지장이 없다.
      const kinds = Object.keys(tally).sort((a, b) => tally[a] - tally[b]);
      out.push({ kind: "chargrid", name: k, rows, cols,
                 mark: kinds.length <= 4 ? kinds[0] : null,
                 kinds: kinds.length,
                 changes: changed ? 1 : 0 });
    }
    return out;
  }

  /* ---------- 참/거짓 배열 (에라토스테네스의 체, visited) ----------
   * [True, False, ...] 는 숫자가 아니라서 막대로 안 그려지고, 그렇다고 글자도
   * 아니라서 칸으로도 안 그려졌다. 체·방문표시는 워낙 흔해서 따로 그린다.
   * 켜진 칸과 꺼진 칸이 눈에 확 갈리면 그게 전부다. */
  function findFlags(timeline, seen) {
    const out = [];
    for (const k of Object.keys(seen)) {
      let frames = 0, maxLen = 0, ok = true, changed = false, prev = null;
      for (const f of timeline) {
        const v = f.vars[k];
        if (v === undefined) continue;
        if (!Array.isArray(v) || !v.length || !v.every((x) => typeof x === "boolean")) {
          ok = false; break;
        }
        frames++;
        maxLen = Math.max(maxLen, v.length);
        if (prev && JSON.stringify(prev) !== JSON.stringify(v)) changed = true;
        prev = v;
      }
      if (!ok || frames < 2 || maxLen < 2 || maxLen > 200) continue;
      out.push({ kind: "flags", name: k, len: maxLen, changes: changed ? 1 : 0 });
    }
    return out;
  }

  /* ---------- 세는 딕셔너리 (Counter, 빈도수) ----------
   * {"a": 3, "b": 2} 는 변수 패널에 중괄호로만 찍혀서 "뭐가 제일 많나"가 안 보인다.
   * 키마다 가로 막대를 그리면 그게 한눈에 보인다.
   * 값이 리스트면 인접구조(그래프)이므로 여기 안 걸린다. */
  function findCounts(timeline, seen) {
    const out = [];
    for (const k of Object.keys(seen)) {
      let frames = 0, keys = new Set(), lo = Infinity, hi = -Infinity, ok = true;
      for (const f of timeline) {
        const v = f.vars[k];
        if (v === undefined) continue;
        if (!v || Array.isArray(v) || typeof v !== "object" || !Array.isArray(v.__dict__)) {
          ok = false; break;
        }
        if (!v.__dict__.every(([, val]) => isNum(val))) { ok = false; break; }
        frames++;
        for (const [key, val] of v.__dict__) {
          keys.add(dictKey(key));
          lo = Math.min(lo, val); hi = Math.max(hi, val);
        }
      }
      if (!ok || frames < 2 || keys.size < 2 || keys.size > 30) continue;
      if (!Number.isFinite(lo)) continue;
      // 한 번도 안 변하는 딕셔너리는 세는 게 아니라 **상수 표**다.
      // 수식 계산기의 prec = {"+": 1, "*": 2} 가 막대그래프로 떠서 화면을 먹었다.
      // 세는 딕셔너리의 서명은 "값이 자란다"는 것이다.
      if (!seen[k].changes) continue;
      out.push({ kind: "counts", name: k, keys: [...keys].sort(),
                 lo: Math.min(0, lo), hi: Math.max(hi, 1), changes: keys.size });
    }
    return out;
  }

  /* ---------- 메모이제이션 표 (튜플 키 딕셔너리) ----------
   * memo[(i, j)] = ... 로 채우는 재귀 DP 는 파이썬에서 제일 흔한 DP 모양인데
   * 딕셔너리라서 지금까지 화면에 아무것도 안 나왔다. 키가 전부 정수 두 개짜리
   * 튜플이면 그건 사실 2차원 표다. 표로 펴서 채워지는 순서를 보여준다.
   *
   * 재귀는 깊은 곳부터 값이 정해지므로, 칸이 어느 순서로 켜지는지가
   * "왜 이 순서로 계산되나"에 대한 답이 된다. 막대나 글자로는 안 보이는 것. */
  function findMemoGrids(timeline, seen) {
    const out = [];
    for (const k of Object.keys(seen)) {
      let frames = 0, ok = true, filled = 0;
      let r0 = Infinity, r1 = -Infinity, c0 = Infinity, c1 = -Infinity;
      let lo = Infinity, hi = -Infinity;
      for (const f of timeline) {
        const v = f.vars[k];
        if (v === undefined) continue;
        if (!v || Array.isArray(v) || typeof v !== "object" || !Array.isArray(v.__dict__)) {
          ok = false; break;
        }
        frames++;
        for (const [key, val] of v.__dict__) {
          if (!Array.isArray(key) || key.length !== 2 ||
              !Number.isInteger(key[0]) || !Number.isInteger(key[1]) || !isNum(val)) {
            ok = false; break;
          }
          r0 = Math.min(r0, key[0]); r1 = Math.max(r1, key[0]);
          c0 = Math.min(c0, key[1]); c1 = Math.max(c1, key[1]);
          lo = Math.min(lo, val); hi = Math.max(hi, val);
          filled = Math.max(filled, v.__dict__.length);
        }
        if (!ok) break;
      }
      // 빈 딕셔너리로 시작했다가 채워지는 게 메모의 서명이다.
      // 칸이 너무 넓으면 표로 못 그린다 (좌표 캐시 같은 건 여기 안 온다).
      if (!ok || frames < 2 || filled < 3) continue;
      if (!Number.isFinite(r0)) continue;
      const rows = r1 - r0 + 1, cols = c1 - c0 + 1;
      if (rows < 2 || cols < 2 || rows > 30 || cols > 30) continue;
      // 표가 너무 성기면 2차원 표가 아니라 그냥 쌍을 키로 쓴 딕셔너리다.
      if (filled < rows * cols * 0.3) continue;
      out.push({ kind: "memogrid", name: k, r0, c0, rows, cols,
                 lo: Math.min(0, lo), hi: Math.max(hi, 1), changes: filled });
    }
    return out;
  }

  /* ---------- 튜플 우선순위 큐 ----------
   * heapq 에 (거리, 노드) 를 넣는 다익스트라·프림·A* 는 시험 단골인데,
   * 값이 2열짜리 리스트라 지금까지 화면에 아예 안 나왔다.
   * 핵심은 "다음에 뭐가 꺼내지나"다. 맨 앞을 강조해서 줄로 세운다.
   *
   * 힙인지 아닌지는 이름(pq, heap)이 아니라 **성질**로 가른다:
   * 넣고 빼기를 둘 다 하고, 맨 앞이 거의 항상 첫 값이 가장 작은 원소여야 한다.
   * 그냥 쌍을 담아두는 리스트는 이 조건을 못 맞춘다. */
  function findPairHeaps(timeline, seen) {
    const out = [];
    // deque 는 heapq 가 못 쓴다. 뱀 시뮬레이션의 snake = deque([(r, c)]) 가
    // 앞에서 빼고 뒤에 넣는 바람에 "맨 앞이 늘 최소"를 우연히 만족했다.
    const isDeque = new Set();
    for (const f of timeline) for (const k of (f.deques || [])) isDeque.add(k);
    for (const k of Object.keys(seen)) {
      if (isDeque.has(k)) continue;
      let frames = 0, ok = true, grew = false, shrank = false;
      let rootOk = 0, rootTest = 0, maxRows = 0, prevLen = -1;
      for (const f of timeline) {
        const v = f.vars[k];
        if (v === undefined) continue;
        if (!Array.isArray(v)) { ok = false; break; }
        if (v.length && !(isNumGrid(v) && v[0].length === 2)) { ok = false; break; }
        frames++;
        maxRows = Math.max(maxRows, v.length);
        if (prevLen >= 0) {
          if (v.length > prevLen) grew = true;
          if (v.length < prevLen) shrank = true;
        }
        prevLen = v.length;
        if (v.length >= 2) {
          rootTest++;
          let mn = Infinity;
          for (const row of v) mn = Math.min(mn, row[0]);
          if (v[0][0] === mn) rootOk++;
        }
      }
      if (!ok || frames < 4 || !grew || !shrank || maxRows < 2) continue;
      if (rootTest < 3 || rootOk / rootTest < 0.9) continue;
      out.push({ kind: "pairheap", name: k, maxRows, changes: frames });
    }
    return out;
  }



  /* ---------- 좌표 평면 (산점도) ----------
   * `pts = [(2,3), (12,30), ...]` 를 2열 표로 그리면 숫자만 읽힌다.
   * "어느 두 점이 가까운가"는 표로는 절대 안 보이고 그림으로만 보인다.
   *
   * 쌍 목록이 좌표인지 구간인지 간선인지는 데이터만으로 못 가른다.
   * 근거는 코드에 있다 — **두 성분을 따로 꺼내 쓰면** 그건 x 와 y 다.
   *   pts[i][0] - pts[j][0]      -> "][0]" 과 "][1]" 이 둘 다 나온다
   *   for x, y in pts            -> 쌍으로 풀어 쓴다
   * 둘 다 없으면 안 그린다. 억지로 그리면 회의 시간표가 산점도가 된다. */
  function findScatter(timeline, seen, source, taken) {
    if (!source) return [];
    const flat = source.replace(/\s+/g, "");
    const out = [];
    for (const [k, st] of Object.entries(seen)) {
      if (taken.has(k) || !st.grid) continue;
      if (st.gridColSet.size !== 1 || !st.gridColSet.has(2)) continue;
      const byIndex = flat.includes(k + "[") && flat.includes("][0]") && flat.includes("][1]");
      // 역슬래시를 문자열 안에 쓰면 안 된다. \w 는 그냥 w 가 되고 \b 는
      // 백스페이스 문자(0x08)가 되어, 이 검사는 여태 한 번도 안 맞았다.
      // (그 바람에 for x, y in pts 꼴 좌표가 통째로 안 보였다)
      const word = "[A-Za-z0-9_]";
      const byUnpack = new RegExp("for" + word + "+," + word + "+in" + k +
                                  "[^A-Za-z0-9_]").test(flat + " ");
      if (!byIndex && !byUnpack) continue;

      let rows = 0, xlo = Infinity, xhi = -Infinity, ylo = Infinity, yhi = -Infinity;
      for (const f of timeline) {
        const v = f.vars[k];
        if (!isNumGrid(v) || !v.length || v[0].length !== 2) continue;
        rows = Math.max(rows, v.length);
        for (const [x, y] of v) {
          xlo = Math.min(xlo, x); xhi = Math.max(xhi, x);
          ylo = Math.min(ylo, y); yhi = Math.max(yhi, y);
        }
      }
      if (rows < 3 || rows > 200 || !Number.isFinite(xlo)) continue;
      if (xhi === xlo && yhi === ylo) continue;      // 한 점에 다 몰려 있으면 그림이 안 된다

      // 어느 점을 보고 있나 — 점 개수 범위에서 움직이는 정수
      const cursors = [];
      for (const [k2, s2] of Object.entries(seen)) {
        if (k2 === k || s2.arr || s2.grid || s2.adjHits || s2.charFrames) continue;
        if (!s2.allInt || s2.distinct.size < 2 || s2.gmin < 0 || s2.gmax >= rows) continue;
        if (cursors.length < 3) cursors.push(k2);
      }
      out.push({ kind: "scatter", name: k, rows, cursors,
                 xlo, xhi, ylo, yhi, changes: st.changes });
    }
    return out;
  }

  /* ---------- 레코드 표 (섞인 튜플 리스트) ----------
   * `people = [(21, 0, "Junkyu"), ...]` 처럼 숫자와 글자가 섞인 튜플 리스트는
   * 숫자 격자도 아니고 문자열도 아니라 지금까지 통째로 안 보였다.
   * 그런데 정렬 문제(나이순 정렬, 좌표 정렬)에서 이게 곧 문제의 데이터다.
   *
   * 표로 눕히면 정렬로 줄이 어떻게 뒤바뀌는지가 그대로 보인다.
   * 숫자만 든 튜플 리스트는 이미 다른 그림(격자·구간·산점도)이 맡으므로
   * **한 열이라도 숫자가 아닐 때만** 여기서 그린다. */
  const REC_ROWS = 40;
  const PAIR_ROWS = 24;
  const BUCKET_MAX = 16;

  /* ---------- 통 나누기 (기수·계수 정렬, 해시 체이닝) ----------
   * bucket = [[170, 90], [], [45], ...] 처럼 **길이가 제각각인 숫자 리스트의 리스트**.
   * 표도 아니고(행이 안 맞는다) 그래프도 아니다(값이 인덱스 범위를 넘는다).
   * 그래서 기수 정렬의 한복판이 통째로 안 보였다 — 정작 그 코드의 전부인데.
   *
   * 그래프와 헷갈릴 일은 없다. adjOf 가 "값이 이 리스트의 인덱스인가"로 먼저
   * 가려내기 때문에, 담긴 수가 인덱스 범위를 넘는 통은 거기서 이미 떨어진다.
   * 반대로 값이 전부 인덱스 범위 안이면 그건 정말 인접 리스트다. */
  function findBuckets(timeline, seen, drawn, claimed) {
    const out = [];
    for (const k of Object.keys(seen)) {
      if (drawn.has(k) || claimed.has(k)) continue;
      let ok = true, frames = 0, cols = 0, ragged = false, filled = false;
      let changed = false, prev = null;
      for (const f of timeline) {
        const v = f.vars[k];
        if (v === undefined) continue;
        if (!Array.isArray(v) || v.length < 2 || v.length > BUCKET_MAX) { ok = false; break; }
        const lens = new Set();
        for (const r of v) {
          if (!Array.isArray(r) || !r.every(isNum)) { ok = false; break; }
          lens.add(r.length);
          if (r.length) filled = true;
        }
        if (!ok) break;
        if (lens.size > 1) ragged = true;
        frames++;
        cols = Math.max(cols, v.length);
        const now = JSON.stringify(v);
        if (prev !== null && prev !== now) changed = true;
        prev = now;
      }
      // 행이 다 같은 길이면 그건 표다. 한 번도 안 차면 볼 게 없다.
      if (!ok || !ragged || !filled || !changed || frames < 2 || cols < 2) continue;
      out.push({ kind: "buckets", name: k, cols, changes: seen[k].changes });
    }
    return out;
  }


  /* ---------- 쌍 목록 (마지막에 줍는다) ----------
   * 하노이의 moves = [(1,3),(1,2), ...], 조합의 result = [(1,2),(1,3), ...] 처럼
   * **답이 쌓이는 자리**가 여태 통째로 안 보였다. 앞선 검출기들이 저마다의
   * 이유로 지나친 것들이다 — 구간 검출이 이름을 먼저 가져갔다가, "값이 전부
   * 그래프 노드면 구간이 아니다" 규칙에 걸려 그 블록이 지워지는 식이다.
   *
   * 그래서 **아무 그림도 못 받은 것만** 마지막에 줍는다. 이렇게 하면 다른
   * 그림을 뺏을 일이 없고, 검출기 사이 순서를 건드리지 않아도 된다. */
  function findPairLists(timeline, seen, drawn, claimed) {
    const out = [];
    for (const k of Object.keys(seen)) {
      if (drawn.has(k) || claimed.has(k)) continue;
      let ok = true, frames = 0, rows = 0, changed = false, prev = null;
      let lo = Infinity, hi = -Infinity;
      for (const f of timeline) {
        const v = f.vars[k];
        if (v === undefined) continue;
        if (!Array.isArray(v)) { ok = false; break; }
        for (const r of v) {
          if (!Array.isArray(r) || r.length !== 2 || !r.every(isNum)) { ok = false; break; }
          for (const x of r) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
        }
        if (!ok) break;
        frames++;
        rows = Math.max(rows, v.length);
        const now = JSON.stringify(v);
        if (prev !== null && prev !== now) changed = true;
        prev = now;
      }
      if (!ok || frames < 2 || rows < 2 || rows > PAIR_ROWS) continue;
      // 방향 표 (((1,0),(0,1),(-1,0),(0,-1)))는 한 번도 안 변하는 상수다.
      // 칩으로 늘어놓아 봐야 재생 내내 가만히 있으면서 자리만 먹는다.
      if (!changed && rows <= 8 && lo >= -1 && hi <= 1) continue;
      out.push({ kind: "pairs", name: k, rows, changes: seen[k].changes });
    }
    return out;
  }


  function findRecords(timeline, seen, taken) {
    const out = [];
    for (const k of Object.keys(seen)) {
      if (taken.has(k)) continue;
      let ok = true, frames = 0, rows = 0, cols = 0, anyText = false;
      for (const f of timeline) {
        const v = f.vars[k];
        if (v === undefined) continue;
        if (!Array.isArray(v)) { ok = false; break; }
        if (!v.length) continue;
        for (const row of v) {
          if (!Array.isArray(row) || row.length < 2 || row.length > 5) { ok = false; break; }
          if (cols && row.length !== cols) { ok = false; break; }
          cols = row.length;
          for (const cell of row) {
            if (typeof cell === "string") anyText = true;
            else if (!isNum(cell)) { ok = false; break; }
          }
        }
        if (!ok) break;
        frames++;
        rows = Math.max(rows, v.length);
      }
      if (!ok || !anyText || frames < 2 || rows < 2 || rows > REC_ROWS) continue;
      // 어느 줄을 보고 있나
      const cursors = [];
      for (const [k2, s2] of Object.entries(seen)) {
        if (k2 === k || s2.arr || s2.grid || s2.adjHits || s2.charFrames) continue;
        if (!s2.allInt || s2.distinct.size < 2 || s2.gmin < 0 || s2.gmax >= rows) continue;
        if (cursors.length < 3) cursors.push(k2);
      }
      out.push({ kind: "records", name: k, rows, cols, cursors, changes: seen[k].changes });
    }
    return out;
  }

  /* ---------- 순서 목록 ----------
   * `order = [1, 2, 4, 3]` 은 **방문 순서**지 크기가 아니다. 그런데 막대로 그리면
   * 4번 노드가 3번보다 "크게" 보인다 — 코드에 없는 뜻이 생긴다.
   *
   * 막대 높이는 값이 **양**일 때만 뜻이 있다. 값이 이름표(노드 번호)면
   * 순서대로 늘어놓은 칩이 맞는 그림이다.
   *
   * 이름표인지 아닌지는 근거로 가른다: **값이 전부 이 코드의 그래프 노드**여야 한다.
   * "작은 정수라 어떤 배열의 인덱스 범위에 든다" 는 근거가 못 된다 —
   * 실측해 보니 소인수분해의 f, 중앙값의 out, 동전 개수까지 죄다 걸렸다. */
  function labelSequences(timeline, arrays, graphs, roles) {
    const nodes = new Set();
    for (const g of graphs) for (const n of g.nodes) nodes.add(n);
    if (nodes.size < 3) return [];
    const out = [];
    for (const a of arrays) {
      if (roles[a.name] !== "쌓는 곳") continue;
      let seenAny = false, ok = true;
      for (const f of timeline) {
        const v = f.vars[a.name];
        if (!Array.isArray(v) || !v.length) continue;
        seenAny = true;
        for (const x of v) {
          if (!nodes.has(x)) { ok = false; break; }
        }
        if (!ok) break;
      }
      if (seenAny && ok) out.push(a);
    }
    return out;
  }

  /* ---------- 집합 ----------
   * visited = {1, 2, 3} 은 텍스트로만 보인다. 들어온 순서와 지금 크기가 보이게
   * 칩으로 늘어놓는다. 그래프의 방문 표시로 이미 쓰이고 있으면 거기서 보이므로 뺀다. */
  function findSets(timeline, seen) {
    const out = [];
    for (const k of Object.keys(seen)) {
      let frames = 0, maxSize = 0, ok = true, grew = false, prevSize = -1;
      for (const f of timeline) {
        const v = f.vars[k];
        if (v === undefined) continue;
        if (!v || Array.isArray(v) || typeof v !== "object" || !Array.isArray(v.__set__)) {
          ok = false; break;
        }
        frames++;
        maxSize = Math.max(maxSize, v.__set__.length);
        if (prevSize >= 0 && v.__set__.length !== prevSize) grew = true;
        prevSize = v.__set__.length;
      }
      if (!ok || frames < 2 || !grew || maxSize < 1 || maxSize > 40) continue;
      out.push({ kind: "setblock", name: k, changes: maxSize });
    }
    return out;
  }

  /* ---------- 구간 (회의실 배정, 스위핑) ----------
   * [(1,4), (3,5), ...] 처럼 (시작, 끝) 쌍이 늘어선 자료. 2열 표로 그리면
   * 숫자만 보여서 "어느 구간이 겹치나"가 안 보인다. 가로 막대로 눕히면 한눈에 보인다.
   *
   * 간선 리스트와 헷갈릴 수 있어서 조건을 세게 잡는다:
   * 모든 행에서 앞 <= 뒤 여야 한다. 간선 (2,1) 이나 하노이 이동 (3,2) 처럼
   * 뒤집힌 쌍이 하나라도 있으면 구간이 아니다. */
  function findIntervals(timeline, seen) {
    const out = [];
    for (const [k, st] of Object.entries(seen)) {
      if (!st.grid || st.gridColSet.size !== 1 || !st.gridColSet.has(2)) continue;
      let rows = 0, ok = true, lo = Infinity, hi = -Infinity, frames = 0;
      let wide = 0, flat = 0;
      for (const f of timeline) {
        const v = f.vars[k];
        if (!isNumGrid(v) || !v.length || v[0].length !== 2) continue;
        frames++;
        rows = Math.max(rows, v.length);
        for (const [a, b] of v) {
          if (a > b) { ok = false; break; }
          if (b > a) wide++; else flat++;
          lo = Math.min(lo, a); hi = Math.max(hi, b);
        }
        if (!ok) break;
      }
      // 진짜 구간 목록은 개수가 정해져 있다. 회의 N개를 받아 정렬하고 훑을 뿐,
      // 훑는 도중에 회의를 새로 만들지 않는다. 반면 백트래킹의 result 는
      // 답을 찾을 때마다 한 줄씩 늘어난다. 그건 구간이 아니라 "쌓는 곳"이다.
      if (st.gridRowSet.size !== 1) continue;
      if (!ok || rows < 3 || rows > 30 || frames < 2) continue;
      // 폭이 0 인 행이 많으면 구간이 아니라 좌표다.
      // pts = [(0,0), (3,4), (6,8), (1,1)] 이 우연히 전부 앞<=뒤 라서 구간으로 잡혔다.
      if (wide < (wide + flat) * 0.8) continue;
      if (!Number.isFinite(lo) || hi <= lo) continue;
      out.push({ kind: "intervals", name: k, rows, lo, hi, changes: st.changes });
    }
    return out;
  }

  /* 커서가 어느 칸에 있었는지를 프레임마다 적어 둔다.
   * 되감기(스크럽)를 해도 자취가 맞아야 하므로, 재생하며 쌓는 게 아니라
   * 미리 다 계산해 둔다. DP 역추적(LCS)은 "표를 거슬러 올라간 경로"가
   * 답 그 자체인데 지금은 커서 한 칸만 보여서 경로가 안 보였다. */
  function cursorTrack(timeline, cur) {
    const out = new Array(timeline.length);
    for (let t = 0; t < timeline.length; t++) {
      const r = timeline[t].vars[cur.row], c = timeline[t].vars[cur.col];
      out[t] = (Number.isInteger(r) && Number.isInteger(c)) ? [r, c] : null;
    }
    return out;
  }

  /* 경유지 축. 플로이드 워셜의 k 처럼 `d[i][k] + d[k][j]` 로 **같은 격자를
   * 다른 축으로** 뒤지는 변수가 있으면, 그 행과 열을 띠로 표시한다.
   * 표만 그리면 "지금 몇 번을 거쳐 가는 중인지"가 안 보인다.
   * 근거는 소스다 — 커서가 아닌 이름으로 그 격자를 첨자했는지 본다.
   * (변수 이름은 \w+ 뿐이라 정규식 이스케이프가 필요 없다.) */
  function viaAxis(source, seen, g) {
    if (!source || !g.cursor || !/^\w+$/.test(g.name)) return null;
    // 공백을 지운 소스에서 "격자[변수]" 를 그대로 찾는다. 정규식을 문자열로
    // 조립하면 백슬래시가 도구를 거치며 먹혀서 조용히 아무것도 안 잡는다.
    const flat = source.replace(/\s+/g, "");
    for (const [k, st] of Object.entries(seen)) {
      if (k === g.cursor.row || k === g.cursor.col) continue;
      if (st.arr || st.grid || st.adjHits || st.charFrames) continue;
      if (!st.allInt || st.distinct.size < 2) continue;
      // 진짜 경유지는 **양쪽 축에 다 쓰인다** — d[k][j] 와 d[i][k].
      // 한쪽 축에만 나오면 그냥 다른 좌표 변수다 (미로의 dist[r][c] 의 r).
      // 이 조건이 없으면 격자 문제마다 엉뚱한 행이 통째로 칠해진다.
      if (flat.includes(g.name + "[" + k + "]") && flat.includes("][" + k + "]")) return k;
    }
    return null;
  }

  /* 소스에 적힌 첨자로 커서를 찾는다.
   *
   * 값으로 찾는 findGridCursor 는 "바뀐 칸을 맞히는가"로 판정하므로
   * **안 변하는 격자**에는 못 쓴다. 그래서 지금까지 같은 크기의 다른 격자에서
   * 커서를 빌려 왔는데, 행렬 곱셈에서 그게 틀렸다 —
   * `C[i][j] += A[i][k] * B[k][j]` 인데 A 와 B 가 C 의 (i, j) 를 빌려 썼다.
   * A 는 i 행을, B 는 k 열을 보고 있는데 엉뚱한 칸에 테두리가 쳐진 것이다.
   *
   * 코드에 `A[i][k]` 라고 쓰여 있다. 그게 답이다. 빌리기보다 먼저 본다. */
  function sourceCursor(source, seen, name) {
    if (!source || !/^\w+$/.test(name)) return null;
    const flat = source.replace(/\s+/g, "");
    const ok = (k) => {
      const st = seen[k];
      return st && !st.arr && !st.grid && !st.adjHits && !st.charFrames &&
             st.allInt && st.distinct.size >= 2;
    };
    let at = 0;
    for (;;) {
      const i = flat.indexOf(name + "[", at);
      if (i < 0) return null;
      at = i + 1;
      const rest = flat.slice(i + name.length);
      const m = rest.match(/^\[(\w+)\]\[(\w+)\]/);
      if (m && ok(m[1]) && ok(m[2]) && m[1] !== m[2]) return { row: m[1], col: m[2], src: true };
    }
  }

  /* ---------- 좌표 집합을 격자 위에 켠다 ----------
   * 파이썬 격자 BFS 의 표준 꼴은 `visited = set()` 에 `(r, c)` 튜플을 넣는 것이다.
   * 지금까지 그 집합은 칩 목록으로만 보였고, **정작 격자에는 아무 표시도 없었다.**
   * "어디를 이미 갔나"는 칩에 적힌 좌표를 눈으로 격자에 옮겨 그려야 알 수 있었다.
   *
   * 집합의 원소가 전부 그 격자 안의 (행, 열) 이면 그 칸을 켠다.
   * 범위 밖 좌표가 하나라도 있으면 다른 뜻의 집합이라 안 켠다. */
  function gridVisitSets(timeline, seen, grids, charGrids) {
    const all = [...grids, ...charGrids];
    if (!all.length) return;
    for (const g of all) {
      if (!g.dims && !g.rows) continue;
      let R = g.rows, C = g.cols;
      if (!R && g.dims) { const p = g.dims.split("x"); R = +p[0]; C = +p[1]; }
      if (!R || !C) continue;
      let best = null;
      for (const k of Object.keys(seen)) {
        let frames = 0, ok = 0, bad = 0, most = 0;
        for (const f of timeline) {
          const v = f.vars[k];
          if (!v || Array.isArray(v) || typeof v !== "object" || !Array.isArray(v.__set__)) continue;
          frames++;
          most = Math.max(most, v.__set__.length);
          for (const m of v.__set__) {
            if (Array.isArray(m) && m.length === 2 &&
                Number.isInteger(m[0]) && Number.isInteger(m[1]) &&
                m[0] >= 0 && m[0] < R && m[1] >= 0 && m[1] < C) ok++;
            else bad++;
          }
        }
        if (!frames || bad || ok < 2 || most < 2) continue;
        if (!best || most > best.most) best = { name: k, most };
      }
      if (best) g.visitSet = best.name;
    }
  }

  /* ---------- 2차원 참/거짓 표 ----------
   * `pal[i][j] = True` 같은 표는 숫자 격자도 문자 격자도 아니라 통째로 안 보였다.
   * 회문 분할 DP, 도달 가능성 표, 방문 격자가 다 이 모양이다.
   * 1차원 bool 배열(체·visited)은 이미 flags 로 그리고 있었는데 2차원만 빠져 있었다.
   *
   * 0/1 지도와 똑같이 "찼나 비었나"로 그린다 — 값의 크기가 아니라 켜짐/꺼짐이 전부다. */
  function findBoolGrids(timeline, seen) {
    const out = [];
    for (const k of Object.keys(seen)) {
      let frames = 0, ok = true, rows = 0, cols = 0, on = 0, off = 0;
      for (const f of timeline) {
        const v = f.vars[k];
        if (v === undefined) continue;
        if (!Array.isArray(v) || !v.length) { ok = false; break; }
        for (const row of v) {
          if (!Array.isArray(row) || !row.length) { ok = false; break; }
          for (const x of row) {
            if (typeof x !== "boolean") { ok = false; break; }
            if (x) on++; else off++;
          }
          if (!ok) break;
          cols = Math.max(cols, row.length);
        }
        if (!ok) break;
        frames++;
        rows = Math.max(rows, v.length);
      }
      if (!ok || frames < 2 || !on) continue;
      if (rows < 2 || cols < 2 || rows > 30 || cols > 30) continue;
      out.push({ kind: "grid", name: k, boolean: true, binary: true,
                 gmin: 0, gmax: 1, cap: 1, dims: rows + "x" + cols,
                 changes: seen[k].changes });
    }
    return out;
  }

  /* ---------- 격자 위 현재 위치 ----------
   * 격자 문제(미로 BFS, 시뮬레이션)는 "지금 어느 칸을 보고 있나"가 핵심인데
   * 표만 그리면 그게 안 보인다. r, c 를 이름으로 찾으면 nr/nc, x/y, i/j 로
   * 갈아입을 때마다 깨지므로 **예측력으로** 찾는다:
   * 어떤 (a, b) 쌍이 가리킨 칸이 실제로 바뀐 칸과 일치하는 횟수를 센다.
   * 진짜 커서는 자기가 가리킨 칸을 바꾸고, 우연히 범위에 든 변수는 못 맞춘다. */
  function findGridCursor(timeline, seen, grid, isChars) {
    const cands = [];
    for (const [k, st] of Object.entries(seen)) {
      if (st.arr || st.grid || st.adjHits || st.charFrames) continue;
      if (!st.allInt || st.numFrames < 4 || st.distinct.size < 2) continue;
      // nr = r + dr 은 범위 밖(-1)로 잠깐 나갔다 온다. 그걸로 후보에서 빼면
      // 정작 격자 문제의 진짜 커서를 놓친다. 표시할 때 범위를 다시 보므로 안전하다.
      if (st.gmin < -2 || st.gmax > 60) continue;
      cands.push(k);
    }
    if (cands.length < 2) return null;

    // 한 칸만 바뀐 프레임들을 모은다. 거기가 정답지다.
    const marks = [];
    let prev = null;
    for (const f of timeline) {
      const v = f.vars[grid];
      const shaped = isChars
        ? (Array.isArray(v) && v.length && v.every((r) => Array.isArray(r)))
        : isNumGrid(v);
      if (!shaped) { prev = null; continue; }
      if (prev && prev.length === v.length && prev[0].length === v[0].length) {
        let hit = null, count = 0;
        for (let r = 0; r < v.length && count < 2; r++) {
          for (let c = 0; c < v[r].length; c++) {
            if (prev[r][c] !== v[r][c]) { hit = [r, c]; if (++count > 1) break; }
          }
        }
        if (count === 1) marks.push({ vars: f.vars, at: hit });
      }
      prev = v;
      if (marks.length >= 400) break;
    }
    if (marks.length < 3) return null;

    let best = null;
    for (const a of cands) {
      for (const b of cands) {
        if (a === b) continue;
        let hit = 0;
        for (const m of marks) {
          if (m.vars[a] === m.at[0] && m.vars[b] === m.at[1]) hit++;
        }
        if (hit >= 3 && (!best || hit > best.hit)) best = { row: a, col: b, hit };
      }
    }
    if (!best || best.hit < marks.length * 0.4) return null;
    return best;
  }

  /* ---------- 격자 위에서 어느 쪽을 보고 있나 ----------
   * 로봇 청소기·뱀·상어 같은 시뮬레이션은 "지금 어느 방향을 보고 있나"가 절반이다.
   * 그런데 방향은 `d` 라는 정수 하나에만 들어 있어서 변수 상자에 숫자로만 떴다.
   *
   * 판정은 **예측력**으로 한다 (격자 커서를 찾을 때와 같은 방법).
   * 커서가 실제로 움직인 만큼을 dr[d], dc[d] 가 맞히는가.
   *   - 어느 쪽이 dr 이고 어느 쪽이 dc 인지도 이걸로 갈린다 (이름은 못 믿는다)
   *   - BFS 처럼 네 방향을 매번 다 훑는 코드는 못 맞힌다. 그게 맞다 —
   *     BFS 에는 "바라보는 방향" 이란 게 없으니 화살표를 그리면 거짓말이다 */
  function findFacing(timeline, seen, dirNames, cursor) {
    if (!cursor || dirNames.length < 2) return null;
    const arrs = dirNames.filter((k) => seen[k].maxLen >= 2 && seen[k].maxLen <= 8);
    const cands = [];
    for (const k of Object.keys(seen)) {
      const st = seen[k];
      if (st.arr || st.grid || st.adjHits || st.charFrames) continue;
      if (!st.allInt || st.gmin < 0 || st.gmax > 8) continue;
      if (st.distinct.size < 2 || st.numFrames < 4) continue;
      cands.push(k);
    }
    if (!arrs.length || !cands.length) return null;

    let best = null;
    for (const A of arrs) {
      for (const B of arrs) {
        if (A === B) continue;
        for (const d of cands) {
          let hit = 0, moves = 0;
          for (let t = 1; t < timeline.length; t++) {
            const p = timeline[t - 1].vars, q = timeline[t].vars;
            const r0 = p[cursor.row], c0 = p[cursor.col];
            const r1 = q[cursor.row], c1 = q[cursor.col];
            if (![r0, c0, r1, c1].every(Number.isInteger)) continue;
            if (r0 === r1 && c0 === c1) continue;
            const dv = p[d], av = p[A], bv = p[B];
            if (!Number.isInteger(dv) || !Array.isArray(av) || !Array.isArray(bv)) continue;
            if (dv < 0 || dv >= av.length || dv >= bv.length) continue;
            moves++;
            if (r1 - r0 === av[dv] && c1 - c0 === bv[dv]) hit++;
          }
          if (moves < 3 || hit < 3 || hit / moves < 0.6) continue;
          if (!best || hit > best.hit) best = { dr: A, dc: B, d, hit };
        }
      }
    }
    return best;
  }

  /* 코드에 `arr[i]` 라고 쓰여 있으면 i 는 arr 의 인덱스다. 값으로 추정하는 것보다
   * 훨씬 확실하다. 여러 배열에 쓰였으면 가장 많이 쓰인 쪽으로 본다. */
  function findTries(timeline, seen) {
    const out = [];
    for (const k of Object.keys(seen)) {
      const acc = { nodes: new Map(), edges: new Map(), dicts: 0 };
      let frames = 0, lastCount = 0;
      for (const f of timeline) {
        const v = f.vars[k];
        if (!v || Array.isArray(v) || typeof v !== "object" || !Array.isArray(v.__dict__)) continue;
        frames++;
        trieNodes(v, "", 0, acc);
        const one = { nodes: new Map(), edges: new Map(), dicts: 0 };
        trieNodes(v, "", 0, one);
        lastCount = one.nodes.size;          // 마지막으로 본 프레임의 크기
      }
      // 딕셔너리가 두 겹 이상 겹쳐야 트리다. 평범한 dict 는 여기 안 걸린다.
      if (frames < 2 || acc.dicts < 2 || acc.nodes.size < 3 || acc.nodes.size > 60) continue;
      acc.nodes.set("", { key: k, terminal: false });        // 뿌리
      const paths = [...acc.nodes.keys()].sort();
      const id = new Map(paths.map((pth, i) => [pth, i]));
      out.push({
        kind: "trie", name: k,
        nodes: paths.map((pth) => id.get(pth)),
        paths, meta: paths.map((pth) => acc.nodes.get(pth)),
        edges: [...acc.edges.values()]
          .filter(([a, b]) => id.has(a) && id.has(b))
          .map(([a, b, lab]) => [id.get(a), id.get(b), lab]),
        idOf: (pth) => id.get(pth),
        frames,
        keep: lastCount / Math.max(1, acc.nodes.size),
        changes: 1e7,
      });
    }
    // 트리 안을 돌아다니는 커서 변수(node = node[ch])도 중첩 딕셔너리라 같이 잡힌다.
    // 크기로 고르면 안 된다 — 커서는 여러 서브트리를 훑어서 합집합이 오히려 더 크다.
    // 진짜 트리는 **마지막에도 자기가 가졌던 걸 다 갖고 있다.**
    // 커서는 끝에 작은 가지 하나만 쥐고 있으므로 이 비율로 갈린다.
    if (out.length > 1) {
      out.sort((a, b) => b.keep - a.keep || b.nodes.length - a.nodes.length);
      return [out[0]];
    }
    return out;
  }

  /* ---------- 스택 / 큐 ----------
   * 리스트가 값을 담는 그릇이 아니라 "쌓았다 빼는" 용도로 쓰이면 막대는 무의미하다.
   * 괄호 검사의 stack 은 1 만 잔뜩 들어 있고, BFS 의 큐는 좌표 튜플이 들어 있다.
   * 중요한 건 값의 크기가 아니라 몇 개가 어느 순서로 들어 있느냐다.
   *
   * 넣는 쪽은 둘 다 뒤라서 구별이 안 되고, **빼는 쪽**으로 갈린다:
   *   - 뒤에서 뺀다 (새 값이 옛 값의 앞부분) -> 스택
   *   - 앞에서 뺀다 (새 값이 옛 값의 뒷부분) -> 큐
   * 힙은 pop 할 때 순서가 통째로 바뀌므로 여기 안 걸린다 (그건 힙으로 그린다). */
  function findContainers(timeline, seen) {
    const out = [];
    const isDeque = new Set();
    for (const f of timeline) for (const k of (f.deques || [])) isDeque.add(k);
    for (const k of Object.keys(seen)) {
      const vals = [];
      for (const f of timeline) {
        const v = f.vars[k];
        if (Array.isArray(v)) vals.push(v);
        else if (v === undefined) continue;
        else vals.push(null);
      }
      const lists = vals.filter((v) => v !== null);
      if (lists.length < 3) continue;
      const maxLen = Math.max(...lists.map((v) => v.length));
      if (maxLen < 1 || maxLen > 30) continue;
      if (new Set(lists.map((v) => v.length)).size < 2) continue;

      let popEnd = 0, popFront = 0, pushEnd = 0, weird = 0, ambig = 0;
      for (let i = 1; i < vals.length; i++) {
        const a = vals[i - 1], b = vals[i];
        if (!a || !b || a.length === b.length) continue;
        if (b.length < a.length) {
          const kk = a.length - b.length;
          // 스택·큐는 한 개씩 뺀다. 한 번에 여러 개가 사라지는 건 함수가 다시
          // 불려서 지역 리스트가 초기화된 것이다 (병합정렬의 out).
          if (kk !== 1) { weird++; continue; }
          const isPrefix = b.every((x, j) => sameCell(x, a[j]));
          const isSuffix = b.every((x, j) => sameCell(x, a[j + kk]));
          // 마지막 하나를 빼면 결과가 빈 배열이라 앞에서 뺀 것도 뒤에서 뺀 것도
          // 동시에 성립한다. 이걸 한쪽으로 세면 큐가 스택으로 뒤집힌다.
          if (isPrefix && isSuffix) ambig++;      // 값이 같아서 어느 쪽인지 모름
          else if (isPrefix) popEnd++;
          else if (isSuffix) popFront++;
          else weird++;
        } else {
          if (a.every((x, j) => sameCell(x, b[j]))) pushEnd++;
          else weird++;
        }
      }
      const pops = popEnd + popFront + ambig;
      // 넣는 걸 요구하면 안 된다. 요세푸스처럼 deque(range(n)) 로 한 번 채우고
      // 빼기만 하는 큐가 통째로 빠진다. 빼는 게 있으면 컨테이너다.
      // (쌓기만 하는 결과 리스트는 pops 가 0 이라 알아서 걸러진다)
      if (pops < 2) continue;
      if (weird > (pops + pushEnd) * 0.2) continue;      // 중간을 헤집으면 컨테이너가 아니다
      // 값으로 못 가리면 원래 타입을 본다. deque 면 큐, 그냥 리스트면 스택.
      let mode;
      if (popEnd !== popFront) mode = popEnd > popFront ? "stack" : "queue";
      else mode = isDeque.has(k) ? "queue" : "stack";
      out.push({ kind: "container", name: k, maxLen, mode, changes: seen[k].changes });
    }
    return out;
  }

  /* ---------- 클래스로 만든 객체 (연결리스트·트리 노드) ----------
   * tracer 가 프레임마다 objs 표를 남긴다. 본문에는 {__ref__: 번호} 만 있고
   * 실제 내용은 표에 있다. 그 참조를 간선으로 삼아 노드-링크 그림을 그린다.
   * 순환(prev, parent)이 있어도 표 구조라 안전하다. */
  function findObjects(timeline) {
    // 한 시점만 보면 안 된다. head.next.next.next = Node(4) 처럼 만들고 잇는 사이에는
    // "노드는 다 있는데 마지막 간선이 아직 없는" 프레임이 있어서, 그걸 배치 기준으로
    // 잡으면 마지막 화살표를 영영 안 그린다. 전체 프레임의 합집합을 쓴다.
    const nodeSet = new Set();
    const edgeMap = new Map();          // "a>b" -> [a, b, 필드이름]
    let cls = null;
    for (const f of timeline) {
      const g = objGraph(f);
      if (!g) continue;
      for (const id of g.nodes) {
        nodeSet.add(id);
        if (!cls && g.objs[id] && g.objs[id].cls) cls = g.objs[id].cls;
      }
      for (const [a, b, fk] of g.edges) edgeMap.set(a + ">" + b, [a, b, fk]);
    }
    if (nodeSet.size < 2 || nodeSet.size > 40 || !edgeMap.size) return [];
    return [{ kind: "objects", name: cls || "객체",
              nodes: [...nodeSet].sort((a, b) => a - b),
              edges: [...edgeMap.values()], changes: 1e8 }];
  }

  /* ---------- 힙 배열 ----------
   * heapq 가 쓰는 리스트는 사실 완전이진트리다. 막대로 그리면 부모-자식 관계가
   * 안 보여서 "왜 이 값이 먼저 나오나"를 읽을 수 없다.
   *
   * 판정 조건 (넷 다 만족해야 한다. 하나라도 어긋나면 그냥 배열로 둔다):
   *   - 모든 프레임에서 힙 성질이 성립 (최소힙이든 최대힙이든 한쪽으로 일관되게)
   *   - 정렬돼 있지 않은 순간이 한 번은 있다 (늘 정렬이면 그냥 정렬된 배열이다)
   *   - 길이가 한 번은 줄어든다 (힙은 넣고 뺀다. 결과 리스트는 쌓이기만 한다)
   *   - 값이 변하고 4칸 이상  */
  function findHeaps(timeline, seen) {
    const out = [];
    for (const [k, s] of Object.entries(seen)) {
      if (!s.arr || s.maxLen < 3 || s.maxLen > 40 || !s.changes) continue;
      let minOk = true, maxOk = true, sawUnsorted = false, frames = 0;
      let shrank = false, prevLen = -1;
      const lens = new Set();
      for (const f of timeline) {
        const v = f.vars[k];
        if (!isNumList(v)) continue;
        frames++;
        lens.add(v.length);
        if (prevLen >= 0 && v.length < prevLen) shrank = true;
        prevLen = v.length;
        for (let i = 0; i < v.length; i++) {
          for (const c of [2 * i + 1, 2 * i + 2]) {
            if (c >= v.length) continue;
            if (v[i] > v[c]) minOk = false;
            if (v[i] < v[c]) maxOk = false;
          }
        }
        for (let i = 1; i < v.length; i++) {
          if (v[i] < v[i - 1]) { sawUnsorted = true; break; }
        }
        if (!minOk && !maxOk) break;
      }
      if (frames < 3 || lens.size < 2) continue;
      if (!(minOk || maxOk) || !sawUnsorted) continue;
      // 결과 리스트(order, out)는 쌓이기만 한다. 힙은 넣고 뺀다.
      // 이게 없으면 BFS 방문 순서 [1,2,4,3] 이 우연히 힙 성질을 만족해 힙으로 잡힌다.
      if (!shrank || s.maxLen < 4) continue;
      out.push({ kind: "heap", name: k, len: s.maxLen, isMin: minOk, changes: s.changes });
    }
    return out;
  }

  /* ---------- 부모 포인터 배열 (유니온 파인드) ----------
   * parent = [0, 1, 1, 1, 3, 1] 같은 배열은 값이 아니라 "누가 누구를 가리키나"가
   * 전부다. 막대로 그리면 높이에 아무 의미가 없어서 읽을 수가 없다.
   * 칸을 한 줄로 놓고 i -> parent[i] 를 위쪽 곡선으로 그린다.
   *
   * 판정 조건 (하나라도 어긋나면 그냥 배열로 둔다):
   *   - 모든 프레임에서 값이 전부 자기 배열의 유효한 인덱스
   *   - 자기 자신을 가리키지 않는 칸이 한 번은 있다 (안 그러면 그냥 0..n-1 나열)
   *   - 따라가면 항상 끝난다 (2칸 이상 순환이 없다)  */
  /* dist[v] = dist[u] + 1 처럼 **자기 값에 수를 더해** 채우는 배열은
   * 거리·DP 표지 포인터가 아니다. 값만 보면 "다들 앞을 가리킨다"를 만족해
   * 화살표 그림으로 잡히는데, 그건 뜻이 없는 그림이다 (BFS 거리에서 실제로 그랬다).
   * 부모 배열은 par[v] = u 처럼 **다른 값을 그대로** 넣는다 — 덧셈이 없다. */
  function selfAdded(source, name) {
    if (!source) return false;
    const lines = source.split(String.fromCharCode(10));
    for (const raw of lines) {
      const line = raw.split("#")[0];
      const at = assignPos(line);
      if (at < 0) continue;
      const lhs = line.slice(0, at), rhs = line.slice(at + 1);
      if (lhs.indexOf(name + "[") < 0) continue;
      if (rhs.indexOf(name + "[") < 0) continue;
      if (rhs.indexOf("+") >= 0 || rhs.indexOf("-") >= 0) return true;
    }
    return false;
  }

  /* 대입 기호 = 의 자리. ==, <=, >=, != 와 괄호 안은 뺀다. */
  function assignPos(line) {
    let depth = 0;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
      else if (c === "=" && depth === 0) {
        if (line[i + 1] === "=") return -1;
        if (i > 0 && "=!<>+-*/%".indexOf(line[i - 1]) >= 0) continue;
        return i;
      }
    }
    return -1;
  }

  function parentForests(timeline, seen, source) {
    const out = [];
    for (const [k, s] of Object.entries(seen)) {
      if (!s.arr || s.maxLen < 3 || s.maxLen > 40) continue;
      // 방향 벡터(dr = [-1, 0, 1, 0])는 안 변하고, 값이 -1~1 이고, 짧다.
      // 우연히 "자기보다 앞을 가리킨다"를 만족하지만 포인터가 아니라 상수 표다.
      // 배열 목록에서 이미 빼고 있는 것과 같은 조건으로 여기서도 뺀다.
      if (!s.changes && s.maxLen <= 8 && s.gmin >= -1 && s.gmax <= 1) continue;
      if (selfAdded(source, k)) continue;   // 거리·DP 표는 포인터가 아니다
      let okFrames = 0, sawLink = false, bad = false, sawAllSelf = false;
      let backward = true, kinds = new Set(), firstSeen = true;
      const lens = new Set();
      for (const f of timeline) {
        const v = f.vars[k];
        if (!isNumList(v)) continue;
        const n = v.length;
        for (let i = 0; i < n; i++) {
          // -1 은 "부모 없음"(뿌리)을 뜻하는 흔한 표시라 받아준다
          if (!Number.isInteger(v[i]) || v[i] < -1 || v[i] >= n) { bad = true; break; }
          if (v[i] !== i) sawLink = true;
          if (i >= 1 && v[i] >= i) backward = false;
          if (kinds.size < 12) kinds.add(v[i]);
        }
        if (bad) break;
        if (v.some((x) => x < 0)) {
          // -1 이 섞이면 자기를 가리키는 유니온 파인드는 아니다. 뒤를 가리키는
          // 포인터 배열인지만 본다 (순환은 v[i] < i 라 있을 수 없다).
        } else {
          for (let i = 0; i < n && !bad; i++) {          // 순환 검사
            let cur = i, steps = 0;
            while (v[cur] !== cur) {
              cur = v[cur];
              if (++steps > n) { bad = true; break; }
            }
          }
          if (bad) break;
          // **처음에** 모든 칸이 자기를 가리켜야 한다. 아무 때나 보면
          // 타잔의 idx(발견 시각)가 끝에 [0,1,2,...] 가 되면서 부모 배열로 잡힌다.
          // 길이 3 이상일 때만 뜻이 있다 — digits 는 [0] 한 칸으로 시작해 거저 통과했다.
          if (firstSeen && n >= 3 && v.every((x, i) => x === i)) sawAllSelf = true;
        }
        lens.add(n);
        firstSeen = false;
        okFrames++;
      }
      if (bad || !sawLink || okFrames < 2 || lens.size > 1) continue;

      // 화살표로 그릴 만한 서명은 둘이다.
      //   1) 처음에 모든 칸이 자기를 가리킨다  -> 유니온 파인드
      //   2) 모든 칸이 자기보다 **앞**을 가리킨다 -> KMP 실패함수, LCA 부모 배열
      // 2번에는 "서로 다른 값 3개 이상"이 반드시 필요하다. 이게 없으면
      // 위상정렬의 indeg([0,0,0,...])나 회문 DP 의 cut 처럼 값이 한두 가지뿐인
      // 배열이 죄다 "뒤를 가리킨다"로 통과한다 (실측으로 걸렀다).
      const pointsBack = backward && kinds.size >= 3;
      if (!sawAllSelf && !pointsBack) continue;
      out.push({ kind: "forest", name: k, len: s.maxLen, changes: s.changes,
                 rooted: !sawAllSelf });
    }
    return out;
  }

  /* ---------- 호출 스택 ----------
   * tracer 가 프레임마다 남긴 depth 로 매 시점의 스택을 되살린다.
   * call 이벤트의 지역변수가 곧 그 호출에 넘어온 인자다.
   * 재귀는 "들어갔다 나오는 것"이 본질인데, 그게 이 블록에만 보인다. */
  /* ---------- 재귀 호출 트리 ----------
   * 호출 스택은 "지금 어디까지 파고들었나"는 보여주지만
   * **전부 몇 번 불렸나**는 못 보여준다. fib(6) 은 25번 불리는데 스택은 최대 6칸이다.
   * 그래서 "왜 지수 시간인가"가 그림에서 안 보였다.
   *
   * 호출 하나를 점 하나로 놓고, 부른 관계를 선으로 잇는다. 같은 fib(3) 이
   * 여러 갈래에서 다시 계산되는 게 눈에 보인다 — 메모이제이션과의 대비가
   * 바로 이 그림이다.
   *
   * 갈라지지 않는 재귀(팩토리얼)는 안 그린다. 한 줄로 늘어선 트리는
   * 호출 스택과 똑같은 그림이라 화면만 두 배로 먹는다. */
  const CALL_MAX = 160;

  function buildCallTree(timeline) {
    const nodes = [];
    const stack = [];                      // 지금 열려 있는 호출의 id
    for (let t = 0; t < timeline.length; t++) {
      const f = timeline[t];
      const d = f.depth || 0;
      if (f.event === "call") {
        if (d < 1) continue;
        stack.length = Math.min(stack.length, d - 1);
        if (nodes.length >= CALL_MAX) return null;   // 너무 크면 그림이 아니라 얼룩이 된다
        const id = nodes.length;
        nodes.push({
          id, parent: d >= 2 ? stack[d - 2] : -1, depth: d,
          func: f.func, args: resolveArgs(f.args || f.vars, f.objs),
          start: t, end: timeline.length - 1, ret: undefined,
        });
        stack[d - 1] = id;
        stack.length = d;
      } else if (f.event === "return") {
        if (d >= 1 && stack.length >= d) {
          const n = nodes[stack[d - 1]];
          if (n) { n.end = t; n.ret = f.ret; }
          stack.length = d - 1;
        }
      } else {
        stack.length = Math.min(stack.length, d);
      }
    }
    if (nodes.length < 5) return null;

    // 갈라지는 데가 한 군데도 없으면 호출 스택과 같은 그림이다
    const kidCount = {};
    for (const n of nodes) if (n.parent >= 0) kidCount[n.parent] = (kidCount[n.parent] || 0) + 1;
    if (!Object.values(kidCount).some((c) => c >= 2)) return null;

    // 잎 x 좌표는 반드시 DFS 순서로. BFS 로 매기면 형제 subtree 의 잎이 뒤섞여
    // 부모끼리 같은 자리에 겹친다 (트리 배치에서 이미 한 번 당했다).
    const kids = {};
    for (const n of nodes) (kids[n.parent] || (kids[n.parent] = [])).push(n.id);
    let leaf = 0;
    const place = (id) => {
      const cs = kids[id] || [];
      if (!cs.length) { nodes[id].col = leaf++; return; }
      for (const c of cs) place(c);
      nodes[id].col = (nodes[cs[0]].col + nodes[cs[cs.length - 1]].col) / 2;
    };
    for (const r of (kids[-1] || [])) place(r);

    let deepest = 0;
    for (const n of nodes) deepest = Math.max(deepest, n.depth);
    return { kind: "calltree", name: "호출 트리", nodes, cols: leaf, deepest,
             func: nodes[0].func, changes: 1e9, rank: 0 };
  }

  function buildStacks(timeline) {
    let deepest = 0;
    for (const f of timeline) deepest = Math.max(deepest, f.depth || 0);
    if (deepest < 1) return null;              // 함수 호출이 없으면 그릴 게 없다

    const out = new Array(timeline.length);
    let st = [];
    for (let t = 0; t < timeline.length; t++) {
      const f = timeline[t];
      const d = f.depth || 0;
      if (f.event === "call") {
        st = st.slice(0, Math.max(0, d - 1));
        if (d > 0) st.push({ func: f.func, args: resolveArgs(f.args || f.vars, f.objs), line: f.line });
      } else {
        // line/return 이 depth d 라면 스택에는 정확히 d 개가 쌓여 있어야 한다.
        // 잘라내기만 하면 반환은 저절로 처리된다.
        st = st.slice(0, d);
      }
      // 맨 위 프레임만 현재 줄을 갱신한다. 아래 프레임들은 자식을 부른 그 줄에
      // 멈춰 있으므로 그대로 두는 게 맞다.
      if (f.event === "line" && d > 0 && st.length === d) st[d - 1].line = f.line;
      const snap = st.map((x) => ({ func: x.func, args: x.args, line: x.line }));
      if (f.event === "return" && snap.length) {
        snap[snap.length - 1].ret = f.ret;     // 이 프레임에서만 반환값을 보여준다
      }
      out[t] = snap;
    }
    return { frames: out, deepest };
  }

  /* 인자가 객체면 Node(3) 처럼 클래스와 대표값으로 풀어 쓴다.
   * 안 그러면 호출 스택에 walk(n=[object Object]) 가 뜬다. */
  /* {__ref__: 3} 을 Node(3) 처럼 읽히게 바꾼다. 표가 없으면 그대로 둔다. */
  /* ---------- 간선 리스트 -> 그래프 (크루스칼) ----------
   * `[(1,4), (3,5)]` 이 간선인지 구간인지 좌표인지는 **데이터만으로 구별할 수 없다.**
   * 그래서 지금까지 일부러 안 그렸다. 회의실 예약이 12노드 그래프가 되는 게
   * 못 그리는 것보다 나쁘기 때문이다.
   *
   * 그런데 근거가 하나 생겼다. **같은 코드에 유니온 파인드 부모 배열이 있고**
   * 쌍의 숫자가 전부 그 배열의 인덱스면, 그건 간선이다. 다른 해석이 없다.
   * 크루스칼·MST 는 시험 단골인데 지금 그래프가 통째로 안 나온다.
   *
   * 열이 셋이면 하나는 가중치다. 크루스칼은 가중치로 정렬하므로
   * **정렬된 열이 곧 가중치**다 (edges.sort() 는 첫 열 기준). */
  /* 간선 리스트라는 **증인**을 소스에서 하나 더 찾는다.
   *
   *     for u, v, w in edges:
   *         if dist[u] + w < dist[v]:
   *
   * 쌍 목록을 풀어서 나온 이름으로 어떤 배열을 첨자하고 있으면, 그 이름들은
   * 그 배열의 인덱스 = 노드 번호다. 벨만-포드가 그래프 없이 표로만 나오던 걸
   * 이걸로 잡는다. 유니온 파인드 부모 배열과 같은 역할의 증인이다. */
  function edgeWitnesses(source, seen, arrays) {
    const out = [];
    if (!source) return out;
    const flat = source.replace(/\s+/g, "");
    for (const m of source.matchAll(/\bfor\s+([\w\s,]+?)\s+in\s+([A-Za-z_]\w*)\s*:/g)) {
      const names = m[1].split(",").map((x) => x.trim()).filter((x) => /^\w+$/.test(x));
      if (names.length < 2) continue;
      for (const a2 of arrays) {
        if (!/^\w+$/.test(a2.name)) continue;
        if (names.some((nm) => flat.includes(a2.name + "[" + nm + "]"))) {
          out.push({ name: a2.name, len: a2.len, of: m[2] });
        }
      }
    }
    return out;
  }

  function findEdgeGraphs(timeline, seen, forests, taken) {
    if (!forests.length) return [];
    const out = [];
    for (const [k, st] of Object.entries(seen)) {
      if (taken.has(k) || !st.grid) continue;
      if (st.gridColSet.size !== 1) continue;
      const cols = [...st.gridColSet][0];
      if (cols !== 2 && cols !== 3) continue;

      for (const fo of forests) {
        const n = fo.len;
        if (!n || n < 3) continue;
        // 열마다 "노드 번호처럼 생겼나"를 본다
        const inRange = new Array(cols).fill(true);
        const sortedBy = new Array(cols).fill(true);
        let rows = 0, seenAny = false;
        for (const f of timeline) {
          const v = f.vars[k];
          if (!isNumGrid(v) || !v.length || v[0].length !== cols) continue;
          seenAny = true;
          rows = Math.max(rows, v.length);
          for (let c = 0; c < cols; c++) {
            for (let r = 0; r < v.length; r++) {
              const x = v[r][c];
              if (!Number.isInteger(x) || x < 0 || x >= n) inRange[c] = false;
              if (r && v[r][c] < v[r - 1][c]) sortedBy[c] = false;
            }
          }
        }
        if (!seenAny || rows < 3 || rows > 60) continue;

        let a = -1, b = -1, w = -1;
        if (cols === 2) {
          if (!inRange[0] || !inRange[1]) continue;
          a = 0; b = 1;
        } else {
          // 노드가 아닌 열이 딱 하나면 그게 가중치. 셋 다 노드처럼 생겼으면
          // 정렬된 열을 가중치로 본다 (크루스칼은 가중치로 정렬한다).
          const notNode = [0, 1, 2].filter((c) => !inRange[c]);
          if (notNode.length === 1) w = notNode[0];
          else if (notNode.length === 0) w = [0, 1, 2].find((c) => sortedBy[c]);
          if (w === undefined || w < 0) continue;
          const rest = [0, 1, 2].filter((c) => c !== w);
          a = rest[0]; b = rest[1];
        }

        // 자리는 전체 프레임의 합집합으로 잡는다. 한 시점만 보면 만들어지는
        // 중간에 걸려서 간선을 빠뜨린다 (객체·그래프에서 이미 당한 함정).
        const nodeSet = new Set(), edges = [], weights = {}, drawn = new Set();
        for (const f of timeline) {
          const v = f.vars[k];
          if (!isNumGrid(v) || !v.length || v[0].length !== cols) continue;
          for (const row of v) {
            const key = edgeKey(row[a], row[b]);
            if (drawn.has(key)) continue;
            drawn.add(key);
            nodeSet.add(row[a]); nodeSet.add(row[b]);
            edges.push([row[a], row[b]]);
            if (w >= 0) weights[key] = row[w];
          }
        }
        if (edges.length < 3 || nodeSet.size < 3 || nodeSet.size > 40) continue;

        // 지금 어느 간선을 보고 있나 — 노드 범위에서 움직이는 정수를 커서로 쓴다
        const cursors = [];
        for (const [k2, s2] of Object.entries(seen)) {
          if (k2 === k || s2.arr || s2.grid || s2.adjHits || s2.charFrames) continue;
          if (!s2.allInt || s2.distinct.size < 2 || s2.numFrames < 3) continue;
          if (s2.gmin < 0 || s2.gmax >= n) continue;
          if (cursors.length < 4) cursors.push(k2);
        }
        out.push({ kind: "graph", name: k, fromEdges: true,
                   nodes: [...nodeSet].sort((x, y) => x - y), edges,
                   weights: w >= 0 ? weights : null,
                   visited: null, cursors, changes: st.changes });
        break;
      }
    }
    return out;
  }

  /* ---------- 인접 행렬 -> 그래프 ----------
   * SWEA 는 그래프를 인접 리스트가 아니라 **n x n 행렬**로 주는 경우가 많다.
   * `cost[u][v]` 로 도는 다익스트라를 돌려 보면 표만 뜨고 그래프가 안 나왔다.
   * 표로는 "누가 누구와 이어졌나"가 절대 안 보인다.
   *
   * 표를 그래프로 오해하면 DP 표가 죄다 그래프가 되므로 조건을 세게 잡는다:
   *   - 정사각이다 (n x n)
   *   - 대각선이 전부 0 이다 (자기 자신까지의 거리는 0)
   *   - 한 번도 안 변한다 (문제가 준 입력이다. 계산으로 채우는 표가 아니다)
   *   - 0 이 아닌 칸이 있고, 0 인 칸도 있다 (다 이어져 있으면 그릴 게 없다)
   * 플로이드 워셜처럼 표가 **변하는** 경우는 표 자체가 주인공이라 안 바꾼다. */
  function matrixGraphs(timeline, seen, grids, taken) {
    const out = [];
    for (const g of grids) {
      if (taken.has(g.name) || g.changes) continue;
      let m = null;
      for (const f of timeline) {
        const v = f.vars[g.name];
        if (isNumGrid(v) && v.length >= 3 && v.length <= 20 && v.length === v[0].length) { m = v; break; }
      }
      if (!m) continue;
      const n = m.length;
      let diagZero = true, links = 0, holes = 0, sym = true;
      for (let i = 0; i < n; i++) {
        if (m[i][i] !== 0) { diagZero = false; break; }
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          if (m[i][j]) links++; else holes++;
          if (m[i][j] !== m[j][i]) sym = false;
        }
      }
      if (!diagZero || links < 2 || holes < 1) continue;
      // 미로 지도도 정사각에 대각선이 0 일 수 있다. 하지만 미로의 행·열은
      // **공간상의 위치**고 인접 행렬의 행·열은 **노드의 정체**다. 그걸 가르는 신호:
      // 미로에는 같은 크기의 다른 격자(BFS 의 dist)가 반드시 따라온다.
      // 인접 행렬의 짝은 1차원 dist 배열이라 같은 크기 격자가 없다.
      const twin = grids.some((o) => o !== g && o.dims === g.dims);
      if (twin) continue;

      const nodes = [], edges = [], weights = {}, drawn = new Set();
      for (let i = 0; i < n; i++) nodes.push(i);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i === j || !m[i][j]) continue;
          const key = edgeKey(i, j);
          if (sym && drawn.has(key)) continue;
          drawn.add(key);
          edges.push([i, j]);
          weights[key] = m[i][j];
        }
      }
      // 가중치가 전부 1 이면 "이어졌나"만 뜻하므로 숫자를 안 적는다
      const anyW = Object.values(weights).some((w) => w !== 1);
      const cursors = [];
      for (const [k2, s2] of Object.entries(seen)) {
        if (s2.arr || s2.grid || s2.adjHits || s2.charFrames) continue;
        if (!s2.allInt || s2.distinct.size < 2 || s2.gmin < 0 || s2.gmax >= n) continue;
        if (cursors.length < 4) cursors.push(k2);
      }
      out.push({ kind: "graph", name: g.name, fromEdges: true, fromMatrix: true,
                 nodes, edges, weights: anyW ? weights : null,
                 visited: null, cursors, changes: 1 });
    }
    return out;
  }

  /* ---------- 그래프 노드 색칠 ----------
   * 이분 그래프 판별·그래프 컬러링은 `color[v]` 에 답이 들어 있는데,
   * 지금까지 그 배열은 옆에 막대로만 그려졌다. 어느 노드가 무슨 색인지는
   * 막대의 인덱스를 눈으로 그래프에 옮겨야 알 수 있었다. 노드에 직접 칠한다.
   *
   * 조건: 노드 수만큼 긴 정수 배열 + 서로 다른 값이 몇 개 안 됨 + 값이 변함.
   * 처음에 다 같았던 값이 "아직 안 칠함"이다 (-1 로 채우는 게 흔하다). */
  function graphColorOf(timeline, seen, g) {
    const ids = g.nodes.filter(isNum);
    if (ids.length !== g.nodes.length) return null;      // 글자 노드는 인덱스가 없다
    const want = [g.nodes.length, Math.max(...ids) + 1];
    let best = null;
    for (const [k, st] of Object.entries(seen)) {
      if (k === g.name || k === g.visited || !st.arr || !st.changes) continue;
      if (!want.includes(st.maxLen)) continue;
      let first = null, distinct = new Set(), ok = true, frames = 0;
      for (const f of timeline) {
        const v = f.vars[k];
        if (!isNumList(v) || v.length !== st.maxLen) continue;
        if (!v.every(Number.isInteger)) { ok = false; break; }
        if (first === null) first = v.slice();
        frames++;
        for (const x of v) { if (distinct.size < 12) distinct.add(x); }
      }
      if (!ok || frames < 3 || distinct.size < 2 || distinct.size > 6) continue;
      // 처음에 전부 같은 값이어야 "아직 안 칠함"이라는 뜻이 선다
      if (!first || new Set(first).size !== 1) continue;

      // **색은 한 번 정하면 안 바뀐다.** 이게 색과 숫자를 가르는 신호다.
      // 이 조건이 없으면 위상정렬의 indeg(줄었다 늘었다)와 서브트리 size(쌓임)가
      // 죄다 "색"으로 잡힌다 — 둘 다 값이 몇 개 안 되고 0 으로 시작하니까.
      let settled = null, repaint = 0;
      for (const f of timeline) {
        const v = f.vars[k];
        if (!isNumList(v) || v.length !== st.maxLen) continue;
        if (!settled) { settled = v.slice(); continue; }
        for (let i = 0; i < v.length; i++) {
          if (v[i] === settled[i]) continue;
          if (settled[i] !== first[0]) repaint++;      // 이미 칠한 걸 또 바꿨다
          settled[i] = v[i];
        }
        if (repaint) break;
      }
      if (repaint) continue;
      if (!best || st.changes > best.changes) best = { name: k, base: first[0], changes: st.changes };
    }
    return best ? { name: best.name, base: best.base } : null;
  }

  function findGraphs(seen, timeline) {
    const out = [];
    for (const [k, s] of Object.entries(seen)) {
      if (!s.adjHits || !s.bestAdj) continue;
      const adj = s.bestAdj;
      const lo = adj.nodes[0], hi = adj.nodes[adj.nodes.length - 1];

      // 노드가 숫자가 아닐 수도 있다 (도시 이름 그래프). 그때는 범위 비교가
      // 뜻이 없으므로 "값이 늘 노드 이름인가"로 커서를 찾는다.
      const numeric = adj.nodes.every(isNum);
      const names = new Set(adj.nodes.map(String));

      // 방문 표시: 노드를 담는 set, 또는 노드 수만큼 긴 bool 리스트
      let visited = null, visitedHits = 0;
      const cursors = [];
      for (const [k2, s2] of Object.entries(seen)) {
        if (k2 === k) continue;
        const inNodes = !numeric || s2.visitMin === Infinity ||
                        (s2.visitMin >= lo && s2.visitMax <= hi);
        if (s2.visitFrames >= 2 && inNodes && s2.visitFrames > visitedHits) {
          visited = k2; visitedHits = s2.visitFrames;
        }
        if (s2.arr || s2.grid || s2.adjHits) continue;
        if (numeric) {
          // 현재 노드: 노드 번호 범위 안에서 움직이는 정수
          if (!s2.allInt || s2.numFrames < 2 || s2.distinct.size < 2) continue;
          if (s2.gmin < lo || s2.gmax > hi) continue;
          cursors.push(k2);
        } else if (timeline && cursors.length < 3) {
          // 글자 노드: 값이 **한 번도 빠짐없이** 노드 이름이어야 커서로 본다.
          // 한 번이라도 아니면 그냥 문자열 변수다.
          let hit = 0, miss = 0;
          const seenVals = new Set();
          for (const f of timeline) {
            const v = f.vars[k2];
            if (v === undefined) continue;
            if (typeof v === "string" && names.has(v)) { hit++; seenVals.add(v); }
            else { miss++; break; }
          }
          if (hit >= 3 && !miss && seenVals.size >= 2) cursors.push(k2);
        }
      }

      out.push({
        kind: "graph", name: k, nodes: adj.nodes, edges: adj.edges, weights: adj.weights,
        visited, cursors: cursors.slice(0, 3), changes: s.changes,
      });
    }
    return out;
  }

  /* ---------- 스칼라 시간 그래프 ----------
   * 값이 변하는 숫자 스칼라를 꺾은선으로. 크기가 비슷한 것끼리 묶어야
   * 한 그림에서 비교가 된다 (cnt_a 7 과 p 1000 을 같이 그리면 둘 다 안 보인다). */
  const SERIES_COLORS = ["#5ec8f8", "#f0883e", "#7ee787", "#d2a8ff", "#f85149", "#ffd866"];

  function findSeries(timeline, seen, scalarNames) {
    const n = timeline.length;
    const cand = [];
    for (const k of scalarNames) {
      const s = seen[k];
      if (!s || s.numFrames < 4 || s.distinct.size < 2) continue;
      // 함수 안에서만 사는 변수는 호출마다 초기화돼 톱니 모양이 된다.
      // 시간 그래프는 모듈 수준에서 쌓이는 값을 보는 것이다.
      if (s.minDepth > 0) continue;
      if (!Number.isFinite(s.gmin) || !Number.isFinite(s.gmax)) continue;
      const values = new Array(n);
      let seenAny = false;
      for (let t = 0; t < n; t++) {
        const v = timeline[t].vars[k];
        if (isNum(v)) { values[t] = v; seenAny = true; }
      }
      if (!seenAny) continue;

      // 꺾은선은 "쌓이는 값"을 보는 것이다. 카운터·누적합·최대값은 한 방향으로 간다.
      // 오르내리기만 하는 임시변수(격자 문제의 dr/dc/nr/nc)는 선으로 그려봐야
      // 지그재그일 뿐이라 화면만 어지럽힌다. 방향이 한쪽으로 쏠릴 때만 그린다.
      let up = 0, down = 0, prev;
      for (let t = 0; t < n; t++) {
        const v = values[t];
        if (v === undefined) { prev = undefined; continue; }
        if (prev !== undefined && v !== prev) (v > prev ? up++ : down++);
        prev = v;
      }
      const moves = up + down;
      if (moves >= 3) {
        const ratio = up / moves;
        if (ratio > 0.2 && ratio < 0.8) continue;
      }

      cand.push({ name: k, values, gmin: s.gmin, gmax: s.gmax,
                  scale: Math.max(Math.abs(s.gmin), Math.abs(s.gmax), 1) });
    }
    if (!cand.length) return [];

    // 크기 순으로 세워놓고 20배 안쪽이면 같은 그림에 묶는다
    cand.sort((a, b) => a.scale - b.scale);
    const groups = [];
    let cur = [cand[0]];
    for (let i = 1; i < cand.length; i++) {
      if (cand[i].scale / cur[0].scale <= 20 && cur.length < 6) cur.push(cand[i]);
      else { groups.push(cur); cur = [cand[i]]; }
    }
    groups.push(cur);

    return groups.map((lines, gi) => {
      let lo = Infinity, hi = -Infinity;
      for (const l of lines) { lo = Math.min(lo, l.gmin); hi = Math.max(hi, l.gmax); }
      lines.forEach((l, i) => { l.color = SERIES_COLORS[i % SERIES_COLORS.length]; });
      return { kind: "series", name: lines.map((l) => l.name).join(", "),
               lines, lo, hi, n, changes: -1 - gi };
    });
  }

  /* ---------- 구간(이분탐색 등) 찾기 ----------
   * 이름으로 찾으면 la/ra, lb/rb, lo/hi, left/right ... 전부 따로 처리해야 하고
   * 결국 못 맞춘다. 대신 의미로 찾는다:
   *   - 항상 a <= b 이고
   *   - 폭 (b - a) 이 계속 줄어들고
   *   - 그 "한가운데"에 앉아 있는 세 번째 변수가 있다
   * 이 세 조건이 이분탐색/파라메트릭 서치의 실제 서명이다.
   */
  function findRanges(timeline, seen, source) {
    const names = [];
    for (const [k, s] of Object.entries(seen)) {
      if (s.arr || s.grid) continue;
      if (!s.allInt || s.numFrames < 4) continue;
      // 여기서 "안 변하는 값"을 빼면 안 된다. 이분탐색은 한쪽 경계가 끝까지
      // 안 움직이는 게 흔하다 (답이 계속 아래쪽 절반이면 lo 는 1 그대로).
      // 대신 "폭이 줄어드는가"로 거른다 — 양쪽 다 상수면 폭도 안 변해서 알아서 탈락한다.
      names.push(k);
    }
    if (names.length < 2) return [];

    const n = timeline.length;
    const vals = {};
    for (const k of names) {
      const col = new Array(n);
      for (let t = 0; t < n; t++) {
        const v = timeline[t].vars[k];
        col[t] = typeof v === "number" ? v : undefined;
      }
      vals[k] = col;
    }

    // 후보 쌍 뽑기.
    // **코드가 둘을 견주고 있어야 한다** (`while lo <= hi`). 값만 보면
    // 파라메트릭 서치의 answer(= mid 를 받아 두는 답 변수)가 경계로 잡힌다 —
    // answer 도 구간 안에서 수렴하니까. 구간 칠하기에서 쓴 것과 같은 근거다.
    const related = relatedPairs(source);
    const cands = [];
    for (let x = 0; x < names.length; x++) {
      for (let y = 0; y < names.length; y++) {
        if (x === y) continue;
        if (related.size && !related.has(names[x] + SEP + names[y])) continue;
        const a = vals[names[x]], b = vals[names[y]];
        let ok = 0, bad = 0, shrink = 0, grow = 0, prevW = null;
        let maxW = -Infinity, minW = Infinity;
        for (let t = 0; t < n; t++) {
          const av = a[t], bv = b[t];
          if (av === undefined || bv === undefined) { prevW = null; continue; }
          if (av <= bv) ok++; else bad++;
          const w = bv - av;
          maxW = Math.max(maxW, w);
          minW = Math.min(minW, w);
          if (prevW !== null) {
            if (w < prevW) shrink++;
            else if (w > prevW) grow++;   // 테스트케이스마다 초기화되면 여기 걸린다
          }
          prevW = w;
        }
        if (ok + bad < 4) continue;
        if (ok / (ok + bad) < 0.95) continue;
        if (shrink < 3 || grow > shrink * 0.4) continue;
        // 탐색 구간은 결국 한 점으로 수렴한다. 그냥 우연히 가까워지는 두 값과
        // 진짜 탐색 구간을 가르는 건 이거다. 한가운데 점수로는 안 갈린다
        // (실측: 진짜 0.005~0.016 vs 우연 0.333~0.992).
        // 폭이 8 미만이면 "탐색 구간"이라 부를 값어치가 없다.
        // 값이 1..5 뿐이면 아무 두 변수나 절반씩 줄어드는 것처럼 보인다 (4->2 도 절반).
        if (maxW < 8) continue;
        const ratio = (minW + 1) / (maxW + 1);
        if (ratio > 0.2) continue;

        // 이분탐색에서 위쪽 경계는 **절대 커지지 않는다** (아래쪽은 작아지지 않는다).
        // 테스트케이스가 바뀌어 둘 다 초기화되는 경우만 예외다.
        // 이게 없으면 max_len 처럼 최댓값을 추적하는 변수가 "탐색 구간"으로 잡힌다
        // (max_len = j 라고 쓰여 있으면 경계가 중간값으로 점프하는 것처럼도 보인다).
        let wrongWay = 0, moves = 0;
        for (let t = 1; t < n; t++) {
          const la = a[t - 1], na = a[t], lb = b[t - 1], nb = b[t];
          if (la === undefined || na === undefined || lb === undefined || nb === undefined) continue;
          const bothReset = na < la && nb > lb;      // 새 테스트케이스로 되돌아간 것
          if (bothReset) continue;
          if (nb > lb) { moves++; wrongWay++; }      // 위쪽 경계가 커졌다
          else if (na < la) { moves++; wrongWay++; } // 아래쪽 경계가 작아졌다
          else if (nb < lb || na > la) moves++;
        }
        // 20% 를 봐줬더니 최댓값 추적(max_len)이 7/42 로 아슬아슬하게 통과했다.
        // 진짜 이분탐색은 경계가 한 방향으로만 가므로 이 값이 0 이다.
        if (wrongWay > 1) continue;

        // 이분탐색은 폭이 **절반씩** 줄어든다. 한 칸씩 줄어드는 루프와는 다르다.
        // 데이터가 작으면(값이 1..5) 아무 두 변수나 단조롭게 보이므로 이게 필요하다.
        let halved = 0, shrinks = 0, pw = null;
        for (let t = 0; t < n; t++) {
          const av = a[t], bv = b[t];
          if (av === undefined || bv === undefined) { pw = null; continue; }
          const w = bv - av;
          if (pw !== null && w < pw) {
            shrinks++;
            if (w <= pw * 0.75) halved++;
          }
          pw = w;
        }
        if (halved < 3 || halved < shrinks * 0.6) continue;
        cands.push({ lo: names[x], hi: names[y], shrink, grow, ratio });
      }
    }
    if (!cands.length) return [];

    // 각 쌍마다 "한가운데 있는 변수" 를 찾는다. 이게 진짜 이분탐색인지 가리는 핵심.
    // 카운터(cnt_a) 도 구간 안에 있긴 하지만 한가운데는 아니다.
    for (const c of cands) {
      let best = null;
      for (const m of names) {
        if (m === c.lo || m === c.hi) continue;
        let inside = 0, out = 0, distSum = 0;
        for (let t = 0; t < n; t++) {
          const av = vals[c.lo][t], bv = vals[c.hi][t], mv = vals[m][t];
          if (av === undefined || bv === undefined || mv === undefined) continue;
          if (mv >= av && mv <= bv) inside++; else { out++; continue; }
          const center = (av + bv) / 2;
          distSum += Math.abs(mv - center) / Math.max(1, (bv - av) / 2);
        }
        // 0.9 를 요구했더니 파라메트릭 서치가 통째로 빠졌다. mid 는 경계가
        // 갱신된 뒤에도 옛 값을 들고 있어서, 프레임 단위로 보면 구간 밖에 있는
        // 순간이 꽤 된다. 이제 쌍 자체를 **코드 근거**(while lo <= hi)로 거르므로
        // 여기까지 세게 잡을 이유가 없다.
        if (inside < 3 || inside / (inside + out) < 0.7) continue;
        const score = distSum / inside;
        if (score > 0.4) continue;               // 한가운데가 아니면 탈락

        // 이분탐색의 결정적 동작: 중간값을 구한 뒤 **경계가 그 중간값으로 점프**한다
        // (la = ca). 그냥 하나씩 증가하는 루프 변수는 절대 이렇게 안 움직인다.
        // 이게 없으면 idx 가 max_len 을 향해 기어가는 것도 "탐색 구간"이 된다.
        let jump = 0;
        for (let t = 1; t < n; t++) {
          const pm = vals[m][t - 1];
          if (pm === undefined) continue;
          for (const bnd of [c.lo, c.hi]) {
            const was = vals[bnd][t - 1], now = vals[bnd][t];
            if (was === undefined || now === undefined || was === now) continue;
            if (Math.abs(now - pm) <= 1) jump++;
          }
        }
        if (jump < 2) continue;

        if (!best || score < best.score) best = { name: m, score };
      }
      c.mid = best ? best.name : null;
      c.midScore = best ? best.score : 1;
      c.affinity = nameAffinity(c.lo, c.hi) ? 0 : 1;
    }

    // 좋은 쌍부터 확정하고, 이미 쓴 변수는 다시 안 쓴다 (la/rb 같은 엉뚱한 짝 방지)
    cands.sort((p, q) =>
      (p.mid ? 0 : 1) - (q.mid ? 0 : 1) ||
      p.affinity - q.affinity ||
      p.midScore - q.midScore ||
      q.shrink - p.shrink
    );

    const used = new Set(), out = [];
    for (const c of cands) {
      if (used.has(c.lo) || used.has(c.hi) || (c.mid && used.has(c.mid))) continue;
      // 한가운데 변수가 반드시 있어야 한다. 그게 이분탐색의 정의다.
      // 이름만 짝인 걸 받아줬더니 위상정렬의 cur, u 가 "탐색 구간"으로 잡혔다.
      if (!c.mid) continue;
      used.add(c.lo); used.add(c.hi);
      if (c.mid) used.add(c.mid);
      out.push({
        kind: "range", name: c.lo + " … " + c.hi,
        lo: c.lo, hi: c.hi, mid: c.mid,
        gmin: seen[c.lo].gmin, gmax: seen[c.hi].gmax,
        changes: seen[c.lo].changes + seen[c.hi].changes,
      });
    }
    return out;
  }

  // la/ra, lb/rb, lo/hi, left/right, start/end ... 같은 짝은 살짝 우대한다

  return { analyze };
})();
