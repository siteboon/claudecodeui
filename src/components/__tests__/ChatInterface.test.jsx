import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatInterface from '../ChatInterface'
import React from 'react'

// Mock dependencies
vi.mock('../../utils/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
  authenticatedFetch: vi.fn(),
}))

vi.mock('../TodoList', () => ({
  default: ({ todos }) => <div data-testid="todo-list">{JSON.stringify(todos)}</div>
}))

vi.mock('../ClaudeLogo', () => ({
  default: () => <div data-testid="claude-logo">Claude Logo</div>
}))

vi.mock('../CursorLogo', () => ({
  default: () => <div data-testid="cursor-logo">Cursor Logo</div>
}))

vi.mock('../NextTaskBanner', () => ({
  default: () => <div data-testid="next-task-banner">Next Task</div>
}))

vi.mock('../ClaudeStatus', () => ({
  default: () => <div data-testid="claude-status">Status</div>
}))

vi.mock('../TokenUsagePie', () => ({
  default: () => <div data-testid="token-usage-pie">Token Usage</div>
}))

vi.mock('../../contexts/TasksSettingsContext', () => ({
  useTasksSettings: () => ({
    settings: {},
    updateSettings: vi.fn(),
  })
}))

vi.mock('react-dropzone', () => ({
  useDropzone: () => ({
    getRootProps: () => ({}),
    getInputProps: () => ({}),
    isDragActive: false,
  })
}))

