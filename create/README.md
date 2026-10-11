# @aiogram/create-tgcloud-grammy

Scaffolds a TypeScript + grammY bot for the [Telegram Serverless](https://core.telegram.org/bots/serverless) platform:

```sh
npm create @aiogram/tgcloud-grammy my_bot
```

It installs `@tgcloud/cli`, [`@aiogram/tgcloud-grammy`](https://github.com/aiogram/tgcloud-grammy), TypeScript and grammY, and runs `tgcloud-grammy init`, which creates the official tgcloud project and adds a starter bot in `src/`. It asks whether to add a GitHub Actions workflow that deploys on every push to `main` (`-- --github-actions` without a terminal), makes an initial git commit (`-- --no-git` skips it) and offers `tgcloud login`.

See [the main package](https://github.com/aiogram/tgcloud-grammy#readme) for usage.
