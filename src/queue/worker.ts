import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import * as crypto from 'crypto';
import * as gitlab from '../services/gitlab.service';
import * as github from '../services/github.service';
import { reviewCode, reviewMrMetadata, AIReviewResult } from '../services/ai.service';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface ReviewJobData {
  platform?: 'gitlab' | 'github';
  projectId: number | string;
  mrIid: number;
  sha: string;
}

const connection = new IORedis({
  host: config.redis.host,
  port: config.redis.port,
  maxRetriesPerRequest: null,
});

logger.info('Worker started and listening on queue: review-queue');

new Worker(
  'review-queue',
  async (job: Job<ReviewJobData>) => {
    const {
      platform,
      projectId,
      mrIid,
      sha,
    } = job.data;

    const isGitLab = platform !== 'github';

    const git = isGitLab ? {
      getMrChanges: (pid: string | number, iid: number) => gitlab.getMrChanges(pid as number, iid),
      getMrCommits: (pid: string | number, iid: number) => gitlab.getMrCommits(pid as number, iid),
      setCommitStatus: (pid: string | number, s: string, st: any) => gitlab.setCommitStatus(pid as number, s, st),
      blockMr: (pid: string | number, iid: number, t: string) => gitlab.blockMr(pid as number, iid, t),
      getMrNotes: (pid: string | number, iid: number) => gitlab.getMrNotes(pid as number, iid),
      compareCommits: (pid: string | number, f: string, t: string) => gitlab.compareCommits(pid as number, f, t),
      createMrDiscussion: (pid: string | number, iid: number, b: string, pos?: any) => gitlab.createMrDiscussion(pid as number, iid, b, pos),
    } : {
      getMrChanges: (pid: string | number, iid: number) => github.getPrChanges(pid as string, iid),
      getMrCommits: (pid: string | number, iid: number) => github.getPrCommits(pid as string, iid),
      setCommitStatus: (pid: string | number, s: string, st: any) => github.setCommitStatus(pid as string, s, st),
      blockMr: (pid: string | number, iid: number, t: string) => github.blockPr(pid as string, iid, t),
      getMrNotes: (pid: string | number, iid: number) => github.getPrComments(pid as string, iid),
      compareCommits: (pid: string | number, f: string, t: string) => github.compareCommits(pid as string, f, t),
      createMrDiscussion: (pid: string | number, iid: number, b: string, pos?: any) => {
        const githubPosition = pos ? {
          path: pos.newPath,
          line: pos.newLine,
          commitId: pos.headSha,
        } : undefined;
        return github.createPrDiscussion(pid as string, iid, b, githubPosition);
      },
    };

    const {
      getMrChanges,
      getMrCommits,
      setCommitStatus,
      blockMr,
      getMrNotes,
      compareCommits,
      createMrDiscussion,
    } = git;

    logger.info('Processing review job', { platform: platform || 'gitlab', projectId, mrIid, sha });
    try {
      const mr = await getMrChanges(
        projectId,
        mrIid,
      );
      logger.info('MR changes fetched', { fileCount: mr.changes?.length });

      const mrState = mr.state || 'opened';
      if (mrState === 'closed' || mrState === 'merged') {
        logger.info(`MR ${mrIid} state is "${mrState}". Skipping review and cancelling commit status.`);
        await setCommitStatus(
          projectId,
          sha,
          'canceled',
        );
        return;
      }

      let hasFailure = false;

      // Review MR metadata (title, description, and commits) once
      const mrTitle = mr.title || '';
      const mrDescription = mr.description || '';
      logger.info('Fetching MR commits for metadata validation...');
      const commits = await getMrCommits(projectId, mrIid);

      logger.info('Reviewing MR metadata (Title, Description, Commits)...');
      const metadataReview = await reviewMrMetadata(mrTitle, mrDescription, commits);

      if (metadataReview) {
        try {
          const parsedMetadata = JSON.parse(metadataReview) as AIReviewResult;
          logger.info('AI parsed metadata result', { decision: parsedMetadata.decision, commentCount: parsedMetadata.comments?.length });

          if (parsedMetadata.comments && Array.isArray(parsedMetadata.comments)) {
            for (const comment of parsedMetadata.comments) {
              logger.info(`Adding metadata discussion: ${comment.message}`);
              await createMrDiscussion(
                projectId,
                mrIid,
                `
⚠️ **Metadata Review Issue**

Severity: ${comment.severity}

${comment.message}
                `,
              );
            }
          }

          if (parsedMetadata.decision === 'changes_requested') {
            hasFailure = true;
          }
        } catch (error) {
          logger.error('Failed to parse AI metadata review JSON', { error, metadataReview });
        }
      }

      logger.info('Fetching existing MR notes to detect previously reviewed files...');
      const notes = await getMrNotes(projectId, mrIid);
      const fileCommentsMap = new Map<string, { diffHash: string; decision: string; commitSha?: string }>();
      let latestReviewedSha: string | null = null;

      for (const note of notes) {
        const body = note.body || '';
        const fileMatch = body.match(/File:\s*([^\s\n]+)/);
        const metadataMatch = body.match(/<!--\s*metadata:\s*({.+?})\s*-->/);
        if (fileMatch && metadataMatch) {
          const filePath = fileMatch[1].trim();
          try {
            const meta = JSON.parse(metadataMatch[1]) as { diffHash: string; decision: string; commitSha?: string };
            const existing = fileCommentsMap.get(filePath);
            if (!existing || meta.decision === 'changes_requested') {
              fileCommentsMap.set(filePath, meta);
            }
            if (meta.commitSha) {
              latestReviewedSha = meta.commitSha;
            }
          } catch (e) {
            // ignore JSON parse error
          }
        }
      }

      const incrementalDiffsMap = new Map<string, string>();
      if (latestReviewedSha && latestReviewedSha !== sha) {
        logger.info(`Comparing previous reviewed SHA ${latestReviewedSha} with current SHA ${sha} for incremental review...`);
        const comparison = await compareCommits(projectId, latestReviewedSha, sha);
        if (comparison && comparison.diffs) {
          for (const d of comparison.diffs) {
            if (d.diff && d.new_path) {
              incrementalDiffsMap.set(d.new_path, d.diff);
            }
          }
        }
      }

      if (!mr.changes || mr.changes.length === 0) {
        logger.info('No changes found in the MR');
      }

      for (const file of mr.changes || []) {
        // Skip files in the docs/ folder
        if ((file.new_path && file.new_path.startsWith('docs/')) || (file.old_path && file.old_path.startsWith('docs/'))) {
          logger.info(`Skipping file ${file.new_path} because it is in the docs/ folder`);
          continue;
        }

        if ((file.new_path && file.new_path.startsWith('.agent/')) || (file.old_path && file.old_path.startsWith('.agent/'))) {
          logger.info(`Skipping file ${file.new_path} because it is in the .agent/ folder`);
          continue;
        }

        logger.info(`Analyzing file: ${file.new_path}`, { hasDiff: !!file.diff });
        if (!file.diff) {
          logger.info(`Skipping file ${file.new_path} because it has no diff (empty or binary file)`);
          continue;
        }

        const currentHash = crypto.createHash('sha256').update(file.diff).digest('hex');
        const previousMeta = fileCommentsMap.get(file.new_path);
        if (previousMeta && previousMeta.diffHash === currentHash) {
          logger.info(`Skipping file review for ${file.new_path} because the diff has not changed since the last review.`);
          if (previousMeta.decision === 'changes_requested') {
            logger.info(`Flagging failure for ${file.new_path} due to previous changes_requested decision on the same diff.`);
            hasFailure = true;
          }
          continue;
        }

        const incrementalDiff = incrementalDiffsMap.get(file.new_path);
        const diffToReview = incrementalDiff !== undefined ? incrementalDiff : file.diff;

        if (incrementalDiff !== undefined) {
          logger.info(`Using incremental diff for file ${file.new_path} (size: ${incrementalDiff.length})`);
        } else {
          logger.info(`Sending full file diff to AI for review: ${file.new_path}`);
        }

        const review = await reviewCode(
          diffToReview,
        );
        logger.info(`AI review response received for ${file.new_path}`, { reviewLength: review?.length });

        if (!review) {
          logger.info(`No review content returned for ${file.new_path}`);
          continue;
        }

        let parsed: AIReviewResult;
        try {
          parsed = JSON.parse(review) as AIReviewResult;
        } catch (error) {
          logger.error('Failed to parse AI review JSON', { error, review });
          continue;
        }

        logger.info(`AI parsed result for ${file.new_path}`, { decision: parsed.decision, commentCount: parsed.comments?.length });

        if (!parsed.comments || !Array.isArray(parsed.comments)) {
          logger.info(`No comments array found in AI response for ${file.new_path}`);
          continue;
        }

        for (const comment of parsed.comments) {
          logger.info(`Adding inline discussion to MR for file ${file.new_path} at line ${comment.line}`);
          const metadataStr = JSON.stringify({
            diffHash: currentHash,
            decision: parsed.decision,
            commitSha: sha,
          });
          
          const position = mr.diff_refs ? {
            baseSha: mr.diff_refs.base_sha,
            headSha: mr.diff_refs.head_sha,
            startSha: mr.diff_refs.start_sha,
            positionType: 'text' as const,
            newPath: file.new_path,
            oldPath: file.old_path,
            newLine: comment.line,
          } : undefined;

          await createMrDiscussion(
            projectId,
            mrIid,
            `
File: ${file.new_path}

Severity: ${comment.severity}

${comment.message}

<!-- metadata: ${metadataStr} -->
            `,
            position,
          );
        }

        if (
          parsed.decision ===
          'changes_requested'
        ) {
          hasFailure = true;
        }
      }

      logger.info(`Completed reviewing all files. Final decision: ${hasFailure ? 'changes_requested (failed)' : 'approved (success)'}`);

      if (hasFailure) {
        logger.info(`Blocking MR ${mrIid} due to failed review/cancellation...`);
        // await blockMr(projectId, mrIid, mrTitle);
      }

      logger.info(`Updating GitLab commit status for SHA ${sha} to ${hasFailure ? 'failed' : 'success'}`);
      await setCommitStatus(
        projectId,
        sha,
        hasFailure
          ? 'failed'
          : 'success',
      );
      logger.info(`Successfully updated GitLab commit status for SHA ${sha}`);
    } catch (error) {
      logger.error('Worker failed to process MR', { error });

      await setCommitStatus(
        projectId,
        sha,
        'failed',
      );
    }
  },
  {
    connection,
  },
);
