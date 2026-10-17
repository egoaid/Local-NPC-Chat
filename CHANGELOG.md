# CHANGELOG
## 0.1.0-build.002 — 2026-10-17
- 修正: モデル読込が `Failed to resolve module specifier "onnxruntime-web/webgpu"` で失敗する問題。import mapを追加し、ONNX Runtime Webを同梱(vendor/)。
- 修正: 「更新して再読み込み／あとで」バナーが常時表示されていた問題（`hidden`がCSSに上書きされていた）。
- 修正: エラー分類が「ダウンロード失敗」に誤判定されないよう調整。
## 0.1.0-build.001 — 2026-10-17
- 初版プロトタイプ。
