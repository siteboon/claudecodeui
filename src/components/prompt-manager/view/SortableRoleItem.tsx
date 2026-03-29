import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X, type LucideIcon } from 'lucide-react';
import * as Icons from 'lucide-react';
import { ActiveRoleWithPriority } from '../types/types';

interface SortableRoleItemProps {
  role: ActiveRoleWithPriority;
  onRemove: (path: string) => void;
}

export default function SortableRoleItem({ role, onRemove }: SortableRoleItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: role.path });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  };

  let RoleIcon: LucideIcon | null = null;
  if (role.icon) {
    const iconKey = role.icon as keyof typeof Icons;
    const IconComponent = Icons[iconKey];
    if (IconComponent && typeof IconComponent === 'function') {
      RoleIcon = IconComponent as LucideIcon;
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
    >
      {/* Drag Handle */}
      <button
        type="button"
        className="cursor-grab touch-none text-gray-400 hover:text-gray-600 active:cursor-grabbing dark:text-gray-500 dark:hover:text-gray-300"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-5 w-5" />
      </button>

      {/* Priority Badge */}
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700 dark:bg-blue-900 dark:text-blue-300">
        {role.priority + 1}
      </div>

      {/* Role Info */}
      <div className="flex flex-1 items-center gap-2">
        {RoleIcon && <RoleIcon className="h-4 w-4 text-gray-600 dark:text-gray-400" />}
        <span className="font-medium text-gray-900 dark:text-gray-100">{role.name}</span>
      </div>

      {/* Remove Button */}
      <button
        type="button"
        onClick={() => onRemove(role.path)}
        className="rounded p-1 text-gray-400 transition-colors hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
        title="Remove role"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
