import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { ActiveRoleWithPriority } from '../types/types';
import SortableRoleItem from './SortableRoleItem';

interface RoleManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeRoles: ActiveRoleWithPriority[];
  onReorderRoles: (newOrder: ActiveRoleWithPriority[]) => void;
  onRemoveRole: (path: string) => void;
  onClearAllRoles: () => void;
}

export default function RoleManagementModal({
  isOpen,
  onClose,
  activeRoles,
  onReorderRoles,
  onRemoveRole,
  onClearAllRoles
}: RoleManagementModalProps) {
  const { t } = useTranslation('chat');
  const modalRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = activeRoles.findIndex(role => role.path === active.id);
      const newIndex = activeRoles.findIndex(role => role.path === over.id);

      const newOrder = arrayMove(activeRoles, oldIndex, newIndex);
      onReorderRoles(newOrder);
    }
  };

  const handleClearAll = () => {
    if (window.confirm(t('promptLibrary.roleManagement.confirmClearAll'))) {
      onClearAllRoles();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="role-management-title"
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl dark:bg-gray-900"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <div>
            <h2
              id="role-management-title"
              className="text-xl font-semibold text-gray-900 dark:text-gray-100"
            >
              {t('promptLibrary.roleManagement.title')}
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t('promptLibrary.roleManagement.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeRoles.length === 0 ? (
            <div className="py-12 text-center text-gray-500 dark:text-gray-400">
              {t('promptLibrary.roleManagement.empty')}
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={activeRoles.map(role => role.path)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {activeRoles.map(role => (
                    <SortableRoleItem
                      key={role.path}
                      role={role}
                      onRemove={onRemoveRole}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {/* Footer */}
        {activeRoles.length > 0 && (
          <div className="border-t border-gray-200 p-4 dark:border-gray-700">
            <button
              type="button"
              onClick={handleClearAll}
              className="w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
            >
              {t('promptLibrary.roleManagement.clearAll')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
