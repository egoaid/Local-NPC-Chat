# DEVELOPER_NOTES — v0.1.0-build.001

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
- `sitemap.xml`のURLは仮（`egoaid.github.io/local-npc-chat-rpg/`）。公開URLに置換すること。
- アイコンは簡易生成の仮素材。
- モデレーションは仕様どおり未実装。

## 更新手順（次のビルド）
`js/version.js`（唯一の版数源）→ `version.json`（version / minimumSupportedVersion / releaseDate）→ `VERSION.md` / `CHANGELOG.md` を揃える。SWのキャッシュ名は`version.js`から自動で変わる。ZIP名にも版数を入れる。
