/** Main API Lambda (everything except the privileged /me + contact-reveal routes). */
import { handle } from 'hono/aws-lambda';
import { createApp } from './app';
import { lambdaDeps } from './lambdaDeps';

export const handler = handle(createApp(await lambdaDeps('main')));
