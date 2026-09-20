import type { TradeSignal } from '../signalLogic';

export const AUDIT_CONFIG_VERSION = 'audit-v1.0.0';
export const EDGE_PROOF_STATUS = 'UNPROVEN' as const;

export function applyAuditEdgeGate(signal: TradeSignal): TradeSignal {
  if (signal.bias === 'NEUTRAL') return signal;

  return {
    ...signal,
    bias: 'NEUTRAL',
    gateReason: 'Audit lock: no clean payout-aware Quotex holdout has yet shown a Wilson 95% lower win-rate bound above breakeven.',
    entry: 'No directional output. Research proposal logged, but live output remains NEUTRAL until payout-aware validation passes.',
  };
}
