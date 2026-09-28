"use server";

/**
 * Writes for boards and card placement.
 *
 * Lists are not written here at all: every board has the same four, one per
 * status, kept in shape by `ensureBoardLists` in `lib/boards.ts`.
 *
 * Every action re-checks `tasks.manage` and proves the board, list or card
 * belongs to the caller's workspace before touching it — an id alone is never
 * evidence of ownership. Anything that moves a card goes through `moveCard`
 * or `syncTaskList` in `lib/boards.ts`, which keep its status and its list in
 * agreement.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createBoardWithLists, listForStatus, moveCard } from "@/lib/boards";
import { requirePermission } from "@/lib/session";
import { firstError } from "@/lib/validations";

export type ActionResult = { ok: boolean; error?: string; id?: string };

const NOT_FOUND: ActionResult = { ok: false, error: "That no longer exists." };

/** A project may hold this many boards; beyond it the tab strip stops being usable. */
const MAX_BOARDS = 20;
const name = z.string().trim().min(1, "Give it a name.").max(60);

function refresh(projectId: string) {
  revalidatePath(`/projects/project/${projectId}`, "layout");
  revalidatePath("/projects/tasks");
  revalidatePath("/dashboard");
}

async function findBoard(boardId: string, workspaceId: string) {
  return prisma.board.findFirst({
    where: { id: boardId, project: { workspaceId } },
    select: { id: true, projectId: true, name: true },
  });
}

async function findList(listId: string, workspaceId: string) {
  return prisma.boardList.findFirst({
    where: { id: listId, board: { project: { workspaceId } } },
    select: { id: true, boardId: true, position: true, board: { select: { projectId: true } } },
  });
}

// --- Boards ----------------------------------------------------------------

const createBoardSchema = z.object({ projectId: z.string().min(1), name });
type CreateBoardInput = z.input<typeof createBoardSchema>;

export async function createBoardAction(input: CreateBoardInput): Promise<ActionResult> {
  const user = await requirePermission("tasks.manage");
  const parsed = createBoardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const project = await prisma.project.findFirst({
    where: { id: parsed.data.projectId, workspaceId: user.workspaceId },
    select: { id: true, _count: { select: { boards: true } } },
  });
  if (!project) return NOT_FOUND;
  if (project._count.boards >= MAX_BOARDS) {
    return { ok: false, error: `A project can hold ${MAX_BOARDS} boards. Delete one first.` };
  }

  // Starts with the four default lists, so a new board is usable immediately
  // rather than an empty canvas that has to be set up before a card fits.
  const board = await createBoardWithLists(
    prisma,
    project.id,
    parsed.data.name,
    project._count.boards,
  );

  refresh(project.id);
  return { ok: true, id: board.id };
}

const renameBoardSchema = z.object({ boardId: z.string().min(1), name });
type RenameBoardInput = z.input<typeof renameBoardSchema>;

export async function renameBoardAction(input: RenameBoardInput): Promise<ActionResult> {
  const user = await requirePermission("tasks.manage");
  const parsed = renameBoardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const board = await findBoard(parsed.data.boardId, user.workspaceId);
  if (!board) return NOT_FOUND;

  await prisma.board.update({ where: { id: board.id }, data: { name: parsed.data.name } });
  refresh(board.projectId);
  return { ok: true };
}

/**
 * Delete a board, moving its cards to the project's first remaining board.
 *
 * Cards are never deleted with a board: they are tasks, with time logged and
 * people assigned. Each lands in the first list on the destination board that
 * shares its status, so nothing changes status in the move.
 */
export async function deleteBoardAction(boardId: string): Promise<ActionResult> {
  const user = await requirePermission("tasks.manage");

  const board = await findBoard(boardId, user.workspaceId);
  if (!board) return NOT_FOUND;

  const target = await prisma.board.findFirst({
    where: { projectId: board.projectId, id: { not: board.id } },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  if (!target) return { ok: false, error: "A project needs at least one board." };

  await prisma.$transaction(async (tx) => {
    const cards = await tx.task.findMany({
      where: { list: { boardId: board.id } },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, status: true },
    });
    for (const card of cards) {
      const list = await listForStatus(tx, target.id, card.status);
      const last = await tx.task.aggregate({ where: { listId: list.id }, _max: { position: true } });
      await tx.task.update({
        where: { id: card.id },
        data: { listId: list.id, position: (last._max.position ?? -1) + 1 },
      });
    }
    await tx.board.delete({ where: { id: board.id } });
  });

  refresh(board.projectId);
  return { ok: true, id: target.id };
}


// --- Cards -----------------------------------------------------------------

/**
 * Move a card to a list and position — a drag, or the card's Move menu.
 *
 * The card takes the list's status, which is what makes the board and every
 * report agree about where work stands.
 */
const moveCardSchema = z.object({
  taskId: z.string().min(1),
  listId: z.string().min(1),
  index: z.number().int().min(0).max(10_000),
});
type MoveCardInput = z.input<typeof moveCardSchema>;

export async function moveCardAction(input: MoveCardInput): Promise<ActionResult> {
  const user = await requirePermission("tasks.manage");
  const parsed = moveCardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const [task, list] = await Promise.all([
    prisma.task.findFirst({
      where: { id: parsed.data.taskId, project: { workspaceId: user.workspaceId } },
      select: { id: true, projectId: true },
    }),
    findList(parsed.data.listId, user.workspaceId),
  ]);
  if (!task || !list) return NOT_FOUND;

  // A card belongs to its project; a list from another project's board is
  // not somewhere it can go, however the request was put together.
  if (list.board.projectId !== task.projectId) {
    return { ok: false, error: "That list belongs to a different project." };
  }

  await prisma.$transaction((tx) => moveCard(tx, task.id, list.id, parsed.data.index));

  refresh(task.projectId);
  return { ok: true };
}

/** Add a card to the bottom of a list with just a title — Trello's "Add a card". */
const addCardSchema = z.object({
  listId: z.string().min(1),
  title: z.string().trim().min(1, "Give the card a title.").max(200),
  description: z.string().trim().max(5000).default(""),
});
type AddCardInput = z.input<typeof addCardSchema>;

export async function addCardAction(input: AddCardInput): Promise<ActionResult> {
  const user = await requirePermission("tasks.manage");
  const parsed = addCardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const list = await prisma.boardList.findFirst({
    where: { id: parsed.data.listId, board: { project: { workspaceId: user.workspaceId } } },
    select: {
      id: true,
      status: true,
      board: { select: { projectId: true } },
    },
  });
  if (!list) return NOT_FOUND;

  const last = await prisma.task.aggregate({ where: { listId: list.id }, _max: { position: true } });
  const task = await prisma.task.create({
    data: {
      projectId: list.board.projectId,
      title: parsed.data.title,
      description: parsed.data.description,
      status: list.status,
      listId: list.id,
      position: (last._max.position ?? -1) + 1,
    },
    select: { id: true },
  });

  refresh(list.board.projectId);
  return { ok: true, id: task.id };
}
