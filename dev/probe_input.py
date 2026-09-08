# -*- coding: utf-8 -*-
"""샘플 입력 지어내기가 어디서 이상해지는지 재는 탐침.
백준·SWEA 에서 실제로 쓰이는 입력 읽기 꼴을 모아 돌려보고,
지어낸 줄 / 끝까지 돌았는가 / 출력이 말이 되는가 를 한눈에 본다."""
import sys, os, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")
import tracer

CASES = {}

CASES["n_arr"] = """n = int(input())
arr = list(map(int, input().split()))
print(n, arr, len(arr))
"""

CASES["nm_grid"] = """n, m = map(int, input().split())
g = [list(map(int, input().split())) for _ in range(n)]
print(n, m, g)
"""

CASES["nm_digits"] = """import sys
input = sys.stdin.readline
n, m = map(int, input().split())
g = [list(map(int, input().strip())) for _ in range(n)]
print(n, m, g)
"""

CASES["edges"] = """n, m = map(int, input().split())
adj = [[] for _ in range(n+1)]
for _ in range(m):
    a, b = map(int, input().split())
    adj[a].append(b)
    adj[b].append(a)
print(adj)
"""

CASES["weighted"] = """n, m = map(int, input().split())
edges = []
for _ in range(m):
    a, b, w = map(int, input().split())
    edges.append((a, b, w))
print(edges)
"""

CASES["swea_tc"] = """T = int(input())
for tc in range(1, T+1):
    n = int(input())
    arr = list(map(int, input().split()))
    print('#' + str(tc), max(arr))
"""

CASES["two_strings"] = """a = input()
b = input()
print(a, b, len(a), len(b))
"""

CASES["str_then_n"] = """s = input().strip()
n = int(input())
print(s, n, s[:n])
"""

CASES["n_lines"] = """n = int(input())
words = [input().strip() for _ in range(n)]
print(words)
"""

CASES["n_pairs_named"] = """n = int(input())
people = []
for _ in range(n):
    age, name = input().split()
    people.append((int(age), name))
people.sort()
print(people)
"""

CASES["queries"] = """n, q = map(int, input().split())
arr = list(map(int, input().split()))
for _ in range(q):
    l, r = map(int, input().split())
    print(sum(arr[l-1:r]))
"""

CASES["matrix_sq"] = """n = int(input())
m = [list(map(int, input().split())) for _ in range(n)]
for row in m:
    print(row)
"""

CASES["start_target"] = """n = int(input())
graph = {i: [] for i in range(1, n+1)}
m = int(input())
for _ in range(m):
    a, b = map(int, input().split())
    graph[a].append(b)
start = int(input())
print(graph, start)
"""

CASES["floats"] = """n = int(input())
vals = list(map(float, input().split()))
print(sum(vals) / n)
"""

CASES["readline_int"] = """import sys
n = int(sys.stdin.readline())
arr = list(map(int, sys.stdin.readline().split()))
print(n, arr)
"""

CASES["tc_grid"] = """T = int(input())
for tc in range(1, T+1):
    n, m = map(int, input().split())
    board = [list(map(int, input().split())) for _ in range(n)]
    print('#' + str(tc), n, m, len(board), len(board[0]))
"""

CASES["nmk"] = """n, m, k = map(int, input().split())
print(n, m, k)
"""

CASES["stdin_readall"] = """import sys
data = sys.stdin.read().split()
n = int(data[0])
arr = list(map(int, data[1:1+n]))
print(n, arr)
"""

CASES["nested_tc"] = """for _ in range(int(input())):
    n = int(input())
    print(n * 2)
"""

CASES["coord_points"] = """n = int(input())
pts = []
for _ in range(n):
    x, y = map(int, input().split())
    pts.append((x, y))
pts.sort()
print(pts)
"""

CASES["str_grid"] = """n, m = map(int, input().split())
board = [input().strip() for _ in range(n)]
for r in board:
    print(r, len(r))
"""

