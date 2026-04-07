import { useContext } from 'react';
import { SystemUIContext } from '@/components/refactored/shared/contexts/system-ui-context/SystemUIContext';

export const useSystemUI = () => {
  const context = useContext(SystemUIContext);
  if (!context) {
    throw new Error('useSystemUI must be used within SystemUIProvider');
  }

  return context;
};
