import React, { useState } from 'react';
import { 
  PanelLeft, 
  PanelRight, 
  Activity, 
  BarChart2, 
  Layers,
  Terminal,
  MessageSquare,
  X
} from 'lucide-react';
import ChatInterface from './ChatInterface';
import ToolExecutionMonitor from './ToolExecutionMonitor';
import MetricsDashboard from './MetricsDashboard';
import ProcessBreakdown from './ProcessBreakdown';
import Shell from './Shell';

const EnhancedLayout = ({ 
  selectedProject, 
  selectedSession,
  sendMessage,
  markSessionActive,
  markSessionInactive 
}) => {
  const [activeView, setActiveView] = useState('chat');
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [rightPanelView, setRightPanelView] = useState('tools');
  
  const viewTabs = [
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'shell', label: 'Terminal', icon: Terminal }
  ];
  
  const rightPanelTabs = [
    { id: 'tools', label: 'Tools', icon: Activity },
    { id: 'process', label: 'Process', icon: Layers },
    { id: 'metrics', label: 'Metrics', icon: BarChart2 }
  ];
  
  return (
    <div className="flex h-full bg-gray-50 dark:bg-gray-900">
      {/* Main Content Area */}
      <div className={`flex-1 flex flex-col transition-all duration-300 ${
        rightPanelOpen ? 'mr-96' : 'mr-0'
      }`}>
        {/* Tab Bar */}
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between px-4">
            <div className="flex space-x-1">
              {viewTabs.map(tab => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveView(tab.id)}
                    className={`
                      flex items-center space-x-2 px-4 py-3 text-sm font-medium transition-colors
                      border-b-2 -mb-px
                      ${activeView === tab.id
                        ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400'
                        : 'text-gray-600 dark:text-gray-400 border-transparent hover:text-gray-900 dark:hover:text-white'
                      }
                    `}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
            
            <button
              onClick={() => setRightPanelOpen(!rightPanelOpen)}
              className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              {rightPanelOpen ? <PanelRight className="w-5 h-5" /> : <PanelLeft className="w-5 h-5" />}
            </button>
          </div>
        </div>
        
        {/* Metrics Bar */}
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-2">
          <MetricsDashboard sessionId={selectedSession?.id} />
        </div>
        
        {/* Main View */}
        <div className="flex-1 overflow-hidden">
          {activeView === 'chat' && (
            <ChatInterface
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              sendMessage={sendMessage}
              markSessionActive={markSessionActive}
              markSessionInactive={markSessionInactive}
            />
          )}
          
          {activeView === 'shell' && (
            <Shell
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              isActive={true}
            />
          )}
        </div>
      </div>
      
      {/* Right Panel */}
      {rightPanelOpen && (
        <div className="fixed right-0 top-0 h-full w-96 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 flex flex-col">
          {/* Panel Tabs */}
          <div className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between px-4">
              <div className="flex space-x-1">
                {rightPanelTabs.map(tab => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setRightPanelView(tab.id)}
                      className={`
                        flex items-center space-x-1.5 px-3 py-2.5 text-sm font-medium transition-colors
                        border-b-2 -mb-px
                        ${rightPanelView === tab.id
                          ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400'
                          : 'text-gray-600 dark:text-gray-400 border-transparent hover:text-gray-900 dark:hover:text-white'
                        }
                      `}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>
              
              <button
                onClick={() => setRightPanelOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          
          {/* Panel Content */}
          <div className="flex-1 overflow-hidden">
            {rightPanelView === 'tools' && (
              <ToolExecutionMonitor isVisible={true} />
            )}
            
            {rightPanelView === 'process' && (
              <div className="p-4 overflow-y-auto">
                <ProcessBreakdown sessionId={selectedSession?.id} />
              </div>
            )}
            
            {rightPanelView === 'metrics' && (
              <div className="p-4 overflow-y-auto">
                <div className="space-y-4">
                  <MetricsDashboard sessionId={selectedSession?.id} />
                  {/* Additional detailed metrics can go here */}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default EnhancedLayout;