# Implement LeetCode Completion Verification MVP

## Context

We are building a DSA accountability platform.

The user creates a commitment such as:

* 7 days
* 1 problem/day
* ₹500 deposit

Each day, the user must complete the assigned DSA problem.

For now, **do NOT build Judge0 or an in-house code execution system**.

Instead, users solve problems on LeetCode.

The workflow should be:

```text
Our Platform
    ↓
User sees today's assigned problem
    ↓
User clicks "Solve on LeetCode"
    ↓
LeetCode problem page opens
    ↓
User solves/submits the problem on LeetCode
    ↓
Our backend checks for an Accepted submission
    ↓
If matching problem + valid timestamp → VERIFIED
    ↓
Today's attendance = COMPLETED
```

The product does NOT need to prove that the user literally clicked our LeetCode link.

The verification rule is:

```text
Correct user
+
Correct problem
+
Accepted LeetCode submission
+
Submission inside commitment window
=
Daily commitment completed
```

---

# Important constraints

## 1. Do NOT build Judge0 now

Do not add:

* Judge0
* code execution infrastructure
* sandbox
* compiler
* test runner
* custom code editor

Keep the architecture ready for a future native judge.

---

# 2. Preserve the verification abstraction

First inspect the existing codebase.

There is already a verification abstraction/service, expected around:

```text
server/src/services/completionVerification.service.ts
```

Do NOT replace the abstraction with LeetCode-specific logic everywhere.

Instead implement:

```text
CompletionVerificationService
        ↓
LeetCodeVerificationProvider
```

The goal is to eventually support:

```text
CompletionVerificationService
        ↓
 ┌───────────────────────┐
 │                       │
LeetCode              NativeJudge
Provider              Provider
```

The rest of the application should not care which provider verified the completion.

---

# 3. LeetCode username

Users need to provide their LeetCode username.

Add this to the appropriate user/profile model:

```ts
leetcodeUsername?: string;
```

Do not ask for or store:

* LeetCode password
* session cookie
* authentication token
* browser credentials

The user only connects their public LeetCode username.

Add an appropriate UI in the profile/settings area:

```text
LeetCode Account

Username
[ shubham123              ]

[ Save & Verify ]
```

After saving:

```text
✓ LeetCode username connected
```

If the username cannot be verified/retrieved:

```text
We couldn't verify this LeetCode username.
Please check the username and try again.
```

---

# 4. Problem model

Inspect the existing Problem model.

Each LeetCode problem should have a stable LeetCode identifier.

Prefer:

```ts
leetcodeSlug?: string;
leetcodeUrl?: string;
```

Example:

```ts
{
  title: "Two Sum",
  leetcodeSlug: "two-sum",
  leetcodeUrl: "https://leetcode.com/problems/two-sum/"
}
```

Use `leetcodeSlug` as the primary matching key.

Do NOT match problems only by title.

For example:

```text
Two Sum
```

is less reliable than:

```text
two-sum
```

---

# 5. Verification states

Use explicit verification states.

At minimum:

```ts
type VerificationStatus =
  | "NOT_STARTED"
  | "PENDING"
  | "VERIFIED"
  | "FAILED"
  | "DISPUTED";
```

Daily progress should support:

```text
NOT_STARTED
    ↓
PENDING
    ↓
VERIFIED
```

If something goes wrong:

```text
PENDING → FAILED
```

If the user disputes the result:

```text
FAILED → DISPUTED
```

Do not automatically mark a user as failed merely because LeetCode could not be reached.

If the verification provider is temporarily unavailable:

```text
PENDING
```

and retry later.

---

# 6. Verification result

Create or extend a verification result structure.

Example:

```ts
interface VerificationResult {
  status: "VERIFIED" | "PENDING" | "FAILED";
  source: "leetcode" | "native";
  problemId: string;
  externalProblemId?: string;
  completedAt?: Date;
  evidence?: {
    submissionId?: string;
    title?: string;
    titleSlug?: string;
    timestamp?: number;
  };
  reason?: string;
}
```

Do not expose unnecessary raw provider data to the frontend.

---

# 7. LeetCode verification provider

Create:

```text
server/src/services/providers/leetcodeVerification.provider.ts
```

or use the project's existing provider structure if one already exists.

The provider should have a clean interface such as:

