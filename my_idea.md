You are a senior product engineer and product designer helping me build an MVP for a startup idea.

## 1. Product idea

Build a web platform for software developers who want to maintain consistency with DSA/interview preparation.

The core concept:

> A developer creates a DSA commitment challenge, deposits real money, follows a predefined DSA plan/streak, and gets their money back if they successfully complete the commitment.

If they fail according to the challenge rules, a predefined portion of their deposit is forfeited.

The product is NOT positioned as gambling or betting.

It is a personal accountability/commitment mechanism.

The emotional proposition is:

> "I don't need to tell my friends I'm preparing for interviews. I can make a private commitment to myself — and put money behind it."

The initial niche is DSA/interview preparation. Do NOT generalize the product to fitness, reading, AI learning, etc. yet.

---

# 2. MVP goal

The MVP should answer one question:

> Will developers put their own money behind a DSA commitment and consistently complete the challenge?

Do not overbuild.

Prioritize:

1. Creating a commitment
2. Choosing a DSA plan
3. Making a deposit
4. Completing daily work
5. Maintaining a streak
6. Showing progress
7. Handling missed days
8. Showing the amount currently at risk
9. Completing the challenge
10. Showing/refunding the eligible amount

Payment can initially be implemented using a test/sandbox payment flow.

Do NOT build a complicated social network, leaderboard, messaging system, AI tutor, or marketplace in the MVP.

---

# 3. Target user

Primary user:

A software engineer/developer preparing for:

* coding interviews
* job switching
* DSA interviews
* product-company interviews

Typical user:

* knows DSA already
* has solved problems in the past
* repeatedly starts and stops preparation
* feels guilty about inconsistency
* doesn't necessarily want friends/family involved
* wants external accountability
* is willing to put some money at risk to force consistency

The product should feel serious and professional, not like a gamified children's app.

---

# 4. Product positioning

Potential positioning:

"Put money behind your DSA commitment."

Supporting message:

"Private accountability for developers who are serious about getting better."

Possible hero copy:

> Your DSA streak has a price.
>
> Commit money. Show up every day. Get it back when you finish.

CTA:

> Start My Commitment

Secondary CTA:

> See How It Works

Avoid exaggerated claims like:

* "Guaranteed interview success"
* "Get your dream job"
* "Become a FAANG engineer"

We are selling consistency, not interview outcomes.

---

# 5. Tech stack

Use:

Frontend:

* React
* TypeScript
* Vite
* Tailwind CSS
* React Router

Backend:

* Node.js
* Express
* TypeScript

Database:

* MongoDB
* Mongoose

Authentication:

* JWT initially
* Email/password authentication

Payments:

* Razorpay test/sandbox integration architecture
* Keep payment logic isolated behind a payment service so it can later be replaced or extended

State management:

* Keep it simple
* React Query/TanStack Query for server state
* React local state where sufficient

Validation:

* Zod

Charts:

* Recharts if necessary

Testing:

* Vitest
* React Testing Library
* Supertest for backend APIs

Code quality:

* ESLint
* Prettier

---

# 6. Repository structure

Create a clean monorepo:

/client
/server

Client:

client/
src/
components/
pages/
layouts/
hooks/
services/
types/
utils/
routes/
App.tsx
main.tsx

Server:

server/
src/
controllers/
services/
models/
routes/
middleware/
utils/
config/
types/
app.ts
server.ts

Keep business logic out of controllers.

Use:

Route → Controller → Service → Model

---

# 7. Core user flow

Build this exact flow.

## Landing page

User arrives at:

/

Show:

Hero:

"Put money behind your DSA commitment."

Subheading:

"Build your streak privately. Complete your challenge. Get your eligible deposit back."

CTA:

"Start My Commitment"

Secondary:

"How It Works"

Then explain:

1. Choose your commitment
2. Deposit money
3. Solve your daily DSA problems
4. Maintain your streak
5. Finish the challenge
6. Get your eligible money back

Also show an example:

₹1,000 commitment
30 days
3 problems/day

Progress:

18 / 30 days

At risk:

₹400

Potential refund:

₹1,000

Make it clear this is an example, not a promise until the rules are satisfied.

