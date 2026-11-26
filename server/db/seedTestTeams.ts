// Test data only (not part of db:setup): puts the test.rep01-25 accounts in teams of 5 under test.mgr01-05
// and gives the 30 test accounts the default salaries from 2026-11-02. Also gives those 30 accounts and
// `admin` fictional contact details: emails on the reserved .example domain (never deliverable) and
// mobiles in the 555-0100..0199 range reserved for fiction. Only empty values are filled. Idempotent.
// Usage: npm run db:test-teams   (create the accounts first with `npm run user`)
import { closePools, getPool, sql } from '../db.ts';

const EFFECTIVE_FROM = '2026-11-02';
const MANAGER_SALARY = 54_000;
const REP_SALARY = 30_000;
const pad = (n: number) => String(n).padStart(2, '0');

const managers = Array.from({ length: 5 }, (_, i) => `test.mgr${pad(i + 1)}`);
const reps = Array.from({ length: 25 }, (_, i) => `test.rep${pad(i + 1)}`);
const teamOf = (repIndex: number) => managers[Math.floor(repIndex / 5)];

// admin (213) 555-0100, test.mgr01-05 555-0101..0105, test.rep01-25 555-0106..0130.
const CONTACT_DOMAIN = 'onestopvehicleshop.example';
const contacts = ['admin', ...managers, ...reps].map((username, i) => ({
  username,
  email: `${username}@${CONTACT_DOMAIN}`,
  mobile: `213555${String(100 + i).padStart(4, '0')}`,
}));

try {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const { recordset } = await pool.request().query<{ UserId: number; Username: string; Role: string }>(
    "SELECT UserId, Username, Role FROM dbo.Users WHERE Username LIKE 'test.%'",
  );
  const byName = new Map(recordset.map((u) => [u.Username, u]));
  const missing = [...managers, ...reps].filter((u) => !byName.has(u));
  if (missing.length) throw new Error(`Create these accounts first: ${missing.join(', ')}`);
  const wrongRole = [
    ...managers.filter((u) => byName.get(u)!.Role !== 'manager'),
    ...reps.filter((u) => byName.get(u)!.Role !== 'sales'),
  ];
  if (wrongRole.length) throw new Error(`Unexpected role for: ${wrongRole.join(', ')}`);

  for (const [i, rep] of reps.entries()) {
    await pool
      .request()
      .input('rep', mssql.Int, byName.get(rep)!.UserId)
      .input('manager', mssql.Int, byName.get(teamOf(i))!.UserId)
      .query('UPDATE dbo.Users SET ManagerUserId = @manager WHERE UserId = @rep');
  }

  let added = 0;
  for (const [name, salary] of [...managers.map((m) => [m, MANAGER_SALARY] as const), ...reps.map((r) => [r, REP_SALARY] as const)]) {
    const result = await pool
      .request()
      .input('user', mssql.Int, byName.get(name)!.UserId)
      .input('from', mssql.Date, EFFECTIVE_FROM)
      .input('amount', mssql.Decimal(12, 2), salary)
      .query(`IF NOT EXISTS (SELECT 1 FROM dbo.EmployeeSalaries WHERE UserId = @user AND EffectiveFrom = @from)
                INSERT INTO dbo.EmployeeSalaries (UserId, EffectiveFrom, AnnualSalary) VALUES (@user, @from, @amount);`);
    added += result.rowsAffected[0] ?? 0;
  }

  // Fill only empty fields; skip an email another account already uses.
  let contactsSet = 0;
  for (const c of contacts) {
    const result = await pool
      .request()
      .input('username', mssql.NVarChar(50), c.username)
      .input('email', mssql.NVarChar(254), c.email)
      .input('mobile', mssql.VarChar(16), c.mobile)
      .query(`UPDATE dbo.Users
                 SET Email = COALESCE(Email, @email), Mobile = COALESCE(Mobile, @mobile)
               WHERE Username = @username AND (Email IS NULL OR Mobile IS NULL)
                 AND NOT EXISTS (SELECT 1 FROM dbo.Users o WHERE o.Email = @email AND o.Username <> @username)`);
    contactsSet += result.rowsAffected[0] ?? 0;
  }

  for (const m of managers) {
    const team = reps.filter((_, i) => teamOf(i) === m);
    console.log(`${m}: ${team.join(', ')}`);
  }
  console.log(`Salaries: ${added} added (${30 - added} already set), effective ${EFFECTIVE_FROM}.`);
  console.log(`Contact details: ${contactsSet} account(s) filled in, ${contacts.length - contactsSet} already set.`);
} catch (err) {
  console.error('Test teams failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closePools();
}
