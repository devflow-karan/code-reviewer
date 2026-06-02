# GitLab Integration & Setup Guide

This guide provides a comprehensive overview of how to set up, configure, and use the AI Code Review Agent with GitLab.

---

## 🏗️ Overview

The AI Code Review Agent is an automated, webhook-driven assistant that integrates with GitLab Merge Requests (MRs). It processes code changes asynchronously using a producer-consumer architecture (Express + BullMQ + Redis) and reviews them using the Google Gemini API to enforce team coding standards.

```
 GitLab MR Event ──> Webhook Router ──> BullMQ (Redis) ──> Review Worker ──> Gemini AI ──> Post Review/Status
```

---

## ⚙️ Configuration & Environment Variables

To run the agent with GitLab, configure the following environment variables in your `.env` file:

```env
# Server Port
PORT=3000

# Redis connection details for BullMQ
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

# GitLab Integration Config
GITLAB_URL=https://gitlab.com           # GitLab instance base URL
GITLAB_TOKEN=glpat-your_access_token     # Access token with api, read_user scopes
GITLAB_WEBHOOK_SECRET=your_webhook_sec   # Secret token to verify webhook payloads

# Gemini AI config
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash

# Review Rules Configuration
RULES_PATH=rules/rules.md                # Path to markdown file containing review guidelines

# Scalability settings (run worker in-process or standalone)
DISABLE_WORKER=false
```

---

## 🔗 GitLab Webhook Configuration

To connect your GitLab repository to the AI agent:

1. Go to your GitLab project -> **Settings** -> **Webhooks**.
2. Add a new webhook with the following details:
   - **URL**: `http://<your-agent-domain>/gitlab/webhook`
   - **Secret token**: Value of `GITLAB_WEBHOOK_SECRET`
   - **Trigger**:
     - Check **Merge request events** (triggers on open, update, close, reopen).
     - Check **Note events** (triggers when developers reply to comments).
   - **SSL verification**: Enable if using HTTPS.
3. Click **Add webhook**.

---

## 🚀 Core Features & Workflows

### 1. Automated Review on MR Lifecycle
- **Trigger**: Triggers instantly on MR creation (`opened`), code updates (`update`/`synchronize`), and reopenings (`reopened`).
- **Processing**: Enqueues a review job in BullMQ to respond to GitLab instantly and prevent timeouts.
- **Commit Status**: Sets commit status to `pending` during the review and updates to `success` or `failed` based on the review decision.
- **Auto-cancellation**: If an MR is `closed` or `merged`, the agent automatically cancels the pending review job and sets the commit status to `canceled`.

### 2. Conventional Commit & MR Metadata Check
- Validates the MR title and description against Conventional Commits.
- Validates commit messages for all commits included in the MR.
- If metadata guidelines are violated, posts a metadata review comment on the MR.

### 3. File Diff Filtering & Hashing
- Skips files inside `docs/` or `.agent/` folders to keep reviews focused on code.
- Skips binary or empty files.
- **Diff Hashing**: Hashes the diff of each reviewed file and embeds it in a hidden comment metadata tag. If a file is unchanged on subsequent updates, the agent skips re-reviewing it.

### 4. Incremental Review
- Keeps track of the last reviewed commit SHA for each file using metadata comments.
- On subsequent updates, queries the GitLab Repository Compare API to retrieve only the new diff (comparing last reviewed SHA with the current head SHA).
- Only reviews the new changes instead of re-reviewing the entire file, reducing AI token usage and developer noise.

### 5. Line-by-Line Live Discussions
- Posts code feedback as inline comments aligned directly to the updated line number using GitLab's Discussions API.
- Automatically falls back to a global MR comment if the line number is not part of the MR diff (e.g. context changes).

### 6. Interactive AI Re-Review & Thread Resolution
- **Developer Reply**: When a developer replies to an AI-generated thread, the webhook triggers a `note` event.
- **Trigger Words**: If the reply contains keywords like `fixed`, `resolved`, `done`, `please recheck`, or `updated`, the agent enqueues a new review job to re-analyze the code diff.
- **AI Conversation Handler**: Run in the background asynchronously, it sends the discussion history to Gemini AI to generate a reply. If Gemini decides both parties agree that the issue has been resolved, it automatically marks the GitLab discussion thread as resolved/closed.
