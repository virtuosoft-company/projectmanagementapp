import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/lib/generated/prisma/enums";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: { signIn: "/signin", error: "/signin" },
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "")
          .trim()
          .toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        const hash = user?.passwordHash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin";
        const ok = await bcrypt.compare(password, hash);

        if (!user || !user.passwordHash || !ok || user.disabledAt) return null;

        const membership =
          (user.lastWorkspaceId &&
            (await prisma.workspaceMember.findUnique({
              where: { workspaceId_userId: { workspaceId: user.lastWorkspaceId, userId: user.id } },
            }))) ||
          (await prisma.workspaceMember.findFirst({
            where: { userId: user.id },
            orderBy: { joinedAt: "asc" },
          }));

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          workspaceId: membership?.workspaceId ?? null,
          role: membership?.role ?? null,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id as string;
        // Both stay null for an account with no workspace yet — defaulting the
        // role to MEMBER here would hand out permissions nobody granted.
        token.workspaceId = (user as { workspaceId?: string | null }).workspaceId ?? null;
        token.role = (user as { role?: Role | null }).role ?? null;
      }

      if (trigger === "update" && token.id) {
        const userId = token.id as string;
        const requestedWorkspaceId = (session as { workspaceId?: string } | undefined)
          ?.workspaceId;

        if (requestedWorkspaceId) {
          // The workspace switcher asked to move to a different workspace —
          // re-verify membership server-side rather than trusting the client.
          const membership = await prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId: requestedWorkspaceId, userId } },
          });
          if (membership) {
            token.workspaceId = membership.workspaceId;
            token.role = membership.role;
            await prisma.user.update({
              where: { id: userId },
              data: { lastWorkspaceId: membership.workspaceId },
            });
          }
          // An invalid request (not a member) is silently ignored — the
          // token keeps whatever workspace it already had.
        } else if (token.workspaceId) {
          const workspaceId = token.workspaceId as string;
          // Plain refresh (e.g. after a role change): re-read this user's
          // role for the workspace they're currently in, not a global field.
          const [membership, fresh] = await Promise.all([
            prisma.workspaceMember.findUnique({
              where: { workspaceId_userId: { workspaceId, userId } },
            }),
            prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
          ]);
          if (membership) token.role = membership.role;
          if (fresh) {
            token.name = fresh.name;
            token.email = fresh.email;
          }
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.workspaceId = (token.workspaceId as string | null) ?? null;
        session.user.role = (token.role as Role | null) ?? null;
      }
      return session;
    },
  },
});
