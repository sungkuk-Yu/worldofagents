/**
 * resolveAgentBridge() 매핑 단위테스트
 * - 김비서 → kimsecretary
 * - 내보좌관 → leejungjae
 * - 내변호사 → hammurabi
 * - 미매핑 이름 → null (폴백)
 */
import { describe, it, expect } from 'vitest';
import { resolveAgentBridge, isBridgedAgent } from '../../src/lib/secretaryBridge';

describe('resolveAgentBridge()', () => {
  it('김비서 → kimsecretary 프로필 매핑', () => {
    const cfg = resolveAgentBridge('김비서');
    expect(cfg).not.toBeNull();
    expect(cfg!.profile).toBe('kimsecretary');
    expect(cfg!.endpoint).toBeTruthy(); // 포트 기반 endpoint 존재 확인
  });

  it('내보좌관 → leejungjae 프로필 매핑', () => {
    const cfg = resolveAgentBridge('내보좌관');
    expect(cfg).not.toBeNull();
    expect(cfg!.profile).toBe('leejungjae');
    expect(cfg!.endpoint).toBeTruthy();
  });

  it('내변호사 → hammurabi 프로필 매핑', () => {
    const cfg = resolveAgentBridge('내변호사');
    expect(cfg).not.toBeNull();
    expect(cfg!.profile).toBe('hammurabi');
    expect(cfg!.endpoint).toBeTruthy();
  });

  it('미매핑 이름 → null 폴백', () => {
    expect(resolveAgentBridge('알수없는에이전트')).toBeNull();
    expect(resolveAgentBridge('')).toBeNull();
  });
});

describe('isBridgedAgent()', () => {
  it('매핑된 에이전트 이름 → true', () => {
    expect(isBridgedAgent('김비서')).toBe(true);
    expect(isBridgedAgent('내보좌관')).toBe(true);
    expect(isBridgedAgent('내변호사')).toBe(true);
  });

  it('미매핑 에이전트 이름 → false', () => {
    expect(isBridgedAgent('모르는사람')).toBe(false);
    expect(isBridgedAgent('')).toBe(false);
  });
});
