/* t_d469fac3 라이브 스모크 — 백엔드 라우트 → 사이드카(9834) 왕복 (in-process inject). RUN:
 *   cd apps/backend
 *   VAULT_SIDECAR_URL=http://127.0.0.1:9834 VAULT_ADMIN_TOKEN=<deploy.env 사본> DEV_MODE=true \
 *   ./node_modules/.bin/tsx scripts/vault_library_smoke.ts
 * 기대: 사이드카 /health loaded=true (systemd: myagenttalk-vault-sidecar).
 */
import { config } from '../src/config';
import { searchVaultLibrary } from '../src/lib/vaultLibrary';

async function main() {
  console.log('url=', config.vaultLibrary.url, 'token_set=', Boolean(config.vaultLibrary.adminToken));
  if (!config.vaultLibrary.url) throw new Error('VAULT_SIDECAR_URL 미설정');
  const r = await searchVaultLibrary('자비스 소개', 3);
  console.log('results:', r.results.length, 'took_ms:', r.took_ms);
  for (const item of r.results as { rank: number; path: string; score: number }[]) {
    console.log(`  #${item.rank} ${item.score.toFixed(4)} ${item.path}`);
  }
  if (!r.results.length) throw new Error('빈 결과 — 실패');
  console.log('SMOKE OK');
}
main().catch((e) => { console.error('SMOKE FAIL', e.message); process.exit(1); });
