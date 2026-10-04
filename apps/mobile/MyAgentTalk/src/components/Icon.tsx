// SVG 아이콘 세트 (t_64af90b0 결함 #2) — 이모지를 버튼 아이콘으로 쓰지 않는다 (상용 제품 관례).
// Material Design Icons 24×24 패스 (Apache-2.0). 크기·색은 호출측 iconSize/colors 토큰 주입.
import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../theme';

interface IconProps {
  size?: number;
  color?: string;
  testID?: string;
}

const svgBase = (size: number) => ({ width: size, height: size, viewBox: '0 0 24 24' }) as const;

export function MicIcon({ size = 18, color = colors.text2, testID }: IconProps) {
  return <Svg {...svgBase(size)} testID={testID}>
    <Path fill={color} d="M12,2A3,3 0 0,1 15,5V11A3,3 0 0,1 12,14A3,3 0 0,1 9,11V5A3,3 0 0,1 12,2M19,10C19,12 18,15 15,16V19H9V16C6,15 5,12.62 5,10H7C7,11.5 7.5,14 10.5,14H13.5C16.5,14 17,11.5 17,10H19Z" />
  </Svg>;
}

export function GearIcon({ size = 18, color = colors.text2, testID }: IconProps) {
  return <Svg {...svgBase(size)} testID={testID}>
    <Path fill={color} d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z" />
  </Svg>;
}

/** t_e735d936: 키보드 열기 버튼 — 음성 기본 진입에서 텍스트 입력을 부르는 2차 UI 아이콘 */
export function KeyboardIcon({ size = 18, color = colors.text2, testID }: IconProps) {
  return <Svg {...svgBase(size)} testID={testID}>
    <Path fill={color} d="M20,12A1,1 0 0,1 19,13H5A1,1 0 0,1 4,12V8A1,1 0 0,1 5,7H19A1,1 0 0,1 20,8V12M9,10V11H11V10H9M13,10V11H15V10H13M16,10V11H18V10H16M6,10V11H8V10H6M4,16A1,1 0 0,1 5,15H19A1,1 0 0,1 20,16V18A1,1 0 0,1 19,19H5A1,1 0 0,1 4,18V16M8,5V6H10V5H8M14,5V6H16V5H14M11,5V6H13V5H11M5,5V6H7V5H5M17,5V6H19V5H17M9,16.5V17.5H15V16.5H9Z" />
  </Svg>;
}
export function StarIcon({ size = 18, color = colors.text3, filled = false, testID }: IconProps & { filled?: boolean }) {
  return <Svg {...svgBase(size)} testID={testID}>
    <Path fill={color} d={filled
      ? 'M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z'
      : 'M12,15.39L8.24,17.66L9.23,13.38L5.91,10.5L10.29,10.13L12,6.09L13.71,10.13L18.09,10.5L14.77,13.38L15.76,17.66M22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27L18.18,21L16.54,13.97L22,9.24Z'} />
  </Svg>;
}

export function ChevronDownIcon({ size = 18, color = colors.text2, testID }: IconProps) {
  return <Svg {...svgBase(size)} testID={testID}>
    <Path fill={color} d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z" />
  </Svg>;
}

export function ChevronUpIcon({ size = 18, color = colors.text2, testID }: IconProps) {
  return <Svg {...svgBase(size)} testID={testID}>
    <Path fill={color} d="M7.41,15.41L12,10.83L16.59,15.41L18,14L12,8L6,14L7.41,15.41Z" />
  </Svg>;
}

export function VaultIcon({ size = 18, color = colors.text2, testID }: IconProps) {
  return <Svg {...svgBase(size)} testID={testID}>
    <Path fill={color} d="M12,3C7.58,3 4,4.79 4,7C4,9.21 7.58,11 12,11C16.42,11 20,9.21 20,7C20,4.79 16.42,3 12,3M4,9V12C4,14.21 7.58,16 12,16C16.42,16 20,14.21 20,12V9C20,11.21 16.42,13 12,13C7.58,13 4,11.21 4,9M4,14V17C4,19.21 7.58,21 12,21C16.42,21 20,19.21 20,17V14C20,16.21 16.42,18 12,18C7.58,18 4,16.21 4,14Z" />
  </Svg>;
}

export function BoardIcon({ size = 18, color = colors.text2, testID }: IconProps) {
  return <Svg {...svgBase(size)} testID={testID}>
    <Path fill={color} d="M3,3H9V21H3V3M11,3H17V13H11V3M19,3H21V8H19V3M11,15H17V21H11V15M19,10H21V21H19V10Z" />
  </Svg>;
}

export function DownloadIcon({ size = 18, color = colors.text2, testID }: IconProps) {
  return <Svg {...svgBase(size)} testID={testID}>
    <Path fill={color} d="M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z" />
  </Svg>;
}

export function CloseIcon({ size = 18, color = colors.text2, testID }: IconProps) {
  return <Svg {...svgBase(size)} testID={testID}>
    <Path fill={color} d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z" />
  </Svg>;
}

