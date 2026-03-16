import { useState, useEffect, type ReactNode } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDownAZ, ArrowUpAZ } from "lucide-react";

interface SortableItemProps {
  id: string;
  children: ReactNode;
}

function SortableItem({ id, children }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

export type SortDirection = "asc" | "desc";

/** Standalone sort toggle button — place wherever you want in the page layout. */
export function SortButton({
  direction,
  onClick,
}: {
  direction: SortDirection;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      title={direction === "asc" ? "Sorted A-Z (click for Z-A)" : "Sorted Z-A (click for A-Z)"}
    >
      {direction === "asc" ? (
        <ArrowDownAZ className="h-3.5 w-3.5" />
      ) : (
        <ArrowUpAZ className="h-3.5 w-3.5" />
      )}
      {direction === "asc" ? "A-Z" : "Z-A"}
    </button>
  );
}

interface SortableCardGridProps<T> {
  items: T[];
  getId: (item: T) => string;
  getName: (item: T) => string;
  storageKey: string;
  sortDirection: SortDirection;
  onSortDirectionChange: (direction: SortDirection | null) => void;
  renderItem: (item: T) => ReactNode;
  prependItems?: ReactNode;
  className?: string;
}

function loadOrder(key: string): string[] {
  try {
    const raw = localStorage.getItem(`loom-order-${key}`);
    if (raw) return JSON.parse(raw) as string[];
  } catch { /* ignore */ }
  return [];
}

function saveOrder(key: string, ids: string[]) {
  localStorage.setItem(`loom-order-${key}`, JSON.stringify(ids));
}

function alphabeticalCompare(a: string, b: string, direction: SortDirection): number {
  const cmp = a.localeCompare(b, undefined, { sensitivity: "base" });
  return direction === "desc" ? -cmp : cmp;
}

export function SortableCardGrid<T>({
  items,
  getId,
  getName,
  storageKey,
  sortDirection,
  onSortDirectionChange,
  renderItem,
  prependItems,
  className = "grid gap-4 md:grid-cols-2 lg:grid-cols-3",
}: SortableCardGridProps<T>) {
  const [orderedIds, setOrderedIds] = useState<string[]>(() => loadOrder(storageKey));
  // Track whether the user has a custom drag order active (sort direction was cleared by drag)
  const [customOrder, setCustomOrder] = useState<boolean>(() => {
    const raw = localStorage.getItem(`loom-sort-${storageKey}`);
    // If there's no sort preference saved but there IS a saved order, it's a custom drag order
    return raw === null && loadOrder(storageKey).length > 0;
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // Re-sort items according to custom order or alphabetical
  const sortedItems = (() => {
    const itemMap = new Map(items.map((item) => [getId(item), item]));

    // If user has custom drag order active, use it
    if (customOrder && orderedIds.length > 0) {
      const result: T[] = [];
      for (const id of orderedIds) {
        const item = itemMap.get(id);
        if (item) {
          result.push(item);
          itemMap.delete(id);
        }
      }
      // New items not in saved order — sorted alphabetically among themselves
      const remaining = [...itemMap.values()];
      remaining.sort((a, b) => alphabeticalCompare(getName(a), getName(b), "asc"));
      result.push(...remaining);
      return result;
    }

    // Sort alphabetically using the provided direction
    const all = [...items];
    all.sort((a, b) => alphabeticalCompare(getName(a), getName(b), sortDirection));
    return all;
  })();

  const sortedIds = sortedItems.map(getId);

  // Persist order whenever items change (new items added/removed) and custom order is active
  useEffect(() => {
    if (!customOrder) return;
    const currentIds = items.map(getId);
    const saved = loadOrder(storageKey);
    const savedSet = new Set(saved);
    const hasNew = currentIds.some((id) => !savedSet.has(id));
    const hasRemoved = saved.some((id) => !currentIds.includes(id));
    if (hasNew || hasRemoved) {
      saveOrder(storageKey, sortedIds);
    }
  }, [items.map(getId).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = sortedIds.indexOf(String(active.id));
    const newIndex = sortedIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const newIds = [...sortedIds];
    newIds.splice(oldIndex, 1);
    newIds.splice(newIndex, 0, String(active.id));
    setOrderedIds(newIds);
    saveOrder(storageKey, newIds);
    // Enter custom order mode
    setCustomOrder(true);
    localStorage.removeItem(`loom-sort-${storageKey}`);
    onSortDirectionChange(null);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={sortedIds} strategy={rectSortingStrategy}>
        <div className={className}>
          {prependItems}
          {sortedItems.map((item) => (
            <SortableItem key={getId(item)} id={getId(item)}>
              {renderItem(item)}
            </SortableItem>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

/** Load persisted sort direction for a storage key, defaulting to "asc". */
export function loadSortDirection(key: string): SortDirection {
  try {
    const raw = localStorage.getItem(`loom-sort-${key}`);
    if (raw === "asc" || raw === "desc") return raw;
  } catch { /* ignore */ }
  return "asc";
}

/** Persist sort direction for a storage key. Pass null to clear. */
export function saveSortDirection(key: string, direction: SortDirection | null) {
  if (direction) {
    localStorage.setItem(`loom-sort-${key}`, direction);
  } else {
    localStorage.removeItem(`loom-sort-${key}`);
  }
}

/** Toggle sort direction and persist. Returns the new direction. */
export function toggleSortDirection(key: string, current: SortDirection): SortDirection {
  const next: SortDirection = current === "asc" ? "desc" : "asc";
  saveSortDirection(key, next);
  return next;
}
