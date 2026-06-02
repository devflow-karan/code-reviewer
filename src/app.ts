import express, { Request, Response, NextFunction } from 'express';
import webhookRouter from './routes/webhook';
import githubWebhookRouter from './routes/github';
import { config } from './config';
import { logger } from './utils/logger';

const app = express();

app.use(express.json({
  limit: '50mb',
  verify: (req: any, res, buf) => {
    req.rawBody = buf;
  }
}));

// Gracefully handle malformed JSON payloads from incoming requests
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof SyntaxError && 'status' in err && err.status === 400 && 'body' in err) {
    logger.error('Invalid JSON payload received by Express', { error: err.message });
    res.status(400).json({ error: 'Invalid JSON payload' });
    return;
  }
  next(err);
});

app.use('/gitlab', webhookRouter);
app.use('/github', githubWebhookRouter);

// Start the queue worker in-process by default unless disabled by environment variable
if (process.env.DISABLE_WORKER !== 'true') {
  require('./queue/worker');
}

app.listen(config.port, () => {
  logger.info(`Server running on port ${config.port}`);
});