export function BookOpenIcon({ size = 18, color = colors.text2, testID }: IconProps) {
  // 자작 심볼 — 펼쳐진 책 두 장(대칭). 메모리 기반 MDI 경로 오기억 위험 회피.
  return <Svg {...svgBase(size)} testID={testID}>
    <Path fill={color} d="M12,6.5C10.5,5.2 8.5,4.5 6.5,4.5H3V18.5H6.5C8.5,18.5 10.5,19.2 12,20.5V6.5Z" />
    <Path fill={color} opacity="0.75" d="M12,6.5C13.5,5.2 15.5,4.5 17.5,4.5H21V18.5H17.5C15.5,18.5 13.5,19.2 12,20.5V6.5Z" />
  </Svg>;
}

export function PaperclipIcon({ size = 18, color = colors.text2, testID }: IconProps) {
  return <Svg {...svgBase(size)} testID={testID}>
    <Path fill={color} d="M16.5,6V17.5C16.5,19.54 14.89,21.15 12.85,21.15C10.81,21.15 9.2,19.54 9.2,17.5V5C9.2,3.73 10.23,2.7 11.5,2.7C12.77,2.7 13.8,3.73 13.8,5V17.5C13.8,18.02 13.37,18.45 12.85,18.45C12.33,18.45 11.9,18.02 11.9,17.5V6H10.9V17.5C10.9,18.58 11.78,19.45 12.85,19.45C13.93,19.45 14.8,18.58 14.8,17.5V5C14.8,3.2 13.3,1.7 11.5,1.7C9.7,1.7 8.2,3.2 8.2,5V17.5C8.2,20.07 10.28,22.15 12.85,22.15C15.42,22.15 17.5,20.07 17.5,17.5V6H16.5Z" />
  </Svg>;
}

export function FeedIcon({ size = 18, color = colors.text2, testID }: IconProps) {
  return <Svg {...svgBase(size)} testID={testID}>
    <Path fill={color} d="M3,3H11V11H3V3M13,3H21V11H13V3M3,13H11V21H3V13M13,13H21V21H13V13M5,5V9H9V5H5M15,5V9H19V5H15M5,15V19H9V15H5M15,15V19H19V15H15Z" />
  </Svg>;
}

// 질문 큐 체크포인트 3종 (t_1797f432 ②) — 대기=빈 원 / 답변됨=초록 체크 / 스킵=회색 대시
export function QueuePendingIcon({ size = 18, color = colors.text2, testID }: IconProps) {
  return <Svg {...svgBase(size)} testID={testID}>
    <Path fill="none" stroke={color} strokeWidth={1.8} d="M12,3A9,9 0 1,0 12,21A9,9 0 1,0 12,3Z" />
  </Svg>;
}
export function QueueAnsweredIcon({ size = 18, color = colors.text2, testID }: IconProps) {
  return <Svg {...svgBase(size)} testID={testID}>
    <Path fill={color} d="M12,2A10,10 0 1,0 12,22A10,10 0 1,0 12,2M10.5,16.2L6.3,12L7.7,10.6L10.5,13.4L16.3,7.6L17.7,9L10.5,16.2Z" />
  </Svg>;
}
export function QueueSkippedIcon({ size = 18, color = colors.text2, testID }: IconProps) {
  return <Svg {...svgBase(size)} testID={testID}>
    <Path fill={color} d="M4,11H20V13H4V11Z" />
  </Svg>;
}
// 답변 대기 (t_363c0faa) — 회신 화살표(곡선)=회신 필요. 말풍선 금지 원칙(카드 요구 5)에 따라 버블 형상 배제.
export function PendingReplyIcon({ size = 18, color = colors.text2, testID }: IconProps) {
  return <Svg {...svgBase(size)} testID={testID}>
    <Path fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" d="M9,17L3.5,11.5L9,6V9.5C14,9.5 17.5,11 19,16C16.5,13.5 13,12.8 9,12.8V17Z" />
  </Svg>;
}
// 내 질문 현황 (t_fd869e5b) — 체크리스트 3줄 = 진행 상황 한눈에. 앱바 '현황' 버튼 글리프.
export function TrackerIcon({ size = 18, color = colors.text2, testID }: IconProps) {
  return <Svg {...svgBase(size)} testID={testID}>
    <Path fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" d="M4,6.5L6,8.5L9.5,5M4,12.5L6,14.5L9.5,11M4,18.5L6,20.5L9.5,17M12.5,7H20M12.5,13H20M12.5,19H20" />
  </Svg>;
}
// 전송 ticks (t_5c559e85 ⑤, Telegram/Signal status ticks 규범) — 시계=전송중(pending) / 체크=전송됨(서버 ID 확정) / 느낌표원=실패(탭 재전송)
export function TickPendingIcon({ size = 18, color = colors.text2, testID }: IconProps) {
  return <Svg {...svgBase(size)} testID={testID}>
    <Path fill={color} d="M12,2A10,10 0 1,0 12,22A10,10 0 1,0 12,2M12,4A8,8 0 1,1 12,20A8,8 0 1,1 12,4M12.5,8H11V13L15.75,15.87L16.5,14.62L12.5,12.25V8Z" />
  </Svg>;
}
export function TickSentIcon({ size = 18, color = colors.text2, testID }: IconProps) {
  return <Svg {...svgBase(size)} testID={testID}>
    <Path fill={color} d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z" />
  </Svg>;
}
export function TickFailedIcon({ size = 18, color = colors.text2, testID }: IconProps) {
  return <Svg {...svgBase(size)} testID={testID}>
    <Path fill={color} d="M13,9H11V7H13M13,17H11V11H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4Z" />
  </Svg>;
}
