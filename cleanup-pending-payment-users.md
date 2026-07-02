# Pending Payment User Cleanup

Use this as a manual Firestore cleanup checklist for existing unpaid/freebie
accounts.

Target users in `users` where any of the following is true:

- `hasSubscription` is not `true`
- `subscriptionStatus` is not `"active"`
- `membershipStatus` is `"pending"`
- `subscriptionStatus` is `"pending-payment"`

Do not change admin or super_admin accounts.

For each unpaid user, set:

```json
{
  "accountType": "lead",
  "membershipStatus": "not_paid",
  "hasSubscription": false,
  "subscriptionStatus": "pending-payment"
}
```

Leave Stripe IDs, email, name, and profile history in place for auditability.
Do not delete documents unless you intentionally want to remove the profile
record.