---

# 8. Authentication

Pages:

/login
/register

Registration fields:

* name
* email
* password

After login:

/dashboard

Implement:

POST /api/auth/register
POST /api/auth/login
GET /api/auth/me

Use JWT authentication middleware.

Never store plain-text passwords.

Use bcrypt.

---

# 9. Dashboard

The dashboard is the most important screen.

It should immediately answer:

"What is my commitment status today?"

Example:

Good morning, Shubham.

30-Day DSA Commitment

Day 18 / 30

🔥 17 day streak

Today's commitment:

3 problems

Completed:

2 / 3

Money committed:

₹1,000

Currently protected:

₹600

At risk:

₹400

Potential refund:

₹1,000

CTA:

"Complete Today's Commitment"

Progress calendar:

Day 1 ✓
Day 2 ✓
Day 3 ✓
...
Day 18 ●
Day 19 ○

Use clear visual distinction between:

Completed
Today
Upcoming
Missed

---

# 10. Commitment creation

Route:

/commitment/new

Step 1:

Choose challenge duration:

* 7 days
* 14 days
* 30 days
* 60 days
* 90 days

For MVP, recommend 30 days.

Step 2:

Choose daily workload:

* 1 problem/day
* 2 problems/day
* 3 problems/day
* 5 problems/day

Step 3:

Choose DSA plan:

Initially provide predefined plans:

* NeetCode-style Fundamentals
* Arrays & Hashing
* Two Pointers
* Sliding Window
* Stack
* Binary Search
* Linked List
* Trees
* Heap / Priority Queue
* Backtracking
* Graphs
* Dynamic Programming

For MVP, a plan can simply contain a sequence of problem IDs.

Step 4:

Commitment amount:

₹500
₹1,000
₹2,000
₹5,000

Allow custom amount later, but initially use predefined amounts.

Step 5:

Show commitment summary:

30 days
3 problems/day
90 total problems
Deposit: ₹1,000

Then clearly explain:

"If you complete the challenge according to the rules, your eligible deposit will be returned. If you miss commitments, the applicable forfeiture rules will apply."

CTA:

"Commit ₹1,000"

---

# 11. VERY IMPORTANT: Commitment rules

Do NOT hard-code the financial logic throughout the application.

Create a CommitmentRules service.

Example:

Commitment:

{
durationDays: 30,
dailyTarget: 3,
depositAmount: 1000,
graceDays: 0,
forfeitureMode: "percentage"
}

For MVP, use this simple rule:

Every day must be completed before the daily deadline.

If the user misses a day:

10% of the original commitment becomes forfeited.

Example:

₹1,000 deposit

Miss 1 day:

₹100 forfeited

Miss 2 days:

₹200 forfeited

Maximum forfeiture:

100%

However, make the forfeiture logic configurable.

Do NOT assume this is the final business model.

The code should make it easy to change the rules later.

---

# 12. Daily completion

Route:

/commitment/:id/today

Show today's tasks.

Each problem should contain:

* title
* difficulty
* topic
* external URL
* completion checkbox

Example:

Today's Goal

[ ] Two Sum — Easy
[ ] Valid Anagram — Easy
[ ] Group Anagrams — Medium

Button:

"Mark Today's Commitment Complete"

Do NOT simply allow users to mark an arbitrary number of fake completions without tracking.

For MVP, however, use self-reported completion.

Architecture should later support stronger verification.

---

# 13. Problem model

Create:

Problem

Fields:

_id
title
slug
difficulty
topic
url
source
order
active

Example:

{
title: "Two Sum",
difficulty: "Easy",
topic: "Arrays & Hashing",
url: "...",
source: "LeetCode"
}

Do not copy copyrighted problem statements into our database.

Store metadata and external links.

Seed the database with a small set of representative problems for development.

---

# 14. Daily progress model

Create:

DailyProgress

Fields:

_id
userId
commitmentId
date
requiredProblems
completedProblems
problemCompletions
status
completedAt

Status:

PENDING
COMPLETED
MISSED

Problem completion:

{
problemId,
completedAt
}

Use the user's commitment timezone.

Do not rely only on frontend dates.

The server must determine whether a commitment day is complete.

