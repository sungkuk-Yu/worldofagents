// useJoystickMap — 사용자 조이스틱 맵을 화면에 공급하는 훅 (카드 t_ced38e19 요구 1/4)
// 저장/영속화는 lib/userPrefs (서버 preferences.joystickMap + 로컬 폴백), 이 훅은 읽기/편집/라벨만.
// MVP 계약(요구 4): 전역 1개 맵 + 화면별 예외 — 예외 화면(ResultCanvas 세그먼트 내비)은 이 훅을 쓰지 않는다.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { JoystickGesture } from '../types';
import {
  ACTION_IDS, DEFAULT_MAP, DIRECTION_KEYS, JoystickActionId, JoystickDirectionKey,
  JoystickMap, ONE_HAND_MAP, actionForGesture, encodeJoystickMap, presetOf,
} from '../lib/joystickMapping';
import { DEFAULT_MODE, JoystickMode } from '../lib/joystickMode';
import { getJoystickMode, getPrefs, hydratePrefs, setJoystickMap, setJoystickMode, subscribePrefs } from '../lib/userPrefs';

export function useJoystickMap() {
  const { t } = useTranslation();
  const [map, setMap] = useState<JoystickMap>(() => getPrefs()?.joystickMap ?? { ...DEFAULT_MAP });
  // 입력 모드 (카드 t_5de18a91 요구 2): 조이스틱/매직패드/하이브리드 — 설정에서 전환, 계정 영속
  const [mode, setMode] = useState<JoystickMode>(() => getJoystickMode() ?? DEFAULT_MODE);
  const [hydrated, setHydrated] = useState(() => getPrefs() !== null);

  // 첫 마운트: 서버/로컬 복원 (미로그인·오프라인이면 기본 프리셋 유지)
  useEffect(() => {
    if (hydrated) return;
    void hydratePrefs().then(() => {
      const prefs = getPrefs();
      if (prefs) setMap(prefs.joystickMap);
      setMode(getJoystickMode() ?? DEFAULT_MODE);
      setHydrated(true);
    });
  }, [hydrated]);

  // 다른 화면(설정)에서의 저장 변경 → 이 인스턴스 즉시 반영 (t_5de18a91 — 모드 전환 후 홈 되돌림)
  useEffect(() => subscribePrefs(() => {
    const prefs = getPrefs();
    if (prefs) setMap(prefs.joystickMap);
    setMode(getJoystickMode() ?? DEFAULT_MODE);
  }), []);

  const commitMode = useCallback((next: JoystickMode) => {
    setMode(next);
    void setJoystickMode(next);
  }, []);

  // 저장(낙관적 로컬 → 서버 병합; userPrefs가 실패 삼킴 — UI는 즉시 반영)
  const commit = useCallback((next: JoystickMap) => {
    setMap(next);
    void setJoystickMap(next);
  }, []);

  const assign = useCallback((dir: JoystickDirectionKey, action: JoystickActionId) => {
    setMap((prev) => {
      if (prev[dir] === action) return prev;
      const next = { ...prev, [dir]: action };
      void setJoystickMap(next);
      return next;
    });
  }, []);

  const applyPreset = useCallback((id: 'default' | 'onehand') => {
    commit(id === 'onehand' ? { ...ONE_HAND_MAP } : { ...DEFAULT_MAP });
  }, [commit]);

  const reset = useCallback(() => applyPreset('default'), [applyPreset]);

  // 제스처 코드 → 동작 (TAP/LONG = null: 녹음 고정, 화면 하드코딩 — 요구 5)
  const actionFor = useCallback((gesture: JoystickGesture): JoystickActionId | null => {
    return actionForGesture(map, gesture);
  }, [map]);

  // 드래그 중 오버레이 라벨 (8방향 → 사용자 할당 동작명)
  const directionLabels = useCallback((): Partial<Record<JoystickGesture, string>> => {
    const labels: Partial<Record<JoystickGesture, string>> = {};
    for (const dir of DIRECTION_KEYS) {
      const action = map[dir];
      labels[dir] = action === 'none' ? t('joystick.actionNone') : t(`joystick.actions.${action}`);
    }
    return labels;
  }, [map, t]);

  return {
    map,
    mode,
    setMode: commitMode,
    preset: presetOf(map),
    assign,
    applyPreset,
    reset,
    actionFor,
    directionLabels,
    encode: () => encodeJoystickMap(map),
    actionIds: ACTION_IDS,
  };
}
