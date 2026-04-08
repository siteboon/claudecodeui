/**
 * This is for backward compatibility with the old setup that point to the standalone shell. 
 * It fetches the project and session data based on the URL parameters and passes them to the StandaloneShell component. 
 * If no valid parameters are found, it defaults to an empty project.
 * 
 * TODO: This adapter can be removed once all tabs use the updated projects and sessions format.
 */

import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import StandaloneShell from "@/components/standalone-shell/view/StandaloneShell.js";
import {
  getProjectsInLegacyFormat,
  getSessionInLegacyFormat,
} from "@/components/refactored/sidebar/data/legacy-response-format-api.js";
import { DEFAULT_PROJECT_FOR_EMPTY_SHELL } from "@/constants/config.js";
import { Project, ProjectSession } from "@/types/app.js";

export default function StandaloneShellRouterAdapter() {
  const { sessionId, workspaceId } = useParams<{
    sessionId?: string;
    workspaceId?: string;
  }>();

  const [project, setProject] = useState<Project | null>(DEFAULT_PROJECT_FOR_EMPTY_SHELL);
  const [session, setSession] = useState<ProjectSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchProjectAndSession = async () => {
      setLoading(true);

      try {
        if (workspaceId) {
          const fetchedProject = await getProjectsInLegacyFormat(workspaceId);

          if (!cancelled) {
            setProject(fetchedProject ?? DEFAULT_PROJECT_FOR_EMPTY_SHELL);
            setSession(null);
          }

          return;
        }

        if (sessionId) {
          const result = await getSessionInLegacyFormat(sessionId);

          if (!cancelled) {
            if (result) {
              setProject(result.project ?? DEFAULT_PROJECT_FOR_EMPTY_SHELL);
              setSession(result.session ?? null);
            } else {
              setProject(DEFAULT_PROJECT_FOR_EMPTY_SHELL);
              setSession(null);
            }
          }

          return;
        }

        if (!cancelled) {
          setProject(DEFAULT_PROJECT_FOR_EMPTY_SHELL);
          setSession(null);
        }
      } catch (error) {
        console.error("Failed to fetch project/session:", error);

        if (!cancelled) {
          setProject(DEFAULT_PROJECT_FOR_EMPTY_SHELL);
          setSession(null);
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

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <StandaloneShell
      project={project}
      session={session}
      isActive={true}
      showHeader={false}
    />
  );
}