---

# 15. Commitment model

Create:

Commitment

Fields:

_id
userId
planId
startDate
endDate
durationDays
dailyTarget
depositAmount
currentProtectedAmount
currentForfeitedAmount
status
currentStreak
longestStreak
completedDays
missedDays
rules
createdAt
updatedAt

Status:

PENDING_PAYMENT
ACTIVE
COMPLETED
FAILED
CANCELLED

Rules should be stored as a snapshot.

Example:

rules: {
forfeitureMode: "percentage",
forfeiturePerMissedDay: 10,
graceDays: 0
}

This is important because changing future platform rules must not modify existing commitments.

---

# 16. Money / ledger

Do NOT simply modify:

depositAmount -= 100

Create a ledger.

CommitmentTransaction:

_id
userId
commitmentId
type
amount
status
reference
createdAt

Types:

DEPOSIT
FORFEITURE
REFUND

This gives us an auditable financial history.

Example:

DEPOSIT +1000

FORFEITURE -100

REFUND +900

Never silently mutate financial history.

---

# 17. Payment architecture

Create:

PaymentService

Methods:

createPayment()
verifyPayment()
refundPayment()

Initially use Razorpay test mode.

Backend should verify payment signatures.

Never trust the frontend to tell the server:

"Payment succeeded."

The server must verify payment status.

Create APIs:

POST /api/payments/create
POST /api/payments/verify

Payment records should be stored in the database.

---

# 18. Commitment completion

When the final day is completed:

Run a server-side commitment evaluation.

If all required days are completed:

Commitment status:

COMPLETED

Calculate:

eligibleRefund = depositAmount - totalForfeiture

Show:

"Commitment completed."

"You showed up for 30 days."

"₹900 is eligible for refund."

Then allow:

"Request Refund"

For MVP, refund can be implemented using the payment provider's test API or mocked behind RefundService.

Do not automatically assume every deposit is refundable without evaluating the rules.

---

# 19. Streak calculation

The backend must calculate:

currentStreak
longestStreak

A streak means consecutive completed commitment days.

Example:

Day 1 ✓
Day 2 ✓
Day 3 ✓
Day 4 ✗
Day 5 ✓

Streak:

Day 1-3 = 3
Day 5 = 1

Current streak = 1

Do not calculate financial consequences based solely on the displayed frontend streak.

---

# 20. Notifications

For MVP, implement notification architecture but don't spend excessive time on it.

Create NotificationService.

Future notifications:

* daily reminder
* "You haven't completed today's commitment"
* "2 hours left"
* "You completed today's commitment"
* streak milestone
* challenge completed

Initially implement email notification only if easy.

Otherwise create TODO interfaces for it.

---

# 21. Commitment history

Route:

/history

Show previous commitments.

Example:

30-Day DSA Commitment

Completed
₹1,000 → ₹1,000 returned

30-Day DSA Commitment

Completed with misses
₹1,000 → ₹800 returned

14-Day DSA Commitment

Failed
₹500 → ₹300 forfeited

Make this transparent.

---

# 22. Money transparency screen

Create:

/commitment/:id/ledger

Show:

Original deposit
₹1,000

Forfeited
₹100

Eligible refund
₹900

Transactions:

Sep 1
Deposit
+₹1,000

Sep 12
Missed day
-₹100

Sep 30
Refund
+₹900

This is important for user trust.

---

# 23. Design

Design should feel like:

* Linear
* Vercel
* modern developer SaaS
* serious productivity tool

NOT:

* casino
* gambling website
* flashy crypto website
* childish gamification

Visual direction:

Dark-first interface.

Use:

* black / near-black background
* subtle gray surfaces
* white typography
* restrained accent color
* green for successful completion
* red only for actual risk/loss
* yellow/orange for warnings

Use plenty of whitespace.

Typography should be clean.

Use cards sparingly.

Avoid excessive gradients.

---

# 24. Landing page sections

Build:

1. Navbar

Logo:

"CommitDSA"

Use a placeholder logo/text for now.

Navigation:

How It Works
Challenges
Login

CTA:

Start Commitment

2. Hero

"Your DSA streak has a price."

