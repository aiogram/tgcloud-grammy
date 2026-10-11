import { EndpointError } from 'sdk';
import { defineEndpoint } from '@aiogram/tgcloud-grammy';

export default defineEndpoint<{ lang: string }, { hello: string }>(async (input, ctx) => {
  const user = ctx.initData.user;
  if (!user) throw new EndpointError('Not allowed', { code: 'NO_USER' });
  return { hello: `${user.first_name}/${input.lang}` };
});
