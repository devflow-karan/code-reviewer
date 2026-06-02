# AI Code Review Agent (GitLab & Gemini Integration)

An automated, webhook-driven AI code review assistant that listens to GitLab Merge Requests, processes code changes asynchronously using a queue, and reviews them using the Google Gemini AI model to enforce coding standards.

---

## 🏗️ Architecture & How It Works

The project uses a **producer-consumer architecture** backed by **Express**, **BullMQ (Redis)**, and the **Gemini REST API** to review code changes without blocking GitLab webhook requests:

![Sequence Diagram](https://raw.githubusercontent.com/devflow-karan/diagramproj/master/project_flow.png)

---

## 🌟 Key Features

*   **Asynchronous Processing**: Uses **BullMQ** and **Redis** so the Express webhook receiver responds to GitLab instantly, preventing timeouts and handling traffic spikes.
*   **GitLab Webhook Integration**: Auto-triggers on Merge Request creation, updates, and reopens. Supports GitLab's "Test Webhook" payloads seamlessly.
*   **Gemini AI Code Review**: Leverage the speed and reasoning of **Gemini 2.5 Flash** with schema-enforced JSON outputs, ensuring comments are strictly structured with line numbers, severity, and clear messages.
*   **Review Rules Enforced**:
    *   No Raw SQL queries (encouraging ORM/Query builder usage).
    *   No usage of the loose `any` type in TypeScript.
    *   Mandatory DTO validation for input endpoints.
    *   Prevention of business logic pollution in Express/NestJS Controllers.
*   **Flexible Deployment Modes**:
    *   *Development*: Run both API server and Worker in a single process (`npm run dev`) for plug-and-play local development.
    *   *Production*: Disable the in-process worker (`DISABLE_WORKER=true`) and run the worker standalone (`npm run worker:start`) for independent scaling.

---

## 📈 Benefits

| Benefit | How It Helps the Team |
| :--- | :--- |
| **Saves Senior Reviewer Time** | Catches syntax errors, architectural issues (e.g. logic in controllers, raw SQL), and type issues *before* a human reviews it, keeping human reviews focused on business logic. |
| **Shift-Left Quality & Security** | Instantly highlights coding standards violations on every commit push, accelerating developer feedback loops. |
| **Fail-Safe & Resilient** | Handles malformed payloads gracefully, limits payload sizes up to 5MB, skips binary/empty files, handles GitLab API state conflicts, and implements strict HTTP timeouts on AI calls. |
| **Standardized Codebase** | Ensures compliance with critical rules (e.g. DTO validation and typing) uniformly across the engineering team. |

---

## 🎯 Project Scope

### Current Scope (Completed)
*   Integrates with **GitLab** merge request webhook payloads.
*   Performs file-by-file diff analysis.
*   Generates structured code quality/architecture feedback (low, medium, high severity comments).
*   Updates GitLab Commit Statuses (`pending`, `success`, `failed`) to block or allow merging.

### Future Scope (Planned Enhancements)
*   **Inline Code Suggestions**: Expand feedback to provide Git-diff format suggestions that developers can apply with a single click.
*   **Multi-File Context Analysis**: Feed Gemini details of related files (e.g. DTO definition + controller implementation) for deep-context validation.
*   **Multi-Provider Integration**: Extend webhook router and git interfaces to support **GitHub Actions/Webhooks** and **Bitbucket**.
*   **AI Auto-Merge Configuration**: Automatically approve and merge MRs that pass all AI review filters with zero issues.
