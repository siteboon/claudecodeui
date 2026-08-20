import { memo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { PaletteOpsProvider } from '../../contexts/PaletteOpsContext';
import { ProjectsStateProvider } from '../../contexts/ProjectsStateContext';
import {
  SessionProtectionProvider,
  useSessionProtectionActions,
} from '../../contexts/SessionProtectionContext';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useDeviceSettings } from '../../hooks/useDeviceSettings';
import { useVisualViewportKeyboardOffset } from './hooks/useVisualViewportKeyboardOffset';
import ProjectWorkspaceShell from './view/ProjectWorkspaceShell';

const MemoizedProjectWorkspaceRouteContent = memo(ProjectWorkspaceRouteContent);

export default function ProjectWorkspaceRoute() {
  return (
    <SessionProtectionProvider>
      <PaletteOpsProvider>
        <MemoizedProjectWorkspaceRouteContent />
      </PaletteOpsProvider>
    </SessionProtectionProvider>
  );
}

function ProjectWorkspaceRouteContent() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { ws, sendMessage, subscribe } = useWebSocket();
  const { isSessionProcessing } = useSessionProtectionActions();

  useVisualViewportKeyboardOffset();

  return (
    <ProjectsStateProvider
      sessionId={sessionId}
      navigate={navigate}
      subscribe={subscribe}
      isMobile={isMobile}
      isSessionProcessing={isSessionProcessing}
    >
      <ProjectWorkspaceShell
        isMobile={isMobile}
        ws={ws}
        sendMessage={sendMessage}
        navigate={navigate}
      />
    </ProjectsStateProvider>
  );
}
