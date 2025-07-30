import React, { useState, useEffect } from 'react';
import { 
  CheckCircle2, 
  Circle, 
  Loader2, 
  AlertCircle,
  ChevronRight,
  Clock,
  Layers
} from 'lucide-react';

const ProcessBreakdown = ({ sessionId }) => {
  const [phases, setPhases] = useState([]);
  const [currentPhase, setCurrentPhase] = useState(null);
  
  useEffect(() => {
    // Mock data for demonstration - in real implementation, this would come from WebSocket
    const mockPhases = [
      {
        id: 1,
        name: 'Analysis',
        description: 'Understanding the codebase and requirements',
        status: 'completed',
        steps: [
          { name: 'Read package.json', status: 'completed', duration: 340 },
          { name: 'Scan project structure', status: 'completed', duration: 1200 },
          { name: 'Analyze dependencies', status: 'completed', duration: 890 }
        ],
        startTime: Date.now() - 5000,
        endTime: Date.now() - 2500
      },
      {
        id: 2,
        name: 'Planning',
        description: 'Creating implementation strategy',
        status: 'active',
        steps: [
          { name: 'Identify components to modify', status: 'completed', duration: 450 },
          { name: 'Plan state management', status: 'active', duration: null },
          { name: 'Design API integration', status: 'pending', duration: null }
        ],
        startTime: Date.now() - 2500,
        endTime: null
      },
      {
        id: 3,
        name: 'Implementation',
        description: 'Writing and modifying code',
        status: 'pending',
        steps: [
          { name: 'Create new components', status: 'pending', duration: null },
          { name: 'Update existing modules', status: 'pending', duration: null },
          { name: 'Add error handling', status: 'pending', duration: null }
        ],
        startTime: null,
        endTime: null
      },
      {
        id: 4,
        name: 'Testing',
        description: 'Verifying changes work correctly',
        status: 'pending',
        steps: [
          { name: 'Run unit tests', status: 'pending', duration: null },
          { name: 'Check for type errors', status: 'pending', duration: null },
          { name: 'Validate UI changes', status: 'pending', duration: null }
        ],
        startTime: null,
        endTime: null
      }
    ];
    
    setPhases(mockPhases);
    setCurrentPhase(mockPhases.find(p => p.status === 'active'));
    
    // Listen for WebSocket updates
    const connectWS = () => {
      const token = localStorage.getItem('auth-token');
      if (!token) return;
      
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.hostname}:${window.location.port || 3008}/ws?token=${encodeURIComponent(token)}`;
      
      const ws = new WebSocket(wsUrl);
      
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'operation-phase') {
          // Update phases based on WebSocket data
          console.log('Phase update:', data.phase);
        }
      };
      
      return ws;
    };
    
    const ws = connectWS();
    
    return () => {
      if (ws) ws.close();
    };
  }, [sessionId]);
  
  const getPhaseIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'active':
        return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
      case 'pending':
        return <Circle className="w-5 h-5 text-gray-300 dark:text-gray-600" />;
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      default:
        return <Circle className="w-5 h-5 text-gray-300 dark:text-gray-600" />;
    }
  };
  
  const getStepIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'active':
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'pending':
        return <Circle className="w-4 h-4 text-gray-300 dark:text-gray-600" />;
      default:
        return <Circle className="w-4 h-4 text-gray-300 dark:text-gray-600" />;
    }
  };
  
  const formatDuration = (ms) => {
    if (!ms) return '--';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };
  
  const calculateProgress = () => {
    const totalSteps = phases.reduce((acc, phase) => acc + phase.steps.length, 0);
    const completedSteps = phases.reduce((acc, phase) => 
      acc + phase.steps.filter(s => s.status === 'completed').length, 0
    );
    return totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;
  };
  
  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center space-x-2">
          <Layers className="w-5 h-5" />
          <span>Operation Breakdown</span>
        </h3>
        <div className="flex items-center space-x-2">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            Progress: {calculateProgress().toFixed(0)}%
          </div>
          <div className="w-24 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${calculateProgress()}%` }}
            />
          </div>
        </div>
      </div>
      
      {currentPhase && (
        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <div className="flex items-center space-x-2 text-blue-700 dark:text-blue-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm font-medium">
              Current Phase: {currentPhase.name}
            </span>
          </div>
          <p className="text-xs text-blue-600 dark:text-blue-300 mt-1">
            {currentPhase.description}
          </p>
        </div>
      )}
      
      <div className="space-y-3">
        {phases.map((phase, phaseIndex) => (
          <div key={phase.id} className="relative">
            {/* Connector line */}
            {phaseIndex < phases.length - 1 && (
              <div className={`absolute left-2.5 top-8 w-0.5 h-full -mb-3 ${
                phase.status === 'completed' ? 'bg-green-300 dark:bg-green-700' : 'bg-gray-200 dark:bg-gray-700'
              }`} />
            )}
            
            <div className={`
              rounded-lg border transition-all duration-200
              ${phase.status === 'active' 
                ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/10' 
                : 'border-gray-200 dark:border-gray-700'
              }
            `}>
              <div className="p-3">
                <div className="flex items-start space-x-3">
                  {getPhaseIcon(phase.status)}
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium text-gray-900 dark:text-white">
                        {phase.name}
                      </h4>
                      {phase.startTime && (
                        <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center space-x-1">
                          <Clock className="w-3 h-3" />
                          <span>{formatDuration(phase.endTime ? phase.endTime - phase.startTime : Date.now() - phase.startTime)}</span>
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                      {phase.description}
                    </p>
                    
                    {/* Steps */}
                    {(phase.status === 'active' || phase.status === 'completed') && (
                      <div className="mt-2 space-y-1">
                        {phase.steps.map((step, stepIndex) => (
                          <div key={stepIndex} className="flex items-center space-x-2 ml-2">
                            {getStepIcon(step.status)}
                            <span className={`text-sm ${
                              step.status === 'completed' ? 'text-gray-600 dark:text-gray-400' :
                              step.status === 'active' ? 'text-gray-900 dark:text-white font-medium' :
                              'text-gray-400 dark:text-gray-500'
                            }`}>
                              {step.name}
                            </span>
                            {step.duration && (
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                ({formatDuration(step.duration)})
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProcessBreakdown;