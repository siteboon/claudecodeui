const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { logger } = require('./logger');

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether the directory is valid for Claude Code
 * @property {string} type - Type of project detected
 * @property {string[]} issues - List of validation issues found
 * @property {string[]} suggestions - List of suggestions for the user
 * @property {ProjectMetadata} metadata - Additional project metadata
 * @property {SecurityCheck} security - Security validation results
 */

/**
 * @typedef {Object} ProjectMetadata
 * @property {number} fileCount - Number of files in the project
 * @property {number} directoryCount - Number of directories
 * @property {number} size - Total size in bytes
 * @property {string[]} languages - Programming languages detected
 * @property {string[]} frameworks - Frameworks detected
 * @property {boolean} hasGit - Whether project has git repository
 * @property {boolean} hasDocumentation - Whether project has documentation
 */

/**
 * @typedef {Object} SecurityCheck
 * @property {boolean} safe - Whether the path is safe to access
 * @property {string[]} warnings - Security warnings
 * @property {boolean} hasPermissions - Whether we have required permissions
 * @property {boolean} isSanitized - Whether the path has been sanitized
 */

/**
 * @typedef {Object} ValidationConfig
 * @property {number} maxDepth - Maximum directory depth to scan
 * @property {number} maxFiles - Maximum number of files to process
 * @property {string[]} excludePatterns - Patterns to exclude from scanning
 * @property {boolean} strictMode - Whether to use strict validation
 * @property {number} timeoutMs - Timeout for validation in milliseconds
 */

/**
 * @typedef {Object} PathValidationError
 * @property {string} code - Error code
 * @property {string} message - Human-readable message
 * @property {string} path - Path that caused the error
 * @property {Object} details - Additional error details
 */

/**
 * @typedef {Object} PathSanitizationResult
 * @property {string} sanitizedPath - The cleaned and validated path
 * @property {boolean} wasSanitized - Whether the path was modified during sanitization
 * @property {SecurityThreat[]} threatsDetected - Security threats found and mitigated
 * @property {string[]} transformations - List of transformations applied
 * @property {boolean} safe - Whether the final path is considered safe
 */

/**
 * @typedef {Object} SecurityThreat
 * @property {string} type - Type of threat (e.g., 'path_traversal', 'null_byte', 'encoding_attack')
 * @property {string} description - Human-readable description of the threat
 * @property {string} severity - Severity level ('low', 'medium', 'high', 'critical')
 * @property {string} originalValue - The original malicious value detected
 * @property {string} mitigatedValue - The value after mitigation
 */

/**
 * @typedef {Object} SanitizationOptions
 * @property {boolean} allowRelativePaths - Whether to allow relative paths
 * @property {boolean} restrictToUserHome - Whether to restrict paths to user home directory
 * @property {string[]} allowedRoots - List of allowed root directories
 * @property {boolean} enforceCase - Whether to enforce case sensitivity
 * @property {number} maxLength - Maximum allowed path length
 */

/**
 * @typedef {Object} ProjectAnalysisResult
 * @property {string} projectType - Detected project type
 * @property {number} confidence - Confidence score (0-100)
 * @property {string[]} detectedFeatures - List of detected project features
 * @property {ProjectPattern[]} matchedPatterns - Patterns that matched
 * @property {FileAnalysis} fileAnalysis - Detailed file analysis
 * @property {DirectoryStructure} structure - Directory structure analysis
 */

/**
 * @typedef {Object} ValidationRule
 * @property {string} id - Unique rule identifier
 * @property {string} name - Human-readable rule name
 * @property {string} description - Rule description
 * @property {number} weight - Rule weight for scoring (1-10)
 * @property {string} category - Rule category (project_type, structure, quality)
 * @property {Function} test - Function to test the rule
 * @property {string[]} suggestions - Suggestions when rule fails
 */

/**
 * @typedef {Object} ProjectPattern
 * @property {string} type - Project type this pattern identifies
 * @property {string[]} requiredFiles - Files that must exist
 * @property {string[]} optionalFiles - Files that boost confidence
 * @property {string[]} excludeFiles - Files that exclude this pattern
 * @property {RegExp[]} filePatterns - Regex patterns for files
 * @property {number} baseScore - Base confidence score
 * @property {string[]} indicators - Additional indicators
 */

/**
 * @typedef {Object} FileAnalysis
 * @property {number} totalFiles - Total number of files
 * @property {number} totalDirectories - Total number of directories
 * @property {Map<string, number>} extensionCounts - Count of files by extension
 * @property {string[]} configFiles - Configuration files found
 * @property {string[]} sourceFiles - Source code files found
 * @property {string[]} documentationFiles - Documentation files found
 * @property {number} estimatedSize - Estimated total size in bytes
 */

/**
 * @typedef {Object} DirectoryStructure
 * @property {number} depth - Maximum directory depth
 * @property {string[]} topLevelDirectories - Top-level directory names
 * @property {boolean} hasGitRepo - Whether .git directory exists
 * @property {boolean} hasNodeModules - Whether node_modules exists
 * @property {boolean} hasBuildOutputs - Whether build outputs exist
 * @property {string[]} suspiciousDirectories - Potentially problematic directories
 */

/**
 * Comprehensive project validation service for Claude Code initialization
 */
