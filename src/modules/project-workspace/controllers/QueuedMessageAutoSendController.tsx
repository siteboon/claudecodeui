import {
  useProcessingSessions,
  useSessionProtectionActions,
} from '@/shared/context/SessionProtectionContext';
import { useProjectActiveSessionState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { useQueuedMessageAutoSend } from '@/modules/chat';
import type { RealtimeProps } from '@/shared/types';

export default function QueuedMessageAutoSendController({ ws, sendMessage }: RealtimeProps) {
  const { activeSessionId } = useProjectActiveSessionState();
  const processingSessions = useProcessingSessions();
  const { markSessionProcessing } = useSessionProtectionActions();

  useQueuedMessageAutoSend({
    processingSessions,
    activeSessionId,
    ws,
    sendMessage,
    markSessionProcessing,
  });

  return null;
}
