import "server-only";
import type { Role } from "@/lib/domain";
import { roleToDomain } from "@/lib/mappers";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";

export type WorkspaceMember = {
  id: string;
  name: string;
  email: string;
  role: Role;
  designation: string | null;
  hourlyRate: number;
  monthlyHours: number;
  joinedAt: string;
  disabled: boolean;
};

/**
 * Members of the signed-in user's current workspace. These are the real
 * accounts that can sign in — distinct from the demo project data in
 * `lib/data.ts`.
 */
export async function listMembers(): Promise<WorkspaceMember[]> {
  // Callers are all behind requireUser/requirePermission; this guard is a
  // backstop so the query can never run for an anonymous request.
  const viewer = await getSessionUser();
  // No session, or a session that hasn't picked a workspace yet — either way
  // there is no roster to read.
  if (!viewer?.workspaceId) return [];

  const rows = await prisma.workspaceMember.findMany({
    where: { workspaceId: viewer.workspaceId },
    orderBy: [{ role: "asc" }, { user: { name: "asc" } }],
    include: { user: true },
  });

  return rows.map((row) => ({
    id: row.user.id,
    name: row.user.name,
    email: row.user.email,
    role: roleToDomain[row.role],
    designation: row.user.designation,
    hourlyRate: row.user.hourlyRate,
    monthlyHours: row.user.monthlyHours,
    joinedAt: row.joinedAt.toISOString().slice(0, 10),
    disabled: row.user.disabledAt !== null,
  }));
}

export async function countMembers(workspaceId: string) {
  return prisma.workspaceMember.count({ where: { workspaceId } });
}
