import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FEATURE_KEYS,
  SAMPLE_APPLICANTS,
  generateDataset,
} from '../src/domain/data.ts';
import {
  buildDecisionLetter,
  explainDecision,
} from '../src/domain/explain.ts';
import {
  predictApproved,
  trainLogisticRegression,
} from '../src/domain/model.ts';

const dataset = generateDataset(6000, 2026);
const model = trainLogisticRegression(dataset);

test('the synthetic model reaches at least 80% accuracy on its generated sample', () => {
  assert.ok(model.accuracy > 0.8, `accuracy was ${model.accuracy}`);
});

test('the strong sample is approved and the weak sample is declined', () => {
  assert.equal(predictApproved(model, SAMPLE_APPLICANTS['Strong applicant']), true);
  assert.equal(predictApproved(model, SAMPLE_APPLICANTS['Missed payments']), false);
});

test('high card usage is the leading reason for the high-usage sample', () => {
  const audit = explainDecision(model, SAMPLE_APPLICANTS['High card usage']);
  assert.equal(audit.approved, false);
  assert.equal(audit.reasons[0]?.feature, 'credit_utilization');
});

test('every suggested single change flips the decision to approved', () => {
  for (const [sampleName, features] of Object.entries(SAMPLE_APPLICANTS)) {
    const audit = explainDecision(model, features);
    for (const action of audit.actions) {
      assert.equal(
        predictApproved(model, {
          ...features,
          [action.feature]: action.targetValue,
        }),
        true,
        `${sampleName}: ${action.changeLabel}`,
      );
    }
  }
});

test('decline letters include the right to request a human review', () => {
  const features = SAMPLE_APPLICANTS['Missed payments'];
  const audit = explainDecision(model, features);
  const letter = buildDecisionLetter('Asha', features, audit);
  assert.match(letter, /right to request a human review/i);
  assert.match(letter, /existing accounts are not affected/i);
});

test('the model feature list contains no protected attributes', () => {
  const forbidden = [
    'age',
    'gender',
    'religion',
    'caste',
    'pincode',
    'marital_status',
  ];
  assert.deepEqual(FEATURE_KEYS, [
    'credit_score',
    'foir',
    'loan_to_income',
    'employment_years',
    'missed_payments_12m',
    'credit_utilization',
  ]);
  assert.equal(
    FEATURE_KEYS.some((feature) =>
      forbidden.includes(feature.toLowerCase()),
    ),
    false,
  );
});
