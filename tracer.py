"""사용자 코드를 한 줄씩 실행하면서 그 시점의 지역변수를 통째로 찍어둔다.

핵심 아이디어: print 를 박아서 확인하던 걸, 모든 시점에 대해 미리 다 찍어두고
나중에 슬라이더로 훑어보게 만든다.
"""

import sys
import io
import re
import json
import types
import collections

MAX_STEPS = 20000        # 무한루프 방어. 넘으면 거기까지만 보여준다
MAX_LIST = 400          # 이보다 긴 리스트는 통째로 안 뜬다
MAX_STR = 200
MAX_DEPTH = 3           # 리스트를 몇 겹까지 펴서 볼 것인가 (2차원 표 + 튜플)
MAX_DICT_DEPTH = 10     # 딕셔너리는 더 깊이 편다. 트라이가 글자 수만큼 겹친다
MAX_OBJS = 200          # 한 프레임에서 따라갈 사용자 객체 수 상한

FILENAME = "<user>"

# 정렬 key 람다, 컴프리헨션 같은 건 파이썬이 만드는 부속 프레임이다.
# 이걸 호출로 세면 sort(key=lambda ...) 한 줄에 "호출 스택"이 뜬다.
HIDDEN_FRAMES = ("<lambda>", "<listcomp>", "<setcomp>", "<dictcomp>", "<genexpr>")


class _StepLimit(Exception):
    pass


# 사용자 정의 객체에 작은 번호를 매긴다. id() 는 재사용되므로 살려둔 참조를
# 같이 들고 있어야 번호가 겹치지 않는다 (링크드리스트 노드가 중간에 사라지는 경우).
_OBJ_IDS = {}
_OBJ_KEEP = []


def _reset_objs():
    _OBJ_IDS.clear()
    del _OBJ_KEEP[:]


def _obj_id(v):
    key = id(v)
    if key not in _OBJ_IDS:
        _OBJ_IDS[key] = len(_OBJ_IDS) + 1
        _OBJ_KEEP.append(v)
    return _OBJ_IDS[key]


def _is_user_object(v):
    """클래스로 만든 인스턴스인가. 링크드리스트 노드, 트리 노드가 여기 걸린다."""
    if isinstance(v, type) or callable(v) or isinstance(v, types.ModuleType):
        return False
    return hasattr(v, "__dict__") and bool(vars(v))


def _snap(v, depth=0, objs=None):
    """JSON 으로 보낼 수 있는 형태로 값을 복사한다. 복사라서 나중에 변해도 안전하다."""
    if v is None or isinstance(v, bool):
        return v
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        # NaN/inf 는 JSON 에서 깨지므로 문자열로 뺀다
        if v != v or v in (float("inf"), float("-inf")):
            return {"__repr__": repr(v)}
        return v
    if isinstance(v, str):
        return v if len(v) <= MAX_STR else v[:MAX_STR] + "..."
    if isinstance(v, collections.deque):
        # BFS 는 거의 항상 deque 를 쓴다. 리스트로 안 펴면 큐 내용이 통째로
        # "deque([(0, 0)])" 같은 문자열이 돼서 정작 제일 궁금한 게 안 보인다.
        if depth >= MAX_DEPTH or len(v) > MAX_LIST:
            return {"__repr__": "deque(len=%d)" % len(v)}
        return [_snap(x, depth + 1, objs) for x in v]
    if isinstance(v, (list, tuple)):
        # 깊이 3 까지 편다. 가중치 인접리스트가 dict -> list -> tuple 로 세 겹이라
        # 2 에서 끊으면 (이웃, 가중치) 쌍이 통째로 문자열이 돼 그래프를 못 알아본다.
        if depth >= MAX_DEPTH or len(v) > MAX_LIST:
            return {"__repr__": "%s(len=%d)" % (type(v).__name__, len(v))}
        return [_snap(x, depth + 1, objs) for x in v]
    if isinstance(v, dict):
        if depth >= MAX_DICT_DEPTH or len(v) > MAX_LIST:
            return {"__repr__": "dict(len=%d)" % len(v)}
        return {"__dict__": [[_snap(k, depth + 1, objs), _snap(x, depth + 1, objs)] for k, x in v.items()]}
    if isinstance(v, (set, frozenset)):
        if depth >= 2 or len(v) > MAX_LIST:
            return {"__repr__": "set(len=%d)" % len(v)}
        return {"__set__": [_snap(x, depth + 1, objs) for x in v]}
    if objs is not None and _is_user_object(v):
        # 객체는 표에 따로 담고 본문에는 번호만 남긴다.
        # 이러면 순환(연결리스트의 prev, 트리의 parent)도 안전하고,
        # 같은 객체가 여러 군데서 참조돼도 한 번만 저장된다.
        oid = _obj_id(v)
        if oid not in objs:
            if len(objs) >= MAX_OBJS:
                return {"__repr__": type(v).__name__ + "(...)"}
            objs[oid] = None                       # 순환 방지용 자리 맡기
            fields = {}
            for fk, fv in vars(v).items():
                if fk.startswith("_"):
                    continue
                if callable(fv) or isinstance(fv, types.ModuleType):
                    continue
                # 객체 필드는 깊이를 새로 센다. 연결리스트를 끝까지 따라가야 한다.
                fields[fk] = _snap(fv, 0, objs)
            objs[oid] = {"cls": type(v).__name__, "fields": fields}
        return {"__ref__": oid}
    r = repr(v)
    return {"__repr__": r if len(r) <= MAX_STR else r[:MAX_STR] + "..."}