CASES["knapsack"] = """n, k = map(int, input().split())
items = []
for _ in range(n):
    w, v = map(int, input().split())
    items.append((w, v))
dp = [0] * (k + 1)
for w, v in items:
    for c in range(k, w - 1, -1):
        dp[c] = max(dp[c], dp[c - w] + v)
print(dp[k])
"""

CASES["two_str_kmp"] = """text = input().strip()
pat = input().strip()
print(text.find(pat), len(text), len(pat))
"""


CASES["sq_str_grid"] = """n = int(input())
board = [input().strip() for _ in range(n)]
cnt = 0
for i in range(n):
    for j in range(n):
        if board[i][j] == '#':
            cnt += 1
print(board, cnt)
"""

CASES["eof_while"] = """import sys
total = 0
while True:
    try:
        a, b = map(int, input().split())
    except EOFError:
        break
    total += a + b
print(total)
"""

CASES["for_stdin"] = """import sys
rows = []
for line in sys.stdin:
    rows.append(line.strip())
print(rows)
"""

CASES["lcs_two"] = """a = input().strip()
b = input().strip()
dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
for i in range(1, len(a) + 1):
    for j in range(1, len(b) + 1):
        if a[i-1] == b[j-1]:
            dp[i][j] = dp[i-1][j-1] + 1
        else:
            dp[i][j] = max(dp[i-1][j], dp[i][j-1])
print(dp[len(a)][len(b)])
"""

CASES["dijkstra_in"] = """import heapq
import sys
input = sys.stdin.readline
n, m = map(int, input().split())
adj = [[] for _ in range(n + 1)]
for _ in range(m):
    u, v, w = map(int, input().split())
    adj[u].append((v, w))
dist = [10 ** 9] * (n + 1)
dist[1] = 0
pq = [(0, 1)]
while pq:
    d, u = heapq.heappop(pq)
    if d > dist[u]:
        continue
    for v, w in adj[u]:
        if d + w < dist[v]:
            dist[v] = d + w
            heapq.heappush(pq, (dist[v], v))
print(dist[1:])
"""

CASES["name_only"] = """n = int(input())
names = set()
for _ in range(n):
    op, name = input().split()
    if op == 'add':
        names.add(name)
print(sorted(names))
"""


def show(name, src):
    out = json.loads(tracer.run(src, "", 0, True))
    made = out.get("made") or []
    err = out.get("error")
    print("=" * 62)
    print(name, " 단계", len(out.get("timeline") or []))
    print("  지어낸입력:", " | ".join(made) if made else "(없음)")
    if err:
        print("  !! 실패:", err.get("type"), err.get("msg"))
        FAILED.append(name + " " + str(err.get("type")))
    so = (out.get("stdout") or "").strip()
    if so:
        cut = so if len(so) < 300 else so[:300] + "..."
        print("  출력:", cut.replace("\n", " / "))


CASES["a_plus_b"] = """a, b = map(int, input().split())
print(a + b)
"""

CASES["star_unpack"] = """n = int(input())
*arr, = map(int, input().split())
arr.sort()
print(arr)
"""

CASES["count_names"] = """n = int(input())
seen = {}
for _ in range(n):
    name = input().strip()
    seen[name] = seen.get(name, 0) + 1
print(seen)
"""

CASES["stack_cmds"] = """import sys
input = sys.stdin.readline
n = int(input())
st = []
for _ in range(n):
    cmd = input().split()
    if cmd[0] == 'push':
        st.append(int(cmd[1]))
    elif cmd[0] == 'pop':
        st.pop() if st else -1
print(st)
"""

CASES["rstrip_str"] = """import sys
s = sys.stdin.readline().rstrip()
print(s, len(s))
"""

CASES["nested_loop_grid"] = """n, m = map(int, input().split())
g = []
for i in range(n):
    row = list(map(int, input().split()))
    g.append(row)
total = 0
for i in range(n):
    for j in range(m):
        total += g[i][j]
print(total, len(g), len(g[0]))
"""


FAILED = []


for k in CASES:
    show(k, CASES[k])

print("=" * 62)
print("통과", len(CASES) - len(FAILED), "/", len(CASES))
for f in FAILED:
    print("  실패", f)
