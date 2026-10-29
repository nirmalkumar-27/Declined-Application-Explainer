import { FEATURE_KEYS } from './data.ts';
import type {
  ApplicantFeatures,
  FeatureKey,
  TrainingRecord,
} from './data.ts';
import {
  predictApproved,
  predictProbability,
  type LogisticModel,
} from './model.ts';

const FEATURE_LABELS: Record<FeatureKey, string> = {
  credit_score: 'Credit score',
  foir: 'FOIR',
  loan_to_income: 'Loan-to-income ratio',
  employment_years: 'Employment history',
  missed_payments_12m: 'Missed payments',
  credit_utilization: 'Credit utilization',
};

export interface Impact {
  feature: FeatureKey;
  label: string;
  value: number;
  standardizedValue: number;
  coefficient: number;
  contribution: number;
  explanation: string;
}

export interface ImprovementAction {
  feature: FeatureKey;
  label: string;
  currentValue: number;
  targetValue: number;
  change: number;
  changeLabel: string;
  projectedProbability: number;
}

export interface DecisionAudit {
  approved: boolean;
  approvalProbability: number;
  score: number;
  threshold: number;
  reasons: Impact[];
  impacts: Impact[];
  actions: ImprovementAction[];
  featureList: FeatureKey[];
  protectedAttributesUsed: string[];
  modelAccuracy: number;
  sampleCount: number;
}

function formatExplanation(
  feature: FeatureKey,
  value: number,
  average: number,
): string {
  switch (feature) {
    case 'credit_score':
      return `A score of ${Math.round(value)} is ${Math.round(Math.abs(value - average))} points ${value < average ? 'below' : 'above'} the synthetic reference average.`;
    case 'foir':
      return `FOIR is ${Math.round(value * 100)}% of monthly income, compared with a ${Math.round(average * 100)}% synthetic reference average.`;
    case 'loan_to_income':
      return `The requested loan is ${value.toFixed(1)}× annual income, compared with a ${average.toFixed(1)}× synthetic reference average.`;
    case 'employment_years':
      return `Employment history is ${value.toFixed(1)} years, compared with a ${average.toFixed(1)}-year synthetic reference average.`;
    case 'missed_payments_12m':
      return `${Math.round(value)} missed payment${Math.round(value) === 1 ? '' : 's'} in the last 12 months, compared with ${Math.round(average)} at the synthetic reference average.`;
    case 'credit_utilization':
      return `Credit utilization is ${Math.round(value * 100)}%, compared with a ${Math.round(average * 100)}% synthetic reference average.`;
  }
}

function actionCandidate(
  feature: FeatureKey,
  features: ApplicantFeatures,
): { direction: 1 | -1; cap: number; unit: string; precision: number } | null {
  switch (feature) {
    case 'credit_score':
      return {
        direction: 1,
        cap: Math.min(60, 900 - features.credit_score),
        unit: 'points',
        precision: 0,
      };
    case 'credit_utilization':
      return {
        direction: -1,
        cap: Math.min(0.6, features.credit_utilization),
        unit: 'percentage points',
        precision: 1,
      };
    case 'foir':
      return {
        direction: -1,
        cap: Math.min(0.25, features.foir),
        unit: 'percentage points',
        precision: 1,
      };
    case 'loan_to_income':
      return {
        direction: -1,
        cap: Math.min(2, Math.max(0, features.loan_to_income - 0.1)),
        unit: '×',
        precision: 2,
      };
    case 'employment_years':
    case 'missed_payments_12m':
      return null;
  }
}

function findAction(
  model: LogisticModel,
  features: ApplicantFeatures,
  feature: FeatureKey,
): ImprovementAction | null {
  const candidate = actionCandidate(feature, features);
  if (!candidate || candidate.cap <= 0) return null;

  const withChange = (amount: number): ApplicantFeatures => ({
    ...features,
    [feature]: features[feature] + candidate.direction * amount,
  });

  if (!predictApproved(model, withChange(candidate.cap))) return null;

  let low = 0;
  let high = candidate.cap;
  for (let index = 0; index < 32; index += 1) {
    const middle = (low + high) / 2;
    if (predictApproved(model, withChange(middle))) high = middle;
    else low = middle;
  }

  const currentValue = features[feature];
  const targetValue = currentValue + candidate.direction * high;
  const displayDelta =
    candidate.unit === 'percentage points' ? high * 100 : high;
  const formattedDelta =
    candidate.precision === 0
      ? Math.ceil(displayDelta).toString()
      : displayDelta.toFixed(candidate.precision);
  const changeLabel =
    candidate.direction > 0
      ? `Increase ${FEATURE_LABELS[feature].toLowerCase()} by about ${formattedDelta} ${candidate.unit}.`
      : `Reduce ${FEATURE_LABELS[feature].toLowerCase()} by about ${formattedDelta} ${candidate.unit}.`;

  return {
    feature,
    label: FEATURE_LABELS[feature],
    currentValue,
    targetValue,
    change: high,
    changeLabel,
    projectedProbability: predictProbability(model, withChange(high)),
  };
}

