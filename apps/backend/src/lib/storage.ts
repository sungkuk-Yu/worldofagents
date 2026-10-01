/**
 * 첨부 파일 스토리지 어댑터 (t_401c5bd1, 카드 B안).
 *
 * 프로덕션: Supabase Storage 버킷 `attachments` (공개 버킷 + 난수 uuid 파일명 = capability URL).
 * DEV_MODE: devstore.blobs 인메모리 (object_path → bytes) — GET /api/attachments/object/<path>로 읽기.
 *
 * ⚠️ DbClient 래퍼(lib/supabase.ts)는 storage 네임스페이스를 노출하지 않으므로(수동 프로미션
 * 인터페이스) 별도 저수준 admin 클라이언트를 만든다. t_486cf23b P0 교훈의 연장선에서 공유
 * supabaseAdmin 인스턴스를 절대 건드리지 않는다. storage-js는 서비스 세션 상태를 갖지 않는다.
 *
 * API 표면 최소화(storage-js 2.117 실측 — probe-realstorage.mts로 제품 경로 검증):
 *   listBuckets()/createBucket()/from(bucket).upload()/from(bucket).remove()만 쓰고,
 *   읽기는 공개 버킷이므로 서명·download 빌더 대신 plain fetch(공개 URL)를 쓴다.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from '../config';
import { getStore } from './devstore';
import { logger } from '../utils/logger';

let cached: ReturnType<typeof createClient> | null = null;

function adminRaw() {
  if (!cached) {
    cached = createClient(config.supabase.url, config.supabase.serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
  }
  return cached;
}

interface BucketRow { name?: string }
interface CallResult<T> { data: T | null; error: { message?: string } | null }

let bucketReady = false;

/**
 * 버킷 `attachments` 보장 (프로덕션 전용). 동시성 주의(카드 P3-java 경계):
 * Supabase는 createBucket 실패를 ApiError가 아니라 { error } 페이로드로 돌려
 * '이미 존재' 구분용 status 확인이 불가 → listBuckets()로 존재를 성공 프루프로 삼고
 * 없을 때만 생성을 시도한다(경쟁 시 한쪽이 실패해도 업로드 재시도가 구제).
 */
async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const storage = adminRaw().storage as unknown as {
    listBuckets: () => Promise<CallResult<BucketRow[]>>;
    createBucket: (id: string, opts: Record<string, unknown>) => Promise<CallResult<unknown>>;
  };
  const has = (d: BucketRow[] | null) => Array.isArray(d) && d.some(b => b?.name === config.upload.bucket);
  const listed = await storage.listBuckets();
  if (listed.error) throw new Error(`attachments 버킷 조회 실패: ${listed.error.message}`);
  if (has(listed.data)) {
    bucketReady = true;
    return;
  }
  const created = await storage.createBucket(config.upload.bucket, { public: true, fileSizeLimit: config.upload.maxBytes });
  if (created.error && !/exist/i.test(created.error.message || '')) {
    throw new Error(`attachments 버킷 생성 실패: ${created.error.message}`);
  }
  const recheck = await storage.listBuckets();
  if (!has(recheck.data)) throw new Error('attachments 버킷 생성/확인 실패 — Storage 관리 권한 확인 필요');
  bucketReady = true;
  logger.info(`📦 attachments 버킷 보장 완료 (public, fileSizeLimit ${config.upload.maxBytes}B server-enforced)`);
}

/** 첨부 오브젝트 접근 URL (dev: 백엔드 경유 풀 URL(<img> 직접 로드 가능) — 프로덕션: Storage 퍼블릭 경로). */
export function publicObjectUrl(objectPath: string): string {
  if (config.devMode) return `http://localhost:${config.port}/api/attachments/object/${objectPath}`;
  return `${config.supabase.url}/storage/v1/object/public/${config.upload.bucket}/${objectPath}`;
}

