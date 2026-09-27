// 최소 ZIP 작성기 (t_3116c5bc 카드 내보내기) — 외부 의존성 없음.
// 배경: docx/xlsx는 OOXML=ZIP 컨테이너. npm 설치망(docx/sheetjs) 대신 순수 구현 —
// Node zlib.deflateRawSync + 자체 crc32(테이블식). 읽기 측 검증은 테스트에서 python zipfile로 수행.
// stored(method 0)와 deflate(method 8) 모두 지원. UTF-8 파일명 플래그(0x0800) 설정.
import { deflateRawSync } from 'zlib';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS time/date (ZIP 로컬 헤더). 고정 2026-01-01 00:00:00 — 결정성(해시 비교·테스트) 확보. */
const DOS_TIME = 0;
const DOS_DATE = (((2026 - 1980) << 9) | (1 << 5) | 1) & 0xffff;

export interface ZipEntry {
  name: string;
  data: Buffer | string;
  /** false면 stored(무압축) — mimetype 등 압축 금지 파일용. */
  deflate?: boolean;
}

export function createZip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data;
    const useDeflate = entry.deflate !== false;
    const body = useDeflate ? deflateRawSync(raw) : raw;
    // 압축이 오히려 크면 stored로 강등 (OOXML 어떤 파일이든 안전)
    const method = useDeflate && body.length < raw.length ? 8 : 0;
    const stored = method === 8 ? body : raw;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0x0800, 6);        // UTF-8 name flag
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, stored);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);              // version made by
    dir.writeUInt16LE(20, 6);              // version needed
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(stored.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(0, 34);              // comment len
    dir.writeUInt32LE(0, 38);              // disk/attrs
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += local.length + name.length + stored.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}
