import { APP_URL } from "./constants.js";

/**
 * Returns the full skill.md content with the current APP_URL interpolated.
 * Served at GET /skill.md and GET /api/skill.
 *
 * Designed to be minimal and foolproof for AI agents — 4 curl commands,
 * each response includes a `next` field with the next step.
 */
export function getSkillContent(): string {
  return `# Akashi — Solana Yield API

Non-custodial Solana yield aggregator. Discover yields, deposit, withdraw, and monitor portfolios.
All transactions are unsigned — the user signs via a browser link.

Base URL: ${APP_URL}

## 1. Find the best yields

\`\`\`bash
curl ${APP_URL}/api/agent/yields
\`\`\`

Returns top 5 stablecoin yields sorted by APY. Each yield has an \`id\` you use to deposit.

Options: \`?asset_class=all\` for all assets, \`?limit=10\` for more results.

## 2. Deposit

\`\`\`bash
curl -X POST ${APP_URL}/api/agent/deposit-link \\
  -H "Content-Type: application/json" \\
  -d '{"opportunity_id": 42, "amount": "100"}'
\`\`\`

Returns a \`sign_url\`. Show it to the user — they click it, connect their wallet, and sign.

For leveraged (multiply) positions, add \`"leverage": 2.0\`.

## 3. Withdraw

\`\`\`bash
curl -X POST ${APP_URL}/api/agent/withdraw-link \\
  -H "Content-Type: application/json" \\
  -d '{"opportunity_id": 42, "amount": "50"}'
\`\`\`

Returns a \`sign_url\`. Same flow as deposit.

## 4. Check portfolio

\`\`\`bash
curl ${APP_URL}/api/agent/portfolio/WALLET_ADDRESS
\`\`\`

Returns positions, PnL, APY, and analytics. Auto-tracks the wallet on first call.
If status is \`"fetching"\`, wait 10 seconds and try again.

---

Every response includes a \`next\` field telling you what to do next.
`;
}
