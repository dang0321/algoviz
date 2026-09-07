/* algoviz — DOM/SVG 만들기와 좌표 계산.
 *
 * 트리를 어디에 놓을지, 원형으로 어떻게 돌릴지 같은 순수 계산.
 * 무엇을 그릴지는 모른다.
 */
const VizLayout = (() => {
  const { edgeKey } = VizUtil;
  function el(tag, cls, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }

  /* 블록 제목. 종류마다 무엇으로 판정했는지 한 줄로 알려준다.
   * "왜 이렇게 그렸나"가 보여야 판정이 틀렸을 때 사용자가 알아챈다. */
  const SVGNS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  }

  /* 트리면 계층으로, 아니면 원형으로 배치한다.
   *
   * 원형은 어떤 그래프든 실패하지 않지만 부모-자식 관계가 안 보인다.
   * 트리는 알고리즘 문제에서 워낙 자주 나와서 따로 대접할 값어치가 있다. */
  function treeOf(g) {
    const nb = {};                       // 방향 무시한 이웃
    for (const id of g.nodes) nb[id] = new Set();
    const undirected = new Set();
    for (const [a, b] of g.edges) {
      if (a === b) return null;          // 자기 자신으로 가는 간선이 있으면 트리가 아니다
      nb[a].add(b); nb[b].add(a);
      undirected.add(edgeKey(a, b));
    }
    if (undirected.size !== g.nodes.length - 1) return null;   // 트리는 간선이 노드-1 개

    // 뿌리 고르기: 들어오는 간선이 없는 노드(자식만 나열한 구조). 없으면 제일 작은 번호.
    const indeg = {};
    for (const id of g.nodes) indeg[id] = 0;
    for (const [, b] of g.edges) indeg[b]++;
    const zero = g.nodes.filter((id) => indeg[id] === 0);
    const root = zero.length === 1 ? zero[0] : g.nodes[0];

    // 뿌리에서 훑으며 자식 목록과 깊이를 만든다. 다 못 닿으면 끊어진 그래프라 트리가 아니다.
    const depth = { [root]: 0 }, kids = {}, order = [root];
    for (const id of g.nodes) kids[id] = [];
    for (let i = 0; i < order.length; i++) {
      const cur = order[i];
      for (const to of nb[cur]) {
        if (to in depth) continue;
        depth[to] = depth[cur] + 1;
        kids[cur].push(to);
        order.push(to);
      }
    }
    if (order.length !== g.nodes.length) return null;
    return { root, kids, depth, order };
  }

  function treePositions(t, W, H) {
    // 잎을 왼쪽부터 차례로 놓고, 부모는 첫 자식과 끝 자식의 한가운데에 둔다.
    //
    // 반드시 DFS(깊이 우선) 순서로 훑어야 한다. BFS 순서로 잎 번호를 매기면
    // 형제 subtree 의 잎이 뒤섞여서 부모끼리 같은 자리에 겹친다.
    // (실제로 노드 2 와 3 이 정확히 같은 x 에 그려져 하나가 사라졌다)
    const xs = {};
    let leaf = 0;
    const place = (id) => {
      const ch = t.kids[id];
      if (!ch.length) { xs[id] = leaf++; return; }
      for (const c of ch) place(c);
      xs[id] = (xs[ch[0]] + xs[ch[ch.length - 1]]) / 2;
    };
    place(t.root);
    const maxX = Math.max(leaf - 1, 1);
    const maxD = Math.max(...Object.values(t.depth), 1);
    const padX = 26, padY = 28;
    const pos = {};
    for (const id of t.order) {
      pos[id] = {
        x: padX + (xs[id] / maxX) * (W - padX * 2),
        y: padY + (t.depth[id] / maxD) * (H - padY * 2),
      };
    }
    return pos;
  }

  /* ---------- 방향 있는 비순환 그래프(DAG)를 층으로 눕힌다 ----------
   * 위상정렬·의존관계 문제는 "무엇이 무엇보다 먼저인가"가 전부인데,
   * 원형으로 그리면 그 순서가 아예 안 보인다. 원은 시작도 끝도 없으니까.
   *
   * 층 = 그 노드까지 오는 **가장 긴 경로의 길이**. 같은 층에 있는 노드끼리는
   * 서로 앞뒤가 없다는 뜻이라, 층 자체가 답을 설명한다.
   * 순환이 있으면 층으로 못 눕히므로 그냥 원형으로 돌려보낸다. */
  function dagLayers(g) {
    const indeg = {}, out = {};
    for (const id of g.nodes) { indeg[id] = 0; out[id] = []; }
    const seen = new Set();
    for (const [a, b] of g.edges) {
      if (a === b) return null;
      const k = a + ">" + b;
      if (seen.has(k) || !(a in out) || !(b in indeg)) continue;
      seen.add(k);
      out[a].push(b);
      indeg[b]++;
    }
    if (seen.size < 2) return null;
    const q = g.nodes.filter((id) => indeg[id] === 0);
    if (!q.length) return null;                 // 전부 들어오는 간선이 있으면 순환
    const layer = {}, deg = Object.assign({}, indeg);
    for (const id of g.nodes) layer[id] = 0;
    let done = 0;
    for (let i = 0; i < q.length; i++) {
      const cur = q[i];
      done++;
      for (const to of out[cur]) {
        if (layer[cur] + 1 > layer[to]) layer[to] = layer[cur] + 1;
        if (--deg[to] === 0) q.push(to);
      }
    }
    if (done !== g.nodes.length) return null;   // 못 뺀 노드가 있으면 순환이다
    const depth = Math.max(...Object.values(layer));
    if (depth < 2) return null;                 // 두 층뿐이면 원형과 다를 게 없다
    return { layer, depth };
  }

  function layerPositions(d, g, W, H) {
    const rows = {};
    for (const id of g.nodes) (rows[d.layer[id]] || (rows[d.layer[id]] = [])).push(id);
    const padX = 34, padY = 30;
    const pos = {};
    for (const ly of Object.keys(rows)) {
      const ids = rows[ly].slice().sort((a, b) => (a > b ? 1 : a < b ? -1 : 0));
      ids.forEach((id, i) => {
        pos[id] = {
          x: ids.length === 1 ? W / 2
                              : padX + (i / (ids.length - 1)) * (W - padX * 2),
          y: padY + (Number(ly) / d.depth) * (H - padY * 2),
        };
      });
    }
    return pos;
  }

  function circlePositions(g, W, H) {
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 34;
    const pos = {};
    g.nodes.forEach((id, i) => {
      const a = (i / g.nodes.length) * Math.PI * 2 - Math.PI / 2;
      pos[id] = { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
    });
    return pos;
  }

  return { el, svg, treeOf, treePositions, dagLayers, layerPositions, circlePositions };
})();
