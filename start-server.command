#!/bin/bash
# ============================================================
# start-server.command
# macOS用: Finderでこのファイルをダブルクリックすると、
# 自動的にターミナルが開いてローカルサーバーが起動し、
# ブラウザで Car Sandbox Prototype が表示されます。
#
# 使い方:
#   1. このファイルをダブルクリック
#   2. (初回のみ)Gatekeeperの警告が出たら、
#      Finderでこのファイルを右クリック→「開く」を選び直してください
#   3. ブラウザが自動で開きます。終了する時はターミナルの
#      ウィンドウを閉じるか、ターミナル上で Control + C を押してください
# ============================================================

# このスクリプト自身がある場所(= index.html があるプロジェクトフォルダ)へ移動
cd "$(dirname "$0")" || exit 1

PORT=8000

# 指定ポートが使用中なら空いているポートを探す
while lsof -i tcp:"$PORT" >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

URL="http://localhost:${PORT}/"

echo "=================================================="
echo "  Car Sandbox Prototype を起動しています..."
echo "  URL: ${URL}"
echo "=================================================="
echo ""
echo "終了するには、このウィンドウを閉じるか Control+C を押してください。"
echo ""

# サーバーが立ち上がるのを少し待ってからブラウザを自動起動
( sleep 1 && open "${URL}" ) &

if command -v python3 >/dev/null 2>&1; then
  python3 server.py "$PORT"
elif command -v npx >/dev/null 2>&1; then
  npx --yes serve -l "$PORT" .
else
  echo "エラー: python3 も npx(Node.js) も見つかりませんでした。"
  echo "Homebrew等で Python3 か Node.js をインストールしてから、もう一度実行してください。"
  read -r -p "Enterキーを押すと閉じます..."
fi
