/**
 * Creates the superadmin (or makes an existing account the superadmin). Run once on the server:
 *
 *   npm run superadmin
 *
 * It asks for the email, name and password; the password is typed hidden and never stored
 * anywhere but as a hash. Nobody can become superadmin from the sign-up page.
 */
import readline from 'node:readline';
import { formatPersonName, passwordIssues } from '@sft/shared';
import { prisma } from '../src/db';
import { writeAudit } from '../src/lib/audit';
import { hashPassword } from '../src/lib/crypto';
import { getSecurity } from '../src/lib/settings';

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // show * instead of what is typed
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
        process.stdout.write(s.startsWith(question) ? question : s.replace(/[^\r\n]/g, '*'));
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function main() {
  const email = (await ask('Superadmin email: ')).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('That is not a valid email address.');

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.isSuperadmin) {
      console.log(`${formatPersonName(existing)} is already the superadmin.`);
      return;
    }
    const sure = await ask(`${formatPersonName(existing)} already has an account. Make them the superadmin? (yes/no) `);
    if (sure.toLowerCase() !== 'yes') return console.log('Nothing changed.');
    await prisma.user.update({ where: { id: existing.id }, data: { isSuperadmin: true } });
    await writeAudit(prisma, { actor: { id: null, name: 'System (create-superadmin command)' }, action: 'update', entityType: 'user', entityId: existing.id, after: { isSuperadmin: true } });
    console.log(`${formatPersonName(existing)} is now the superadmin. They sign in with their own password.`);
    return;
  }

  const firstName = await ask('First name: ');
  const lastName = await ask('Last name: ');
  if (!firstName || !lastName) throw new Error('First and last name are required.');
  const password = await ask('Password: ', true);
  const issues = passwordIssues(password, (await getSecurity()).passwordPolicy);
  if (issues.length) throw new Error(`The password is too weak: ${issues.join(' ')}`);
  if ((await ask('Type the password again: ', true)) !== password) throw new Error('The passwords do not match.');

  const user = await prisma.user.create({
    data: { email, firstName, lastName, passwordHash: await hashPassword(password), isSuperadmin: true, emailVerifiedAt: new Date() },
  });
  await writeAudit(prisma, { actor: { id: null, name: 'System (create-superadmin command)' }, action: 'create', entityType: 'user', entityId: user.id, after: { email, isSuperadmin: true } });
  console.log(`Superadmin ${formatPersonName(user)} created. Sign in at the web app with ${email}.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
