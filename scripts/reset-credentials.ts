/**
 * Operator recovery: issue a new one-time set-password link for an existing user from the command line
 * (e.g. the only administrator lost their password). Everything else goes through Administration → Users.
 *
 *   RESET_USERNAME=jwilson APP_STORE=mssql DASH_CONNECTION_STRING="..." npm run reset:credentials
 */
import { getIdentityStore } from "../src/server/identity";
import { resetCredentials } from "../src/server/identity/service";
import { closePools } from "../src/server/db/mssql";
import type { Principal } from "../src/server/authz/permissions";

async function main() {
  const username = process.env.RESET_USERNAME;
  if (!username) throw new Error("Set RESET_USERNAME.");
  const user = await getIdentityStore().getUserByUsername(username);
  if (!user) throw new Error(`No user '${username}'.`);
  const system: Principal = { userId: "00000000-0000-0000-0000-000000000000", displayName: "cli-reset", email: "", roles: [], extraPermissions: [] };
  const { token } = await resetCredentials(system, user.id);
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  console.log(`New one-time set-password link for ${user.username} (valid ${process.env.CREDENTIAL_TOKEN_HOURS ?? 72} h, single use; previous links and sessions are now invalid):`);
  console.log(`${base}/set-password?token=${encodeURIComponent(token)}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closePools().catch(() => undefined));
