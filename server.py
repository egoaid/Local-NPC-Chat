#!/usr/bin/env python3
# ============================================================
# server.py
# 開発用のローカルサーバー。python3 -m http.server との違いは、
# 全レスポンスに「キャッシュしない」ヘッダーを付けていること。
#
# ブラウザの標準キャッシュは js/css を積極的にキャッシュするため、
# ファイルを編集してブラウザをリロードしても「前のバージョンのまま」
# に見えることがある。このサーバーで配信すれば、リロードのたびに
# 必ず最新のファイルが読み込まれる(ハードリロードやキャッシュの
# 手動クリアが不要になる)。
# ============================================================

import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class NoCacheHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    # ログを少し静かにする(毎リクエストのログはノイズになりやすいため)
    def log_message(self, format, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


with ReusableTCPServer(("", PORT), NoCacheHTTPRequestHandler) as httpd:
    print(f"Serving at http://localhost:{PORT}/  (キャッシュ無効化ヘッダー付き)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nサーバーを停止しました。")
