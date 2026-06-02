# 🤖 AI Review Agent

> Webhook-driven AI code review agent for **GitLab** & **GitHub** — powered by **Gemini 2.5 Flash** and **BullMQ** to automatically review PRs/MRs against your team's coding standards and post inline comments.

![Node.js](https://img.shields.io/badge/Node.js-TypeScript-3178C6?logo=typescript&logoColor=white)
![Version](https://img.shields.io/badge/version-1.11.0-brightgreen)
![Express](https://img.shields.io/badge/Express-5.x-black?logo=express)
![BullMQ](https://img.shields.io/badge/Queue-BullMQ%20%2B%20Redis-red?logo=redis)
![Gemini](https://img.shields.io/badge/AI-Gemini%202.5%20Flash-4285F4?logo=google)
![License](https://img.shields.io/badge/license-ISC-blue)

---

## 📖 Overview

**AI Review Agent** is an automated, asynchronous code review assistant that integrates with GitLab and GitHub webhooks. When a Merge Request or Pull Request is opened or updated, the agent:

1. Receives the webhook event via an **Express** server
2. Enqueues a review job in **BullMQ (Redis)** — responding to the platform instantly to avoid timeout errors
3. Processes the job in a background **worker** that fetches the code diff
4. Sends the diff to **Google Gemini 2.5 Flash** for structured AI analysis
5. Posts **inline discussion comments** directly on the changed lines
6. Updates the **commit status** (`success` / `failed`) to block or allow merging

```
GitLab/GitHub Event ──► Webhook Router ──► BullMQ (Redis) ──► Review Worker ──► Gemini AI ──► Post Review + Update Status
```

---

## ✨ Features

### Core
- **🔀 Multi-Platform** — Supports both **GitLab Merge Requests** and **GitHub Pull Requests** via a platform adapter pattern
- **⚡ Async Queue Architecture** — BullMQ + Redis producer-consumer pattern ensures webhook responses are instant and the review never times out
- **🧠 AI-Powered Reviews** — Gemini 2.5 Flash with schema-enforced JSON output for structured, reliable feedback with line numbers and severity levels

### Smart Review Logic
- **🔁 Incremental Reviews** — Tracks the last reviewed commit SHA per file; on subsequent pushes, only reviews the *new* diff — reducing token usage and developer noise
- **🗂 Diff-Hash Caching** — Embeds a hidden hash of each reviewed file diff in comments; unchanged files are skipped automatically on re-trigger
- **🚫 Auto-Blocking** — On review failure, auto-prepends `Draft:` to the MR title and revokes GitLab approvals to prevent premature merging
- **✅ Conventional Commit Checks** — Validates MR/PR titles, descriptions, and all commit messages against Conventional Commit conventions

### Developer Experience
- **💬 Interactive Re-Reviews** — Developers can reply to AI comments with keywords like `fixed`, `resolved`, or `please recheck` to trigger a targeted re-review
- **🔍 AI Thread Resolution** — Gemini reads the full discussion history and automatically resolves/closes threads when it determines the issue is addressed
- **📍 Inline Comments** — Posts feedback directly on the changed line using GitLab Discussions API / GitHub Pull Request Reviews API, with automatic fallback to global comments
- **🏗 Flexible Deployment** — Run the API + worker in a single process for development, or independently scale the worker in production

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Express Server                           │
│                                                                 │
│   POST /gitlab/webhook ──┐                                      │
│   POST /github/webhook ──┼──► Webhook Router ──► BullMQ Queue  │
│                          │                            │         │
└──────────────────────────┼────────────────────────────┼─────────┘
                           │                            │
                           ▼                            ▼
                    Validate Token/               Redis (BullMQ)
                    HMAC Signature                      │
                                                        │
                                              ┌─────────▼─────────┐
                                              │   Review Worker   │
                                              │                   │
                                              │  1. Fetch MR diff │
                                              │  2. Filter files  │
                                              │  3. Check cache   │
                                              │  4. Call Gemini   │
                                              │  5. Post comments │
                                              │  6. Update status │
                                              └───────────────────┘
```

---

## 📋 Review Rules Enforced

The agent reviews code against a configurable `rules/rules.md` file. Default rules cover:

| Category | Rules |
|---|---|
| **General** | No raw SQL queries · No `any` type · DTO validation mandatory · No business logic in controllers |
| **TypeScript** | Strict mode · No implicit `any` · Use enums over magic strings · Explicit return types |
| **NestJS** | Use Guards/Pipes/Interceptors properly · Use ConfigModule · Use DTOs for request/response |
| **Security** | No secrets in source · Hashed passwords · JWT expiration · Rate limiting · CORS config |
| **Performance** | No blocking ops · Parallel execution with `Promise.all` · Queues for heavy jobs |
| **Git** | Conventional Commits · MR description required · Branch naming conventions |
| **Dependencies** | No vulnerable packages · No unused deps · No deprecated packages |

> Rules are loaded dynamically at runtime from `rules/rules.md`. Override with `RULES_PATH` env var.

---

## 🚀 Getting Started

### Prerequisites

- Node.js `>= 18`
- Redis instance (local or hosted)
- A Google Gemini API Key ([Get one here](https://aistudio.google.com/))
- A GitLab Personal Access Token **or** a GitHub Personal Access Token

### Installation

```bash
git clone <your-repo-url>
cd ai-review-agent
npm install
```

### Configuration

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

```env
# Server
PORT=3000

# Redis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

# GitLab (if using GitLab)
GITLAB_URL=https://gitlab.com
GITLAB_TOKEN=glpat-your_access_token
GITLAB_WEBHOOK_SECRET=your_webhook_secret

# GitHub (if using GitHub)
GITHUB_TOKEN=ghp_your_personal_access_token
GITHUB_WEBHOOK_SECRET=your_webhook_secret

# Gemini AI
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash

# Review Rules
RULES_PATH=rules/rules.md

# Production: set to true to disable in-process worker
DISABLE_WORKER=false
```

### Running

**Development** (API server + worker in a single process):
```bash
npm run dev
```

**Production** (scale API and worker independently):
```bash
# Terminal 1 — API Server (with DISABLE_WORKER=true in .env)
npm run start

# Terminal 2 — Standalone Worker
npm run worker:start
```

---

## 🔗 Webhook Setup

### GitLab

1. Go to your project → **Settings** → **Webhooks**
2. Add a new webhook:
   - **URL**: `http://<your-agent-host>/gitlab/webhook`
   - **Secret token**: value of `GITLAB_WEBHOOK_SECRET`
   - **Triggers**: ✅ Merge request events · ✅ Note events
3. Click **Add webhook**

> See [docs/gitlab_guide.md](docs/gitlab_guide.md) for full configuration details.

### GitHub

1. Go to your repository → **Settings** → **Webhooks**
2. Add a new webhook:
   - **Payload URL**: `http://<your-agent-host>/github/webhook`
   - **Content type**: `application/json`
   - **Secret**: value of `GITHUB_WEBHOOK_SECRET`
   - **Events**: ✅ Pull requests · ✅ Pull request review comments
3. Click **Add webhook**

> See [docs/github_guide.md](docs/github_guide.md) for full configuration details.

---

## 📁 Project Structure

```
ai-review-agent/
├── src/
│   ├── app.ts                  # Express app entry point
│   ├── config/                 # Centralized environment config
│   ├── routes/                 # Webhook route handlers (GitLab, GitHub)
│   ├── queue/
│   │   ├── queue.ts            # BullMQ queue definition
│   │   └── worker.ts           # Review worker (platform adapter)
│   ├── services/
│   │   ├── ai.service.ts       # Gemini AI integration
│   │   ├── gitlab.service.ts   # GitLab API wrapper (@gitbeaker)
│   │   └── github.service.ts   # GitHub API wrapper (@octokit)
│   └── utils/                  # Shared helpers & logger (winston)
├── rules/
│   └── rules.md                # Configurable AI review rules
├── docs/
│   ├── project_overview.md
│   ├── gitlab_guide.md
│   └── github_guide.md
├── .env.example
├── tsconfig.json
└── package.json
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js + TypeScript |
| **Server** | Express 5 |
| **Queue** | BullMQ + ioredis |
| **AI** | Google Gemini 2.5 Flash (`@google/genai`) |
| **GitLab API** | `@gitbeaker/rest` |
| **GitHub API** | `@octokit/rest` + `@octokit/graphql` |
| **Logging** | Winston |
| **HTTP Client** | Axios |

---

## 🗺️ Roadmap

- [ ] **Inline Code Suggestions** — Provide one-click applicable Git-diff format suggestions
- [ ] **Multi-File Context** — Feed related files (e.g. DTO + controller) to Gemini for deep-context validation
- [ ] **Bitbucket Support** — Extend webhook router to support Bitbucket webhooks
- [ ] **AI Auto-Merge** — Auto-approve and merge PRs/MRs that pass all AI filters with zero issues

---

## 📄 License

ISC
