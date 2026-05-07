# Claude Code セットアップガイド

このリポジトリで `claude` (Claude Code CLI) を使う際の推奨セットアップです。

## 前提

- Node.js 20+ がインストール済み
- `npm install -g @anthropic-ai/claude-code` で Claude Code 本体を導入済み
- リポジトリルート (このファイルがある場所の親) で `claude` を起動

## 起動

```bash
cd "C:\Users\PC_User\develop\gpt - コピー"
claude
```

起動すると Claude Code が **自動で `CLAUDE.md` を読み込み**、本リポジトリの全文脈 (未完タスク・設計規約・直近の作業履歴) を context に乗せます。

最初の発話例:

> いま作業を引き継ぎました。`docs/TASKS.md` の Section C (L シリーズ) が次に着手すべき作業です。L1 から始めますか？

## 推奨パーミッション設定

毎回 `npm test` などの確認を求められるのを防ぐには、リポジトリ直下に `.claude/settings.json` を以下の内容で作成してください。

```json
{
  "permissions": {
    "allow": [
      "Bash(npm test)",
      "Bash(npm test -- *)",
      "Bash(npm start)",
      "Bash(npm install)",
      "Bash(npm install --save-dev *)",
      "Bash(npm install --save *)",
      "Bash(node --check *)",
      "Bash(node -v)",
      "Bash(npx jest *)",
      "Bash(git status)",
      "Bash(git diff)",
      "Bash(git diff *)",
      "Bash(git log)",
      "Bash(git log *)",
      "Bash(git show *)",
      "Bash(git branch)",
      "Bash(git branch *)",
      "Bash(ls *)",
      "Bash(cat *)",
      "Bash(rg *)",
      "Bash(grep *)",
      "Bash(find *)",
      "Bash(wc *)",
      "Bash(head *)",
      "Bash(tail *)",
      "Read(**/*)",
      "Edit(src/**)",
      "Edit(tests/**)",
      "Edit(docs/**)",
      "Edit(PROGRESS.md)",
      "Edit(README.md)",
      "Edit(CLAUDE.md)",
      "Write(src/**)",
      "Write(tests/**)",
      "Write(docs/**)"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(git push *)",
      "Bash(git reset --hard *)",
      "Bash(git checkout * --force)",
      "Bash(npm publish*)",
      "Edit(.env)",
      "Edit(.env.*)",
      "Write(.env)",
      "Write(.env.*)"
    ]
  }
}
```

代わりに、Claude Code 起動後に `/permissions` コマンドで対話的に設定することもできます。

## 推奨スラッシュコマンド (任意)

`.claude/commands/` に独自スラッシュコマンドを置けます。例として、よく使う「次のタスクを選んで着手」を `/next` として定義する例:

`.claude/commands/next.md`:
```markdown
docs/TASKS.md の Section C を読み、優先度が high で依存関係を満たす次のタスクを 1 つ選んでください。
選んだタスクを TaskCreate で登録し in_progress にしたうえで、実装ステップに従って着手してください。
完了条件と検証手順を必ず最後に実行してください。
```

これで `/next` と打つだけで、未完タスクから次に着手すべきものを Claude Code が自動で拾って始めます。

## トラブルシュート

**Q. 起動しても CLAUDE.md が読まれていない気がする**
A. リポジトリルート (CLAUDE.md と同じディレクトリ) で `claude` を起動しているか確認。サブディレクトリから起動すると別の context になります。

**Q. パスに日本語 (`gpt - コピー`) が入っているが大丈夫か**
A. Windows ネイティブの Claude Code は問題なし。WSL から起動する場合はファイル切り捨てが起きる既知の問題があるため、`/mnt/c/Users/PC_User/develop/gpt - コピー` ではなく Windows 側で起動推奨。

**Q. 過去のタスクが完了済みかどうか分からない**
A. `PROGRESS.md` の節番号 (`## 1` 〜 `## 32`) が完了済みの履歴。`docs/TASKS.md` に残っているのが未完。

## このリポジトリ独自のルール

- **新コードを書く前に**、必ず `docs/ARCHITECTURE.md` の 3 規約 (Editor state ownership / Past-meeting context isolation / Mic preset → STT metadata) を読む。
- **タスク完了時** は `docs/TASKS.md` から削除し、`PROGRESS.md` に転記する運用。
- **テストを壊さない**: `npm test` で全テストが緑のままを維持。
