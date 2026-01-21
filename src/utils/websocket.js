import { useState, useEffect, useRef } from "react";

export function useWebSocket() {
  const [ws, setWs] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef(null);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (ws) {
        ws.close();
      }
    };
  }, []); // Keep dependency array but add proper cleanup

  const connect = async () => {
    try {
      const isPlatform = import.meta.env.VITE_IS_PLATFORM === "true";

      // Construct WebSocket URL
      let wsUrl;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

      // Check if we're running through orchestrator proxy
      const proxyBase = window.__ORCHESTRATOR_PROXY_BASE__;

      if (isPlatform) {
        // Platform mode: Use same domain as the page (goes through proxy)
        wsUrl = `${protocol}//${window.location.host}/ws`;
      } else if (proxyBase) {
        // Orchestrator proxy mode: Get direct WebSocket URL from orchestrator API
        // Extract client ID from proxyBase (e.g., /clients/badal-laptop/proxy -> badal-laptop)
        const clientIdMatch = proxyBase.match(/\/clients\/([^/]+)\/proxy/);
        if (!clientIdMatch) {
          console.error(
            "[ORCHESTRATOR] Could not extract client ID from proxyBase:",
            proxyBase,
          );
          return;
        }
        const clientId = clientIdMatch[1];

        console.log(
          "[ORCHESTRATOR] Fetching WebSocket info for client:",
          clientId,
        );

        try {
          // Fetch the direct WebSocket URL from the orchestrator API
          const response = await fetch(`/api/clients/${clientId}/ws-info`, {
            credentials: "include", // Include session cookies
          });

          if (!response.ok) {
            console.error(
              "[ORCHESTRATOR] Failed to fetch WebSocket info:",
              response.status,
            );
            return;
          }

          const wsInfo = await response.json();
          console.log("[ORCHESTRATOR] WebSocket info:", wsInfo);

          if (wsInfo.error) {
            console.error("[ORCHESTRATOR] WebSocket info error:", wsInfo.error);
            return;
          }

          if (wsInfo.is_local) {
            console.warn(
              "[ORCHESTRATOR] Client is running locally - WebSocket may not be accessible",
            );
          }

          // Connect directly to the claudecodeui WebSocket
          const token = localStorage.getItem("auth-token");
          if (!token) {
            console.warn(
              "No authentication token found for WebSocket connection",
            );
            return;
          }

          wsUrl = `${wsInfo.ws_base}/ws?token=${encodeURIComponent(token)}`;
          console.log("[ORCHESTRATOR] Connecting directly to:", wsUrl);
        } catch (fetchError) {
          console.error(
            "[ORCHESTRATOR] Error fetching WebSocket info:",
            fetchError,
          );
          return;
        }
      } else {
        // OSS mode: Connect to same host:port that served the page
        const token = localStorage.getItem("auth-token");
        if (!token) {
          console.warn(
            "No authentication token found for WebSocket connection",
          );
          return;
        }

        wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
      }

      const websocket = new WebSocket(wsUrl);

      websocket.onopen = () => {
        setIsConnected(true);
        setWs(websocket);
      };

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setMessages((prev) => [...prev, data]);
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      };

      websocket.onclose = () => {
        setIsConnected(false);
        setWs(null);

        // Attempt to reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 3000);
      };

      websocket.onerror = (error) => {
        console.error("WebSocket error:", error);
      };
    } catch (error) {
      console.error("Error creating WebSocket connection:", error);
    }
  };

  const sendMessage = (message) => {
    if (ws && isConnected) {
      ws.send(JSON.stringify(message));
    } else {
      console.warn("WebSocket not connected");
    }
  };

  return {
    ws,
    sendMessage,
    messages,
    isConnected,
  };
}