def _compiles(src):
    try:
        compile(src, FILENAME, "exec")
        return True
    except SyntaxError:
        return False


def _truncate(source, end_line):
    """end_line 줄까지만 남긴 소스를 돌려준다.

    블록 한가운데서 자르면 문법이 깨진다 (`for i in ...:` 다음에서 자르는 경우).
    그럴 땐 pass 를 붙여 보고, 그래도 안 되면 될 때까지 한 줄씩 뒤로 물러난다.
    앞부분 줄 번호는 그대로라 코드 하이라이트가 안 어긋난다.
    """
    lines = source.split("\n")
    if end_line <= 0 or end_line >= len(lines):
        return source, 0

    head = lines[:end_line]
    while head:
        src = "\n".join(head)
        if _compiles(src):
            return src, len(head)
        last = ""
        for line in reversed(head):
            if line.strip():
                last = line
                break
        if last.rstrip().endswith(":"):
            indent = len(last) - len(last.lstrip()) + 4
            src2 = src + "\n" + " " * indent + "pass"
            if _compiles(src2):
                return src2, len(head)
        head.pop()
    return "", 0


def _only_locals(frame, objs):
    """진짜 지역변수만. 호출 스택의 인자 표시에 쓴다.

    _locals_of 는 전역까지 합쳐주는데, 그걸 인자로 보여주면
    find(parent=[...], a=1, b=2, x=1) 처럼 남의 변수가 인자인 척한다.
    """
    out = {}
    for k, v in frame.f_locals.items():
        if k.startswith("__"):
            continue
        if callable(v) or isinstance(v, types.ModuleType):
            continue
        out[k] = _snap(v, 0, objs)
    return out


def _locals_of(frame, objs):
    """이 프레임에서 보이는 변수들. 전역도 같이 담는다.

    지역변수만 담으면 함수 안으로 들어가는 순간 화면이 비어버린다.
    유니온 파인드의 parent, 퀵소트의 arr 처럼 전역 자료구조를 함수가 만지는
    코드가 흔한데, 정작 그 함수 안에 있는 동안 아무것도 안 보이게 된다.
    지역이 전역을 덮어쓰는 파이썬 규칙 그대로, 전역 먼저 깔고 지역을 덮는다.
    """
    out = {}
    deques = []
    scopes = []
    if frame.f_globals is not frame.f_locals:
        scopes.append(frame.f_globals)
    scopes.append(frame.f_locals)
    for scope in scopes:
        for k, v in scope.items():
            if k.startswith("__"):
                continue
            # 함수와 모듈은 그릴 것도 없고 변수 패널만 어지럽힌다.
            # (import sys / input = sys.stdin.readline 같은 빠른 입력 상용구)
            if callable(v) or isinstance(v, types.ModuleType):
                continue
            # deque 는 리스트로 펴서 보내지만, 그러면 화면에서 스택인지 큐인지
            # 구별이 안 된다. 값이 다 같으면 (예: [1,1,1]) 어느 쪽에서 뺐는지
            # 값만으로는 영영 알 수 없어서, 원래 타입을 따로 알려준다.
            if isinstance(v, collections.deque):
                deques.append(k)
            out[k] = _snap(v, 0, objs)
    return out, deques


# ---------- 입력 없이 구조만 보기 ----------
#
# 백준·SWEA 풀이는 대부분 input() 으로 시작한다. 입력 칸이 비어 있으면
# 첫 줄에서 멈춰서 **그림이 아예 안 나온다.**
# "테스트케이스를 찾아 오기 전에 구조부터 보고 싶다"는 게 흔한 요구다.
#
# 그래서 입력이 떨어지면 지어낸다. 다만 아무 값이나 넣으면 코드가 다른 데서
# 터지므로, **입력을 읽은 그 줄을 보고** 어떤 모양을 원하는지 맞춘다.
#
#     n = int(input())                      -> 숫자 하나
#     n, m = map(int, input().split())      -> 숫자 둘
#     arr = list(map(int, input().split())) -> 숫자 여러 개
#     row = list(map(int, input().strip())) -> 숫자를 붙여 쓴 한 줄 (미로 지도)
#     s = input()                           -> 글자
#
# 몇 개를 줄지는 **직전에 지어낸 숫자**를 쓴다. n 을 읽고 다음 줄에서 길이 n 짜리
# 배열을 읽는 게 이 바닥의 관례라, 그것만으로 대부분 맞는다.
#
# 지어낸 줄은 전부 돌려보내서 화면의 입력 칸에 그대로 채운다.
# **무엇을 먹였는지 안 보이면 그건 거짓말하는 그림이다.**

_FAKE_WORDS = ["apple", "banana", "cherry", "date", "elder", "fig", "grape", "kiwi"]

# 테스트케이스 개수로 보이는 이름. 크게 주면 같은 그림을 열 번 반복해서 보게 된다.
_TC_NAMES = ("t", "tc", "test", "tests", "testcase", "test_case", "case", "cases")