class ProjectValidationService {
  constructor() {
    /** @type {ValidationConfig} */
    this.config = {
      maxDepth: 10,
      maxFiles: 10000,
      excludePatterns: [
        'node_modules',
        '.git',
        'dist',
        'build',
        '.next',
        '.nuxt',
        '__pycache__',
        '*.pyc',
        '*.class',
        '.DS_Store'
      ],
      strictMode: false,
      timeoutMs: 30000
    };

    /** @type {SanitizationOptions} */
    this.sanitizationConfig = {
      allowRelativePaths: false,
      restrictToUserHome: false,
      allowedRoots: [],
      enforceCase: os.platform() !== 'win32',
      maxLength: 4096
    };

    /** @type {RegExp[]} */
    this.dangerousPatterns = [
      /\.\.[/\\]/g,                    // Path traversal attempts
      /[/\\]\.\.[/\\]/g,              // Path traversal in middle
      /\0/g,                          // Null bytes
      /[\x00-\x1f\x7f-\x9f]/g,       // Control characters
      /[<>:"|?*]/g,                   // Windows invalid characters
      /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i, // Windows reserved names
      /\$\{.*\}/g,                    // Variable injection attempts
      /`.*`/g,                        // Command execution attempts
      /\$\(.*\)/g                     // Command substitution attempts
    ];

    /** @type {Map<string, string[]>} */
    this.languageExtensions = new Map([
      ['javascript', ['.js', '.jsx', '.mjs', '.cjs']],
      ['typescript', ['.ts', '.tsx', '.d.ts']],
      ['python', ['.py', '.pyx', '.pyw']],
      ['java', ['.java', '.class', '.jar']],
      ['cpp', ['.cpp', '.cxx', '.cc', '.c', '.h', '.hpp']],
      ['csharp', ['.cs', '.csx']],
      ['go', ['.go']],
      ['rust', ['.rs']],
      ['php', ['.php', '.phtml']],
      ['ruby', ['.rb', '.erb']],
      ['swift', ['.swift']],
      ['kotlin', ['.kt', '.kts']]
    ]);

    /** @type {Map<string, string[]>} */
    this.projectIndicators = new Map([
      ['nodejs', ['package.json', 'yarn.lock', 'package-lock.json']],
      ['python', ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile']],
      ['java', ['pom.xml', 'build.gradle', 'build.xml']],
      ['dotnet', ['.csproj', '.sln', '.fsproj', '.vbproj']],
      ['rust', ['Cargo.toml', 'Cargo.lock']],
      ['go', ['go.mod', 'go.sum']],
      ['php', ['composer.json', 'composer.lock']],
      ['ruby', ['Gemfile', 'Gemfile.lock']],
      ['docker', ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml']]
    ]);

    /** @type {ProjectPattern[]} */
    this.projectPatterns = this.initializeProjectPatterns();

    /** @type {ValidationRule[]} */
    this.validationRules = this.initializeValidationRules();

    /** @type {Map<string, string[]>} */
    this.languageExtensions = new Map([
      ['javascript', ['.js', '.jsx', '.mjs', '.cjs']],
      ['typescript', ['.ts', '.tsx', '.d.ts']],
      ['python', ['.py', '.pyx', '.pyw', '.pyc']],
      ['java', ['.java', '.class', '.jar']],
      ['rust', ['.rs']],
      ['go', ['.go']],
      ['php', ['.php', '.phtml']],
      ['ruby', ['.rb', '.rbx']],
      ['cpp', ['.cpp', '.cc', '.cxx', '.hpp', '.h']],
      ['csharp', ['.cs', '.csx']],
      ['html', ['.html', '.htm']],
      ['css', ['.css', '.scss', '.sass', '.less']],
      ['vue', ['.vue']],
      ['shell', ['.sh', '.bash', '.zsh']],
      ['sql', ['.sql']],
      ['markdown', ['.md', '.markdown']],
      ['json', ['.json', '.jsonc']]
    ]);
  }

  /**
   * Main validation method
   * @param {string} projectPath - Path to validate
   * @param {Partial<ValidationConfig>} customConfig - Custom configuration
   * @returns {Promise<ValidationResult>}
   */
  async validateProject(projectPath, customConfig = {}) {
    const startTime = Date.now();
    const config = { ...this.config, ...customConfig };
    
    logger.info('Starting project validation', { 
      path: projectPath, 
      config: config 
    });

    try {
      // Initialize result object
      /** @type {ValidationResult} */
      const result = {
        valid: false,
        type: 'unknown',
        issues: [],
        suggestions: [],
        metadata: {
          fileCount: 0,
          directoryCount: 0,
          size: 0,
          languages: [],
          frameworks: [],
          hasGit: false,
          hasDocumentation: false
        },
        security: {
          safe: false,
          warnings: [],
          hasPermissions: false,
          isSanitized: false
        }
      };

      // Step 1: Path sanitization and security check
      const sanitizationResult = await this.sanitizePathComprehensive(projectPath);
      result.security = await this.performSecurityCheck(sanitizationResult.sanitizedPath);
      
      // Merge sanitization threats into security warnings
      result.security.warnings.push(...sanitizationResult.threatsDetected.map(t => t.description));
      
      const sanitizedPath = sanitizationResult.sanitizedPath;
      
      if (!result.security.safe) {
        result.issues.push('Path security validation failed');
        return result;
      }

      // Step 2: Basic path validation
      const pathValidation = await this.validatePath(sanitizedPath);
      if (!pathValidation.valid) {
        result.issues.push(...pathValidation.issues);
        return result;
      }

      // Step 3: Project structure analysis
      const structureAnalysis = await this.analyzeProjectStructure(sanitizedPath, config);
      result.metadata = structureAnalysis.metadata;
      result.type = structureAnalysis.projectType;

      // Step 4: Apply validation rules
      const ruleValidation = await this.applyValidationRules(structureAnalysis, config);
      result.valid = ruleValidation.valid;
      result.issues.push(...ruleValidation.issues);
      result.suggestions.push(...ruleValidation.suggestions);

      // Step 5: Handle edge cases
      await this.handleEdgeCases(result, sanitizedPath, config);

      const duration = Date.now() - startTime;
      logger.performance('projectValidation', duration, { 
        path: sanitizedPath,
        valid: result.valid,
        issues: result.issues.length
      });

      return result;

    } catch (error) {
      logger.error('Project validation failed', { 
        path: projectPath, 
        error: error.message,
        stack: error.stack 
      });
      
      return {
        valid: false,
        type: 'error',
        issues: [`Validation failed: ${error.message}`],
        suggestions: ['Try selecting a different directory'],
        metadata: {
          fileCount: 0,
          directoryCount: 0,
          size: 0,
          languages: [],
          frameworks: [],
          hasGit: false,
          hasDocumentation: false
        },
        security: {
          safe: false,
          warnings: ['Validation error occurred'],
          hasPermissions: false,
          isSanitized: false
        }
      };
    }
  }

  /**
   * Comprehensive path sanitization with security threat detection
   * @param {string} inputPath - Raw input path
   * @param {Partial<SanitizationOptions>} options - Sanitization options
   * @returns {Promise<PathSanitizationResult>} Sanitization result with threats detected
   */
  async sanitizePathComprehensive(inputPath, options = {}) {
    const config = { ...this.sanitizationConfig, ...options };
    
    /** @type {PathSanitizationResult} */
    const result = {
      sanitizedPath: '',
      wasSanitized: false,
      threatsDetected: [],
      transformations: [],
      safe: false
    };

    try {
      if (!inputPath || typeof inputPath !== 'string') {
        throw new Error('Invalid path provided - must be a non-empty string');
      }

      if (inputPath.length > config.maxLength) {
        result.threatsDetected.push({
          type: 'excessive_length',
          description: `Path exceeds maximum length of ${config.maxLength} characters`,
          severity: 'medium',
          originalValue: inputPath.substring(0, 100) + '...',
          mitigatedValue: ''
        });
        throw new Error(`Path too long: ${inputPath.length} > ${config.maxLength}`);
      }

      let sanitized = inputPath;
      const originalPath = inputPath;

      // Step 1: Detect and remove dangerous patterns
      for (const pattern of this.dangerousPatterns) {
        if (pattern.test(sanitized)) {
          const matches = sanitized.match(pattern);
          result.threatsDetected.push({
            type: this.getThreatTypeFromPattern(pattern),
            description: `Dangerous pattern detected: ${pattern.toString()}`,
            severity: 'high',
            originalValue: matches ? matches[0] : 'unknown',
            mitigatedValue: ''
          });
          
          sanitized = sanitized.replace(pattern, '');
          result.transformations.push(`Removed dangerous pattern: ${pattern.toString()}`);
          result.wasSanitized = true;
        }
      }

      // Step 2: Unicode normalization to prevent encoding attacks
      try {
        const normalized = sanitized.normalize('NFC');
        if (normalized !== sanitized) {
          result.transformations.push('Applied Unicode NFC normalization');
          result.wasSanitized = true;
          sanitized = normalized;
        }
      } catch (error) {
        result.threatsDetected.push({
          type: 'encoding_attack',
          description: 'Invalid Unicode characters detected',
          severity: 'high',
          originalValue: sanitized,
          mitigatedValue: ''
        });
        throw new Error('Invalid Unicode characters in path');
      }

      // Step 3: Platform-specific sanitization
      sanitized = this.platformSpecificSanitization(sanitized, result);

      // Step 4: Path resolution and validation
      if (!config.allowRelativePaths && !path.isAbsolute(sanitized)) {
        sanitized = path.resolve(sanitized);
        result.transformations.push('Converted relative path to absolute');
        result.wasSanitized = true;
      }

      // Step 5: Validate against allowed roots
      if (config.allowedRoots.length > 0) {
        const isAllowed = config.allowedRoots.some(root => {
          const resolvedRoot = path.resolve(root);
          return sanitized.startsWith(resolvedRoot);
        });
        
        if (!isAllowed) {
          result.threatsDetected.push({
            type: 'unauthorized_access',
            description: 'Path is outside of allowed root directories',
            severity: 'critical',
            originalValue: sanitized,
            mitigatedValue: ''
          });
          throw new Error('Path is outside of allowed directories');
        }
      }

      // Step 6: User home restriction
      if (config.restrictToUserHome) {
        const userHome = os.homedir();
        if (!sanitized.startsWith(userHome)) {
          result.threatsDetected.push({
            type: 'unauthorized_access',
            description: 'Path is outside of user home directory',
            severity: 'high',
            originalValue: sanitized,
            mitigatedValue: ''
          });
          throw new Error('Path must be within user home directory');
        }
      }

      // Step 7: Final validation and normalization
      sanitized = path.normalize(sanitized);
      
      // Step 8: Verify the path doesn't contain any remaining dangerous elements
      const finalValidation = this.performFinalPathValidation(sanitized);
      if (!finalValidation.safe) {
        result.threatsDetected.push(...finalValidation.threats);
        throw new Error('Path failed final security validation');
      }

      result.sanitizedPath = sanitized;
      result.safe = result.threatsDetected.filter(t => t.severity === 'critical' || t.severity === 'high').length === 0;

      logger.debug('Path sanitization completed', {
        original: originalPath,
        sanitized: sanitized,
        wasSanitized: result.wasSanitized,
        threatsDetected: result.threatsDetected.length,
        transformations: result.transformations.length
      });

      return result;

    } catch (error) {
      logger.error('Path sanitization failed', {
        path: inputPath,
        error: error.message,
        threatsDetected: result.threatsDetected
      });

      result.safe = false;
      result.sanitizedPath = '';
      
      if (!result.threatsDetected.some(t => t.description === error.message)) {
        result.threatsDetected.push({
          type: 'sanitization_error',
          description: error.message,
          severity: 'critical',
          originalValue: inputPath,
          mitigatedValue: ''
        });
      }

      return result;
    }
  }

  /**
   * Backward-compatible sanitizePath method
   * @param {string} inputPath - Raw input path
   * @returns {Promise<string>} Sanitized path
   */
  async sanitizePath(inputPath) {
    const result = await this.sanitizePathComprehensive(inputPath);
    
    if (!result.safe) {
      const criticalThreats = result.threatsDetected.filter(t => t.severity === 'critical');
      const errorMessage = criticalThreats.length > 0 
        ? criticalThreats[0].description 
        : 'Path security validation failed';
      throw new Error(errorMessage);
    }
    
    return result.sanitizedPath;
  }

  /**
   * Get threat type from regex pattern
   * @param {RegExp} pattern - Regular expression pattern
   * @returns {string} Threat type
   */
  getThreatTypeFromPattern(pattern) {
    const patternString = pattern.toString();
    
    if (patternString.includes('\\.\\.')) return 'path_traversal';
    if (patternString.includes('\\0')) return 'null_byte';
    if (patternString.includes('x00-x1f')) return 'control_characters';
    if (patternString.includes('<>:"|?*')) return 'invalid_characters';
    if (patternString.includes('CON|PRN')) return 'reserved_names';
    if (patternString.includes('\\$\\{')) return 'variable_injection';
    if (patternString.includes('`')) return 'command_execution';
    if (patternString.includes('\\$\\(')) return 'command_substitution';
    
    return 'unknown_pattern';
  }

  /**
   * Platform-specific path sanitization
   * @param {string} inputPath - Path to sanitize
   * @param {PathSanitizationResult} result - Result object to update
   * @returns {string} Platform-sanitized path
   */
  platformSpecificSanitization(inputPath, result) {
    let sanitized = inputPath;
    const platform = os.platform();

    switch (platform) {
      case 'win32':
        // Windows-specific sanitization
        sanitized = this.sanitizeWindowsPath(sanitized, result);
        break;
      
      case 'darwin':
      case 'linux':
        // Unix-like systems sanitization
        sanitized = this.sanitizeUnixPath(sanitized, result);
        break;
        
      default:
        logger.warn('Unknown platform, applying generic sanitization', { platform });
        break;
    }

    return sanitized;
  }

  /**
   * Windows-specific path sanitization
   * @param {string} inputPath - Path to sanitize
   * @param {PathSanitizationResult} result - Result object to update
   * @returns {string} Sanitized Windows path
   */
  sanitizeWindowsPath(inputPath, result) {
    let sanitized = inputPath;

    // Remove trailing dots and spaces (invalid on Windows)
    const originalSanitized = sanitized;
    sanitized = sanitized.replace(/[\.\s]+$/g, '');
    
    if (sanitized !== originalSanitized) {
      result.transformations.push('Removed trailing dots and spaces (Windows)');
      result.wasSanitized = true;
    }

    // Handle Windows drive letters
    if (!/^[A-Za-z]:\\/.test(sanitized) && sanitized.length > 0) {
      // If it doesn't start with a drive letter, it might be relative
      result.transformations.push('Windows path normalized');
    }

    return sanitized;
  }

  /**
   * Unix-specific path sanitization
   * @param {string} inputPath - Path to sanitize
   * @param {PathSanitizationResult} result - Result object to update  
   * @returns {string} Sanitized Unix path
   */
  sanitizeUnixPath(inputPath, result) {
    let sanitized = inputPath;

    // Handle hidden files starting with multiple dots
    if (sanitized.startsWith('..') && !sanitized.startsWith('../')) {
      result.threatsDetected.push({
        type: 'suspicious_hidden_file',
        description: 'Suspicious hidden file pattern detected',
        severity: 'medium',
        originalValue: sanitized.substring(0, 10),
        mitigatedValue: ''
      });
    }

    return sanitized;
  }

  /**
   * Perform final path validation
   * @param {string} sanitizedPath - Path after sanitization
   * @returns {{safe: boolean, threats: SecurityThreat[]}} Final validation result
   */
  performFinalPathValidation(sanitizedPath) {
    /** @type {SecurityThreat[]} */
    const threats = [];

    // Check for remaining path traversal attempts
    if (sanitizedPath.includes('..')) {
      threats.push({
        type: 'path_traversal',
        description: 'Path traversal sequence remains after sanitization',
        severity: 'critical',
        originalValue: sanitizedPath,
        mitigatedValue: ''
      });
    }

    // Check for suspicious file system references
    const suspiciousPatterns = ['/proc/', '/sys/', '/dev/', 'C:\\Windows\\System32'];
    for (const pattern of suspiciousPatterns) {
      if (sanitizedPath.includes(pattern)) {
        threats.push({
          type: 'system_access_attempt',
          description: `Attempt to access system directory: ${pattern}`,
          severity: 'high',
          originalValue: pattern,
          mitigatedValue: ''
        });
      }
    }

    return {
      safe: threats.filter(t => t.severity === 'critical' || t.severity === 'high').length === 0,
      threats
    };
  }

  /**
   * Perform comprehensive security checks on the path
   * @param {string} projectPath - Path to check
   * @returns {Promise<SecurityCheck>}
   */
  async performSecurityCheck(projectPath) {
    /** @type {SecurityCheck} */
    const securityResult = {
      safe: false,
      warnings: [],
      hasPermissions: false,
      isSanitized: true
    };

    try {
      // Check for path traversal attempts
      if (projectPath.includes('..') || projectPath.includes('~')) {
        securityResult.warnings.push('Potential path traversal detected');
      }

      // Check permissions
      await fs.access(projectPath, fs.constants.R_OK);
      securityResult.hasPermissions = true;

      // Additional security checks will be implemented in subtask 3.2
      securityResult.safe = securityResult.hasPermissions && securityResult.warnings.length === 0;

    } catch (error) {
      if (error.code === 'ENOENT') {
        securityResult.warnings.push('Path does not exist');
      } else if (error.code === 'EACCES') {
        securityResult.warnings.push('Insufficient permissions');
      } else {
        securityResult.warnings.push(`Access error: ${error.message}`);
      }
    }

    return securityResult;
  }

  /**
   * Basic path validation
   * @param {string} projectPath - Path to validate
   * @returns {Promise<{valid: boolean, issues: string[]}>}
   */
  async validatePath(projectPath) {
    const result = { valid: false, issues: [] };

    try {
      const stats = await fs.stat(projectPath);
      
      if (!stats.isDirectory()) {
        result.issues.push('Path is not a directory');
        return result;
      }

      result.valid = true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        result.issues.push('Directory not found');
      } else if (error.code === 'EACCES') {
        result.issues.push('Permission denied');
      } else {
        result.issues.push(`Failed to access directory: ${error.message}`);
      }
    }

    return result;
  }

  /**
   * Analyze project structure and detect project type
   * @param {string} projectPath - Path to analyze
   * @param {ValidationConfig} config - Validation configuration
   * @returns {Promise<{metadata: ProjectMetadata, projectType: string}>}
   */
  async analyzeProjectStructure(projectPath, config) {
    logger.debug('Starting comprehensive project structure analysis', { path: projectPath });
    
    try {
      // Perform comprehensive file analysis
      const fileAnalysis = await this.performFileAnalysis(projectPath, config);
      
      // Analyze directory structure
      const directoryStructure = await this.analyzeDirectoryStructure(projectPath, config);
      
      // Detect project type using patterns
      const projectAnalysis = await this.detectProjectType(projectPath, fileAnalysis, directoryStructure);
      
      // Build metadata from analysis
      const metadata = {
        fileCount: fileAnalysis.totalFiles,
        directoryCount: fileAnalysis.totalDirectories,
        size: fileAnalysis.estimatedSize,
        languages: this.detectLanguages(fileAnalysis.extensionCounts),
        frameworks: this.detectFrameworks(fileAnalysis, projectAnalysis),
        hasGit: directoryStructure.hasGitRepo,
        hasDocumentation: fileAnalysis.documentationFiles.length > 0
      };

      logger.info('Project structure analysis completed', {
        path: projectPath,
        projectType: projectAnalysis.projectType,
        confidence: projectAnalysis.confidence,
        fileCount: metadata.fileCount,
        languages: metadata.languages
      });

      return {
        metadata,
        projectType: projectAnalysis.projectType
      };

    } catch (error) {
      logger.error('Project structure analysis failed', {
        path: projectPath,
        error: error.message,
        stack: error.stack
      });

      // Return default structure on error
      return {
        metadata: {
          fileCount: 0,
          directoryCount: 0,
          size: 0,
          languages: [],
          frameworks: [],
          hasGit: false,
          hasDocumentation: false
        },
        projectType: 'unknown'
      };
    }
  }

  /**
   * Apply validation rules based on project analysis
   * @param {Object} structureAnalysis - Results from structure analysis
   * @param {ValidationConfig} config - Validation configuration
   * @returns {Promise<{valid: boolean, issues: string[], suggestions: string[]}>}
   */
  async applyValidationRules(structureAnalysis, config) {
    logger.debug('Applying comprehensive validation rules', { 
      projectType: structureAnalysis.projectType,
      ruleCount: this.validationRules.length 
    });

    const result = {
      valid: false,
      issues: [],
      suggestions: []
    };

    let totalScore = 0;
    let maxPossibleScore = 0;
    const failedRules = [];
    const passedRules = [];

    try {
      // Apply each validation rule
      for (const rule of this.validationRules) {
        maxPossibleScore += rule.weight;

        try {
          const ruleResult = await rule.test(structureAnalysis, config);
          
          if (ruleResult.passed) {
            totalScore += rule.weight;
            passedRules.push(rule.id);
            
            // Add suggestions for improvements even when passed
            if (ruleResult.suggestions && ruleResult.suggestions.length > 0) {
              result.suggestions.push(...ruleResult.suggestions);
            }
          } else {
            failedRules.push({
              rule: rule,
              reason: ruleResult.reason || 'Rule failed',
              suggestions: ruleResult.suggestions || rule.suggestions
            });
            
            // Add issues from failed rules
            if (ruleResult.reason) {
              result.issues.push(`${rule.name}: ${ruleResult.reason}`);
            }
          }
        } catch (ruleError) {
          logger.warn('Validation rule execution failed', {
            ruleId: rule.id,
            error: ruleError.message
          });
          
          result.issues.push(`Rule ${rule.name} failed to execute: ${ruleError.message}`);
        }
      }

      // Calculate validation score
      const validationScore = maxPossibleScore > 0 ? (totalScore / maxPossibleScore) * 100 : 0;
      
      // Determine if project is valid based on score and critical rules
      const criticalRulesPassed = this.checkCriticalRules(passedRules, structureAnalysis);
      result.valid = validationScore >= 60 && criticalRulesPassed;

      // Add suggestions from failed rules
      for (const failedRule of failedRules) {
        if (failedRule.suggestions && failedRule.suggestions.length > 0) {
          result.suggestions.push(...failedRule.suggestions);
        }
      }

      // Add general suggestions based on project type
      result.suggestions.push(...this.getProjectTypeSuggestions(structureAnalysis.projectType, structureAnalysis));

      // Remove duplicate suggestions
      result.suggestions = [...new Set(result.suggestions)];

      logger.info('Validation rules applied', {
        validationScore: Math.round(validationScore),
        totalScore,
        maxPossibleScore,
        valid: result.valid,
        issueCount: result.issues.length,
        suggestionCount: result.suggestions.length,
        passedRules: passedRules.length,
        failedRules: failedRules.length
      });

      return result;

    } catch (error) {
      logger.error('Validation rule application failed', {
        error: error.message,
        stack: error.stack
      });

      return {
        valid: false,
        issues: [`Validation failed: ${error.message}`],
        suggestions: ['Please check the project directory and try again']
      };
    }
  }

  /**
   * Handle edge cases and special scenarios
   * @param {ValidationResult} result - Current validation result
   * @param {string} projectPath - Project path
   * @param {ValidationConfig} config - Validation configuration
   * @returns {Promise<void>}
   */
  async handleEdgeCases(result, projectPath, config) {
    // Edge case handling will be implemented in subtask 3.4
    logger.debug('Handling edge cases', { path: projectPath });
  }

  /**
   * Update validation configuration
   * @param {Partial<ValidationConfig>} newConfig - New configuration values
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    logger.info('Validation config updated', { config: this.config });
  }

  /**
   * Update sanitization configuration
   * @param {Partial<SanitizationOptions>} newConfig - New sanitization configuration
   */
  updateSanitizationConfig(newConfig) {
    this.sanitizationConfig = { ...this.sanitizationConfig, ...newConfig };
    logger.info('Sanitization config updated', { config: this.sanitizationConfig });
  }

  /**
   * Get current sanitization configuration
   * @returns {SanitizationOptions} Current sanitization configuration
   */
  getSanitizationConfig() {
    return { ...this.sanitizationConfig };
  }

  /**
   * Test path sanitization without applying it
   * @param {string} inputPath - Path to test
   * @param {Partial<SanitizationOptions>} options - Test options
   * @returns {Promise<PathSanitizationResult>} Sanitization test result
   */
  async testPathSanitization(inputPath, options = {}) {
    return await this.sanitizePathComprehensive(inputPath, options);
  }

  /**
   * Initialize project patterns for type detection
   * @returns {ProjectPattern[]} Array of project patterns
   */
  initializeProjectPatterns() {
    return [
      {
        type: 'nodejs',
        requiredFiles: ['package.json'],
        optionalFiles: ['yarn.lock', 'package-lock.json', 'node_modules', '.nvmrc', 'tsconfig.json'],
        excludeFiles: [],
        filePatterns: [/\.js$/, /\.ts$/, /\.jsx$/, /\.tsx$/],
        baseScore: 80,
        indicators: ['npm scripts', 'dependencies', 'devDependencies']
      },
      {
        type: 'python',
        requiredFiles: ['requirements.txt'],
        optionalFiles: ['pyproject.toml', 'setup.py', 'Pipfile', 'poetry.lock', 'setup.cfg'],
        excludeFiles: [],
        filePatterns: [/\.py$/, /\.pyx$/, /\.pyw$/],
        baseScore: 80,
        indicators: ['__pycache__', 'venv', '.env']
      },
      {
        type: 'java',
        requiredFiles: ['pom.xml'],
        optionalFiles: ['build.gradle', 'gradle.properties', 'gradlew', 'mvnw'],
        excludeFiles: [],
        filePatterns: [/\.java$/, /\.class$/, /\.jar$/],
        baseScore: 85,
        indicators: ['src/main/java', 'target', 'build']
      },
      {
        type: 'rust',
        requiredFiles: ['Cargo.toml'],
        optionalFiles: ['Cargo.lock', 'rust-toolchain'],
        excludeFiles: [],
        filePatterns: [/\.rs$/],
        baseScore: 90,
        indicators: ['src', 'target', 'examples']
      },
      {
        type: 'go',
        requiredFiles: ['go.mod'],
        optionalFiles: ['go.sum', 'go.work'],
        excludeFiles: [],
        filePatterns: [/\.go$/],
        baseScore: 85,
        indicators: ['main.go', 'vendor']
      },
      {
        type: 'react',
        requiredFiles: ['package.json'],
        optionalFiles: ['public/index.html', 'src/index.js', 'src/App.js'],
        excludeFiles: [],
        filePatterns: [/\.jsx$/, /\.tsx$/],
        baseScore: 75,
        indicators: ['react', 'react-dom', 'create-react-app']
      },
      {
        type: 'vue',
        requiredFiles: ['package.json'],
        optionalFiles: ['vue.config.js', 'vite.config.js'],
        excludeFiles: [],
        filePatterns: [/\.vue$/],
        baseScore: 75,
        indicators: ['vue', '@vue/cli']
      },
      {
        type: 'angular',
        requiredFiles: ['package.json', 'angular.json'],
        optionalFiles: ['tsconfig.json', 'src/main.ts'],
        excludeFiles: [],
        filePatterns: [/\.ts$/, /\.component\.ts$/, /\.service\.ts$/],
        baseScore: 80,
        indicators: ['@angular/core', 'ng']
      }
    ];
  }

  /**
   * Initialize validation rules
   * @returns {ValidationRule[]} Array of validation rules
   */
  initializeValidationRules() {
    return [
      {
        id: 'has_source_files',
        name: 'Has Source Files',
        description: 'Project contains recognizable source code files',
        weight: 8,
        category: 'structure',
        test: async (analysis, config) => {
          const sourceFiles = analysis.metadata.fileCount > 0;
          return {
            passed: sourceFiles,
            reason: sourceFiles ? null : 'No source files found in the project',
            suggestions: sourceFiles ? [] : ['Add source code files to the project directory']
          };
        },
        suggestions: ['Add source code files to make this a valid project']
      },
      {
        id: 'reasonable_size',
        name: 'Reasonable Project Size',
        description: 'Project size is within reasonable limits',
        weight: 5,
        category: 'structure',
        test: async (analysis, config) => {
          const size = analysis.metadata.size;
          const tooLarge = size > 10 * 1024 * 1024 * 1024; // 10GB
          const tooSmall = size < 100; // 100 bytes
          
          if (tooLarge) {
            return {
              passed: false,
              reason: `Project is too large (${Math.round(size / 1024 / 1024 / 1024)}GB)`,
              suggestions: ['Consider excluding build outputs or large files']
            };
          }
          
          if (tooSmall) {
            return {
              passed: false,
              reason: 'Project appears to be empty or too small',
              suggestions: ['Ensure the directory contains a valid project']
            };
          }
          
          return { passed: true };
        },
        suggestions: ['Ensure project size is reasonable for development']
      },
      {
        id: 'has_config_files',
        name: 'Has Configuration Files',
        description: 'Project contains configuration files indicating it is a real project',
        weight: 6,
        category: 'project_type',
        test: async (analysis, config) => {
          const hasConfig = analysis.metadata.frameworks.length > 0 || 
                           analysis.projectType !== 'unknown';
          return {
            passed: hasConfig,
            reason: hasConfig ? null : 'No project configuration files found',
            suggestions: hasConfig ? [] : ['Add configuration files like package.json, requirements.txt, etc.']
          };
        },
        suggestions: ['Add project configuration files']
      },
      {
        id: 'not_system_directory',
        name: 'Not System Directory',
        description: 'Project is not in a system directory',
        weight: 10,
        category: 'structure',
        test: async (analysis, config) => {
          // This will be checked in the path sanitization
          return { passed: true };
        },
        suggestions: ['Avoid using system directories for projects']
      },
      {
        id: 'git_repository',
        name: 'Git Repository',
        description: 'Project is a git repository',
        weight: 3,
        category: 'quality',
        test: async (analysis, config) => {
          const hasGit = analysis.metadata.hasGit;
          return {
            passed: hasGit,
            reason: hasGit ? null : 'Project is not a git repository',
            suggestions: hasGit ? [] : ['Initialize git repository with: git init']
          };
        },
        suggestions: ['Initialize git repository for version control']
      },
      {
        id: 'has_documentation',
        name: 'Has Documentation',
        description: 'Project contains documentation files',
        weight: 2,
        category: 'quality',
        test: async (analysis, config) => {
          const hasDocs = analysis.metadata.hasDocumentation;
          return {
            passed: hasDocs,
            reason: hasDocs ? null : 'No documentation files found',
            suggestions: hasDocs ? [] : ['Add README.md or other documentation files']
          };
        },
        suggestions: ['Add documentation to improve project quality']
      },
      {
        id: 'recognized_language',
        name: 'Recognized Programming Language',
        description: 'Project uses recognized programming languages',
        weight: 7,
        category: 'project_type',
        test: async (analysis, config) => {
          const hasLanguages = analysis.metadata.languages.length > 0;
          return {
            passed: hasLanguages,
            reason: hasLanguages ? null : 'No recognized programming languages detected',
            suggestions: hasLanguages ? [] : ['Add source files in recognized programming languages']
          };
        },
        suggestions: ['Use recognized programming languages']
      }
    ];
  }

  /**
   * Perform comprehensive file analysis
   * @param {string} projectPath - Path to analyze
   * @param {ValidationConfig} config - Configuration
   * @returns {Promise<FileAnalysis>} File analysis result
   */
  async performFileAnalysis(projectPath, config) {
    /** @type {FileAnalysis} */
    const analysis = {
      totalFiles: 0,
      totalDirectories: 0,
      extensionCounts: new Map(),
      configFiles: [],
      sourceFiles: [],
      documentationFiles: [],
      estimatedSize: 0
    };

    const scanDirectory = async (dirPath, currentDepth = 0) => {
      if (currentDepth > config.maxDepth) return;
      
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
          if (analysis.totalFiles > config.maxFiles) break;
          
          const entryPath = path.join(dirPath, entry.name);
          
          // Skip excluded patterns
          if (this.shouldExcludeFile(entry.name, config.excludePatterns)) {
            continue;
          }
          
          if (entry.isDirectory()) {
            analysis.totalDirectories++;
            await scanDirectory(entryPath, currentDepth + 1);
          } else {
            analysis.totalFiles++;
            
            try {
              const stats = await fs.stat(entryPath);
              analysis.estimatedSize += stats.size;
              
              const ext = path.extname(entry.name).toLowerCase();
              analysis.extensionCounts.set(ext, (analysis.extensionCounts.get(ext) || 0) + 1);
              
              // Categorize files
              if (this.isConfigFile(entry.name)) {
                analysis.configFiles.push(entry.name);
              }
              
              if (this.isSourceFile(entry.name)) {
                analysis.sourceFiles.push(entry.name);
              }
              
              if (this.isDocumentationFile(entry.name)) {
                analysis.documentationFiles.push(entry.name);
              }
            } catch (statError) {
              // Skip files we can't stat
              logger.debug('Could not stat file', { file: entryPath, error: statError.message });
            }
          }
        }
      } catch (error) {
        logger.warn('Could not scan directory', { dir: dirPath, error: error.message });
      }
    };

    await scanDirectory(projectPath);
    return analysis;
  }