```ts
interface CompletionVerificationProvider {
  verifyCompletion(input: {
    username: string;
    problemSlug: string;
    windowStart: Date;
    windowEnd: Date;
  }): Promise<VerificationResult>;
}
```

Implementation:

```text
username
+
problemSlug
+
time window
        ↓
fetch recent LeetCode submissions
        ↓
find matching problem slug
        ↓
find Accepted submission
        ↓
check timestamp
        ↓
return VERIFIED / PENDING / FAILED
```

---

# 8. LeetCode submission lookup

For the MVP, investigate the currently available public LeetCode submission data endpoint/mechanism before implementing it.

IMPORTANT:

Do not blindly assume an unofficial endpoint is a stable or officially supported API.

Put all LeetCode-specific communication behind:

```text
LeetCodeClient
```

For example:

```text
server/src/integrations/leetcode/leetcode.client.ts
```

The rest of the application should never directly call LeetCode.

Interface:

```ts
interface LeetCodeClient {
  getRecentSubmissions(
    username: string
  ): Promise<LeetCodeSubmission[]>;
}
```

Model:

```ts
interface LeetCodeSubmission {
  id?: string;
  title: string;
  titleSlug: string;
  statusDisplay: string;
  timestamp: number;
  language?: string;
}
```

Only treat:

```text
statusDisplay === "Accepted"
```

as successful completion.

Keep the client isolated so that if LeetCode changes its endpoint later, only this integration needs to change.

---

# 9. Matching logic

The matching algorithm should be:

```text
1. Get user's LeetCode username.

2. Get today's assigned problem.

3. Get problem.leetcodeSlug.

4. Fetch recent LeetCode submissions.

5. Filter submissions where:
   titleSlug === problem.leetcodeSlug

6. Filter submissions where:
   statusDisplay === "Accepted"

7. Filter submissions whose timestamp is inside:
   commitment/day start
   commitment/day end

8. If matching submission exists:
      VERIFIED

9. If no matching submission exists:
      PENDING or NOT_VERIFIED depending on context.
```

Do not use title matching if `titleSlug` is available.

---

# 10. Time handling

This is important.

Do not rely on server local time.

Store timestamps in UTC.

Commitment/day boundaries should be calculated using the user's configured timezone.

If the application already has a timezone system, reuse it.

Otherwise add:

```ts
timezone?: string;
```

to the user model.

Example:

```text
Asia/Kolkata
```

For a daily commitment:

```text
September 19
00:00 Asia/Kolkata
        ↓
September 19
23:59:59 Asia/Kolkata
```

Convert the window appropriately when querying submission timestamps.

Avoid off-by-one-day bugs.

---

# 11. Prevent duplicate completion

If the user submits the same problem multiple times:

```text
Wrong
Wrong
Wrong
Accepted
Accepted
```

only one completion should be recorded.

Use the first valid Accepted submission as the evidence.

Daily progress should become:

```text
COMPLETED
```

and remain completed.

Repeated verification should be idempotent.

---

# 12. Store verification evidence

When verification succeeds, persist enough evidence to audit the decision.

Example:

```ts
{
  source: "leetcode",
  status: "VERIFIED",
  problemId: "...",
  externalProblemId: "two-sum",
  completedAt: "...",
  evidence: {
    submissionId: "...",
    title: "Two Sum",
    titleSlug: "two-sum",
    timestamp: 1789823412
  }
}
```

Do not store unnecessary personal/private information.

---

# 13. Daily attendance

Connect verification to the existing DailyProgress/attendance system.

The important rule:

```text
LeetCode VERIFIED
        ↓
DailyProgress.status = COMPLETED
        ↓
completedAt = verification timestamp
        ↓
Commitment.completedDays += 1
```

Do NOT allow the frontend to directly set:

```text
COMPLETED
```

The backend must determine this.

---

# 14. Commitment rules

Do not change the existing commitment eligibility rules.

If the current product already prevents commitments where:

```text
availableProblems < durationDays × dailyTarget
```

keep that behavior.

Verification should operate on the problems already assigned to the commitment.

Do not let verification choose arbitrary problems.

For example:

```text
Today's assigned problem:
Two Sum

User solves:
Valid Parentheses

Result:
NOT COMPLETED
```

Even if Valid Parentheses is also present in our problem database.

The user must complete the assigned problem.

---

# 15. API endpoints

