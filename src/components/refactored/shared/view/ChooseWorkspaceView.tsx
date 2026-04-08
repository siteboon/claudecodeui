import { t } from "i18next";
import { Folder } from "lucide-react";
import { useDeviceSettings } from "@/hooks/useDeviceSettings.js";

export default function ChooseProjectView() {
    const { isMobile } = useDeviceSettings();
    
    return (
        <div className="flex flex-1 items-center justify-center">
            <div className="mx-auto max-w-md px-6 text-center">
                <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
                    <Folder className="h-7 w-7 text-muted-foreground" />
                </div>
                <h2 className="mb-2 text-xl font-semibold text-foreground">{t('mainContent.chooseProject')}</h2>
                <p className="mb-5 text-sm leading-relaxed text-muted-foreground">{t('mainContent.selectProjectDescription')}</p>
                <div className="rounded-xl border border-primary/10 bg-primary/5 p-3.5">
                    <p className="text-sm text-primary">
                        <strong>{t('mainContent.tip')}:</strong> {isMobile ? t('mainContent.createProjectMobile') : t('mainContent.createProjectDesktop')}
                    </p>
                </div>
            </div>
        </div>
    )
}