export function explainDecision(
  model: LogisticModel,
  features: ApplicantFeatures,
): DecisionAudit {
  const impacts = FEATURE_KEYS.map((feature): Impact => {
    const value = features[feature];
    const standardizedValue = (value - model.means[feature]) / model.scales[feature];
    const coefficient = model.coefficients[feature];
    return {
      feature,
      label: FEATURE_LABELS[feature],
      value,
      standardizedValue,
      coefficient,
      contribution: coefficient * standardizedValue,
      explanation: formatExplanation(feature, value, model.means[feature]),
    };
  });
  const approvalProbability = predictProbability(model, features);
  const approved = approvalProbability >= 0.5;
  const reasons = approved
    ? []
    : impacts
        .filter((impact) => impact.contribution < 0)
        .sort((left, right) => left.contribution - right.contribution)
        .slice(0, 3);
  const actions = approved
    ? []
    : ([
        'credit_score',
        'credit_utilization',
        'foir',
        'loan_to_income',
      ] as const)
        .map((feature) => findAction(model, features, feature))
        .filter((action): action is ImprovementAction => action !== null);

  return {
    approved,
    approvalProbability,
    score: Math.round(approvalProbability * 100),
    threshold: 0.5,
    reasons,
    impacts,
    actions,
    featureList: [...FEATURE_KEYS],
    protectedAttributesUsed: [],
    modelAccuracy: model.accuracy,
    sampleCount: model.samples,
  };
}

export function buildDecisionLetter(
  customerName: string,
  _features: ApplicantFeatures,
  audit: DecisionAudit,
): string {
  const name = customerName.trim() || 'Applicant';
  if (audit.approved) {
    return `Dear ${name},\n\nBased on the information in this synthetic demo, your application is approved. The model estimated a ${audit.score}% likelihood of approval using a 50% decision threshold.\n\nThis is a demonstration only and is not a lending decision or offer.`;
  }

  const reasonText =
    audit.reasons.length > 0
      ? audit.reasons.map((reason) => `• ${reason.explanation}`).join('\n')
      : 'The combined application factors placed the estimated approval likelihood below the demo threshold.';
  const pathText =
    audit.actions.length > 0
      ? audit.actions.map((action) => `• ${action.changeLabel}`).join('\n')
      : 'No single change within the demo’s stated realistic limits would change this result on its own.';

  return `Dear ${name},\n\nWe’re sorry, but this application was not approved in this synthetic demonstration. The estimated approval likelihood was ${audit.score}%, below the 50% demo threshold.\n\nThe main factors that lowered the estimate were:\n${reasonText}\n\nPossible paths to approval (each change is assessed on its own):\n${pathText}\n\nYour existing accounts are not affected by this application outcome.\n\nYou have the right to request a human review of this decision. This demonstration is not a production credit model and should not be used to make real lending decisions.`;
}

export interface CreditBandRate {
  band: string;
  applications: number;
  approvalRate: number;
}

export function getApprovalRatesByCreditBand(
  records: TrainingRecord[],
): CreditBandRate[] {
  const bands = [
    { label: '300–499', min: 300, max: 500 },
    { label: '500–599', min: 500, max: 600 },
    { label: '600–699', min: 600, max: 700 },
    { label: '700–799', min: 700, max: 800 },
    { label: '800–900', min: 800, max: 901 },
  ];

  return bands.map(({ label, min, max }) => {
    const group = records.filter(
      (record) => record.credit_score >= min && record.credit_score < max,
    );
    return {
      band: label,
      applications: group.length,
      approvalRate:
        group.length === 0
          ? 0
          : group.filter((record) => record.approved).length / group.length,
    };
  });
}