# 두 개를 받아 "구간"으로 쓰는 이름들. 뒤집혀 나오면 arr[l-1:r] 이 빈 칸이 되어
# 질의 답이 전부 0 으로 나온다. 이런 이름 쌍은 작은 수를 앞에 놓는다.
_RANGE_PAIRS = (("l", "r"), ("lo", "hi"), ("s", "e"),
                ("left", "right"), ("start", "end"))

# 문자열을 찾는 코드에 무관한 두 낱말(apple / banana)을 주면 "못 찾음"만 보인다.
# 겹치는 접두사가 있는 이 쌍은 KMP·부분문자열·LCS 어디에 넣어도 그림이 산다.
_PAIR_TEXT = "abacaba"
_PAIR_PAT = "aba"

_INT_CALL = re.compile(r"\bint\(\s*([A-Za-z_]\w*)\s*\)")
_NUM_WORD = re.compile(r"\b(int|float)\s*[(,]")
_LIT_EQ = re.compile(r"""\b([A-Za-z_]\w*)(?:\[0\])?\s*==\s*(['"])([^'"]*)\2""")
_NUM_EQ = re.compile(r"""\b([A-Za-z_]\w*)\s*==\s*(-?\d+)\b""")
_RANGE1 = re.compile(r"""range\(\s*([A-Za-z_]\w*)""")
_RANGE2 = re.compile(r"""range\([^,()]*,\s*([A-Za-z_]\w*)[^,()]*\)""")
_TIMES = re.compile(r"""\*\(?\s*([A-Za-z_]\w*)""")

# 코드가 실제로 견주는 한 글자들. board[i][j] == '#' 처럼 왼쪽이 첨자라
# 이름으로는 안 잡힌다. 이걸 알아야 지도를 그 코드의 글자로 지어낸다.
_CHAR_EQ = re.compile(r"""==\s*(['"])(.)\1""")
# a[i] == b[j] — 문자열 두 개를 자리마다 견주는 코드.
_SUB_EQ = re.compile(r"""\b([A-Za-z_]\w*)\[[^\]]+\]\s*==\s*([A-Za-z_]\w*)\[""")

# 여러 숫자를 반복해 읽는 줄은 대개 간선·좌표·물건이다. 아무 수나 주면
# 늘 이웃끼리 이어진 한 줄짜리 그래프가 나온다. 미리 짜둔 이 쌍들은
# 다섯 점을 고루 잇는다 — 어느 알고리즘에 넣어도 볼 것이 생긴다.
_PAIRS = ((1, 2), (1, 3), (2, 4), (3, 5), (4, 5), (2, 3), (1, 4), (3, 4), (2, 5), (1, 5))


def _target_names(t):
    """`a, b = map(...)` 의 왼쪽에서 받는 이름들. 이름이 아니면 빈 문자열."""
    cut = -1
    depth = 0
    for i, c in enumerate(t):
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        elif c == "=" and depth == 0:
            if i + 1 < len(t) and t[i + 1] == "=":
                break
            if i > 0 and t[i - 1] in "=!<>+-*/%":
                continue
            cut = i
            break
    if cut < 0:
        # for line in sys.stdin: 처럼 = 이 없는 줄. 반복 변수가 받는 이름이다.
        if t.startswith("for ") and " in " in t:
            head = t[4:t.find(" in ")].strip().strip("()[]")
            out = []
            for x in head.split(","):
                x = x.strip()
                out.append(x if x.isidentifier() else "")
            return out
        return []
    head = t[:cut].strip().strip("()[]")
    out = []
    for x in head.split(","):
        x = x.strip()
        out.append(x if x.isidentifier() else "")
    return out


def _targets(t):
    """`a, b = map(...)` 처럼 왼쪽에서 몇 개를 받는지 센다."""
    return max(1, len(_target_names(t)))


def _pick_len(state):
    """몇 개를 줄 것인가. 가로 크기를 이미 읽었으면 그걸 쓴다."""
    n = state.get("width")
    if not isinstance(n, int):
        n = state["last_n"]
    if not isinstance(n, int):
        n = 5
    return max(2, min(8, n))


def _wants_number(t):
    """이 줄이 숫자를 원하는가. map(int, ...) 처럼 괄호 없이 쉼표만 오는 꼴도
    잡아야 한다. 예전엔 int( 만 봐서 map(float, ...) 이 낱말을 받고 터졌다."""
    return _NUM_WORD.search(t) is not None


