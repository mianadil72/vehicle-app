// Create a user, or reset an existing user's password/role.
//
//   npm run user -- <username> --role admin      create or reset an admin (prompts for the password)
//   npm run user -- <username> --role manager    lead sales manager: sees and assigns all customer leads
//   npm run user -- <username> --role sales      sales rep: follows up on the leads assigned to them
//   npm run user -- <username> --role staff      view-only account
//   npm run user -- <username> --deactivate      block sign-in and end their sessions
//   npm run user -- <username> --email a@b.com --mobile "(555) 123-4567"
//                                                  set work email/mobile (no password prompt without --role;
//                                                  pass "" to clear). Can also be combined with --role.
//   npm run user -- --list                        show all accounts
//
// The password is read from the terminal without echoing it, or from the first line of stdin when piped.
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { closePools, getPool, sql } from '../db.ts';
import { MIN_PASSWORD_LENGTH, hashPassword } from '../auth.ts';
import { ROLES, type Role } from '../../src/types.ts';
import { validateStaffContact } from '../../src/leadValidation.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    role: { type: 'string' },
    deactivate: { type: 'boolean', default: false },
    list: { type: 'boolean', default: false },
    email: { type: 'string' },
    mobile: { type: 'string' },
  },
});

function readPassword(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  if (process.stdin.isTTY) {
    // Hide typed characters: print only the prompt itself.
    const rlOut = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WritableStream };
    rlOut._writeToOutput = (s) => {
      if (s.includes(prompt)) rlOut.output.write(prompt);
      else if (s.includes('\n') || s.includes('\r')) rlOut.output.write('\n');
    };
  }
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);

  if (values.list) {
    const { recordset } = await pool.request().query(
      'SELECT Username, Role, Email, Mobile, IsActive, LastLoginAt FROM dbo.Users ORDER BY Username',
    );
    console.table(recordset);
    return;
  }

  const username = positionals[0]?.trim().toLowerCase();
  if (!username || !/^[a-z0-9._-]{3,50}$/.test(username)) {
    throw new Error('Give a username of 3-50 characters (letters, numbers, . _ -), e.g. npm run user -- jsmith --role admin');
  }

  if (values.deactivate) {
    const result = await pool.request().input('username', mssql.NVarChar(50), username).query(`
      UPDATE dbo.Users SET IsActive = 0 WHERE Username = @username;
      DELETE s FROM dbo.Sessions s JOIN dbo.Users u ON u.UserId = s.UserId WHERE u.Username = @username;`);
    if (result.rowsAffected[0] === 0) throw new Error(`No user named ${username}`);
    console.log(`Deactivated ${username} and signed them out everywhere.`);
    return;
  }

  // --email / --mobile: update the given contact fields, keeping the other one as it is.
  const contactGiven = values.email !== undefined || values.mobile !== undefined;
  const setContact = async () => {
    const current = await pool
      .request()
      .input('username', mssql.NVarChar(50), username)
      .query<{ Email: string | null; Mobile: string | null }>('SELECT Email, Mobile FROM dbo.Users WHERE Username = @username');
    const row = current.recordset[0];
    if (!row) throw new Error(`No user named ${username}`);
    const check = validateStaffContact(values.email ?? row.Email ?? '', values.mobile ?? row.Mobile ?? '');
    if (!check.ok) throw new Error(Object.values(check.errors).join('; '));
    try {
      await pool
        .request()
        .input('username', mssql.NVarChar(50), username)
        .input('email', mssql.NVarChar(254), check.value.email)
        .input('mobile', mssql.VarChar(16), check.value.mobile)
        .query('UPDATE dbo.Users SET Email = @email, Mobile = @mobile WHERE Username = @username');
    } catch (err) {
      throw (err as { number?: number }).number === 2601 ? new Error('Another account already uses that email') : err;
    }
    console.log(`${username}: email ${check.value.email ?? '(none)'}, mobile ${check.value.mobile ?? '(none)'}`);
  };
  if (contactGiven && values.role === undefined) {
    await setContact();
    return;
  }

  const role = values.role as Role | undefined;
  if (!role || !(ROLES as readonly string[]).includes(role)) throw new Error(`--role must be one of: ${ROLES.join(', ')}`);

  const password = await readPassword(`Password for ${username}: `);
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  if (process.stdin.isTTY && (await readPassword('Repeat password: ')) !== password) throw new Error("Passwords don't match");

  // Upsert; resetting a password also signs the user out of existing sessions.
  const { recordset } = await pool
    .request()
    .input('username', mssql.NVarChar(50), username)
    .input('hash', mssql.VarChar(200), await hashPassword(password))
    .input('role', mssql.VarChar(10), role)
    .query<{ action: string }>(`
      DECLARE @out TABLE (action NVARCHAR(10));
      MERGE dbo.Users WITH (HOLDLOCK) AS t
      USING (SELECT @username AS Username) AS s ON t.Username = s.Username
      WHEN MATCHED THEN UPDATE SET PasswordHash = @hash, Role = @role, IsActive = 1
      WHEN NOT MATCHED THEN INSERT (Username, PasswordHash, Role) VALUES (@username, @hash, @role)
      OUTPUT $action INTO @out;
      DELETE s FROM dbo.Sessions s JOIN dbo.Users u ON u.UserId = s.UserId WHERE u.Username = @username;
      SELECT action FROM @out;`);
  console.log(`${recordset[0]?.action === 'INSERT' ? 'Created' : 'Updated'} ${role} account "${username}".`);
  if (contactGiven) await setContact();
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closePools();
}
