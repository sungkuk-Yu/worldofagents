import { registerCard, registerCardPreview } from './registry';
import TextCard from './TextCard';
import { InfoCard, SpreadsheetView, FileViewer, TaskFlow, MultiAgentView, FormCard, ChartCard, MediaCard, MediaPoster } from '../components/dialogs';
import { PhotoEditAgentCard } from '../components/PhotoEditCard';
registerCard('text', TextCard);
registerCard('info_card', InfoCard);
registerCard('spreadsheet', SpreadsheetView);
registerCard('file', FileViewer);
registerCard('task_flow', TaskFlow);
registerCard('multi_agent', MultiAgentView);
// Wave 1 — 인터랙티브 카드 (registry 구조상 CardFrame 공통 요소·펼침/접기가 자동 적용)
registerCard('form', FormCard);
registerCard('chart', ChartCard);
registerCard('media', MediaCard);
// media 접힘 미리보기 = poster (Wave1 공통 규칙: #51 접힘 상태 전용 렌더러)
registerCardPreview('media', MediaPoster);
// photo_edit — 백엔드/에이전트가 dialogue_type='photo_edit'로 emit하면 즉시 렌더 (t_4497cfce 결정 좌표계).
// user 메시지 지시 재현은 UserCard→PhotoEditCard 경로와 별개(여기서는 agent 카드 payload.photo_edit).
registerCard('photo_edit', PhotoEditAgentCard);
