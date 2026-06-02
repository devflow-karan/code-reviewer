# Changelog

## [1.11.0]
### Added
- Implemented full GitHub Integration for automated PR code reviews, conventional commit status checks, and conversational AI review responses.
- Added new `github.service.ts` wrapping `@octokit/rest` REST and GraphQL API methods for thread fetching and resolution.
- Updated `worker.ts` with a platform adapter pattern to route review payloads to either GitLab or GitHub services based on the queue job's `platform` field.
- Registered `/github/webhook` endpoint with HMAC-SHA256 signature verification.
- Documented configuration and setup workflows in `docs/github_guide.md`.

## [1.10.0]
### Added
- Implemented GitLab `note` webhook event support to trigger re-reviews and handle thread replies.
- Filtered out bot replies and system notes to prevent infinite loops.
- Added AI-assisted discussion thread resolution: the AI reviews conversation history on a thread and responds to the developer. If they agree the issue is addressed, the bot resolves/closes the thread.

## [1.9.0]
### Changed
- Replaced Draft Notes review flow with live line-by-line discussions (`MergeRequestDiscussions` API). Comments are now published live immediately instead of held in draft review.
- Kept the automatic fallback to global discussions if the line number is not part of the MR diff.

## [1.8.1]
### Fixed
- Fixed `404 Not Found` API errors when creating draft notes on lines not present in the MR diff.
  - Implemented automatic fallback to global draft notes when the inline position is invalid, ensuring review feedback is never lost.