def _scan_hints(source):
    """코드 전체를 한 번 훑어, 한 줄만 봐서는 알 수 없는 것들을 모은다.

    한 줄만 보는 방식의 한계가 여기서 드러났다.
      age, name = input().split() 은 그 줄만 보면 숫자가 없다. 하지만
      아래에서 int(age) 를 하므로 age 자리는 숫자여야 한다.
    """
    nospace = "".join(source.split())
    ints = set(_INT_CALL.findall(source))

    # if op == "add": 처럼 정해진 낱말과 비교하는 자리에 아무 낱말이나 넣으면
    # 조건이 한 번도 참이 안 되어 "아무 일도 안 일어나는" 그림이 된다.
    lits = {}
    for name, _q, word in _LIT_EQ.findall(source):
        if word:
            lits.setdefault(name, [])
            if word not in lits[name]:
                lits[name].append(word)

    # 낱말 한 개를 통째로 읽는 줄이 정확히 두 개고, 둘 다 반복문 안이 아니면
    # "문자열 두 개를 받아 비교하는 문제"로 본다.
    bare = 0
    for line in source.split("\n"):
        s = line.strip()
        if "input(" not in s and "readline(" not in s:
            continue
        if ("split" in s) or ("for " in s) or _wants_number(s):
            continue
        bare += 1
    # board[i][j] 처럼 두 번 첨자를 붙이면, 한 줄씩 읽은 문자열은 낱말이 아니라
    # **격자 한 줄**이다. 이게 없으면 n 개의 낱말을 읽는 코드와 구별할 수 없다.
    grid2d = re.search(r"[A-Za-z_]\w*\[[^]]+\]\[[^]]+\]", nospace) is not None
    hunts = any(m in nospace for m in
                (".find(", ".index(", ".count(", ".startswith(", ".endswith("))
    # a[i] == b[i] 로 자리마다 견주는 코드도 "문자열 두 개" 문제다.
    # 이게 없으면 apple / banana 를 줘서 겹치는 글자가 하나도 없었다.
    pairwise = False
    for x, y in _SUB_EQ.findall(source):
        if x != y:
            pairwise = True
    twostr = (bare == 2) and (hunts or pairwise or ("dp[" in nospace))

    # 코드가 견주는 한 글자들. 지도를 이 글자로 지어내야 조건이 걸린다.
    chars = []
    for _q, c in _CHAR_EQ.findall(source):
        if c not in chars:
            chars.append(c)

    # 갈림길이 있으면 정해진 낱말만 계속 주면 안 된다. else 쪽이 영영 안 돈다.
    haselse = ("else" in nospace) or ("elif" in nospace)

    # if n == 0: break — 끝내라는 신호다. 처음부터 주면 한 바퀴도 안 돌고 끝난다.
    stopnum = set()
    src_lines = source.split(chr(10))
    for idx, line in enumerate(src_lines):
        found = [n for n, _l in _NUM_EQ.findall(line)]
        found += [n for n, _q, _w in _LIT_EQ.findall(line)]
        if not found:
            continue
        tail = " ".join(src_lines[idx:idx + 3])
        if ("break" in tail) or ("exit(" in tail):
            for name in found:
                stopnum.add(name)

    # 크기로 쓰이는 이름. range(n) 이나 [0] * n 의 자리에 오는 것들이다.
    # 이걸 알아야 "5 6" 같은 크기 줄과 간선 줄을 갈라낼 수 있다.
    sizes = set(_RANGE1.findall(nospace))
    sizes |= set(_RANGE2.findall(nospace))
    sizes |= set(_TIMES.findall(nospace))

    # x == 0 처럼 정해진 숫자와 비교하는 자리. 그 숫자가 한 번도 안 나오면
    # 그쪽 가지는 영영 안 돌아 "밀어넣기만 하는" 그림이 된다.
    nums = {}
    for name, lit in _NUM_EQ.findall(source):
        nums.setdefault(name, [])
        if int(lit) not in nums[name]:
            nums[name].append(int(lit))

    return {"ints": ints, "twostr": twostr, "nospace": nospace,
            "grid2d": grid2d, "lits": lits, "sizes": sizes, "nums": nums,
            "chars": chars, "haselse": haselse, "stopnum": stopnum}


def _ranged(names, hints):
    """이 두 이름이 구간의 양 끝으로 쓰이는가. 그러면 작은 수를 앞에 둔다."""
    if len(names) != 2:
        return False
    a, b = names[0].lower(), names[1].lower()
    if (a, b) not in _RANGE_PAIRS:
        return False
    ns = hints["nospace"]
    return (":" + names[1] + "]") in ns or ("range(" + names[0] + ",") in ns


def _char_word(ch, count):
    """코드가 견주는 글자들로 여섯 글자를 짓는다.

    글자가 둘이면 짝이 맞게 짠다 — 괄호 검사 코드가 "맞다"와 "틀리다"를
    둘 다 보여줄 수 있게, 줄마다 짝이 맞는 것과 안 맞는 것을 번갈아 낸다.
    """
    if len(ch) == 2:
        a, b = ch[0], ch[1]
        if count % 2 == 0:
            return a + a + b + a + b + b          # 짝이 맞는 꼴
        return a + b + b + a + a + b              # 짝이 어긋난 꼴
    out = []
    for i in range(6):
        out.append(ch[(count + i) % len(ch)])
    return "".join(out)


