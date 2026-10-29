# Declined Application Explainer

A hackathon demonstration for Exathon 2026, Track 01: Money, Risk & Regulation. It shows how a declined loan application can be explained in plain language, what single realistic changes might flip a demo decision, and how the decision can be inspected.

## Problem

Customers often receive a one-line loan rejection with no useful explanation. This demo connects an interpretable synthetic model to customer-facing reasons and a structured audit trail. It is not a lending product or a production credit model.

## Approach

- Generate 6,000 reproducible, synthetic applications using only credit score, FOIR, loan-to-income ratio, employment years, missed payments in the last 12 months, and credit utilization.
- Create noisy approval labels from a logistic function, standardize the features, and fit a logistic regression with a 0.5 approval threshold.
- Explain declines using the three most negative coefficient-times-standardized-value contributions relative to the synthetic training average.
- Search for the smallest individual change that flips the decision for credit score, utilization, FOIR, and loan-to-income ratio, within the stated limits.
- Show the letter and structured facts together. The Fairness check reports that protected attributes are not used and displays approval rates by credit-score band.

## Guardrails

- No age, gender, religion, caste, pincode, or marital status is generated or used by the model.
- The deterministic letter uses only precomputed model facts. Decline letters state that existing accounts are unaffected and that the customer can request human review.
- Employment years and missed payments are never suggested as quick actions.
- All displayed applications and outcomes are synthetic. Do not use this app to make real lending decisions.
- Template wording is the default and the demo works without an API key. If `ANTHROPIC_API_KEY` is configured as a Replit Secret and the user enables Claude wording, the current letter is sent to Anthropic for wording only. The server requires the exact reason/action/review/account facts and all numbers to remain unchanged; failures return the template.

## Run

Open the app in Replit, or use the configured Run workflow. To run the model checks:

```sh
pnpm --filter @workspace/declined-explainer run test
```

To typecheck the app:

```sh
pnpm --filter @workspace/declined-explainer run typecheck
```

Optional Claude wording requires the `ANTHROPIC_API_KEY` Replit Secret for the API server. The key is read only on the server and is never sent to the browser.