## [1.8.0]
### Added
- Implemented file-level inline comments using GitLab's discussions and positioning features.
- Implemented Draft Notes and Bulk Publish workflow (similar to GitLab's "Start a Review" button) to publish all review comments at once, reducing notification spam and improving user experience.

## [1.7.0]
### Added
- Added support for incremental reviews focusing only on newly updated changes:
  - Added `commitSha` to the bot's review comment metadata to track which commit version was last reviewed for each file.
  - On subsequent commits on the same MR, the worker determines the last reviewed commit SHA and queries the GitLab Repository Compare API to obtain the incremental changes.
  - If a file is modified, the agent only reviews the incremental diff (the exact lines updated by the user) instead of re-evaluating the full MR diff, ensuring developers only receive feedback on their latest updates.
  - Gracefully falls back to the full MR diff if the repository comparison fails (e.g. due to force-pushes or commit cleanup).

## [1.6.0]
### Added
- Added intelligent file-diff caching to prevent duplicate reviews:
  - Comments posted by the agent now include a hidden metadata comment containing the hash of the file diff reviewed and the review decision (`changes_requested` or `approved`).
  - On subsequent review triggers, the worker pulls existing discussions to check if a file's diff hash matches. If unchanged, the review is skipped.
  - If a skipped file's previous decision was `changes_requested`, the current review pipeline still correctly reports a failure to prevent merging unfixed code.

## [1.5.0]
### Added
- Implemented automatic MR blocking and approval revocation on review failures:
  - If the review results in a failure (`changes_requested`), the agent automatically prepends `Draft: ` to the MR title (if not already there) to prevent manual merging.
  - Automatically invokes the GitLab Approvals API to `unapprove` the MR, revoking any active approvals.

## [1.4.7]
### Fixed
- Reverted the use of `MergeRequests.allDiffs` back to `MergeRequests.showChanges` to resolve the `404 Not Found` API request error that was crashing the worker review process.

## [1.4.6]
### Fixed
- Resolved GitLab API deprecation warning (for endpoint deprecations in v15.7) by replacing `MergeRequests.showChanges` with `MergeRequests.show` and `MergeRequests.allDiffs` to fetch metadata and changes separately.

## [1.4.5]
### Fixed
- Implemented automatic skipping of code reviews and cancellation of commit status (setting it to `canceled` on GitLab) for Merge Requests that are closed or merged.
- Configured early-exit in both the webhook event handler and the background worker queue execution.

## [1.4.4]
### Fixed
- Added a defensive `Array.isArray` check inside `getMrCommits` to prevent potential runtime `TypeError` crashes if GitLab API returns an unexpected or non-array response.

## [1.4.3]
### Added
- Excluded files inside the `docs/` folder from being reviewed by the AI review loop.
- Added support for validating Git commit messages and Merge Request titles against Conventional Commit conventions (e.g. `feat:`, `fix:`, `chore:`).
- Added verification of Merge Request description presence and details.
- Integrated `api.MergeRequests.commits` to fetch and check MR commits for conventional message guidelines.

## [1.4.2]
### Fixed
- Replaced the hardcoded review rules in `src/services/ai.service.ts` by dynamically loading rules from a markdown file (`rules/rules.md`) at runtime.
- Added support for configuring/overriding the rules file path via `RULES_PATH` in the environment variables.

## [1.4.1]
### Fixed
- Added detailed diagnostic logging inside the worker MR processing loop to track and debug empty changes, skipped files, AI request status, and commit status updates.
- Configured a 60-second network timeout on the Axios call to Gemini AI to prevent the worker from hanging indefinitely in case of API/network stalls.

## [1.4.0]
### Added
- Replaced OpenAI integration with Gemini AI using direct REST API calls via `axios` with schema-enforced `generationConfig` (using `gemini-2.5-flash` by default).
- Replaced `OPENAI_API_KEY` and `OPENAI_MODEL` with `GEMINI_API_KEY` and `GEMINI_MODEL` across configuration and environment files.
- Removed unused `openai` dependency to keep dependencies minimal.

## [1.3.14]
### Fixed
- Fixed BullMQ initialization error (`Error: BullMQ: Your redis options maxRetriesPerRequest must be null.`) by setting `maxRetriesPerRequest: null` in both queue and worker Redis connection options.

## [1.3.13]
### Fixed
- Fixed worker execution by conditionally importing/instantiating the worker in `src/app.ts` (run in-process by default).
- Added standalone worker scripts (`worker:dev` and `worker:start`) to support running the worker in a separate process for production deployments.
- Added startup log verification to `src/queue/worker.ts` on start.

## [1.3.12]
### Fixed
- Handled GitLab API `GitbeakerRequestError` for state transition failures (e.g. `Cannot transition status via :enqueue from :pending`) gracefully. Redundant updates are now logged as warnings and skipped, preventing webhook crashes.

## [1.3.11]
### Fixed
- Fixed GitLab webhook ignoring "Test Webhook" payloads due to a missing `action` field. The webhook route now gracefully falls back to checking if `state === 'opened'`.

## [1.3.10]
### Fixed
- Added a custom Express middleware error handler in `app.ts` to catch `body-parser` JSON `SyntaxError`s gracefully, preventing raw stack traces from polluting the console on malformed payload reception.

## [1.3.9]
### Changed
- Increased Express JSON body parser limit to `5mb` in `app.ts` to accommodate large GitLab webhook payloads.

## [1.3.8]
### Fixed
- Fixed `SyntaxError: Unterminated string in JSON` in `worker.ts` caused by OpenAI API response truncations.
- Enforced `response_format: { type: "json_object" }` and increased `max_tokens: 8192` in `ai.service.ts`.
- Added defensive `try/catch` around `JSON.parse` in `worker.ts` so job doesn't fully crash on isolated JSON errors.

## [1.3.7]
### Fixed
- Replaced the final remaining `process.env` calls in `src/services/ai.service.ts` with the centralized `config` module.
- Restored `logger.error` handling inside `reviewCode`.

## [1.3.6]
### Fixed
- Replaced `process.env` calls in `src/queue/queue.ts` with the centralized `config` module for connecting to Redis.

## [1.3.5]
### Fixed
- Replaced all lingering `console.log` and `console.error` usages in `app.ts`, `queue/worker.ts`, and `routes/webhook.ts` with `winston` structured `logger`.
- Removed remaining `process.env` calls in `app.ts` and `routes/webhook.ts` to favor `config`.

## [1.3.4]
### Fixed
- Restored `config` file usages in `gitlab.service.ts` and `queue/worker.ts` replacing direct `process.env` calls.

## [1.3.3]
### Changed
- Added strong `Interface` typings across the board: `AIReviewResult`, `ReviewJobData`, and `GitLabMRChangesResponse`.
- Cast parsed JSON and third-party library returns to these interfaces for end-to-end type safety in the BullMQ worker.

## [1.3.2]
### Fixed
- Refactored `ai.service.ts` to use centralized config (`config.openai.apiKey` and `config.openai.model`).
- Implemented `response_format: { type: "json_object" }` in OpenAI call for reliable JSON parsing.
- Added strict TypeScript interface (`AIReviewResult`) and explicit `logger.error` handling.

## [1.3.1]
### Added
- Added `.gitignore` file to properly exclude `node_modules`, `dist`, `.env`, and editor files from source control.

## [1.3.0]
### Added
- Integrated `winston` for robust application logging.
- Replaced scattered `console.log` statements with structured logger calls in `app.ts` and `worker.ts`.

## [1.2.1]
### Fixed
- Fixed TypeScript 6 compilation error `TS5107` by adding `"ignoreDeprecations": "6.0"` to `tsconfig.json` to allow `moduleResolution: node` in CommonJS.

## [1.2.0]
### Added
- Added `dev` script (`ts-node-dev --respawn`) for automatic restarts on TS changes.
- Added `build` script (`tsc`) to compile the project.
- Updated `start` script to run the compiled production build (`node dist/app.js`).

## [1.1.3]
### Changed
- Centralized all `process.env` access to a strongly typed `src/config/index.ts` file.

## [1.1.2]
### Fixed
- Updated `tsconfig.json` to resolve CommonJS module resolution error TS1295 by disabling `verbatimModuleSyntax` and setting `module: CommonJS` with `moduleResolution: node`.

## [1.1.1]
### Fixed
- Added TS interfaces for Webhook payload and Job payload.
- Added explicitly typed Express handlers (`Request`, `Response`, `NextFunction`).
- Implemented `verifyGitLabToken` middleware using `GITLAB_WEBHOOK_SECRET`.
- Configured Redis connection using environment variables instead of defaults.
- Prevented Express unhandled promise rejections with properly bounded returns.

## [1.1.0]
### Added
- Created initial project file structure (`src/app.ts`, `src/routes/webhook.ts`, etc.).
- Added `.env.example` with environment variable templates.