  /**
   * Analyze directory structure
   * @param {string} projectPath - Path to analyze
   * @param {ValidationConfig} config - Configuration
   * @returns {Promise<DirectoryStructure>} Directory structure analysis
   */
  async analyzeDirectoryStructure(projectPath, config) {
    /** @type {DirectoryStructure} */
    const structure = {
      depth: 0,
      topLevelDirectories: [],
      hasGitRepo: false,
      hasNodeModules: false,
      hasBuildOutputs: false,
      suspiciousDirectories: []
    };

    try {
      const entries = await fs.readdir(projectPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          structure.topLevelDirectories.push(entry.name);
          
          // Check for specific directories
          if (entry.name === '.git') {
            structure.hasGitRepo = true;
          }
          
          if (entry.name === 'node_modules') {
            structure.hasNodeModules = true;
          }
          
          if (['dist', 'build', 'target', 'out'].includes(entry.name)) {
            structure.hasBuildOutputs = true;
          }
          
          // Check for suspicious directories
          if (this.isSuspiciousDirectory(entry.name)) {
            structure.suspiciousDirectories.push(entry.name);
          }
        }
      }
      
      // Calculate depth by sampling a few subdirectories
      structure.depth = await this.calculateMaxDepth(projectPath, 3);
      
    } catch (error) {
      logger.warn('Directory structure analysis failed', { 
        path: projectPath, 
        error: error.message 
      });
    }

