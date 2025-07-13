import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';
import { X, Plus, Settings, Shield, AlertTriangle, Moon, Sun, Server, Edit3, Trash2, Play, Globe, Terminal, Zap } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

function ToolsSettings({ isOpen, onClose }) {
  const { isDarkMode, toggleDarkMode } = useTheme();
  const [allowedTools, setAllowedTools] = useState([]);
  const [disallowedTools, setDisallowedTools] = useState([]);
  const [newAllowedTool, setNewAllowedTool] = useState('');
  const [newDisallowedTool, setNewDisallowedTool] = useState('');
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [projectSortOrder, setProjectSortOrder] = useState('name');

  // MCP server management state
  const [mcpServers, setMcpServers] = useState([]);
  const [showMcpForm, setShowMcpForm] = useState(false);
  const [editingMcpServer, setEditingMcpServer] = useState(null);
  const [mcpFormData, setMcpFormData] = useState({
    name: '',
    type: 'stdio',
    scope: 'user', // Always use user scope
    config: {
      command: '',
      args: [],
      env: {},
      url: '',
      headers: {},
      timeout: 30000
    }
  });
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpTestResults, setMcpTestResults] = useState({});
  const [mcpConfigTestResult, setMcpConfigTestResult] = useState(null);
  const [mcpConfigTesting, setMcpConfigTesting] = useState(false);
  const [mcpConfigTested, setMcpConfigTested] = useState(false);
  const [mcpServerTools, setMcpServerTools] = useState({});
  const [mcpToolsLoading, setMcpToolsLoading] = useState({});
  const [activeTab, setActiveTab] = useState('tools');

  // Common tool patterns
  const commonTools = [
    'Bash(git log:*)',
    'Bash(git diff:*)',
    'Bash(git status:*)',
    'Write',
    'Read',
    'Edit',
    'Glob',
    'Grep',
    'MultiEdit',
    'Task',
    'TodoWrite',
    'TodoRead',
    'WebFetch',
    'WebSearch'
  ];

  // MCP API functions
  const fetchMcpServers = async () => {
    try {
      const token = localStorage.getItem('auth-token');
      
      // First try to get servers using Claude CLI
      const cliResponse = await fetch('/api/mcp/cli/list', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (cliResponse.ok) {
        const cliData = await cliResponse.json();
        if (cliData.success && cliData.servers) {
          // Convert CLI format to our format
          const servers = cliData.servers.map(server => ({
            id: server.name,
            name: server.name,
            type: server.type,
            scope: 'user',
            config: {
              command: server.command || '',
              args: server.args || [],
              env: server.env || {},
              url: server.url || '',
              headers: server.headers || {},
              timeout: 30000
            },
            created: new Date().toISOString(),
            updated: new Date().toISOString()
          }));
          setMcpServers(servers);
          return;
        }
      }
      
      // Fallback to direct config reading
      const response = await fetch('/api/mcp/servers?scope=user', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setMcpServers(data.servers || []);
      } else {
        console.error('Failed to fetch MCP servers');
      }
    } catch (error) {
      console.error('Error fetching MCP servers:', error);
    }
  };

  const saveMcpServer = async (serverData) => {
    try {
      const token = localStorage.getItem('auth-token');
      
      if (editingMcpServer) {
        // For editing, remove old server and add new one
        await deleteMcpServer(editingMcpServer.id, 'user');
      }
      
      // Use Claude CLI to add the server
      const response = await fetch('/api/mcp/cli/add', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: serverData.name,
          type: serverData.type,
          command: serverData.config?.command,
          args: serverData.config?.args || [],
          url: serverData.config?.url,
          headers: serverData.config?.headers || {},
          env: serverData.config?.env || {}
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          await fetchMcpServers(); // Refresh the list
          return true;
        } else {
          throw new Error(result.error || 'Failed to save server via Claude CLI');
        }
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save server');
      }
    } catch (error) {
      console.error('Error saving MCP server:', error);
      throw error;
    }
  };

  const deleteMcpServer = async (serverId, scope = 'user') => {
    try {
      const token = localStorage.getItem('auth-token');
      
      // Use Claude CLI to remove the server
      const response = await fetch(`/api/mcp/cli/remove/${serverId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          await fetchMcpServers(); // Refresh the list
          return true;
        } else {
          throw new Error(result.error || 'Failed to delete server via Claude CLI');
        }
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete server');
      }
    } catch (error) {
      console.error('Error deleting MCP server:', error);
      throw error;
    }
  };

  const testMcpServer = async (serverId, scope = 'user') => {
    try {
      const token = localStorage.getItem('auth-token');
      const response = await fetch(`/api/mcp/servers/${serverId}/test?scope=${scope}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        return data.testResult;
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to test server');
      }
    } catch (error) {
      console.error('Error testing MCP server:', error);
      throw error;
    }
  };

  const testMcpConfiguration = async (formData) => {
    try {
      const token = localStorage.getItem('auth-token');
      const response = await fetch('/api/mcp/servers/test', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });
      
      if (response.ok) {
        const data = await response.json();
        return data.testResult;
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to test configuration');
      }
    } catch (error) {
      console.error('Error testing MCP configuration:', error);
      throw error;
    }
  };

  const discoverMcpTools = async (serverId, scope = 'user') => {
    try {
      const token = localStorage.getItem('auth-token');
      const response = await fetch(`/api/mcp/servers/${serverId}/tools?scope=${scope}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        return data.toolsResult;
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to discover tools');
      }
    } catch (error) {
      console.error('Error discovering MCP tools:', error);
      throw error;
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    try {
      
      // Load from localStorage
      const savedSettings = localStorage.getItem('claude-tools-settings');
      
      if (savedSettings) {
        const settings = JSON.parse(savedSettings);
        setAllowedTools(settings.allowedTools || []);
        setDisallowedTools(settings.disallowedTools || []);
        setSkipPermissions(settings.skipPermissions || false);
        setProjectSortOrder(settings.projectSortOrder || 'name');
      } else {
        // Set defaults
        setAllowedTools([]);
        setDisallowedTools([]);
        setSkipPermissions(false);
        setProjectSortOrder('name');
      }

      // Load MCP servers from API
      await fetchMcpServers();
    } catch (error) {
      console.error('Error loading tool settings:', error);
      // Set defaults on error
      setAllowedTools([]);
      setDisallowedTools([]);
      setSkipPermissions(false);
      setProjectSortOrder('name');
    }
  };

  const saveSettings = () => {
    setIsSaving(true);
    setSaveStatus(null);
    
    try {
      const settings = {
        allowedTools,
        disallowedTools,
        skipPermissions,
        projectSortOrder,
        lastUpdated: new Date().toISOString()
      };
      
      
      // Save to localStorage
      localStorage.setItem('claude-tools-settings', JSON.stringify(settings));
      
      setSaveStatus('success');
      
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (error) {
      console.error('Error saving tool settings:', error);
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  const addAllowedTool = (tool) => {
    if (tool && !allowedTools.includes(tool)) {
      setAllowedTools([...allowedTools, tool]);
      setNewAllowedTool('');
    }
  };

  const removeAllowedTool = (tool) => {
    setAllowedTools(allowedTools.filter(t => t !== tool));
  };

  const addDisallowedTool = (tool) => {
    if (tool && !disallowedTools.includes(tool)) {
      setDisallowedTools([...disallowedTools, tool]);
      setNewDisallowedTool('');
    }
  };

  const removeDisallowedTool = (tool) => {
    setDisallowedTools(disallowedTools.filter(t => t !== tool));
  };

  // MCP form handling functions
  const resetMcpForm = () => {
    setMcpFormData({
      name: '',
      type: 'stdio',
      scope: 'user', // Always use user scope
      config: {
        command: '',
        args: [],
        env: {},
        url: '',
        headers: {},
        timeout: 30000
      }
    });
    setEditingMcpServer(null);
    setShowMcpForm(false);
    setMcpConfigTestResult(null);
    setMcpConfigTested(false);
    setMcpConfigTesting(false);
  };

  const openMcpForm = (server = null) => {
    if (server) {
      setEditingMcpServer(server);
      setMcpFormData({
        name: server.name,
        type: server.type,
        scope: server.scope,
        config: { ...server.config }
      });
    } else {
      resetMcpForm();
    }
    setShowMcpForm(true);
  };

  const handleMcpSubmit = async (e) => {
    e.preventDefault();
    
    setMcpLoading(true);
    
    try {
      await saveMcpServer(mcpFormData);
      resetMcpForm();
      setSaveStatus('success');
    } catch (error) {
      alert(`Error: ${error.message}`);
      setSaveStatus('error');
    } finally {
      setMcpLoading(false);
    }
  };

  const handleMcpDelete = async (serverId, scope) => {
    if (confirm('Are you sure you want to delete this MCP server?')) {
      try {
        await deleteMcpServer(serverId, scope);
        setSaveStatus('success');
      } catch (error) {
        alert(`Error: ${error.message}`);
        setSaveStatus('error');
      }
    }
  };

  const handleMcpTest = async (serverId, scope) => {
    try {
      setMcpTestResults({ ...mcpTestResults, [serverId]: { loading: true } });
      const result = await testMcpServer(serverId, scope);
      setMcpTestResults({ ...mcpTestResults, [serverId]: result });
    } catch (error) {
      setMcpTestResults({ 
        ...mcpTestResults, 
        [serverId]: { 
          success: false, 
          message: error.message,
          details: []
        } 
      });
    }
  };

  const handleMcpToolsDiscovery = async (serverId, scope) => {
    try {
      setMcpToolsLoading({ ...mcpToolsLoading, [serverId]: true });
      const result = await discoverMcpTools(serverId, scope);
      setMcpServerTools({ ...mcpServerTools, [serverId]: result });
    } catch (error) {
      setMcpServerTools({ 
        ...mcpServerTools, 
        [serverId]: { 
          success: false, 
          tools: [], 
          resources: [], 
          prompts: [] 
        } 
      });
    } finally {
      setMcpToolsLoading({ ...mcpToolsLoading, [serverId]: false });
    }
  };

  const updateMcpConfig = (key, value) => {
    setMcpFormData(prev => ({
      ...prev,
      config: {
        ...prev.config,
        [key]: value
      }
    }));
    // Reset test status when configuration changes
    setMcpConfigTestResult(null);
    setMcpConfigTested(false);
  };

  const handleTestConfiguration = async () => {
    setMcpConfigTesting(true);
    try {
      const result = await testMcpConfiguration(mcpFormData);
      setMcpConfigTestResult(result);
      setMcpConfigTested(true);
    } catch (error) {
      setMcpConfigTestResult({
        success: false,
        message: error.message,
        details: []
      });
      setMcpConfigTested(true);
    } finally {
      setMcpConfigTesting(false);
    }
  };

  const getTransportIcon = (type) => {
    switch (type) {
      case 'stdio': return <Terminal className="w-4 h-4" />;
      case 'sse': return <Zap className="w-4 h-4" />;
      case 'http': return <Globe className="w-4 h-4" />;
      default: return <Server className="w-4 h-4" />;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop fixed inset-0 flex items-center justify-center z-[100] md:p-4 bg-background/95">
      <div className="bg-background border border-border md:rounded-lg shadow-xl w-full md:max-w-4xl h-full md:h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <Settings className="w-5 h-5 md:w-6 md:h-6 text-blue-600" />
            <h2 className="text-lg md:text-xl font-semibold text-foreground">
              Settings
            </h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground touch-manipulation"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Tab Navigation */}
          <div className="border-b border-border">
            <div className="flex px-4 md:px-6">
              <button
                onClick={() => setActiveTab('tools')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'tools'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                Tools
              </button>
              <button
                onClick={() => setActiveTab('appearance')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'appearance'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                Appearance
              </button>
            </div>
          </div>

          <div className="p-4 md:p-6 space-y-6 md:space-y-8 pb-safe-area-inset-bottom">
            
            {/* Appearance Tab */}
            {activeTab === 'appearance' && (
              <div className="space-y-6 md:space-y-8">
               {activeTab === 'appearance' && (
  <div className="space-y-6 md:space-y-8">
    {/* Theme Settings */}
    <div className="space-y-4">
      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-foreground">
              Dark Mode
            </div>
            <div className="text-sm text-muted-foreground">
              Toggle between light and dark themes
            </div>
          </div>
          <button
            onClick={toggleDarkMode}
            className="relative inline-flex h-8 w-14 items-center rounded-full bg-gray-200 dark:bg-gray-700 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            role="switch"
            aria-checked={isDarkMode}
            aria-label="Toggle dark mode"
          >
            <span className="sr-only">Toggle dark mode</span>
            <span
              className={`${
                isDarkMode ? 'translate-x-7' : 'translate-x-1'
              } inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-200 flex items-center justify-center`}
            >
              {isDarkMode ? (
                <Moon className="w-3.5 h-3.5 text-gray-700" />
              ) : (
                <Sun className="w-3.5 h-3.5 text-yellow-500" />
              )}
            </span>
          </button>
        </div>
      </div>
    </div>

    {/* Project Sorting */}
    <div className="space-y-4">
      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-foreground">
              Project Sorting
            </div>
            <div className="text-sm text-muted-foreground">
              How projects are ordered in the sidebar
            </div>
          </div>
          <select
            value={projectSortOrder}
            onChange={(e) => setProjectSortOrder(e.target.value)}
            className="text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2 w-32"
          >
            <option value="name">Alphabetical</option>
            <option value="date">Recent Activity</option>
          </select>
        </div>
      </div>
    </div>
  </div>
)}

              </div>
            )}

            {/* Tools Tab */}
            {activeTab === 'tools' && (
              <div className="space-y-6 md:space-y-8">
            
            {/* Skip Permissions */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-orange-500" />
                <h3 className="text-lg font-medium text-foreground">
                  Permission Settings
                </h3>
              </div>
              <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={skipPermissions}
                    onChange={(e) => setSkipPermissions(e.target.checked)}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <div>
                    <div className="font-medium text-orange-900 dark:text-orange-100">
                      Skip permission prompts (use with caution)
                    </div>
                    <div className="text-sm text-orange-700 dark:text-orange-300">
                      Equivalent to --dangerously-skip-permissions flag
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* Allowed Tools */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Shield className="w-5 h-5 text-green-500" />
                <h3 className="text-lg font-medium text-foreground">
                  Allowed Tools
                </h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Tools that are automatically allowed without prompting for permission
              </p>
              
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={newAllowedTool}
                  onChange={(e) => setNewAllowedTool(e.target.value)}
                  placeholder='e.g., "Bash(git log:*)" or "Write"'
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      addAllowedTool(newAllowedTool);
                    }
                  }}
                  className="flex-1 h-10 touch-manipulation"
                  style={{ fontSize: '16px' }}
                />
                <Button
                  onClick={() => addAllowedTool(newAllowedTool)}
                  disabled={!newAllowedTool}
                  size="sm"
                  className="h-10 px-4 touch-manipulation"
                >
                  <Plus className="w-4 h-4 mr-2 sm:mr-0" />
                  <span className="sm:hidden">Add Tool</span>
                </Button>
              </div>

              {/* Common tools quick add */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Quick add common tools:
                </p>
                <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
                  {commonTools.map(tool => (
                    <Button
                      key={tool}
                      variant="outline"
                      size="sm"
                      onClick={() => addAllowedTool(tool)}
                      disabled={allowedTools.includes(tool)}
                      className="text-xs h-8 touch-manipulation truncate"
                    >
                      {tool}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                {allowedTools.map(tool => (
                  <div key={tool} className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
                    <span className="font-mono text-sm text-green-800 dark:text-green-200">
                      {tool}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeAllowedTool(tool)}
                      className="text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                {allowedTools.length === 0 && (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    No allowed tools configured
                  </div>
                )}
              </div>
            </div>

            {/* Disallowed Tools */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                <h3 className="text-lg font-medium text-foreground">
                  Disallowed Tools
                </h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Tools that are automatically blocked without prompting for permission
              </p>
              
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={newDisallowedTool}
                  onChange={(e) => setNewDisallowedTool(e.target.value)}
                  placeholder='e.g., "Bash(rm:*)" or "Write"'
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      addDisallowedTool(newDisallowedTool);
                    }
                  }}
                  className="flex-1 h-10 touch-manipulation"
                  style={{ fontSize: '16px' }}
                />
                <Button
                  onClick={() => addDisallowedTool(newDisallowedTool)}
                  disabled={!newDisallowedTool}
                  size="sm"
                  className="h-10 px-4 touch-manipulation"
                >
                  <Plus className="w-4 h-4 mr-2 sm:mr-0" />
                  <span className="sm:hidden">Add Tool</span>
                </Button>
              </div>

              <div className="space-y-2">
                {disallowedTools.map(tool => (
                  <div key={tool} className="flex items-center justify-between bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                    <span className="font-mono text-sm text-red-800 dark:text-red-200">
                      {tool}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeDisallowedTool(tool)}
                      className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                {disallowedTools.length === 0 && (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    No disallowed tools configured
                  </div>
                )}
              </div>
            </div>

            {/* Help Section */}
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
                Tool Pattern Examples:
              </h4>
              <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
                <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Bash(git log:*)"</code> - Allow all git log commands</li>
                <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Bash(git diff:*)"</code> - Allow all git diff commands</li>
                <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Write"</code> - Allow all Write tool usage</li>
                <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Read"</code> - Allow all Read tool usage</li>
                <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Bash(rm:*)"</code> - Block all rm commands (dangerous)</li>
              </ul>
            </div>

            {/* MCP Server Management */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Server className="w-5 h-5 text-purple-500" />
                <h3 className="text-lg font-medium text-foreground">
                  MCP Servers
                </h3>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Model Context Protocol servers provide additional tools and data sources to Claude
                </p>
              </div>
              
              <div className="flex justify-between items-center">
                <Button
                  onClick={() => openMcpForm()}
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                  size="sm"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add MCP Server
                </Button>
              </div>

              {/* MCP Servers List */}
              <div className="space-y-2">
                {mcpServers.map(server => (
                  <div key={server.id} className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          {getTransportIcon(server.type)}
                          <span className="font-medium text-foreground">{server.name}</span>
                          <Badge variant="outline" className="text-xs">
                            {server.type}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {server.scope}
                          </Badge>
                        </div>
                        
                        <div className="text-sm text-muted-foreground space-y-1">
                          {server.type === 'stdio' && server.config.command && (
                            <div>Command: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">{server.config.command}</code></div>
                          )}
                          {(server.type === 'sse' || server.type === 'http') && server.config.url && (
                            <div>URL: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">{server.config.url}</code></div>
                          )}
                          {server.config.args && server.config.args.length > 0 && (
                            <div>Args: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">{server.config.args.join(' ')}</code></div>
                          )}
                        </div>

                        {/* Test Results */}
                        {mcpTestResults[server.id] && (
                          <div className={`mt-2 p-2 rounded text-xs ${
                            mcpTestResults[server.id].success 
                              ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200' 
                              : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
                          }`}>
                            <div className="font-medium">{mcpTestResults[server.id].message}</div>
                            {mcpTestResults[server.id].details && mcpTestResults[server.id].details.length > 0 && (
                              <ul className="mt-1 space-y-0.5">
                                {mcpTestResults[server.id].details.map((detail, i) => (
                                  <li key={i}>• {detail}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}

                        {/* Tools Discovery Results */}
                        {mcpServerTools[server.id] && (
                          <div className="mt-2 p-2 rounded text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800">
                            <div className="font-medium mb-2">Available Tools & Resources</div>
                            
                            {mcpServerTools[server.id].tools && mcpServerTools[server.id].tools.length > 0 && (
                              <div className="mb-2">
                                <div className="font-medium text-xs mb-1">Tools ({mcpServerTools[server.id].tools.length}):</div>
                                <ul className="space-y-0.5">
                                  {mcpServerTools[server.id].tools.map((tool, i) => (
                                    <li key={i} className="flex items-start gap-1">
                                      <span className="text-blue-400 mt-0.5">•</span>
                                      <div>
                                        <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">{tool.name}</code>
                                        {tool.description && tool.description !== 'No description provided' && (
                                          <span className="ml-1 text-xs opacity-75">- {tool.description}</span>
                                        )}
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {mcpServerTools[server.id].resources && mcpServerTools[server.id].resources.length > 0 && (
                              <div className="mb-2">
                                <div className="font-medium text-xs mb-1">Resources ({mcpServerTools[server.id].resources.length}):</div>
                                <ul className="space-y-0.5">
                                  {mcpServerTools[server.id].resources.map((resource, i) => (
                                    <li key={i} className="flex items-start gap-1">
                                      <span className="text-blue-400 mt-0.5">•</span>
                                      <div>
                                        <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">{resource.name}</code>
                                        {resource.description && resource.description !== 'No description provided' && (
                                          <span className="ml-1 text-xs opacity-75">- {resource.description}</span>
                                        )}
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {mcpServerTools[server.id].prompts && mcpServerTools[server.id].prompts.length > 0 && (
                              <div>
                                <div className="font-medium text-xs mb-1">Prompts ({mcpServerTools[server.id].prompts.length}):</div>
                                <ul className="space-y-0.5">
                                  {mcpServerTools[server.id].prompts.map((prompt, i) => (
                                    <li key={i} className="flex items-start gap-1">
                                      <span className="text-blue-400 mt-0.5">•</span>
                                      <div>
                                        <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">{prompt.name}</code>
                                        {prompt.description && prompt.description !== 'No description provided' && (
                                          <span className="ml-1 text-xs opacity-75">- {prompt.description}</span>
                                        )}
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {(!mcpServerTools[server.id].tools || mcpServerTools[server.id].tools.length === 0) &&
                             (!mcpServerTools[server.id].resources || mcpServerTools[server.id].resources.length === 0) &&
                             (!mcpServerTools[server.id].prompts || mcpServerTools[server.id].prompts.length === 0) && (
                              <div className="text-xs opacity-75">No tools, resources, or prompts discovered</div>
                            )}
                          </div>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-2 ml-4">
                        <Button
                          onClick={() => handleMcpTest(server.id, server.scope)}
                          variant="ghost"
                          size="sm"
                          disabled={mcpTestResults[server.id]?.loading}
                          className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                          title="Test connection"
                        >
                          {mcpTestResults[server.id]?.loading ? (
                            <div className="w-4 h-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                          ) : (
                            <Play className="w-4 h-4" />
                          )}
                        </Button>
                        <Button
                          onClick={() => handleMcpToolsDiscovery(server.id, server.scope)}
                          variant="ghost"
                          size="sm"
                          disabled={mcpToolsLoading[server.id]}
                          className="text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300"
                          title="Discover tools"
                        >
                          {mcpToolsLoading[server.id] ? (
                            <div className="w-4 h-4 animate-spin rounded-full border-2 border-purple-600 border-t-transparent" />
                          ) : (
                            <Settings className="w-4 h-4" />
                          )}
                        </Button>
                        <Button
                          onClick={() => openMcpForm(server)}
                          variant="ghost"
                          size="sm"
                          className="text-gray-600 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                        >
                          <Edit3 className="w-4 h-4" />
                        </Button>
                        <Button
                          onClick={() => handleMcpDelete(server.id, server.scope)}
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                {mcpServers.length === 0 && (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    No MCP servers configured
                  </div>
                )}
              </div>
            </div>

            {/* MCP Server Form Modal */}
            {showMcpForm && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110] p-4">
                <div className="bg-background border border-border rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                  <div className="flex items-center justify-between p-4 border-b border-border">
                    <h3 className="text-lg font-medium text-foreground">
                      {editingMcpServer ? 'Edit MCP Server' : 'Add MCP Server'}
                    </h3>
                    <Button variant="ghost" size="sm" onClick={resetMcpForm}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  
                  <form onSubmit={handleMcpSubmit} className="p-4 space-y-4">
                    {/* Basic Info */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-2">
                          Server Name *
                        </label>
                        <Input
                          value={mcpFormData.name}
                          onChange={(e) => {
                            setMcpFormData(prev => ({...prev, name: e.target.value}));
                            setMcpConfigTestResult(null);
                            setMcpConfigTested(false);
                          }}
                          placeholder="my-server"
                          required
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-2">
                          Transport Type *
                        </label>
                        <select
                          value={mcpFormData.type}
                          onChange={(e) => {
                            setMcpFormData(prev => ({...prev, type: e.target.value}));
                            setMcpConfigTestResult(null);
                            setMcpConfigTested(false);
                          }}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value="stdio">stdio</option>
                          <option value="sse">SSE</option>
                          <option value="http">HTTP</option>
                        </select>
                      </div>
                    </div>

                    {/* Scope is fixed to user - no selection needed */}

                    {/* Transport-specific Config */}
                    {mcpFormData.type === 'stdio' && (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            Command *
                          </label>
                          <Input
                            value={mcpFormData.config.command}
                            onChange={(e) => updateMcpConfig('command', e.target.value)}
                            placeholder="/path/to/mcp-server"
                            required
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            Arguments (one per line)
                          </label>
                          <textarea
                            value={Array.isArray(mcpFormData.config.args) ? mcpFormData.config.args.join('\n') : ''}
                            onChange={(e) => updateMcpConfig('args', e.target.value.split('\n').filter(arg => arg.trim()))}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                            rows="3"
                            placeholder="--api-key&#10;abc123"
                          />
                        </div>
                      </div>
                    )}

                    {(mcpFormData.type === 'sse' || mcpFormData.type === 'http') && (
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-2">
                          URL *
                        </label>
                        <Input
                          value={mcpFormData.config.url}
                          onChange={(e) => updateMcpConfig('url', e.target.value)}
                          placeholder="https://api.example.com/mcp"
                          type="url"
                          required
                        />
                      </div>
                    )}

                    {/* Environment Variables */}
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        Environment Variables (KEY=value, one per line)
                      </label>
                      <textarea
                        value={Object.entries(mcpFormData.config.env || {}).map(([k, v]) => `${k}=${v}`).join('\n')}
                        onChange={(e) => {
                          const env = {};
                          e.target.value.split('\n').forEach(line => {
                            const [key, ...valueParts] = line.split('=');
                            if (key && key.trim()) {
                              env[key.trim()] = valueParts.join('=').trim();
                            }
                          });
                          updateMcpConfig('env', env);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                        rows="3"
                        placeholder="API_KEY=your-key&#10;DEBUG=true"
                      />
                    </div>

                    {(mcpFormData.type === 'sse' || mcpFormData.type === 'http') && (
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-2">
                          Headers (KEY=value, one per line)
                        </label>
                        <textarea
                          value={Object.entries(mcpFormData.config.headers || {}).map(([k, v]) => `${k}=${v}`).join('\n')}
                          onChange={(e) => {
                            const headers = {};
                            e.target.value.split('\n').forEach(line => {
                              const [key, ...valueParts] = line.split('=');
                              if (key && key.trim()) {
                                headers[key.trim()] = valueParts.join('=').trim();
                              }
                            });
                            updateMcpConfig('headers', headers);
                          }}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                          rows="3"
                          placeholder="Authorization=Bearer token&#10;X-API-Key=your-key"
                        />
                      </div>
                    )}

                    {/* Test Configuration Section */}
                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-medium text-foreground">Configuration Test</h4>
                        <Button
                          type="button"
                          onClick={handleTestConfiguration}
                          disabled={mcpConfigTesting || !mcpFormData.name.trim()}
                          variant="outline"
                          size="sm"
                          className="text-blue-600 border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                        >
                          {mcpConfigTesting ? (
                            <>
                              <div className="w-4 h-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent mr-2" />
                              Testing...
                            </>
                          ) : (
                            <>
                              <Play className="w-4 h-4 mr-2" />
                              Test Configuration
                            </>
                          )}
                        </Button>
                      </div>
                      
                      <p className="text-sm text-muted-foreground mb-3">
                        You can test your configuration to verify it's working correctly.
                      </p>
                      
                      {mcpConfigTestResult && (
                        <div className={`p-3 rounded-lg text-sm ${
                          mcpConfigTestResult.success 
                            ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800' 
                            : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800'
                        }`}>
                          <div className="font-medium flex items-center gap-2">
                            {mcpConfigTestResult.success ? (
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            ) : (
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                              </svg>
                            )}
                            {mcpConfigTestResult.message}
                          </div>
                          {mcpConfigTestResult.details && mcpConfigTestResult.details.length > 0 && (
                            <ul className="mt-2 space-y-1 text-xs">
                              {mcpConfigTestResult.details.map((detail, i) => (
                                <li key={i} className="flex items-start gap-1">
                                  <span className="text-gray-400 mt-0.5">•</span>
                                  <span>{detail}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex justify-end gap-2 pt-4">
                      <Button type="button" variant="outline" onClick={resetMcpForm}>
                        Cancel
                      </Button>
                      <Button 
                        type="submit" 
                        disabled={mcpLoading} 
                        className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50"
                      >
                        {mcpLoading ? 'Saving...' : (editingMcpServer ? 'Update Server' : 'Add Server')}
                      </Button>
                    </div>
                  </form>
                </div>
              </div>
            )}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 md:p-6 border-t border-border flex-shrink-0 gap-3 pb-safe-area-inset-bottom">
          <div className="flex items-center justify-center sm:justify-start gap-2 order-2 sm:order-1">
            {saveStatus === 'success' && (
              <div className="text-green-600 dark:text-green-400 text-sm flex items-center gap-1">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Settings saved successfully!
              </div>
            )}
            {saveStatus === 'error' && (
              <div className="text-red-600 dark:text-red-400 text-sm flex items-center gap-1">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                Failed to save settings
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 order-1 sm:order-2">
            <Button 
              variant="outline" 
              onClick={onClose} 
              disabled={isSaving}
              className="flex-1 sm:flex-none h-10 touch-manipulation"
            >
              Cancel
            </Button>
            <Button 
              onClick={saveSettings} 
              disabled={isSaving}
              className="flex-1 sm:flex-none h-10 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 touch-manipulation"
            >
              {isSaving ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Saving...
                </div>
              ) : (
                'Save Settings'
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ToolsSettings;