"Commit money. Show up every day. Get your eligible deposit back when you finish."

CTA.

3. How it works

Commit → Practice → Maintain → Finish

4. Example commitment

₹1,000
30 days
3 problems/day

5. Why this exists

"Most developers don't need another DSA sheet. They need a reason to come back tomorrow."

6. FAQ

Questions:

What happens if I miss a day?
When do I get my money back?
Is this a bet?
Can I stop a commitment?
How is completion verified?
What happens to forfeited money?

7. CTA

"Ready to make your commitment?"

---

# 25. Important product language

Avoid using:

"Bet"

"Win money"

"Earn money"

"Prize"

"Gamble"

Instead use:

"Commitment"

"Deposit"

"Protected amount"

"Forfeited amount"

"Eligible refund"

"Accountability"

"Challenge"

However, make the financial rules completely transparent.

---

# 26. Trust requirements

Because real money is involved, trust is extremely important.

Build:

* clear terms page
* clear refund rules
* transaction history
* commitment rules before payment
* payment confirmation
* no hidden fees
* no changing rules after commitment starts

Before production launch, flag legal/payment/compliance review as a mandatory task.

Do not make claims about legality or regulatory treatment without professional/legal verification.

---

# 27. Anti-cheating architecture

MVP:

Self-reported completion.

But design the system so that future verification can be added.

Potential future verification:

* LeetCode integration
* GitHub activity
* browser extension
* coding editor
* solution submission
* time spent solving
* test execution
* code submission API

Do NOT build these now.

Create an abstraction:

CompletionVerificationService

Methods:

verifyDailyCompletion()
getVerificationStatus()

For MVP:

SelfReportedVerificationService

---

# 28. Admin dashboard

Build a minimal admin page.

Route:

/admin

Show:

Users
Active commitments
Completed commitments
Failed commitments
Total deposits
Total forfeitures
Total refunds

Allow admin to:

* view users
* view commitment
* view transaction ledger
* view daily progress

Do NOT allow arbitrary manual financial modification without an audit log.

---

# 29. API design

Create REST APIs.

Auth:

POST /api/auth/register
POST /api/auth/login
GET /api/auth/me

Problems:

GET /api/problems
GET /api/problems/:id

Plans:

GET /api/plans
GET /api/plans/:id

Commitments:

POST /api/commitments
GET /api/commitments
GET /api/commitments/:id
GET /api/commitments/:id/today
POST /api/commitments/:id/daily-progress
GET /api/commitments/:id/progress
GET /api/commitments/:id/ledger

Payments:

POST /api/payments/create
POST /api/payments/verify
POST /api/payments/:id/refund

Dashboard:

GET /api/dashboard

Admin:

GET /api/admin/dashboard
GET /api/admin/commitments
GET /api/admin/transactions

---

# 30. Security

Implement:

* password hashing
* JWT authentication
* authorization middleware
* user ownership checks
* request validation
* rate limiting
* CORS configuration
* Helmet
* secure environment variables
* payment signature verification
* server-side financial calculations

Never trust:

* deposit amount from frontend
* refund amount from frontend
* completion status from frontend
* user ID from request body
* payment success from frontend

All critical state must be calculated/verified server-side.

---

# 31. Database indexes

Add appropriate indexes.

Examples:

User:
email unique

DailyProgress:
userId + commitmentId + date unique

Commitment:
userId + status

Transaction:
commitmentId + createdAt

Avoid duplicate daily records.

---

# 32. Seed data

Create seed script.

Add:

Users for development.

Plans:

"30 Day DSA Fundamentals"

Topics:

Arrays & Hashing
Two Pointers
Sliding Window
Stack
Binary Search
Linked List
Trees
Heap
Graphs
Dynamic Programming

Add approximately 30-50 problem metadata records.

Use external URLs rather than copying problem descriptions.

---

# 33. Error handling

Create consistent API response format.

Success:

{
"success": true,
"data": {}
}

Error:

{
"success": false,
"error": {
"code": "COMMITMENT_NOT_ACTIVE",
"message": "This commitment is not active."
}
}

Create centralized Express error middleware.

---

# 34. Empty/loading/error states

Every important page needs:

Loading state
Empty state
Error state

