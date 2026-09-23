import type { Task } from "../lib/api";
import { ancestorTasks, formatTaskLineage } from "../lib/taskTree";

export function TaskLineageTitle({
  task,
  byId,
}: {
  task: Task;
  byId: Map<string, Task>;
}) {
  const ancestors = ancestorTasks(task, byId);
  if (ancestors.length === 0) {
    return <strong className="completed-title">{task.title}</strong>;
  }
  const parentPath = [...ancestors]
    .reverse()
    .map((item) => item.title)
    .join(" · ");
  return (
    <strong className="completed-title" title={formatTaskLineage(task, byId)}>
      <span className="completed-lineage">{parentPath} · </span>
      {task.title}
    </strong>
  );
}
