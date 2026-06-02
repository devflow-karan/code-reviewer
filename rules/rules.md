# NestJS / Node.js / TypeScript Code Review Guidelines

## General Rules

- No raw SQL queries
- No usage of `any` type
- DTO validation is mandatory using `class-validator`
- Avoid business logic inside controllers
- Ensure proper error handling
- No empty `catch` blocks
- Avoid hardcoded values; use configs/constants/env variables
- Follow consistent folder/module structure
- Avoid duplicate code (DRY principle)
- Use dependency injection properly
- No circular dependencies

---

# TypeScript Standards

- Enable strict TypeScript mode
- Avoid implicit `any`
- Avoid unnecessary type assertions (`as`)
- Prefer `readonly` where applicable
- Use enums/constants instead of magic strings
- Avoid generic types like `object`, `{}`, `Function`
- Export explicit return types for public methods
- Use meaningful variable/function names
- Avoid deeply nested conditions
- Prefer early returns

## Example

### Bad
```ts
const d = users;
```

### Good
```ts
const activeUsers = users;
```

---

# NestJS Best Practices

- Controllers should only handle request/response
- Business logic belongs in services
- Use Guards for authentication/authorization
- Use Pipes for validation
- Use Interceptors for logging/transformation
- Use custom exception filters
- Use ConfigModule instead of direct `process.env`
- Avoid exposing entities directly in API responses
- Use DTOs for request and response handling

---

# API Standards

- Use proper HTTP status codes
- Follow REST naming conventions
- Pagination required for list endpoints
- Swagger documentation mandatory
- Validate params, query, and request body
- Maintain consistent API response structure
- Avoid exposing sensitive fields

## Example Response Format

```json
{
  "success": true,
  "message": "User created successfully",
  "data": {}
}
```

---

# Database Rules

- Avoid N+1 queries
- Use transactions where needed
- Use migrations only (disable schema sync in production)
- Add indexes for searchable fields
- Avoid unnecessary eager loading
- Fetch only required fields
- Repository/service layer should manage DB access

---

# Security Rules

- No secrets/API keys in source code
- Passwords must be hashed securely
- JWT expiration required
- Enable rate limiting
- Validate and sanitize input
- Proper CORS configuration
- Prevent SQL injection and XSS
- Validate file uploads
- Avoid exposing stack traces in production

---

# Performance Rules

- Avoid blocking operations
- Use caching where appropriate
- Avoid sequential awaits if parallel execution is possible

## Bad

```ts
await fetchUsers();
await fetchOrders();
```

## Good

```ts
await Promise.all([
  fetchUsers(),
  fetchOrders(),
]);
```

- Use queues for heavy background jobs
- Optimize large payload responses

---

# Logging & Monitoring

- No `console.log` in production
- Use structured logging
- Log errors with context
- Add request tracing/correlation IDs
- Add health check endpoints

---

# Testing Rules

- Unit tests required for services/helpers
- E2E tests for critical APIs
- Test both success and failure scenarios
- Avoid skipped tests (`it.skip`)
- Mock external services properly
- Maintain minimum test coverage

---

# Git & Merge Request Rules

- Commit messages must follow Conventional Commits

## Allowed Prefixes

- feat:
- fix:
- chore:
- docs:
- refactor:
- style:
- test:
- perf:

## Examples

```txt
feat(auth): add refresh token support
fix(users): resolve pagination issue
```

- Merge Request title must follow Conventional Commits
- Merge Request description is mandatory
- MR description should include:
  - Why the change is needed
  - Technical approach
  - Edge cases considered
  - Testing performed
  - Breaking changes (if any)

- Branch naming conventions required

## Example Branch Names

```txt
feature/auth-refresh-token
fix/user-pagination
```

- CI pipeline must pass before merge
- At least 1 approval required before merge
- No direct commits to protected branches

---

# Code Quality

- ESLint and Prettier mandatory
- Remove unused imports/variables
- Remove dead/commented code
- Keep functions small and focused
- Limit function/class complexity
- Use reusable helper functions when needed

---

# Production Readiness

- Environment-specific configuration
- Graceful shutdown handling
- Retry strategy for external APIs
- Proper timeout handling
- Docker healthchecks configured
- Idempotency for critical operations

---

# Recommended Tooling

- ESLint
- Prettier
- Husky
- Commitlint
- SonarQube
- DangerJS

---

# Review Checklist

## Before Approving PR

- [ ] Code follows architecture standards
- [ ] Validation implemented properly
- [ ] Error handling added
- [ ] No security concerns
- [ ] No performance bottlenecks
- [ ] Tests added/updated
- [ ] Swagger updated
- [ ] MR description completed
- [ ] Commit messages follow conventions
- [ ] No hardcoded values
- [ ] No unused code/imports
- [ ] CI checks passing


# Dependency & Security Review Rules

## Package Management Rules

- Review all package versions before merge
- Avoid outdated major versions unless justified
- Prefer actively maintained packages
- Remove unused dependencies
- Avoid duplicate packages with similar functionality
- Lock dependency versions properly
- Avoid deprecated packages
- Check package changelogs before upgrading major versions
- Ensure package licenses are acceptable for the project

---

# Security Rules for Dependencies

- No vulnerable packages allowed
- Run security audit before merge
- Fix high and critical vulnerabilities immediately
- Medium vulnerabilities require review/justification
- Verify transitive dependencies for vulnerabilities
- Avoid packages with abandoned maintainers
- Avoid packages with low community trust/downloads for critical functionality

---

# Required Commands

## NPM Audit

```bash
npm audit
npm audit fix
```

## Check Outdated Packages

```bash
npm outdated
```

## Check Dependency Tree

```bash
npm ls
```

## Check Unused Dependencies

```bash
npx depcheck
```

---

# Recommended Tools

## Dependency Updates

- npm-check-updates
- Renovate
- Dependabot

## Security Scanning

- Snyk
- npm audit
- Socket.dev
- Trivy

---

# CI/CD Validation Rules

CI pipeline should fail if:

- High/Critical vulnerabilities exist
- Deprecated packages detected
- Package lock file is missing
- Dependency versions are inconsistent
- Unused dependencies exceed acceptable threshold

---

# Review Checklist

## Dependency Review

- [ ] All packages are actively maintained
- [ ] No deprecated packages
- [ ] No unused dependencies
- [ ] No duplicate libraries
- [ ] Major version upgrades reviewed properly
- [ ] Changelog reviewed for breaking changes
- [ ] Package versions aligned properly

## Security Review

- [ ] `npm audit` passes
- [ ] No High/Critical vulnerabilities
- [ ] Security patches applied
- [ ] Transitive dependency risks reviewed
- [ ] No suspicious/untrusted packages

---

# Recommended Commands for Reviewers

## Check outdated dependencies

```bash
npm outdated
```

## Upgrade safely

```bash
npx npm-check-updates -u
npm install
```

## Check vulnerabilities

```bash
npm audit --audit-level=high
```

## Generate dependency report

```bash
npm ls --depth=0
```

---

# Additional Best Practices

- Prefer official SDKs/libraries over community wrappers
- Avoid installing entire utility libraries if only small functionality is needed
- Prefer tree-shakable libraries
- Review bundle size impact for frontend/shared packages
- Pin critical infrastructure package versions carefully
- Upgrade framework packages together (NestJS, TypeORM, Prisma, etc.)
- Maintain consistent versions across monorepo/apps

---

# Example PR Requirement

Every PR affecting dependencies should mention:

- Added packages
- Removed packages
- Updated packages
- Reason for upgrade
- Breaking changes (if any)
- Security fixes included