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
    <div className="mb-5">
      <div className="flex items-center justify-between">
        {onboardingSteps.map((step, index) => {
          const isCompleted = index < currentStep;
          const isActive = index === currentStep;
          const Icon = step.icon;

          return (
            <div key={step.title} className="contents">
              <div className="flex flex-1 flex-col items-center">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all duration-200 ${
                    isCompleted
                      ? 'border-emerald-500 bg-emerald-500 text-white shadow-lg shadow-emerald-500/25'
                      : isActive
                        ? 'border-primary bg-primary text-primary-foreground shadow-lg shadow-primary/25'
                        : 'border-border bg-card text-muted-foreground'
                  }`}
                >
                  {isCompleted ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                </div>

                <div className="mt-1.5 text-center">
                  <p className={`text-sm font-medium ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {step.title}
                  </p>
                  {step.required && <span className="text-xs text-red-500">Required</span>}
                </div>
              </div>

              {index < onboardingSteps.length - 1 && (
                <div className={`mx-2 h-0.5 flex-1 transition-colors duration-200 ${isCompleted ? 'bg-emerald-500' : 'bg-border'}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
