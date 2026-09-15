# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Supabase and registration emails

The registration form sends a welcome email through the independent Cloudflare
Worker in `email-worker/`, rather than through a Lovable server function. Set
`VITE_EMAIL_WORKER_URL` to the deployed Worker URL. Deploy it with
`npx wrangler deploy` from `email-worker/`, then add `RESEND_API_KEY` and
`REGISTRATION_FROM_EMAIL` as Worker secrets with `wrangler secret put`. Set
the Worker `ALLOWED_ORIGIN`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY`
variables before deploying. Before deploying the app, connect it to its
Supabase project in **Lovable Cloud**. This injects `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, and the server-only `SUPABASE_SERVICE_ROLE_KEY`
(or `SUPABASE_SECRET_KEY`) needed by the admin/server functions.

The service-role key is a secret: never add it to a
`VITE_` variable, commit it, or paste it into client code.

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
