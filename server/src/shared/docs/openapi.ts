export type OpenApiPlan = {
  status: 'planned';
  description: string;
  nextSteps: string[];
  examples: Record<string, string>;
};

export const openApiPlan: OpenApiPlan = {
  status: 'planned',
  description: 'Day 1 placeholder for the shared OpenAPI registry and document builder.',
  nextSteps: [
    'Register global tags for auth, projects, files, git, taskmaster, agent, and providers.',
    'Promote the endpoint inventory into explicit request and response schemas.',
    'Publish /api/openapi.json and Swagger UI once schemas are in place.',
  ],
  examples: {
    authTag: 'Auth',
    projectsTag: 'Projects',
    providerTag: 'Providers',
  },
};
