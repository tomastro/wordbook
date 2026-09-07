# Wordbook Desktop

Chrome 拡張版 Wordbook の語彙データを使い、AI が「状況→単語」「似た語の使い分け」「誤用判定」「穴埋め」を生成する Windows 向けデスクトップ学習アプリです。

## 起動

PowerShell では `desktop` フォルダー内で次を実行してください。`pnpm` のグローバルインストールは不要です。

```powershell
.\Start-Wordbook.cmd
```

エクスプローラーから `Start-Wordbook.cmd` をダブルクリックしても起動できます。必要なファイルがまだない場合は、Codex に同梱された `pnpm` を自動検出して初回セットアップを行います。

通常の Node.js 開発環境で作業する場合だけ、従来どおり `pnpm install`、`pnpm start` も使用できます。

1. Chrome 拡張のポップアップから CSV を書き出します。
2. デスクトップアプリの「単語」で CSV を読み込みます。
3. 「設定」で OpenAI 互換 API を設定します。ローカル OpenWebUI の既定候補は `http://127.0.0.1:3000/api` です。
4. OpenWebUI の API キーと利用モデルを入力して接続確認後、「学習」を開始します。

データ、進捗、設定は Electron のユーザーデータ領域に保存されます。API キーは Electron の `safeStorage` で暗号化し、リポジトリやログには保存しません。AI 接続に失敗した場合も、登録済みの訳を使ったオフライン問題で学習を継続できます。
