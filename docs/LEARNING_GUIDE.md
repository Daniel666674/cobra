# Learning Guide: How Cobra (and CRMs like it) Work

Welcome. This document exists so you can go from "I know how to code" to
"I understand this system well enough to maintain it and keep it secure."
It uses **this repository** as the running example, because reading real,
working code beats reading abstract theory. By the end you should be able
to trace a request from a client's WhatsApp message all the way to a
database update, and understand *why* each security control exists.

Read this top to bottom once, then come back to individual sections as
reference while you work through the codebase hands-on.

---

## 1. What kind of system is this?

**Cobra** (`server/`) is a *debt-recovery operating system* — in plain
terms, a **CRM**: a backend that stores information about clients and
their accounts (here: credit installments, "cuotas"), and automates the
communication and business logic around them (reminders, overdue notices,
AI calls, payment links, invoicing).

Every CRM/"centralized tool," no matter the industry, is built from the
same handful of ingredients:

| Ingredient | What it does | Where it lives here |
|---|---|---|
| A database | Single source of truth for clients, transactions, history | MySQL, `server/src/db/` |
| An API server | Exposes that data safely over HTTP | Express app, `server/src/app.js` |
| Business logic / jobs | Rules that run automatically (escalation, reminders) | `server/src/jobs/escalation.js` |
| Integration adapters | Talk to outside services (messaging, payments, invoicing, calls) | `server/src/lib/*.js` |
| Auth & access control | Who can see/do what | `server/src/middleware/auth.js` |
| A frontend | Where humans view/operate the system | *not built yet* — see §6 |

Once you can name these six pieces in *any* CRM you're handed, you can
orient yourself quickly. That's the real skill.

---

## 2. The stack, piece by piece

### 2.1 Node.js — the runtime

Node.js lets us run JavaScript outside a browser, as a long-lived server
process. `server/src/app.js` is the entry point: it boots an HTTP server,
connects to MySQL, and starts a background cron job. Read it start to
finish — it's short and every line matters:

```js
// server/src/app.js
app.use(helmet());                 // security headers
app.use(cors({ ... }));            // who's allowed to call this API
app.use('/api/auth', rateLimit(...));   // brute-force protection
app.use('/api/whatsapp', require('./routes/whatsapp'));
```

Express (a Node.js framework) turns "an HTTP request came in" into "run
this JavaScript function." Everything under `server/src/routes/` is a set
of such functions grouped by feature.

### 2.2 TypeScript — why you should learn it even though this repo doesn't use it yet

This codebase is currently **plain JavaScript**. That's a deliberate gap
for you to notice: plain JS gives you *no* compile-time guarantee that,
say, `credit.cuota` is a number and not `undefined`. Bugs like that show
up at 2am in production logs instead of in your editor.

TypeScript adds a type layer on top of JavaScript. The exact same file
would look like this in TS:

```ts
interface Credit {
  id: number;
  clientId: number;
  cuota: number;
  dueDate: string;
  status: 'vigente' | 'porvencer' | 'mora' | 'pagado';
}

async function sendReminder(credit: Credit): Promise<{ messageId: string; mock: boolean }> {
  ...
}
```

If someone later passes a `Client` where a `Credit` was expected, or
misspells a status string, TypeScript refuses to compile instead of
failing silently at runtime. **One of the best first contributions you
could make here is gradually porting `server/src/lib/*.js` to TypeScript**
— it's low-risk (small, self-contained files), and it forces you to read
and understand every adapter deeply. That directly builds the maintenance
skill Daniel needs from you.

### 2.3 React.js and Next.js — the missing piece

Right now there is **no dashboard** for collectors/admins to log in and
work cases — the API in `server/` has no UI in front of it. The `.html`
files at the repo root (`index.html`, `alivia.html`, `cobra-repuestos.html`,
`portfolio.html`) are static marketing/demo pages, not the CRM's
operator interface.

This is exactly where React and Next.js come in:

- **React** — a library for building UI as components that re-render when
  data changes. A "client list" screen would be a `<ClientTable>`
  component that calls `GET /api/clients` and renders rows.
- **Next.js** — a framework built on React that adds routing, server-side
  rendering, and API-friendly conventions (e.g. a `/dashboard/clients`
  page maps to a file in `app/dashboard/clients/page.tsx`).

A realistic learning project: **build a minimal Next.js + TypeScript
dashboard that logs in against `POST /api/auth/login`, stores the JWT,
and lists clients from `GET /api/clients`.** That single exercise touches
auth, typed API calls, and React state — the whole stack in miniature.

---

## 3. Following one request through the whole system

Trace `POST /api/whatsapp/send/reminder` (`server/src/routes/whatsapp.js:74`):

1. **Auth middleware** (`middleware/auth.js`) verifies the JWT and attaches
   `req.user` (who is calling, and which tenant they belong to).
2. **Compliance middleware** (`middleware/compliance.js`) checks Colombian
   collection-hour law and daily contact limits *before* anything is sent
   — a good example of encoding a legal rule as a reusable Express
   middleware instead of copy-pasting the check into every route.
3. The route looks up the credit, computes days until due, and calls the
   **WhatsApp adapter** (`lib/whatsapp.js`) to actually send the message.
4. The adapter calls Meta's Graph API — an **external API** — with an
   access token.
5. The route logs what happened into `comm_log` — the audit trail every
   CRM needs.

Now trace the **inbound** direction, because it teaches a different
concept: **webhooks**.

---

## 4. External APIs vs. Webhooks (the concept people mix up)

- **Calling an external API** = *we* initiate the request. Example:
  `lib/bold.js#createPaymentLink` — we ask Bold to create a payment link,
  and get a response back immediately.
