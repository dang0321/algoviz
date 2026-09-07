"""개발용 정적 서버.

`python -m http.server` 는 Cache-Control 헤더를 안 보낸다. 그러면 브라우저가
"알아서" 캐시해버려서, 코드를 고치고 새로고침해도 옛 파일이 그대로 돈다.
이 도구는 고치고 바로 눈으로 확인하는 게 전부라 그 버그가 작업을 망친다.
그래서 매 응답에 no-store 를 붙인다.

    python serve.py [포트]        기본 8765
"""

import io
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_POST(self):
        """dev/baseline.txt 만 받아 쓴다 (리팩터 지문 갱신용).

        브라우저에서 뜬 지문을 손으로 옮겨 적는 건 낭비이기도 하고,
        옮기다 틀리면 없는 차이를 쫓게 된다. 개발 서버가 직접 받아 쓴다.
        127.0.0.1 로만 열고 이 파일 하나만 받는다."""
        if self.path != "/dev/baseline.txt":
            self.send_error(404)
            return
        n = int(self.headers.get("Content-Length") or 0)
        if n > 1 << 20:
            self.send_error(413)
            return
        body = self.rfile.read(n).decode("utf-8")
        root = os.path.dirname(os.path.abspath(__file__))
        with io.open(os.path.join(root, "dev", "baseline.txt"), "w",
                     encoding="utf-8", newline="") as fh:
            fh.write(body)
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(("%d줄 저장" % body.count(chr(10))).encode("utf-8"))

    def log_message(self, fmt, *args):
        # 요청마다 한 줄씩 찍히면 로그가 시끄러워서 오류만 남긴다
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    root = os.path.dirname(os.path.abspath(__file__))
    handler = partial(NoCacheHandler, directory=root)
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    print("algoviz  ->  http://localhost:%d   (%s)" % (port, root))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
