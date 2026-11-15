// WebACL rules (no imports, so it can be unit-checked and validated with `wafv2 check-capacity`).
const vis = (MetricName) => ({
  SampledRequestsEnabled: true,
  CloudWatchMetricsEnabled: true,
  MetricName,
});
const managed = (Name, Priority, prefix) => ({
  Name,
  Priority,
  Statement: { ManagedRuleGroupStatement: { VendorName: 'AWS', Name } },
  OverrideAction: { None: {} },
  VisibilityConfig: vis(`${prefix}-${Name}`),
});

export function spec({ RateLimit, MetricPrefix: p }) {
  return {
    DefaultAction: { Allow: {} },
    VisibilityConfig: vis(p),
    Rules: [
      {
        // Per-IP flood protection on the API path (static assets are CDN-cached).
        Name: 'RateLimitPerIp',
        Priority: 0,
        Action: { Block: {} },
        Statement: {
          RateBasedStatement: {
            Limit: Number(RateLimit),
            EvaluationWindowSec: 300,
            AggregateKeyType: 'IP',
            ScopeDownStatement: {
              ByteMatchStatement: {
                FieldToMatch: { UriPath: {} },
                PositionalConstraint: 'STARTS_WITH',
                SearchString: new TextEncoder().encode('/api/'),
                TextTransformations: [{ Priority: 0, Type: 'NONE' }],
              },
            },
          },
        },
        VisibilityConfig: vis(`${p}-RateLimitPerIp`),
      },
      managed('AWSManagedRulesCommonRuleSet', 1, p),
      managed('AWSManagedRulesKnownBadInputsRuleSet', 2, p),
    ],
  };
}
