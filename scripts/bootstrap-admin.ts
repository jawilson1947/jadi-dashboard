/**
 * Creates the FIRST administrator and prints a one-time set-password link (USER-MANAGEMENT-PLAN Sec.8).
 * Refuses to run when any administrator already exists — after that, use Administration → Users.
 *
 *   BOOTSTRAP_ADMIN_USERNAME=jwilson BOOTSTRAP_ADMIN_EMAIL=jwilson@example.edu BOOTSTRAP_ADMIN_NAME="Jim Wilson" \
 *   APP_STORE=mssql DASH_CONNECTION_STRING="..." npm run bootstrap:admin
 *
 * With APP_STORE=memory the user is written to IDENTITY_STORE_FILE. Nothing is printed except the link.
 */
import { bootstrapAdministrator } from "../src/server/identity/service";
import { closePools } from "../src/server/db/mssql";

async function main() {
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME;
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const displayName = process.env.BOOTSTRAP_ADMIN_NAME ?? username;
  if (!username || !email || !displayName) throw new Error("Set BOOTSTRAP_ADMIN_USERNAME, BOOTSTRAP_ADMIN_EMAIL (and optionally BOOTSTRAP_ADMIN_NAME).");
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const { user, token } = await bootstrapAdministrator({ username, email, displayName });
  console.log(`Administrator created: ${user.username} (${user.email})`);
  console.log(`One-time set-password link (valid ${process.env.CREDENTIAL_TOKEN_HOURS ?? 72} h, single use):`);
  console.log(`${base}/set-password?token=${encodeURIComponent(token)}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closePools().catch(() => undefined));
