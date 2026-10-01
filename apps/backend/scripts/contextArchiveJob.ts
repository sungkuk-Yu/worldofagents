/**
 * context_patches 콜드 아카이브 잡 (t_848d0c3b — 설계 볼트 10-01 §3, 실행 분할 ②).
 *
 * 1회 실행: cutoff(HOT_WINDOW∧SAFETY_LAG) 이전 패치 선출 → 세션×월 NDJSON+gzip →
 * sha256 → Storage(context-archive private) 업로드 → read-back 검증(sha+행수+delta
 * 전량) → 통과 시에만 verified_at 갱신 + 원본 DELETE. 검증 실패는 삭제 금지 —
 * 다음 실행이 동일 object_path upsert로 재시도(멱등).
 *
 * 실행 (apps/backend, systemd timer myagenttalk-context-archive.timer가 일 1회 05:xx):
 *   목록만(무쓰기, 승인 전 감사):  DEV_MODE=false ./node_modules/.bin/tsx scripts/contextArchiveJob.ts --dry-run
 *   실 execution:                 CONTEXT_ARCHIVE_ENABLED=true DEV_MODE=false ./node_modules/.bin/tsx scripts/contextArchiveJob.ts
 * 게이트: config.contextArchive.enabled=false(기본)면 --dry-run과 동일 — 실DB 원본
 * 삭제는 timer 설치 + env 켬 + 김비서 첫 배치 결재(카드 ④) 후에만 발생한다.
 * DEV_MODE=true면 devstore.blobs 경로로 동일 파이프라인이 돈다(스모크용, 무해).
 */
import { config } from '../src/config';
import { supabaseAdmin } from '../src/lib/supabase';
import { runArchiveJob } from '../src/lib/contextArchive';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const report = await runArchiveJob(supabaseAdmin, { dryRun });
  const mode = dryRun ? 'DRY-RUN' : report.enabled ? 'LIVE' : 'DISABLED(=dry-run)';
  console.log(`context-archive ${mode} — cutoff=${report.cutoff} 후보=${report.candidate_count} 보존예외=${report.preserved_count} 배치=${report.batches.length}`);
  for (const b of report.batches) {
    console.log(`  [${b.verified ? 'OK' : b.error ? 'FAIL' : 'PLAN'}] session=${b.sessionId.slice(0, 8)} period=${b.period} rows=${b.patch_count} deleted=${b.deleted}${b.error ? ' — ' + b.error : ''}`);
  }
  if (report.aborted) { console.error(`ABORT: ${report.aborted}`); process.exitCode = 1; }
  const failed = report.batches.filter((b) => b.error).length;
  if (failed) console.error(`${failed}개 배치 실패 — 원본은 그대로(hot)이며 다음 실행이 재시도한다.`);
}

main().catch((err) => {
  console.error('context-archive job 예외 종료:', err instanceof Error ? err.message : err);
  console.error(`(config: enabled=${config.contextArchive.enabled} hot=${config.contextArchive.hotWindowDays}d lag=${config.contextArchive.safetyLagHours}h bucket=${config.contextArchive.bucket})`);
  process.exitCode = 1;
});
