import serverless from 'serverless-http';
import { createApiApp } from '../../api-app.ts';

const app = createApiApp({ mountRootFallback: true });

export const handler = serverless(app, {
  binary: ['image/*', 'video/*', 'audio/*', 'application/octet-stream'],
});
