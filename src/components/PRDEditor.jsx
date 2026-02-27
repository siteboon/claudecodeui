import React, { useState, useEffect, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { X, Save, Download, Maximize2, Minimize2, Eye, FileText, Sparkles, AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils';
import { api, authenticatedFetch } from '../utils/api';

const PRDEditor = ({ 
  file, 
  onClose, 
  projectPath,
  project, // Add project object
  initialContent = '',
  isNewFile = false,
  onSave
}) => {
  const [content, setContent] = useState(initialContent);
  const [loading, setLoading] = useState(!isNewFile);
  const [saving, setSaving] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [wordWrap, setWordWrap] = useState(true); // Default to true for markdown
  const [fileName, setFileName] = useState('');
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);
  const [existingPRDs, setExistingPRDs] = useState([]);
  
  const editorRef = useRef(null);

  const PRD_TEMPLATE = `# Product Requirements Document - Example Project

## 1. Overview
**Product Name:** AI-Powered Task Manager
**Version:** 1.0
**Date:** 2024-12-27
**Author:** Development Team

This document outlines the requirements for building an AI-powered task management application that integrates with development workflows and provides intelligent task breakdown and prioritization.

## 2. Objectives
- Create an intuitive task management system that works seamlessly with developer tools
- Provide AI-powered task generation from high-level requirements
- Enable real-time collaboration and progress tracking
- Integrate with popular development environments (VS Code, Cursor, etc.)

### Success Metrics
- User adoption rate > 80% within development teams
- Task completion rate improvement of 25%
- Time-to-delivery reduction of 15%

## 3. User Stories

### Core Functionality
- As a project manager, I want to create PRDs that automatically generate detailed tasks so I can save time on project planning
- As a developer, I want to see my next task clearly highlighted so I can maintain focus
- As a team lead, I want to track progress across multiple projects so I can provide accurate status updates
- As a developer, I want tasks to be broken down into implementable subtasks so I can work more efficiently

### AI Integration
- As a user, I want to describe a feature in natural language and get detailed implementation tasks so I can start working immediately
- As a project manager, I want the AI to analyze task complexity and suggest appropriate time estimates
- As a developer, I want intelligent task prioritization based on dependencies and deadlines

### Collaboration
- As a team member, I want to see real-time updates when tasks are completed so I can coordinate my work
- As a stakeholder, I want to view project progress through intuitive dashboards
- As a developer, I want to add implementation notes to tasks for future reference

## 4. Functional Requirements

### Task Management
- Create, edit, and delete tasks with rich metadata (priority, status, dependencies, estimates)
- Hierarchical task structure with subtasks and sub-subtasks
- Real-time status updates and progress tracking
- Dependency management with circular dependency detection
- Bulk operations (move, update status, assign)

### AI Features
- Natural language PRD parsing to generate structured tasks
- Intelligent task breakdown with complexity analysis
- Automated subtask generation with implementation details
- Smart dependency suggestion
- Progress prediction based on historical data

### Integration Features
- VS Code/Cursor extension for in-editor task management
- Git integration for linking commits to tasks
- API for third-party tool integration
- Webhook support for external notifications
- CLI tool for command-line task management

### User Interface
- Responsive web application (desktop and mobile)
- Multiple view modes (Kanban, list, calendar)
- Dark/light theme support
- Drag-and-drop task organization
- Advanced filtering and search capabilities
- Keyboard shortcuts for power users

## 5. Technical Requirements

### Frontend
- React.js with TypeScript for type safety
- Modern UI framework (Tailwind CSS)
- State management (Context API or Redux)
- Real-time updates via WebSockets
- Progressive Web App (PWA) support
- Accessibility compliance (WCAG 2.1 AA)

### Backend
- Node.js with Express.js framework
- RESTful API design with OpenAPI documentation
- Real-time communication via Socket.io
- Background job processing
- Rate limiting and security middleware

### AI Integration
- Integration with multiple AI providers (OpenAI, Anthropic, etc.)
- Fallback model support
- Context-aware prompt engineering
- Token usage optimization
- Model response caching

### Database
- Primary: PostgreSQL for relational data
- Cache: Redis for session management and real-time features
- Full-text search capabilities
- Database migrations and seeding
- Backup and recovery procedures

### Infrastructure
- Docker containerization
- Cloud deployment (AWS/GCP/Azure)
- Auto-scaling capabilities
- Monitoring and logging (structured logging)
- CI/CD pipeline with automated testing

## 6. Non-Functional Requirements

### Performance
- Page load time < 2 seconds
- API response time < 500ms for 95% of requests
- Support for 1000+ concurrent users
- Efficient handling of large task lists (10,000+ tasks)

### Security
- JWT-based authentication with refresh tokens
- Role-based access control (RBAC)
- Data encryption at rest and in transit
- Regular security audits and penetration testing
- GDPR and privacy compliance

### Reliability
- 99.9% uptime SLA
- Graceful error handling and recovery
- Data backup every 6 hours with point-in-time recovery
- Disaster recovery plan with RTO < 4 hours

### Scalability
- Horizontal scaling for both frontend and backend
- Database read replicas for query optimization
- CDN for static asset delivery
- Microservices architecture for future expansion

## 7. User Experience Design

### Information Architecture
- Intuitive navigation with breadcrumbs
- Context-aware menus and actions
- Progressive disclosure of complex features
- Consistent design patterns throughout

### Interaction Design
- Smooth animations and transitions
- Immediate feedback for user actions
- Undo/redo functionality for critical operations
- Smart defaults and auto-save features

### Visual Design
- Modern, clean interface with plenty of whitespace
- Consistent color scheme and typography
- Clear visual hierarchy with proper contrast ratios
- Iconography that supports comprehension

## 8. Integration Requirements

### Development Tools
- VS Code extension with task panel and quick actions
- Cursor IDE integration with AI task suggestions
- Terminal CLI for command-line workflow
- Browser extension for web-based tools

### Third-Party Services
- GitHub/GitLab integration for issue sync
- Slack/Discord notifications
- Calendar integration (Google Calendar, Outlook)
- Time tracking tools (Toggl, Harvest)

### APIs and Webhooks
- RESTful API with comprehensive documentation
- GraphQL endpoint for complex queries
- Webhook system for external integrations
- SDK development for major programming languages

## 9. Implementation Phases

### Phase 1: Core MVP (8-10 weeks)
- Basic task management (CRUD operations)
- Simple AI task generation
- Web interface with essential features
- User authentication and basic permissions

### Phase 2: Enhanced Features (6-8 weeks)
- Advanced AI features (complexity analysis, subtask generation)
- Real-time collaboration
- Mobile-responsive design
- Integration with one development tool (VS Code)

### Phase 3: Enterprise Features (4-6 weeks)
- Advanced user management and permissions
- API and webhook system
- Performance optimization
- Comprehensive testing and security audit

### Phase 4: Ecosystem Expansion (4-6 weeks)
- Additional tool integrations
- Mobile app development
- Advanced analytics and reporting
- Third-party marketplace preparation

## 10. Risk Assessment

### Technical Risks
- AI model reliability and cost management
- Real-time synchronization complexity
- Database performance with large datasets
- Integration complexity with multiple tools

### Business Risks
- User adoption in competitive market
- AI provider dependency
- Data privacy and security concerns
- Feature scope creep and timeline delays

### Mitigation Strategies
- Implement robust error handling and fallback systems
- Develop comprehensive testing strategy
- Create detailed documentation and user guides
- Establish clear project scope and change management process

## 11. Success Criteria

### Development Milestones
- Alpha version with core features completed
- Beta version with selected user group feedback
- Production-ready version with full feature set
- Post-launch iterations based on user feedback

### Business Metrics
- User engagement and retention rates
- Task completion and productivity metrics
- Customer satisfaction scores (NPS > 50)
- Revenue targets and subscription growth

## 12. Appendices

### Glossary
- **PRD**: Product Requirements Document
- **AI**: Artificial Intelligence
- **CRUD**: Create, Read, Update, Delete
- **API**: Application Programming Interface
- **CI/CD**: Continuous Integration/Continuous Deployment

### References
- Industry best practices for task management
- AI integration patterns and examples
- Security and compliance requirements
- Performance benchmarking data

---

**Document Control:**
- Version: 1.0
- Last Updated: December 27, 2024
- Next Review: January 15, 2025
- Approved By: Product Owner, Technical Lead`;

  // Initialize filename and load content
  useEffect(() => {
    const initializeEditor = async () => {
      // Set initial filename
      if (file?.name) {
        setFileName(file.name.replace(/\.(txt|md)$/, '')); // Remove extension for editing
      } else if (isNewFile) {
        // Generate default filename based on current date
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
        setFileName(`prd-${dateStr}`);
      }

      // Load content
      if (isNewFile) {
        setContent(PRD_TEMPLATE);
        setLoading(false);
        return;
      }

      // If content is directly provided (for existing PRDs loaded from API)
      if (file.content) {
        setContent(file.content);
        setLoading(false);
        return;
      }

      // Fallback to loading from file path (legacy support)
      try {
        setLoading(true);
        
        const response = await api.readFile(file.projectName, file.path);
        
        if (!response.ok) {
          throw new Error(`Failed to load file: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        setContent(data.content || PRD_TEMPLATE);
      } catch (error) {
        console.error('Error loading PRD file:', error);
        setContent(`# Error Loading PRD\n\nError: ${error.message}\n\nFile: ${file?.name || 'New PRD'}\nPath: ${file?.path || 'Not saved yet'}\n\n${PRD_TEMPLATE}`);
      } finally {
        setLoading(false);
      }
    };

    initializeEditor();
  }, [file, projectPath, isNewFile]);

  // Fetch existing PRDs to check for conflicts
  useEffect(() => {
    const fetchExistingPRDs = async () => {
      if (!project?.name) {
        console.log('No project name available:', project);
        return;
      }
      
      try {
        console.log('Fetching PRDs for project:', project.name);
        const response = await api.get(`/taskmaster/prd/${encodeURIComponent(project.name)}`);
        if (response.ok) {
          const data = await response.json();
          console.log('Fetched existing PRDs:', data.prds);
          setExistingPRDs(data.prds || []);
        } else {
          console.log('Failed to fetch PRDs:', response.status, response.statusText);
        }
      } catch (error) {
        console.error('Error fetching existing PRDs:', error);
      }
    };

    fetchExistingPRDs();
  }, [project?.name]);

  const handleSave = async () => {
    if (!content.trim()) {
      alert('Please add content before saving.');
      return;
    }

    if (!fileName.trim()) {
      alert('Please provide a filename for the PRD.');
      return;
    }

    // Check if file already exists
    const fullFileName = fileName.endsWith('.txt') || fileName.endsWith('.md') ? fileName : `${fileName}.txt`;
    const existingFile = existingPRDs.find(prd => prd.name === fullFileName);
    
    console.log('Save check:', {
      fullFileName,
      existingPRDs,
      existingFile,
      isExisting: file?.isExisting,
      fileObject: file,
      shouldShowModal: existingFile && !file?.isExisting
    });
    
    if (existingFile && !file?.isExisting) {
      console.log('Showing overwrite confirmation modal');
      // Show confirmation modal for overwrite
      setShowOverwriteConfirm(true);
      return;
    }

    await performSave();
  };

  const performSave = async () => {
    setSaving(true);
    try {
      // Ensure filename has .txt extension
      const fullFileName = fileName.endsWith('.txt') || fileName.endsWith('.md') ? fileName : `${fileName}.txt`;
      
      const response = await authenticatedFetch(`/api/taskmaster/prd/${encodeURIComponent(project?.name)}`, {
        method: 'POST',
        body: JSON.stringify({
          fileName: fullFileName,
          content
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `Save failed: ${response.status}`);
      }
      
      // Show success feedback
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
      
      // Update existing PRDs list
      const response2 = await api.get(`/taskmaster/prd/${encodeURIComponent(project.name)}`);
      if (response2.ok) {
        const data = await response2.json();
        setExistingPRDs(data.prds || []);
      }
      
      // Call the onSave callback if provided (for UI updates)
      if (onSave) {
        await onSave();
      }
      
    } catch (error) {
      console.error('Error saving PRD:', error);
      alert(`Error saving PRD: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const downloadFileName = fileName ? `${fileName}.txt` : 'prd.txt';
    a.download = downloadFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleGenerateTasks = async () => {
    if (!content.trim()) {
      alert('Please add content to the PRD before generating tasks.');
      return;
    }

    // Show AI-first modal instead of simple confirm
    setShowGenerateModal(true);
  };


  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 's') {
          e.preventDefault();
          handleSave();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [content]);

  // Simple markdown to HTML converter for preview
  const renderMarkdown = (markdown) => {
    return markdown
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.*)\*/gim, '<em>$1</em>')
      .replace(/^\- (.*$)/gim, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/gims, '<ul>$1</ul>')
      .replace(/\n\n/gim, '</p><p>')
      .replace(/^(?!<[h|u|l])(.*$)/gim, '<p>$1</p>')
      .replace(/<\/ul>\s*<ul>/gim, '');
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-[200] md:bg-black/50 md:flex md:items-center md:justify-center">
        <div className="w-full h-full md:rounded-lg md:w-auto md:h-auto p-8 flex items-center justify-center bg-white dark:bg-gray-900">
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            <span className="text-gray-900 dark:text-white">Loading PRD...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`fixed inset-0 z-[200] ${
      'md:bg-black/50 md:flex md:items-center md:justify-center md:p-4'
    } ${isFullscreen ? 'md:p-0' : ''}`}>
      <div className={cn(
        'bg-white dark:bg-gray-900 shadow-2xl flex flex-col',
        'w-full h-full md:rounded-lg md:shadow-2xl',
        isFullscreen 
          ? 'md:w-full md:h-full md:rounded-none' 
          : 'md:w-full md:max-w-6xl md:h-[85vh] md:max-h-[85vh]'
      )}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 min-w-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-8 h-8 bg-purple-600 rounded flex items-center justify-center flex-shrink-0">
              <FileText className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              {/* Mobile: Stack filename and tags vertically for more space */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 min-w-0">
                {/* Filename input row - full width on mobile */}
                <div className="flex items-center gap-1 min-w-0 flex-1">
                  <div className="flex items-center min-w-0 flex-1 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md px-3 py-2 focus-within:ring-2 focus-within:ring-purple-500 focus-within:border-purple-500 dark:focus-within:ring-purple-400 dark:focus-within:border-purple-400">
                    <input
                      type="text"
                      value={fileName}
                      onChange={(e) => {
                        // Remove invalid filename characters
                        const sanitizedValue = e.target.value.replace(/[<>:"/\\|?*]/g, '');
                        setFileName(sanitizedValue);
                      }}
                      className="font-medium text-gray-900 dark:text-white bg-transparent border-none outline-none min-w-0 flex-1 text-base sm:text-sm placeholder-gray-400 dark:placeholder-gray-500"
                      placeholder="Enter PRD filename"
                      maxLength={100}
                    />
                    <span className="text-sm sm:text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap ml-1">.txt</span>
                  </div>
                  <button
                    onClick={() => document.querySelector('input[placeholder="Enter PRD filename"]')?.focus()}
                    className="p-1 text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
                    title="Click to edit filename"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                </div>
                
                {/* Tags row - moves to second line on mobile for more filename space */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300 px-2 py-1 rounded whitespace-nowrap">
                    📋 PRD
                  </span>
                  {isNewFile && (
                    <span className="text-xs bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-300 px-2 py-1 rounded whitespace-nowrap">
                      ✨ New
                    </span>
                  )}
                </div>
              </div>
              
              {/* Description - smaller on mobile */}
              <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 truncate mt-1">
                Product Requirements Document
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
            <button
              onClick={() => setPreviewMode(!previewMode)}
              className={cn(
                'p-2 md:p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800',
                'min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center',
                previewMode 
                  ? 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900' 
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              )}
              title={previewMode ? 'Switch to edit mode' : 'Preview markdown'}
            >
              <Eye className="w-5 h-5 md:w-4 md:h-4" />
            </button>
            
            <button
              onClick={() => setWordWrap(!wordWrap)}
              className={cn(
                'p-2 md:p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800',
                'min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center',
                wordWrap 
                  ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900' 
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              )}
              title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
            >
              <span className="text-sm md:text-xs font-mono font-bold">↵</span>
            </button>
            
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="p-2 md:p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center"
              title="Toggle theme"
            >
              <span className="text-lg md:text-base">{isDarkMode ? '☀️' : '🌙'}</span>
            </button>
            
            <button
              onClick={handleDownload}
              className="p-2 md:p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center"
              title="Download PRD"
            >
              <Download className="w-5 h-5 md:w-4 md:h-4" />
            </button>
            
            <button
              onClick={handleGenerateTasks}
              disabled={!content.trim()}
              className={cn(
                'px-3 py-2 rounded-md disabled:opacity-50 flex items-center gap-2 transition-colors text-sm font-medium',
                'bg-purple-600 hover:bg-purple-700 text-white',
                'min-h-[44px] md:min-h-0'
              )}
              title="Generate tasks from PRD content"
            >
              <Sparkles className="w-4 h-4" />
              <span className="hidden md:inline">Generate Tasks</span>
            </button>
            
            <button
              onClick={handleSave}
              disabled={saving}
              className={cn(
                'px-3 py-2 text-white rounded-md disabled:opacity-50 flex items-center gap-2 transition-colors',
                'min-h-[44px] md:min-h-0',
                saveSuccess 
                  ? 'bg-green-600 hover:bg-green-700' 
                  : 'bg-purple-600 hover:bg-purple-700'
              )}
            >
              {saveSuccess ? (
                <>
                  <svg className="w-5 h-5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="hidden sm:inline">Saved!</span>
                </>
              ) : (
                <>
                  <Save className="w-5 h-5 md:w-4 md:h-4" />
                  <span className="hidden sm:inline">{saving ? 'Saving...' : 'Save PRD'}</span>
                </>
              )}
            </button>
            
            <button
              onClick={toggleFullscreen}
              className="hidden md:flex p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 items-center justify-center"
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            
            <button
              onClick={onClose}
              className="p-2 md:p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center"
              title="Close"
            >
              <X className="w-6 h-6 md:w-4 md:h-4" />
            </button>
          </div>
        </div>

        {/* Editor/Preview Content */}
        <div className="flex-1 overflow-hidden">
          {previewMode ? (
            <div className="h-full overflow-y-auto p-6 prose prose-gray dark:prose-invert max-w-none">
              <div 
                className="markdown-preview"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
              />
            </div>
          ) : (
            <CodeMirror
              ref={editorRef}
              value={content}
              onChange={setContent}
              extensions={[
                markdown(),
                ...(wordWrap ? [EditorView.lineWrapping] : [])
              ]}
              theme={isDarkMode ? oneDark : undefined}
              height="100%"
              style={{
                fontSize: '14px',
                height: '100%',
              }}
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                dropCursor: false,
                allowMultipleSelections: false,
                indentOnInput: true,
                bracketMatching: true,
                closeBrackets: true,
                autocompletion: true,
                highlightSelectionMatches: true,
                searchKeymap: true,
              }}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex-shrink-0">
          <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
            <span>Lines: {content.split('\n').length}</span>
            <span>Characters: {content.length}</span>
            <span>Words: {content.split(/\s+/).filter(word => word.length > 0).length}</span>
            <span>Format: Markdown</span>
          </div>
          
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Press Ctrl+S to save • Esc to close
          </div>
        </div>
      </div>

      {/* Generate Tasks Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md border border-gray-200 dark:border-gray-700">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-purple-100 dark:bg-purple-900/50 rounded-lg flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Generate Tasks from PRD</h3>
              </div>
              <button
                onClick={() => setShowGenerateModal(false)}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4">
              {/* AI-First Approach */}
              <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-purple-100 dark:bg-purple-900/50 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-purple-900 dark:text-purple-100 mb-2">
                      💡 Pro Tip: Ask Claude Code Directly!
                    </h4>
                    <p className="text-sm text-purple-800 dark:text-purple-200 mb-3">
                      You can simply ask Claude Code in the chat to parse your PRD and generate tasks. 
                      The AI assistant will automatically save your PRD and create detailed tasks with implementation details.
                    </p>
                    
                    <div className="bg-white dark:bg-gray-800 rounded border border-purple-200 dark:border-purple-700 p-3 mb-3">
                      <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">💬 Example:</p>
                      <p className="text-xs text-gray-900 dark:text-white font-mono">
                        "I've just initialized a new project with Claude Task Master. I have a PRD at .taskmaster/docs/{fileName.endsWith('.txt') || fileName.endsWith('.md') ? fileName : `${fileName}.txt`}. Can you help me parse it and set up the initial tasks?"
                      </p>
                    </div>
                    
                    <p className="text-xs text-purple-700 dark:text-purple-300">
                      <strong>This will:</strong> Save your PRD, analyze its content, and generate structured tasks with subtasks, dependencies, and implementation details.
                    </p>
                  </div>
                </div>
              </div>

              {/* Learn More Link */}
              <div className="text-center pt-4 border-t border-gray-200 dark:border-gray-700">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  For more examples and advanced usage patterns:
                </p>
                <a
                  href="https://github.com/eyaltoledano/claude-task-master/blob/main/docs/examples.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-sm text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 underline font-medium"
                >
                  View TaskMaster Documentation →
                </a>
              </div>

              {/* Footer */}
              <div className="pt-4">
                <button
                  onClick={() => setShowGenerateModal(false)}
                  className="w-full px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                >
                  Got it, I'll ask Claude Code directly
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Overwrite Confirmation Modal */}
      {showOverwriteConfirm && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setShowOverwriteConfirm(false)} />
          <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full border border-gray-200 dark:border-gray-700">
            <div className="p-6">
              <div className="flex items-center mb-4">
                <div className="p-2 rounded-full mr-3 bg-yellow-100 dark:bg-yellow-900">
                  <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  File Already Exists
                </h3>
              </div>
              
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                A PRD file named "{fileName.endsWith('.txt') || fileName.endsWith('.md') ? fileName : `${fileName}.txt`}" already exists. 
                Do you want to overwrite it with the current content?
              </p>
              
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowOverwriteConfirm(false)}
                  className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    setShowOverwriteConfirm(false);
                    await performSave();
                  }}
                  className="px-4 py-2 text-sm text-white bg-yellow-600 hover:bg-yellow-700 rounded-md flex items-center space-x-2 transition-colors"
                >
                  <Save className="w-4 h-4" />
                  <span>Overwrite</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PRDEditor;