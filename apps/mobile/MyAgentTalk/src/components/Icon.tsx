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
  return <Svg {...svgBase(size)} testID={testID}>
    <Path fill={color} d="M13,12C13,12.1 13,12.3 13,12.4C12.7,12.4 12.3,12.5 12,12.5C11.7,12.5 11.3,12.4 11,12.4C11,12.3 11,12.1 11,12C11,11.9 11,11.8 11,11.6C11.3,11.9 11.6,12 12,12C12.4,12 12.7,11.9 13,11.6C13,11.8 13,11.9 13,12M11,9.5C11,9.6 11,9.8 11,9.9C10.8,9.8 10.4,9.5 10.4,9C10.4,8.7 10.5,8.5 10.7,8.2C10.9,8 11.2,8 11.5,8V8.5C11.3,8.5 11,8.6 11,9C11,9.3 11.2,9.4 11.4,9.5C11.6,9.6 11.8,9.6 12,9.6C12.2,9.6 12.4,9.6 12.6,9.5C12.8,9.4 13,9.3 13,9C13,8.6 12.7,8.5 12.5,8.5V8C12.8,8 13.1,8 13.3,8.2C13.5,8.5 13.6,8.7 13.6,9C13.6,9.5 13.2,9.8 13,9.9C13,9.8 13,9.6 13,9.5C13,9.4 13,9.2 13,9.1C12.7,9.4 12.4,9.5 12,9.5C11.6,9.5 11.3,9.4 11,9.1C11,9.2 11,9.4 11,9.5Z" />
    <Path fill={color} d="M21,4H17.5C16.67,4 15.92,4.44 15.5,5.12C15.08,4.44 14.33,4 13.5,4H12V18.41C11.65,18.15 11.31,17.88 11,17.63V4H9.5C8.67,4 7.92,4.44 7.5,5.12C7.08,4.44 6.33,4 5.5,4H3V20.5H5.5C6.37,20.5 7.13,20.97 7.5,21.67C7.87,20.97 8.63,20.5 9.5,20.5H10C10.6,21.44 11.75,22 13,22C14.71,22 16.17,20.94 16.75,19.5H21V4Z" />
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
