# Stage 11 — Outcome Resolver

## Status
- AUDIT LOCK: ON
- App trade placement: DISABLED / not implemented
- Settlement rule: DOCUMENTED_VERIFIED
- Screen resolver agreement with Quotex: PENDING 30 manually placed demo trades
- Automatic unlock: NEVER

## Official settlement rule
Primary source: Quotex Rules of Trading operations
https://quotex.com/documents/en/Rules_of_Trading_operations_QTX.pdf

Relevant clauses:
- 2.4: conclusion/closing uses the quotation last reflected on the Company server when the relevant request is received.
- 3.4: requests are normally processed in 0–4 seconds; processing can take longer under certain conditions.
- 4.15: charts in the terminal are advisory and do not establish the execution price.
- 5.3: at expiration the platform fixes the current market price and compares it with the contract purchase price.
- 5.4.1: CALL/Above is profitable when expiry price is higher than the target level.
- 5.4.2: PUT/Below is profitable when expiry price is lower than the target level.
- 5.5: equality returns the trade amount.

FAQ corroboration:
https://qxbroker.com/faq
The FAQ describes 1 minute as a selectable expiration period and identifies a zero-price-change outcome as return of the investment.

## Resolver implementation
The app does not place a trade. A user manually places a demo trade and uses the Stage 11 panel to record a same-time screen reference.

At decision reference:
1. capture the current live Quotex frame;
2. run the existing deterministic layout/field verifier;
3. isolate the current-price blue-tag region already excluded from price-axis fitting;
4. OCR the tag with minimum token confidence 70;
5. independently fit price = a*y+b from the accepted price-axis labels;
6. require the tag OCR price to agree with the axis-predicted price within 20% of the median price-label step;
7. record both readings, residual, OCR confidence, cross-check result and source-frame SHA-256;
8. read the 00:01:00 trade duration from the trade panel strictly as expiry duration, never as chart timeframe or UTC clock;
9. record payout at decision time and breakeven = 1/(1+payout).

At +60 seconds:
1. capture a fresh live frame;
2. repeat the price-tag + price-axis cross-check;
3. compute the screen-derived CALL/PUT/TIE result only if entry price, expiry price, 60-second duration and payout were all readable.

Unreadable data produces resolverOutcome=null. It is never guessed or converted into WIN/LOSS.

## Payout and return
Per-unit realized screen-resolver return:
- WIN: +payoutDecimal
- LOSS: -1
- TIE: 0
- null outcome or null payout: null

The full-sample observed expectancy remains null whenever any expired resolver outcome is null. A separate mean over known returns is reported with its coverage/null rate so exclusions cannot be hidden.

## 30-demo validation
Each manually placed demo trade must be labeled with the outcome Quotex actually displays: WIN, LOSS or TIE.

The summary reports:
- total armed
- expired
- resolver-known
- resolver-null
- null/excluded rate and reasons
- manually labeled count
- agreement-eligible count
- agreement rate
- every disagreement with entry/expiry price, payout, confidence and frame reasons
- mean unit return on known outcomes
- full-sample expectancy only when no expired outcomes are null

Current measured agreement: UNKNOWN until >=30 manually placed demo trades are collected.

## Selection bias
Any non-zero null rate triggers an explicit warning. OCR/readability failures could correlate with volatility, overlays, latency or other conditions, so metrics conditioned only on readable outcomes may not represent the full stream.

## Historical backtester
Existing next-candle-close results are retained only as a research proxy and are marked:
NEXT_CANDLE_CLOSE_RESEARCH_PROXY

They are not treated as Quotex settlement outcomes.
