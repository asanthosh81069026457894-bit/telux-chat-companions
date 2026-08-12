// Plan literal — kept in its own file so serverFns and client modules can
// import it without dragging in the localStorage-backed usage store.
//
// Tiers (revamped launch spec):
//   - "starter" — Free plan. 50 pages total, up to 10 docs. No voice.
//   - "personal" — ₹299/mo or ₹2,870/yr. 200 pages, 10 docs, single-doc chat,
//                  full Talk-with-Document with male/female voice picker.
//   - "pro" — ₹749/mo or ₹7,190/yr. 1,000+ pages, 30 docs, multi-document
//             simultaneous chat, priority voice response. Yearly Pro is
//             truly unlimited (no page cap).
//
// Trial: every fresh sign-up gets a 3-day Pro-level trial (effectivePlan =
// "pro" while trial_ends_at > now()). After 3 days the user drops back to
// "starter" unless they subscribed via Razorpay.

export type Plan = "starter" | "personal" | "pro";

// Billing cycle. "monthly" is the default; "yearly" gets a discount on every
// paid plan and is what Razorpay subscribes users to via the yearly button.
export type BillingCycle = "monthly" | "yearly";

export const YEARLY_DISCOUNT_PERCENT = 20; // 20% off the monthly total.
