/* 공부하면서 자주 확인하는 패턴들. 여기 추가하면 드롭다운에 바로 뜬다.
 * (index.html 의 <select id="preset"> 에 option 도 같이 넣을 것)
 *
 * 값은 코드 문자열, 또는 입력이 필요하면 { code, stdin } 객체. */
const SAMPLES = {

  stdinsort: {
    code: `import sys
input = sys.stdin.readline

n = int(input())
arr = list(map(int, input().split()))

for i in range(n):
    for j in range(0, n - i - 1):
        if arr[j] > arr[j + 1]:
            arr[j], arr[j + 1] = arr[j + 1], arr[j]

print(*arr)
`,
    stdin: `7
5 3 8 1 9 2 7
`,
  },


  charmaze: `# 문자 미로 BFS — 글자 격자를 지도처럼 읽는다
from collections import deque

lines = ["..#.", "#.#.", "....", ".##."]
board = [list(x) for x in lines]
dist = [[0] * 4 for _ in range(4)]

q = deque([(0, 0)])
dist[0][0] = 1

while q:
    r, c = q.popleft()
    for dr, dc in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
        nr, nc = r + dr, c + dc
        if 0 <= nr < 4 and 0 <= nc < 4 and board[nr][nc] == "." and dist[nr][nc] == 0:
            dist[nr][nc] = dist[r][c] + 1
            q.append((nr, nc))

print(dist[3][3])
`,

  segtree: `# 세그먼트 트리 — 배열 하나가 사실은 트리다
arr = [1, 3, 5, 7, 9, 11, 13, 15]
n = len(arr)
tree = [0] * (2 * n)

for i in range(n):
    tree[n + i] = arr[i]

for i in range(n - 1, 0, -1):
    tree[i] = tree[2 * i] + tree[2 * i + 1]

print(tree[1])
`,

  bitmask: `# 비트마스크 — 10진수 대신 2진수로 보인다
n = 4
full = (1 << n) - 1
mask = 0
order = []

for v in [0, 2, 1, 3]:
    mask = mask | (1 << v)
    order.append(mask)

print(mask == full)
`,

  sieve: `# 에라토스테네스의 체 — 참/거짓 배열이 꺼져 나간다
n = 30
is_prime = [True] * (n + 1)
is_prime[0] = is_prime[1] = False

i = 2
while i * i <= n:
    if is_prime[i]:
        j = i * i
        while j <= n:
            is_prime[j] = False
            j += i
    i += 1

print(sum(is_prime))
`,

  counter: `# 빈도수 세기 — 어느 글자가 제일 많은지 막대로 보인다
s = "mississippi"
freq = {}

for ch in s:
    if ch not in freq:
        freq[ch] = 0
    freq[ch] += 1

best = max(freq, key=freq.get)
print(best, freq[best])
`,

  maze: `# 미로 최단거리 BFS — 격자 + 큐 + 현재 위치
from collections import deque

maze = [
    [0, 0, 1, 0],
    [1, 0, 1, 0],
    [0, 0, 0, 0],
    [0, 1, 1, 0],
]
dist = [[0] * 4 for _ in range(4)]

q = deque([(0, 0)])
dist[0][0] = 1

while q:
    r, c = q.popleft()
    for dr, dc in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
        nr, nc = r + dr, c + dc
        if 0 <= nr < 4 and 0 <= nc < 4 and maze[nr][nc] == 0 and dist[nr][nc] == 0:
            dist[nr][nc] = dist[r][c] + 1
            q.append((nr, nc))

print(dist[3][3])
`,

  meeting: `# 회의실 배정 (그리디) — 구간이 가로 막대로 보인다
meet = [(1, 4), (3, 5), (0, 6), (5, 7), (3, 9), (5, 9), (6, 10), (8, 11)]
meet.sort(key=lambda x: x[1])

end = 0
cnt = 0

for s, e in meet:
    if s >= end:
        end = e
        cnt += 1

print(cnt)
`,

  trie: `# 트라이 — 딕셔너리 안의 딕셔너리가 곧 트리다
trie = {}

for word in ["cat", "car", "dog", "do"]:
    node = trie
    for ch in word:
        if ch not in node:
            node[ch] = {}
        node = node[ch]
    node["$"] = True

print(len(trie))
`,

  linkedlist: `# 연결리스트 — 클래스로 만든 노드가 줄줄이 이어진다
class Node:
    def __init__(self, v):
        self.v = v
        self.next = None

head = Node(1)
head.next = Node(2)
head.next.next = Node(3)
head.next.next.next = Node(4)

cur = head
total = 0
while cur is not None:
    total += cur.v
    cur = cur.next

print(total)
`,

  bintree: `# 이진 탐색 트리 중위 순회 — 클래스 노드
class Node:
    def __init__(self, v):
        self.v = v
        self.left = None
        self.right = None

root = Node(5)
root.left = Node(3)
root.right = Node(8)
root.left.left = Node(1)
root.left.right = Node(4)
root.right.right = Node(9)

order = []

def walk(n):
    if n is None:
        return
    walk(n.left)
    order.append(n.v)
    walk(n.right)

walk(root)
print(order)
`,

  heap: `# 힙 정렬 — 리스트가 사실은 완전이진트리다
import heapq

arr = [5, 3, 8, 1, 9, 2, 7]
h = []

for x in arr:
    heapq.heappush(h, x)

out = []
while h:
    out.append(heapq.heappop(h))

print(out)
`,

  unionfind: `# 유니온 파인드 — 부모 화살표가 옮겨 붙는 게 보인다
parent = [0, 1, 2, 3, 4, 5, 6]

def find(x):
    while parent[x] != x:
        x = parent[x]
    return x

for a, b in [(1, 2), (3, 4), (2, 3), (5, 6), (4, 6)]:
    ra = find(a)
    rb = find(b)
    if ra != rb:
        parent[rb] = ra

print(parent)
`,

  factorial: `# 재귀 — 호출 스택이 쌓였다 풀리는 게 보인다
def fact(n):
    if n <= 1:
        return 1
    return n * fact(n - 1)

answer = fact(6)
print(answer)
`,

  hanoi: `# 하노이 탑 — 재귀가 두 갈래로 갈라진다
moves = []

def hanoi(n, start, end, via):
    if n == 0:
        return
    hanoi(n - 1, start, via, end)
    moves.append((start, end))
    hanoi(n - 1, via, end, start)

hanoi(3, 1, 3, 2)
print(len(moves))
`,

  palindrome: `# 문자열 팰린드롬 검사 (투 포인터)
s = "racecar"

left = 0
right = len(s) - 1
ans = True

while left < right:
    if s[left] != s[right]:
        ans = False
        break
    left += 1
    right -= 1

print(ans)
`,

  strrev: `# 문자 리스트를 제자리에서 뒤집기
s = list("algoviz")

i = 0
j = len(s) - 1

while i < j:
    s[i], s[j] = s[j], s[i]
    i += 1
    j -= 1

print("".join(s))
`,

  tree: `# 이진 트리 전위 순회
tree = {
    1: [2, 3],
    2: [4, 5],
    3: [6, 7],
    4: [],
    5: [8],
    6: [],
    7: [],
    8: [],
}

order = []
stack = [1]

while stack:
    cur = stack.pop()
    order.append(cur)

    for nxt in reversed(tree[cur]):
        stack.append(nxt)

print(order)
`,

  bfs: `from collections import deque

graph = {
    1: [2, 3],
    2: [1, 4, 5],
    3: [1, 6],
    4: [2],
    5: [2, 6],
    6: [3, 5],
}

visited = set()
order = []

q = deque([1])
visited.add(1)

while q:
    cur = q.popleft()
    order.append(cur)

    for nxt in graph[cur]:
        if nxt not in visited:
            visited.add(nxt)
            q.append(nxt)

print(order)
`,

  bubble: `arr = [5, 3, 8, 1, 9, 2, 7]
n = len(arr)

for i in range(n):
    for j in range(0, n - i - 1):
        if arr[j] > arr[j + 1]:
            arr[j], arr[j + 1] = arr[j + 1], arr[j]

print(arr)
`,

  twopointer: `# 정렬된 배열에서 합이 target 인 두 수 찾기
arr = [1, 3, 4, 6, 8, 11, 15]
target = 14

left = 0
right = len(arr) - 1
answer = None

while left < right:
    total = arr[left] + arr[right]
    if total == target:
        answer = (arr[left], arr[right])
        break
    elif total < target:
        left += 1
    else:
        right -= 1

print(answer)
`,

  window: `# 길이 k 짜리 구간의 최대 합
arr = [2, 1, 5, 1, 3, 2, 7, 1]
k = 3

cur = sum(arr[:k])
best = cur

for right in range(k, len(arr)):
    left = right - k
    cur = cur - arr[left] + arr[right]
    if cur > best:
        best = cur

print(best)
`,

  knapsack: `w = [2, 3, 4]
v = [3, 4, 5]
cap = 5
dp = [[0] * (cap + 1) for _ in range(len(w) + 1)]

for i in range(1, len(w) + 1):
    for c in range(cap + 1):
        dp[i][c] = dp[i - 1][c]
        if c >= w[i - 1]:
            best = dp[i - 1][c - w[i - 1]] + v[i - 1]
            if best > dp[i][c]:
                dp[i][c] = best

print(dp[len(w)][cap])
`,

  binsearch: `arr = [1, 3, 4, 6, 8, 11, 15, 19, 23]
target = 15

lo = 0
hi = len(arr) - 1
found = -1

while lo <= hi:
    mid = (lo + hi) // 2
    if arr[mid] == target:
        found = mid
        break
    elif arr[mid] < target:
        lo = mid + 1
    else:
        hi = mid - 1

print(found)
`,

  mergesort: `# 병합정렬
def merge_sort(a):
    if len(a) <= 1:
        return a
    mid = len(a) // 2
    left = merge_sort(a[:mid])
    right = merge_sort(a[mid:])
    out = []
    i = j = 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            out.append(left[i])
            i += 1
        else:
            out.append(right[j])
            j += 1
    out += left[i:]
    out += right[j:]
    return out
arr = [5, 2, 9, 1, 7, 3]
print(merge_sort(arr))
`,

  quick: `# 퀵정렬 (제자리)
a = [7, 2, 9, 4, 1, 8, 3]
def part(lo, hi):
    pivot = a[hi]
    i = lo - 1
    for j in range(lo, hi):
        if a[j] <= pivot:
            i += 1
            a[i], a[j] = a[j], a[i]
    a[i+1], a[hi] = a[hi], a[i+1]
    return i + 1
def quick(lo, hi):
    if lo < hi:
        p = part(lo, hi)
        quick(lo, p - 1)
        quick(p + 1, hi)
quick(0, len(a) - 1)
print(a)
`,

  dijkstra: `# 다익스트라
import heapq
n = 6
INF = 10 ** 9
graph = {0: [(1,4),(2,1)], 1: [(3,1)], 2: [(1,2),(3,5)], 3: [(4,3)], 4: [(5,1)], 5: []}
dist = [INF] * n
dist[0] = 0
pq = [(0, 0)]
while pq:
    d, u = heapq.heappop(pq)
    if d > dist[u]:
        continue
    for v, w in graph[u]:
        if d + w < dist[v]:
            dist[v] = d + w
            heapq.heappush(pq, (dist[v], v))
print(dist)
`,

  topo: `# 위상정렬
from collections import deque
n = 6
edges = [(0,2),(1,2),(2,3),(2,4),(3,5),(4,5)]
adj = [[] for _ in range(n)]
indeg = [0] * n
for a, b in edges:
    adj[a].append(b)
    indeg[b] += 1
q = deque([i for i in range(n) if indeg[i] == 0])
order = []
while q:
    cur = q.popleft()
    order.append(cur)
    for nx in adj[cur]:
        indeg[nx] -= 1
        if indeg[nx] == 0:
            q.append(nx)
print(order)
`,

  memo: `# 재귀 DP 메모이제이션
memo = {}
def go(i, j):
    if i == 0 or j == 0:
        return 1
    if (i, j) in memo:
        return memo[(i, j)]
    memo[(i, j)] = go(i - 1, j) + go(i, j - 1)
    return memo[(i, j)]
print(go(4, 4))
`,

  lcs: `# 최장 공통 부분수열
a = "ABCBDAB"
b = "BDCABA"
dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
for i in range(1, len(a) + 1):
    for j in range(1, len(b) + 1):
        if a[i-1] == b[j-1]:
            dp[i][j] = dp[i-1][j-1] + 1
        else:
            dp[i][j] = max(dp[i-1][j], dp[i][j-1])
print(dp[len(a)][len(b)])
`,

  lis: `# 최장 증가 부분수열
a = [10, 9, 2, 5, 3, 7, 101, 18]
dp = [1] * len(a)
for i in range(1, len(a)):
    for j in range(i):
        if a[j] < a[i] and dp[j] + 1 > dp[i]:
            dp[i] = dp[j] + 1
print(max(dp))
`,

  prefix: `# 누적합
a = [3, 1, 4, 1, 5, 9, 2, 6]
pre = [0] * (len(a) + 1)
for i in range(len(a)):
    pre[i + 1] = pre[i] + a[i]
for l, r in [(1, 3), (2, 6), (0, 7)]:
    s = pre[r + 1] - pre[l]
    print(l, r, s)
`,

  snail: `# 달팽이 채우기
n = 4
g = [[0] * n for _ in range(n)]
dr = [0, 1, 0, -1]
dc = [1, 0, -1, 0]
r = c = d = 0
for v in range(1, n * n + 1):
    g[r][c] = v
    nr = r + dr[d]
    nc = c + dc[d]
    if not (0 <= nr < n and 0 <= nc < n) or g[nr][nc]:
        d = (d + 1) % 4
        nr = r + dr[d]
        nc = c + dc[d]
    r, c = nr, nc
for row in g:
    print(row)
`,

  perm: `# 순열 생성
n = 3
used = [False] * n
path = []
res = []
def rec():
    if len(path) == n:
        res.append(path[:])
        return
    for i in range(n):
        if used[i]:
            continue
        used[i] = True
        path.append(i + 1)
        rec()
        path.pop()
        used[i] = False
rec()
print(res)
`,

  rle: `# 런렝스 압축
s = "aaabbbccccd"
out = []
cnt = 1
for i in range(1, len(s)):
    if s[i] == s[i-1]:
        cnt += 1
    else:
        out.append(s[i-1])
        out.append(str(cnt))
        cnt = 1
out.append(s[-1])
out.append(str(cnt))
print("".join(out))
`,

  factorize: `# 소인수분해
n = 360
f = []
d = 2
while d * d <= n:
    while n % d == 0:
        f.append(d)
        n //= d
    d += 1
if n > 1:
    f.append(n)
print(f)
`,

  fib: `# 재귀 피보나치 (호출 트리)
def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)
print(fib(6))
`,

  kruskal: `# 크루스칼 MST
edges = [(1,0,1),(2,1,2),(3,0,2),(4,2,3),(5,3,4),(6,1,4)]
edges.sort()
parent = list(range(5))
def find(x):
    while parent[x] != x:
        x = parent[x]
    return x
total = 0
picked = []
for w, a, b in edges:
    ra, rb = find(a), find(b)
    if ra != rb:
        parent[rb] = ra
        total += w
        picked.append((a, b))
print(total, picked)
`,

  floyd: `# 플로이드 워셜
INF = 10 ** 6
d = [[0,4,INF,6],[INF,0,2,INF],[INF,INF,0,3],[2,INF,INF,0]]
n = 4
for k in range(n):
    for i in range(n):
        for j in range(n):
            if d[i][k] + d[k][j] < d[i][j]:
                d[i][j] = d[i][k] + d[k][j]
for row in d:
    print(row)
`,

  lcsback: `# LCS 역추적 (경로 복원)
a = "ABCBDAB"
b = "BDCABA"
n, m = len(a), len(b)
dp = [[0] * (m + 1) for _ in range(n + 1)]
for i in range(1, n + 1):
    for j in range(1, m + 1):
        if a[i-1] == b[j-1]:
            dp[i][j] = dp[i-1][j-1] + 1
        else:
            dp[i][j] = max(dp[i-1][j], dp[i][j-1])
out = []
i, j = n, m
while i > 0 and j > 0:
    if a[i-1] == b[j-1]:
        out.append(a[i-1])
        i -= 1
        j -= 1
    elif dp[i-1][j] >= dp[i][j-1]:
        i -= 1
    else:
        j -= 1
out.reverse()
print("".join(out))
`,

  kmpsearch: `# KMP 문자열 매칭 본체
t = "abababcabab"
p = "ababc"
fail = [0] * len(p)
j = 0
for i in range(1, len(p)):
    while j > 0 and p[i] != p[j]:
        j = fail[j - 1]
    if p[i] == p[j]:
        j += 1
        fail[i] = j
res = []
j = 0
for i in range(len(t)):
    while j > 0 and t[i] != p[j]:
        j = fail[j - 1]
    if t[i] == p[j]:
        if j == len(p) - 1:
            res.append(i - len(p) + 1)
            j = fail[j]
        else:
            j += 1
print(res)
`,

  points: `# 좌표 평면 - 가장 가까운 두 점
pts = [(2, 3), (12, 30), (40, 50), (5, 1), (12, 10), (3, 4)]
best = 10 ** 9
pair = None
for i in range(len(pts)):
    for j in range(i + 1, len(pts)):
        dx = pts[i][0] - pts[j][0]
        dy = pts[i][1] - pts[j][1]
        d = dx * dx + dy * dy
        if d < best:
            best = d
            pair = (i, j)
print(best, pair)
`,

  nqueens: `# N-Queens 백트래킹
n = 6
cols = [0] * n
cnt = 0
def ok(r, c):
    for i in range(r):
        if cols[i] == c or abs(cols[i] - c) == r - i:
            return False
    return True
def go(r):
    global cnt
    if r == n:
        cnt += 1
        return
    for c in range(n):
        if ok(r, c):
            cols[r] = c
            go(r + 1)
go(0)
print(cnt)
`,

  median: `# 중앙값 유지 (힙 두 개)
import heapq
lo = []
hi = []
out = []
for x in [5, 15, 1, 3, 8, 7, 9, 10, 6, 11, 4]:
    heapq.heappush(lo, -x)
    heapq.heappush(hi, -heapq.heappop(lo))
    if len(hi) > len(lo):
        heapq.heappush(lo, -heapq.heappop(hi))
    out.append(-lo[0])
print(out)
`,

  countsort: `# 계수 정렬
a = [4, 2, 2, 8, 3, 3, 1, 4, 4]
k = 9
cnt = [0] * k
for x in a:
    cnt[x] += 1
for i in range(1, k):
    cnt[i] += cnt[i-1]
out = [0] * len(a)
for i in range(len(a) - 1, -1, -1):
    cnt[a[i]] -= 1
    out[cnt[a[i]]] = a[i]
print(out)
`,

  calc: `# 수식 계산 (스택 두 개)
s = "3+5*2-8/4"
nums = []
ops = []
prec = {"+": 1, "-": 1, "*": 2, "/": 2}
i = 0
while i < len(s):
    ch = s[i]
    if ch.isdigit():
        nums.append(int(ch))
    else:
        while ops and prec[ops[-1]] >= prec[ch]:
            b = nums.pop()
            a = nums.pop()
            o = ops.pop()
            nums.append(a + b if o == "+" else a - b if o == "-" else a * b if o == "*" else a // b)
        ops.append(ch)
    i += 1
while ops:
    b = nums.pop()
    a = nums.pop()
    o = ops.pop()
    nums.append(a + b if o == "+" else a - b if o == "-" else a * b if o == "*" else a // b)
print(nums[0])
`,

  subtree: `# 트리 DP - 서브트리 크기
adj = {1: [2, 3], 2: [4, 5], 3: [6], 4: [], 5: [], 6: []}
size = [0] * 7
def dfs(u):
    size[u] = 1
    for v in adj[u]:
        dfs(v)
        size[u] += size[v]
dfs(1)
print(size)
`,

  swea_dijkstra: { code: `import sys
input = sys.stdin.readline
INF = 10 ** 9

T = int(input())
for tc in range(1, T + 1):
    n = int(input())
    cost = [list(map(int, input().split())) for _ in range(n)]
    dist = [INF] * n
    done = [False] * n
    dist[0] = 0
    for _ in range(n):
        u = -1
        for i in range(n):
            if not done[i] and (u == -1 or dist[i] < dist[u]):
                u = i
        done[u] = True
        for v in range(n):
            if cost[u][v] and dist[u] + cost[u][v] < dist[v]:
                dist[v] = dist[u] + cost[u][v]
    print(f'#{tc} {dist[n-1]}')
`, stdin: "1\n5\n0 4 0 0 8\n4 0 3 0 11\n0 3 0 7 0\n0 0 7 0 2\n8 11 0 2 0\n" },

  bj10814: { code: `import sys
input = sys.stdin.readline

n = int(input())
people = []
for i in range(n):
    a, name = input().split()
    people.append((int(a), i, name))
people.sort()
for age, idx, name in people:
    print(age, name)
`, stdin: "5\n21 Junkyu\n21 Dohyun\n20 Sunyoung\n30 Kimhy\n20 Ahn\n" },

  citygraph: `# 문자열 노드 그래프 (도시 이름)
from collections import deque
graph = {
    "서울": ["대전", "인천"],
    "대전": ["대구", "광주"],
    "인천": ["광주"],
    "대구": ["부산"],
    "광주": ["부산"],
    "부산": [],
}
visited = set()
order = []
q = deque(["서울"])
visited.add("서울")
while q:
    cur = q.popleft()
    order.append(cur)
    for nx in graph[cur]:
        if nx not in visited:
            visited.add(nx)
            q.append(nx)
print(order)
`,

  robot: `# 로봇 청소기 (격자 + 방향)
n, m = 5, 5
board = [[0] * m for _ in range(n)]
board[0][0] = 1
board[2][2] = 1
dr = [-1, 0, 1, 0]
dc = [0, 1, 0, -1]
r, c, d = 2, 2, 0
cleaned = 0
for step in range(12):
    if board[r][c] == 0:
        board[r][c] = 2
        cleaned += 1
    d = (d + 3) % 4
    nr = r + dr[d]
    nc = c + dc[d]
    if 0 <= nr < n and 0 <= nc < m and board[nr][nc] == 0:
        r, c = nr, nc
print(cleaned)
`,

  parametric: `# 파라메트릭 서치 (나무 자르기)
trees = [20, 15, 10, 17]
need = 7
lo, hi = 0, max(trees)
answer = 0
while lo <= hi:
    mid = (lo + hi) // 2
    total = 0
    for t in trees:
        if t > mid:
            total += t - mid
    if total >= need:
        answer = mid
        lo = mid + 1
    else:
        hi = mid - 1
print(answer)
`,

  tupleset: `# 좌표 집합으로 방문 표시 (파이썬 격자 BFS 의 흔한 꼴)
from collections import deque
board = [
    [0, 0, 0, 1],
    [1, 1, 0, 1],
    [0, 0, 0, 0],
    [0, 1, 1, 0],
]
n = 4
visited = set()
q = deque([(0, 0)])
visited.add((0, 0))
step = 0
while q:
    r, c = q.popleft()
    step += 1
    for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
        nr, nc = r + dr, c + dc
        if 0 <= nr < n and 0 <= nc < n and board[nr][nc] == 0 and (nr, nc) not in visited:
            visited.add((nr, nc))
            q.append((nr, nc))
print(len(visited))
`,

  segquery: `# 세그먼트 트리 구간 합 질의와 갱신
n = 8
arr = [5, 3, 7, 9, 2, 6, 4, 1]
tree = [0] * (2 * n)
for i in range(n):
    tree[n + i] = arr[i]
for i in range(n - 1, 0, -1):
    tree[i] = tree[2 * i] + tree[2 * i + 1]

def query(l, r):
    res = 0
    l += n
    r += n + 1
    while l < r:
        if l % 2:
            res += tree[l]
            l += 1
        if r % 2:
            r -= 1
            res += tree[r]
        l //= 2
        r //= 2
    return res

def update(i, v):
    i += n
    tree[i] = v
    while i > 1:
        i //= 2
        tree[i] = tree[2 * i] + tree[2 * i + 1]

print(query(2, 5))
update(3, 100)
print(query(2, 5))
`,

  tsp: `# 외판원 순회 (비트마스크 DP)
INF = 10 ** 9
n = 4
w = [[0, 10, 15, 20], [5, 0, 9, 10], [6, 13, 0, 12], [8, 8, 9, 0]]
memo = {}
def go(cur, mask):
    if mask == (1 << n) - 1:
        return w[cur][0] if w[cur][0] else INF
    if (cur, mask) in memo:
        return memo[(cur, mask)]
    best = INF
    for nx in range(n):
        if mask & (1 << nx):
            continue
        if not w[cur][nx]:
            continue
        cost = w[cur][nx] + go(nx, mask | (1 << nx))
        if cost < best:
            best = cost
    memo[(cur, mask)] = best
    return best
print(go(0, 1))
`,

  edit: `# 편집 거리
a = "kitten"
b = "sitting"
n, m = len(a), len(b)
dp = [[0] * (m + 1) for _ in range(n + 1)]
for i in range(n + 1):
    dp[i][0] = i
for j in range(m + 1):
    dp[0][j] = j
for i in range(1, n + 1):
    for j in range(1, m + 1):
        if a[i-1] == b[j-1]:
            dp[i][j] = dp[i-1][j-1]
        else:
            dp[i][j] = 1 + min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
print(dp[n][m])
`,

  bipartite: `# 이분 그래프 판별 (노드 색칠)
from collections import deque
graph = {0: [1, 3], 1: [0, 2], 2: [1, 3], 3: [0, 2]}
n = 4
color = [-1] * n
ok = True
for s in range(n):
    if color[s] != -1:
        continue
    color[s] = 0
    q = deque([s])
    while q:
        u = q.popleft()
        for v in graph[u]:
            if color[v] == -1:
                color[v] = 1 - color[u]
                q.append(v)
            elif color[v] == color[u]:
                ok = False
print(ok, color)
`,

  bellman: `# 벨만-포드 (간선 리스트 반복)
INF = 10 ** 9
n = 5
edges = [(0, 1, 6), (0, 2, 7), (1, 2, 8), (1, 3, 5), (2, 3, -3), (3, 4, 2), (2, 4, 9)]
dist = [INF] * n
dist[0] = 0
for step in range(n - 1):
    for u, v, w in edges:
        if dist[u] != INF and dist[u] + w < dist[v]:
            dist[v] = dist[u] + w
print(dist)
`,

  radix: `# 버킷(기수) 정렬
a = [170, 45, 75, 90, 2, 802, 24, 66]
out = a[:]
place = 1
for rnd in range(3):
    bucket = [[] for _ in range(10)]
    for x in out:
        bucket[(x // place) % 10].append(x)
    out = []
    for b in bucket:
        for x in b:
            out.append(x)
    place *= 10
print(out)
`,

  twostackq: `# 스택 두 개로 큐 만들기
inbox = []
outbox = []
res = []
for op in [1, 2, 3, 0, 4, 0, 0, 5, 0]:
    if op:
        inbox.append(op)
    else:
        if not outbox:
            while inbox:
                outbox.append(inbox.pop())
        res.append(outbox.pop())
print(res)
`,

  palindp: `# 회문 분할 DP
s = "aabba"
n = len(s)
pal = [[False] * n for _ in range(n)]
for i in range(n):
    pal[i][i] = True
for L in range(2, n + 1):
    for i in range(n - L + 1):
        j = i + L - 1
        if s[i] == s[j] and (L == 2 or pal[i+1][j-1]):
            pal[i][j] = True
cut = [0] * n
for i in range(n):
    if pal[0][i]:
        cut[i] = 0
    else:
        cut[i] = 10 ** 9
        for j in range(i):
            if pal[j+1][i] and cut[j] + 1 < cut[i]:
                cut[i] = cut[j] + 1
print(cut[n-1])
`,

  counterlib: `# collections.Counter (파이썬에서 제일 흔한 세기)
from collections import Counter
s = "abracadabra"
cnt = Counter()
for ch in s:
    cnt[ch] += 1
best = cnt.most_common(1)[0]
print(best, dict(cnt))
`,

  scc: `# SCC 낮은 링크 (타잔)
n = 6
graph = {0: [1], 1: [2], 2: [0, 3], 3: [4], 4: [5], 5: [3]}
idx = [-1] * n
low = [-1] * n
onstk = [False] * n
stk = []
timer = 0
comps = []
def dfs(u):
    global timer
    idx[u] = low[u] = timer
    timer += 1
    stk.append(u)
    onstk[u] = True
    for v in graph[u]:
        if idx[v] == -1:
            dfs(v)
            low[u] = min(low[u], low[v])
        elif onstk[v]:
            low[u] = min(low[u], idx[v])
    if low[u] == idx[u]:
        comp = []
        while True:
            w = stk.pop()
            onstk[w] = False
            comp.append(w)
            if w == u:
                break
        comps.append(comp)
for s in range(n):
    if idx[s] == -1:
        dfs(s)
print(comps)
`,

  diameter: `# 트리 지름 (BFS 두 번)
from collections import deque
adj = {1: [2, 3], 2: [1, 4, 5], 3: [1], 4: [2], 5: [2, 6], 6: [5]}
def bfs(start):
    dist = {start: 0}
    q = deque([start])
    far = start
    while q:
        u = q.popleft()
        for v in adj[u]:
            if v not in dist:
                dist[v] = dist[u] + 1
                if dist[v] > dist[far]:
                    far = v
                q.append(v)
    return far, dist[far]
a, _ = bfs(1)
b, d = bfs(a)
print(a, b, d)
`,
};
