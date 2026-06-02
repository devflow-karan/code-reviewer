import dotenv from 'dotenv';
import path from 'path';
dotenv.config();

export const config = {
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
    redis: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379,
    },
    gitlab: {
        url: process.env.GITLAB_URL || 'https://gitlab.com',
        token: process.env.GITLAB_TOKEN || '',
        webhookSecret: process.env.GITLAB_WEBHOOK_SECRET || '',
    },
    github: {
        token: process.env.GITHUB_TOKEN || '',
        webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
    },
    gemini: {
        apiKey: process.env.GEMINI_API_KEY || '',
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    },
    rulesPath: process.env.RULES_PATH || path.join(process.cwd(), 'rules/rules.md'),
};
