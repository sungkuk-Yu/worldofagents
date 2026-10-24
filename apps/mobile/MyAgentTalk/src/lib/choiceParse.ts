export interface ChoiceItem { id: number; number: string; text: string }
export type ChoicePart = { kind: 'text'; text: string } | { kind: 'choices'; items: ChoiceItem[] };

/** Consecutive numbered lines form a choice block; fenced code remains literal. */
export function parseChoices(content: string): ChoicePart[] {
  const lines = content.split(/\r?\n/);
  const parts: ChoicePart[] = [];
  let plain: string[] = [];
  let fence: string | undefined;
  let id = 0;
  const flush = () => { if (plain.length) parts.push({ kind: 'text', text: plain.join('\n') }); plain = []; };
  for (let i = 0; i < lines.length;) {
    const marker = lines[i].match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined;
      plain.push(lines[i++]);
      continue;
    }
    const items: ChoiceItem[] = [];
    let end = i;
    while (!fence && end < lines.length) {
      const match = lines[end].match(/^\s*(\d+)[.)]\s+(.+)$/);
      if (!match || !match[2].trim()) break;
      items.push({ id: id + items.length, number: match[1], text: match[2] });
      end++;
    }
    if (items.length >= 2) {
      flush(); parts.push({ kind: 'choices', items }); id += items.length; i = end;
    } else plain.push(lines[i++]);
  }
  flush();
  return parts;
}
export interface ChoiceState { selected: number[]; locked: boolean }
export const emptyChoiceState: ChoiceState = { selected: [], locked: false };

/** Return an isolated state value; the shared template must never be mutated. */
export function createChoiceState(): ChoiceState { return { selected: [], locked: false }; }
export function toggleChoice(state: ChoiceState, id: number, active: boolean): ChoiceState {
  if (!active || state.locked) return state;
  return { ...state, selected: state.selected.includes(id) ? state.selected.filter((v) => v !== id) : [...state.selected, id] };
}
export function choiceSubmission(parts: ChoicePart[], state: ChoiceState, active: boolean): string | null {
  if (!active || state.locked) return null;
  const items = parts.flatMap((p) => p.kind === 'choices' ? p.items : []).filter((item) => state.selected.includes(item.id));
  return items.length ? `${items.map((item) => `${item.number}번`).join(', ')} 선택: ${items.map((item) => item.text).join('; ')}` : null;
}