Inspect existing API conventions first.

Add only what is necessary.

Potential endpoints:

```http
PUT /api/users/me/leetcode
```

Connect/update username.

```http
POST /api/commitments/:commitmentId/verify-today
```

Manually trigger verification.

Response:

```json
{
  "status": "VERIFIED",
  "problem": {
    "title": "Two Sum",
    "slug": "two-sum"
  },
  "completedAt": "..."
}
```

Also consider:

```http
GET /api/commitments/:commitmentId/today
```

returning:

```json
{
  "problem": {...},
  "status": "VERIFIED",
  "verificationSource": "leetcode"
}
```

Follow existing project naming conventions rather than blindly creating these exact routes.

---

# 16. Automatic verification worker

The user should not have to constantly press:

```text
Check my submission
```

Implement a backend verification job using the project's existing job/worker architecture if one exists.

If there is no job infrastructure yet, create a simple service abstraction that can later be connected to BullMQ/Redis.

Conceptually:

```text
Every few minutes
        ↓
Find active commitments
        ↓
Find today's incomplete commitments
        ↓
Find users with LeetCode username
        ↓
Verify today's assigned problem
        ↓
If Accepted
        ↓
Mark completed
```

Do not hammer LeetCode.

Use:

* reasonable polling interval
* batching where possible
* caching
* retry/backoff
* rate limiting

The exact polling interval should be configurable.

Example:

```env
LEETCODE_VERIFICATION_INTERVAL_MINUTES=5
```

---

# 17. Manual verification

Also provide:

```text
[ Check Submission ]
```

on the daily commitment UI.

Example states:

```text
Waiting for submission...

[ Check Submission ]
```

After successful verification:

```text
✓ Completed
Accepted on LeetCode at 6:42 PM
```

If no submission is found:

```text
No accepted submission found yet.

Make sure you solved today's assigned problem
using your connected LeetCode account.

[ Check Again ]
```

If provider is unavailable:

```text
Verification temporarily unavailable.

Your commitment has NOT been marked as missed.
We'll retry automatically.
```

This last case is extremely important because money is involved.

---

# 18. UI changes

On the challenge/day page, show:

```text
TODAY

Day 3 of 7

Two Sum
Easy
Arrays · Hash Map

[ Solve on LeetCode ↗ ]

Verification
○ Waiting for accepted submission

[ Check Submission ]
```

After completion:

```text
TODAY

Day 3 of 7

✓ Two Sum
Easy
Arrays · Hash Map

✓ COMPLETED

Accepted on LeetCode
6:42 PM

Today's attendance
1 / 1
```

Do not add XP, coins, badges, leaderboards, or gamified elements.

Keep the existing developer/terminal/HUD-inspired visual direction.

---

# 19. Solve link

The button should open:

```text
problem.leetcodeUrl
```

Prefer opening in a new tab.

Example:

```tsx
<a
  href={problem.leetcodeUrl}
  target="_blank"
  rel="noopener noreferrer"
>
  Solve on LeetCode ↗
</a>
```

Do not attempt to inject anything into LeetCode.

Do not require a browser extension.

Do not automate actions on LeetCode.

---

# 20. Security

Never trust the frontend for:

* userId
* problemId
* commitmentId
* completion status
* completedAt
* deposit amount
* refund amount

The backend must derive these values from authenticated user + commitment data.

For example, do NOT accept:

```json
{
  "completed": true
}
```

from the frontend and mark attendance.

Instead:

```text
Frontend asks:
"Verify today's submission"

Backend:
→ identifies authenticated user
→ identifies active commitment
→ identifies today's assigned problem
→ checks LeetCode
→ determines result
→ updates DailyProgress
```

---

# 21. Money logic

Do NOT implement or modify refund/forfeiture logic as part of this task unless the existing code requires the completion event.

Verification should only produce:

```text
TODAY = VERIFIED
```

The existing commitment/financial engine should consume the verified completion.

Do not allow:

```text
LeetCode unavailable
        ↓
money forfeited
```

Instead:

```text
LeetCode unavailable
        ↓
PENDING
        ↓
retry
```

---

# 22. Logging

Add structured logs for verification.

Example:

```text
[LeetCodeVerification]
user=123
commitment=456
problem=two-sum
status=VERIFIED
submission=789
```

For failures:

