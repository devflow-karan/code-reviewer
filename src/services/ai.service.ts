// AI Service
import axios from 'axios';
import fs from 'fs/promises';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface AIReviewComment {
    severity: 'low' | 'medium' | 'high';
    message: string;
    line: number;
}

export interface AIReviewResult {
    decision: 'approved' | 'changes_requested';
    comments: AIReviewComment[];
}

export async function reviewCode(diff: string): Promise<string | null> {
    let rules = '';
    try {
        rules = await fs.readFile(config.rulesPath, 'utf8');
    } catch (error) {
        logger.warn('Failed to read review rules file, using fallback defaults', { error });
        rules = '- No raw SQL\n- No any type\n- DTO validation mandatory\n- Avoid business logic in controllers';
    }

    const prompt = `
You are a senior backend reviewer.

Review this git diff.

Rules:
${rules}

Diff:
${diff}
`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}:generateContent?key=${config.gemini.apiKey}`;

    const payload = {
        contents: [
            {
                parts: [
                    {
                        text: prompt,
                    },
                ],
            },
        ],
        generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: 'OBJECT',
                properties: {
                    decision: {
                        type: 'STRING',
                        enum: ['approved', 'changes_requested'],
                    },
                    comments: {
                        type: 'ARRAY',
                        items: {
                            type: 'OBJECT',
                            properties: {
                                severity: {
                                    type: 'STRING',
                                    enum: ['low', 'medium', 'high'],
                                },
                                message: {
                                    type: 'STRING',
                                    description: 'Detailed code review feedback and recommendations.',
                                },
                                line: {
                                    type: 'INTEGER',
                                    description: 'The line number of the file associated with this comment.',
                                },
                            },
                            required: ['severity', 'message', 'line'],
                        },
                    },
                },
                required: ['decision', 'comments'],
            },
        },
    };

    try {
        const response = await axios.post(url, payload, {
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 60000,
        });

        const content = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        return content;
    } catch (error: any) {
        logger.error('Gemini AI Review request failed', {
            error: error.response?.data || error.message || error,
        });
        throw error;
    }
}

export async function reviewMrMetadata(
    title: string,
    description: string,
    commits: string[]
): Promise<string | null> {
    let rules = '';
    try {
        rules = await fs.readFile(config.rulesPath, 'utf8');
    } catch (error) {
        logger.warn('Failed to read review rules file, using fallback defaults', { error });
        rules = '- Check Git commit messages and the Merge Request title to ensure they follow Conventional Commits conventions\n- Ensure the Merge Request description is available and contains detail';
    }

    const prompt = `
You are a senior backend reviewer.

Review the Merge Request metadata.

Rules:
${rules}

Metadata:
MR Title: ${title}
MR Description: ${description}
Commits:
${commits.map(c => `- ${c}`).join('\n')}
`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}:generateContent?key=${config.gemini.apiKey}`;

    const payload = {
        contents: [
            {
                parts: [
                    {
                        text: prompt,
                    },
                ],
            },
        ],
        generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: 'OBJECT',
                properties: {
                    decision: {
                        type: 'STRING',
                        enum: ['approved', 'changes_requested'],
                    },
                    comments: {
                        type: 'ARRAY',
                        items: {
                            type: 'OBJECT',
                            properties: {
                                severity: {
                                    type: 'STRING',
                                    enum: ['low', 'medium', 'high'],
                                },
                                message: {
                                    type: 'STRING',
                                    description: 'Detailed feedback and recommendations regarding conventional commits or description requirements.',
                                },
                                line: {
                                    type: 'INTEGER',
                                    description: 'Set to 0 for general metadata issues.',
                                },
                            },
                            required: ['severity', 'message', 'line'],
                        },
                    },
                },
                required: ['decision', 'comments'],
            },
        },
    };

    try {
        const response = await axios.post(url, payload, {
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 60000,
        });

        const content = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        return content;
    } catch (error: any) {
        logger.error('Gemini AI Metadata Review request failed', {
            error: error.response?.data || error.message || error,
        });
        throw error;
    }
}

export async function reviewCommentAndRespond(
    discussionContext: string
): Promise<{ reply: string; shouldResolve: boolean } | null> {
    const prompt = `
You are a senior backend reviewer bot. A developer has replied to one of your review comments on a Merge Request.

Here is the discussion thread history:
${discussionContext}

The first comment is your original review. The subsequent comments are replies between you and the developer.

Analyze the discussion and determine:
1. An appropriate, polite, and constructive response to the developer's latest comment.
2. Whether the issue has been resolved or if both parties agree that the point is resolved (e.g. the developer has fixed the issue, or explained why the code is correct and you agree, or there is agreement on the next steps/resolution).
If you both agree that the point is resolved or addressed, set "shouldResolve" to true. Otherwise, set it to false.

Respond ONLY with a JSON object in this format:
{
  "reply": "Your reply comment text here.",
  "shouldResolve": true
}
`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}:generateContent?key=${config.gemini.apiKey}`;

    const payload = {
        contents: [
            {
                parts: [
                    {
                        text: prompt,
                    },
                ],
            },
        ],
        generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: 'OBJECT',
                properties: {
                    reply: {
                        type: 'STRING',
                        description: 'Your polite response to the developer.'
                    },
                    shouldResolve: {
                        type: 'BOOLEAN',
                        description: 'Set to true if both parties agree that the issue has been addressed or resolved.'
                    }
                },
                required: ['reply', 'shouldResolve'],
            },
        },
    };

    try {
        const response = await axios.post(url, payload, {
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 60000,
        });

        const content = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        try {
            return JSON.parse(content);
        } catch (e) {
            logger.error('Failed to parse AI comment review response JSON', { content, error: e });
            return null;
        }
    } catch (error: any) {
        logger.error('Gemini AI Comment Review request failed', {
            error: error.response?.data || error.message || error,
        });
        return null;
    }
}