def _grid_row(k, count, hints):
    """지도 한 줄. 길이 k, 양 끝은 반드시 뚫어 두고 벽은 한 칸만 둔다.

    벽을 많이 두면 BFS 가 못 지나가고, 하나도 안 두면 "벽을 센다"는 코드가
    0 을 답으로 낸다. 한 칸만 두고 줄마다 자리를 옮기면 둘 다 산다.
    글자는 **코드가 실제로 견주는 글자**를 쓴다. 지도를 . 과 # 으로 고정하면
    g[i][j] == 'W' 같은 코드는 조건이 한 번도 안 걸린다.
    """
    ch = hints["chars"]
    if ch and all(c.isdigit() for c in ch):
        # 숫자를 글자로 읽는 지도. 1 이 길, 0 이 벽인 게 관례다.
        road = "1" if "1" in ch else ch[0]
        wall = "0" if "0" in ch else (ch[1] if len(ch) > 1 else "0")
    else:
        road = "."
        wall = "#"
        for c in ch:
            if c != ".":
                wall = c
                break
    gap = (count % max(1, k - 2)) + 1
    out = []
    for i in range(k):
        out.append(wall if (0 < i < k - 1 and i == gap) else road)
    return "".join(out)


def _word_for(name, i, count, hints, rep):
    """이름 하나가 받을 값. 정해진 낱말 > 숫자 > 아무 낱말 순으로 고른다."""
    lit = hints["lits"].get(name)
    if lit:
        # if line == "end": break — 끝내라는 신호다. 첫 줄에 주면 한 바퀴도 안 돈다.
        if name in hints["stopnum"] and len(lit) == 1:
            if rep < 5:
                return _FAKE_WORDS[rep % len(_FAKE_WORDS)]
            return lit[0]
        if len(lit) > 1 or not hints["haselse"]:
            return lit[rep % len(lit)]
        # 견주는 낱말이 하나뿐인데 else 가 있으면, 늘 맞히면 else 쪽이 안 돈다.
        # 한 번 걸러 안 맞는 낱말을 준다 (YES / yes 처럼 보기에도 자연스럽게).
        if rep % 2 == 0:
            return lit[0]
        other = lit[0].lower()
        if other == lit[0]:
            other = lit[0].upper()
        return other if other != lit[0] else _FAKE_WORDS[rep % len(_FAKE_WORDS)]
    if name in hints["ints"]:
        # 3 을 곱하면 9 로 나눈 나머지가 세 개뿐이라 값이 금방 겹쳤다.
        return str(((count * 5 + i * 4) % 9) + 1)
    return _FAKE_WORDS[(count + i) % len(_FAKE_WORDS)]


