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
    <div className="flex items-center justify-between border-t border-gray-200 p-6 dark:border-gray-700">
      <Button variant="outline" onClick={step === 1 ? onClose : onBack} disabled={isCreating}>
        {step === 1 ? (
          t('projectWizard.buttons.cancel')
        ) : (
          <>
            <ChevronLeft className="mr-1 h-4 w-4" />
            {t('projectWizard.buttons.back')}
          </>
        )}
      </Button>

      <Button onClick={step === 3 ? onCreate : onNext} disabled={isCreating}>
        {isCreating ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {isCloneWorkflow
              ? t('projectWizard.buttons.cloning', { defaultValue: 'Cloning...' })
              : t('projectWizard.buttons.creating')}
          </>
        ) : step === 3 ? (
          <>
            <Check className="mr-1 h-4 w-4" />
            {t('projectWizard.buttons.createProject')}
          </>
        ) : (
          <>
            {t('projectWizard.buttons.next')}
            <ChevronRight className="ml-1 h-4 w-4" />
          </>
        )}
      </Button>
    </div>
  );
}
