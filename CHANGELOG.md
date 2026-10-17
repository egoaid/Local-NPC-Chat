# CHANGELOG
## 0.2.0-build.001 — 2026-10-17
- 追加: LFM2.5-1.2B-JP（202606版 ONNX, q4f16）を追加。350Mとアプリ内で切り替え可能。
- GPUメモリ: 常に1モデルのみ常駐。切替時は先に解放→読込。手動解放ボタン、5分間タブが非表示なら自動解放（戻ると保存済みから自動再読込）。読込失敗時は元のモデルに自動で戻す。
- ダウンロード状態（未DL/保存済み/使用中）、進捗(MB)、エラー表示、モデル別の保存データ削除、保存容量の表示。
- shader-f16 非対応の端末では1.2B-JPを選べないように。
- 公式URL https://egoaid.github.io/Local-NPC-Chat/ を反映（sitemap / canonical / og）。
## 0.1.0-build.002 — 2026-10-17
- 修正: モデル読込が `Failed to resolve module specifier "onnxruntime-web/webgpu"` で失敗する問題。import mapを追加し、ONNX Runtime Webを同梱(vendor/)。
- 修正: 「更新して再読み込み／あとで」バナーが常時表示されていた問題（`hidden`がCSSに上書きされていた）。
- 修正: エラー分類が「ダウンロード失敗」に誤判定されないよう調整。
## 0.1.0-build.001 — 2026-10-17
- 初版プロトタイプ。
