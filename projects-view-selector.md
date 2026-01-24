  # Projects Pane View Selector Implementation Plan                                                                                                                              
                                                                                                                                                                                 
  ## Overview                                                                                                                                                                    
                                                                                                                                                                                 
  Add a view selector and time filter to the projects pane, with a new backend endpoint that supports caching and 304 responses.                                                 
                                                                                                                                                                                 
  ## UI Changes                                                                                                                                                                  
                                                                                                                                                                                 
  ### View Selector Dropdown                                                                                                                                                     
  - **Session View** (default): Flat list of all sessions sorted by lastActivity                                                                                                 
  - **Repo View**: Current behavior (sessions grouped under projects)                                                                                                            
                                                                                                                                                                                 
  ### Time Filter Dropdown                                                                                                                                                       
  Options: 1 hour, 8 hours, 1 day, **1 week** (default), 2 weeks, 1 month, all                                                                                                   
                                                                                                                                                                                 
  Both dropdowns appear in the sidebar header area, below the title.                                                                                                             
                                                                                                                                                                                 
  ## Backend Changes                                                                                                                                                             
                                                                                                                                                                                 
  ### New Endpoint: `GET /api/sessions/list`                                                                                                                                     
                                                                                                                                                                                 
  **Query Parameters:**                                                                                                                                                          
  - `timeframe`: `1h`, `8h`, `1d`, `1w`, `2w`, `1m`, `all` (default: `1w`)                                                                                                       
                                                                                                                                                                                 
  **Response:**                                                                                                                                                                  
  ```json                                                                                                                                                                        
  {                                                                                                                                                                              
  "sessions": [                                                                                                                                                                  
  {                                                                                                                                                                              
  "id": "session-uuid",                                                                                                                                                          
  "summary": "Session title",                                                                                                                                                    
  "lastActivity": "2026-01-23T10:30:00.000Z",                                                                                                                                    
  "messageCount": 45,                                                                                                                                                            
  "provider": "claude|cursor|codex",                                                                                                                                             
  "cwd": "/path/to/project",                                                                                                                                                     
  "project": {                                                                                                                                                                   
  "name": "-Users-john-myproject",                                                                                                                                               
  "displayName": "myproject",                                                                                                                                                    
  "fullPath": "/Users/john/myproject"                                                                                                                                            
  }                                                                                                                                                                              
  }                                                                                                                                                                              
  ],                                                                                                                                                                             
  "meta": {                                                                                                                                                                      
  "totalCount": 150,                                                                                                                                                             
  "filteredCount": 42,                                                                                                                                                           
  "timeframe": "1w",                                                                                                                                                             
  "cacheTimestamp": "2026-01-23T10:35:00.000Z"                                                                                                                                   
  }                                                                                                                                                                              
  }                                                                                                                                                                              
  ```                                                                                                                                                                            
                                                                                                                                                                                 
  **Caching Headers:**                                                                                                                                                           
  ```                                                                                                                                                                            
  Cache-Control: private, max-age=10                                                                                                                                             
  ETag: "version-timestamp-timeframe-hash"                                                                                                                                       
  ```                                                                                                                                                                            
                                                                                                                                                                                 
  **304 Support:** Returns 304 Not Modified when `If-None-Match` header matches current ETag.                                                                                    
                                                                                                                                                                                 
  ### Sessions Cache Module                                                                                                                                                      
                                                                                                                                                                                 
  - In-memory cache of all sessions updated by existing chokidar watcher                                                                                                         
  - Cache updated when `getProjects()` is called after file changes                                                                                                              
  - ETag computed from cache version + timestamp + timeframe                                                                                                                     
                                                                                                                                                                                 
  ## New Files                                                                                                                                                                   
                                                                                                                                                                                 
  | File | Purpose |                                                                                                                                                             
  |------|---------|                                                                                                                                                             
  | `server/routes/sessions.js` | Sessions list endpoint with ETag/304 support |                                                                                                 
  | `server/sessions-cache.js` | In-memory cache management |                                                                                                                    
  | `src/components/SessionsViewSelector.jsx` | View mode dropdown |                                                                                                             
  | `src/components/TimeframeFilter.jsx` | Time filter dropdown |                                                                                                                
  | `src/components/SessionListView.jsx` | Flat session list for Session View |                                                                                                  
  | `src/hooks/useSessionsList.js` | Hook for fetching sessions with ETag caching |                                                                                              
                                                                                                                                                                                 
  ## Modified Files                                                                                                                                                              
                                                                                                                                                                                 
  | File | Changes |                                                                                                                                                             
  |------|---------|                                                                                                                                                             
  | `server/index.js` | Register route, integrate cache with watcher, initialize on startup |                                                                                    
  | `src/components/Sidebar.jsx` | Add view selector, time filter, conditional view rendering |                                                                                  
  | `src/utils/api.js` | Add sessionsList endpoint function |                                                                                                                    
                                                                                                                                                                                 
  ## Implementation Sequence                                                                                                                                                     
                                                                                                                                                                                 
  1. **Backend: Cache Module** - Create `server/sessions-cache.js`                                                                                                               
  2. **Backend: Endpoint** - Create `server/routes/sessions.js`                                                                                                                  
  3. **Backend: Integration** - Update `server/index.js` to wire everything together                                                                                             
  4. **Frontend: Components** - Create dropdown and list components                                                                                                              
  5. **Frontend: Hook** - Create `useSessionsList` hook with ETag support                                                                                                        
  6. **Frontend: Integration** - Update Sidebar to use new components                                                                                                            
                                                                                                                                                                                 
  ## Caching Flow                                                                                                                                                                
                                                                                                                                                                                 
  ```                                                                                                                                                                            
  File Change → chokidar → debouncedUpdate (300ms) → getProjects()                                                                                                               
  → updateSessionsCache() → WebSocket broadcast                                                                                                                                  
                                                                                                                                                                                 
  Client poll (10s) → GET /api/sessions/list (If-None-Match: etag)                                                                                                               
  → 304 (no change) OR 200 (new data with new ETag)                                                                                                                              
  ```                                                                                                                                                                            
                                                                                                                                                                                 
  ## Verification                                                                                                                                                                
                                                                                                                                                                                 
  1. **Backend Testing:**                                                                                                                                                        
  - `curl /api/sessions/list?timeframe=1w` returns sessions                                                                                                                      
  - `curl -H "If-None-Match: <etag>" /api/sessions/list` returns 304 when unchanged                                                                                              
  - Modify a session file, verify cache updates within ~300ms                                                                                                                    
                                                                                                                                                                                 
  2. **Frontend Testing:**                                                                                                                                                       
  - View selector toggles between Session View and Repo View                                                                                                                     
  - Time filter changes the displayed sessions                                                                                                                                   
  - Sessions list updates when files change                                                                                                                                      
  - Selecting a session in Session View navigates to correct project/session                                                                                                     
  - Preferences persist across page reloads (localStorage)                                                                                                                       
                                                                                                                                                                                 
  3. **Performance Testing:**                                                                                                                                                    
  - Network tab shows 304 responses on repeated requests                                                                                                                         
  - No unnecessary re-renders when data unchanged                                                                                                                                
                                                                                                                                                      
