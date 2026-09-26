# Codex task: 小学生・高校生の共通ログイン対応を本番へ反映

## 目的
STEP塾生アプリを小学生・中学生・高校生すべてで共通ログインできるようにし、今後生徒マスタの行が増えても最終行まで自動参照できる状態にする。

## 現在確認済み
- 生徒マスタ正本: `★生徒マスタ202606-`
- Spreadsheet ID: `1CIJkTlYUcUkbb8jBdFc6L8D5ubTGsxwNxFv01ten-Zk`
- シート: `☆マスタ`
- 生徒番号1331は現在335行目
- 1331のPASSは `fuku`
- 1331の学年は `小１`
- 1331のAZ列（QRデータ）は `STEP-1331`
- QRは発行済み
- `student-QR/gas/MyQrApi.js` の `myQrFindStudent_` は `sheet.getLastRow()` を使用し固定行数ではない
- `foresta-step-progress/apps-script/code.gs` の `getStudentAuthRecord_` も `sheet.getLastRow()` を使用し固定行数ではない
- 不具合原因は共通ログイン側の `normalizeGrade_` が中1〜中3のみ対応だったこと
- mainには小1〜小6・中1〜中3・高1〜高3対応の修正済み
- 修正コミット: `4c68fc3bf50f465dadf4d68a296f53f200089d98`

## 実施内容
1. `stepkobetsu-hub/foresta-step-progress` の現行本番認証APIがどのGASデプロイを使用しているか確認する。
2. `apps-script/code.gs` 最新版を本番GASへ反映し、新バージョンとしてデプロイする。
3. 本番で以下を確認する。
   - `1331 / fuku` で `studentLogin` 成功
   - profile.grade が `小1` 相当
   - `getCommonStudentSession` 成功
4. STEP塾生アプリ `https://stepkobetsu-hub.github.io/step-hub/` から1331でログインし、以下を確認する。
   - 氏名
   - 校舎
   - 自分のQR（`STEP-1331`）
   - ポイント
5. 今後1332、1333…と増えても、認証・QR検索は固定範囲を使わず常に最終行まで参照する。
6. 小学生・高校生は中学生専用進捗機能の対象外でも、共通ログイン・QR・ポイント確認は利用可能にする。
7. 既存の中学生、講師、管理者ログインを壊さない。
8. 可能なら回帰テストを追加。
   - 小1
   - 小6
   - 中1〜中3
   - 高1
   - 高3
   - 生徒マスタ最終行に追加した生徒
9. 完了後に報告する。
   - 本番デプロイURL/バージョン
   - 1331での確認結果
   - 変更ファイル
   - コミット

## 注意
1331はQR未登録ではない。AZ列に `STEP-1331` が存在する。
生徒マスタの行数は今後増え続けるため、328、335、1000など現在の行数を実データ検索上限としてハードコードしないこと。
