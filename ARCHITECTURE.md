# ARCHITECTURE

- `npcs.js` — NPC/町のデータ（正本）。`llm-prompts.js` — データからsystemプロンプトを生成、直近`maxTurns`往復のみ送信、出力の整形。
- `llm.js` — WebGPU検出、キャッシュ状態判定・削除、推論バックエンドのプロキシ（Worker優先・メインスレッドへフォールバック、解放はWorker終了）。`llm-core.js` — 推論エンジン本体（単一モデル常駐、ストリーミング生成、停止）。`llm-worker.js` — エンジンを載せるmodule worker。`config.js`のMODELSがモデル定義の正本。フレームワーク依存はここに閉じる。
- `chat.js` — 会話状態（NPCごと）、送信/停止/消去、保存。生成中はNPC切替をロック（人格混在防止）。
- `speech.js` — 声の検出・選択（純粋関数`pickVoice`）、文単位の読み上げ。
- `storage.js` — localStorage（設定・会話）とリセット。`ui.js` — DOM操作（ストリーミング中は最後の吹き出しのみ更新）。
- `update-checker.js` — `version.json`をno-storeで定期取得→新しければバナー。ユーザー承諾後に`SKIP_WAITING`→再読込。
- `service-worker.js` — 同一オリジンのみnetwork-first（`cache:'no-cache'`）、オフライン時はシェルキャッシュ。skipWaitingは自動で行わない。
- `version.js` — クラシックスクリプト（`index.html`と`importScripts`の両方で読める）。
- `world.js` — 時間帯の判定。`customize.js` — 世界観/NPC追加設定の検証・JSON入出力（純粋関数）。`llm-prompts.js`は設定・時間・返答長をsystemプロンプトに合成し、途切れ整形(`finishCutoff`)も担う。
- `memory.js` — 直近窓の選択と、未要約メッセージの抽出（純粋関数）。`chat.js`は要約（背景実行・中断可）と記憶の保持を担う。
- `player.js` — 名乗りの検出と、名前を呼ぶ頻度の制御（純粋関数）。
- `characters.js` / `samples.js` / `migrate.js` — 住人のデータモデル、サンプル、旧版からの移行。`storage.js` — IndexedDB永続化＋同期キャッシュ。`backup.js` — バックアップ/住人ファイルの検証付き入出力。
