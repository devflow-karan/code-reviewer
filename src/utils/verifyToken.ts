import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export const verifyGitLabToken = (req: Request, res: Response, next: NextFunction): void => {
    const token = req.headers['x-gitlab-token'];
    
    if (!token || token !== config.gitlab.webhookSecret) {
        res.status(401).json({ error: 'Unauthorized webhook token' });
        return;
    }
    
    next();
};
