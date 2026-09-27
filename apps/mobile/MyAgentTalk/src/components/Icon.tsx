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
