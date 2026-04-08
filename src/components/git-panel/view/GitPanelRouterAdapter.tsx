/**
 * This is for backward compatibility with the old setup that point to the file tree route. 
 * It fetches the project and session data based on the URL parameters and passes them to the FileTree component. 
 * If no valid parameters are found, it defaults to an empty project.
 * 
 * TODO: This adapter can be removed once all tabs use the updated projects and sessions format.
 */

import { useParams } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import {
    getProjectsInLegacyFormat,
    getSessionInLegacyFormat,
} from "@/components/refactored/sidebar/data/legacy-response-format-api.js";
import { Project } from "@/types/app.js";
import GitPanel from "@/components/git-panel/view/GitPanel.js";
import { useSystemUI } from "@/components/refactored/shared/contexts/system-ui-context/useSystemUI";
import type { FileDiffInfo } from "@/components/git-panel/types/types";

export default function GitPanelRouterAdapter() {
    const { sessionId, workspaceId } = useParams<{
        sessionId?: string;
        workspaceId?: string;
    }>();

    const {
        codeEditorSidebar: { handleFileOpen },
    } = useSystemUI();

    const [project, setProject] = useState<Project | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        const fetchProjectAndSession = async () => {
            setLoading(true);

            try {
                if (workspaceId) {
                    const fetchedProject = await getProjectsInLegacyFormat(workspaceId);

                    if (!cancelled) {
                        setProject(fetchedProject);
                    }

                    return;
                }

                if (sessionId) {
                    const result = await getSessionInLegacyFormat(sessionId);

                    if (!cancelled) {
                        if (result) {
                            setProject(result.project);
                        }
                    }

                    return;
                }

                if (!cancelled) {
                    setProject(null);
                }
            } catch (error) {
                console.error("Failed to fetch project/session:", error);

                if (!cancelled) {
                    setProject(null);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        fetchProjectAndSession();

        return () => {
            cancelled = true;
        };
    }, [sessionId, workspaceId]);

    const handleProjectFileOpen = useCallback(
        (filePath: string, diffInfo?: FileDiffInfo) => {
            handleFileOpen(filePath, diffInfo, project?.name);
        },
        [handleFileOpen, project?.name],
    );

    if (loading) {
        return <div>Loading...</div>;
    }

    return (
        <GitPanel selectedProject={project} onFileOpen={handleProjectFileOpen} />
    );
}
