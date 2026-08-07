/**
 * Local / CI TURN config template.
 * Copy to ice-config.js and set your Metered Open Relay credential API key:
 *
 *   cp docs/js/ice-config.example.js docs/js/ice-config.js
 *
 * ice-config.js is gitignored. GitHub Actions generates it on Pages deploy.
 */
export const TURN_CREDENTIALS_URL =
  "https://fulline.metered.live/api/v1/turn/credentials?apiKey=YOUR_API_KEY";
