// PhotoEditorSheet — 사진 편집 시트 (t_4497cfce P0-1): 크롭(자유+프리셋 비율) · 주석(핀/화살표/텍스트).
// 좌표계: 이미지 박스 기준 0~1 정규화 (카드 요구 — 해상도 무관). 드래그는 PanResponder.
// 저장: 웹=canvas 합성(크롭+주석 굽기, CORS 실패 시 크롭만) / RN=expo-image-manipulator 크롭(주석은 지시 텍스트로 전송).
// "이걸 → 여기로": 화살표는 from→to 드래그 + 메모, 저장 시 buildEditMessage로 사람이 읽는 지시 + JSON 펜스 생성.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, PanResponder, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, type GestureResponderHandlers } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Circle, Line, Marker, Path, Defs } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { CROP_PRESETS, CropRect, PhotoAnnotation, clampCrop, buildEditMessage, dragCrop, presetRatio } from '../lib/photoLogic';
import { renderEditBlobWeb, cropImageRn } from '../lib/photoCapture';
import { colors, radii, spacing, typography } from '../theme';

export interface PhotoEditResult {
  /** 전송 텍스트 (요약 + photo_edit JSON 펜스). */
  text: string;
  /** 편집 결과 바이너리/URI — 웹 Blob, 네이티브 file 객체. */
  edited: Blob | { uri: string; name: string; type: string } | null;
  editedName: string;
  crop: CropRect | null;
  annotations: PhotoAnnotation[];
  /** 편집 실패(원본만 전송) 여부. */
  fallbackOriginal: boolean;
}
interface Props {
  visible: boolean;
  source: { uri: string; width: number; height: number } | null;
  /** 원본이 이미 업로드된 첨부 ID (edit_of 연결용, 없으면 null). */
  originalId?: string | null;
  onClose: () => void;
  onSave: (result: PhotoEditResult) => Promise<void> | void;
}

type Tool = 'crop' | 'pin' | 'arrow' | 'text';
type Drag = { handle: 'nw' | 'ne' | 'sw' | 'se' | 'move'; start: { x: number; y: number }; cropAt: CropRect } | null;

const HANDLES: { id: 'nw' | 'ne' | 'sw' | 'se'; side: 'top' | 'bottom'; corner: 'left' | 'right' }[] = [
  { id: 'nw', side: 'top', corner: 'left' }, { id: 'ne', side: 'top', corner: 'right' },
  { id: 'sw', side: 'bottom', corner: 'left' }, { id: 'se', side: 'bottom', corner: 'right' },
];