Examples:

No active commitment:

"You don't have an active commitment."

CTA:

"Create a Commitment"

Today's work completed:

"You're done for today. Come back tomorrow."

Challenge completed:

"Commitment completed."

---

# 35. Mobile responsive

The product must work well on mobile.

Especially:

Dashboard
Today's challenge
Payment
Progress calendar

Buttons should be easy to tap.

Do not create a desktop-only dashboard.

---

# 36. Product analytics

Create an analytics abstraction.

Track:

landing_page_view
signup
commitment_created
payment_started
payment_completed
challenge_started
daily_task_completed
daily_task_missed
commitment_completed
refund_requested
refund_completed

Initially console/log these events or store them simply.

Architecture should allow PostHog/GA later.

---

# 37. Important product decision

Do NOT build a leaderboard initially.

Do NOT build public profiles initially.

Do NOT build social following initially.

Do NOT make streaks publicly visible.

The core value proposition is:

PRIVATE ACCOUNTABILITY.

---

# 38. UX principle

The dashboard should create a small amount of healthy pressure.

When the user hasn't completed today's work:

"Your commitment is waiting."

"2 of 3 problems completed."

"₹400 currently at risk."

CTA:

"Finish today's commitment"

Do not use manipulative or shame-based messaging.

Avoid:

"You are failing."

"You disappointed yourself."

"Don't be lazy."

Instead:

"You're one problem away from completing today."

---

# 39. Architecture for future expansion

Do not implement these now, but keep architecture extensible:

ChallengeType
CommitmentRules
VerificationService
PaymentService
NotificationService

Future challenge types could theoretically be added without rewriting the core commitment system.

But DSA is the only user-facing challenge type in this MVP.

---

# 40. What NOT to build

Do not build:

* AI DSA tutor
* AI code reviewer
* chat
* social feed
* public leaderboard
* friend challenges
* NFT/crypto
* referral system
* complex gamification
* subscription
* marketplace
* resume builder
* job board
* video courses

The MVP must remain focused.

---

# 41. Development approach

Build in phases.

Phase 1:

Project setup
Authentication
Database
Basic UI

Phase 2:

Problems
Plans
Commitments
Daily progress

Phase 3:

Dashboard
Streak calculation
Financial ledger

Phase 4:

Razorpay sandbox
Payment verification
Refund architecture

Phase 5:

Admin
Analytics
Notifications

Phase 6:

Polish
Responsive UI
Error handling
Tests

---

# 42. Before coding

First inspect the existing repository.

Do NOT blindly overwrite existing files.

Determine:

* existing framework
* package manager
* existing components
* existing environment setup
* existing database configuration
* existing routes

If the repository is empty, initialize the project using the stack above.

If existing code exists, preserve useful code and adapt the architecture.

---

# 43. Important implementation rule

Do not generate the entire application in one giant step.

Work incrementally.

After each phase:

1. Implement
2. Run tests/build
3. Fix errors
4. Review architecture
5. Continue

At the end of each phase, summarize:

* files created
* files changed
* APIs added
* database models added
* remaining work
* commands to run

---

# 44. First task

For now, DO NOT build everything.

Start with:

1. Inspect repository
2. Propose final architecture
3. Create client/server structure
4. Set up TypeScript
5. Set up React + Tailwind
6. Set up Express
7. Set up MongoDB/Mongoose configuration
8. Set up environment variables
9. Set up ESLint/Prettier
10. Create authentication models and APIs
11. Create basic landing page
12. Create login/register pages
13. Create protected dashboard shell

Then stop and report what was completed.

Wait for my instruction before moving to the next phase.

---

# 45. Product quality bar

Think like a startup founding engineer, not a code generator.

Whenever you encounter a product decision that affects:

* money
* trust
* user motivation
* commitment rules
* refunds
* cheating
* streak calculation

stop and explicitly point out the tradeoff instead of silently making a major assumption.

For ordinary implementation decisions, make a sensible engineering decision and continue.

The objective is not to build the most features.

The objective is to build the smallest credible product that can test whether:

> "Developers are willing to put real money behind their private DSA commitment."

Start by inspecting the repository and proposing the architecture.
