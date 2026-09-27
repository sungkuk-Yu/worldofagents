// photo_edit 카드 (t_4497cfce P0-2): user 첨부 위 편집 지시를 원본 위에 재현 — 크롭 영역 강조 +
// 화살표/핀/텍스트 오버레이 + "편집 결과 저장" 버튼. payload: structured_payload.photo_edit 또는
// content JSON 펜스 폴백(에이전트 카드가 아니므로 user 메시지 content에서 파싱해 CardFrame이 사용).
import React, { useRef } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import Svg, { Circle, Line, Marker, Path, Defs } from 'react-native-svg';
import { AttachmentRef, CropRect, PhotoAnnotation, cropRectOnContain, mapAnnotationToShown, parsePhotoEditPayload } from '../lib/photoLogic';
import { downloadBlob, renderEditBlobWeb } from '../lib/photoCapture';
import { colors, radii, spacing, typography } from '../theme';

export interface PhotoEditViewData {
  crop: CropRect | null;
  annotations: PhotoAnnotation[];
  /** 원본 이미지 URL (첨부 요약의 첫 이미지) */
  url: string | null;
  /** 편집 지시 요약 라인 (본문에서 제거하고 표시) */
  summary: string[];
}

/** user 메시지 content가 photo_edit JSON 펜스를 품었는지 (재현 카드 분기). */
export function hasPhotoEditFence(content: string): boolean {
  return /```json[\s\S]*?"photo_edit"/.test(content || '');
}

/** user 메시지 content + 첨부 배열 → photo_edit 뷰 데이터. 지시 없으면 null. */
export function buildPhotoEditView(content: string, attachments: AttachmentRef[]): PhotoEditViewData | null {
  const parsed = parseContentPhotoEdit(content);
  if (!parsed) return null;
  const image = attachments.find((a) => a.mime.startsWith('image/'));
  return { crop: parsed.crop, annotations: parsed.annotations, url: image?.url ?? null, summary: parsed.summary };
}

/** content의 ```json photo_edit 펜스 추출 (백엔드 저장 payload 무관 — 프론트 자체 지시 포맷). */
export function parseContentPhotoEdit(content: string): { crop: CropRect | null; annotations: PhotoAnnotation[]; summary: string[] } | null {
  const m = content.match(/```json\s*([\s\S]*?)```/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[1]) as { photo_edit?: Record<string, unknown> };
    if (!obj?.photo_edit) return null;
    const p = parsePhotoEditPayload(obj.photo_edit as { crop?: unknown; annotations?: unknown; original_url?: unknown; edited_url?: unknown; edit_of?: unknown; caption?: unknown });
    const hasEdit = !!p.crop || p.annotations.length > 0;
    if (!hasEdit) return null;
    const summary = content.replace(/```json[\s\S]*?```/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
    return { crop: p.crop, annotations: p.annotations, summary };
  } catch { return null; }
}

export default function PhotoEditCard({ data, attachmentName }: { data: PhotoEditViewData; attachmentName?: string | null }) {
  const { t } = useTranslation();
  const boxRef = useRef<View>(null);
  const [boxSize, setBoxSize] = React.useState({ w: 0, h: 0 });
  const [busy, setBusy] = React.useState(false);
  const [errKey, setErrKey] = React.useState<string | null>(null);

  const save = async () => {
    if (!data.url || busy) return;
    setBusy(true); setErrKey(null);
    const cropFull: CropRect = data.crop ?? { x: 0, y: 0, w: 1, h: 1 };
    try {
      const { blob } = await renderEditBlobWeb(data.url, cropFull, data.annotations);
      downloadBlob(blob);
    } catch {
      setErrKey('errors.photoSaveFailed'); // 주석 합성 실패 → 크롭만 재시도
      try {
        const { blob } = await renderEditBlobWeb(data.url, cropFull, []);
        downloadBlob(blob);
        setErrKey(null);
      } catch { setErrKey('errors.photoSaveFailed'); }
    } finally { setBusy(false); }
  };

  const cropShown = boxSize.w > 0 && data.crop
    ? cropRectOnContain(data.crop, boxSize.w, boxSize.h) : null;

  return (
    <View style={st.wrap} testID="photo-edit-card">
      {data.summary.length > 0 && <Text style={st.summary}>{data.summary.join('\n')}</Text>}
      {data.url ? (
        <View>
          <View ref={boxRef} collapsable={false} style={st.frame} onLayout={(e) => setBoxSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
            <Image source={{ uri: data.url }} style={st.image} contentFit="contain" transition={120} accessibilityLabel={attachmentName ?? t('photoEditor.title')} />
            {cropShown && <View pointerEvents="none" style={[st.crop, { left: cropShown.left, top: cropShown.top, width: cropShown.width, height: cropShown.height }]} testID="photo-edit-crop" />}
            {boxSize.w > 0 && data.annotations.length > 0 && (
              <Svg width={boxSize.w} height={boxSize.h} style={StyleSheet.absoluteFill} pointerEvents="none">
                <Defs>
                  <Marker id="pe-arrow" refX="2" refY="2" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                    <Path d="M0,0 L4,2 L0,4 z" fill={colors.statusErr} />
                  </Marker>
                </Defs>
                {data.annotations.map((a, i) => {
                  const m = mapAnnotationToShown(a, boxSize.w, boxSize.h);
                  if (!m) return null;
                  if (m.type === 'arrow' && m.to) return <Line key={i} x1={m.from.x} y1={m.from.y} x2={m.to.x} y2={m.to.y} stroke={colors.statusErr} strokeWidth={3} markerEnd="url(#pe-arrow)" />;
                  return <Circle key={i} cx={m.from.x} cy={m.from.y} r={6} fill={m.type === 'text' ? colors.accent : colors.statusErr} stroke="#fff" strokeWidth={1.5} />;
                })}
              </Svg>
            )}
          </View>
          {Platform.OS === 'web' && (
            <TouchableOpacity style={st.save} onPress={() => void save()} disabled={busy} testID="photo-edit-save">
              <Text style={st.saveText}>{busy ? t('photoEditor.saving') : t('photoEditCard.save')}</Text>
            </TouchableOpacity>
          )}
          {errKey && <Text accessibilityRole="alert" style={st.err}>{t(errKey)}</Text>}
        </View>
      ) : <Text style={st.err}>{t('errors.file')}</Text>}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { marginTop: spacing.sp2, gap: spacing.sp2, minWidth: 0 },
  summary: { ...typography.body, color: colors.text1 },
  frame: { width: '100%', maxWidth: 360, aspectRatio: 1, backgroundColor: '#0B0E14', borderRadius: radii.sm, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  crop: { position: 'absolute', borderWidth: 2, borderStyle: 'dashed', borderColor: '#FFFFFF' },
  save: { alignSelf: 'flex-start', backgroundColor: colors.accent, borderRadius: radii.sm, paddingHorizontal: spacing.sp4, paddingVertical: spacing.sp2 },
  saveText: { ...typography.caption, color: colors.onPrimary },
  err: { ...typography.caption, color: colors.statusErr },
});

/** 에이전트 카드 등록용 어댑터 — dialogue_type='photo_edit'의 structured_payload(래핑/평면 모두) 렌더. */
export function PhotoEditAgentCard({ payload, message }: { payload?: Record<string, unknown>; message: { content?: string } }) {
  const p = parsePhotoEditPayload(payload ?? {});
  const image = p.editedUrl ?? p.originalUrl;
  if (!image && !p.crop && !p.annotations.length) return <Text style={st.summary}>{message.content || ''}</Text>;
  return <PhotoEditCard data={{ crop: p.crop, annotations: p.annotations, url: image, summary: p.caption ? [p.caption] : [] }} />;
}
