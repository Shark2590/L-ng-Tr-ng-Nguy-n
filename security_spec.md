# Firebase Security Specification

## Data Invariants
1. A user can only modify their own profile, except for referral balance updates (handled by relational synchronization if possible, but here we allow restricted updates).
2. Users can only join games that are in 'waiting' status.
3. Players can only update their own game progress (current_number, found_numbers, hints_used).
4. Invitations can only be created by the sender and responded to by the recipient.
5. All IDs must be valid alphanumeric strings.
6. Terminal states (status: 'finished') are immutable for non-admin users.

## The "Dirty Dozen" Payloads

1. **Identity Spoofing (User Profile):** User A trying to update User B's balance.
2. **State Shortcutting (Game):** Player A setting their `current_number` to 101 when they are at 1.
3. **Privilege Escalation (Game):** Player B joining a game where `player2` is already set.
4. **ID Poisoning (Invitation):** Creating an invitation with a 1MB string as `roomId`.
5. **Unauthorized Read (Users):** Reading another user's `phone` number without being an admin.
6. **Shadow Field Injection (User):** Injecting `isAdmin: true` into a user document update.
7. **Relational Sync Break (Invitation):** Creating an invitation to a non-existent user.
8. **Immutable Field Break (Game):** Changing `createdAt` after the game has started.
9. **Terminal State Lock Break (Game):** Updating a game that is already `finished`.
10. **Query Enforcer Gap (Invitations):** Trying to list all invitations regardless of `toId`.
11. **Sync Vulnerability (Game Join):** Joining a game without incrementing a participant count if applicable (not used here, but joining should be atomic).
12. **PII Leak:** An authenticated user listing all users to scrape emails (if emails were stored).

## Test Runner (Security Rules Verification Plan)

We will verify:
- `create` on `/users/{userId}`: Must be owner, strict keys.
- `update` on `/users/{userId}`: Must be owner or valid referrer update, strict keys for certain actions.
- `list` on `/users/{userId}`: Restricted to public fields or owner.
- `create` on `/games/{gameId}`: Must be signed in, valid schema.
- `update` on `/games/{gameId}`: Must be a player, valid state transition, `affectedKeys().hasOnly()`.
- `create` on `/invitations/{id}`: `fromId` must be `request.auth.uid`.
- `list` on `/invitations`: `resource.data.toId == request.auth.uid`.
