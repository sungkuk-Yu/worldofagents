import { registerCard } from './registry';
import TextCard from './TextCard';
import { InfoCard, SpreadsheetView, FileViewer, TaskFlow, MultiAgentView } from '../components/dialogs';
registerCard('text', TextCard);
registerCard('info_card', InfoCard);
registerCard('spreadsheet', SpreadsheetView);
registerCard('file', FileViewer);
registerCard('task_flow', TaskFlow);
registerCard('multi_agent', MultiAgentView);
