# whisp abuse-retention assessment

Status: **product policy approved by Augie Luebbers on 2026-09-21**.
Revision: `2026-09-21.1`. Approval is recorded from the instruction to implement
the recommended approach and the subsequent clarification that it was approved.
This records the controller's product decision, not an independent legal opinion.
Reassess when the audience, risks, or processing changes. Each enforcement decision
still requires its own necessity finding and shortest justified expiry; there is
no universal suspension or post-deletion retention period.

## Purpose and proposed basis

Protect people from recurrence of confirmed serious abuse by preventing a limited
sharing suspension from being evaded through account deletion. Proposed GDPR basis:
Article 6(1)(f), legitimate interests. Google Play's retention exception does not
supply a GDPR lawful basis. Review jurisdiction-specific applicability as part of ongoing privacy operations.

## Necessity

Use account-local blocking and time-limited suspension first when sufficient.
Unreviewed reports, ordinary spam, or merely deleting an account do not justify
retaining an identifier. For a qualifying case, the operator must find a likely
risk of serious abuse on return and why account-local measures and a shorter
period would be insufficient. The structured decision records that finding,
serious-abuse category, applicable policy revision, decision date, and exact expiry.
Do not copy allegations or identity into the record to explain it.

## Balancing and safeguards to validate

Consider teens' vulnerability and heightened privacy interests, reporting mistakes,
the individual's reasonable expectations, the severity and likelihood of harm,
and the impact of limiting sharing. HMAC limits disclosure but still enables
singling out and must be treated as personal data. No cross-service tracking,
profile enrichment, automated guilt inference, or indefinite watchlist.

The restriction permits settings, deletion, reporting, and appeals. Users receive
plain-language disclosure before accepting the policy and before deleting an
account. Human review, case-specific expiry, immediate revocation, dedicated secret
storage, restricted operator access, and automated purge reduce impact. Verify
those controls and the availability of effective review in practice.

## Operational follow-through

- Apply the approved limits above and revisit the balancing test when facts change.
- How reviewers substantiate each serious-abuse category and choose the shortest
  proportionate duration. No arbitrary default period should be introduced.
- Confirmation that the 30-day report review window is necessary and achievable,
  including response times for urgent reports and expired pending reports.
- Staff ownership, training, access reviews, and handling of appeals, Article 17
  erasure requests and Article 21 objections. Continued retention after objection
  requires an individual assessment of applicable grounds, with reasons communicated.
- Provider backup/deletion schedules, analytics and support retention, restoration
  safeguards, monitoring of purge failures, and whether a DPIA is required.
- Accurate public disclosures and jurisdiction-specific requirements for teens.

Sources: [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng), particularly
Articles 5, 6, 17, 21 and 25;
[EDPB rights guidance](https://www.edpb.europa.eu/sme-data-protection-guide/respect-individuals-rights_en);
[Google Play deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en).
