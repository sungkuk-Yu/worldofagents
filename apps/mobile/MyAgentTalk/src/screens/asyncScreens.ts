// t_710b5d28 (10/4) — 부트 비필수 화면의 단일 비동기 루트.
// 라우트별 import() 1차 시도는 실패(실측): 카드 스택·chatLogic·markdown이 여러 청크에 공유되어
// Metro가 __common으로 hoist, __common이 entry와 동거하며 eager script로 부트 로드(부트 gz 890KB
// ≈ 원본 969KB — 이득 0). 동적 진입점을 하나로 모으면 공유 코드가 그 청크 내부로 흡수되어
// 부트 그래프에서 완전히 사라진다. 대가: 첫 진입 시 청크 fetch 1회 — idle 프리로드로 상쇄.
export { default as ChatScreen } from './ChatScreen';
export { default as VoiceHomeScreen } from './VoiceHomeScreen';
export { default as ResultCanvasScreen } from './ResultCanvasScreen';
export { default as CardThreadScreen } from './CardThreadScreen';
export { default as FavoritesScreen } from './FavoritesScreen';
export { default as FeedScreen } from './FeedScreen';
export { default as BoardScreen } from './BoardScreen';
export { default as NeuronDashboardScreen } from './NeuronDashboardScreen';
export { default as SettingsScreen } from './SettingsScreen';
export { default as JoystickSettingsScreen } from './JoystickSettingsScreen';
export { default as LegalDocScreen } from './LegalDocScreen';
export { default as ThreadRail } from '../components/ThreadRail';
export { default as FavoritesModal } from '../components/FavoritesModal';
