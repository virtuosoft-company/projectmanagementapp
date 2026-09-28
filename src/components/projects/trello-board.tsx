"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CircleAlert,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { BoardCard } from "@/components/projects/board-card";
import {
  TaskEditDialog,
  type TaskFormValues,
} from "@/components/projects/task-edit-dialog";
import { TimerDialog } from "@/components/projects/timer-controls";
import { deleteTaskAction } from "@/lib/actions";
import { updateTaskAction } from "@/lib/task-actions";
import {
  AddSubtaskDialog,
  EditSubtaskDialog,
  SubtaskDetailsDialog,
  createSubtaskWithFile,
  saveSubtaskEdit,
} from "@/components/projects/task-subtasks";
import { formatMinutes } from "@/lib/duration";
import { subtreeIds } from "@/lib/subtask-tree";
import {
  BoardNameDialog,
  MoveCardDialog,
  SubtasksDialog,
} from "@/components/projects/board-dialogs";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  deleteSubtaskAction,
  pauseTimerAction,
  resumeTimerAction,
  setTaskCoverAction,
  startTimerAction,
  stopTimerAction,
  uploadTaskFileAction,
} from "@/lib/task-actions";
import {
  addCardAction,
  createBoardAction,
  deleteBoardAction,
  moveCardAction,
  renameBoardAction,
} from "@/lib/board-actions";
import {
  type Board,
  type BoardList,
  type Label,
  type Member,
  type RunningTimer,
  type Subtask,
  type Task,
  type TaskStatus,
} from "@/lib/domain";
import { cn } from "@/lib/utils";

/** Identifies our own drags, so a drop from elsewhere is ignored. */
const DRAG_TYPE = "application/x-card-id";

const byPosition = (a: Task, b: Task) => a.position - b.position;

type Move = { taskId: string; listId: string; index: number; status: TaskStatus };

/**
 * Applies a card move to a local copy of the tasks, for the optimistic view.
 *
 * Mirrors `moveCard` on the server — insert at `index` among the list's other
 * cards, renumber both lists densely, take the list's status — so what the
 * board shows while the request is in flight is exactly what it will show
 * once it lands.
 */
function applyMove(tasks: Task[], move: Move): Task[] {
  const moving = tasks.find((task) => task.id === move.taskId);
  if (!moving) return tasks;

  const others = tasks.filter((task) => task.id !== move.taskId);
  const destination = others.filter((task) => task.listId === move.listId).sort(byPosition);
  destination.splice(move.index, 0, { ...moving, listId: move.listId, status: move.status });

  const source =
    moving.listId !== move.listId
      ? others.filter((task) => task.listId === moving.listId).sort(byPosition)
      : [];

  const untouched = others.filter(
    (task) => task.listId !== move.listId && task.listId !== moving.listId,
  );

  return [
    ...untouched,
    ...destination.map((task, position) => ({ ...task, position })),
    ...source.map((task, position) => ({ ...task, position })),
  ];
}

type Dialog =
  | { kind: "new-board" }
  | { kind: "rename-board" }
  | { kind: "delete-board" }
  | { kind: "move-card"; task: Task }
  | { kind: "edit-card"; task: Task }
  | { kind: "delete-card"; task: Task }
  | { kind: "subtasks"; taskId: string }
  | { kind: "add-subtask"; taskId: string; parentId: string | null; parentTitle: string }
  | { kind: "open-subtask"; subtask: Subtask }
  | { kind: "edit-subtask"; subtask: Subtask }
  | { kind: "delete-subtask"; subtask: Subtask }
  | { kind: "timer"; task: Task; subtask: Subtask | null }
  | null;

/**
 * A project's boards, Trello-style.
 *
 * A project can have several boards; each has its own lists, and each list
 * *counts as* one task status. Dropping a card on a list gives it that status,
 * which is what keeps progress, overdue counts and every report correct no
 * matter how the lists are named or arranged.
 *
 * Card moves are optimistic: the card lands immediately, and `useOptimistic`
 * drops the guess once the refreshed server data arrives — so a rejected move
 * snaps back on its own, with the error explaining why.
 */
