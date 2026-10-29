import { FEATURE_KEYS } from './data.ts';
import type {
  ApplicantFeatures,
  FeatureKey,
  TrainingRecord,
} from './data.ts';

export interface LogisticModel {
  means: Record<FeatureKey, number>;
  scales: Record<FeatureKey, number>;
  coefficients: Record<FeatureKey, number>;
  intercept: number;
  accuracy: number;
  samples: number;
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const exp = Math.exp(-value);
    return 1 / (1 + exp);
  }
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

function standardizedValue(
  model: Pick<LogisticModel, 'means' | 'scales'>,
  feature: FeatureKey,
  value: number,
): number {
  return (value - model.means[feature]) / model.scales[feature];
}

export function trainLogisticRegression(records: TrainingRecord[]): LogisticModel {
  if (records.length < 2) {
    throw new Error('At least two synthetic records are required to train.');
  }

  const means = Object.fromEntries(
    FEATURE_KEYS.map((feature) => [
      feature,
      records.reduce((sum, row) => sum + row[feature], 0) / records.length,
    ]),
  ) as Record<FeatureKey, number>;

  const scales = Object.fromEntries(
    FEATURE_KEYS.map((feature) => {
      const variance =
        records.reduce(
          (sum, row) => sum + (row[feature] - means[feature]) ** 2,
          0,
        ) / records.length;
      return [feature, Math.sqrt(variance) || 1];
    }),
  ) as Record<FeatureKey, number>;

  const coefficients = Object.fromEntries(
    FEATURE_KEYS.map((feature) => [feature, 0]),
  ) as Record<FeatureKey, number>;
  let intercept = 0;
  const learningRate = 0.12;
  const epochs = 520;
  const regularization = 0.0005;

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gradients = Object.fromEntries(
      FEATURE_KEYS.map((feature) => [feature, 0]),
    ) as Record<FeatureKey, number>;
    let interceptGradient = 0;

    for (const row of records) {
      let logit = intercept;
      for (const feature of FEATURE_KEYS) {
        logit +=
          coefficients[feature] *
          standardizedValue({ means, scales }, feature, row[feature]);
      }
      const error = sigmoid(logit) - Number(row.approved);
      interceptGradient += error;
      for (const feature of FEATURE_KEYS) {
        gradients[feature] +=
          error * standardizedValue({ means, scales }, feature, row[feature]);
      }
    }

    const divisor = records.length;
    intercept -= (learningRate * interceptGradient) / divisor;
    for (const feature of FEATURE_KEYS) {
      coefficients[feature] -=
        learningRate *
        (gradients[feature] / divisor +
          (regularization * coefficients[feature]) / divisor);
    }
  }

  const unmeasuredModel = {
    means,
    scales,
    coefficients,
    intercept,
    samples: records.length,
  };
  const correct = records.reduce(
    (sum, row) =>
      sum +
      Number(
        (predictProbability(unmeasuredModel, row) >= 0.5) === row.approved,
      ),
    0,
  );

  return {
    ...unmeasuredModel,
    accuracy: correct / records.length,
  };
}

export function predictProbability(
  model: Pick<LogisticModel, 'means' | 'scales' | 'coefficients' | 'intercept'>,
  features: ApplicantFeatures,
): number {
  let logit = model.intercept;
  for (const feature of FEATURE_KEYS) {
    logit +=
      model.coefficients[feature] *
      standardizedValue(model, feature, features[feature]);
  }
  return sigmoid(logit);
}

export function predictApproved(
  model: Pick<LogisticModel, 'means' | 'scales' | 'coefficients' | 'intercept'>,
  features: ApplicantFeatures,
): boolean {
  return predictProbability(model, features) >= 0.5;
}
