"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  SHEET_MAX_CELL_LENGTH,
  SHEET_MAX_COLS,
  SHEET_MAX_PER_PROJECT,
  SHEET_MAX_ROWS,
  normaliseCells,
  normaliseFormats,
  normaliseWidths,
} from "@/lib/sheet-model";
import { requirePermission } from "@/lib/session";
import { firstError } from "@/lib/validations";

export type ActionResult = { ok: boolean; error?: string; sheetId?: string };

const nameSchema = z.string().trim().min(1, "Give the sheet a name.").max(60);

/**
 * Confirms the sheet exists inside the caller's workspace.
 *
 * Every action starts here rather than trusting the id it was handed: a sheet
 * id is opaque, and without this a crafted request could edit another tenant's
 * sheet. Returns the project id, which is what the revalidation needs.
 */
async function findSheet(sheetId: string, workspaceId: string) {
  return prisma.projectSheet.findFirst({
    where: { id: sheetId, project: { workspaceId } },
    select: { id: true, projectId: true },
  });
}

function refresh(projectId: string) {
  revalidatePath(`/projects/project/${projectId}/excel-sheet`);
}

/** Add a sheet to a project. */
const createSheetSchema = z.object({ projectId: z.string().min(1), name: nameSchema });
type CreateSheetInput = z.input<typeof createSheetSchema>;

export async function createSheetAction(input: CreateSheetInput): Promise<ActionResult> {
  const user = await requirePermission("projects.edit");

  const parsed = createSheetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const data = parsed.data;

  const project = await prisma.project.findFirst({
    where: { id: data.projectId, workspaceId: user.workspaceId },
    select: { id: true, _count: { select: { sheets: true } } },
  });
  if (!project) return { ok: false, error: "That project no longer exists." };

  // Each sheet is a JSON blob; an unbounded number of them per project would
  // make the tab strip unusable long before it became a storage problem.
  if (project._count.sheets >= SHEET_MAX_PER_PROJECT) {
    return {
      ok: false,
      error: `A project can hold ${SHEET_MAX_PER_PROJECT} sheets. Delete one first.`,
    };
  }

  const created = await prisma.projectSheet.create({
    data: {
      projectId: project.id,
      name: data.name,
      cells: normaliseCells([], 20, 8),
      rowCount: 20,
      colCount: 8,
      position: project._count.sheets,
      updatedById: user.id,
    },
    select: { id: true },
  });

  refresh(project.id);
  return { ok: true, sheetId: created.id };
}

/** Rename a sheet. */
const renameSheetSchema = z.object({ sheetId: z.string().min(1), name: nameSchema });
type RenameSheetInput = z.input<typeof renameSheetSchema>;

export async function renameSheetAction(input: RenameSheetInput): Promise<ActionResult> {
  const user = await requirePermission("projects.edit");

  const parsed = renameSheetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const sheet = await findSheet(parsed.data.sheetId, user.workspaceId);
  if (!sheet) return { ok: false, error: "That sheet no longer exists." };

  await prisma.projectSheet.update({
    where: { id: sheet.id },
    data: { name: parsed.data.name, updatedById: user.id },
  });

  refresh(sheet.projectId);
  return { ok: true };
}

/**
 * Assign a sheet to somebody, or to nobody.
 *
 * The assignee must be a member of the *workspace*, checked here rather than
 * trusted — otherwise any user id would be accepted, including someone from
 * another tenant.
 */
const assignSheetSchema = z.object({
  sheetId: z.string().min(1),
  assigneeId: z.string().nullable(),
});
type AssignSheetInput = z.input<typeof assignSheetSchema>;

export async function assignSheetAction(input: AssignSheetInput): Promise<ActionResult> {
  const user = await requirePermission("projects.edit");

  const parsed = assignSheetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const data = parsed.data;

  const sheet = await findSheet(data.sheetId, user.workspaceId);
  if (!sheet) return { ok: false, error: "That sheet no longer exists." };

  if (data.assigneeId) {
    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: user.workspaceId, userId: data.assigneeId } },
      select: { userId: true },
    });
    if (!membership) return { ok: false, error: "They are not in this workspace." };
  }

  await prisma.projectSheet.update({
    where: { id: sheet.id },
    data: { assigneeId: data.assigneeId, updatedById: user.id },
  });

  refresh(sheet.projectId);
  return { ok: true };
}

/** Delete a sheet and everything typed into it. */
export async function deleteSheetAction(sheetId: string): Promise<ActionResult> {
  const user = await requirePermission("projects.edit");

  const sheet = await findSheet(sheetId, user.workspaceId);
  if (!sheet) return { ok: false, error: "That sheet no longer exists." };

  await prisma.projectSheet.delete({ where: { id: sheet.id } });

  refresh(sheet.projectId);
  return { ok: true };
}