export default function PhotoEditorSheet({ visible, source, originalId, onClose, onSave }: Props) {
  const { t } = useTranslation();
  const [tool, setTool] = useState<Tool>('crop');
  const [ratio, setRatio] = useState<string>('free');
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, w: 1, h: 1 });
  const [annotations, setAnnotations] = useState<PhotoAnnotation[]>([]);
  const [draftArrow, setDraftArrow] = useState<{ from: { x: number; y: number }; to: { x: number; y: number } } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<View>(null);
  const drag = useRef<Drag>(null);
  const arrowFrom = useRef<{ x: number; y: number } | null>(null);

  const reset = useCallback(() => {
    setTool('crop'); setRatio('free'); setCrop({ x: 0, y: 0, w: 1, h: 1 });
    setAnnotations([]); setDraftArrow(null); setNote(''); setBusy(false);
  }, []);
  const close = useCallback(() => { reset(); onClose(); }, [onClose, reset]);

  // 박스 기하·최신 상태는 ref 스냅샷 — PanResponder는 effect에서 1회 생성 (MagicPad/JoystickMic 패턴: 렌더 중 ref 쓰기 금지)
  const geom = useRef({ ox: 0, oy: 0, w: 1, h: 1 });
  const live = useRef({ tool, ratio, crop, note });
  useEffect(() => { live.current = { tool, ratio, crop, note }; });
  const norm = (pageX: number, pageY: number) => ({
    x: Math.min(1, Math.max(0, (pageX - geom.current.ox) / geom.current.w)),
    y: Math.min(1, Math.max(0, (pageY - geom.current.oy) / geom.current.h)),
  });
  const measureBox = () => {
    const node = boxRef.current as unknown as { getBoundingClientRect?: () => DOMRect; measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null;
    if (!node) return;
    if (Platform.OS === 'web' && node.getBoundingClientRect) {
      const r = node.getBoundingClientRect();
      geom.current = { ox: r.left, oy: r.top, w: r.width || 1, h: r.height || 1 };
    } else node.measureInWindow?.((x, y, w, h) => { geom.current = { ox: x, oy: y, w: w || 1, h: h || 1 }; });
  };

  const [cropHandlers, setCropHandlers] = useState<GestureResponderHandlers>({});
  const [annoHandlers, setAnnoHandlers] = useState<GestureResponderHandlers>({});
  useEffect(() => {
    setCropHandlers(PanResponder.create({
      onStartShouldSetPanResponder: () => live.current.tool === 'crop',
      onMoveShouldSetPanResponder: () => live.current.tool === 'crop',
      onPanResponderGrant: (evt) => {
        measureBox();
        const p = norm(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
        const c = live.current.crop;
        const inCrop = p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h;
        drag.current = { handle: inCrop ? 'move' : 'se', start: p, cropAt: c };
        if (!inCrop) setCrop(clampCrop({ x: p.x, y: p.y, w: Math.min(1 - p.x, 0.5), h: Math.min(1 - p.y, 0.5) }, presetRatio(live.current.ratio)));
      },
      onPanResponderMove: (_evt, gs) => {
        if (!drag.current) return;
        const d = drag.current;
        const p = norm(gs.x0 + gs.dx, gs.y0 + gs.dy);
        setCrop(dragCrop(d.cropAt, d.handle, p.x - d.start.x, p.y - d.start.y, presetRatio(live.current.ratio)));
      },
      onPanResponderRelease: () => { drag.current = null; },
      onPanResponderTerminate: () => { drag.current = null; },
    }).panHandlers);
    setAnnoHandlers(PanResponder.create({
      onStartShouldSetPanResponder: () => live.current.tool !== 'crop',
      onMoveShouldSetPanResponder: () => live.current.tool !== 'crop',
      onPanResponderGrant: (evt) => {
        measureBox();
        const p = norm(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
        const tool = live.current.tool;
        const memo = live.current.note.trim();
        if (tool === 'arrow') arrowFrom.current = p;
        else setAnnotations((prev) => [...prev, { type: tool as 'pin' | 'text', from: p, ...(memo ? { note: memo } : {}) }]);
      },
      onPanResponderMove: (_evt, gs) => {
        if (live.current.tool !== 'arrow' || !arrowFrom.current) return;
        setDraftArrow({ from: arrowFrom.current, to: norm(gs.x0 + gs.dx, gs.y0 + gs.dy) });
      },
      onPanResponderRelease: (_evt, gs) => {
        if (live.current.tool === 'arrow' && arrowFrom.current) {
          const from = arrowFrom.current;
          const to = norm(gs.x0 + gs.dx, gs.y0 + gs.dy);
          const memo = live.current.note.trim();
          arrowFrom.current = null; setDraftArrow(null);
          setAnnotations((prev) => [...prev, { type: 'arrow', from, to, ...(memo ? { note: memo } : {}) }]);
        }
      },
      onPanResponderTerminate: () => { arrowFrom.current = null; setDraftArrow(null); },
    }).panHandlers);
  }, []);

  const removeAnnotation = (index: number) => setAnnotations((prev) => prev.filter((_, i) => i !== index));

  const hasCrop = crop.w < 1 || crop.h < 1 || crop.x > 0 || crop.y > 0;
  const canSave = !!source && !busy && (hasCrop || annotations.length > 0 || note.trim().length > 0);

  const save = useCallback(async () => {
    if (!source || !canSave) return;
    setBusy(true);
    const cropToSave = hasCrop ? crop : null;
    try {
      let edited: PhotoEditResult['edited'] = null;
      let fallbackOriginal = false;
      if (Platform.OS === 'web') {
        try {
          const { blob } = await renderEditBlobWeb(source.uri, crop, annotations);
          edited = blob;
        } catch {
          // CORS 등 합성 실패 → 원본 첨부 + 텍스트 지시만 (카드 §검증: 폴백 경로)
          fallbackOriginal = true;
        }
      } else {
        try {
          const uri = await cropImageRn(source, cropToSave ?? { x: 0, y: 0, w: 1, h: 1 });
          edited = { uri, name: `edited-${Date.now()}.jpg`, type: 'image/jpeg' };
        } catch { fallbackOriginal = true; }
      }
      await onSave({
        text: buildEditMessage({ crop: cropToSave, annotations, caption: note.trim() || undefined, editOf: originalId ?? null }),
        edited, editedName: `edited-${Date.now()}.png`, crop: cropToSave, annotations, fallbackOriginal,
      });
      close();
    } finally { setBusy(false); }
  }, [source, canSave, hasCrop, crop, annotations, note, originalId, onSave, close]);

  const px = (v: number, axis: 'x' | 'y'): `${number}%` => { void axis; return `${Math.round(v * 10000) / 100}%`; };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={st.backdrop}>
        <View style={st.sheet} testID="photo-editor">
          <View style={st.header}>
            <Text style={st.title}>{t('photoEditor.title')}</Text>
            <TouchableOpacity onPress={close} accessibilityLabel={t('common.close')} testID="photo-editor-close"><Text style={st.closeText}>{t('common.cancel')}</Text></TouchableOpacity>
          </View>
          <View style={st.tools} testID="photo-editor-tools">
            {(['crop', 'pin', 'arrow', 'text'] as Tool[]).map((x) => (
              <TouchableOpacity key={x} style={[st.tool, tool === x && st.toolActive]} onPress={() => setTool(x)} testID={`tool-${x}`} accessibilityRole="button">
                <Text style={[st.toolText, tool === x && st.toolTextActive]}>{t(`photoEditor.tools.${x}`)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {/* MagicPad과 동일 패턴: panHandlers는 평범한 View에 spread — Pressable은 자체 responder로 협상을 선점해 PanResponder가 죽는다 */}
          <View style={st.canvasWrap} testID="photo-canvas" {...(tool === 'crop' ? cropHandlers : annoHandlers)}>
            <View ref={boxRef} collapsable={false} style={st.canvas}>
              {source && <Image source={{ uri: source.uri }} style={st.image} contentFit="contain" transition={120} pointerEvents="none" />}
              {tool === 'crop' && (
                <View pointerEvents="none" style={[st.cropMask, { left: px(crop.x, 'x'), top: px(crop.y, 'y'), width: px(crop.w, 'x'), height: px(crop.h, 'y') }]}>
                  {HANDLES.map((h) => <View key={h.id} style={[st.handle, { [h.side]: -6, [h.corner]: -6 }]} testID={`crop-handle-${h.id}`} />)}
                </View>
              )}
              <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
                <Defs>
                  <Marker id="arrowhead" refX="2" refY="2" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                    <Path d="M0,0 L4,2 L0,4 z" fill={colors.statusErr} />
                  </Marker>
                </Defs>
                {annotations.map((a, i) => {
                  if (a.type === 'pin') return <Circle key={i} cx={a.from.x * 100 + '%'} cy={a.from.y * 100 + '%'} r={6} fill={colors.statusErr} stroke="#fff" strokeWidth={1.5} />;
                  if (a.type === 'arrow' && a.to) return <Line key={i} x1={`${a.from.x * 100}%`} y1={`${a.from.y * 100}%`} x2={`${a.to.x * 100}%`} y2={`${a.to.y * 100}%`} stroke={colors.statusErr} strokeWidth={3} markerEnd="url(#arrowhead)" />;
                  return <Circle key={i} cx={`${a.from.x * 100}%`} cy={`${a.from.y * 100}%`} r={4} fill={colors.accent} />;
                })}
                {draftArrow && <Line x1={`${draftArrow.from.x * 100}%`} y1={`${draftArrow.from.y * 100}%`} x2={`${draftArrow.to.x * 100}%`} y2={`${draftArrow.to.y * 100}%`} stroke={colors.statusErr} strokeWidth={3} strokeDasharray="6 4" markerEnd="url(#arrowhead)" />}
              </Svg>
              {annotations.map((a, i) => a.note ? (
                <Text key={`n${i}`} numberOfLines={1} style={[st.noteTag, { left: px(a.from.x, 'x'), top: px(a.from.y, 'y') }]}>#{i + 1} {a.note}</Text>
              ) : null)}
            </View>
          </View>
          {tool === 'crop' && (
            <ScrollView horizontal style={st.presetRow} testID="crop-presets">
              {CROP_PRESETS.map((p) => (
                <TouchableOpacity key={p.id} style={[st.preset, ratio === p.id && st.presetActive]} onPress={() => { setRatio(p.id); setCrop((c) => clampCrop(c, presetRatio(p.id))); }} testID={`preset-${p.id}`}>
                  <Text style={[st.presetText, ratio === p.id && st.presetTextActive]}>{p.id === 'free' ? t('photoEditor.freeRatio') : p.id}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={st.preset} onPress={() => setCrop({ x: 0, y: 0, w: 1, h: 1 })} testID="crop-reset"><Text style={st.presetText}>{t('photoEditor.reset')}</Text></TouchableOpacity>
            </ScrollView>
          )}
          <View style={st.noteRow}>
            <TextInput value={note} onChangeText={setNote} placeholder={t('photoEditor.notePlaceholder')} placeholderTextColor={colors.text3} style={st.noteInput} testID="photo-note" multiline={false} />
            {annotations.length > 0 && (
              <ScrollView horizontal style={st.chips}>
                {annotations.map((a, i) => (
                  <TouchableOpacity key={i} style={st.chip} onPress={() => removeAnnotation(i)} testID={`annotation-${i}`} accessibilityLabel={t('photoEditor.removeAnnotation')}>
                    <Text style={st.chipText}>#{i + 1} {t(`photoEditor.tools.${a.type}`)} ✕</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
          <ScrollView horizontal style={st.presetRow}>
            <Text style={st.hint} testID="photo-editor-hint">{t(annotations.some((a) => a.type === 'arrow') ? 'photoEditor.arrowHint' : 'photoEditor.hint')}</Text>
          </ScrollView>
          <TouchableOpacity style={[st.save, !canSave && st.saveDisabled]} onPress={() => void save()} disabled={!canSave} testID="photo-editor-save">
            <Text style={st.saveText}>{busy ? t('photoEditor.saving') : t('photoEditor.saveSend')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', alignItems: 'center', padding: spacing.sp4 },
  sheet: { width: '100%', maxWidth: 560, maxHeight: '92%', backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.sp3, gap: spacing.sp2, ...Platform.select({ web: { boxShadow: '0 12px 32px rgba(16,24,40,0.18)' } as never, default: {} }) },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...typography.title2, color: colors.text1 },
  closeText: { ...typography.caption, color: colors.text2, padding: spacing.sp2 },
  tools: { flexDirection: 'row', gap: spacing.sp2 },
  tool: { paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp2, borderRadius: radii.sm, backgroundColor: colors.surfaceRaise, borderWidth: 1, borderColor: colors.border },
  toolActive: { backgroundColor: colors.accentTint, borderColor: colors.accent },
  toolText: { ...typography.caption, color: colors.text2 },
  toolTextActive: { color: colors.accent },
  canvasWrap: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B0E14', borderRadius: radii.md, minHeight: 220 },
  canvas: { width: '100%', aspectRatio: 1, maxWidth: 480, position: 'relative' },
  image: { width: '100%', height: '100%' },
  cropMask: { position: 'absolute', borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 2, ...Platform.select({ web: { boxShadow: '0 0 0 9999px rgba(11,14,20,0.55)' } as never, default: {} }) },
  handle: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: colors.accent },
  noteTag: { position: 'absolute', marginLeft: 8, marginTop: -8, ...typography.microSm, color: colors.statusErr, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: radii.xs, paddingHorizontal: 4, overflow: 'hidden', maxWidth: 140 },
  presetRow: { flexDirection: 'row', gap: spacing.sp2 },
  preset: { paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp2, borderRadius: radii.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  presetActive: { borderColor: colors.accent, backgroundColor: colors.accentTint },
  presetText: { ...typography.caption, color: colors.text2 },
  presetTextActive: { color: colors.accent },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2 },
  noteInput: { ...typography.body, flex: 1, minWidth: 0, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp2, color: colors.text1, backgroundColor: colors.surface, ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : {}) },
  chips: { flexDirection: 'row', maxWidth: 180 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.full, paddingHorizontal: spacing.sp2, paddingVertical: 2, marginRight: spacing.sp1, backgroundColor: colors.surfaceRaise },
  chipText: { ...typography.microSm, color: colors.text2 },
  hint: { ...typography.micro, color: colors.text3, paddingVertical: spacing.sp1 },
  save: { backgroundColor: colors.accent, borderRadius: radii.sm, paddingVertical: spacing.sp3, alignItems: 'center', marginTop: spacing.sp1 },
  saveDisabled: { opacity: 0.5 },
  saveText: { ...typography.bodyBold, color: colors.onPrimary },
});
