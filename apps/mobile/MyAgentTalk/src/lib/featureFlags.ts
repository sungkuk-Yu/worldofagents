// t_64e3edd6 기능 플래그 (대표님 9/29 롤백 게이트: "적용 전에는 이상해질 수 있으니까 롤백 준비해놓고") —
// 이상 징후 시 이 파일의 값만 되돌려 재빌드하면 기능 개별 원상복구 (커밋 revert와 동등 경로).
//  - QUIET_PROGRESS: #324/#325 중간 상태 축소 — 타이핑 점 3개만, 스트리밍 중 큐 칩 행 숨김,
//    run.progress quip/작업 count 줄 제거. false 시 기존 quip/칩 동작으로 완전 복원.
//  - ACK_AUTO_PROCEED(lib/ackChips 기본값 2.5s)는 순수 상수라 플래그 없이 리터 revert 대상.
export const QUIET_PROGRESS = true;
