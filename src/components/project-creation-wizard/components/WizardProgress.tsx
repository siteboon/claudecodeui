import { Fragment } from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WizardStep } from '../types';

type WizardProgressProps = {
  step: WizardStep;
};

export default function WizardProgress({ step }: WizardProgressProps) {
  const { t } = useTranslation();
  const steps: WizardStep[] = [1, 2, 3];

  return (
    <div className="px-6 pb-2 pt-4">
      <div className="flex items-center justify-between">
        {steps.map((currentStep) => (
          <Fragment key={currentStep}>
            <div className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                  currentStep < step
                    ? 'bg-green-500 text-white'
                    : currentStep === step
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-200 text-gray-500 dark:bg-gray-700'
                }`}
              >
                {currentStep < step ? <Check className="h-4 w-4" /> : currentStep}
              </div>
              <span className="hidden text-sm font-medium text-gray-700 dark:text-gray-300 sm:inline">
                {currentStep === 1
                  ? t('projectWizard.steps.type')
                  : currentStep === 2
                    ? t('projectWizard.steps.configure')
                    : t('projectWizard.steps.confirm')}
              </span>
            </div>

            {currentStep < 3 && (
              <div
                className={`mx-2 h-1 flex-1 rounded ${
                  currentStep < step ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'
                }`}
              />
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
