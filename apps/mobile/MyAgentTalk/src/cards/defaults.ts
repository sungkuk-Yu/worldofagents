import { registerCard, registerCardPreview } from './registry';
import TextCard from './TextCard';
import { InfoCard, SpreadsheetView, FileViewer, TaskFlow, MultiAgentView, FormCard, ChartCard, MediaCard, MediaPoster } from '../components/dialogs';
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
