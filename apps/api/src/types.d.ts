import type { User } from '@prisma/client';
import type { AyContext } from './middleware/ay';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      sessionId?: string;
      ctx?: AyContext;
    }
  }
}

export {};
