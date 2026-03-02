import { Check, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../shared/view/ui';
import type { WizardStep } from '../types';

type WizardFooterProps = {
  step: WizardStep;
  isCreating: boolean;
  isCloneWorkflow: boolean;
  onClose: () => void;
  onBack: () => void;
  onNext: () => void;
  onCreate: () => void;
};

export default function WizardFooter({
  step,
  isCreating,
  isCloneWorkflow,
  onClose,
  onBack,
  onNext,
  onCreate,
}: WizardFooterProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-between p-6 border-t border-gray-200 dark:border-gray-700">
      <Button variant="outline" onClick={step === 1 ? onClose : onBack} disabled={isCreating}>
        {step === 1 ? (
          t('projectWizard.buttons.cancel')
        ) : (
          <>
            <ChevronLeft className="w-4 h-4 mr-1" />
            {t('projectWizard.buttons.back')}
          </>
        )}
      </Button>

      <Button onClick={step === 3 ? onCreate : onNext} disabled={isCreating}>
        {isCreating ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            {isCloneWorkflow
              ? t('projectWizard.buttons.cloning', { defaultValue: 'Cloning...' })
              : t('projectWizard.buttons.creating')}
          </>
        ) : step === 3 ? (
          <>
            <Check className="w-4 h-4 mr-1" />
            {t('projectWizard.buttons.createProject')}
          </>
        ) : (
          <>
            {t('projectWizard.buttons.next')}
            <ChevronRight className="w-4 h-4 ml-1" />
          </>
        )}
      </Button>
    </div>
  );
}
