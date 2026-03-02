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
    <div className="px-6 pt-4 pb-2">
      <div className="flex items-center justify-between">
        {steps.map((currentStep) => (
          <Fragment key={currentStep}>
            <div className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center font-medium text-sm ${
                  currentStep < step
                    ? 'bg-green-500 text-white'
                    : currentStep === step
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-500'
                }`}
              >
                {currentStep < step ? <Check className="w-4 h-4" /> : currentStep}
              </div>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 hidden sm:inline">
                {currentStep === 1
                  ? t('projectWizard.steps.type')
                  : currentStep === 2
                    ? t('projectWizard.steps.configure')
                    : t('projectWizard.steps.confirm')}
              </span>
            </div>

            {currentStep < 3 && (
              <div
                className={`flex-1 h-1 mx-2 rounded ${
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
