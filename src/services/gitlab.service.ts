import { Gitlab } from '@gitbeaker/rest';
import { config } from '../config';

export const api = new Gitlab({
  host: config.gitlab.url,
  token: config.gitlab.token,
});

export type CommitStatusState = 'pending' | 'success' | 'failed' | 'canceled';

export interface GitLabFileChange {
  diff: string;
  new_path: string;
  old_path: string;
}

export interface GitLabDiffRefs {
  base_sha: string;
  head_sha: string;
  start_sha: string;
}

export interface GitLabMRChangesResponse {
  changes: GitLabFileChange[];
  title?: string;
  description?: string;
  state?: string;
  diff_refs?: GitLabDiffRefs;
}

import { logger } from '../utils/logger';

export async function setCommitStatus(
  projectId: number,
  sha: string,
  state: CommitStatusState,
): Promise<void> {
  try {
    await api.Commits.editStatus(
      projectId,
      sha,
      state,
      {
        context: 'ai-code-review',
      },
    );
  } catch (error) {
    const errorStr = JSON.stringify(error);
    if (errorStr.includes('Cannot transition status')) {
      logger.warn('GitLab commit status transition ignored (already in target state)', { state, sha });
      return;
    }
    logger.error('Failed to set GitLab commit status', { error });
    throw error;
  }
}

export async function getMrChanges(
  projectId: number,
  mrIid: number,
): Promise<GitLabMRChangesResponse> {
  const result = await api.MergeRequests.showChanges(
    projectId,
    mrIid,
  );
  
  return result as unknown as GitLabMRChangesResponse;
}

export async function getMrCommits(
  projectId: number,
  mrIid: number,
): Promise<string[]> {
  try {
    const commits = await api.MergeRequests.commits(
      projectId,
      mrIid,
    );
    if (!Array.isArray(commits)) {
      logger.warn('Commits response from GitLab is not an array', { commits });
      return [];
    }
    return commits.map((c: any) => c.message || c.title || '');
  } catch (error) {
    logger.error('Failed to fetch MR commits', { error });
    return [];
  }
}

export async function addMrComment(
  projectId: number,
  mrIid: number,
  body: string,
): Promise<void> {
  await api.MergeRequestNotes.create(
    projectId,
    mrIid,
    body,
  );
}

export async function blockMr(
  projectId: number,
  mrIid: number,
  currentTitle: string,
): Promise<void> {
  // 1. Try to edit title to prepend "Draft: "
  try {
    if (!currentTitle.startsWith('Draft:') && !currentTitle.startsWith('WIP:')) {
      const newTitle = `Draft: ${currentTitle}`;
      await api.MergeRequests.edit(projectId, mrIid, { title: newTitle });
      logger.info('MR title updated to Draft to block merge', { projectId, mrIid });
    }
  } catch (error) {
    logger.error('Failed to update MR title to Draft', { error, projectId, mrIid });
  }

  // 2. Try to unapprove
  try {
    await api.MergeRequestApprovals.unapprove(projectId, mrIid);
    logger.info('MR unapproved successfully', { projectId, mrIid });
  } catch (error) {
    logger.error('Failed to unapprove MR', { error, projectId, mrIid });
  }
}

export async function getMrNotes(
  projectId: number,
  mrIid: number,
): Promise<any[]> {
  try {
    const notes = await api.MergeRequestNotes.all(projectId, mrIid);
    return notes as any[];
  } catch (error) {
    logger.error('Failed to fetch MR notes', { error });
    return [];
  }
}

export async function compareCommits(
  projectId: number,
  from: string,
  to: string,
): Promise<any> {
  try {
    const comparison = await api.Repositories.compare(projectId, from, to);
    return comparison;
  } catch (error) {
    logger.warn('Failed to compare commits, falling back to full diff', { error, from, to });
    return null;
  }
}

export interface GitLabDiscussionPosition {
  baseSha: string;
  headSha: string;
  startSha: string;
  positionType: 'text';
  newPath: string;
  oldPath: string;
  newLine?: number;
  oldLine?: number;
}

export async function createMrDiscussion(
  projectId: number,
  mrIid: number,
  body: string,
  position?: GitLabDiscussionPosition,
): Promise<void> {
  try {
    const options: any = {};
    if (position) {
      options.position = {
        baseSha: position.baseSha,
        headSha: position.headSha,
        startSha: position.startSha,
        positionType: position.positionType,
        newPath: position.newPath,
        oldPath: position.oldPath,
      };
      if (position.newLine !== undefined) {
        options.position.newLine = position.newLine;
      }
      if (position.oldLine !== undefined) {
        options.position.oldLine = position.oldLine;
      }
    }
    await api.MergeRequestDiscussions.create(projectId, mrIid, body, options);
    logger.info('Created discussion successfully', { projectId, mrIid, hasPosition: !!position });
  } catch (error) {
    if (position) {
      logger.warn('Failed to create inline discussion (likely because line number is not part of the MR diff). Falling back to global discussion...', {
        error,
        projectId,
        mrIid,
        newPath: position.newPath,
        newLine: position.newLine,
      });
      try {
        await api.MergeRequestDiscussions.create(projectId, mrIid, body);
        logger.info('Created fallback global discussion successfully', { projectId, mrIid });
        return;
      } catch (fallbackError) {
        logger.error('Failed to create fallback global discussion', { error: fallbackError, projectId, mrIid });
        throw fallbackError;
      }
    }
    logger.error('Failed to create discussion', { error, projectId, mrIid, body, position });
    throw error;
  }
}

let cachedBotUser: any = null;

export async function getBotUser(): Promise<any> {
  if (cachedBotUser) {
    return cachedBotUser;
  }
  try {
    cachedBotUser = await api.Users.showCurrentUser();
    return cachedBotUser;
  } catch (error) {
    logger.error('Failed to fetch bot user details', { error });
    throw error;
  }
}

export async function getMrDiscussion(
  projectId: number,
  mrIid: number,
  discussionId: string,
): Promise<any> {
  try {
    const discussion = await api.MergeRequestDiscussions.show(projectId, mrIid, discussionId);
    return discussion;
  } catch (error) {
    logger.error('Failed to fetch MR discussion', { error, projectId, mrIid, discussionId });
    throw error;
  }
}

export async function addNoteToDiscussion(
  projectId: number,
  mrIid: number,
  discussionId: string,
  body: string,
): Promise<void> {
  try {
    await api.MergeRequestDiscussions.addNote(projectId, mrIid, discussionId, body);
    logger.info('Added note to discussion successfully', { projectId, mrIid, discussionId });
  } catch (error) {
    logger.error('Failed to add note to discussion', { error, projectId, mrIid, discussionId });
    throw error;
  }
}

export async function resolveDiscussion(
  projectId: number,
  mrIid: number,
  discussionId: string,
  resolved: boolean = true,
): Promise<void> {
  try {
    await api.MergeRequestDiscussions.resolve(projectId, mrIid, discussionId, resolved);
    logger.info(`Discussion resolution status set to ${resolved}`, { projectId, mrIid, discussionId });
  } catch (error) {
    logger.error('Failed to update discussion resolution status', { error, projectId, mrIid, discussionId });
    throw error;
  }
}

