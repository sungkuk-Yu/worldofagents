// form 카드 — Wave 1 #1 (체크 버튼 활성화, 사람↔에이전트 상호작용의 핵심)
// react-native-paper 기성 Checkbox/RadioButton/Switch/Button/TextInput 사용(직접 구현 금지 — 카드 지시).
// 제출 → content(사람이 읽는 요약) + form_response JSON 블록을 사용자 메시지로 전송(handlers.submitForm).
// 백엔드 텍스트 전송 계약(content 필수)을 그대로 사용 — 스키마 변경 없음.
// 제출 후 카드 잠금(readonly)+제출값 표시 — 중복 제출 방지. 전송 중 pending.
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Checkbox, Divider, HelperText, RadioButton, Switch, Text, TextInput } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import type { CardProps } from '../../cards/types';
import { cardStyles as s } from '../../cards/styles';
import { displayValue } from '../../cards/payload';
import { buildFormResponsePayload, FormField, FormValue, FormValues, initialFormValues, parseFormSpec, validateFormValues } from '../../lib/formLogic';
import { colors, radii, spacing } from '../../theme';

export default function FormCard({ message, payload, handlers }: CardProps) {
  const { t } = useTranslation();
  const spec = useMemo(() => parseFormSpec(payload), [payload]);
  const formId = displayValue(payload?.form_id) || message.id;
  const [values, setValues] = useState<FormValues>(() => (spec ? initialFormValues(spec) : {}));
  const [missing, setMissing] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<FormValues | null>(null);

  if (!spec) return <Text style={s.body}>{message.content || t('cards.noContent')}</Text>;

  const readonly = submitted !== null || submitting;
  const fieldLabel = (field: FormField, value: FormValue | undefined): string => {
    if (typeof value === 'boolean') return t(value ? 'cards.formYes' : 'cards.formNo');
    if (Array.isArray(value)) return value.join(', ');
    return typeof value === 'string' ? value : '';
  };
  const setValue = (id: string, value: FormValue) => {
    setValues((prev) => ({ ...prev, [id]: value }));
    setMissing((prev) => prev.filter((m) => m !== id));
  };
  const toggleMulti = (field: FormField, option: string) => {
    const current = Array.isArray(values[field.id]) ? (values[field.id] as string[]) : [];
    setValue(field.id, current.includes(option) ? current.filter((v) => v !== option) : [...current, option]);
  };

  const onSubmit = () => {
    if (readonly || !handlers.submitForm) return;
    const fail = validateFormValues(spec, values);
    setMissing(fail);
    if (fail.length) return;
    const title = spec.title || t('cards.formDefaultTitle');
    const lines = spec.fields
      .map((f) => { const text = fieldLabel(f, values[f.id]); return text ? `- ${f.label}: ${text}` : ''; })
      .filter(Boolean);
    // 카드 지시 계약: {type:'form_response', form_id, values} — content 마지막 줄에 JSON으로 첨부.
    const wire = `${t('cards.formSubmitPrefix', { title })}\n${lines.join('\n')}\n${JSON.stringify(buildFormResponsePayload(formId, values))}`;
    setSubmitting(true);
    void handlers.submitForm(message, wire).then((ok) => {
      setSubmitting(false);
      if (ok) setSubmitted({ ...values });
    });
  };

  const renderField = (field: FormField) => {
    const invalid = missing.includes(field.id);
    const value = values[field.id];
    const helper = invalid ? <HelperText type="error" visible>{t('cards.formRequired')}</HelperText> : null;
    const label = <Text style={s.body}>{field.label}{field.required ? ' *' : ''}</Text>;
    switch (field.type) {
      case 'checkbox':
        return <View key={field.id}>
          <View style={styles.toggleRow}>
            <Checkbox status={value === true ? 'checked' : 'unchecked'} disabled={readonly} color={colors.accent} testID={`form-${field.id}`}
              onPress={() => setValue(field.id, !(value === true))} />
            {label}
          </View>
          {helper}
        </View>;
      case 'toggle':
        return <View key={field.id} style={styles.toggleRow}>
          <Switch value={value === true} disabled={readonly} onValueChange={(v) => setValue(field.id, v)} accessibilityLabel={field.label} />
          {label}
        </View>;
      case 'radio':
        return <View key={field.id}>
          <Text style={s.micro}>{field.label}{field.required ? ' *' : ''}</Text>
          <RadioButton.Group value={typeof value === 'string' ? value : ''} onValueChange={(v) => { if (!readonly) setValue(field.id, v); }}>
            {field.options.map((option) => <View key={option} style={styles.radioRow}>
              <RadioButton value={option} color={colors.accent} status={value === option ? 'checked' : 'unchecked'} disabled={readonly} testID={`form-${field.id}-${option}`} />
              <Text style={s.body}>{option}</Text>
            </View>)}
          </RadioButton.Group>
          {helper}
        </View>;
      case 'multi':
        return <View key={field.id}>
          <Text style={s.micro}>{field.label}{field.required ? ' *' : ''}</Text>
          <View style={styles.chips}>
            {field.options.map((option) => {
              const on = Array.isArray(value) && value.includes(option);
              return <Button key={option} compact mode={on ? 'contained' : 'outlined'} testID={`form-multi-${field.id}-${option}`}
                buttonColor={on ? colors.accent : undefined} textColor={on ? colors.onPrimary : colors.text2}
                style={styles.chip} disabled={readonly} onPress={() => toggleMulti(field, option)}>
                {on ? `✓ ${option}` : option}
              </Button>;
            })}
          </View>
          {helper}
        </View>;
      case 'select':
        return <View key={field.id}>
          <Text style={s.micro}>{field.label}{field.required ? ' *' : ''}</Text>
          <View style={styles.chips}>
            {field.options.map((option) => (
              <Button key={option} compact mode={value === option ? 'contained' : 'outlined'} testID={`form-select-${field.id}-${option}`}
                buttonColor={value === option ? colors.accent : undefined} textColor={value === option ? colors.onPrimary : colors.text2}
                style={styles.chip} disabled={readonly} onPress={() => setValue(field.id, option)}>{option}</Button>
            ))}
          </View>
          {helper}
        </View>;
      default: // text | textarea
        return <View key={field.id}>
          <TextInput
            mode="outlined" dense style={styles.textInput}
            multiline={field.type === 'textarea'}
            outlineColor={colors.border} activeOutlineColor={colors.accent} textColor={colors.text1} placeholderTextColor={colors.text3}
            disabled={readonly} value={typeof value === 'string' ? value : ''} onChangeText={(v) => setValue(field.id, v)}
            placeholder={field.label + (field.required ? ' *' : '')} accessibilityLabel={field.label} testID={`form-${field.id}`} />
          {helper}
        </View>;
    }
  };

  return <View testID="form-card">
    {!!spec.title && <Text style={s.title}>{spec.title}</Text>}
    {submitted ? (
      <View testID="form-submitted">
        <Divider style={styles.divider} />
        {spec.fields.map((field) => {
          const text = fieldLabel(field, submitted[field.id]);
          if (!text) return null;
          return <View key={field.id} style={s.row}>
            <Text style={s.micro}>{field.label}</Text>
            <Text style={s.body}>{text}</Text>
          </View>;
        })}
        <Text style={s.micro}>{t('cards.formLocked')}</Text>
      </View>
    ) : (
      <View style={styles.fields}>
        {spec.fields.map(renderField)}
        {missing.length > 0 && <Text style={styles.missingNote} testID="form-missing">{t('cards.formMissing')}</Text>}
        <Button mode="contained" onPress={onSubmit} loading={submitting} disabled={readonly || !handlers.submitForm}
          buttonColor={colors.accent} textColor={colors.onPrimary} style={styles.submit} testID="form-submit">
          {t('cards.formSubmit')}
        </Button>
      </View>
    )}
  </View>;
}

const styles = StyleSheet.create({
  fields: { gap: spacing.sp2, marginTop: spacing.sp2 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, flexWrap: 'wrap' },
  radioRow: { flexDirection: 'row', alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sp2, marginTop: spacing.sp1 },
  chip: { borderRadius: radii.sm, minWidth: 0 },
  textInput: { marginTop: spacing.sp1, backgroundColor: colors.surface },
  missingNote: { ...s.micro, color: colors.statusErr },
  submit: { marginTop: spacing.sp3, alignSelf: 'flex-start' },
  divider: { backgroundColor: colors.border, marginVertical: spacing.sp2 },
});
