# Apps Script v83 / Worker 集計対応表

| v83 | D1 / Worker | 判定 |
| --- | --- | --- |
| `getStudentTargetUnitIdsForProfile_` の最終対象 | `student_targets.included = 1` と `target_start` | 移行時に標準範囲・個別上書き・語彙仮想対象を解決済み。単元IDを一意化して分母とする。 |
| `STUDY_ROUNDS` | `progress_records.round IN (1,2,3)` | 対象単元かつ `try_completed = 1` を周回別に数える。 |
| 全体・科目別 `%` | `Math.round(completed / target * 100)` | 分母0は表示0%、内部率は `null`。 |
| `unitHasLct_` | `materials.series = 'FORESTA_STEP' OR units.has_lct = 1` | 対象単元だけをLCT分母とし、空でない `lct_result` を分子とする。 |
| `filterHomeworkByLessonProgress_` | `homework_records` の移行済み集合 | 1320移行時に `(student, unit, schoolYear, round)` と `hasLessonProgress_` を適用済み。Workerはその不変条件を前提にする。 |
| 未入力宿題 | `homework_records.status = 'UNINPUT'` | アクティブ表示行だけを数える。 |
| アーカイブ | `homework_records.archived_at` と未復活の `homework_archives` | アーカイブ済みを除外し、復活済みは表示対象へ戻す。 |

保存系の許可判定は変更せず、生徒1320への保存要求は引き続きHTTP 403とする。
