import React, { useState, useEffect, useRef } from 'react';
import { 
  TrendingUp, 
  DollarSign, 
  Zap, 
  FileText, 
  AlertCircle,
  Activity,
  Clock,
  Database,
  BarChart2
} from 'lucide-react';

const MetricsDashboard = ({ sessionId }) => {
  const [metrics, setMetrics] = useState({
    tokensUsed: 0,
    tokensLimit: 200000,
    estimatedCost: 0,
    duration: 0,
    toolCount: 0,
    filesModified: 0,
    errors: [],
    avgResponseTime: 0,
    model: 'claude-sonnet-4'
  });
  
  const [history, setHistory] = useState([]);
  const wsRef = useRef(null);
  const startTimeRef = useRef(Date.now());
  
  useEffect(() => {
    // Reset metrics on new session
    startTimeRef.current = Date.now();
    setMetrics(prev => ({ ...prev, duration: 0, tokensUsed: 0, estimatedCost: 0 }));
    
    // Update duration every second
    const durationInterval = setInterval(() => {
      setMetrics(prev => ({
        ...prev,
        duration: Date.now() - startTimeRef.current
      }));
    }, 1000);
    
    // Connect to WebSocket for metrics updates
    const connectWS = () => {
      const token = localStorage.getItem('auth-token');
      if (!token) return;
      
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.hostname}:${window.location.port || 3008}/ws?token=${encodeURIComponent(token)}`;
      
      wsRef.current = new WebSocket(wsUrl);
      
      wsRef.current.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'metrics-update') {
          setMetrics(prev => ({
            ...prev,
            ...data.metrics
          }));
          
          // Add to history for sparkline
          setHistory(prev => [...prev.slice(-20), {
            timestamp: Date.now(),
            tokens: data.metrics.tokensUsed
          }]);
        }
        
        if (data.type === 'session-complete') {
          setMetrics(prev => ({
            ...prev,
            ...data.metrics
          }));
        }
      };
    };
    
    connectWS();
    
    return () => {
      clearInterval(durationInterval);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [sessionId]);
  
  const formatDuration = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  };
  
  const getTokenUsageColor = () => {
    const percentage = (metrics.tokensUsed / metrics.tokensLimit) * 100;
    if (percentage < 50) return 'text-green-600 dark:text-green-400';
    if (percentage < 80) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };
  
  const renderSparkline = () => {
    if (history.length < 2) return null;
    
    const maxTokens = Math.max(...history.map(h => h.tokens));
    const width = 100;
    const height = 30;
    
    const points = history.map((h, i) => {
      const x = (i / (history.length - 1)) * width;
      const y = height - ((h.tokens / maxTokens) * height);
      return `${x},${y}`;
    }).join(' ');
    
    return (
      <svg width={width} height={height} className="ml-auto">
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-blue-500"
        />
      </svg>
    );
  };
  
  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center space-x-2">
          <BarChart2 className="w-5 h-5" />
          <span>Session Metrics</span>
        </h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          Model: {metrics.model}
        </span>
      </div>
      
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Token Usage */}
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center space-x-1">
              <Database className="w-4 h-4 text-gray-400" />
              <span className="text-xs text-gray-600 dark:text-gray-400">Tokens</span>
            </div>
            {renderSparkline()}
          </div>
          <div className={`text-lg font-semibold ${getTokenUsageColor()}`}>
            {metrics.tokensUsed.toLocaleString()}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            of {(metrics.tokensLimit / 1000).toFixed(0)}k limit
          </div>
          <div className="mt-1 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1">
            <div
              className={`h-1 rounded-full transition-all duration-300 ${
                metrics.tokensUsed / metrics.tokensLimit > 0.8 ? 'bg-red-500' :
                metrics.tokensUsed / metrics.tokensLimit > 0.5 ? 'bg-yellow-500' :
                'bg-green-500'
              }`}
              style={{ width: `${Math.min((metrics.tokensUsed / metrics.tokensLimit) * 100, 100)}%` }}
            />
          </div>
        </div>
        
        {/* Cost Estimate */}
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
          <div className="flex items-center space-x-1 mb-1">
            <DollarSign className="w-4 h-4 text-gray-400" />
            <span className="text-xs text-gray-600 dark:text-gray-400">Est. Cost</span>
          </div>
          <div className="text-lg font-semibold text-gray-900 dark:text-white">
            ${metrics.estimatedCost.toFixed(3)}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            ~${(metrics.estimatedCost / (metrics.duration / 3600000)).toFixed(2)}/hr
          </div>
        </div>
        
        {/* Duration */}
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
          <div className="flex items-center space-x-1 mb-1">
            <Clock className="w-4 h-4 text-gray-400" />
            <span className="text-xs text-gray-600 dark:text-gray-400">Duration</span>
          </div>
          <div className="text-lg font-semibold text-gray-900 dark:text-white">
            {formatDuration(metrics.duration)}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Avg response: {metrics.avgResponseTime.toFixed(1)}s
          </div>
        </div>
        
        {/* Tools & Files */}
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
          <div className="flex items-center space-x-1 mb-1">
            <Activity className="w-4 h-4 text-gray-400" />
            <span className="text-xs text-gray-600 dark:text-gray-400">Activity</span>
          </div>
          <div className="flex items-center space-x-4">
            <div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">
                {metrics.toolCount}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">tools run</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">
                {metrics.filesModified}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">files changed</div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Errors */}
      {metrics.errors.length > 0 && (
        <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
          <div className="flex items-center space-x-2 text-red-700 dark:text-red-400">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm font-medium">
              {metrics.errors.length} error{metrics.errors.length > 1 ? 's' : ''} encountered
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default MetricsDashboard;