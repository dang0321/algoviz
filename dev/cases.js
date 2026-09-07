/* 드롭다운에 안 실은 확인용 코드들.
 *
 * 뒷부분(bj*, swea_*)은 **실제 코딩 테스트 풀이 모양**이다 —
 * sys.stdin.readline, 여러 테스트케이스, f-string 출력.
 * 사용자가 실제로 붙여넣을 코드의 생김새라, 여기서 구멍이 제일 많이 나왔다.
 *
 * samples.js 는 사용자가 고르는 예제고, 이 파일은 "새 유형을 넣었을 때
 * 다른 게 망가지지 않았나"를 보는 용도다. 화면에 안 나온다.
 *
 * 쓰는 법: 브라우저 콘솔에서
 *   for (const f of ["/dev/cases.js", "/dev/sweep.js"])
 *     (0, eval)(await (await fetch(f, {cache: "no-store"})).text());
 *   SWEEP(SAMPLES); SWEEP(DEVCASES);
 */
window.DEVCASES = {

kmp: `# KMP 실패함수
p = "ababaca"
fail = [0] * len(p)
j = 0
for i in range(1, len(p)):
    while j > 0 and p[i] != p[j]:
        j = fail[j - 1]
    if p[i] == p[j]:
        j += 1
        fail[i] = j
print(fail)
`,

rotate: `# 행렬 90도 회전
m = [[1,2,3],[4,5,6],[7,8,9]]
n = len(m)
res = [[0] * n for _ in range(n)]
for i in range(n):
    for j in range(n):
        res[j][n - 1 - i] = m[i][j]
for row in res:
    print(row)
`,

backtrack: `# 백트래킹 조합
n, k = 4, 2
path = []
result = []
def rec(start):
    if len(path) == k:
        result.append(path[:])
        return
    for i in range(start, n + 1):
        path.append(i)
        rec(i + 1)
        path.pop()
rec(1)
print(result)
`,

dfsrec: `# 재귀 DFS + 방문 집합
adj = {1:[2,3], 2:[4], 3:[4,5], 4:[6], 5:[6], 6:[]}
visited = set()
order = []
def dfs(u):
    visited.add(u)
    order.append(u)
    for v in adj[u]:
        if v not in visited:
            dfs(v)
dfs(1)
print(order)
`,

josephus: `# 요세푸스 (큐 시뮬레이션)
from collections import deque
n, k = 7, 3
q = deque(range(1, n + 1))
out = []
while q:
    for _ in range(k - 1):
        q.append(q.popleft())
    out.append(q.popleft())
print(out)
`,

maxwindow: `# 슬라이딩 윈도우 최댓값 (덱)
from collections import deque
a = [1, 3, -1, -3, 5, 3, 6, 7]
k = 3
dq = deque()
res = []
for i in range(len(a)):
    while dq and a[dq[-1]] <= a[i]:
        dq.pop()
    dq.append(i)
    if dq[0] <= i - k:
        dq.popleft()
    if i >= k - 1:
        res.append(a[dq[0]])
print(res)
`,

prefix2d: `# 2차원 누적합
g = [[1,2,3],[4,5,6],[7,8,9]]
n = 3
pre = [[0] * (n + 1) for _ in range(n + 1)]
for i in range(n):
    for j in range(n):
        pre[i+1][j+1] = g[i][j] + pre[i][j+1] + pre[i+1][j] - pre[i][j]
print(pre[3][3] - pre[1][1])
`,

gcd: `# 유클리드 호제법
a, b = 1071, 462
while b:
    a, b = b, a % b
print(a)
`,

stringparse: `# 문자열 단어 세기
text = "the quick brown fox jumps over the lazy dog the fox"
words = text.split()
count = {}
for w in words:
    if w in count:
        count[w] += 1
    else:
        count[w] = 1
best = max(count, key=count.get)
print(best, count[best])
`,

matmul: `# 행렬 곱셈
A = [[1,2],[3,4]]
B = [[5,6],[7,8]]
C = [[0,0],[0,0]]
for i in range(2):
    for j in range(2):
        for k in range(2):
            C[i][j] += A[i][k] * B[k][j]
print(C)
`,

paren: `# 괄호 검사
s = "({[()]}"
stack = []
pairs = {")": "(", "]": "[", "}": "{"}
ok = True
for ch in s:
    if ch in "([{":
        stack.append(ch)
    else:
        if not stack or stack[-1] != pairs[ch]:
            ok = False
            break
        stack.pop()
print(ok and not stack)
`,

gear: `# 톱니바퀴 회전 (덱)
from collections import deque
g = deque([1, 0, 1, 1, 0, 0, 1, 0])
for turn in [1, -1, 1, -1, 1]:
    g.rotate(turn)
    print(list(g))
`,

base: `# 진법 변환
n = 1000
digits = []
while n > 0:
    digits.append(n % 7)
    n //= 7
digits.reverse()
print(digits)
`,

sortpts: `# 좌표 정렬
pts = [(3, 1), (1, 5), (2, 2), (1, 2), (3, 0)]
pts.sort()
for p in pts:
    print(p)
`,

lcp: `# 최장 공통 접두사
words = ["flower", "flow", "flight"]
pre = words[0]
for w in words[1:]:
    while not w.startswith(pre):
        pre = pre[:-1]
print(pre)
`,

snake: `# 뱀 시뮬레이션 (격자 + 덱)
from collections import deque
n = 6
board = [[0] * n for _ in range(n)]
board[2][3] = 1
snake = deque([(0, 0)])
board[0][0] = 2
dr = [0, 1, 0, -1]
dc = [1, 0, -1, 0]
d = 0
r = c = 0
for step in range(7):
    r += dr[d]
    c += dc[d]
    if not (0 <= r < n and 0 <= c < n):
        break
    snake.append((r, c))
    if board[r][c] != 1:
        tr, tc = snake.popleft()
        board[tr][tc] = 0
    board[r][c] = 2
    if step % 3 == 2:
        d = (d + 1) % 4
print(len(snake))
`,

matmulk: `# 행렬 곱셈 (i, j, k 3중 루프)
A = [[1,2,3],[4,5,6],[7,8,9]]
B = [[9,8,7],[6,5,4],[3,2,1]]
C = [[0]*3 for _ in range(3)]
for i in range(3):
    for j in range(3):
        for k in range(3):
            C[i][j] += A[i][k] * B[k][j]
print(C)
`,

coin: `# 동전 그리디
coins = [500, 100, 50, 10]
n = 1260
used = []
rest = n
for c in coins:
    q = rest // c
    used.append(q)
    rest -= q * c
print(used, rest)
`,

powmod: `# 모듈러 거듭제곱
base, e, mod = 7, 20, 1000
res = 1
b = base % mod
ex = e
while ex > 0:
    if ex % 2 == 1:
        res = res * b % mod
    b = b * b % mod
    ex //= 2
print(res)
`,

compress: `# 좌표 압축
xs = [100, 5, 5, 300, 50, 100, 7]
uniq = sorted(set(xs))
rank = {}
for i, v in enumerate(uniq):
    rank[v] = i
small = []
for v in xs:
    small.append(rank[v])
print(small)
`,

sweep: `# 이벤트 스위핑 (동시 접속자 최대)
ivs = [(1, 5), (2, 7), (4, 6), (8, 9), (3, 4)]
ev = []
for s, e in ivs:
    ev.append((s, 1))
    ev.append((e, -1))
ev.sort()
cur = 0
best = 0
for t, d in ev:
    cur += d
    if cur > best:
        best = cur
print(best)
`,

lru: `# LRU 캐시 (리스트 + 딕셔너리)
cap = 3
order = []
cache = {}
for k in [1, 2, 3, 1, 4, 2, 5, 1]:
    if k in cache:
        order.remove(k)
        order.append(k)
    else:
        if len(order) == cap:
            old = order.pop(0)
            del cache[old]
        cache[k] = k * 10
        order.append(k)
print(order, cache)
`,

bj1260: { code: `import sys
input = sys.stdin.readline

n, m, v = map(int, input().split())
graph = [[] for _ in range(n + 1)]
for _ in range(m):
    a, b = map(int, input().split())
    graph[a].append(b)
    graph[b].append(a)
for i in range(1, n + 1):
    graph[i].sort()

visited = [False] * (n + 1)
order = []
def dfs(x):
    visited[x] = True
    order.append(x)
    for y in graph[x]:
        if not visited[y]:
            dfs(y)
dfs(v)
print(*order)
`, stdin: "4 5 1\n1 2\n1 3\n1 4\n2 4\n3 4\n" },

bj2178: { code: `import sys
from collections import deque
input = sys.stdin.readline

n, m = map(int, input().split())
board = [list(map(int, input().strip())) for _ in range(n)]
dist = [[0] * m for _ in range(n)]
dx = [-1, 1, 0, 0]
dy = [0, 0, -1, 1]

q = deque([(0, 0)])
dist[0][0] = 1
while q:
    x, y = q.popleft()
    for d in range(4):
        nx = x + dx[d]
        ny = y + dy[d]
        if 0 <= nx < n and 0 <= ny < m and board[nx][ny] == 1 and dist[nx][ny] == 0:
            dist[nx][ny] = dist[x][y] + 1
            q.append((nx, ny))
print(dist[n-1][m-1])
`, stdin: "4 6\n101111\n101010\n101011\n111011\n" },

bj7576: { code: `import sys
from collections import deque
input = sys.stdin.readline

m, n = map(int, input().split())
box = [list(map(int, input().split())) for _ in range(n)]
q = deque()
for i in range(n):
    for j in range(m):
        if box[i][j] == 1:
            q.append((i, j))
dx = [-1, 1, 0, 0]
dy = [0, 0, -1, 1]
day = 0
while q:
    x, y = q.popleft()
    for k in range(4):
        nx = x + dx[k]
        ny = y + dy[k]
        if 0 <= nx < n and 0 <= ny < m and box[nx][ny] == 0:
            box[nx][ny] = box[x][y] + 1
            q.append((nx, ny))
for row in box:
    day = max(day, max(row))
print(day - 1)
`, stdin: "6 4\n0 0 0 0 0 0\n0 0 0 0 0 0\n0 0 0 0 0 0\n0 0 0 0 0 1\n" },

bj1697: { code: `import sys
from collections import deque
input = sys.stdin.readline

n, k = map(int, input().split())
MAX = 30
dist = [-1] * (MAX + 1)
q = deque([n])
dist[n] = 0
while q:
    x = q.popleft()
    if x == k:
        break
    for nx in (x - 1, x + 1, x * 2):
        if 0 <= nx <= MAX and dist[nx] == -1:
            dist[nx] = dist[x] + 1
            q.append(nx)
print(dist[k])
`, stdin: "5 17\n" },

bj11726: { code: `import sys
input = sys.stdin.readline

n = int(input())
dp = [0] * (n + 1)
dp[1] = 1
if n >= 2:
    dp[2] = 2
for i in range(3, n + 1):
    dp[i] = (dp[i-1] + dp[i-2]) % 10007
print(dp[n])
`, stdin: "9\n" },

bj1874: { code: `import sys
input = sys.stdin.readline

n = int(input())
seq = [int(input()) for _ in range(n)]
stack = []
res = []
cur = 1
ok = True
for x in seq:
    while cur <= x:
        stack.append(cur)
        res.append('+')
        cur += 1
    if stack[-1] == x:
        stack.pop()
        res.append('-')
    else:
        ok = False
        break
print('\\n'.join(res) if ok else 'NO')
`, stdin: "8\n4\n3\n6\n8\n7\n5\n2\n1\n" },

swea_fly: { code: `import sys
input = sys.stdin.readline

T = int(input())
for tc in range(1, T + 1):
    n, m = map(int, input().split())
    board = [list(map(int, input().split())) for _ in range(n)]
    best = 0
    for i in range(n - m + 1):
        for j in range(n - m + 1):
            total = 0
            for a in range(m):
                for b in range(m):
                    total += board[i + a][j + b]
            if total > best:
                best = total
    print(f'#{tc} {best}')
`, stdin: "1\n5 3\n7 2 5 3 1\n1 5 2 9 2\n2 4 5 3 8\n4 5 6 7 2\n9 3 5 1 3\n" },

swea_million: { code: `import sys
input = sys.stdin.readline

T = int(input())
for tc in range(1, T + 1):
    n = int(input())
    price = list(map(int, input().split()))
    best = 0
    profit = 0
    for i in range(n - 1, -1, -1):
        if price[i] > best:
            best = price[i]
        else:
            profit += best - price[i]
    print(f'#{tc} {profit}')
`, stdin: "1\n8\n1 1 3 1 2 1 4 1\n" },

bj11279: { code: `import sys, heapq
input = sys.stdin.readline

n = int(input())
h = []
out = []
for _ in range(n):
    x = int(input())
    if x == 0:
        out.append(heapq.heappop(h)[1] if h else 0)
    else:
        heapq.heappush(h, (-x, x))
print(*out)
`, stdin: "9\n0\n12\n2\n0\n0\n0\n5\n7\n0\n" },

bj2606: { code: `import sys
input = sys.stdin.readline

n = int(input())
m = int(input())
parent = list(range(n + 1))
def find(x):
    while parent[x] != x:
        x = parent[x]
    return x
edges = []
for _ in range(m):
    a, b = map(int, input().split())
    edges.append((a, b))
for a, b in edges:
    ra, rb = find(a), find(b)
    if ra != rb:
        parent[rb] = ra
cnt = 0
root = find(1)
for i in range(2, n + 1):
    if find(i) == root:
        cnt += 1
print(cnt)
`, stdin: "7\n6\n1 2\n2 3\n1 5\n5 2\n5 6\n4 7\n" },

histogram: `# 히스토그램 최대 직사각형 (단조 스택)
h = [2, 1, 5, 6, 2, 3]
stack = []
best = 0
for i in range(len(h)):
    while stack and h[stack[-1]] > h[i]:
        top = stack.pop()
        width = i if not stack else i - stack[-1] - 1
        area = h[top] * width
        if area > best:
            best = area
    stack.append(i)
while stack:
    top = stack.pop()
    width = len(h) if not stack else len(h) - stack[-1] - 1
    area = h[top] * width
    if area > best:
        best = area
print(best)
`,

bisectlis: `# LIS 이분탐색 버전
import bisect
a = [10, 9, 2, 5, 3, 7, 101, 18]
tails = []
for x in a:
    i = bisect.bisect_left(tails, x)
    if i == len(tails):
        tails.append(x)
    else:
        tails[i] = x
print(len(tails))
`,

printer: `# 프린터 큐 (우선순위 시뮬레이션)
from collections import deque
docs = deque([(0, 2), (1, 1), (2, 3), (3, 2)])
order = []
while docs:
    cur = docs.popleft()
    if any(cur[1] < d[1] for d in docs):
        docs.append(cur)
    else:
        order.append(cur[0])
print(order)
`,

bstclass: `# 이진 탐색 트리 삽입
class Node:
    def __init__(self, v):
        self.v = v
        self.left = None
        self.right = None

root = None
def insert(node, v):
    if node is None:
        return Node(v)
    if v < node.v:
        node.left = insert(node.left, v)
    else:
        node.right = insert(node.right, v)
    return node

for x in [8, 3, 10, 1, 6, 14, 4]:
    root = insert(root, x)
print("done")
`,

threesum: `# 세 수의 합 (정렬 + 투 포인터)
a = [-4, -1, -1, 0, 1, 2]
a.sort()
found = []
for i in range(len(a) - 2):
    lo, hi = i + 1, len(a) - 1
    while lo < hi:
        s = a[i] + a[lo] + a[hi]
        if s == 0:
            found.append((a[i], a[lo], a[hi]))
            lo += 1
            hi -= 1
        elif s < 0:
            lo += 1
        else:
            hi -= 1
print(found)
`,

rotarr: `# 배열 회전 (덱 없이)
a = [1, 2, 3, 4, 5, 6, 7]
k = 3
n = len(a)
out = [0] * n
for i in range(n):
    out[(i + k) % n] = a[i]
print(out)
`,

matpow: `# 행렬 거듭제곱 (분할정복)
MOD = 1000
def mul(A, B):
    return [[sum(A[i][k] * B[k][j] for k in range(2)) % MOD for j in range(2)] for i in range(2)]
base = [[1, 1], [1, 0]]
res = [[1, 0], [0, 1]]
e = 10
while e > 0:
    if e % 2 == 1:
        res = mul(res, base)
    base = mul(base, base)
    e //= 2
print(res[0][1])
`,

gen: `# 제너레이터
def counter(n):
    i = 0
    while i < n:
        yield i * i
        i += 1

out = []
for v in counter(6):
    out.append(v)
print(out)
`,

classheap: `# 클래스 + heapq (__lt__ 정의)
import heapq
class Task:
    def __init__(self, pri, name):
        self.pri = pri
        self.name = name
    def __lt__(self, other):
        return self.pri < other.pri

h = []
for p, nm in [(3, "c"), (1, "a"), (4, "d"), (2, "b")]:
    heapq.heappush(h, Task(p, nm))
order = []
while h:
    order.append(heapq.heappop(h).name)
print(order)
`,

coindp: `# 동전 교환 DP (1차원)
coins = [1, 3, 4]
target = 11
INF = 10 ** 9
dp = [INF] * (target + 1)
dp[0] = 0
for i in range(1, target + 1):
    for c in coins:
        if i >= c and dp[i - c] + 1 < dp[i]:
            dp[i] = dp[i - c] + 1
print(dp[target])
`,

subsets: `# 비트 연산으로 부분집합 순회
a = [3, 1, 4, 1]
n = len(a)
best = 0
picked = []
for mask in range(1 << n):
    total = 0
    cur = []
    for i in range(n):
        if mask & (1 << i):
            total += a[i]
            cur.append(a[i])
    if total % 3 == 0 and total > best:
        best = total
        picked = cur
print(best, picked)
`,

mergetwo: `# 정렬된 두 배열 병합 (투 포인터)
a = [1, 4, 7, 9]
b = [2, 3, 8, 10, 12]
i = j = 0
out = []
while i < len(a) and j < len(b):
    if a[i] <= b[j]:
        out.append(a[i])
        i += 1
    else:
        out.append(b[j])
        j += 1
out += a[i:]
out += b[j:]
print(out)
`,

postfix: `# 후위 표기법 계산 (스택)
tokens = ["5", "3", "+", "8", "2", "-", "*"]
stack = []
for t in tokens:
    if t.isdigit():
        stack.append(int(t))
    else:
        b = stack.pop()
        a = stack.pop()
        if t == "+":
            stack.append(a + b)
        elif t == "-":
            stack.append(a - b)
        else:
            stack.append(a * b)
print(stack[0])
`,

circq: `# 원형 큐 (front / rear 가 감긴다)
size = 6
buf = [0] * size
front = 0
rear = 0
cnt = 0
log = []
for op in [1, 2, 3, -1, 4, 5, -1, -1, 6, 7, -1]:
    if op > 0 and cnt < size:
        buf[rear] = op
        rear = (rear + 1) % size
        cnt += 1
    elif op < 0 and cnt > 0:
        log.append(buf[front])
        buf[front] = 0
        front = (front + 1) % size
        cnt -= 1
print(log, buf)
`,

dice: `# 주사위 굴리기 (6칸 상태가 회전)
dice = [1, 2, 3, 4, 5, 6]
moves = ["E", "E", "S", "W", "N", "S"]
out = []
for m in moves:
    a, b, c, d, e, f = dice
    if m == "E":
        dice = [d, b, a, f, e, c]
    elif m == "W":
        dice = [c, b, f, a, e, d]
    elif m == "N":
        dice = [b, f, c, d, a, e]
    else:
        dice = [e, a, c, d, f, b]
    out.append(dice[0])
print(out)
`,

intervaldp: `# 구간 DP (행렬 곱셈 순서)
p = [10, 20, 5, 30, 15]
n = len(p) - 1
INF = 10 ** 9
dp = [[0] * n for _ in range(n)]
for length in range(2, n + 1):
    for i in range(n - length + 1):
        j = i + length - 1
        dp[i][j] = INF
        for k in range(i, j):
            cost = dp[i][k] + dp[k+1][j] + p[i] * p[k+1] * p[j+1]
            if cost < dp[i][j]:
                dp[i][j] = cost
print(dp[0][n-1])
`,

minstack: `# 최소 스택 (값 스택 + 최솟값 스택)
stack = []
mins = []
log = []
for op in [5, 3, 7, 0, 2, 0, 0, 8]:
    if op:
        stack.append(op)
        mins.append(op if not mins else min(op, mins[-1]))
    else:
        stack.pop()
        mins.pop()
    log.append(mins[-1] if mins else None)
print(log)
`,

extgcd: `# 확장 유클리드
a, b = 240, 46
old_r, r = a, b
old_s, s = 1, 0
old_t, t = 0, 1
while r != 0:
    q = old_r // r
    old_r, r = r, old_r - q * r
    old_s, s = s, old_s - q * s
    old_t, t = t, old_t - q * t
print(old_r, old_s, old_t)
`,

lcasparse: `# LCA 희소 배열
LOG = 3
n = 7
par = [-1, 0, 0, 1, 1, 2, 2]
up = [[-1] * n for _ in range(LOG)]
for v in range(n):
    up[0][v] = par[v]
for k in range(1, LOG):
    for v in range(n):
        mid = up[k-1][v]
        up[k][v] = -1 if mid < 0 else up[k-1][mid]
print(up)
`,

defdict: `# defaultdict 로 그래프 만들기
from collections import defaultdict
graph = defaultdict(list)
edges = [(1, 2), (1, 3), (2, 4), (3, 4), (4, 5)]
for a, b in edges:
    graph[a].append(b)
    graph[b].append(a)
visited = set()
order = []
def dfs(u):
    visited.add(u)
    order.append(u)
    for v in graph[u]:
        if v not in visited:
            dfs(v)
dfs(1)
print(order)
`,

itertools: `# itertools 조합
from itertools import combinations
a = [1, 2, 3, 4]
found = []
for c in combinations(a, 2):
    if sum(c) % 2 == 0:
        found.append(c)
print(found)
`,

slicing: `# 문자열을 잘라 먹으며 진행
s = "abcdefgh"
out = []
while len(s) > 2:
    out.append(s[0] + s[-1])
    s = s[1:-1]
print(out, s)
`,

transpose: `# 격자 전치와 회전
g = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
t = [list(row) for row in zip(*g)]
r = [list(row)[::-1] for row in zip(*g)]
for row in t:
    print(row)
for row in r:
    print(row)
`,

anagram: `# 아나그램 윈도우 (투 포인터 + 카운트)
s = "cbaebabacd"
p = "abc"
need = [0] * 26
win = [0] * 26
for ch in p:
    need[ord(ch) - 97] += 1
res = []
for i in range(len(s)):
    win[ord(s[i]) - 97] += 1
    if i >= len(p):
        win[ord(s[i - len(p)]) - 97] -= 1
    if i >= len(p) - 1 and win == need:
        res.append(i - len(p) + 1)
print(res)
`,

bigadd: `# 큰 수 덧셈 (문자열)
a = "98765432109876543210"
b = "12345678901234567890"
i, j = len(a) - 1, len(b) - 1
carry = 0
digits = []
while i >= 0 or j >= 0 or carry:
    x = int(a[i]) if i >= 0 else 0
    y = int(b[j]) if j >= 0 else 0
    t = x + y + carry
    digits.append(t % 10)
    carry = t // 10
    i -= 1
    j -= 1
digits.reverse()
print("".join(map(str, digits)))
`,
};
"cases: " + Object.keys(window.DEVCASES).length
