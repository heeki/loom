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

interface SortableCardGridProps<T> {
  items: T[];
  getId: (item: T) => string;
  storageKey: string;
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

export function SortableCardGrid<T>({
  items,
  getId,
  storageKey,
  renderItem,
  prependItems,
  className = "grid gap-4 md:grid-cols-2 lg:grid-cols-3",
}: SortableCardGridProps<T>) {
  const [orderedIds, setOrderedIds] = useState<string[]>(() => loadOrder(storageKey));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // Re-sort items according to saved order, appending any new items at the end
  const sortedItems = (() => {
    const itemMap = new Map(items.map((item) => [getId(item), item]));
    const result: T[] = [];
    for (const id of orderedIds) {
      const item = itemMap.get(id);
      if (item) {
        result.push(item);
        itemMap.delete(id);
      }
    }
    // Append items not in saved order
    for (const item of itemMap.values()) {
      result.push(item);
    }
    return result;
  })();

  const sortedIds = sortedItems.map(getId);

  // Persist order whenever items change (new items added/removed)
  useEffect(() => {
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