/**
 * 업로드. 실패 시 버킷 보장 1회 재확인 후 1회 재시도 (중복 업로드 시 동일 objectPath는
 * upsert:false로 거부 — uuid 경로라 경합 불가). 쿼터 차감은 라우트가 성공 후에만 수행.
 */
export async function uploadToAttachmentsBucket(input: { objectPath: string; bytes: Buffer; mime: string }): Promise<void> {
  if (config.devMode) {
    getStore().blobs.set(input.objectPath, { bytes: input.bytes, mime: input.mime });
    return;
  }
  const put = () => (adminRaw().storage as unknown as {
    from: (b: string) => {
      upload: (p: string, f: Buffer, o: Record<string, unknown>) => Promise<CallResult<unknown>>;
    };
  }).from(config.upload.bucket).upload(input.objectPath, input.bytes, {
    contentType: input.mime, upsert: false, cacheControl: '3600',
  });
  await ensureBucket();
  let res = await put();
  if (res.error) {
    logger.warn(`attachments 업로드 실패(버킷 보장 재확인 후 1회 재시도): ${res.error.message}`);
    bucketReady = false;
    await ensureBucket();
    res = await put();
  }
  if (res.error) throw new Error(res.error.message || 'storage upload failed');
}

/**
 * 다운로드 (read-back 프루브용). 버킷이 공개라 관리 SDK download 빌더(storage-js 버전별 차이 큼)
 * 대신 공개 URL fetch를 쓴다 — 프론트/브라우저가 실제로 타는 경로와 동일 검증을 제공한다.
 */
