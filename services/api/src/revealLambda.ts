/** Privileged Lambda: GET/PATCH /me and GET /claims/:id/contact. Its role alone has kms:Decrypt. */
import { handle } from 'hono/aws-lambda';
import { createApp } from './app';
import { lambdaDeps } from './lambdaDeps';

export const handler = handle(createApp(await lambdaDeps('privileged')));
