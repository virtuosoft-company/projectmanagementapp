"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  EMPTY_FILTER,
  TaskFilters,
  filterTasks,
  type TaskFilter,
} from "@/components/projects/task-filters";
import { TrelloBoard } from "@/components/projects/trello-board";
import type { Board, Label, Member, RunningTimer, Subtask, Task } from "@/lib/domain";

/**
 * A project's boards with a filter bar above them.
 *
 * Which board is open lives in the URL (`?board=`), not in state, so a link
 * to a particular board works and the back button moves between boards.
 */
export function ProjectTasksTab({
  projectId,
  boards,
  activeBoardId,
  tasks,
  members,
  labels,
  today,
  canManage,
  canLog,
  canUseTimer,
  subtasks,
  running,
}: {
  projectId: string;
  boards: Board[];
  activeBoardId: string;
  /** The project's live (unarchived) tasks. */
  tasks: Task[];
  members: Member[];
  labels: Label[];
  today: string;
  canManage: boolean;
  canLog: boolean;
  /** `time.log` *and* not the admin account — may run the clock. */
  canUseTimer: boolean;
  /** Every subtask in the project. */
  subtasks: Subtask[];
  running: RunningTimer | null;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<TaskFilter>(EMPTY_FILTER);

  const board = boards.find((item) => item.id === activeBoardId) ?? boards[0];
  const onBoard = tasks.filter((task) => board?.lists.some((list) => list.id === task.listId));
  const visible = filterTasks(onBoard, filter);

  return (
    <div className="space-y-4">
      <TaskFilters
        filter={filter}
        onChange={setFilter}
        members={members}
        labels={labels}
        resultCount={visible.length}
        totalCount={onBoard.length}
        allowArchived={false}
      />

      <TrelloBoard
        projectId={projectId}
        boards={boards}
        activeBoardId={board?.id ?? ""}
        tasks={tasks}
        visibleIds={new Set(visible.map((task) => task.id))}
        today={today}
        canManage={canManage}
        canLog={canLog}
        canUseTimer={canUseTimer}
        subtasks={subtasks}
        members={members}
        labels={labels}
        running={running}
        onSelectBoard={(id) =>
          router.push(`/projects/project/${projectId}/tasks?board=${id}`, { scroll: false })
        }
      />
    </div>
  );
}
