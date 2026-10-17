# ARCHITECTURE

- `npcs.js` — NPC/町のデータ（正本）。`llm-prompts.js` — データからsystemプロンプトを生成、直近`maxTurns`往復のみ送信、出力の整形。
- `llm.js` — WebGPU検出、モデル読込（進捗集約）、ストリーミング生成、停止。フレームワーク依存はここに閉じる。
- `chat.js` — 会話状態（NPCごと）、送信/停止/消去、保存。生成中はNPC切替をロック（人格混在防止）。
- `speech.js` — 声の検出・選択（純粋関数`pickVoice`）、文単位の読み上げ。
- `storage.js` — localStorage（設定・会話）とリセット。`ui.js` — DOM操作（ストリーミング中は最後の吹き出しのみ更新）。
- `update-checker.js` — `version.json`をno-storeで定期取得→新しければバナー。ユーザー承諾後に`SKIP_WAITING`→再読込。
- `service-worker.js` — 同一オリジンのみnetwork-first（`cache:'no-cache'`）、オフライン時はシェルキャッシュ。skipWaitingは自動で行わない。
- `version.js` — クラシックスクリプト（`index.html`と`importScripts`の両方で読める）。
