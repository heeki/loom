import { useState, useEffect, useCallback, type ReactNode } from "react";
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

interface SortableCardGridProps<T> {
  items: T[];
  getId: (item: T) => string;
  getName: (item: T) => string;
  storageKey: string;
  renderItem: (item: T) => ReactNode;
  prependItems?: ReactNode;
  className?: string;
  onSortDirectionChange?: (direction: SortDirection) => void;
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

function loadSortDirection(key: string): SortDirection | null {
  try {
    const raw = localStorage.getItem(`loom-sort-${key}`);
    if (raw === "asc" || raw === "desc") return raw;
  } catch { /* ignore */ }
  return null;
}

function saveSortDirection(key: string, direction: SortDirection | null) {
  if (direction) {
    localStorage.setItem(`loom-sort-${key}`, direction);
  } else {
    localStorage.removeItem(`loom-sort-${key}`);
  }
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
  renderItem,
  prependItems,
  className = "grid gap-4 md:grid-cols-2 lg:grid-cols-3",
  onSortDirectionChange,
}: SortableCardGridProps<T>) {
  const [orderedIds, setOrderedIds] = useState<string[]>(() => loadOrder(storageKey));
  const [sortDirection, setSortDirection] = useState<SortDirection | null>(() => loadSortDirection(storageKey) ?? "asc");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // Notify parent of sort direction changes
  useEffect(() => {
    if (onSortDirectionChange) {
      onSortDirectionChange(sortDirection ?? "asc");
    }
  }, [sortDirection]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-sort items according to saved order or alphabetical default
  const sortedItems = (() => {
    const itemMap = new Map(items.map((item) => [getId(item), item]));

    // If user has explicitly selected a sort direction, sort all items alphabetically
    if (sortDirection !== null) {
      const all = [...items];
      all.sort((a, b) => alphabeticalCompare(getName(a), getName(b), sortDirection));
      return all;
    }

    // If there is a persisted order, use it; sort un-persisted items alphabetically
    const savedOrder = orderedIds;
    if (savedOrder.length > 0) {
      const result: T[] = [];
      for (const id of savedOrder) {
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

    // No persisted order — default alphabetical A-Z
    const all = [...items];
    all.sort((a, b) => alphabeticalCompare(getName(a), getName(b), "asc"));
    return all;
  })();

  const sortedIds = sortedItems.map(getId);

  // Persist order whenever items change (new items added/removed)
  useEffect(() => {
    if (sortDirection !== null) return; // Don't persist order when explicit sort is active
    const currentIds = items.map(getId);
    const saved = loadOrder(storageKey);
    const savedSet = new Set(saved);
    const hasNew = currentIds.some((id) => !savedSet.has(id));
    const hasRemoved = saved.some((id) => !currentIds.includes(id));
    if (hasNew || hasRemoved) {
      saveOrder(storageKey, sortedIds);
    }
  }, [items.map(getId).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleSort = useCallback(() => {
    const newDirection: SortDirection = sortDirection === "asc" ? "desc" : "asc";
    setSortDirection(newDirection);
    saveSortDirection(storageKey, newDirection);
    // Clear persisted custom order so sort takes full effect
    setOrderedIds([]);
    localStorage.removeItem(`loom-order-${storageKey}`);
  }, [sortDirection, storageKey]);

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
    // Clear sort direction since user chose custom order
    setSortDirection(null);
    saveSortDirection(storageKey, null);
  }

  const effectiveDirection = sortDirection ?? "asc";

  return (
    <div>
      <div className="flex justify-end mb-2">
        <button
          type="button"
          onClick={handleToggleSort}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title={effectiveDirection === "asc" ? "Sorted A-Z (click for Z-A)" : "Sorted Z-A (click for A-Z)"}
        >
          {effectiveDirection === "asc" ? (
            <ArrowDownAZ className="h-3.5 w-3.5" />
          ) : (
            <ArrowUpAZ className="h-3.5 w-3.5" />
          )}
          {effectiveDirection === "asc" ? "A-Z" : "Z-A"}
        </button>
      </div>
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
    </div>
  );
}
