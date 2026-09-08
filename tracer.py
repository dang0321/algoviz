"""사용자 코드를 한 줄씩 실행하면서 그 시점의 지역변수를 통째로 찍어둔다.

핵심 아이디어: print 를 박아서 확인하던 걸, 모든 시점에 대해 미리 다 찍어두고
나중에 슬라이더로 훑어보게 만든다.
"""

import sys
import io
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


def _targets(t):
    """`a, b = map(...)` 처럼 왼쪽에서 몇 개를 받는지 센다."""
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
        return 1
    head = t[:cut]
    return max(1, len([x for x in head.split(",") if x.strip()]))


def _pick_len(last_n):
    n = last_n if isinstance(last_n, int) else 5
    return max(2, min(8, n))


def _wants_number(t):
    return ("int(" in t) or ("map(int" in t) or ("int," in t) or ("float(" in t)


def _fake_line(text, state, count):
    """이 줄이 원하는 모양을 짐작해 한 줄을 지어낸다. state 를 직접 고친다.

    state 가 기억하는 두 가지.
      last_n  직전에 지어낸 숫자. 다음 줄이 "몇 개짜리인가"에 쓴다
      bound   인덱스처럼 쓰일 숫자의 상한

    bound 가 필요한 이유: `n, m = map(int, input().split())` 다음에
    `a, b = map(int, input().split())` 로 간선을 읽는 코드가 흔한데, 거기서
    n 보다 큰 번호를 주면 graph[a] 가 IndexError 로 터진다. 실제로 터졌다.

    그리고 **맨 처음 읽는 여러 숫자는 크기**(n, m)다. 여기에 상한을 걸면
    n = 1 짜리 배열이 나와서 볼 게 없어진다. 첫 줄만 넉넉히 준다.
    """
    t = text.strip()
    has_split = ".split()" in t
    boxed = ("list(" in t) or ("sorted(" in t) or ("[*" in t) or ("*," in t)
    first = state["last_n"] is None

    if not _wants_number(t):
        if has_split or boxed:
            k = _pick_len(state["last_n"])
            return " ".join(_FAKE_WORDS[(count + i) % len(_FAKE_WORDS)] for i in range(k))
        return _FAKE_WORDS[count % len(_FAKE_WORDS)]

    # 숫자를 붙여 쓴 한 줄. `list(map(int, input().strip()))` 은 미로 지도가 대표라
    # 길이 막히지 않게 1 을 많이 섞고 양 끝은 반드시 1 로 둔다 (안 그러면 못 도착한다).
    if not has_split and boxed:
        k = _pick_len(state["last_n"])
        # 줄마다 벽 자리를 옮겨 놓는다. 모든 줄이 똑같으면 지도가 아니라 줄무늬다.
        gap = (count % max(1, k - 2)) + 1
        return "".join("0" if (0 < i < k - 1 and i == gap) else "1" for i in range(k))

    if boxed:
        # 데이터 값이라 인덱스 상한을 안 지켜도 된다. 값이 다양해야 그림이 산다.
        k = _pick_len(state["last_n"])
        return " ".join(str((i * 5 + 3) % 9 + 1) for i in range(k))

    k = _targets(t) if has_split else 1
    if k == 1:
        head = t[:t.find("=")].strip().lower() if "=" in t else ""
        if head in _TC_NAMES:
            state["last_n"] = 1
            state["bound"] = max(2, min(state["bound"], 5))
            return "1"
        state["last_n"] = 5
        state["bound"] = max(2, min(state["bound"], 5))
        return "5"

    if first:
        vals = [5, 4, 6, 3, 7][:k]                       # 첫 줄은 크기다. 넉넉히.
    else:
        # 줄마다 값을 옮긴다. 안 그러면 간선이 전부 "1 1" 이라 그래프가 점 하나가 된다.
        b = state["bound"]
        vals = [((count * 3 + i * 5) % b) + 1 for i in range(k)]
        if k >= 2 and vals[0] == vals[1]:                # 자기 자신으로 가는 간선은 피한다
            vals[1] = (vals[1] % b) + 1
    state["last_n"] = vals[-1]
    # **상한은 크기를 읽은 줄에서만 줄인다.** 간선 줄에서도 줄이면 상한이 계속
    # 작아져서, 나중엔 값이 두 가지뿐이라 그래프가 점 두 개가 된다 (실제로 그랬다).
    if first:
        state["bound"] = max(2, min([state["bound"]] + vals))
    return " ".join(str(v) for v in vals)


class _AutoStdin:
    """입력이 떨어지면 지어내 주는 stdin. readline 은 개행을 붙여 돌려준다."""

    def __init__(self, buf, synth):
        self._buf = buf
        self._synth = synth

    def readline(self, *a):
        line = self._buf.readline(*a)
        return line if line != "" else self._synth() + "\n"

    def read(self, *a):
        return self._buf.read(*a)

    def readlines(self, *a):
        return self._buf.readlines(*a)

    def __iter__(self):
        return self

    def __next__(self):
        return self.readline()


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
        got = _fake_line(text, fake_state, fake_state["count"])
        fake_state["count"] += 1
        made.append(got)
        if len(made) > 400:
            raise EOFError("지어낼 입력이 너무 많습니다. 입력 칸에 직접 넣어주세요.")
        return got

    fake_state = {"last_n": None, "bound": 5, "count": 0}

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
    sys.stdin = _AutoStdin(stdin, _synth) if auto_input else stdin
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
