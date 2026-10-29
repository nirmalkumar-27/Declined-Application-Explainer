export const FEATURE_KEYS = [
  'credit_score',
  'foir',
  'loan_to_income',
  'employment_years',
  'missed_payments_12m',
  'credit_utilization',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export interface ApplicantFeatures {
  credit_score: number;
  foir: number;
  loan_to_income: number;
  employment_years: number;
  missed_payments_12m: number;
  credit_utilization: number;
}

export interface TrainingRecord extends ApplicantFeatures {
  approved: boolean;
}

export const SAMPLE_APPLICANTS: Record<string, ApplicantFeatures> = {
  'Strong applicant': {
    credit_score: 760,
    foir: 0.22,
    loan_to_income: 1.4,
    employment_years: 8,
    missed_payments_12m: 0,
    credit_utilization: 0.18,
  },
  'High card usage': {
    credit_score: 620,
    foir: 0.45,
    loan_to_income: 3,
    employment_years: 5,
    missed_payments_12m: 2,
    credit_utilization: 0.92,
  },
  'Over-stretched': {
    credit_score: 630,
    foir: 0.74,
    loan_to_income: 4.8,
    employment_years: 3,
    missed_payments_12m: 1,
    credit_utilization: 0.66,
  },
  'Missed payments': {
    credit_score: 570,
    foir: 0.5,
    loan_to_income: 3.2,
    employment_years: 2,
    missed_payments_12m: 7,
    credit_utilization: 0.72,
  },
};

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const exp = Math.exp(-value);
    return 1 / (1 + exp);
  }
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

export function generateDataset(
  count = 6000,
  seed = 2026,
): TrainingRecord[] {
  const random = createRandom(seed);

  return Array.from({ length: count }, () => {
    const applicant: ApplicantFeatures = {
      credit_score: 300 + random() * 600,
      foir: 0.05 + random() * 0.85,
      loan_to_income: 0.3 + random() * 5.7,
      employment_years: random() * 30,
      missed_payments_12m: Math.floor(random() * 9),
      credit_utilization: random(),
    };

    // This latent rule makes the training labels reproducible and explainable.
    // Randomized outcomes around its sigmoid keep the synthetic exercise noisy.
    const latent =
      0.95 * ((applicant.credit_score - 600) / 100) -
      1.1 * ((applicant.foir - 0.475) / 0.2) -
      0.62 * ((applicant.loan_to_income - 3.15) / 1.35) +
      0.24 * ((applicant.employment_years - 15) / 8.5) -
      0.82 * ((applicant.missed_payments_12m - 4) / 2.6) -
      0.72 * ((applicant.credit_utilization - 0.5) / 0.3) -
      0.08;
    const approvalChance = sigmoid(latent * 1.9);

    return {
      ...applicant,
      approved: random() < approvalChance,
    };
  });
}
