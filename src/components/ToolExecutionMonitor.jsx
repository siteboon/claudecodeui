import React, { useState, useEffect, useRef } from 'react';
import { 
  FileText, 
  Search, 
  Terminal, 
  Edit, 
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Clock,
  Activity,
  AlertCircle,
  CheckCircle,
  Loader
} from 'lucide-react';

const ToolExecutionMonitor = ({ isVisible = true }) => {
  const [activeTools, setActiveTools] = useState([]);
  const [completedTools, setCompletedTools] = useState([]);
  const [expandedTools, setExpandedTools] = useState(new Set());
  const wsRef = useRef(null);
  
  useEffect(() => {
    // Connect to WebSocket for real-time updates
    const connectWS = () => {
      const token = localStorage.getItem('auth-token');
      if (!token) return;
      
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.hostname}:${window.location.port || 3008}/ws?token=${encodeURIComponent(token)}`;
      
      wsRef.current = new WebSocket(wsUrl);
      
      wsRef.current.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'tool-execution') {
          const toolExecution = {
            id: Date.now(),
            ...data.tool,
            startTime: Date.now(),
            status: 'active',
            context: data.context
          };
          
          setActiveTools(prev => [...prev, toolExecution]);
          
          // Auto-expand new tools
          setExpandedTools(prev => new Set([...prev, toolExecution.id]));
          
          // Move to completed after tool finishes
          setTimeout(() => {
            setActiveTools(prev => prev.filter(t => t.id !== toolExecution.id));
            setCompletedTools(prev => [
              { ...toolExecution, status: 'completed', endTime: Date.now() },
              ...prev.slice(0, 50) // Keep last 50 completed tools
            ]);
          }, 2000 + Math.random() * 3000); // Simulate varying execution times
        }
      };
      
      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
      
      wsRef.current.onclose = () => {
        console.log('WebSocket closed, reconnecting...');
        setTimeout(connectWS, 1000);
      };
    };
    
    connectWS();
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);
  
  const getToolIcon = (toolName) => {
    const icons = {
      'Read': FileText,
      'Write': Edit,
      'Edit': Edit,
      'Grep': Search,
      'Bash': Terminal,
      'LS': FolderOpen,
      'Glob': Search
    };
    
    const Icon = icons[toolName] || Activity;
    return <Icon className="w-4 h-4" />;
  };
  
  const formatDuration = (startTime, endTime) => {
    const duration = (endTime || Date.now()) - startTime;
    if (duration < 1000) return `${duration}ms`;
    if (duration < 60000) return `${(duration / 1000).toFixed(1)}s`;
    return `${Math.floor(duration / 60000)}m ${Math.floor((duration % 60000) / 1000)}s`;
  };
  
  const formatFileSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };
  
  const toggleExpanded = (toolId) => {
    setExpandedTools(prev => {
      const next = new Set(prev);
      if (next.has(toolId)) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  };
  
  const renderToolExecution = (tool, isActive = true) => {
    const isExpanded = expandedTools.has(tool.id);
    
    return (
      <div key={tool.id} className={`
        border rounded-lg mb-2 overflow-hidden transition-all duration-200
        ${isActive ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700'}
      `}>
        <div
          className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
          onClick={() => toggleExpanded(tool.id)}
        >
          <div className="flex items-center space-x-2 flex-1">
            <button className="p-0.5">
              {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
            
            <div className={`p-1 rounded ${isActive ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}>
              {getToolIcon(tool.name)}
            </div>
            
            <span className="font-medium">{tool.name}</span>
            
            {tool.parameters?.file_path && (
              <span className="text-sm text-gray-600 dark:text-gray-400 truncate max-w-xs">
                {tool.parameters.file_path.split('/').pop()}
              </span>
            )}
            
            {tool.parameters?.pattern && (
              <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">
                {tool.parameters.pattern}
              </code>
            )}
          </div>
          
          <div className="flex items-center space-x-2 text-sm">
            <Clock className="w-3 h-3 text-gray-400" />
            <span className="text-gray-600 dark:text-gray-400">
              {formatDuration(tool.startTime, tool.endTime)}
            </span>
            
            {isActive ? (
              <Loader className="w-4 h-4 text-blue-500 animate-spin" />
            ) : tool.status === 'completed' ? (
              <CheckCircle className="w-4 h-4 text-green-500" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-500" />
            )}
          </div>
        </div>
        
        {isExpanded && (
          <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
            <div className="space-y-2 text-sm">
              {tool.parameters?.file_path && (
                <div className="flex items-start space-x-2">
                  <span className="text-gray-500 dark:text-gray-400 min-w-[80px]">File:</span>
                  <code className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded flex-1 break-all">
                    {tool.parameters.file_path}
                  </code>
                </div>
              )}
              
              {tool.parameters?.pattern && (
                <div className="flex items-start space-x-2">
                  <span className="text-gray-500 dark:text-gray-400 min-w-[80px]">Pattern:</span>
                  <code className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded flex-1 break-all">
                    {tool.parameters.pattern}
                  </code>
                </div>
              )}
              
              {tool.parameters?.command && (
                <div className="flex items-start space-x-2">
                  <span className="text-gray-500 dark:text-gray-400 min-w-[80px]">Command:</span>
                  <code className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded flex-1 break-all">
                    {tool.parameters.command}
                  </code>
                </div>
              )}
              
              {tool.context?.workingDir && (
                <div className="flex items-start space-x-2">
                  <span className="text-gray-500 dark:text-gray-400 min-w-[80px]">Directory:</span>
                  <code className="text-xs text-gray-600 dark:text-gray-400">
                    {tool.context.workingDir}
                  </code>
                </div>
              )}
              
              {tool.context?.operation && (
                <div className="flex items-start space-x-2">
                  <span className="text-gray-500 dark:text-gray-400 min-w-[80px]">Purpose:</span>
                  <span className="text-gray-700 dark:text-gray-300 italic">
                    "{tool.context.operation}"
                  </span>
                </div>
              )}
              
              {tool.result && (
                <div className="mt-2 p-2 bg-gray-50 dark:bg-gray-800 rounded">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Result:</span>
                    {tool.result.size && (
                      <span className="text-xs text-gray-500">{formatFileSize(tool.result.size)}</span>
                    )}
                  </div>
                  <pre className="text-xs text-gray-700 dark:text-gray-300 overflow-x-auto">
                    {JSON.stringify(tool.result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };
  
  if (!isVisible) return null;
  
  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center space-x-2">
          <Activity className="w-5 h-5" />
          <span>Tool Execution Monitor</span>
        </h3>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4">
        {activeTools.length > 0 && (
          <div className="mb-4">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center space-x-1">
              <Loader className="w-3 h-3 animate-spin" />
              <span>Active ({activeTools.length})</span>
            </h4>
            {activeTools.map(tool => renderToolExecution(tool, true))}
          </div>
        )}
        
        {completedTools.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Completed ({completedTools.length})
            </h4>
            {completedTools.slice(0, 10).map(tool => renderToolExecution(tool, false))}
          </div>
        )}
        
        {activeTools.length === 0 && completedTools.length === 0 && (
          <div className="text-center text-gray-500 dark:text-gray-400 py-8">
            <Activity className="w-12 h-12 mx-auto mb-2 opacity-20" />
            <p>No tool executions yet</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ToolExecutionMonitor;