```text
[LeetCodeVerification]
user=123
commitment=456
problem=two-sum
status=PENDING
reason=provider_unavailable
```

Do not log passwords, cookies, authentication tokens, or sensitive data.

---

# 23. Testing

Add tests for at least:

### Case 1 — Accepted submission

```text
Problem: two-sum
Submission: two-sum
Status: Accepted
Timestamp: today

→ VERIFIED
```

### Case 2 — Wrong problem

```text
Required: two-sum
Submitted: valid-parentheses
Status: Accepted

→ NOT VERIFIED
```

### Case 3 — Wrong status

```text
Required: two-sum
Status: Wrong Answer

→ NOT VERIFIED
```

### Case 4 — Old submission

```text
Accepted two-sum
Timestamp: yesterday

→ NOT VERIFIED
```

### Case 5 — Multiple submissions

```text
Wrong
Wrong
Accepted
Accepted

→ VERIFIED
→ one completion only
```

### Case 6 — Provider failure

```text
LeetCode unavailable

→ PENDING
→ no attendance failure
→ no financial penalty
```

### Case 7 — No LeetCode username

```text
leetcodeUsername = null

→ NOT_VERIFIABLE / PENDING
→ clear UI message
```

### Case 8 — Duplicate verification

Run verification twice.

Result:

```text
first call  → VERIFIED
second call → VERIFIED
```

but:

```text
completedDays
```

must not increment twice.

---

# 24. Environment variables

Inspect existing environment conventions.

If needed, add configuration such as:

```env
LEETCODE_VERIFICATION_ENABLED=true
LEETCODE_VERIFICATION_INTERVAL_MINUTES=5
```

Do not put LeetCode credentials in environment variables because the MVP should not require user credentials.

Keep all provider-specific configuration centralized.

---

# 25. Architecture goal

The final architecture should look approximately like:

```text
                    USER
                      │
                      ▼
              Today's Problem
                      │
                      ▼
             Solve on LeetCode
                      │
                      ▼
                 LeetCode
                      │
                      │
              Accepted submission
                      │
                      ▼
             LeetCodeClient
                      │
                      ▼
       LeetCodeVerificationProvider
                      │
                      ▼
       CompletionVerificationService
                      │
                      ▼
              DailyProgress
                      │
                      ▼
                 COMPLETED
                      │
                      ▼
              Commitment Engine
```

Future:

```text
CompletionVerificationService
          │
     ┌────┴─────┐
     ▼          ▼
 LeetCode     NativeJudge
 Provider     Provider
```

---

# 26. Important product principle

Do not overbuild this.

The purpose of this implementation is to validate:

1. Will developers create DSA commitments?
2. Will they deposit money?
3. Will they actually return every day?
4. Does automatic verification reduce friction?
5. Does verified attendance make the commitment feel trustworthy?

Do NOT spend time building a full coding platform yet.

---

# 27. Implementation process

Before changing code:

### Step 1

Inspect the repository.

Identify:

* User model
* Problem model
* Commitment model
* DailyProgress model
* existing verification service
* authentication
* API conventions
* frontend challenge page
* existing worker/job infrastructure
* existing tests

### Step 2

Report the relevant existing architecture.

### Step 3

Propose the smallest set of file changes.

### Step 4

Implement the LeetCode integration.

### Step 5

Implement verification.

### Step 6

Connect verification to daily attendance.

### Step 7

Add UI.

### Step 8

Add tests.

### Step 9

Run:

```bash
npm run typecheck
npm run lint
npm test
```

or the project's equivalent commands.

Fix all errors.

Do not refactor unrelated parts of the application.

---

# Definition of Done

The feature is complete when this works end-to-end:

```text
User logs in
      ↓
Connects LeetCode username
      ↓
Starts commitment
      ↓
Sees today's assigned problem
      ↓
Clicks "Solve on LeetCode"
      ↓
Solves/submits on LeetCode
      ↓
Backend detects Accepted submission
      ↓
Correct problem + correct time window
      ↓
DailyProgress = COMPLETED
      ↓
Attendance = PRESENT
      ↓
Commitment streak updates
```

And importantly:

```text
LeetCode unavailable
      ↓
PENDING
      ↓
retry
      ↓
NO automatic financial penalty
```

Keep the implementation modular because **LeetCode verification is an MVP provider, not the permanent verification infrastructure**.
