export const semanticMcpToolMap: Record<string, string> = {
  computer_app_drag: 'drag',
  computer_click_element: 'click',
  computer_get_app_state: 'get_app_state',
  computer_list_apps: 'list_apps',
  computer_perform_secondary_action: 'perform_secondary_action',
  computer_press_key: 'press_key',
  computer_scroll_element: 'scroll',
  computer_set_value: 'set_value',
  computer_type_text: 'type_text',
};

export const semanticOperationNames = new Set(Object.values(semanticMcpToolMap));

export function semanticOperationForMcpTool(toolName: string): string | null {
  return semanticMcpToolMap[toolName] || null;
}
