// 반응형 레이아웃 훅 — useWindowDimensions 감쌈(네이티브/웹 모두 리사이즈 추적).
// 화면 코드에서 폭 숫자를 직접 비교하지 말고 이 훅의 mode를 쓴다 (t_eded715c 요구 1).
import { useWindowDimensions } from 'react-native';
import { LayoutMode, layoutModeForWidth } from '../lib/layout';

export interface Layout {
  width: number;
  /** 세로 뷰포트 — 음성 스테이지 높이(30%) 산출용 (t_4758f25d) */
  height: number;
  mode: LayoutMode;
  /** PC 3패널 셸(사이드바+컨텍스트)를 쓸지 */
  pc: boolean;
  /** 1440급 — 3패널 완전체 */
  wide: boolean;
}

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  const mode = layoutModeForWidth(width);
  return { width, height, mode, pc: mode !== 'mobile', wide: mode === 'pc-wide' };
}

export default useLayout;