- **A webhook** = *they* initiate the request, into *our* server, when
  something happens on their end, whenever that may be. We don't poll;
  they push.

This repo has two real webhook handlers, and they teach two different
webhook patterns:

### 4.1 Verification handshake — `whatsapp.js` (Meta)

```js
// server/src/routes/whatsapp.js
router.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
    return res.send(challenge);
  }
  res.sendStatus(403);
});
```

Meta calls this once, with a secret token only we and Meta know, to prove
we control this URL before it starts sending real traffic to it. Any
platform-style webhook (Meta, Slack, Stripe in some flows) has some
version of this "prove you own this endpoint" step.

Then `POST /api/whatsapp/webhook` receives every inbound message. Notice:

```js
router.post('/webhook', async (req, res) => {
  res.sendStatus(200); // acknowledge immediately
  ...
```

**Always ACK a webhook fast, then process.** Webhook senders retry
aggressively (and sometimes disable your endpoint) if you're slow or you
error. Do the actual work after responding, or in a queue — never make
the sender wait on your database writes.

### 4.2 Signature verification — `payments.js` (Bold)

```js
// server/src/routes/payments.js
const sig = req.headers['x-bold-signature'] || '';
if (!bold.verifyWebhook(rawBody, sig)) {
  return res.status(401).json({ error: 'Invalid signature' });
}
```

Anyone on the internet can `POST` to a public webhook URL. **Signature
verification is what proves a payment-confirmation webhook actually came
from Bold**, not from an attacker faking `"status": "APPROVED"` to mark
their debt as paid for free. See `lib/bold.js#verifyWebhook` for the
HMAC-style check. **This is the single most important security pattern
in this whole codebase — understand it cold.**

### 4.3 The mock-mode pattern (worth studying as a design choice)

Every adapter in `lib/` checks `if (!process.env.SOME_KEY) { return fake data }`.
This lets the whole system run and be demoed/tested without real API
keys or without spending money on real WhatsApp messages/calls. It's a
cheap, effective pattern for local dev — look at how `isMock` is computed
and threaded through `lib/whatsapp.js`, `lib/bold.js`, `lib/alegra.js`,
and `lib/dapta.js`.

---

## 5. The escalation engine — business logic as a state machine

`server/src/jobs/escalation.js` runs daily via `node-cron` and moves each
credit through stages:

```
stage 0 → 1 : D-3   preventive WhatsApp reminder
stage 1 → 2 : D0    overdue (mora) notice
stage 2 → 3 : D+4   AI phone call (Dapta)
stage 3 → 4 : D+10  flagged for a human collector
```

This is a **state machine**: `credits.stage` in the database *is* the
state, and the cron job is what drives transitions. Nearly every CRM has
something like this — a pipeline, a lifecycle, a status field that only
moves forward under specific conditions. Once you recognize this shape,
you'll spot it in Salesforce, HubSpot, or any ticketing system too.

---

## 6. Security — what to actually check when you help maintain this

Use this as a working checklist whenever you touch or review code here:

1. **Every write query is parameterized** (`pool.query('... WHERE id = ?', [id])`).
   Never string-concatenate user input into SQL — that's SQL injection.
   Grep for template literals inside `pool.query(` calls as a red flag.
2. **Every protected route uses the `auth` middleware**, and every query
   inside it filters by `req.user.tenantId`. This is a **multi-tenant**
   system (see `tenants` table) — one tenant must never be able to read
   or modify another tenant's data. When you add a new route, ask: *does
   this query scope by tenant?* (Good exercise: check whether the
   inbound WhatsApp webhook handler, which looks up a client purely by
   phone number, could ever match a client belonging to the wrong
   tenant if two tenants shared a phone number — and how you'd fix it.)
3. **Secrets live in `.env`, never in code** (`server/.env.example` lists
   every one). Never commit a filled-in `.env`.
4. **Webhook signatures are verified before trusting the payload** (§4.2).
5. **Passwords are hashed with bcrypt**, never stored or logged in plain
   text (`routes/auth.js`).
6. **Rate limiting** (`app.js`) slows down brute-force login attempts.
7. **`helmet()`** sets safer default HTTP headers.
8. When adding a new external integration, follow the existing adapter
   pattern in `lib/`: mock mode by default, real credentials opt-in,
   and — if it's a webhook — a signature/verification check from day one.

---

## 7. Suggested hands-on path

Work through these roughly in order. Each builds on the last, and each
is small enough to finish in a sitting:

1. **Run it locally.** Follow `server/DEPLOY.md` sections 1–6 on a local
   MySQL instead of the VPS. Leave all third-party keys blank so
   everything runs in mock mode. Hit `/health`, log in, list clients.
2. **Read every file in `server/src/lib/`.** These are the smallest,
   most self-contained files and the clearest example of the
   "real vs. mock" adapter pattern.
3. **Trigger the escalation job manually** (`POST /dev/run-escalation` in
   dev mode) and watch the mock logs — correlate what you see in the
   console with the code in `jobs/escalation.js`.
4. **Port one adapter to TypeScript** (start with `lib/dapta.js` — it's
   the smallest). Define an interface for its inputs/outputs first.
5. **Add a new read-only route** end to end (e.g.
   `GET /api/clients/:id/risk-events`) — this forces you to touch
   routing, auth, tenant scoping, and SQL together.
6. **Build the minimal Next.js dashboard** described in §2.3, starting
   with just login + client list.
7. **Do a security pass** using the §6 checklist against a route you
   haven't touched yet, and write up what you find.

By step 7 you'll have covered the full stack this project is built on —
and you'll be reading this codebase with the same context Daniel has, so
you can actually help carry maintenance and security work instead of
just spectating.