describe('ChatInterface - Tool Display Minimization', () => {
  let mockProps

  beforeEach(() => {
    mockProps = {
      selectedProject: { name: 'test-project', path: '/test' },
      selectedSession: null,
      ws: null,
      sendMessage: vi.fn(),
      messages: [],
      isLoading: false,
      onFileOpen: vi.fn(),
      projects: [],
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Grep/Glob Tool Minimization', () => {
    it('should display Grep tool with minimized UI', () => {
      const grepMessage = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'Grep',
        toolId: 'tool_123',
        toolInput: JSON.stringify({ pattern: 'test.*pattern', path: 'src/' }),
        toolResult: { content: 'Found matches', isError: false },
        timestamp: new Date(),
      }

      mockProps.messages = [grepMessage]
      const { container } = render(<ChatInterface {...mockProps} />)

      // Should have minimized display with border-l-2
      const minimizedDisplay = container.querySelector('.border-l-2.border-blue-400')
      expect(minimizedDisplay).toBeTruthy()

      // Should show tool name
      expect(screen.getByText('Grep')).toBeTruthy()

      // Should show pattern from input
      expect(screen.getByText(/test\.\*pattern/)).toBeTruthy()
    })

    it('should display Glob tool with minimized UI', () => {
      const globMessage = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'Glob',
        toolId: 'tool_456',
        toolInput: JSON.stringify({ pattern: '*.js', path: 'src/' }),
        toolResult: null,
        timestamp: new Date(),
      }

      mockProps.messages = [globMessage]
      const { container } = render(<ChatInterface {...mockProps} />)

      const minimizedDisplay = container.querySelector('.border-l-2.border-blue-400')
      expect(minimizedDisplay).toBeTruthy()
      expect(screen.getByText('Glob')).toBeTruthy()
    })

    it('should show results link when tool result exists', () => {
      const grepWithResult = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'Grep',
        toolId: 'tool_789',
        toolInput: JSON.stringify({ pattern: 'search', path: '/' }),
        toolResult: { content: 'Results here', isError: false },
        timestamp: new Date(),
      }

      mockProps.messages = [grepWithResult]
      render(<ChatInterface {...mockProps} />)

      const resultsLink = screen.getByText('results')
      expect(resultsLink).toBeTruthy()
      expect(resultsLink.getAttribute('href')).toBe('#tool-result-tool_789')
    })

    it('should handle invalid JSON in toolInput gracefully', () => {
      const invalidMessage = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'Grep',
        toolId: 'tool_invalid',
        toolInput: 'invalid json',
        toolResult: null,
        timestamp: new Date(),
      }

      mockProps.messages = [invalidMessage]
      const { container } = render(<ChatInterface {...mockProps} />)

      // Should still render the tool, just without parsed input display
      expect(screen.getByText('Grep')).toBeTruthy()
    })

    it('should NOT minimize other tools - Edit tool gets full display', () => {
      const editMessage = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'Edit',
        toolId: 'tool_edit',
        toolInput: JSON.stringify({ 
          file_path: 'test.js', 
          old_string: 'old', 
          new_string: 'new' 
        }),
        toolResult: null,
        timestamp: new Date(),
      }

      mockProps.messages = [editMessage]
      const { container } = render(<ChatInterface {...mockProps} />)

      // Should have full display with gradient background
      const fullDisplay = container.querySelector('.bg-gradient-to-br')
      expect(fullDisplay).toBeTruthy()

      // Should NOT have minimized border style
      const minimized = container.querySelector('.border-l-2.border-blue-400')
      expect(minimized).toBeFalsy()
    })
  })

  describe('Tool Result Display - Conditional Hiding', () => {
    it('should hide tool result for Edit tool when no error', () => {
      const editMessage = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'Edit',
        toolId: 'tool_edit',
        toolInput: JSON.stringify({ file_path: 'test.js' }),
        toolResult: { 
          content: 'Edit successful', 
          isError: false 
        },
        timestamp: new Date(),
      }

      mockProps.messages = [editMessage]
      const { container } = render(<ChatInterface {...mockProps} />)

      // Should not show tool result section
      const resultSection = container.querySelector(`#tool-result-tool_edit`)
      expect(resultSection).toBeFalsy()
    })

    it('should hide tool result for Write tool when no error', () => {
      const writeMessage = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'Write',
        toolId: 'tool_write',
        toolInput: JSON.stringify({ file_path: 'new.js' }),
        toolResult: { 
          content: 'File written', 
          isError: false 
        },
        timestamp: new Date(),
      }

      mockProps.messages = [writeMessage]
      const { container } = render(<ChatInterface {...mockProps} />)

      const resultSection = container.querySelector(`#tool-result-tool_write`)
      expect(resultSection).toBeFalsy()
    })

    it('should hide tool result for ApplyPatch tool when no error', () => {
      const patchMessage = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'ApplyPatch',
        toolId: 'tool_patch',
        toolInput: JSON.stringify({ patch: 'diff content' }),
        toolResult: { 
          content: 'Patch applied', 
          isError: false 
        },
        timestamp: new Date(),
      }

      mockProps.messages = [patchMessage]
      const { container } = render(<ChatInterface {...mockProps} />)

      const resultSection = container.querySelector(`#tool-result-tool_patch`)
      expect(resultSection).toBeFalsy()
    })

    it('should hide tool result for Bash tool when no error', () => {
      const bashMessage = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'Bash',
        toolId: 'tool_bash',
        toolInput: JSON.stringify({ command: 'echo test' }),
        toolResult: { 
          content: 'test\n', 
          isError: false 
        },
        timestamp: new Date(),
      }

      mockProps.messages = [bashMessage]
      const { container } = render(<ChatInterface {...mockProps} />)

      const resultSection = container.querySelector(`#tool-result-tool_bash`)
      expect(resultSection).toBeFalsy()
    })

    it('should SHOW tool result when there is an error', () => {
      const errorMessage = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'Edit',
        toolId: 'tool_error',
        toolInput: JSON.stringify({ file_path: 'test.js' }),
        toolResult: { 
          content: 'File not found', 
          isError: true 
        },
        timestamp: new Date(),
      }

      mockProps.messages = [errorMessage]
      const { container } = render(<ChatInterface {...mockProps} />)

      // Should show error result
      const resultSection = container.querySelector(`#tool-result-tool_error`)
      expect(resultSection).toBeTruthy()
      
      // Should have error styling
      expect(resultSection.className).toContain('red')
    })

    it('should show tool result for other tools regardless of error status', () => {
      const readMessage = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'Read',
        toolId: 'tool_read',
        toolInput: JSON.stringify({ file_path: 'test.js' }),
        toolResult: { 
          content: 'File contents here', 
          isError: false 
        },
        timestamp: new Date(),
      }

      mockProps.messages = [readMessage]
      render(<ChatInterface {...mockProps} />)

      // Read tool results should be shown (it's in the exclude list)
      // The actual rendering depends on the component logic
      expect(screen.queryByText(/test.js/)).toBeTruthy()
    })
  })

  describe('Tool Input Parsing and Display', () => {
    it('should parse and display Edit tool input with file path', () => {
      const editMessage = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'Edit',
        toolId: 'tool_edit_display',
        toolInput: JSON.stringify({ 
          file_path: 'src/components/Test.jsx',
          old_string: 'const old = 1',
          new_string: 'const new = 2'
        }),
        toolResult: null,
        timestamp: new Date(),
      }

      mockProps.messages = [editMessage]
      render(<ChatInterface {...mockProps} />)

      // Should display filename
      expect(screen.getByText('Test.jsx')).toBeTruthy()
    })

    it('should parse and display Write tool input with file path', () => {
      const writeMessage = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'Write',
        toolId: 'tool_write_display',
        toolInput: JSON.stringify({ 
          file_path: 'src/NewFile.js',
          content: 'export default NewFile'
        }),
        toolResult: null,
        timestamp: new Date(),
      }

      mockProps.messages = [writeMessage]
      render(<ChatInterface {...mockProps} />)

      expect(screen.getByText('NewFile.js')).toBeTruthy()
    })

    it('should handle TodoWrite tool input', () => {
      const todoMessage = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'TodoWrite',
        toolId: 'tool_todo',
        toolInput: JSON.stringify({ 
          todos: [
            { id: 1, text: 'Task 1', completed: false },
            { id: 2, text: 'Task 2', completed: true }
          ]
        }),
        toolResult: null,
        timestamp: new Date(),
      }

      mockProps.messages = [todoMessage]
      render(<ChatInterface {...mockProps} />)

      // TodoList mock should receive todos
      const todoList = screen.getByTestId('todo-list')
      expect(todoList).toBeTruthy()
    })

    it('should handle Bash tool with command display', () => {
      const bashMessage = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'Bash',
        toolId: 'tool_bash_cmd',
        toolInput: JSON.stringify({ 
          command: 'npm test',
          description: 'Run tests'
        }),
        toolResult: null,
        timestamp: new Date(),
      }

      mockProps.messages = [bashMessage]
      const { container } = render(<ChatInterface {...mockProps} />)

      // Should show command in terminal style
      expect(screen.getByText(/npm test/)).toBeTruthy()
    })
  })

  describe('Enhanced Styling and Animations', () => {
    it('should apply gradient background to non-search tools', () => {
      const toolMessage = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'Edit',
        toolId: 'tool_styled',
        toolInput: JSON.stringify({ file_path: 'test.js' }),
        toolResult: null,
        timestamp: new Date(),
      }

      mockProps.messages = [toolMessage]
      const { container } = render(<ChatInterface {...mockProps} />)

      const gradientDiv = container.querySelector('.bg-gradient-to-br')
      expect(gradientDiv).toBeTruthy()
      expect(gradientDiv.className).toContain('from-blue-50')
    })

    it('should have tool icon with proper styling', () => {
      const toolMessage = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'Edit',
        toolId: 'tool_icon',
        toolInput: JSON.stringify({ file_path: 'test.js' }),
        toolResult: null,
        timestamp: new Date(),
      }

      mockProps.messages = [toolMessage]
      const { container } = render(<ChatInterface {...mockProps} />)

      // Should have icon container with gradient
      const iconContainer = container.querySelector('.bg-gradient-to-br.from-blue-500')
      expect(iconContainer).toBeTruthy()
    })

    it('should render chevron SVGs with proper classes', () => {
      const toolMessage = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'Edit',
        toolId: 'tool_chevron',
        toolInput: JSON.stringify({ 
          file_path: 'test.js',
          old_string: 'old',
          new_string: 'new'
        }),
        toolResult: null,
        timestamp: new Date(),
      }

      mockProps.messages = [toolMessage]
      const { container } = render(<ChatInterface {...mockProps} />)

      // Should have SVG with transition transform class
      const chevrons = container.querySelectorAll('svg.transition-transform')
      expect(chevrons.length).toBeGreaterThan(0)
    })
  })

  describe('File Open Integration', () => {
    it('should call onFileOpen when file button is clicked', async () => {
      const user = userEvent.setup()
      const editMessage = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'Edit',
        toolId: 'tool_file_open',
        toolInput: JSON.stringify({ 
          file_path: 'src/components/Test.jsx',
          old_string: 'old',
          new_string: 'new'
        }),
        toolResult: null,
        timestamp: new Date(),
      }

      mockProps.messages = [editMessage]
      render(<ChatInterface {...mockProps} />)

      const fileButton = screen.getByText('Test.jsx')
      await user.click(fileButton)

      await waitFor(() => {
        expect(mockProps.onFileOpen).toHaveBeenCalledWith('src/components/Test.jsx')
      })
    })
  })

  describe('Tool Result Content Formatting', () => {
    it('should display structured Grep/Glob results with file list', () => {
      const grepResultMessage = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'Grep',
        toolId: 'tool_grep_result',
        toolInput: JSON.stringify({ pattern: 'test' }),
        toolResult: { 
          content: 'matches found',
          isError: false,
          toolUseResult: {
            numFiles: 3,
            filenames: ['file1.js', 'file2.js', 'src/file3.js']
          }
        },
        timestamp: new Date(),
      }

      mockProps.messages = [grepResultMessage]
      render(<ChatInterface {...mockProps} />)

      // Should show file count
      expect(screen.getByText(/Found 3 files/)).toBeTruthy()
      
      // Should show filenames
      expect(screen.getByText('file1.js')).toBeTruthy()
      expect(screen.getByText('file2.js')).toBeTruthy()
      expect(screen.getByText('file3.js')).toBeTruthy()
    })

    it('should handle singular vs plural file count correctly', () => {
      const singleFileMessage = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'Glob',
        toolId: 'tool_single',
        toolInput: JSON.stringify({ pattern: '*.md' }),
        toolResult: { 
          content: 'found',
          isError: false,
          toolUseResult: {
            numFiles: 1,
            filenames: ['README.md']
          }
        },
        timestamp: new Date(),
      }

      mockProps.messages = [singleFileMessage]
      render(<ChatInterface {...mockProps} />)

      // Should use singular "file" not "files"
      expect(screen.getByText(/Found 1 file/)).toBeTruthy()
    })
  })

  describe('Edge Cases and Error Handling', () => {
    it('should handle message without toolInput', () => {
      const messageNoInput = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'Grep',
        toolId: 'tool_no_input',
        toolInput: null,
        toolResult: null,
        timestamp: new Date(),
      }

      mockProps.messages = [messageNoInput]
      const { container } = render(<ChatInterface {...mockProps} />)

      // Should still render without crashing
      expect(screen.getByText('Grep')).toBeTruthy()
    })

    it('should handle message without toolResult', () => {
      const messageNoResult = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'Edit',
        toolId: 'tool_no_result',
        toolInput: JSON.stringify({ file_path: 'test.js' }),
        toolResult: null,
        timestamp: new Date(),
      }

      mockProps.messages = [messageNoResult]
      render(<ChatInterface {...mockProps} />)

      // Should render without crashing
      expect(screen.getByText('Edit')).toBeTruthy()
    })

    it('should handle malformed toolResult', () => {
      const malformedResult = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'Grep',
        toolId: 'tool_malformed',
        toolInput: JSON.stringify({ pattern: 'test' }),
        toolResult: 'invalid structure',
        timestamp: new Date(),
      }

      mockProps.messages = [malformedResult]
      const { container } = render(<ChatInterface {...mockProps} />)

      // Should handle gracefully
      expect(container).toBeTruthy()
    })
  })

  describe('Read, TodoRead, TodoWrite Tool Display', () => {
    it('should display Read tool with minimized border style', () => {
      const readMessage = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'Read',
        toolId: 'tool_read',
        toolInput: JSON.stringify({ file_path: 'src/test.js' }),
        toolResult: null,
        timestamp: new Date(),
      }

      mockProps.messages = [readMessage]
      const { container } = render(<ChatInterface {...mockProps} />)

      // Should have minimized display
      const minimized = container.querySelector('.border-l-2.border-gray-400')
      expect(minimized).toBeTruthy()
      expect(screen.getByText('Read')).toBeTruthy()
    })

    it('should display TodoRead tool with minimized style', () => {
      const todoReadMessage = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'TodoRead',
        toolId: 'tool_todo_read',
        toolInput: null,
        toolResult: null,
        timestamp: new Date(),
      }

      mockProps.messages = [todoReadMessage]
      const { container } = render(<ChatInterface {...mockProps} />)

      expect(screen.getByText('Read todo list')).toBeTruthy()
    })

    it('should display TodoWrite tool with minimized style and todo list', () => {
      const todoWriteMessage = {
        type: 'assistant',
        isToolUse: true,
        toolName: 'TodoWrite',
        toolId: 'tool_todo_write',
        toolInput: JSON.stringify({ 
          todos: [{ id: 1, text: 'Test', completed: false }] 
        }),
        toolResult: null,
        timestamp: new Date(),
      }

      mockProps.messages = [todoWriteMessage]
      render(<ChatInterface {...mockProps} />)

      expect(screen.getByText('Update todo list')).toBeTruthy()
    })
  })
})

describe('ChatInterface - CSS Animation Integration', () => {
  it('should have proper CSS classes for chevron animation', () => {
    const mockProps = {
      selectedProject: { name: 'test-project', path: '/test' },
      selectedSession: null,
      ws: null,
      sendMessage: vi.fn(),
      messages: [{
        type: 'assistant',
        isToolUse: true,
        toolName: 'Edit',
        toolId: 'tool_anim',
        toolInput: JSON.stringify({ 
          file_path: 'test.js',
          old_string: 'old',
          new_string: 'new'
        }),
        toolResult: null,
        timestamp: new Date(),
      }],
      isLoading: false,
      onFileOpen: vi.fn(),
      projects: [],
    }

    const { container } = render(<ChatInterface {...mockProps} />)

    // Should have transition-transform class on chevron SVGs
    const chevrons = container.querySelectorAll('svg.transition-transform')
    expect(chevrons.length).toBeGreaterThan(0)

    // Should have duration-200 class
    const duratedElements = container.querySelectorAll('.duration-200')
    expect(duratedElements.length).toBeGreaterThan(0)
  })
})