export function TrelloBoard({
  projectId,
  boards,
  activeBoardId,
  tasks,
  visibleIds,
  today,
  canManage,
  canLog,
  subtasks,
  members,
  labels,
  running,
  onSelectBoard,
}: {
  projectId: string;
  boards: Board[];
  activeBoardId: string;
  /** Every live card in the project — the source of truth for positions. */
  tasks: Task[];
  /**
   * The cards the filter bar lets through. Kept separate from `tasks` because a
   * drop index has to be computed against *all* the cards in a list: dropping
   * "second" in a filtered view means after the first visible card, which may
   * be tenth in the list.
   */
  visibleIds: Set<string>;
  today: string;
  canManage: boolean;
  /** `time.log` — whether subtask timers are offered. */
  canLog: boolean;
  /** Every subtask in the project; each card's dialog picks out its own. */
  subtasks: Subtask[];
  /** For the card's Edit dialog — its assignee and label pickers. */
  members: Member[];
  labels: Label[];
  running: RunningTimer | null;
  onSelectBoard: (boardId: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ listId: string; visibleIndex: number } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  const subtasksByTask = useMemo(() => {
    const map = new Map<string, Subtask[]>();
    for (const item of subtasks) map.set(item.taskId, [...(map.get(item.taskId) ?? []), item]);
    return map;
  }, [subtasks]);

  /** The people on a task — who its subtasks can be assigned to. */
  function assigneesOf(taskId: string) {
    return tasks.find((task) => task.id === taskId)?.assignees ?? [];
  }

  /** Deleting a card takes its time entries with it, so the dialog says so. */
  function describeCardRemoval(task: Task | undefined) {
    if (!task) return "";
    const logged = Math.round(task.trackedHours * 60);
    return [
      "The card, its subtasks and its files are deleted.",
      logged
        ? `The ${formatMinutes(logged)} logged against it goes too, so reports will change. Archive it from the task page to keep that time.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  function describeSubtaskRemoval(subtask: Subtask) {
    const branch = subtreeIds(subtasksByTask.get(subtask.taskId) ?? [], subtask.id);
    const beneath = branch.length - 1;
    const logged = (subtasksByTask.get(subtask.taskId) ?? [])
      .filter((item) => branch.includes(item.id))
      .reduce((sum, item) => sum + item.trackedMinutes, 0);
    return [
      beneath
        ? `This deletes it and the ${beneath} subtask${beneath === 1 ? "" : "s"} beneath it.`
        : "This deletes the subtask.",
      logged ? `The ${formatMinutes(logged)} logged on it stays on the task.` : "",
      subtask.files.length ? "Its files stay on the task." : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  const [optimistic, applyOptimistic] = useOptimistic(tasks, applyMove);

  const board = boards.find((item) => item.id === activeBoardId) ?? boards[0];
  const lists = board?.lists ?? [];

  /** Every live card in a list, in order — filtered or not. */
  const allIn = (listId: string) =>
    optimistic.filter((task) => task.listId === listId).sort(byPosition);
  const visibleIn = (listId: string) => allIn(listId).filter((task) => visibleIds.has(task.id));

  function run(
    action: () => Promise<{ ok: boolean; error?: string; id?: string }>,
    onDone?: (id?: string) => void,
  ) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "That did not work.");
        return;
      }
      setDialog(null);
      onDone?.(result.id);
      router.refresh();
    });
  }

  function move(taskId: string, list: BoardList, index: number) {
    const card = optimistic.find((task) => task.id === taskId);
    if (!card) return;

    // Dropping a card exactly where it already is is not worth a round trip.
    // `index` counts the list's *other* cards, so staying put means it equals
    // the card's own current index.
    if (card.listId === list.id && allIn(list.id).findIndex((task) => task.id === taskId) === index) {
      return;
    }

    setError(null);
    startTransition(async () => {
      applyOptimistic({ taskId, listId: list.id, index, status: list.status });
      const result = await moveCardAction({ taskId, listId: list.id, index });
      if (!result.ok) {
        setError(result.error ?? "Could not move that card.");
        return;
      }
      router.refresh();
    });
  }

  /**
   * Converts a drop position among the *visible* cards into an index among
   * *all* of the list's cards — which is what the server counts in. Without
   * this, dropping into a filtered list would land the card in the wrong place.
   */
  function trueIndex(listId: string, visibleIndex: number, taskId: string) {
    const all = allIn(listId).filter((task) => task.id !== taskId);
    const visible = all.filter((task) => visibleIds.has(task.id));
    if (visibleIndex < visible.length) return all.indexOf(visible[visibleIndex]);
    if (!visible.length) return all.length;
    return all.indexOf(visible[visible.length - 1]) + 1;
  }

  /** Where among a list's visible cards the pointer is, by card midpoints. */
  function pointerIndex(container: HTMLElement, clientY: number, taskId: string | null) {
    const cards = Array.from(container.querySelectorAll<HTMLElement>("[data-card]")).filter(
      (element) => element.dataset.card !== taskId,
    );
    const index = cards.findIndex((element) => {
      const rect = element.getBoundingClientRect();
      return clientY < rect.top + rect.height / 2;
    });
    return index === -1 ? cards.length : index;
  }

  /**
   * A timer write, which leaves any open dialog alone — pausing from the
   * subtask dialog should show the clock stop, not shut the dialog.
   */
  function runTimer(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "That did not work.");
        return;
      }
      router.refresh();
    });
  }

  function startTimer(taskId: string, subtaskId: string | null) {
    runTimer(() => startTimerAction({ taskId, subtaskId, note: "" }));
  }

  function stopTimer() {
    runTimer(stopTimerAction);
  }

  function pauseTimer() {
    runTimer(pauseTimerAction);
  }

  function resumeTimer() {
    runTimer(resumeTimerAction);
  }

  /**
   * Add a card from the same form that edits one: create it, apply the rest of
   * the fields, then upload its cover and file — one request each, because a
   * single file may use the whole action body limit.
   */
  function submitCard(list: BoardList, values: TaskFormValues) {
    const title = values.title.trim();
    if (!title) return;
    setError(null);
    startTransition(async () => {
      const created = await addCardAction({
        listId: list.id,
        title,
        description: values.description.trim(),
      });
      if (!created.ok || !created.id) {
        setError(created.error ?? "Could not add that card.");
        return;
      }

      const updated = await updateTaskAction({ ...values, title, taskId: created.id });
      if (!updated.ok) setError(updated.error ?? "The card was added with its title only.");

      const problems: string[] = [];
      for (const [upload, chosen] of [
        [setTaskCoverAction, values.cover],
        [uploadTaskFileAction, values.file],
      ] as const) {
        if (!chosen) continue;
        const form = new FormData();
        form.set("taskId", created.id);
        form.set("file", chosen);
        const uploaded = await upload(form);
        if (!uploaded.ok) problems.push(`${chosen.name}: ${uploaded.error ?? "upload failed."}`);
      }
      if (problems.length) setError(`Card added, but ${problems.join(" ")}`);

      setAdding(null);
      router.refresh();
    });
  }

  if (!board) {
    return <p className="text-sm text-muted-foreground">This project has no boards yet.</p>;
  }

  const moving = dialog?.kind === "move-card" ? dialog.task : null;
  const addingTo = adding ? lists.find((list) => list.id === adding) : undefined;
  const subtasksTask =
    dialog?.kind === "subtasks" ? tasks.find((task) => task.id === dialog.taskId) : undefined;
  return (
    <div className="space-y-3">
      {/* Board tabs */}
      <div className="flex flex-wrap items-center gap-1 border-b pb-2">
        {boards.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectBoard(item.id)}
            aria-current={item.id === board.id ? "page" : undefined}
            className={cn(
              "rounded-t-md border-b-2 px-3 py-1.5 text-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              item.id === board.id
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.name}
          </button>
        ))}

        {canManage ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setDialog({ kind: "new-board" })}
            >
              <Plus className="h-4 w-4" />
              Board
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="ml-auto" aria-label="Board options">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setDialog({ kind: "rename-board" })}>
                  <Pencil className="h-4 w-4" />
                  Rename board
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={boards.length < 2}
                  onSelect={() => setDialog({ kind: "delete-board" })}
                  className="text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete board
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      ) : null}

      {/* Lists */}
      <div className="flex items-start gap-3 overflow-x-auto pb-4">
        {lists.map((list) => {
          const cards = visibleIn(list.id);
          const total = allIn(list.id).length;
          const isTarget = drop?.listId === list.id;
          const undragged = cards.filter((task) => task.id !== dragging);
          const slotOf = (taskId: string) => undragged.findIndex((task) => task.id === taskId);

          return (
            <section
              key={list.id}
              aria-label={list.name}
              className="flex max-h-[calc(100svh-16rem)] w-72 shrink-0 flex-col rounded-lg bg-muted/60"
            >
              <header className="flex items-center gap-2 px-3 pb-1 pt-2.5">
                <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{list.name}</h3>
                <span className="font-mono text-xs text-muted-foreground">
                  {cards.length === total ? total : `${cards.length}/${total}`}
                </span>
              </header>
              <div className="pb-1" />

              <div
                className={cn(
                  "min-h-10 flex-1 space-y-2 overflow-y-auto px-2 pb-2 transition-colors",
                  isTarget && "bg-primary/5",
                )}
                onDragOver={(event) => {
                  if (!canManage || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
                  // Without preventDefault the browser refuses the drop outright.
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  const visibleIndex = pointerIndex(event.currentTarget, event.clientY, dragging);
                  if (drop?.listId !== list.id || drop.visibleIndex !== visibleIndex) {
                    setDrop({ listId: list.id, visibleIndex });
                  }
                }}
                onDragLeave={(event) => {
                  // Ignore the events fired while crossing child elements.
                  if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                  setDrop((current) => (current?.listId === list.id ? null : current));
                }}
                onDrop={(event) => {
                  if (!canManage) return;
                  event.preventDefault();
                  const taskId = event.dataTransfer.getData(DRAG_TYPE);
                  const visibleIndex = pointerIndex(event.currentTarget, event.clientY, taskId);
                  setDrop(null);
                  setDragging(null);
                  if (taskId) move(taskId, list, trueIndex(list.id, visibleIndex, taskId));
                }}
              >
                {cards.map((task) => {
                  // The pointer index skips the card being dragged, so the
                  // slot a card sits in has to skip it too, or the line lands
                  // one place off for every card below the dragged one.
                  const isDragged = task.id === dragging;
                  const slot = slotOf(task.id);
                  return (
                    <div key={task.id}>
                      {isTarget && !isDragged && drop?.visibleIndex === slot ? <DropLine /> : null}
                      <BoardCard
                        task={task}
                        subtasks={subtasksByTask.get(task.id) ?? []}
                        today={today}
                        canLog={canLog}
                        running={running}
                        onTimerRequest={(subtask) => setDialog({ kind: "timer", task, subtask })}
                        canManage={canManage}
                        dragging={dragging === task.id}
                        onDragStart={(event) => {
                          event.dataTransfer.setData(DRAG_TYPE, task.id);
                          event.dataTransfer.effectAllowed = "move";
                          setDragging(task.id);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setDrop(null);
                        }}
                        onMoveRequest={() => setDialog({ kind: "move-card", task })}
                        onEditRequest={() => setDialog({ kind: "edit-card", task })}
                        onAddCardSubtaskRequest={() =>
                          setDialog({
                            kind: "add-subtask",
                            taskId: task.id,
                            parentId: null,
                            parentTitle: task.title,
                          })
                        }
                        onDeleteRequest={() => setDialog({ kind: "delete-card", task })}
                        onSubtasksRequest={() => setDialog({ kind: "subtasks", taskId: task.id })}
                        onOpenSubtaskRequest={(subtask) =>
                          setDialog({ kind: "open-subtask", subtask })
                        }
                        onEditSubtaskRequest={(subtask) =>
                          setDialog({ kind: "edit-subtask", subtask })
                        }
                        onDeleteSubtaskRequest={(subtask) =>
                          setDialog({ kind: "delete-subtask", subtask })
                        }
                      />
                    </div>
                  );
                })}
                {isTarget && drop && drop.visibleIndex >= undragged.length ? <DropLine /> : null}
              </div>

              {canManage ? (
                <div className="px-2 pb-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start text-muted-foreground"
                    onClick={() => setAdding(list.id)}
                  >
                    <Plus className="h-4 w-4" />
                    Add a card
                  </Button>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      {/* Dialogs — keyed so each opening starts from fresh values. */}
      {dialog?.kind === "new-board" ? (
        <BoardNameDialog
          key="new-board"
          open
          title="New board"
          initial=""
          submitLabel={pending ? "Creating…" : "Create board"}
          pending={pending}
          error={error}
          onClose={() => setDialog(null)}
          onSubmit={(name) =>
            run(() => createBoardAction({ projectId, name }), (id) => id && onSelectBoard(id))
          }
        />
      ) : null}

      {dialog?.kind === "rename-board" ? (
        <BoardNameDialog
          key="rename-board"
          open
          title="Rename board"
          initial={board.name}
          submitLabel={pending ? "Saving…" : "Save"}
          pending={pending}
          error={error}
          onClose={() => setDialog(null)}
          onSubmit={(name) => run(() => renameBoardAction({ boardId: board.id, name }))}
        />
      ) : null}

      <ConfirmDialog
        open={dialog?.kind === "delete-board"}
        onClose={() => setDialog(null)}
        onConfirm={() =>
          run(() => deleteBoardAction(board.id), (id) => {
            toast.success("Board deleted");
            if (id) onSelectBoard(id);
          })
        }
        title={`Delete ${board.name}?`}
        description={`Its ${optimistic.filter((task) => lists.some((list) => list.id === task.listId)).length} cards move to ${boards.find((item) => item.id !== board.id)?.name ?? "another board"}, each onto a list with the same status. No card is deleted.`}
      />


      {moving ? (
        <MoveCardDialog
          key={moving.id}
          open
          title={moving.title}
          lists={lists}
          countIn={(listId) => allIn(listId).filter((task) => task.id !== moving.id).length}
          initialListId={moving.listId ?? lists[0].id}
          pending={pending}
          onClose={() => setDialog(null)}
          onSubmit={(listId, index) => {
            const list = lists.find((item) => item.id === listId);
            setDialog(null);
            if (list) move(moving.id, list, index);
          }}
        />
      ) : null}

      {subtasksTask ? (
        <SubtasksDialog
          key={subtasksTask.id}
          open
          task={subtasksTask}
          subtasks={subtasksByTask.get(subtasksTask.id) ?? []}
          running={running}
          canManage={canManage}
          canLog={canLog}
          onClose={() => setDialog(null)}
          onEdit={() => setDialog({ kind: "edit-card", task: subtasksTask })}
          onDelete={() => setDialog({ kind: "delete-card", task: subtasksTask })}
        />
      ) : null}

      {dialog?.kind === "add-subtask" ? (
        <AddSubtaskDialog
          key={dialog.parentId ?? dialog.taskId}
          parentTitle={dialog.parentTitle}
          members={assigneesOf(dialog.taskId)}
          pending={pending}
          error={error}
          onClose={() => setDialog(null)}
          onSubmit={(values) =>
            run(
              () => createSubtaskWithFile(dialog.taskId, dialog.parentId, values),
              () => setDialog(null),
            )
          }
        />
      ) : null}

      {dialog?.kind === "edit-card" ? (
        <TaskEditDialog
          key={dialog.task.id}
          open
          task={dialog.task}
          members={members}
          labels={labels}
          pending={pending}
          error={error}
          onClose={() => setDialog(null)}
          onSubmit={(values) => run(() => updateTaskAction({ ...values, taskId: dialog.task.id }))}
        />
      ) : null}

      <ConfirmDialog
        open={dialog?.kind === "delete-card"}
        onClose={() => setDialog(null)}
        onConfirm={() => {
          if (dialog?.kind !== "delete-card") return;
          run(() => deleteTaskAction(dialog.task.id), () => toast.success("Task deleted"));
        }}
        confirmLabel="Delete"
        title={dialog?.kind === "delete-card" ? `Delete ${dialog.task.title}?` : "Delete card?"}
        description={describeCardRemoval(dialog?.kind === "delete-card" ? dialog.task : undefined)}
      />

      {dialog?.kind === "open-subtask" ? (
        <SubtaskDetailsDialog
          key={dialog.subtask.id}
          subtask={dialog.subtask}
          canManage={canManage}
          canLog={canLog}
          running={running}
          pending={pending}
          onStartTimer={() => startTimer(dialog.subtask.taskId, dialog.subtask.id)}
          onStopTimer={stopTimer}
          onPauseTimer={pauseTimer}
          onResumeTimer={resumeTimer}
          onClose={() => setDialog(null)}
          onEdit={() => setDialog({ kind: "edit-subtask", subtask: dialog.subtask })}
          onDelete={() => setDialog({ kind: "delete-subtask", subtask: dialog.subtask })}
          onAddChild={() =>
            setDialog({
              kind: "add-subtask",
              taskId: dialog.subtask.taskId,
              parentId: dialog.subtask.id,
              parentTitle: dialog.subtask.title,
            })
          }
        />
      ) : null}

      {dialog?.kind === "edit-subtask" ? (
        <EditSubtaskDialog
          key={dialog.subtask.id}
          subtask={dialog.subtask}
          members={assigneesOf(dialog.subtask.taskId)}
          pending={pending}
          error={error}
          onClose={() => setDialog(null)}
          onSubmit={(values) => run(() => saveSubtaskEdit(dialog.subtask, values))}
        />
      ) : null}

      <ConfirmDialog
        open={dialog?.kind === "delete-subtask"}
        onClose={() => setDialog(null)}
        onConfirm={() => {
          if (dialog?.kind !== "delete-subtask") return;
          run(() => deleteSubtaskAction(dialog.subtask.id));
        }}
        confirmLabel="Delete"
        title={dialog?.kind === "delete-subtask" ? `Delete ${dialog.subtask.title}?` : "Delete subtask?"}
        description={dialog?.kind === "delete-subtask" ? describeSubtaskRemoval(dialog.subtask) : ""}
      />

      {addingTo ? (
        <TaskEditDialog
          key={addingTo.id}
          open
          defaultStatus={addingTo.status}
          members={members}
          labels={labels}
          pending={pending}
          error={error}
          onClose={() => setAdding(null)}
          onSubmit={(values) => submitCard(addingTo, values)}
        />
      ) : null}

      {dialog?.kind === "timer" ? (
        <TimerDialog
          key={dialog.subtask?.id ?? dialog.task.id}
          open
          onClose={() => setDialog(null)}
          taskId={dialog.task.id}
          taskTitle={dialog.task.title}
          subtaskId={dialog.subtask?.id ?? null}
          subtaskTitle={dialog.subtask?.title ?? null}
          running={running}
        />
      ) : null}

      {/* A drag is announced by its outcome, not by every hover. */}
      <p role="status" aria-live="polite" className="sr-only">
        {pending ? "Saving…" : ""}
      </p>
    </div>
  );
}

function DropLine() {
  return <div aria-hidden className="mb-2 h-1 rounded-full bg-primary" />;
}

