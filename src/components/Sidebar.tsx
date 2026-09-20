import type { NavItem, ViewId } from "../lib/nav";

interface SidebarProps {
  items: NavItem[];
  activeView: ViewId;
  onNavigate: (id: ViewId) => void;
  selectedTaskTitle: string | null;
  dbPath: string | null;
  /** Which views currently have their sub-nav open. */
  subNavOpen: Partial<Record<ViewId, boolean>>;
  onToggleSubNav: (id: ViewId) => void;
}

export function Sidebar({
  items,
  activeView,
  onNavigate,
  selectedTaskTitle,
  dbPath,
  subNavOpen,
  onToggleSubNav,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden />
        <div className="brand-text">
          <span className="brand-name">Abyss Gazer</span>
          <span className="brand-tag">Focus & Tasks</span>
        </div>
      </div>

      <nav className="nav" aria-label="主导航">
        {items.map((item) => {
          const open = !!subNavOpen[item.id];
          return (
            <div
              key={item.id}
              className={`nav-row${activeView === item.id ? " is-active" : ""}${
                !item.enabled ? " is-disabled" : ""
              }`}
            >
              <button
                type="button"
                className="nav-item"
                disabled={!item.enabled}
                onClick={() => item.enabled && onNavigate(item.id)}
                title={item.enabled ? item.label : `${item.label}（即将推出）`}
              >
                <span className="nav-label">{item.label}</span>
                {!item.enabled && <span className="nav-soon">Soon</span>}
              </button>
              {item.hasSubNav && item.enabled && (
                <button
                  type="button"
                  className={`nav-subnav-toggle${open ? " is-open" : ""}`}
                  aria-label={open ? `收起${item.label}子菜单` : `展开${item.label}子菜单`}
                  aria-expanded={open}
                  title={open ? "收起子菜单" : "展开子菜单"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSubNav(item.id);
                  }}
                >
                  {open ? "‹" : "›"}
                </button>
              )}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="selected-task-chip">
          <span className="chip-label">当前任务</span>
          <span className="chip-value">
            {selectedTaskTitle ?? "未选择"}
          </span>
        </div>
        {dbPath && (
          <div className="db-path-chip" title={dbPath}>
            <span className="chip-label">数据文件</span>
            <span className="chip-value db-path-value">{dbPath}</span>
          </div>
        )}
      </div>
    </aside>
  );
}
