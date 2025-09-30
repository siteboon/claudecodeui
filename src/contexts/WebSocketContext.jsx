import React, { createContext, useContext } from 'react';
import { useWebSocket } from '../utils/websocket';

const WebSocketContext = createContext({
  ws: null,
  sendMessage: () => {},
  messages: [],
  isConnected: false
});

export const useWebSocketContext = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocketContext must be used within a WebSocketProvider');
  }
  return context;
};

export const WebSocketProvider = ({ children }) => {
  const webSocketData = useWebSocket();
  
  return (
    <WebSocketContext.Provider value={webSocketData}>
      {children}
    </WebSocketContext.Provider>
  );
};

export default WebSocketContext;