    return structure;
  }

  /**
   * Detect project type using patterns
   * @param {string} projectPath - Project path
   * @param {FileAnalysis} fileAnalysis - File analysis result
   * @param {DirectoryStructure} directoryStructure - Directory structure
   * @returns {Promise<ProjectAnalysisResult>} Project analysis result
   */
  async detectProjectType(projectPath, fileAnalysis, directoryStructure) {
    /** @type {ProjectAnalysisResult} */
    const result = {
      projectType: 'unknown',
      confidence: 0,
      detectedFeatures: [],
      matchedPatterns: [],
      fileAnalysis,
      structure: directoryStructure
    };

    let bestMatch = null;
    let highestScore = 0;

    // Test each project pattern
    for (const pattern of this.projectPatterns) {
      const score = await this.scoreProjectPattern(pattern, projectPath, fileAnalysis, directoryStructure);
      
      if (score > highestScore) {
        highestScore = score;
        bestMatch = pattern;
      }
      
      if (score > 50) { // Threshold for matched patterns
        result.matchedPatterns.push({ ...pattern, score });
      }
    }

    if (bestMatch && highestScore > 60) {
      result.projectType = bestMatch.type;
      result.confidence = Math.min(highestScore, 100);
      result.detectedFeatures = [...bestMatch.indicators];
    }

    return result;
  }

  /**
   * Score a project pattern against the actual project
   * @param {ProjectPattern} pattern - Pattern to test
   * @param {string} projectPath - Project path
   * @param {FileAnalysis} fileAnalysis - File analysis
   * @param {DirectoryStructure} directoryStructure - Directory structure
   * @returns {Promise<number>} Score (0-100)
   */
  async scoreProjectPattern(pattern, projectPath, fileAnalysis, directoryStructure) {
    let score = 0;

    try {
      // Check required files
      let requiredFilesFound = 0;
      for (const requiredFile of pattern.requiredFiles) {
        if (fileAnalysis.configFiles.includes(requiredFile)) {
          requiredFilesFound++;
        }
      }
      
      if (requiredFilesFound === pattern.requiredFiles.length) {
        score += pattern.baseScore;
      } else if (requiredFilesFound > 0) {
        score += (requiredFilesFound / pattern.requiredFiles.length) * pattern.baseScore * 0.5;
      }

      // Check optional files (bonus points)
      for (const optionalFile of pattern.optionalFiles) {
        if (fileAnalysis.configFiles.includes(optionalFile) || 
            directoryStructure.topLevelDirectories.includes(optionalFile)) {
          score += 5;
        }
      }

      // Check file patterns
      for (const filePattern of pattern.filePatterns) {
        for (const [ext] of fileAnalysis.extensionCounts) {
          if (filePattern.test(ext)) {
            score += 10;
            break;
          }
        }
      }

      // Check exclude files (negative points)
      for (const excludeFile of pattern.excludeFiles) {
        if (fileAnalysis.configFiles.includes(excludeFile)) {
          score -= 20;
        }
      }
      
    } catch (error) {
      logger.warn('Error scoring project pattern', { 
        pattern: pattern.type, 
        error: error.message 
      });
    }

    return Math.max(0, score);
  }

  /**
   * Detect programming languages from file extensions
   * @param {Map<string, number>} extensionCounts - Extension counts
   * @returns {string[]} Detected languages
   */
  detectLanguages(extensionCounts) {
    const languages = [];
    
    for (const [language, extensions] of this.languageExtensions) {
      for (const ext of extensions) {
        if (extensionCounts.has(ext)) {
          languages.push(language);
          break;
        }
      }
    }
    
    return languages;
  }

  /**
   * Detect frameworks from analysis
   * @param {FileAnalysis} fileAnalysis - File analysis
   * @param {ProjectAnalysisResult} projectAnalysis - Project analysis
   * @returns {string[]} Detected frameworks
   */
  detectFrameworks(fileAnalysis, projectAnalysis) {
    const frameworks = [];
    
    if (projectAnalysis.projectType !== 'unknown') {
      frameworks.push(projectAnalysis.projectType);
    }
    
    // Additional framework detection based on config files
    for (const configFile of fileAnalysis.configFiles) {
      if (configFile === 'angular.json') frameworks.push('angular');
      if (configFile === 'vue.config.js') frameworks.push('vue');
      if (configFile === 'next.config.js') frameworks.push('nextjs');
      if (configFile === 'nuxt.config.js') frameworks.push('nuxtjs');
      if (configFile === 'vite.config.js') frameworks.push('vite');
      if (configFile === 'webpack.config.js') frameworks.push('webpack');
    }
    
    return [...new Set(frameworks)];
  }

  /**
   * Check if critical validation rules passed
   * @param {string[]} passedRules - IDs of passed rules
   * @param {Object} structureAnalysis - Structure analysis
   * @returns {boolean} Whether critical rules passed
   */
  checkCriticalRules(passedRules, structureAnalysis) {
    const criticalRules = ['has_source_files', 'not_system_directory', 'reasonable_size'];
    return criticalRules.every(ruleId => passedRules.includes(ruleId));
  }

  /**
   * Get project type specific suggestions
   * @param {string} projectType - Detected project type
   * @param {Object} structureAnalysis - Structure analysis
   * @returns {string[]} Suggestions
   */
  getProjectTypeSuggestions(projectType, structureAnalysis) {
    const suggestions = [];
    
    switch (projectType) {
      case 'nodejs':
        if (!structureAnalysis.metadata.hasGit) {
          suggestions.push('Initialize git repository for version control');
        }
        suggestions.push('Ensure package.json has proper scripts and dependencies');
        break;
        
      case 'python':
        suggestions.push('Consider using virtual environment for dependencies');
        if (!structureAnalysis.metadata.hasDocumentation) {
          suggestions.push('Add README.md with setup instructions');
        }
        break;
        
      case 'unknown':
        suggestions.push('Add configuration files to help identify project type');
        suggestions.push('Ensure the directory contains a valid software project');
        break;
    }
    
    return suggestions;
  }

  /**
   * Helper methods for file categorization
   */
  shouldExcludeFile(fileName, excludePatterns) {
    return excludePatterns.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return regex.test(fileName);
      }
      return fileName === pattern || fileName.startsWith(pattern);
    });
  }

  isConfigFile(fileName) {
    const configFiles = [
      'package.json', 'requirements.txt', 'pom.xml', 'build.gradle', 'Cargo.toml',
      'go.mod', 'composer.json', 'Gemfile', 'Dockerfile', 'docker-compose.yml',
      'tsconfig.json', 'jsconfig.json', 'webpack.config.js', 'vite.config.js',
      'angular.json', 'vue.config.js', 'next.config.js', 'nuxt.config.js',
      '.eslintrc.js', '.prettierrc', 'babel.config.js', 'jest.config.js'
    ];
    return configFiles.includes(fileName) || fileName.endsWith('.toml') || fileName.endsWith('.yaml') || fileName.endsWith('.yml');
  }

  isSourceFile(fileName) {
    const sourceExtensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.rs', '.go', '.php', '.rb', '.cpp', '.c', '.cs'];
    return sourceExtensions.some(ext => fileName.endsWith(ext));
  }

  isDocumentationFile(fileName) {
    const docFiles = ['README.md', 'README.txt', 'CHANGELOG.md', 'CONTRIBUTING.md', 'LICENSE', 'docs'];
    return docFiles.some(doc => fileName.toLowerCase().includes(doc.toLowerCase())) ||
           fileName.endsWith('.md') || fileName.endsWith('.rst') || fileName.endsWith('.txt');
  }

  isSuspiciousDirectory(dirName) {
    const suspicious = ['system32', 'windows', 'program files', 'applications', 'library', 'usr', 'var', 'tmp'];
    return suspicious.some(sus => dirName.toLowerCase().includes(sus));
  }

  async calculateMaxDepth(dirPath, maxSample = 3) {
    let maxDepth = 0;
    let sampleCount = 0;

    const checkDepth = async (currentPath, currentDepth) => {
      if (sampleCount >= maxSample || currentDepth > 10) return;
      
      try {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });
        const dirs = entries.filter(e => e.isDirectory()).slice(0, 2); // Sample max 2 subdirs
        
        for (const dir of dirs) {
          if (sampleCount >= maxSample) break;
          sampleCount++;
          maxDepth = Math.max(maxDepth, currentDepth + 1);
          await checkDepth(path.join(currentPath, dir.name), currentDepth + 1);
        }
      } catch (error) {
        // Skip directories we can't read
      }
    };

    await checkDepth(dirPath, 0);
    return maxDepth;
  }
}

// Create singleton instance
const projectValidationService = new ProjectValidationService();

module.exports = {
  ProjectValidationService,
  projectValidationService
}; 