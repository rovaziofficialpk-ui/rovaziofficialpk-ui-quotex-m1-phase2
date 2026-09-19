# Deploy to Vercel

This project is configured as a Vite app with `vercel.json`.

## CLI
```bash
npm install
npm run typecheck
npm run build
npx vercel@latest --prod
```

The app is BYOK: do not add a Groq API key to Vercel environment variables for this Phase 2 build. Each user supplies their own key in the browser.
