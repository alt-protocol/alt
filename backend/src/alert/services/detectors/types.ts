/** A detected condition before user matching. */
export interface AlertCondition {
  /** Rule slug from alert.rules. */
  ruleSlug: string;
  /** Unique entity identifier, e.g. 'opp:42' or 'token:USDC'. */
  entityKey: string;
  /** Short title for notification. */
  title: string;
  /** Longer body text. */
  body: string;
  /** Structured data for the event. */
  metadata: Record<string, unknown>;
  /** The detected numeric value (compared against user threshold). */
  detectedValue: number;
}
