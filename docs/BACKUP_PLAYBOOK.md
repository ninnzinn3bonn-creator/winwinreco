# Firestore バックアップ運用 (月次手動)

## 前提

- バックアップ先 GCS バケット: `gs://<PROJECT_ID>-firestore-backup`
- 頻度: 毎月 1 日に手動実行
- 保持期間: 直近 3 ヶ月分

---

## バックアップ手順 (毎月 1 日)

```bash
# 1. プロジェクトを確認
gcloud config get-value project

# 2. バケットが未作成なら作成 (初回のみ)
gsutil mb -l asia-northeast1 gs://<PROJECT_ID>-firestore-backup

# 3. エクスポート実行
gcloud firestore export gs://<PROJECT_ID>-firestore-backup/$(date +%Y%m%d)

# 4. 3 ヶ月以上前のエクスポートを削除
#    例: 現在が 2026-05 なら 2026-02 以前を削除
gsutil -m rm -r gs://<PROJECT_ID>-firestore-backup/20260201
```

エクスポートには数秒〜数分かかる (データ量による)。
`gcloud firestore operations list` で進捗を確認できる。

---

## 復旧手順

```bash
# 特定日のエクスポートから全コレクションをインポート
gcloud firestore import gs://<PROJECT_ID>-firestore-backup/<YYYYMMDD>
```

> **注意**: インポートは既存ドキュメントを上書きする (削除はしない)。
> 完全リセットが必要な場合は先に対象コレクションを手動で削除すること。

---

## Budget Alert 設定 (初回のみ)

Cloud Console > Billing > Budgets & alerts > CREATE BUDGET:

| 項目 | 値 |
|---|---|
| 予算名 | `winwinreco-personal` |
| 金額 | $20/月 |
| アラート閾値 | 25% / 50% / 100% ($5 / $10 / $20) |
| 通知先 | 自分の Gmail |

---

## 関連コマンドチートシート

```bash
# Firestore エクスポート一覧
gsutil ls gs://<PROJECT_ID>-firestore-backup/

# Cloud Run 現在のリビジョン確認
gcloud run revisions list --service=winwinreco --region=asia-northeast1

# Cloud Run を前リビジョンに戻す
gcloud run services update-traffic winwinreco \
  --region=asia-northeast1 \
  --to-revisions=<REVISION_NAME>=100

# Firestore Security Rules の現状確認
firebase firestore:rules:get

# Firestore Security Rules デプロイ
firebase use <PROJECT_ID>
firebase deploy --only firestore:rules,firestore:indexes
```
