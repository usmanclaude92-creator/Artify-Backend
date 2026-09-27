# Notifications Architecture — Phase 11

Wires the `Notification`/`NotificationPreference` Prisma models (present in the schema since an earlier phase,
but with zero service/route/repository behind them — confirmed by `control-center-gap-analysis.md`'s audit)
to a real, self-scoped API and a bell in the Control Center header.

## IN_APP only

`NotificationChannel` models `EMAIL`/`IN_APP`/`SMS`, but this phase only ever writes `IN_APP` notifications
(implicitly — the `Notification` row itself has no `channel` column; that's `NotificationPreference`'s job,
for a future dispatcher). There is no mailer, no SES/SendGrid/Twilio integration anywhere in this codebase —
`server/services/notificationService.ts`'s header comment states this explicitly so a future contributor
doesn't assume email delivery exists just because the enum has an `EMAIL` value. `NotificationPreference` stays
modeled and reachable at the schema level but nothing reads or writes it yet — there's no channel to prefer
between when only one is real.

## Self-scoped, no RBAC permission

`GET/POST /api/v1/notifications/*` (`server/routes/v1/notificationRoutes.ts`) carries no `requirePermission` —
reading or acknowledging your own notifications needs only a valid session, the same convention `/auth/me`
already uses. Every query is scoped server-side to `req.user!.id` + `req.user!.organizationId`; no endpoint
accepts a caller-supplied `userId`. `tests/integration/notifications.test.ts` proves both the cross-user and
cross-organization cases return 404/empty, never another user's notification.

## Emission points

`notificationService.notify()` is an internal, best-effort helper (catches and swallows its own errors —
failing to write a notification must never fail the business operation that triggered it) called directly
from existing services, not a public "create notification" endpoint:

- `leadService.createLead`/`updateLead` — assignee notified when a lead is (re-)assigned to them, skipped
  when the actor assigns it to themselves.
- `opportunityService.createOpportunity` — assignee notified on assignment.
- `opportunityService.winOpportunity`/`loseOpportunity` — assignee and creator notified (deduped, excluding
  whoever performed the close) via the shared `notifyClose()` helper.
- `postService.publishPost`/`pageService.publishPage` — the content's original author notified when someone
  else publishes it (skipped if the author published their own content).

These five are deliberately the emission points with a single, unambiguous recipient already on the record
(`assignedTo`/`createdById`) — a "notify everyone who holds `content.publish`" fan-out (e.g. for "submitted for
review") would need a new repository method to look up users by permission and was left out of this phase's
scope rather than half-built.

## Frontend

`src/components/layout/NotificationBell.tsx` — polls `GET /notifications/unread-count` every 60s (one indexed
`COUNT` query), fetches the actual list only when the dropdown opens. Mark-read is optimistic (updates local
state immediately, matching the pattern already used elsewhere in the Control Center for this kind of
low-stakes action). No "open the related record" link: the `Notification` model itself has no
`resourceType`/`resourceId` column, so a notification can be marked read but not deep-linked — an honest
limitation, not silently faked with a guessed URL.

## Known gaps

- No fan-out-by-permission notifications (e.g. "content submitted for review" notifying every user who can
  publish) — would need a new "find users with permission X in this org" repository method.
- `NotificationPreference` is modeled but unused — there's nothing to prefer between with only one real
  channel.
- No deep link from a notification back to the record it's about (see above).
