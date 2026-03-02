import { Check, GitBranch, LogIn } from 'lucide-react';

type OnboardingStepProgressProps = {
  currentStep: number;
};

const onboardingSteps = [
  { title: 'Git Configuration', icon: GitBranch, required: true },
  { title: 'Connect Agents', icon: LogIn, required: false },
];

export default function OnboardingStepProgress({ currentStep }: OnboardingStepProgressProps) {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between">
        {onboardingSteps.map((step, index) => {
          const isCompleted = index < currentStep;
          const isActive = index === currentStep;
          const Icon = step.icon;

          return (
            <div key={step.title} className="contents">
              <div className="flex flex-col items-center flex-1">
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-colors duration-200 ${
                    isCompleted
                      ? 'bg-green-500 border-green-500 text-white'
                      : isActive
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-background border-border text-muted-foreground'
                  }`}
                >
                  {isCompleted ? <Check className="w-6 h-6" /> : <Icon className="w-6 h-6" />}
                </div>

                <div className="mt-2 text-center">
                  <p className={`text-sm font-medium ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {step.title}
                  </p>
                  {step.required && <span className="text-xs text-red-500">Required</span>}
                </div>
              </div>

              {index < onboardingSteps.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 transition-colors duration-200 ${isCompleted ? 'bg-green-500' : 'bg-border'}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
