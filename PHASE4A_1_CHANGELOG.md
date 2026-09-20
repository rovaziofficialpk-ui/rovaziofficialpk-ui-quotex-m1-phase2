# Phase 4A.1 — Precision Optimizer

## Goal
Improve precision without manufacturing an 80% statistic through in-sample curve fitting.

## Added
- Chronological 70/30 train/holdout split.
- 432 conservative candidate gate combinations.
- Candidate selection uses training data only.
- Untouched holdout measures the chosen rule.
- Minimum 12 decided training signals and 12 decided holdout signals.
- 80%+ holdout target before a profile can be applied live.
- Wilson 95% lower-bound statistic used in training-rule ranking.
- Pair-specific validated profiles persisted in localStorage.
- Live, manual, and Smart Auto Test signals pass through the validated profile after the existing Phase 3 gates.
- Profile filters: confidence, confirmations, opposing confirmations, chart quality, warning count, and allowed direction.
- Backtest rows retain additional quality/evidence metadata for honest optimization.

Historical 80%+ validation is empirical evidence on the tested sample, not a guarantee of future outcomes.