export async function downloadFromAttachmentsBucket(objectPath: string): Promise<Buffer | null> {
  if (config.devMode) return getStore().blobs.get(objectPath)?.bytes ?? null;
  const res = await fetch(publicObjectUrl(objectPath));
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

/**
 * 파기 (수동 프루브/정리용 — 프로덕션 크론은 후속 과제, 카드 코멘트 이관).
 *
 * ⚠️ t_9c5f2bd0 실측: 업로드 시 cacheControl '3600' 때문에 remove()로 원본(S3) 바이트가
 * 사라져도 Cloudflare 엣지가 퍼블릭 URL을 최대 1시간 동안 계속 서빙한다(HIT) —
 * 탈퇴=개인정보 즉시 파기(개인정보보호법 제21조) 위반. remove 후 경로별 CDN purgeCache로
 * 엣지까지 함께 파기한다. purgeCache는 hosted 전용·service_role 필수(storage-js 2.117 실측:
 * 이 프로젝트에서는 200 {"message":"success"} + 직후 퍼블릭 URL 400/BYPASS 확인).
 */
export async function deleteFromAttachmentsBucket(objectPaths: string[]): Promise<void> {
  if (config.devMode) {
    for (const p of objectPaths) getStore().blobs.delete(p);
    return;
  }
  const bucket = (adminRaw().storage as unknown as {
    from: (b: string) => {
      remove: (p: string[]) => Promise<CallResult<unknown>>;
      purgeCache: (p: string) => Promise<CallResult<unknown>>;
    };
  }).from(config.upload.bucket);
  const res = await bucket.remove(objectPaths);
  if (res.error) logger.warn(`attachments 오브젝트 삭제 실패(크론 후속): ${res.error.message}`);
  for (const p of objectPaths) {
    try {
      const purged = await bucket.purgeCache(p);
      if (purged.error) logger.warn(`attachments CDN purge 실패(엣지 잔존 ≤ cacheControl TTL): ${p} — ${purged.error.message}`);
    } catch (err) {
      logger.warn(`attachments CDN purge 예외(계속 속행): ${p} — ${(err as Error).message}`);
    }
  }
}

// ============================================================
// context_patches 콜드 아카이브 버킷 (t_848d0c3b — 설계 볼트 10-01 §1)
//
// attachments와 반대 급부: **private** 버킷(delta에 대화 파생 콘텐츠 — 공개 URL경로
// 절대 불가), 읽기는 storage-js download 빌더(서명 경로), 쓰기는 service_role 전용.
// DEV_MODE 분기는 lib/contextArchive.ts의 putArchiveObject/getArchiveObject가
// devstore.blobs(격리 프리픽스)로 처리 — 이 함수들은 프로덕션 전용.
// ============================================================

const ARCHIVE_PREFIX = '__context-archive__/';

/** archiveStore 인터페이스가 버킷 루트 경로를 dev blobs 키와 충돌시키지 않는 프리픽스. */
export function archiveBlobKey(objectPath: string): string {
  return ARCHIVE_PREFIX + objectPath;
}

/**
 * private 버킷 `context-archive` 보장. attachments와 같은 listBuckets 성공 프루브
 * 패턴(카드 P3-java 경계 — ApiError 없이 { error } 페이로드라 '이미 존재' 구분 불가)
 * + public:false 명시(설계 §1 — 공개 버킷 생성은 아키텍처 위반).
 */
async function ensureArchiveBucket(): Promise<void> {
  const bucketName = config.contextArchive.bucket;
  const storage = adminRaw().storage as unknown as {
    listBuckets: () => Promise<CallResult<BucketRow[]>>;
    createBucket: (id: string, opts: Record<string, unknown>) => Promise<CallResult<unknown>>;
  };
  const has = (d: BucketRow[] | null) => Array.isArray(d) && d.some(b => b?.name === bucketName);
  const listed = await storage.listBuckets();
  if (listed.error) throw new Error(`context-archive 버킷 조회 실패: ${listed.error.message}`);
  if (has(listed.data)) return;
  const created = await storage.createBucket(bucketName, { public: false });
  if (created.error && !/exist/i.test(created.error.message || '')) {
    throw new Error(`context-archive 버킷 생성 실패: ${created.error.message}`);
  }
  const recheck = await storage.listBuckets();
  if (!has(recheck.data)) throw new Error('context-archive 버킷 생성/확인 실패 — Storage 관리 권한 확인 필요');
  logger.info(`🧊 context-archive private 버킷 보장 완료 (service_role 전용)`);
}

/** NDJSON.gz 객체 업로드 (upsert:true — 재시도 배치의 동일 경로 덮어쓰기 허용, sha가 내용 진실). */
export async function uploadToArchiveBucket(objectPath: string, bytes: Buffer): Promise<void> {
  await ensureArchiveBucket();
  const put = () => (adminRaw().storage as unknown as {
    from: (b: string) => {
      upload: (p: string, f: Buffer, o: Record<string, unknown>) => Promise<CallResult<unknown>>;
    };
  }).from(config.contextArchive.bucket).upload(objectPath, bytes, {
    contentType: 'application/gzip', upsert: true, cacheControl: '3600',
  });
  let res = await put();
  if (res.error) {
    logger.warn(`context-archive 업로드 실패(버킷 보장 재확인 후 1회 재시도): ${res.error.message}`);
    await ensureArchiveBucket();
    res = await put();
  }
  if (res.error) throw new Error(res.error.message || 'context-archive upload failed');
}

/**
 * read-back/복원 다운로드. private 버킷이라 퍼블릭 URL 경로가 없다 — storage-js
 * download 빌더(Blob)를 쓰고 Blob→Buffer 변환. 미 존재/권한 실패는 null (호출부가
 * '검증 실패 = 삭제 금지'로 해석).
 */
export async function downloadFromArchiveBucket(objectPath: string): Promise<Buffer | null> {
  try {
    const builder = (adminRaw().storage as unknown as {
      from: (b: string) => {
        download: (p: string, o?: Record<string, unknown>) => PromiseLike<{ data?: Blob; error?: { message?: string } | null }>;
      };
    }).from(config.contextArchive.bucket).download(objectPath, {});
    const res = await builder;
    if (!res || res.error || !res.data) return null;
    return Buffer.from(await res.data.arrayBuffer());
  } catch (err) {
    logger.warn(`context-archive 다운로드 예외(=null 취급): ${objectPath} — ${(err as Error).message}`);
    return null;
  }
}
