import type { Task } from "../lib/api";
import { ancestorTasks, formatTaskLineage } from "../lib/taskTree";

export function TaskLineageTitle({
  task,
  byId,
  onAncestorClick,
}: {
  task: Task;
  byId: Map<string, Task>;
  onAncestorClick?: (ancestor: Task) => void;
}) {
  const ancestors = [...ancestorTasks(task, byId)].reverse();
  if (ancestors.length === 0) {
    return <strong className="completed-title">{task.title}</strong>;
  }
  return (
    <strong className="completed-title" title={formatTaskLineage(task, byId)}>
      {ancestors.map((item) => (
        <span key={item.id}>
          {onAncestorClick ? (
            <button
              type="button"
              className="completed-lineage-link"
              onClick={(event) => {
                event.stopPropagation();
                onAncestorClick(item);
              }}
            >
              {item.title}
            </button>
          ) : (
            <span className="completed-lineage">{item.title}</span>
          )}
          <span className="completed-lineage"> · </span>
        </span>
      ))}
      {task.title}
    </strong>
  );
}
