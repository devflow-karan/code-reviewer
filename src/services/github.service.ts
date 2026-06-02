import { Octokit } from '@octokit/rest';
import { config } from '../config';
import { logger } from '../utils/logger';

export const octokit = new Octokit({
  auth: config.github.token || undefined,
});

export type CommitStatusState = 'pending' | 'success' | 'failed' | 'canceled';

export interface GitHubFileChange {
  diff: string;
  new_path: string;
  old_path: string;
}

export interface GitHubDiffRefs {
  base_sha: string;
  head_sha: string;
  start_sha: string;
}

export interface GitHubPrChangesResponse {
  changes: GitHubFileChange[];
  title?: string;
  description?: string;
  state?: string;
  diff_refs?: GitHubDiffRefs;
}

function parseRepo(repoFullname: string) {
  const [owner, repo] = repoFullname.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid GitHub repository fullname: ${repoFullname}`);
  }
  return { owner, repo };
}

export async function setCommitStatus(
  repoFullname: string,
  sha: string,
  state: CommitStatusState,
): Promise<void> {
  try {
    const { owner, repo } = parseRepo(repoFullname);
    // Map GitLab states to GitHub states:
    // pending -> pending, success -> success, failed -> failure, canceled -> error
    const githubState: 'pending' | 'success' | 'failure' | 'error' = 
      state === 'pending' ? 'pending' :
      state === 'success' ? 'success' :
      state === 'failed' ? 'failure' : 'error';

    await octokit.repos.createCommitStatus({
      owner,
      repo,
      sha,
      state: githubState,
      context: 'ai-code-review',
      description: state === 'pending' ? 'AI code review is in progress...' : 
                   state === 'success' ? 'AI code review passed!' : 
                   state === 'failed' ? 'AI code review requested changes' : 'AI code review was canceled',
    });
    logger.info('GitHub commit status updated successfully', { repoFullname, sha, state: githubState });
  } catch (error) {
    logger.error('Failed to set GitHub commit status', { error, repoFullname, sha });
    throw error;
  }
}

export async function getPrChanges(
  repoFullname: string,
  pullNumber: number,
): Promise<GitHubPrChangesResponse> {
  try {
    const { owner, repo } = parseRepo(repoFullname);

    // 1. Fetch Pull Request details
    const { data: pr } = await octokit.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });

    // 2. Fetch Pull Request files list (includes patches/diffs)
    const { data: files } = await octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100, // handle up to 100 files
    });

    const changes: GitHubFileChange[] = files.map((file: any) => ({
      diff: file.patch || '',
      new_path: file.filename,
      old_path: file.previous_filename || file.filename,
    }));

    return {
      changes,
      title: pr.title,
      description: pr.body || '',
      state: pr.state, // open, closed
      diff_refs: {
        base_sha: pr.base.sha,
        head_sha: pr.head.sha,
        start_sha: pr.base.sha,
      },
    };
  } catch (error) {
    logger.error('Failed to fetch GitHub PR changes', { error, repoFullname, pullNumber });
    throw error;
  }
}

export async function getPrCommits(
  repoFullname: string,
  pullNumber: number,
): Promise<string[]> {
  try {
    const { owner, repo } = parseRepo(repoFullname);
    const { data: commits } = await octokit.pulls.listCommits({
      owner,
      repo,
      pull_number: pullNumber,
    });

    return commits.map((c: any) => c.commit?.message || '');
  } catch (error) {
    logger.error('Failed to fetch GitHub PR commits', { error, repoFullname, pullNumber });
    return [];
  }
}

export async function addPrComment(
  repoFullname: string,
  pullNumber: number,
  body: string,
): Promise<void> {
  try {
    const { owner, repo } = parseRepo(repoFullname);
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body,
    });
  } catch (error) {
    logger.error('Failed to add GitHub PR comment', { error, repoFullname, pullNumber });
    throw error;
  }
}

export async function blockPr(
  repoFullname: string,
  pullNumber: number,
  currentTitle: string,
): Promise<void> {
  try {
    const { owner, repo } = parseRepo(repoFullname);
    // Prepend "Draft: " to the PR title if not already present
    if (!currentTitle.startsWith('Draft:') && !currentTitle.startsWith('[Draft]')) {
      const newTitle = `Draft: ${currentTitle}`;
      await octokit.pulls.update({
        owner,
        repo,
        pull_number: pullNumber,
        title: newTitle,
      });
      logger.info('GitHub PR title updated to Draft to block merge', { repoFullname, pullNumber });
    }
  } catch (error) {
    logger.error('Failed to update GitHub PR title to Draft', { error, repoFullname, pullNumber });
  }
}

export async function getPrComments(
  repoFullname: string,
  pullNumber: number,
): Promise<any[]> {
  try {
    const { owner, repo } = parseRepo(repoFullname);
    const { data: comments } = await octokit.pulls.listReviewComments({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    });

    // Format to match notes mapping in worker
    return comments.map((c: any) => ({
      id: c.id,
      body: c.body,
      path: c.path,
      user: c.user,
      node_id: c.node_id,
      discussionId: c.in_reply_to_id || c.id,
    }));
  } catch (error) {
    logger.error('Failed to fetch GitHub PR review comments', { error, repoFullname, pullNumber });
    return [];
  }
}

export async function compareCommits(
  repoFullname: string,
  base: string,
  head: string,
): Promise<any> {
  try {
    const { owner, repo } = parseRepo(repoFullname);
    const { data: comparison } = await octokit.repos.compareCommits({
      owner,
      repo,
      base,
      head,
    });

    const diffs = (comparison.files || []).map((file: any) => ({
      diff: file.patch || '',
      new_path: file.filename,
      old_path: file.previous_filename || file.filename,
    }));

    return { diffs };
  } catch (error) {
    logger.warn('Failed to compare GitHub commits, falling back to full diff', { error, repoFullname, base, head });
    return null;
  }
}

export interface GitHubDiscussionPosition {
  path: string;
  line: number;
  commitId: string;
}

export async function createPrDiscussion(
  repoFullname: string,
  pullNumber: number,
  body: string,
  position?: GitHubDiscussionPosition,
): Promise<void> {
  try {
    const { owner, repo } = parseRepo(repoFullname);
    if (position) {
      await octokit.pulls.createReviewComment({
        owner,
        repo,
        pull_number: pullNumber,
        body,
        commit_id: position.commitId,
        path: position.path,
        line: position.line,
        side: 'RIGHT',
      });
      logger.info('Created GitHub inline review comment successfully', { repoFullname, pullNumber, path: position.path, line: position.line });
    } else {
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: pullNumber,
        body,
      });
      logger.info('Created global GitHub PR comment successfully', { repoFullname, pullNumber });
    }
  } catch (error) {
    if (position) {
      logger.warn('Failed to create GitHub inline review comment. Falling back to global PR comment...', {
        error,
        repoFullname,
        pullNumber,
        path: position.path,
        line: position.line,
      });
      try {
        const { owner, repo } = parseRepo(repoFullname);
        await octokit.issues.createComment({
          owner,
          repo,
          issue_number: pullNumber,
          body,
        });
        logger.info('Created fallback global GitHub PR comment successfully', { repoFullname, pullNumber });
        return;
      } catch (fallbackError) {
        logger.error('Failed to create fallback global GitHub PR comment', { error: fallbackError, repoFullname, pullNumber });
        throw fallbackError;
      }
    }
    logger.error('Failed to create GitHub PR comment', { error, repoFullname, pullNumber });
    throw error;
  }
}

let cachedBotUser: any = null;

export async function getBotUser(): Promise<any> {
  if (cachedBotUser) {
    return cachedBotUser;
  }
  try {
    const { data } = await octokit.users.getAuthenticated();
    cachedBotUser = data;
    return cachedBotUser;
  } catch (error) {
    logger.error('Failed to fetch GitHub bot user details', { error });
    throw error;
  }
}

export async function getPrDiscussion(
  repoFullname: string,
  pullNumber: number,
  commentId: number,
): Promise<any> {
  try {
    const { owner, repo } = parseRepo(repoFullname);
    // Fetch all review comments to build the thread
    const { data: comments } = await octokit.pulls.listReviewComments({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    });

    const targetComment = comments.find(c => c.id === commentId);
    if (!targetComment) {
      throw new Error(`GitHub comment with ID ${commentId} not found`);
    }

    const parentId = targetComment.in_reply_to_id || targetComment.id;
    const threadComments = comments.filter(c => c.id === parentId || c.in_reply_to_id === parentId);

    // Sort by creation date
    threadComments.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    // Format notes context to match gitlab style notes array
    return {
      notes: threadComments.map((c: any) => ({
        id: c.id,
        body: c.body,
        author: {
          name: c.user?.name || c.user?.login,
          username: c.user?.login,
          id: c.user?.id,
        },
      })),
    };
  } catch (error) {
    logger.error('Failed to fetch GitHub PR discussion thread', { error, repoFullname, pullNumber, commentId });
    throw error;
  }
}

export async function replyToReviewComment(
  repoFullname: string,
  pullNumber: number,
  commentId: number,
  body: string,
): Promise<void> {
  try {
    const { owner, repo } = parseRepo(repoFullname);
    // Reply comments are created by providing the parent comment ID
    await octokit.pulls.createReplyForReviewComment({
      owner,
      repo,
      pull_number: pullNumber,
      comment_id: commentId,
      body,
    });
    logger.info('Replied to GitHub review comment successfully', { repoFullname, commentId });
  } catch (error) {
    logger.error('Failed to reply to GitHub review comment', { error, repoFullname, commentId });
    throw error;
  }
}

export async function resolveReviewComment(
  repoFullname: string,
  pullNumber: number,
  commentId: number,
): Promise<void> {
  try {
    const { owner, repo } = parseRepo(repoFullname);
    // 1. Fetch target comment to get its node_id (GraphQL ID)
    const { data: targetComment } = await octokit.pulls.getReviewComment({
      owner,
      repo,
      comment_id: commentId,
    });

    const nodeId = targetComment.node_id;

    // 2. Query GitHub GraphQL to get the thread ID for this comment node
    const getThreadResult = await octokit.graphql({
      query: `
        query GetCommentThread($nodeId: ID!) {
          node(id: $nodeId) {
            ... on PullRequestReviewComment {
              pullRequestReviewThread {
                id
                isResolved
              }
            }
          }
        }
      `,
      nodeId,
    }) as any;

    const thread = getThreadResult?.node?.pullRequestReviewThread;
    if (!thread) {
      logger.warn('Could not find GraphQL thread for GitHub comment node', { commentId, nodeId });
      return;
    }

    if (thread.isResolved) {
      logger.info('GitHub thread is already resolved', { threadId: thread.id });
      return;
    }

    // 3. Resolve the thread via mutation
    await octokit.graphql({
      query: `
        mutation ResolveThread($threadId: ID!) {
          resolveReviewThread(input: { threadId: $threadId }) {
            thread {
              id
              isResolved
            }
          }
        }
      `,
      threadId: thread.id,
    });
    logger.info('GitHub review thread resolved successfully', { threadId: thread.id });
  } catch (error) {
    logger.error('Failed to resolve GitHub review thread', { error, repoFullname, commentId });
    throw error;
  }
}
