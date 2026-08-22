# ステップ＆ゴール進捗管理 V3 本番記録

更新日: 2026-08-22

## 本番

- 本番URL: `https://step-progress-api.stepkobetsu.workers.dev/`
- Cloudflare Worker: `step-progress-api`
- 本番モード: `d1-isolated-autosave`
- 本番Version: **92**
- Version ID: `0503b822-cc27-4bcf-b15d-4ae16f8fcaed`
- Deployment ID: `7e1b40aa-7e63-48ee-8b23-339dd1df9690`
- 本番切替時刻: 2026-08-22 13:37頃 JST
- 本番切替メッセージ: `V3 D1-first autosave production cutover`

## 最終データ移行

本番切替の直前に、旧本番テーブルからV3専用テーブルへ再コピーした。

- 最終スナップショット: **2026-08-22 13:37:31 JST**
- 生徒: 34名
- 進捗: 1,267件
- 目標範囲: 7,011件
- 宿題: 2,271件
- テスト用 target override: 0件
- テスト用 homework override: 0件
- テスト用 archive override: 0件
- 一時セッション: 0件

1320を使った検証変更は最終コピー時に全て消去済み。

## V3の保存方式

V3は、従来の「ブラウザ → Google Apps Script → 保存 → Cloudflare側同期」という長い保存経路をやめる。

通常の編集状態は **Cloudflare Worker → D1へ直接保存** する。

D1 database:

- `step-progress-db`
- Database ID: `028f097c-2609-4bf7-9e9b-39b565606941`

既存本番テーブルは削除・上書きせず、V3用の独立テーブルを追加して使用する。

主なV3テーブル:

- `v3_meta`
- `v3_sessions`
- `v3_progress_records`
- `v3_target_snapshot`
- `v3_target_overrides`
- `v3_homework_snapshot`
- `v3_homework_overrides`
- `v3_homework_group_archives`

旧本番テーブルはロールバック用として維持する。

## 保存対象

以下は通常保存時にGoogle Apps Scriptの完了を待たず、D1へ直接保存する。

- 学習進捗
  - LCT
  - Point
  - WU
  - TRY
  - 周回
  - 学習日
- 目標範囲
- 宿題
  - 生徒完了
  - 対象なし
  - 講師確認
  - 宿題カードのアーカイブ

ログインそのものは既存Google認証を利用するが、ログイン後はV3セッションをD1へ保持し、通常保存のたびにGoogleへ認証確認しない。

管理系・未移行の操作は既存Google APIへフォールバックする。宿題一覧は既存Google側の構造を利用し、V3 D1の編集状態を上書き表示する。

## 自動保存

- 進捗: 300ms debounce
- 目標範囲: 350ms debounce
- 保存ボタンを押すことを前提にしない
- 画面は先に反映し、保存状態を表示する

## 1320 スモークテスト結果

V3 stagingで、実際に「変更 → 保存 → 再読込 → 値が残る」を確認した。

| 対象 | サーバー処理 | 通信込み | 再読込後保持 |
|---|---:|---:|---|
| 進捗 | 707ms | 979ms | OK |
| 目標範囲 | 889ms | 1,166ms | OK |
| 宿題 | 1,231ms | 1,452ms | OK |

全項目、目標としていた約2秒以内を達成。

## 目標範囲の重要修正

旧データでは同じような単元IDが教科・教材シリーズ間で混在する場合があり、単元IDだけで判定すると保存後の再読込で元に戻ったように見える問題があった。

V3では対象判定を原則として次の複合キーで扱う。

`教科 | 教材シリーズ | 単元ID`

これにより、フォレスタSTEP / GOALや別教科の同一・類似IDが混ざらないようにした。

## staging

- Worker: `step-progress-v3-staging`
- URL: `https://step-progress-v3-staging.stepkobetsu.workers.dev/`
- V3の確認用として残す

## ソース

- V3実装ブランチ: `agent/step-progress-v3-implementation`
- 旧本番実装ブランチ: `agent/cloudflare-progress-migration`

主なV3ファイル:

- `cloudflare/src/v3.ts`
- `cloudflare/src/dashboard.ts`
- `cloudflare/src/summary.ts`
- `cloudflare/scripts/apply-v3-runtime-fastpath.mjs`
- `cloudflare/scripts/apply-v3-autosave.mjs`
- `cloudflare/wrangler.v3.production.jsonc`
- `cloudflare/wrangler.v3.template.jsonc`

## ロールバック

V3直前の旧本番Versionは以下。

- Version: **91**
- Version ID: `7b84a8f6-3b25-4052-ab32-f02d6af55a51`
- メッセージ: `Persist homework checks after Google cloud save`

旧Workerコードは `agent/cloudflare-progress-migration` に維持する。

V3は既存本番テーブルを削除していないため、V3側で重大問題が出た場合は、Workerコードを旧Version / 旧ブランチへ戻して旧データ経路へ復帰できる。

ロールバック時にV3テーブルを削除する必要はない。

## 運用上の注意

- V3本番移行後、旧Google同期方式の複雑な dual-write / mirror / cron をV3の通常保存経路へ戻さない。
- 保存のたびにGoogle Apps Scriptへ往復しない。
- 保存後にダッシュボード全件を再取得する方式へ戻さない。
- 不具合調査時も、まず1320など限定データで再現し、全生徒総当たり検証は原則しない。
- V3本番の編集状態の正本はD1側とする。
