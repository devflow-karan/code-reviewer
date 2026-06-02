import { Router } from 'express';
import { reviewQueue } from '../queue/queue';
import {
  setCommitStatus,
  getBotUser,
  getMrDiscussion,
  addNoteToDiscussion,
  resolveDiscussion,
} from '../services/gitlab.service';
import { reviewCommentAndRespond } from '../services/ai.service';
import { logger } from '../utils/logger';
import { config } from '../config';

const router = Router();

async function handleAIResponseAndResolution(
  projectId: number,
  mrIid: number,
  discussionId: string,
  discussion: any,
): Promise<void> {
  // Format discussion notes for AI context
  const discussionContext = discussion.notes
    .map((note: any) => `${note.author.name || note.author.username}: ${note.body}`)
    .join('\n\n');

  logger.info('Sending discussion thread context to AI for reply and resolution analysis...', { discussionId });
  const aiResult = await reviewCommentAndRespond(discussionContext);
  if (!aiResult) {
    logger.warn('AI returned empty result for discussion comment response', { discussionId });
    return;
  }

  logger.info('AI decision for discussion thread', {
    discussionId,
    shouldResolve: aiResult.shouldResolve,
    replySnippet: aiResult.reply?.substring(0, 50),
  });

  // Post the AI-generated reply
  if (aiResult.reply) {
    await addNoteToDiscussion(projectId, mrIid, discussionId, aiResult.reply);
  }

  // Resolve the discussion if agreed
  if (aiResult.shouldResolve) {
    await resolveDiscussion(projectId, mrIid, discussionId, true);
  }
}

router.post('/webhook', async (req, res) => {
  try {
    const token = req.headers['x-gitlab-token'];

    if (token !== config.gitlab.webhookSecret) {
      return res.sendStatus(401);
    }
    
    const body = req.body;
    logger.info('Received webhook', { 
      objectKind: body?.object_kind, 
      projectId: body?.project?.id, 
      mrIid: body?.object_kind === 'note' ? body?.merge_request?.iid : body?.object_attributes?.iid 
    });

    if (body.object_kind === 'note') {
      const noteableType = body.object_attributes?.noteable_type;
      const isSystem = body.object_attributes?.system;
      const noteText = body.object_attributes?.note;
      const authorId = body.object_attributes?.author_id;
      const discussionId = body.object_attributes?.discussion_id;
      const projectId = body.project?.id;
      const mrIid = body.merge_request?.iid;

      if (noteableType !== 'MergeRequest') {
        logger.info('Note event skipped: not on a Merge Request', { noteableType });
        return res.json({ requiresReReview: false });
      }

      if (isSystem) {
        logger.info('Note event skipped: system note');
        return res.json({ requiresReReview: false });
      }

      if (!projectId || !mrIid || !discussionId || !noteText) {
        logger.warn('Note event skipped: missing required fields', { projectId, mrIid, discussionId, hasNoteText: !!noteText });
        return res.json({ requiresReReview: false });
      }

      // Fetch bot user details to filter out notes written by the AI bot itself
      const botUser = await getBotUser();
      if (authorId === botUser.id) {
        logger.info('Note event skipped: note written by the AI bot itself');
        return res.json({ requiresReReview: false });
      }

      // Retrieve the discussion thread
      logger.info('Fetching discussion thread', { projectId, mrIid, discussionId });
      const discussion = await getMrDiscussion(projectId, mrIid, discussionId);
      if (!discussion || !discussion.notes || discussion.notes.length === 0) {
        logger.warn('Discussion thread empty or not found', { discussionId });
        return res.json({ requiresReReview: false });
      }

      // Inspect parent (first) note to verify if it contains AI review metadata
      const parentNote = discussion.notes[0];
      const parentBody = parentNote.body || '';
      const containsMetadata = /<!--\s*metadata:\s*({.+?})\s*-->/.test(parentBody);

      if (!containsMetadata) {
        logger.info('Note event skipped: discussion does not originate from an AI review comment');
        return res.json({ requiresReReview: false });
      }

      // Determine if developer's reply indicates a request/need for a re-review
      const triggerWords = ['fixed', 'resolved', 'done', 'please recheck', 'updated'];
      const lowercaseNote = noteText.toLowerCase();
      const requiresReReview = triggerWords.some(word => lowercaseNote.includes(word));

      // Asynchronous background execution of AI response & discussion resolution
      handleAIResponseAndResolution(projectId, mrIid, discussionId, discussion).catch(error => {
        logger.error('Failed in background AI discussion response handler', { error, discussionId });
      });

      if (requiresReReview) {
        const sha = body.merge_request?.last_commit?.id;
        if (!sha) {
          logger.warn('Re-review required but MR last commit SHA is missing', { mrIid });
          return res.json({ requiresReReview: false });
        }
        
        logger.info('Enqueuing re-review job into BullMQ', { projectId, mrIid, sha });
        await setCommitStatus(projectId, sha, 'pending');
        await reviewQueue.add('review-mr', {
          projectId,
          mrIid,
          sha,
        });

        return res.json({ requiresReReview: true, action: 'enqueue_re_review' });
      }

      return res.json({ requiresReReview: false });
    }

    if (body.object_kind !== 'merge_request') {
      return res.sendStatus(200);
    }

    const projectId = body.project?.id;
    const mrIid = body.object_attributes?.iid;
    const sha = body.object_attributes?.last_commit?.id;
    const action = body.object_attributes?.action;
    const state = body.object_attributes?.state;

    if (action === 'close' || state === 'closed' || state === 'merged') {
      if (projectId && sha) {
        logger.info(`MR closed or merged. Cancelling commit status for SHA ${sha} in project ${projectId}`);
        await setCommitStatus(projectId, sha, 'canceled');
      } else {
        logger.info('MR closed or merged, but projectId or SHA is missing.', { projectId, sha });
      }
      return res.sendStatus(200);
    }

    // GitLab "Test Webhook" payloads often omit 'action', so we fallback to checking if 'state' is 'opened'
    const isActionValid = action ? ['open', 'update', 'reopen'].includes(action) : state === 'opened';

    if (!isActionValid) {
      logger.info(`Webhook skipped: Action '${action}' or State '${state}' not eligible for review.`);
      return res.sendStatus(200);
    }

    await setCommitStatus(
      projectId,
      sha,
      'pending',
    );

    await reviewQueue.add('review-mr', {
      projectId,
      mrIid,
      sha,
    });

    return res.sendStatus(200);
  } catch (error) {
    logger.error('Webhook processing failed', { error });
    return res.sendStatus(500);
  }
});

export default router;