/**
 * The contents of one sheet, as the grid submits them.
 *
 * Sizes and cell length are capped because the grid is one JSON column: without
 * limits a client could post something large enough to make every later read
 * expensive. Everything is re-shaped server-side — cells to `rowCount` ×
 * `colCount`, formats to cells that exist, widths to a usable range — so a
 * malformed payload cannot be stored and then break reads.
 */
const sheetContent = {
  rowCount: z.number().int().min(1).max(SHEET_MAX_ROWS),
  colCount: z.number().int().min(1).max(SHEET_MAX_COLS),
  cells: z
    .array(z.array(z.string().max(SHEET_MAX_CELL_LENGTH)).max(SHEET_MAX_COLS))
    .max(SHEET_MAX_ROWS),
  // Validated structurally by normaliseFormats, which drops anything unknown.
  formats: z.record(z.string(), z.unknown()).default({}),
  colWidths: z.array(z.number()).max(SHEET_MAX_COLS).default([]),
  frozenRows: z.number().int().min(0).max(1).default(0),
};

type SheetContent = {
  rowCount: number;
  colCount: number;
  cells: string[][];
  formats: Record<string, unknown>;
  colWidths: number[];
  frozenRows: number;
};

/** The columns a sheet's content is stored in, normalised. */
function stored(content: SheetContent) {
  return {
    cells: normaliseCells(content.cells, content.rowCount, content.colCount),
    rowCount: content.rowCount,
    colCount: content.colCount,
    formats: normaliseFormats(content.formats, content.rowCount, content.colCount),
    colWidths: normaliseWidths(content.colWidths, content.colCount),
    frozenRows: content.frozenRows,
  };
}

/** Save a sheet's contents — values, formulas and formatting together. */
const saveSheetSchema = z.object({ sheetId: z.string().min(1), ...sheetContent });
type SaveSheetInput = z.input<typeof saveSheetSchema>;

export async function saveSheetAction(input: SaveSheetInput): Promise<ActionResult> {
  const user = await requirePermission("projects.edit");

  const parsed = saveSheetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const data = parsed.data;

  const sheet = await findSheet(data.sheetId, user.workspaceId);
  if (!sheet) return { ok: false, error: "That sheet no longer exists." };

  await prisma.projectSheet.update({
    where: { id: sheet.id },
    data: { ...stored(data), updatedById: user.id },
  });

  refresh(sheet.projectId);
  return { ok: true };
}

/**
 * Add sheets from an imported workbook — one per worksheet.
 *
 * The file is parsed in the browser (ExcelJS) and arrives here as sheet
 * content, so this action never handles a binary format. It is validated and
 * normalised exactly like a save; it is not trusted for having come from a
 * file. Worksheets are cut to the grid's limits before they are sent, and the
 * project's sheet cap applies to the whole batch: if it would be exceeded,
 * nothing is imported, rather than half a workbook.
 */
const importSheetsSchema = z.object({
  projectId: z.string().min(1),
  sheets: z
    .array(z.object({ name: nameSchema, ...sheetContent }))
    .min(1, "The file had no worksheets.")
    .max(SHEET_MAX_PER_PROJECT),
});
type ImportSheetsInput = z.input<typeof importSheetsSchema>;

export async function importSheetsAction(input: ImportSheetsInput): Promise<ActionResult> {
  const user = await requirePermission("projects.edit");

  const parsed = importSheetsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const data = parsed.data;

  const project = await prisma.project.findFirst({
    where: { id: data.projectId, workspaceId: user.workspaceId },
    select: { id: true, _count: { select: { sheets: true } } },
  });
  if (!project) return { ok: false, error: "That project no longer exists." };

  const room = SHEET_MAX_PER_PROJECT - project._count.sheets;
  if (data.sheets.length > room) {
    return {
      ok: false,
      error: `That file has ${data.sheets.length} worksheets, but this project has room for ${room} more sheet${room === 1 ? "" : "s"} (the limit is ${SHEET_MAX_PER_PROJECT}).`,
    };
  }

  const created = await prisma.$transaction(
    data.sheets.map((sheet, index) =>
      prisma.projectSheet.create({
        data: {
          projectId: project.id,
          name: sheet.name,
          position: project._count.sheets + index,
          updatedById: user.id,
          ...stored(sheet),
        },
        select: { id: true },
      }),
    ),
  );

  refresh(project.id);
  return { ok: true, sheetId: created[0].id };
}
