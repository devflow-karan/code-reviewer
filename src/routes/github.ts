import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { reviewQueue } from '../queue/queue';
import {
  setCommitStatus,
  getBotUser,
  getPrDiscussion,
  replyToReviewComment,
  resolveReviewComment,
} from '../services/github.service';
import { reviewCommentAndRespond } from '../services/ai.service';
import { logger } from '../utils/logger';
import { config } from '../config';

const router = Router();

// Middleware to verify GitHub webhook signatures
export function verifyGitHubSignature(req: Request, res: Response, next: NextFunction): void {
  const signature = req.headers['x-hub-signature-256'] as string;
  if (!signature) {
    logger.warn('Missing GitHub webhook signature header (x-hub-signature-256)');
    res.status(401).json({ error: 'Missing signature' });
    return;
  }
  
  if (!config.github.webhookSecret) {
    logger.warn('GITHUB_WEBHOOK_SECRET is not configured; skipping signature verification.');
    next();
    return;
  }

  const hmac = crypto.createHmac('sha256', config.github.webhookSecret);
  const rawBody = (req as any).rawBody;
  const payloadStr = rawBody ? rawBody.toString('utf8') : JSON.stringify(req.body);
  const digest = 'sha256=' + hmac.update(payloadStr).digest('hex');

  if (signature !== digest) {
    logger.error('Invalid GitHub webhook signature match');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  next();
}

async function handleAIResponseAndResolution(
  repoFullname: string,
  pullNumber: number,
  commentId: number,
  discussion: any,
): Promise<void> {
  // Format discussion notes for AI context
  const discussionContext = discussion.notes
    .map((note: any) => `${note.author.name || note.author.username}: ${note.body}`)
    .join('\n\n');

  logger.info('Sending discussion thread context to AI for reply and resolution analysis...', { commentId });
  const aiResult = await reviewCommentAndRespond(discussionContext);
  if (!aiResult) {
    logger.warn('AI returned empty result for discussion comment response', { commentId });
    return;
  }

  logger.info('AI decision for discussion thread', {
    commentId,
    shouldResolve: aiResult.shouldResolve,
    replySnippet: aiResult.reply?.substring(0, 50),
  });

  // Post the AI-generated reply
  if (aiResult.reply) {
    await replyToReviewComment(repoFullname, pullNumber, commentId, aiResult.reply);
  }

  // Resolve the discussion if agreed
  if (aiResult.shouldResolve) {
    await resolveReviewComment(repoFullname, pullNumber, commentId);
  }
}

router.post('/webhook', verifyGitHubSignature, async (req: Request, res: Response): Promise<any> => {
  try {
    const event = req.headers['x-github-event'] as string;
    const body = req.body;

    logger.info('Received GitHub webhook', { event, action: body?.action });

    // Handle review comment event (Replies on AI reviews)
    if (event === 'pull_request_review_comment') {
      const action = body.action;
      const comment = body.comment;
      const pullNumber = body.pull_request?.number;
      const repoFullname = body.repository?.full_name;
      const sha = body.pull_request?.head?.sha;

      if (action !== 'created') {
        logger.info('Comment event skipped: action is not created', { action });
        return res.json({ requiresReReview: false });
      }

      if (!repoFullname || !pullNumber || !comment || !sha) {
        logger.warn('Comment event skipped: missing required fields', { repoFullname, pullNumber, hasComment: !!comment, sha });
        return res.json({ requiresReReview: false });
      }

      // Filter out comments written by the bot itself
      const botUser = await getBotUser();
      if (comment.user?.id === botUser.id || comment.user?.login === botUser.login) {
        logger.info('Comment event skipped: comment authored by the bot itself');
        return res.json({ requiresReReview: false });
      }

      // Retrieve the discussion thread
      logger.info('Fetching comment discussion thread', { repoFullname, pullNumber, commentId: comment.id });
      const discussion = await getPrDiscussion(repoFullname, pullNumber, comment.id);
      if (!discussion || !discussion.notes || discussion.notes.length === 0) {
        logger.warn('Discussion thread empty or not found', { commentId: comment.id });
        return res.json({ requiresReReview: false });
      }

      // Inspect parent comment to verify if it contains AI review metadata
      const parentNote = discussion.notes[0];
      const parentBody = parentNote?.body || '';
      const containsMetadata = /<!--\s*metadata:\s*({.+?})\s*-->/.test(parentBody);

      if (!containsMetadata) {
        logger.info('Comment event skipped: discussion does not originate from an AI review comment');
        return res.json({ requiresReReview: false });
      }

      // Check if developer's comment has re-review triggers
      const triggerWords = ['fixed', 'resolved', 'done', 'please recheck', 'updated'];
      const lowercaseBody = (comment.body || '').toLowerCase();
      const requiresReReview = triggerWords.some(word => lowercaseBody.includes(word));

      // Asynchronously handle AI conversation response & thread resolution in background
      handleAIResponseAndResolution(repoFullname, pullNumber, comment.id, discussion).catch(error => {
        logger.error('Failed in background AI discussion response handler', { error, commentId: comment.id });
      });

      if (requiresReReview) {
        logger.info('Enqueuing re-review job into BullMQ', { repoFullname, pullNumber, sha });
        await setCommitStatus(repoFullname, sha, 'pending');
        await reviewQueue.add('review-mr', {
          platform: 'github',
          projectId: repoFullname,
          mrIid: pullNumber,
          sha,
        });

        return res.json({ requiresReReview: true, action: 'enqueue_re_review' });
      }

      return res.json({ requiresReReview: false });
    }

    // Handle pull request event
    if (event === 'pull_request') {
      const action = body.action;
      const pullNumber = body.pull_request?.number;
      const repoFullname = body.repository?.full_name;
      const sha = body.pull_request?.head?.sha;

      if (!repoFullname || !pullNumber || !sha) {
        logger.warn('PR event skipped: missing required fields', { repoFullname, pullNumber, sha });
        return res.sendStatus(400);
      }

      // Cancel review if closed/merged
      if (action === 'closed') {
        logger.info(`PR closed/merged. Cancelling commit status for SHA ${sha} in repo ${repoFullname}`);
        await setCommitStatus(repoFullname, sha, 'canceled');
        return res.sendStatus(200);
      }

      const isActionValid = ['opened', 'synchronize', 'reopened'].includes(action);
      if (!isActionValid) {
        logger.info(`PR event skipped: action '${action}' not eligible for review.`);
        return res.sendStatus(200);
      }

      await setCommitStatus(repoFullname, sha, 'pending');

      await reviewQueue.add('review-mr', {
        platform: 'github',
        projectId: repoFullname,
        mrIid: pullNumber,
        sha,
      });

      return res.sendStatus(200);
    }

    // Return 200 for unhandled events
    return res.sendStatus(200);
  } catch (error) {
    logger.error('GitHub webhook processing failed', { error });
    return res.sendStatus(500);
  }
});

export default router;