def _fake_line(text, state, count, hints, rep):
    """이 줄이 원하는 모양을 짐작해 한 줄을 지어낸다. state 를 직접 고친다.

    state 가 기억하는 것.
      last_n  직전에 지어낸 숫자. 다음 줄이 "몇 개짜리인가"에 쓴다
      width   크기 줄에서 읽은 가로 길이. 표(격자)의 한 줄 길이가 된다
      bound   인덱스처럼 쓰일 숫자의 상한
      words   낱말을 몇 번 지어냈는가

    bound 가 필요한 이유: n, m = map(int, input().split()) 다음에
    a, b = map(int, input().split()) 로 간선을 읽는 코드가 흔한데, 거기서
    n 보다 큰 번호를 주면 graph[a] 가 IndexError 로 터진다. 실제로 터졌다.

    그리고 **맨 처음 읽는 여러 숫자는 크기**(n, m)다. 여기에 상한을 걸면
    n = 1 짜리 배열이 나와서 볼 게 없어진다. 첫 줄만 넉넉히 준다.
    """
    t = text.strip()
    has_split = ".split()" in t
    boxed = ("list(" in t) or ("sorted(" in t) or ("[*" in t) or ("*," in t)
    # *arr, = map(int, input().split()) — 별표로 받는 것도 통째로 담는 줄이다.
    # 예전엔 이걸 "두 개를 받는 줄"로 봐서 값 두 개만 줬다.
    if "=" in t and "*" in t[:t.find("=")]:
        boxed = True
    first = state["last_n"] is None
    names = _target_names(t)

    if not _wants_number(t):
        # 줄 전체엔 int 가 없어도, 받는 이름 중 일부만 아래에서 int() 되는 경우가 있다.
        # age, name = input().split() 가 그것이다. 자리마다 갈라서 채운다.
        # cmd = input().split() 뒤에 cmd[0] == "push" 로 갈라지는 꼴.
        # 명령 낱말 하나에 값 하나를 붙여 준다 (cmd[1] 을 쓰는 코드가 많다).
        if has_split and len(names) == 1 and names[0] in hints["lits"]:
            lit = hints["lits"][names[0]]
            return lit[rep % len(lit)] + " " + str((count * 3 % 5) + 1)

        if has_split and names and any(
                (n in hints["ints"]) or (n in hints["lits"]) for n in names):
            return " ".join(_word_for(n, i, count, hints, rep)
                            for i, n in enumerate(names))

        if has_split:
            # 받는 개수를 지켜야 한다. 예전엔 늘 다섯 낱말을 줘서
            # age, name = input().split() 이 "값이 너무 많다"로 터졌다.
            k = _targets(t) if names else _pick_len(state)
            return " ".join(_FAKE_WORDS[(count + i) % len(_FAKE_WORDS)] for i in range(k))

        if boxed:
            # list(input().strip()) 은 한 줄을 **글자 하나씩** 쪼갠다.
            # 낱말을 띄어 주면 공백까지 칸이 되어 지도가 뭉개졌다 (실제로 그랬다).
            state["words"] += 1
            return _grid_row(_pick_len(state), count, hints)

        # 낱말 한 개. 가로 크기를 이미 읽었다면 그건 낱말이 아니라 **지도 한 줄**이다.
        # (n, m 을 읽고 나서 board = [input() for _ in range(n)] 하는 그 꼴)
        wide = state.get("width")
        if not isinstance(wide, int) and hints["grid2d"] and isinstance(state["last_n"], int):
            wide = state["last_n"]          # n 만 읽은 정사각 격자
        if isinstance(wide, int):
            state["words"] += 1
            return _grid_row(max(2, min(12, wide)), count, hints)

        if hints["twostr"] and state["words"] < 2:
            state["words"] += 1
            return _PAIR_TEXT if state["words"] == 1 else _PAIR_PAT

        # 코드가 글자 두 가지 이상을 견주면(괄호 짝 맞추기가 대표) 그 글자로 짓는다.
        # apple 을 주면 여는 괄호도 닫는 괄호도 없어 아무 일도 안 일어난다.
        ch = hints["chars"]
        named = names[0] if names else ""
        if len(ch) >= 2 and named not in hints["lits"] and named not in hints["ints"]:
            state["words"] += 1
            return _char_word(ch, count)

        state["words"] += 1
        if names and names[0]:
            return _word_for(names[0], 0, count, hints, rep)
        return _FAKE_WORDS[count % len(_FAKE_WORDS)]

    # 숫자를 붙여 쓴 한 줄. list(map(int, input().strip())) 은 미로 지도가 대표라
    # 길이 막히지 않게 1 을 많이 섞고 양 끝은 반드시 1 로 둔다 (안 그러면 못 도착한다).
    if not has_split and boxed:
        k = _pick_len(state)
        # 줄마다 벽 자리를 옮겨 놓는다. 모든 줄이 똑같으면 지도가 아니라 줄무늬다.
        gap = (count % max(1, k - 2)) + 1
        return "".join("0" if (0 < i < k - 1 and i == gap) else "1" for i in range(k))

    if boxed:
        # 데이터 값이라 인덱스 상한을 안 지켜도 된다. 값이 다양해야 그림이 산다.
        # count 를 섞는 이유: 표를 여러 줄 읽을 때 모든 줄이 똑같으면
        # 5x5 짜리 표가 같은 줄 다섯 개로 보인다 (실제로 그랬다).
        k = _pick_len(state)
        return " ".join(str(((count * 7 + i * 5 + 3) % 9) + 1) for i in range(k))

    k = _targets(t) if has_split else 1
    if k == 1:
        raw = names[0] if names else ""
        head = raw.lower()
        # 읽은 숫자가 곧바로 range() 로 들어가면 그건 "몇 번 반복하나"다.
        # for _ in range(int(input())): 가 그것이다. 크게 주면 같은 그림만 반복된다.
        nl = "".join(t.split())
        # for _ in range(1, int(input()) + 1): 처럼 1 부터 세는 꼴도 잡아야 한다.
        # 이름이 tc 가 아니면(_ 이면) 예전엔 그냥 5 를 줘서 다섯 번 반복했다.
        tc = (head in _TC_NAMES
              or "range(int(" in nl
              or (t.startswith("for ") and "range(" in nl and "input" in nl))
        if tc:
            state["last_n"] = 1
            state["bound"] = max(2, min(state["bound"], 5))
            return "1"

        # 같은 줄을 여러 번 읽거나(한 줄 안에 for 가 있거나), 정해진 숫자와
        # 비교되는 이름이면 그건 크기가 아니라 **값**이다.
        # 예전엔 전부 5 를 줘서, 힙에 5 를 다섯 번 넣는 그림만 나왔다.
        lit = hints["nums"].get(raw)
        if rep > 0 or ("for " in t) or lit:
            b = state["bound"]
            # if n == 0: break 는 **끝내라**는 신호다. 두 번째에 바로 주면
            # 한 바퀴 돌고 끝나 볼 것이 없다. 다섯 바퀴는 돌린 뒤에 준다.
            stop = raw in hints["stopnum"]
            due = rep >= 5 if stop else rep % 2 == 1
            if lit and due:
                return str(lit[(rep // 2) % len(lit)])
            # rep * 7 은 상한 5 에서 1,3,5,2,4 로 한 바퀴를 돈다 (겹치지 않는다).
            return str(((rep * 7) % b) + 1)

        state["last_n"] = 5
        state["bound"] = max(2, min(state["bound"], 5))
        return "5"

    # 크기 줄인가, 데이터 줄인가. 이걸 못 가르면 n, m 자리에 간선 번호가 들어가
    # 5x5 판이 4x1 이 되고, 거꾸로 좌표 자리에 크기가 들어가 점이 다 같아진다.
    # 판별 근거: 그 이름이 코드에서 range()·리스트 크기로 쓰이는가. 그리고
    # **같은 줄을 두 번째 읽는 순간부터는 무조건 데이터다** (크기는 한 번만 읽는다).
    sized = any(n and n in hints["sizes"] for n in names)
    if (first or sized) and rep == 0:
        vals = [5, 6, 4, 3, 7][:k]
        # n - m 처럼 두 크기를 빼는 코드는 m 이 "칸 수"가 아니라 창 크기다.
        # 그대로 5, 6 을 주면 n - m + 1 이 0 이 되어 아무 일도 안 일어난다.
        window = k >= 2 and _subtracts(names, hints)
        if window:
            vals = [5, 3, 2, 2, 2][:k]
        state["last_n"] = vals[0]
        state["bound"] = max(2, min(state["bound"], vals[0]))
        if k >= 2:
            # 창 크기라면 판은 정사각이다. 아니면 마지막이 가로 길이 (n, m 관례).
            state["width"] = vals[0] if window else vals[-1]
        return " ".join(str(v) for v in vals)

    # 데이터 줄. 미리 짜둔 쌍을 돌려 쓴다 — 계산식으로 만들면 상한에 따라
    # 두 값이 늘 붙어 나와 그래프가 한 줄로 늘어섰다 (실제로 그랬다).
    b = state["bound"]
    pair = _PAIRS[state["rows"] % len(_PAIRS)]
    state["rows"] += 1
    vals = []
    for i in range(k):
        if i < 2:
            vals.append(((pair[i] - 1) % b) + 1)
        else:
            vals.append(((state["rows"] * 3 + i * 2) % 9) + 1)   # 가중치·값
    if k >= 2 and vals[0] == vals[1]:                # 자기 자신으로 가는 간선은 피한다
        vals[1] = (vals[1] % b) + 1
    if _ranged(names, hints):
        lo, hi = min(vals[0], vals[1]), max(vals[0], vals[1])
        vals[0], vals[1] = lo, hi
    return " ".join(str(v) for v in vals)


def _subtracts(names, hints):
    """두 크기 이름이 코드에서 서로 빼지는가 (range(n - m + 1) 같은 꼴)."""
    a, b = names[0], names[1]
    if not a or not b:
        return False
    ns = hints["nospace"]
    return (a + "-" + b) in ns or (b + "-" + a) in ns


def _fake_blob():
    """sys.stdin.read() 처럼 통째로 읽는 코드에 줄 뭉치.

    이 꼴은 읽고 나서 .split() 으로 잘라 쓰기 때문에 남는 숫자는 버려진다.
    그래서 크기 한 줄 + 값 한 줄 뒤에 여유분을 넉넉히 붙여도 안전하다.
    예전엔 여기서 아무것도 안 지어내 data[0] 부터 IndexError 로 터졌다."""
    rows = ["5", "4 9 5 1 6"]
    for r in range(1, 7):
        rows.append(" ".join(str(((r * 7 + i * 5 + 3) % 9) + 1) for i in range(5)))
    return "\n".join(rows) + "\n"


class _AutoStdin:
    """입력이 떨어지면 지어내 주는 stdin. readline 은 개행을 붙여 돌려준다."""

    def __init__(self, buf, synth, blob):
        self._buf = buf
        self._synth = synth
        self._blob = blob
        self._given = 0

    def readline(self, *a):
        line = self._buf.readline(*a)
        return line if line != "" else self._synth() + "\n"

    def read(self, *a):
        # 통째로 읽는 코드(data = sys.stdin.read().split())는 여기로 온다.
        # 빈 문자열을 그대로 주면 data[0] 부터 터진다.
        got = self._buf.read(*a)
        return got if got != '' else self._blob()

    def readlines(self, *a):
        return self._buf.readlines(*a)

    def __iter__(self):
        return self

    def __next__(self):
        # for line in sys.stdin: 은 끝이 있어야 멈춘다. 지어내기만 하면
        # 영원히 돌아 20000 단계를 채우고 만다. 몇 줄만 주고 닫는다.
        line = self._buf.readline()
        if line != "":
            return line
        if self._given >= 6:
            raise StopIteration
        self._given += 1
        return self._synth() + chr(10)


def run(source, stdin_text="", end_line=0, auto_input=False):
    source, used_end = _truncate(source, end_line)
    if not source.strip():
        return json.dumps({
            "timeline": [], "stdout": "", "truncated": False, "endLine": 0,
            "error": {"type": "EmptyRange", "msg": "그 줄까지는 실행할 코드가 없습니다.", "line": None},
        })

    _reset_objs()
    src_lines = source.split("\n")
    timeline = []
    stdout = io.StringIO()
    stdin = io.StringIO(stdin_text)
    error = None
    truncated = False

    made = []                 # 지어낸 줄. 화면의 입력 칸에 그대로 채워 보여준다

    def _synth():
        """입력이 떨어졌을 때, 그걸 읽은 줄을 보고 한 줄 지어낸다."""
        f = sys._getframe(1)
        while f is not None and f.f_code.co_filename != FILENAME:
            f = f.f_back
        text = src_lines[f.f_lineno - 1] if (f and 0 < f.f_lineno <= len(src_lines)) else ""
        # 이 줄을 몇 번째로 읽는가. 첫 번째는 크기, 두 번째부터는 데이터다.
        # (크기는 한 번만 읽는다 — 같은 줄을 또 읽으면 그건 값이다)
        key = f.f_lineno if f else 0
        per = fake_state["per"]
        rep = per.get(key, 0)
        per[key] = rep + 1
        got = _fake_line(text, fake_state, fake_state["count"], hints, rep)
        fake_state["count"] += 1
        made.append(got)
        if rep + 1 > 12:
            # while True: input() 처럼 끝을 모르고 읽는 코드. 한 줄에서만
            # 예순 번을 읽으면 볼 것도 없이 길기만 하다. 열두 번에서 끊는다.
            raise EOFError("입력이 끝났습니다. 더 필요하면 입력 칸에 직접 채워주세요.")
        if len(made) > 60:
            # 끝을 모르고 계속 읽는 코드(while True: input())가 여기 걸린다.
            # try/except EOFError 로 끝내는 코드라면 이걸로 자연스럽게 빠져나간다.
            raise EOFError("입력이 끝났습니다. 더 필요하면 입력 칸에 직접 채워주세요.")
        return got

    hints = _scan_hints(source) if auto_input else _scan_hints("")
    fake_state = {"last_n": None, "bound": 5, "count": 0, "width": None,
                  "words": 0, "per": {}, "rows": 0}

    def _blob():
        got = _fake_blob()
        for row in got.rstrip(chr(10)).split(chr(10)):
            made.append(row)
        return got

    def _input(prompt=""):
        # 브라우저에는 진짜 stdin 이 없다. 입력 칸의 내용을 한 줄씩 떼어준다.
        if prompt:
            stdout.write(str(prompt))
        line = stdin.readline()
        if line != "":
            return line.rstrip("\n")
        if not auto_input:
            raise EOFError("입력이 부족합니다. 왼쪽 아래 '입력' 칸에 줄을 더 채워주세요.")
        return _synth()

    def _depth(frame):
        """이 프레임이 사용자 함수 안에서 몇 겹째인가. 모듈 최상단이 0."""
        d = 0
        f = frame.f_back
        while f is not None:
            if (f.f_code.co_filename == FILENAME
                    and f.f_code.co_name not in HIDDEN_FRAMES):
                d += 1
            f = f.f_back
        return d

    def tracer(frame, event, arg):
        if frame.f_code.co_filename != FILENAME:
            return None
        if frame.f_code.co_name in HIDDEN_FRAMES:
            return tracer          # 안쪽은 계속 따라가되 이 프레임 자체는 안 남긴다
        # call 도 기록한다. 그 시점의 지역변수가 곧 "이 호출에 넘어온 인자"라
        # 재귀에서 fact(6) -> fact(5) -> ... 를 그대로 되살릴 수 있다.
        if event in ("call", "line", "return"):
            # 잘라내면서 덧붙인 pass 같은 건 기록하지 않는다 (없는 줄이 하이라이트된다)
            if used_end and frame.f_lineno > used_end:
                return tracer
            if len(timeline) >= MAX_STEPS:
                raise _StepLimit()
            objs = {}
            snap_vars, snap_deques = _locals_of(frame, objs)
            entry = {
                "line": frame.f_lineno,
                "event": event,
                "func": frame.f_code.co_name,
                "depth": _depth(frame),
                "vars": snap_vars,
                "out": len(stdout.getvalue()),
            }
            if objs:
                entry["objs"] = objs
            if snap_deques:
                entry["deques"] = snap_deques
            if event == "call":
                entry["args"] = _only_locals(frame, objs)   # 이 호출에 실제로 넘어온 것만
            if event == "return":
                entry["ret"] = _snap(arg, 0, objs)
            timeline.append(entry)
        return tracer

    real_stdout = sys.stdout
    try:
        code = compile(source, FILENAME, "exec")
    except SyntaxError as e:
        return json.dumps({
            "timeline": [], "stdout": "", "truncated": False, "endLine": used_end,
            "error": {"type": "SyntaxError", "msg": str(e), "line": e.lineno},
        })

    # input 을 전역에 넣어두면 빌트인보다 먼저 잡힌다.
    # sys.stdin 은 sys.stdin.readline() 을 쓰는 코드(빠른 입력)를 위해 따로 갈아끼운다.
    g = {"__name__": "__main__", "input": _input}
    real_stdin = sys.stdin
    sys.stdout = stdout
    # `input = sys.stdin.readline` 은 백준 풀이의 관용구다. 그 길로 들어오는
    # 읽기도 똑같이 지어내야 한다 — 안 그러면 그 코드들만 빈 문자열을 받아
    # 엉뚱한 데서(ValueError) 터진다.
    sys.stdin = _AutoStdin(stdin, _synth, _blob) if auto_input else stdin
    sys.settrace(tracer)
    try:
        exec(code, g)
    except _StepLimit:
        truncated = True
    except BaseException as e:
        tb = e.__traceback__
        line = None
        while tb is not None:
            if tb.tb_frame.f_code.co_filename == FILENAME:
                line = tb.tb_lineno
            tb = tb.tb_next
        error = {"type": type(e).__name__, "msg": str(e), "line": line}
    finally:
        sys.settrace(None)
        sys.stdout = real_stdout
        sys.stdin = real_stdin

    return json.dumps({
        "timeline": timeline,
        "stdout": stdout.getvalue(),
        "truncated": truncated,
        "endLine": used_end,
        "error": error,
        # 지어낸 입력은 반드시 돌려보낸다. 화면의 입력 칸에 그대로 채워야
        # 사용자가 "무엇을 먹였는지" 보고 고칠 수 있다.
        "made": made,
    })
