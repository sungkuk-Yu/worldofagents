-- ============================================================
-- 016_down — context_patch_archives 역방향 (롤백 게이트, 대표님 9/29 전보드 지시)
-- 카드: t_848d0c3b | 작성: 백개발 (직접 작성)
--
-- 사용: 실DB 적용 후 결함 발견 시 수동 실행 (supabase db push는 forward 전용).
--   SQL Editor/psql에서 실행 → §검증 프루브.
-- 안전: 016이 만든 1테이블만 제거(인덱스·RLS 정책·GRANT는 자동 연쇄 소멸).
--   context_patches 원본·Storage cold 객체는 무건드림 — 인덱스 행이 사라져도
--   객체는 버킷에 남는다(복원: 016 재적용 후 잡의 재스캔이 upsert 멱등으로 재등록).
--   단, 그 사이 cold 폴백 회수는 불가(인덱스 0행) — hot 경로만 동작.
-- 주의: verified_at 미검증 상태의 이관 배치에 대한 DELETE 안전문은 이 테이블 존재
--   자체에 의존하므로, 롤백 시 아카이브 잡(contextArchiveJob)도 함께 중단 상태여야
--   한다(CONTEXT_ARCHIVE_ENABLED=false 기본값이라 자연히 충족).
-- ============================================================

DROP TABLE IF EXISTS context_patch_archives;

-- 검증 read-back:
--   SELECT tablename FROM pg_tables WHERE tablename='context_patch_archives';  -- 0행
--   SELECT indexname FROM pg_indexes WHERE indexname LIKE 'idx_cpa_%';          -- 0행
