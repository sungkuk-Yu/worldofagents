import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consentTypes, emptyConsents, signupConsents, toggleRequiredConsents, validateConsents } from '../../src/lib/consents';
import { shouldShowExternalCheckout } from '../../src/config/payments';
import { needsClientDisclaimer } from '../../src/lib/legal';
import { normalizeServerMessages } from '../../src/lib/chatLogic';
import ko from '../../src/i18n/locales/ko.json';
import en from '../../src/i18n/locales/en.json';

test('Consent gate checks all 64 combinations independently of marketing', () => {
  const fields = [...consentTypes, 'ageConfirmed' as const];
  for (let bits = 0; bits < 64; bits++) {
    const state = { ...emptyConsents };
    fields.forEach((key, i) => { state[key] = Boolean(bits & (1 << i)); });
    const required = fields.filter((key) => key !== 'marketing');
    assert.equal(validateConsents(state), required.every((key) => state[key]));
  }
});
test('Required toggle preserves optional choice and does not mutate state', () => {
  for (const marketing of [true, false]) {
    const original = { ...emptyConsents, marketing };
    const checked = toggleRequiredConsents(original);
    assert.equal(validateConsents(checked), true);
    assert.equal(checked.marketing, marketing);
    assert.deepEqual(toggleRequiredConsents(checked), original);
    assert.equal(original.terms, false);
  }
});
test('Signup payload includes all five versioned consents and age', () => {
  const state = toggleRequiredConsents(emptyConsents);
  assert.deepEqual(signupConsents(state), {
    consents: consentTypes.map((type) => ({ type, version: '1.0', consented: type !== 'marketing' })),
    age_confirmed: true,
  });
});
test('Checkout platform and country matrix', () => {
  for (const platform of ['ios', 'android', 'web'] as const) {
    for (const region of ['KR', 'kr', ' KR ', 'US', 'JP', 'GB', '']) {
      assert.equal(shouldShowExternalCheckout(platform, region), !(platform === 'ios' && region.trim().toUpperCase() === 'KR'));
    }
  }
});
test('Only legal and accounting presets need a fallback', () => {
  for (const category of ['legal', 'accounting', ' LEGAL ']) assert.equal(needsClientDisclaimer(category, 'Response'), true);
  for (const category of [undefined, '', 'general', 'medical', 'unknown']) assert.equal(needsClientDisclaimer(category, 'Response'), false);
});
test('Server and client disclaimers in either language never get duplicated', () => {
  for (const locale of [ko, en]) {
    for (const text of Object.values(locale.legal)) {
      for (const category of ['legal', 'accounting']) {
        assert.equal(needsClientDisclaimer(category, `Response\n※ ${text}`), false);
        assert.equal(needsClientDisclaimer(category, text.replace(/ /g, '\n')), false);
      }
    }
  }
  assert.equal(needsClientDisclaimer('legal', 'This response is AI-generated information.'), true);
  assert.equal(needsClientDisclaimer('accounting', ''), true);
});
test('AI generation metadata preserves true, false and legacy absence', () => {
  for (const value of [true, false, undefined, 'false']) {
    const [message] = normalizeServerMessages([{ id: 'm', role: 'agent', content: 'Response', ai_generated: value }]);
    assert.equal(message.aiGenerated, typeof value === 'boolean' ? value : undefined);
  }
});
