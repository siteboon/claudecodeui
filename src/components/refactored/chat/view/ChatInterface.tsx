// Create a sample component

// TODO: Place this in a shared folder
import ErrorBoundary from "@/components/main-content/view/ErrorBoundary.js";
import { QuickSettingsPanel } from "@/components/quick-settings-panel/index.js";

export default function ChatInterface() {
    return (
        <div className={`h-full`}>
            <ErrorBoundary showDetails>
                <div className="flex h-full items-center justify-center">
                    <p className="text-gray-500">Chat interface goes here</p>
                </div>
            </ErrorBoundary>

            <QuickSettingsPanel />
        </div>

    );
}