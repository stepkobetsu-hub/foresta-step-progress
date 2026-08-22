# CODEX TASK: 宿題チェックの先生確認済み誤判定を根本修正

## 目的
本番 `https://step-progress-api.stepkobetsu.workers.dev/` の生徒宿題チェックで、
生徒が「やりました」を押しただけなのに、保存後に「先生の確認済み」扱いになり、以後その宿題を生徒が変更できなくなる不具合を根本修正する。

## 現在の本番状況
- production Worker: `step-progress-api`
- 現行V3本番Version: `619937f7-3646-4da1-93a5-21acaaf3`
- V3実装ブランチ: `agent/step-progress-v3-implementation`
- D1: `step-progress-db`
- 対象テスト生徒: `1320`（ダミー。テスト操作・データリセット可）
- パスワードはリポジトリ・ログ・コミットに絶対に書かないこと。

## ユーザーが実際に確認した最新症状
1. 生徒画面で宿題をクリックする。
2. 保存自体はD1へ入る。
3. 以前はクリック後に画面が元へ戻っていた。
4. その件は、V3 `declareHomework` が画面側の期待する `out.homework` を返していなかったことが原因と判明し、レスポンスに `homework` を追加した。
5. その後、今度は生徒がクリックしただけなのに「先生の確認済み」と表示され、変更できなくなった。

この新しい不具合を直すこと。推測修正ではなく、状態遷移と実データを追って原因を確定すること。

## 重要な既存UI仕様
旧正常UIの生徒宿題処理は概ね次の流れ。

```js
async function handleStudentHomework_(action){
  const status=action.dataset.status,
        homeworkId=action.dataset.home,
        type=action.dataset.homeType||action.closest('.homeItem')?.dataset.homeType||'TRY_REDO';
  ...
  const item=action.closest('.homeItem');
  action.disabled=true;
  paintHomeworkOptimistic_(item,homeworkId,type,status);
  beginSave_();
  try{
    const out=await callApi_('declareHomework',{homeworkId,studentStatus:status},...);
    applyHomeworkCheckToCache_(out.homework);
    saveStudentViewCache_();
    endSave_('宿題チェックをクラウド保存しました');
    await renderStudentHomework_();
  } catch(error) { ... }
}
```

つまり、UI側は `out.homework` を信頼して `studentStatus` / `teacherStatus` をキャッシュへ反映する。

## V3側で重点的に確認する箇所
以下を必ず実コードで追うこと。

1. `cloudflare/src/v3.ts`
   - `declareHomework`
   - `saveHomeworkOverride`
   - `v3_homework_overrides`
   - 成功レスポンスに含めている `homework.teacherStatus`
   - `listHomework` の D1 overlay

2. `cloudflare/scripts/apply-v3-runtime-fastpath.mjs`
   - `teacher_status` の読み書き
   - `declareHomework` のときに teacher status を触っていないか
   - `teacher_status == null` のときに Google側の stale `teacherStatus` を残していないか

3. 旧UIの `handleStudentHomework_`, `applyHomeworkCheckToCache_`, `homeworkGroupHtml_`, `editableHomeworkHtml_`
   - 何をもって「先生の確認済み」「変更不可」としているか

## 強い疑い（ただし必ず実データで確認）
現在の overlay は、D1 `teacher_status` が null のときに Google由来の `teacherStatus` を上書きせず残している可能性がある。
その場合、生徒操作で `student_status` だけ更新しても、古い Google `teacherStatus=VERIFIED` が残り、画面が「先生確認済み」と誤認する。

また、`v3_homework_overrides` の既存行に teacher_status が誤って残っている可能性も確認すること。

## 正しい状態遷移
生徒 `declareHomework` は **student系フィールドだけ** を変更する。

- `student_status`
- `student_completed_date`

生徒操作では、次を新規に `VERIFIED` にしてはいけない。

- `teacher_status`
- `confirmation_memo`

先生確認は `confirmHomework` / `confirmHomeworkGroup` からのみ変更する。

### 期待仕様
- 生徒が `DECLARED_DONE` にする → 生徒側は「やりました」になる。
- 先生がまだ確認していなければ teacherStatus は未確認のまま。
- 生徒は先生確認前なら取り消し・再変更できる。
- 先生が確認済みにした後だけ、従来仕様どおりロックする。

## 1320でのテスト
1320はダミーなので、対象宿題のV3 overrideを必要に応じてリセットしてよい。
ただし他生徒のデータは触らない。

最低限、次を実施すること。

1. 1320の対象宿題について、開始時の
   - student_status
   - teacher_status
   - Google/listHomework上の teacherStatus
   - V3 override上の teacher_status
   を記録。

2. 生徒操作として `DECLARED_DONE` を保存。

3. 保存直後のAPIレスポンス `homework` が
   - `studentStatus = DECLARED_DONE`
   - `teacherStatus` は未確認
   であること。

4. `listHomework` 再取得後も teacherStatus が未確認であること。

5. 生徒側で `UNINPUT` へ戻せること。

6. 先生操作 `confirmHomework` で初めて teacherStatus が確認済みになること。

7. 先生確認後は、生徒側で変更不可になる従来仕様を確認。

## 実ブラウザ確認
APIテストだけで完了扱いにしないこと。
可能なら実ブラウザで、1320の実ログイン画面を使い、

- 「やりました」を押す
- その場で表示が残る
- 「先生の確認済み」にはならない
- F5しても同じ
- 先生確認前なら取り消せる

まで確認すること。

パスワードはコミット・ログに残さない。必要ならローカル/秘密変数/対話入力を使う。

## 実装方針
- D1を編集状態の正本とする。
- Googleを同期保存先に戻さない。
- 生徒操作と先生操作のフィールド責務を明確に分離する。
- null/空文字/未確認の扱いを統一する。
- `teacher_status` が null のときに stale Google `teacherStatus` が残らないようにする。
- UIを場当たり的に無理やり書き換えるより、APIレスポンスと状態モデルを正す。

## 本番反映条件
次の全てが通るまで production deploy しない。

- TypeScript check
- 1320 API save/reload/undo
- teacherStatus が生徒操作で勝手に VERIFIED にならない
- 先生確認でのみ VERIFIED になる
- 実ブラウザ確認（可能な範囲で）

## 報告
修正後は以下だけ簡潔に報告。

- 根本原因
- 変更ファイル
- 1320テスト結果
- 本番Version ID
- ロールバック先Version ID

巨大E2E、全生徒総当たり、長時間耐久試験は不要。