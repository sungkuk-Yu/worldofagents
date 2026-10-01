/**
 * t_848d0c3b — 실 Supabase Storage private 버킷 왕복 프로브 (검사용, 일회성).
 *
 * lib/storage.ts의 context-archive 경로(ensureBucket private 생성 → upload →
 * download 빌더 read-back → sha 대조 → remove → deleteBucket)를 실서비스 API로 검증한다.
 * 프로덕션 버킷명(context-archive)은 건드리지 않고 스로어웨이 이름으로 실행, 종료 시
 * 버킷까지 삭제해 원진실 잔존 0으로 남긴다 (김비서 게이트 위반 방지 — 본 카드 경계
 * '실DB apply 없음'은 SQL 측이고, Storage 프로브는 잔여물 0 조건으로 허용 범위).
 *
 * 실행 (apps/backend, 메인 레포 .env):
 *   DEV_MODE=false ./node_modules/.bin/tsx scripts/archive_storage_probe.ts
 */
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { config } from '../src/config';
import { uploadToArchiveBucket, downloadFromArchiveBucket } from '../src/lib/storage';
import { createClient } from '@supabase/supabase-js';

const PROBE_BUCKET = 'context-archive-probe-t848';

async function main() {
  if (config.devMode) throw new Error('DEV_MODE=false로 실행 — 실 Storage 왕복 프로브');
  // config.contextArchive.bucket은 상수라 프로브 이름으로 우회: adminRaw를 직접 만든다(storage.ts와 동일 구성).
  const admin = createClient(config.supabase.url, config.supabase.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const storage = admin.storage as any;

  // 1) private 버킷 생성 (public:false)
  const listed = await storage.listBuckets();
  const exists = (listed.data || []).some((b: any) => b.name === PROBE_BUCKET);
  if (!exists) {
    const created = await storage.createBucket(PROBE_BUCKET, { public: false });
    if (created.error && !/exist/i.test(created.error.message || '')) throw new Error(`createBucket: ${created.error.message}`);
  }
  const buckets = await storage.listBuckets();
  const mine = (buckets.data || []).find((b: any) => b.name === PROBE_BUCKET);
  if (!mine) throw new Error('버킷 목록 확인 실패');
  console.log('BUCKET private =', !mine.public, '(public:false 기대)', 'name:', mine.name);
  if (mine.public) throw new Error('버킷이 공개로 만들어졌다 — 즉시 수동 삭제 필요!');

  // 2) NDJSON.gz 업로드 (storage.ts와 동일 옵션)
  const path = `probe/${randomUUID()}.ndjson.gz`;
  const payload = gzipSync(Buffer.from('{"probe":true}\n'.repeat(50), 'utf8'));
  const sha = createHash('sha256').update(payload).digest('hex');
  const up = await storage.from(PROBE_BUCKET).upload(path, payload, { contentType: 'application/gzip', upsert: true, cacheControl: '3600' });
  if (up.error) throw new Error(`upload: ${up.error.message}`);
  console.log('UPLOAD OK', path, `${payload.length}B sha=${sha.slice(0, 12)}…`);

  // 3) download 빌더 read-back — storage.ts의 downloadFromArchiveBucket과 동일 호출 형태
  const dl = await storage.from(PROBE_BUCKET).download(path, {});
  if (dl.error) throw new Error(`download: ${dl.error.message}`);
  const back = Buffer.from(await dl.data.arrayBuffer());
  const backSha = createHash('sha256').update(back).digest('hex');
  console.log('READBACK bytes=', back.length, 'sha_match=', backSha === sha);
  if (backSha !== sha) throw new Error('read-back sha 불일치');

  // 4) 공개 URL 접근 차단 프루브 (private 이어야 400/404)
  const pub = await fetch(`${config.supabase.url}/storage/v1/object/public/${PROBE_BUCKET}/${path}`);
  console.log('PUBLIC_URL status=', pub.status, '(4xx 기대)');
  if (pub.ok) throw new Error('private 버킷이 공개 서빙 중 — 아키텍처 위반!');

  // 5) 정리: 오브젝트 → 버킷 (원진실 잔존 0)
  const rm = await storage.from(PROBE_BUCKET).remove([path]);
  if (rm.error) throw new Error(`remove: ${rm.error.message}`);
  const del = await storage.deleteBucket(PROBE_BUCKET);
  if (del.error) throw new Error(`deleteBucket: ${del.error.message}`);
  const after = await storage.listBuckets();
  if ((after.data || []).some((b: any) => b.name === PROBE_BUCKET)) throw new Error('버킷 잔존');
  console.log('PROBE ALL PASS — 버킷·오브젝트 잔존 0');
}
main().catch((e) => { console.error('PROBE FAIL', e.message); process.exit(1); });
