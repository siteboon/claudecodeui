import {
  useProcessingSessions,
  useSessionProtectionActions,
} from '../../../contexts/SessionProtectionContext';
import { useProjectActiveSessionState } from '../../../contexts/ProjectsStateContext';
import { useQueuedMessageAutoSend } from '../../../hooks/useQueuedMessageAutoSend';
import type { RealtimeProps } from '../types';

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
