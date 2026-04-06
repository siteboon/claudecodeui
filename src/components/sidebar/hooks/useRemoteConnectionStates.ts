import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionState } from '../view/subcomponents/ConnectionStatusIndicator';
import { api } from '../../../utils/api';

type ConnectionStatesMap = Record<string, ConnectionState>;

type ConnectionStateMessage = {
  type: 'remote_connection_state';
  hostId: string;
  state: ConnectionState;
};

/**
 * Tracks SSH connection states for all remote hosts.
 * - Fetches initial states from the REST API on mount
 * - Listens for real-time WebSocket updates via latestMessage
 */
export function useRemoteConnectionStates(
  latestMessage: any,
  hasRemoteProjects: boolean,
): ConnectionStatesMap {
  const [states, setStates] = useState<ConnectionStatesMap>({});
  const fetchedRef = useRef(false);

  // Fetch initial connection states from server
  useEffect(() => {
    if (!hasRemoteProjects || fetchedRef.current) return;
    fetchedRef.current = true;

    const fetchStates = async () => {
      try {
        const response = await api.remoteHosts.allConnectionStates();
        if (!response.ok) return;
        const connections: { hostId: string; state: string }[] = await response.json();
        const map: ConnectionStatesMap = {};
        for (const conn of connections) {
          map[conn.hostId] = conn.state as ConnectionState;
        }
        setStates(map);
      } catch {
        // Server may not have remote module enabled
      }
    };

    fetchStates();
  }, [hasRemoteProjects]);

  // Listen for real-time state changes via WebSocket
  const handleMessage = useCallback((msg: ConnectionStateMessage) => {
    setStates(prev => {
      if (prev[msg.hostId] === msg.state) return prev;
      return { ...prev, [msg.hostId]: msg.state };
    });
  }, []);

  useEffect(() => {
    if (!latestMessage || latestMessage.type !== 'remote_connection_state') return;
    handleMessage(latestMessage as ConnectionStateMessage);
  }, [latestMessage, handleMessage]);

  return states;
}
