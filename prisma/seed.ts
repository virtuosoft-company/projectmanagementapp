/**
 * The seed: one workspace — virtuosoft — its editable roles, and an admin to
 * sign in with. Nothing else.
 *
 * Applies by default, because this is what `npm run db:seed` and Prisma's own
 * seed hook call on deploy. Pass --dry-run to see the plan without writing:
 *
 *   npx tsx prisma/seed.ts                # create/refresh virtuosoft
 *   npx tsx prisma/seed.ts --dry-run      # show what it would do
 *
 * It touches no other workspace. Anything already in the database — including
 * older workspaces — is left exactly as it is.
 *
 * There is deliberately no demo data here: a seed that invents projects, tasks
 * and time entries is a liability the moment it runs anywhere real. A
 * workspace, its roles and a way in are the things that cannot be created from
 * inside the app.
 *
 * The role definitions live in `src/lib/default-roles.ts`, which is also what
 * workspace creation calls, so a seeded workspace and a newly created one can
 * never disagree. Idempotent and additive throughout: rows that already exist
 * are left untouched, so re-running never undoes an edit made in the app.
 *
 * No existing user is ever disturbed. The seed writes to `User` exactly once —
 * creating the admin when no account holds that email — and never updates one:
 * not the name, not the password, not the workspace it resumes into. If the
 * address is already taken it takes no further action on that account, not even
 * adding it to the workspace, because joining a real person's account would
 * change what they can reach. Grant that access from Admin → Users instead.
 */

import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/lib/generated/prisma/client";
import { buildDatabaseUrl } from "../src/lib/db-config/db-config";
import { DEFAULT_ROLES, defaultRolePermissions, ensureWorkspaceRoles } from "../src/lib/default-roles";

const DRY_RUN = process.argv.includes("--dry-run");

const WORKSPACE = {
  slug: "virtuosoft",
  name: "Virtuosoft",
  description: "",
};

const ADMIN = {
  email: process.env.SEED_ADMIN_EMAIL ?? "admin@virtuosoft.com",
  name: process.env.SEED_ADMIN_NAME ?? "Admin",
};

async function main() {
  // The same resolver the app and the Prisma CLI use, so the seed always lands
  // in the database the rest of the project is pointed at: discrete DB_* vars
  // first, DATABASE_URL only as a fallback.
  const prisma = new PrismaClient({
    adapter: new PrismaMariaDb(buildDatabaseUrl()),
  });

  console.log(`${DRY_RUN ? "DRY RUN" : "SEEDING"} — workspace "${WORKSPACE.slug}"\n`);

  const existing = await prisma.workspace.findUnique({
    where: { slug: WORKSPACE.slug },
    select: { id: true },
  });
  console.log(`  workspace  ${existing ? "already exists" : DRY_RUN ? "would create" : "creating"}`);

  let workspaceId = existing?.id ?? null;
  if (!workspaceId && !DRY_RUN) {
    const row = await prisma.workspace.create({ data: WORKSPACE, select: { id: true } });
    workspaceId = row.id;
  }

  // --- admin -----------------------------------------------------------
  // Only ever created, never updated: re-running must not reset a password
  // that has since been changed in the app.
  const password = process.env.SEED_PASSWORD;
  const user = await prisma.user.findUnique({
    where: { email: ADMIN.email },
    select: { id: true },
  });

  let userId = user?.id ?? null;
  // Only an account the seed created itself is given a membership. An account
  // that was already there is left completely alone — not renamed, not
  // re-passworded, and not silently promoted to admin of this workspace.
  let createdUser = false;

  if (userId) {
    console.log(`  admin      ${ADMIN.email} already exists — left as is`);
  } else if (!password) {
    // No default here on purpose: a fallback password is a published one.
    console.log(`  admin      SKIPPED — set SEED_PASSWORD to create ${ADMIN.email}`);
  } else {
    console.log(`  admin      ${DRY_RUN ? "would create" : "creating"} ${ADMIN.email}`);
    if (!DRY_RUN) {
      const row = await prisma.user.create({
        data: {
          email: ADMIN.email,
          name: ADMIN.name,
          passwordHash: await bcrypt.hash(password, 12),
          emailVerified: new Date(),
          lastWorkspaceId: workspaceId,
        },
        select: { id: true },
      });
      userId = row.id;
    }
    createdUser = true;
  }

  if (!createdUser) {
    // Nothing to do, and deliberately so: joining an account that predates the
    // seed would change what a real person can reach.
    console.log("  membership unchanged — an existing account is never joined or promoted");
  } else {
    console.log(`  membership ${DRY_RUN ? "would add" : "adding"} as admin`);
    if (!DRY_RUN && workspaceId && userId) {
      await prisma.workspaceMember.create({
        data: {
          workspaceId,
          userId,
          role: "ADMIN",
        },
      });
    }
  }

  // --- roles -----------------------------------------------------------
  const names = DEFAULT_ROLES.map(({ role }) => role);
  const present = workspaceId
    ? await prisma.customRole.findMany({
        where: { workspaceId, name: { in: names } },
        select: { name: true },
      })
    : [];
  const missing = names.filter((role) => !present.some((row) => row.name === role));

  if (missing.length === 0 && workspaceId) {
    console.log("  roles      all present");
  } else {
    console.log(`  roles      ${DRY_RUN ? "would create" : "creating"} ${missing.join(", ")}`);
    for (const { role } of DEFAULT_ROLES) {
      if (!missing.includes(role)) continue;
      const permissions = defaultRolePermissions(role);
      console.log(
        `               ${role.padEnd(8)} inherits ${role.toUpperCase().padEnd(8)} ` +
          `${permissions.length} permission(s): ${permissions.join(", ") || "none"}`,
      );
    }
  }
  console.log("               admin is fixed and is not seeded.");

  if (!DRY_RUN && workspaceId) await ensureWorkspaceRoles(prisma, workspaceId);

  console.log(DRY_RUN ? "\nNothing written. Re-run without --dry-run to commit." : "\nDone.");
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
