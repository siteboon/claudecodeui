import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { X, Plus, Settings as SettingsIcon, Shield, AlertTriangle, Moon, Sun, Server, Edit3, Trash2, Globe, Terminal, Zap, FolderOpen, LogIn } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useTasksSettings } from '../contexts/TasksSettingsContext';
import StandaloneShell from './StandaloneShell';
import ClaudeLogo from './ClaudeLogo';
import CursorLogo from './CursorLogo';

function Settings({ isOpen, onClose, projects = [] }) {
  const { isDarkMode, toggleDarkMode } = useTheme();
  const { 
    tasksEnabled, 
    setTasksEnabled, 
    isTaskMasterInstalled, 
    isTaskMasterReady, 
    installationStatus, 
    isCheckingInstallation 
  } = useTasksSettings();
  const [allowedTools, setAllowedTools] = useState([]);
  const [disallowedTools, setDisallowedTools] = useState([]);
  const [newAllowedTool, setNewAllowedTool] = useState('');
  const [newDisallowedTool, setNewDisallowedTool] = useState('');
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [projectSortOrder, setProjectSortOrder] = useState('name');

  const [mcpServers, setMcpServers] = useState([]);
  const [showMcpForm, setShowMcpForm] = useState(false);
  const [editingMcpServer, setEditingMcpServer] = useState(null);
  const [mcpFormData, setMcpFormData] = useState({
    name: '',
    type: 'stdio',
    scope: 'user',
    projectPath: '', // For local scope
    config: {
      command: '',
      args: [],
      env: {},
      url: '',
      headers: {},
      timeout: 30000
    },
    jsonInput: '', // For JSON import
    importMode: 'form' // 'form' or 'json'
  });
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpTestResults, setMcpTestResults] = useState({});
  const [mcpServerTools, setMcpServerTools] = useState({});
  const [mcpToolsLoading, setMcpToolsLoading] = useState({});
  const [activeTab, setActiveTab] = useState('tools');
  const [jsonValidationError, setJsonValidationError] = useState('');
  const [toolsProvider, setToolsProvider] = useState('claude'); // 'claude' or 'cursor'
  
  // Cursor-specific states
  const [cursorAllowedCommands, setCursorAllowedCommands] = useState([]);
  const [cursorDisallowedCommands, setCursorDisallowedCommands] = useState([]);
  const [cursorSkipPermissions, setCursorSkipPermissions] = useState(false);
  const [newCursorCommand, setNewCursorCommand] = useState('');
  const [newCursorDisallowedCommand, setNewCursorDisallowedCommand] = useState('');
  const [cursorMcpServers, setCursorMcpServers] = useState([]);

  // Login modal states
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginProvider, setLoginProvider] = useState(''); // 'claude' or 'cursor'
  const [selectedProject, setSelectedProject] = useState(null);
  // Common tool patterns for Claude
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
  
  // Common shell commands for Cursor
  const commonCursorCommands = [
    'Shell(ls)',
    'Shell(mkdir)',
    'Shell(cd)',
    'Shell(cat)',
    'Shell(echo)',
    'Shell(git status)',
    'Shell(git diff)',
    'Shell(git log)',
    'Shell(npm install)',
    'Shell(npm run)',
    'Shell(python)',
    'Shell(node)'
  ];

  // Fetch Cursor MCP servers
  const fetchCursorMcpServers = async () => {
    try {
      const token = localStorage.getItem('auth-token');
      const response = await fetch('/api/cursor/mcp', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setCursorMcpServers(data.servers || []);
      } else {
        console.error('Failed to fetch Cursor MCP servers');
      }
    } catch (error) {
      console.error('Error fetching Cursor MCP servers:', error);
    }
  };
  
  // MCP API functions
  const fetchMcpServers = async () => {
    try {
      const token = localStorage.getItem('auth-token');
      
      // Try to read directly from config files for complete details
      const configResponse = await fetch('/api/mcp/config/read', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (configResponse.ok) {
        const configData = await configResponse.json();
        if (configData.success && configData.servers) {
          setMcpServers(configData.servers);
          return;
        }
      }
      
      // Fallback to Claude CLI
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
      
      // Final fallback to direct config reading
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
          scope: serverData.scope,
          projectPath: serverData.projectPath,
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
      
      // Use Claude CLI to remove the server with proper scope
      const response = await fetch(`/api/mcp/cli/remove/${serverId}?scope=${scope}`, {
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
      
      // Load Claude settings from localStorage
      const savedSettings = localStorage.getItem('claude-settings');
      
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
      
      // Load Cursor settings from localStorage
      const savedCursorSettings = localStorage.getItem('cursor-tools-settings');
      
      if (savedCursorSettings) {
        const cursorSettings = JSON.parse(savedCursorSettings);
        setCursorAllowedCommands(cursorSettings.allowedCommands || []);
        setCursorDisallowedCommands(cursorSettings.disallowedCommands || []);
        setCursorSkipPermissions(cursorSettings.skipPermissions || false);
      } else {
        // Set Cursor defaults
        setCursorAllowedCommands([]);
        setCursorDisallowedCommands([]);
        setCursorSkipPermissions(false);
      }

      // Load MCP servers from API
      await fetchMcpServers();
      
      // Load Cursor MCP servers
      await fetchCursorMcpServers();
    } catch (error) {
      console.error('Error loading tool settings:', error);
      // Set defaults on error
      setAllowedTools([]);
      setDisallowedTools([]);
      setSkipPermissions(false);
      setProjectSortOrder('name');
    }
  };

  // Login handlers
  const handleClaudeLogin = () => {
    setLoginProvider('claude');
    setSelectedProject(projects?.[0] || { name: 'default', fullPath: process.cwd() });
    setShowLoginModal(true);
  };

  const handleCursorLogin = () => {
    setLoginProvider('cursor');
    setSelectedProject(projects?.[0] || { name: 'default', fullPath: process.cwd() });
    setShowLoginModal(true);
  };

  const handleLoginComplete = (exitCode) => {
    if (exitCode === 0) {
      // Login successful - could show a success message here
    }
    setShowLoginModal(false);
  };

  const saveSettings = () => {
    setIsSaving(true);
    setSaveStatus(null);
    
    try {
      // Save Claude settings
      const claudeSettings = {
        allowedTools,
        disallowedTools,
        skipPermissions,
        projectSortOrder,
        lastUpdated: new Date().toISOString()
      };
      
      // Save Cursor settings
      const cursorSettings = {
        allowedCommands: cursorAllowedCommands,
        disallowedCommands: cursorDisallowedCommands,
        skipPermissions: cursorSkipPermissions,
        lastUpdated: new Date().toISOString()
      };
      
      // Save to localStorage
      localStorage.setItem('claude-settings', JSON.stringify(claudeSettings));
      localStorage.setItem('cursor-tools-settings', JSON.stringify(cursorSettings));
      
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
      scope: 'user', // Default to user scope
      projectPath: '',
      config: {
        command: '',
        args: [],
        env: {},
        url: '',
        headers: {},
        timeout: 30000
      },
      jsonInput: '',
      importMode: 'form'
    });
    setEditingMcpServer(null);
    setShowMcpForm(false);
    setJsonValidationError('');
  };

  const openMcpForm = (server = null) => {
    if (server) {
      setEditingMcpServer(server);
      setMcpFormData({
        name: server.name,
        type: server.type,
        scope: server.scope,
        projectPath: server.projectPath || '',
        config: { ...server.config },
        raw: server.raw, // Store raw config for display
        importMode: 'form', // Always use form mode when editing
        jsonInput: ''
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
      if (mcpFormData.importMode === 'json') {
        // Use JSON import endpoint
        const token = localStorage.getItem('auth-token');
        const response = await fetch('/api/mcp/cli/add-json', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: mcpFormData.name,
            jsonConfig: mcpFormData.jsonInput,
            scope: mcpFormData.scope,
            projectPath: mcpFormData.projectPath
          })
        });
        
        if (response.ok) {
          const result = await response.json();
          if (result.success) {
            await fetchMcpServers(); // Refresh the list
            resetMcpForm();
            setSaveStatus('success');
          } else {
            throw new Error(result.error || 'Failed to add server via JSON');
          }
        } else {
          const error = await response.json();
          throw new Error(error.error || 'Failed to add server');
        }
      } else {
        // Use regular form-based save
        await saveMcpServer(mcpFormData);
        resetMcpForm();
        setSaveStatus('success');
      }
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
            <SettingsIcon className="w-5 h-5 md:w-6 md:h-6 text-blue-600" />
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
              <button
                onClick={() => setActiveTab('tasks')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'tasks'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                Tasks
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
            
            {/* Provider Tabs */}
            <div className="border-b border-gray-300 dark:border-gray-600">
              <div className="flex gap-4">
                <button
                  onClick={() => setToolsProvider('claude')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    toolsProvider === 'claude'
                      ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <ClaudeLogo className="w-4 h-4" />
                    <span>Claude</span>
                  </div>
                </button>
                <button
                  onClick={() => setToolsProvider('cursor')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    toolsProvider === 'cursor'
                      ? 'border-purple-600 text-purple-600 dark:text-purple-400'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <CursorLogo className="w-4 h-4" />
                    <span>Cursor</span>
                  </div>
                </button>
              </div>
            </div>
            
            {/* Claude Content */}
            {toolsProvider === 'claude' && (
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

            {/* Claude Login */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <LogIn className="w-5 h-5 text-blue-500" />
                <h3 className="text-lg font-medium text-foreground">
                  Authentication
                </h3>
              </div>
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-blue-900 dark:text-blue-100">
                      Claude CLI Login
                    </div>
                    <div className="text-sm text-blue-700 dark:text-blue-300">
                      Sign in to your Claude account to enable AI features
                    </div>
                  </div>
                  <Button
                    onClick={handleClaudeLogin}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    size="sm"
                  >
                    <LogIn className="w-4 h-4 mr-2" />
                    Login
                  </Button>
                </div>
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
                            {server.scope === 'local' ? '📁 local' : server.scope === 'user' ? '👤 user' : server.scope}
                          </Badge>
                          {server.projectPath && (
                            <Badge variant="outline" className="text-xs bg-purple-50 dark:bg-purple-900/20" title={server.projectPath}>
                              {server.projectPath.split('/').pop()}
                            </Badge>
                          )}
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
                          {server.config.env && Object.keys(server.config.env).length > 0 && (
                            <div>Environment: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">{Object.entries(server.config.env).map(([k, v]) => `${k}=${v}`).join(', ')}</code></div>
                          )}
                          {server.raw && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">View full config</summary>
                              <pre className="mt-1 text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-x-auto">
                                {JSON.stringify(server.raw, null, 2)}
                              </pre>
                            </details>
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
                          onClick={() => openMcpForm(server)}
                          variant="ghost"
                          size="sm"
                          className="text-gray-600 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                          title="Edit server"
                        >
                          <Edit3 className="w-4 h-4" />
                        </Button>
                        <Button
                          onClick={() => handleMcpDelete(server.id, server.scope)}
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                          title="Delete server"
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

                    {!editingMcpServer && (
                    <div className="flex gap-2 mb-4">
                      <button
                        type="button"
                        onClick={() => setMcpFormData(prev => ({...prev, importMode: 'form'}))}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                          mcpFormData.importMode === 'form'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        Form Input
                      </button>
                      <button
                        type="button"
                        onClick={() => setMcpFormData(prev => ({...prev, importMode: 'json'}))}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                          mcpFormData.importMode === 'json'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        JSON Import
                      </button>
                    </div>
                    )}

                    {/* Show current scope when editing */}
                    {mcpFormData.importMode === 'form' && editingMcpServer && (
                      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                        <label className="block text-sm font-medium text-foreground mb-2">
                          Scope
                        </label>
                        <div className="flex items-center gap-2">
                          {mcpFormData.scope === 'user' ? <Globe className="w-4 h-4" /> : <FolderOpen className="w-4 h-4" />}
                          <span className="text-sm">
                            {mcpFormData.scope === 'user' ? 'User (Global)' : 'Project (Local)'}
                          </span>
                          {mcpFormData.scope === 'local' && mcpFormData.projectPath && (
                            <span className="text-xs text-muted-foreground">
                              - {mcpFormData.projectPath}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          Scope cannot be changed when editing an existing server
                        </p>
                      </div>
                    )}

                    {/* Scope Selection - Moved to top, disabled when editing */}
                    {mcpFormData.importMode === 'form' && !editingMcpServer && (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            Scope *
                          </label>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setMcpFormData(prev => ({...prev, scope: 'user', projectPath: ''}))}
                              className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                                mcpFormData.scope === 'user'
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                              }`}
                            >
                              <div className="flex items-center justify-center gap-2">
                                <Globe className="w-4 h-4" />
                                <span>User (Global)</span>
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={() => setMcpFormData(prev => ({...prev, scope: 'local'}))}
                              className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                                mcpFormData.scope === 'local'
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                              }`}
                            >
                              <div className="flex items-center justify-center gap-2">
                                <FolderOpen className="w-4 h-4" />
                                <span>Project (Local)</span>
                              </div>
                            </button>
                          </div>
                          <p className="text-xs text-muted-foreground mt-2">
                            {mcpFormData.scope === 'user' 
                              ? 'User scope: Available across all projects on your machine'
                              : 'Local scope: Only available in the selected project'
                            }
                          </p>
                        </div>

                        {/* Project Selection for Local Scope */}
                        {mcpFormData.scope === 'local' && !editingMcpServer && (
                          <div>
                            <label className="block text-sm font-medium text-foreground mb-2">
                              Project *
                            </label>
                            <select
                              value={mcpFormData.projectPath}
                              onChange={(e) => setMcpFormData(prev => ({...prev, projectPath: e.target.value}))}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                              required={mcpFormData.scope === 'local'}
                            >
                              <option value="">Select a project...</option>
                              {projects.map(project => (
                                <option key={project.name} value={project.path || project.fullPath}>
                                  {project.displayName || project.name}
                                </option>
                              ))}
                            </select>
                            {mcpFormData.projectPath && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Path: {mcpFormData.projectPath}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Basic Info */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className={mcpFormData.importMode === 'json' ? 'md:col-span-2' : ''}>
                        <label className="block text-sm font-medium text-foreground mb-2">
                          Server Name *
                        </label>
                        <Input
                          value={mcpFormData.name}
                          onChange={(e) => {
                            setMcpFormData(prev => ({...prev, name: e.target.value}));
                          }}
                          placeholder="my-server"
                          required
                        />
                      </div>
                      
                      {mcpFormData.importMode === 'form' && (
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            Transport Type *
                          </label>
                          <select
                            value={mcpFormData.type}
                            onChange={(e) => {
                              setMcpFormData(prev => ({...prev, type: e.target.value}));
                            }}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                          >
                            <option value="stdio">stdio</option>
                            <option value="sse">SSE</option>
                            <option value="http">HTTP</option>
                          </select>
                        </div>
                      )}
                    </div>


                    {/* Show raw configuration details when editing */}
                    {editingMcpServer && mcpFormData.raw && mcpFormData.importMode === 'form' && (
                      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                        <h4 className="text-sm font-medium text-foreground mb-2">
                          Configuration Details (from {editingMcpServer.scope === 'global' ? '~/.claude.json' : 'project config'})
                        </h4>
                        <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded overflow-x-auto">
                          {JSON.stringify(mcpFormData.raw, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* JSON Import Mode */}
                    {mcpFormData.importMode === 'json' && (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            JSON Configuration *
                          </label>
                          <textarea
                            value={mcpFormData.jsonInput}
                            onChange={(e) => {
                              setMcpFormData(prev => ({...prev, jsonInput: e.target.value}));
                              // Validate JSON as user types
                              try {
                                if (e.target.value.trim()) {
                                  const parsed = JSON.parse(e.target.value);
                                  // Basic validation
                                  if (!parsed.type) {
                                    setJsonValidationError('Missing required field: type');
                                  } else if (parsed.type === 'stdio' && !parsed.command) {
                                    setJsonValidationError('stdio type requires a command field');
                                  } else if ((parsed.type === 'http' || parsed.type === 'sse') && !parsed.url) {
                                    setJsonValidationError(`${parsed.type} type requires a url field`);
                                  } else {
                                    setJsonValidationError('');
                                  }
                                }
                              } catch (err) {
                                if (e.target.value.trim()) {
                                  setJsonValidationError('Invalid JSON format');
                                } else {
                                  setJsonValidationError('');
                                }
                              }
                            }}
                            className={`w-full px-3 py-2 border ${jsonValidationError ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'} bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500 font-mono text-sm`}
                            rows="8"
                            placeholder={'{\n  "type": "stdio",\n  "command": "/path/to/server",\n  "args": ["--api-key", "abc123"],\n  "env": {\n    "CACHE_DIR": "/tmp"\n  }\n}'}
                            required
                          />
                          {jsonValidationError && (
                            <p className="text-xs text-red-500 mt-1">{jsonValidationError}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-2">
                            Paste your MCP server configuration in JSON format. Example formats:
                            <br />• stdio: {`{"type":"stdio","command":"npx","args":["@upstash/context7-mcp"]}`}
                            <br />• http/sse: {`{"type":"http","url":"https://api.example.com/mcp"}`}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Transport-specific Config - Only show in form mode */}
                    {mcpFormData.importMode === 'form' && mcpFormData.type === 'stdio' && (
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

                    {mcpFormData.importMode === 'form' && (mcpFormData.type === 'sse' || mcpFormData.type === 'http') && (
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

                    {/* Environment Variables - Only show in form mode */}
                    {mcpFormData.importMode === 'form' && (
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
                    )}

                    {mcpFormData.importMode === 'form' && (mcpFormData.type === 'sse' || mcpFormData.type === 'http') && (
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
            
            {/* Cursor Content */}
            {toolsProvider === 'cursor' && (
              <div className="space-y-6 md:space-y-8">
                
                {/* Skip Permissions for Cursor */}
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5 text-orange-500" />
                    <h3 className="text-lg font-medium text-foreground">
                      Cursor Permission Settings
                    </h3>
                  </div>
                  <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={cursorSkipPermissions}
                        onChange={(e) => setCursorSkipPermissions(e.target.checked)}
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <div>
                        <div className="font-medium text-orange-900 dark:text-orange-100">
                          Skip permission prompts (use with caution)
                        </div>
                        <div className="text-sm text-orange-700 dark:text-orange-300">
                          Equivalent to -f flag in Cursor CLI
                        </div>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Cursor Login */}
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <LogIn className="w-5 h-5 text-purple-500" />
                    <h3 className="text-lg font-medium text-foreground">
                      Authentication
                    </h3>
                  </div>
                  <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-purple-900 dark:text-purple-100">
                          Cursor CLI Login
                        </div>
                        <div className="text-sm text-purple-700 dark:text-purple-300">
                          Sign in to your Cursor account to enable AI features
                        </div>
                      </div>
                      <Button
                        onClick={handleCursorLogin}
                        className="bg-purple-600 hover:bg-purple-700 text-white"
                        size="sm"
                      >
                        <LogIn className="w-4 h-4 mr-2" />
                        Login
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Allowed Shell Commands */}
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Shield className="w-5 h-5 text-green-500" />
                    <h3 className="text-lg font-medium text-foreground">
                      Allowed Shell Commands
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Shell commands that are automatically allowed without prompting for permission
                  </p>
                  
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      value={newCursorCommand}
                      onChange={(e) => setNewCursorCommand(e.target.value)}
                      placeholder='e.g., "Shell(ls)" or "Shell(git status)"'
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          if (newCursorCommand && !cursorAllowedCommands.includes(newCursorCommand)) {
                            setCursorAllowedCommands([...cursorAllowedCommands, newCursorCommand]);
                            setNewCursorCommand('');
                          }
                        }
                      }}
                      className="flex-1 h-10 touch-manipulation"
                      style={{ fontSize: '16px' }}
                    />
                    <Button
                      onClick={() => {
                        if (newCursorCommand && !cursorAllowedCommands.includes(newCursorCommand)) {
                          setCursorAllowedCommands([...cursorAllowedCommands, newCursorCommand]);
                          setNewCursorCommand('');
                        }
                      }}
                      disabled={!newCursorCommand}
                      size="sm"
                      className="h-10 px-4 touch-manipulation"
                    >
                      <Plus className="w-4 h-4 mr-2 sm:mr-0" />
                      <span className="sm:hidden">Add Command</span>
                    </Button>
                  </div>

                  {/* Common commands quick add */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Quick add common commands:
                    </p>
                    <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
                      {commonCursorCommands.map(cmd => (
                        <Button
                          key={cmd}
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (!cursorAllowedCommands.includes(cmd)) {
                              setCursorAllowedCommands([...cursorAllowedCommands, cmd]);
                            }
                          }}
                          disabled={cursorAllowedCommands.includes(cmd)}
                          className="text-xs h-8 touch-manipulation truncate"
                        >
                          {cmd}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {cursorAllowedCommands.map(cmd => (
                      <div key={cmd} className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
                        <span className="font-mono text-sm text-green-800 dark:text-green-200">
                          {cmd}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setCursorAllowedCommands(cursorAllowedCommands.filter(c => c !== cmd))}
                          className="text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                    {cursorAllowedCommands.length === 0 && (
                      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                        No allowed shell commands configured
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Disallowed Shell Commands */}
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Shield className="w-5 h-5 text-red-500" />
                    <h3 className="text-lg font-medium text-foreground">
                      Disallowed Shell Commands
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Shell commands that should always be denied
                  </p>
                  
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      value={newCursorDisallowedCommand}
                      onChange={(e) => setNewCursorDisallowedCommand(e.target.value)}
                      placeholder='e.g., "Shell(rm -rf)" or "Shell(sudo)"'
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          if (newCursorDisallowedCommand && !cursorDisallowedCommands.includes(newCursorDisallowedCommand)) {
                            setCursorDisallowedCommands([...cursorDisallowedCommands, newCursorDisallowedCommand]);
                            setNewCursorDisallowedCommand('');
                          }
                        }
                      }}
                      className="flex-1 h-10 touch-manipulation"
                      style={{ fontSize: '16px' }}
                    />
                    <Button
                      onClick={() => {
                        if (newCursorDisallowedCommand && !cursorDisallowedCommands.includes(newCursorDisallowedCommand)) {
                          setCursorDisallowedCommands([...cursorDisallowedCommands, newCursorDisallowedCommand]);
                          setNewCursorDisallowedCommand('');
                        }
                      }}
                      disabled={!newCursorDisallowedCommand}
                      size="sm"
                      className="h-10 px-4 touch-manipulation"
                    >
                      <Plus className="w-4 h-4 mr-2 sm:mr-0" />
                      <span className="sm:hidden">Add Command</span>
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {cursorDisallowedCommands.map(cmd => (
                      <div key={cmd} className="flex items-center justify-between bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                        <span className="font-mono text-sm text-red-800 dark:text-red-200">
                          {cmd}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setCursorDisallowedCommands(cursorDisallowedCommands.filter(c => c !== cmd))}
                          className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                    {cursorDisallowedCommands.length === 0 && (
                      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                        No disallowed shell commands configured
                      </div>
                    )}
                  </div>
                </div>

                {/* Help Section */}
                <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
                  <h4 className="font-medium text-purple-900 dark:text-purple-100 mb-2">
                    Cursor Shell Command Examples:
                  </h4>
                  <ul className="text-sm text-purple-800 dark:text-purple-200 space-y-1">
                    <li><code className="bg-purple-100 dark:bg-purple-800 px-1 rounded">"Shell(ls)"</code> - Allow ls command</li>
                    <li><code className="bg-purple-100 dark:bg-purple-800 px-1 rounded">"Shell(git status)"</code> - Allow git status command</li>
                    <li><code className="bg-purple-100 dark:bg-purple-800 px-1 rounded">"Shell(mkdir)"</code> - Allow mkdir command</li>
                    <li><code className="bg-purple-100 dark:bg-purple-800 px-1 rounded">"-f"</code> flag - Skip all permission prompts (dangerous)</li>
                  </ul>
                </div>
              </div>
            )}
              </div>
            )}

            {/* Tasks Tab */}
            {activeTab === 'tasks' && (
              <div className="space-y-6 md:space-y-8">
                {/* Installation Status Check */}
                {isCheckingInstallation ? (
                  <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                    <div className="flex items-center gap-3">
                      <div className="animate-spin w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                      <span className="text-sm text-muted-foreground">Checking TaskMaster installation...</span>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* TaskMaster Not Installed Warning */}
                    {!isTaskMasterInstalled && (
                      <div className="bg-orange-50 dark:bg-orange-950/50 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 bg-orange-100 dark:bg-orange-900 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                            <svg className="w-4 h-4 text-orange-600 dark:text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                            </svg>
                          </div>
                          <div className="flex-1">
                            <div className="font-medium text-orange-900 dark:text-orange-100 mb-2">
                              TaskMaster AI CLI Not Installed
                            </div>
                            <div className="text-sm text-orange-800 dark:text-orange-200 space-y-3">
                              <p>TaskMaster CLI is required to use task management features. Install it to get started:</p>
                              
                              <div className="bg-orange-100 dark:bg-orange-900/50 rounded-lg p-3 font-mono text-sm">
                                <code>npm install -g task-master-ai</code>
                               <a 
                                  href="https://github.com/eyaltoledano/claude-task-master" 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
                                >
                                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 0C4.477 0 0 4.484 0 10.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0110 4.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.942.359.31.678.921.678 1.856 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0020 10.017C20 4.484 15.522 0 10 0z" clipRule="evenodd" />
                                  </svg>
                                  View on GitHub
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                  </svg>
                                </a>
                              </div>
                              
                              <div className="space-y-2">
                                <p className="font-medium">After installation:</p>
                                <ol className="list-decimal list-inside space-y-1 text-xs">
                                  <li>Restart this application</li>
                                  <li>TaskMaster features will automatically become available</li>
                                  <li>Use <code className="bg-orange-100 dark:bg-orange-800 px-1 rounded">task-master init</code> in your project directory</li>
                                </ol>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* TaskMaster Settings */}
                    <div className="space-y-4">
                      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium text-foreground">
                              Enable TaskMaster Integration
                            </div>
                            <div className="text-sm text-muted-foreground mt-1">
                              Show TaskMaster tasks, banners, and sidebar indicators across the interface
                            </div>
                            {!isTaskMasterInstalled && (
                              <div className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                                TaskMaster CLI must be installed first
                              </div>
                            )}
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={tasksEnabled}
                              onChange={(e) => setTasksEnabled(e.target.checked)}
                              disabled={!isTaskMasterInstalled}
                              className="sr-only peer"
                            />
                            <div className={`w-11 h-6 ${!isTaskMasterInstalled ? 'bg-gray-300 dark:bg-gray-600' : 'bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800'} rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600`}></div>
                          </label>
                        </div>
                      </div>

                      {/* TaskMaster Information */}
                      <div className="bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Zap className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <div className="font-medium text-blue-900 dark:text-blue-100 mb-2">
                          🎯 About TaskMaster AI
                        </div>
                        <div className="text-sm text-blue-800 dark:text-blue-200 space-y-2">
                          <p><strong>AI-Powered Task Management:</strong> Break complex projects into manageable subtasks with AI assistance</p>
                          <p><strong>PRD:</strong> Generate structured tasks from Product Requirements Documents</p>
                          <p><strong>Dependency Tracking:</strong> Understand task relationships and execution order</p>
                          <p><strong>Progress Visualization:</strong> Kanban boards, and detailed task views</p>
                        </div>
                      </div>
                      
                      {/* GitHub Link and Resources */}
                      <div className="mt-4 pt-4 border-t border-blue-200 dark:border-blue-700">
                        <div className="flex items-start gap-3">
                          <div className="w-6 h-6 bg-blue-100 dark:bg-blue-800 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                            <svg className="w-3 h-3 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
                            </svg>
                          </div>
                          <div className="flex-1">
                            <div className="font-medium text-blue-900 dark:text-blue-100 mb-2">
                              📚 Learn More & Tutorial
                            </div>
                            <div className="text-sm text-blue-800 dark:text-blue-200 space-y-2">
                              <p>TaskMaster AI (aka <strong>claude-task-master</strong> ) is an advanced AI-powered task management system built for developers.</p>
                              <div className="flex flex-col gap-2">
                                <a 
                                  href="https://github.com/eyaltoledano/claude-task-master" 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
                                >
                                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 0C4.477 0 0 4.484 0 10.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0110 4.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.942.359.31.678.921.678 1.856 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0020 10.017C20 4.484 15.522 0 10 0z" clipRule="evenodd" />
                                  </svg>
                                  View on GitHub
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                  </svg>
                                </a>
                                <p className="text-xs text-blue-700 dark:text-blue-300">
                                  Find documentation, setup guides, and examples for advanced TaskMaster workflows
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                      </div>
                    </div>
                  </>
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

      {/* Login Modal */}
      {showLoginModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 max-md:items-stretch max-md:justify-stretch">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl h-3/4 flex flex-col md:max-w-4xl md:h-3/4 md:rounded-lg md:m-4 max-md:max-w-none max-md:h-full max-md:rounded-none max-md:m-0">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {loginProvider === 'claude' ? 'Claude CLI Login' : 'Cursor CLI Login'}
              </h3>
              <button
                onClick={() => setShowLoginModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <StandaloneShell
                project={selectedProject}
                command={loginProvider === 'claude' ? 'claude /login' : 'cursor-agent login'}
                onComplete={handleLoginComplete}
                showHeader={false}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Settings;
