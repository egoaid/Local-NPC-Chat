# DEVELOPER_NOTES — v0.8.0-build.001

## build.2.0 (0.8.0-build.001): モデル切替
| key | repo | dtype | サイズ |
|---|---|---|---|
| lfm25-350m | LiquidAI/LFM2.5-350M-ONNX | q4 | 約290MB(推定) |
| lfm25-1.2b-jp | LiquidAI/LFM2.5-1.2B-JP-202606-ONNX | q4f16 | 744MB(モデルカード記載) |

- **注意**: 「LFM2.5-1.2B-JP の Q4F16」は、旧リポジトリ `LFM2.5-1.2B-JP-ONNX`（モデルカードはQ4/FP16/Q8のみ記載）には見当たらず、`LFM2.5-1.2B-JP-202606-ONNX`（q4f16 744MB、WebGPU推奨と明記）にあるため、後者を使用。**初代JP(2026-01版)ではなく202606版**。
- q4f16はFP16実行のため WebGPU `shader-f16` が必須。非対応端末では1.2Bを選択不可にしている。
- 生成パラメータはモデルごと（`config.js`）。1.2B-JPは temperature 0.3 / top_k 50 / repetition_penalty 1.05（カード推奨は0.1。会話の揺らぎ用に0.3）。
- GPUメモリ: `llm.js`が常に1モデルのみ保持。`PreTrainedModel.dispose()`でORTセッションを解放（ブラウザ/ドライバ側のメモリ返却は実装依存で、完全な解放は保証できない）。5分以上タブが非表示だと自動解放。読込失敗時は`dispose`してから元のモデルへ復帰。
- DL状態は Cache Storage(`transformers-cache`) 内の `.onnx` / `.onnx_data` / `tokenizer.json` の有無で判定（Transformers.jsは完了したファイルのみ保存する前提）。
- 未検証: 1.2B-JPの実読込・速度・メモリ、`dispose()`の効果、キャッシュ判定のURL形式。公式URL: https://egoaid.github.io/Local-NPC-Chat/

## build.002の注記（0.6.0で更新）
`transformers.web.min.js`の`onnxruntime-web/webgpu`/`onnxruntime-common`のimportは、0.6.0以降は同梱ファイル内で相対パスへ書き換え済み（import mapは廃止。commonはTensorのみ再エクスポートするshim）。ORTのwasm本体は引き続きjsDelivr(固定版)から取得され、Cache Storageに保存される。

## 要点
1. **フレームワーク**: Transformers.js `@huggingface/transformers@4.2.0`（`vendor/transformers.web.min.js` として同梱、Apache-2.0）。4.2.0は2026-04-22公開。最新は4.3.1だが公開から日が浅いため見送り。
2. **モデル**: `LiquidAI/LFM2.5-350M-ONNX`、`dtype: q4`、`device: webgpu`、`use_external_data_format: true`。revisionは`main`（**固定していない**。再現性が要るなら`config.js`でコミットハッシュに固定）。
3. **選定理由**: 仕様の「LFM2.5 350M級」そのものがONNX/WebGPU向けに公式提供されており、**代替モデルは使っていない**（§10の置換は発生せず）。
4. **サイズ**: Q4で約290MB（同じ形式の派生モデルのカードに289MBとあるための推定。公式リポジトリの実ファイルサイズは未確認）。
5. **ライセンス**: LFM Open License v1.0（HFメタデータは`lfm1.0`）。**条項（特に商用利用条件）は私は精査していない。公開前に必ず確認**。
6. **完全ブラウザ内**: 推論はWebGPU上。サーバー・APIキー不要。ただし初回に HuggingFace（モデル）と jsDelivr（ONNX Runtime Webのwasm/mjs。Transformers.jsが既定で取得）へアクセスする。
7. **キャッシュ**: モデルとwasmはTransformers.jsがCache Storage（`transformers-cache`）に保存。Service Workerは同一オリジンのみ処理し、モデル通信には介入しない。アプリ本体は`lnpc-shell-<version>`。両者は別管理で、アプリ更新時にモデルは消えない。
8. **Online Natural検出**: `speechSynthesis.getVoices()`（`voiceschanged`も監視）から、名前に Microsoft・Online・Natural を全て含む声を検出し、スコアで優先。性別は声名の語彙（Guy/Aria等）または"Male/Female"表記から推測（OS/ブラウザは性別APIを提供しないため**推測**）。無ければ最良の標準声へフォールバック。UIには実際の声名と種別を表示。
9. **既知の制限**: 下記。
10. **置換**: なし。

## 既知の制限・未検証事項
- **このビルドは、WebGPU・実モデル・実ブラウザ・実機では未テスト**（作成環境にGPU/ブラウザ/HuggingFaceへの接続が無いため）。実施済みは、全JSの構文チェックと、純粋ロジック（版比較、プロンプト生成、声選択、ファイル参照・版数の整合）のNodeテストのみ。仕様§25の「モデル」「PWA」「更新」「モバイル」の各項目は**手動確認が必要**。
- 特に要確認: `use_external_data_format`の要否、`apply_chat_template`の挙動（失敗時はLFM2形式の手組みプロンプトにフォールバック）、`InterruptableStoppingCriteria`/`TextStreamer`の4.2.0での動作、LFM2.5のチャットテンプレート。
- WebGPU非対応環境ではwasmフォールバックを提供しない（350M級でも遅いため。説明表示のみ）。
- 日本語品質・人格の保持・同一表現の反復は350Mでは不安定な可能性が高い。温度・`repetition_penalty`は`config.js`で調整。
- iOS Safariは保存領域の自動削除があり、モデル再ダウンロードが起こりうる。
- 
- アイコンは簡易生成の仮素材。
- (0.1.x の記述) 「モデル: 350M固定」は0.2.0で複数モデル対応に変更済み。
- モデレーションは仕様どおり未実装。

## 更新手順（次のビルド）
`js/version.js`（唯一の版数源）→ `version.json`（version / minimumSupportedVersion / releaseDate）→ `VERSION.md` / `CHANGELOG.md` を揃える。SWのキャッシュ名は`version.js`から自動で変わる。ZIP名にも版数を入れる。
